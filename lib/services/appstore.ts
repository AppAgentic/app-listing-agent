import jwt from 'jsonwebtoken'
import { preferDraftPerLocale, upsertVersionedLocalization, VersionedMetadataError, type VersionedKind } from './asc-iap-versions'
import crypto from 'crypto'
import { APPSTORE_LIMITS, RATE_LIMITS } from '../constants'
import type { AppStoreVersionState, LocalizedMetadata } from '../firebase/firestore'
import { Timestamp } from 'firebase-admin/firestore'
import {
  AscAssetLibraryClient,
  AscLibraryError,
  groupForLegacyDisplayType,
  legacyDisplayTypeForGroup,
  type AssetIndex,
  type PlacementTarget,
} from './asc-asset-library'

export interface AppStoreCredentials {
  keyId: string
  issuerId: string
  privateKey: string
  appId: string
}

export interface AppStoreMetadata {
  locale: string
  name: string
  subtitle: string
  description: string
  keywords: string
  whatsNew: string
  supportUrl?: string
  marketingUrl?: string
  privacyUrl?: string
  promotionalText?: string
}

export interface UploadResult {
  success: boolean
  locale: string
  error?: string
}

export interface CreateCustomProductPageInitialLocalization {
  locale: string
  promotionalText?: string | null
}

// Version info returned from App Store Connect
export interface AppStoreVersionInfo {
  id: string
  versionString: string
  state: AppStoreVersionState
  createdDate: string
  isEditable: boolean
}

// Result of pulling localizations
export interface PullResult {
  success: boolean
  versionInfo: AppStoreVersionInfo | null
  localizations: LocalizedMetadata[]
  error?: string
}

interface RateLimiter {
  lastRequestTime: number
  requestCount: number
  hourlyCount: number
  hourStartTime: number
}

function getPersistedResourceId(id: string | null | undefined): string | null {
  if (!id || id.startsWith('new-') || id.includes('${')) return null
  return id
}

function getCPPLocalizationInlineId(locale: string): string {
  return `\${new-appCustomProductPageLocalization-${locale.replace(/[^A-Za-z0-9]/g, '-')}-id}`
}

/** One App Store screenshot set as read back by pullScreenshots, in display order. */
export type AscMediaBackend = 'legacy' | 'library'

export interface LibraryFallback {
  locale: string
  displayType: string
  error: string
  code?: string
}

export interface PulledScreenshotSet {
  displayType: string
  locale: string
  screenshots: Array<{ url: string; fileName: string; width: number; height: number; checksum: string | null }>
}

export class AppStoreHelper {
  private credentials: AppStoreCredentials
  private tokenCache: string | null = null
  private tokenExpiry: number = 0
  private hasReleasedVersionCache: boolean | null = null
  private rateLimiter: RateLimiter = {
    lastRequestTime: 0,
    requestCount: 0,
    hourlyCount: 0,
    hourStartTime: Date.now()
  }

  constructor(credentials: AppStoreCredentials) {
    this.credentials = credentials
  }

  // App Store media backend: legacy screenshot sets (deprecated in API 4.5.1) or
  // the Asset Library. Set per project (`ascMediaBackend`, see
  // lib/services/asc-media-backend.ts); a library failure falls back to legacy
  // for that set and is reported by mediaReport().
  private mediaBackend: AscMediaBackend = 'legacy'
  private libraryAssetIndex: AssetIndex | undefined
  private library: AscAssetLibraryClient | null = null
  private libraryFallbacks: LibraryFallback[] = []

  setMediaBackend(backend: AscMediaBackend, assetIndex?: AssetIndex): void {
    this.mediaBackend = backend
    this.libraryAssetIndex = assetIndex
    this.library = null
  }

  /** Which backend ran and any fallbacks to legacy screenshot sets. */
  mediaReport(): { mediaBackend: AscMediaBackend; libraryFallbacks: LibraryFallback[] } {
    return { mediaBackend: this.mediaBackend, libraryFallbacks: [...this.libraryFallbacks] }
  }

  private getLibrary(): AscAssetLibraryClient {
    if (!this.library) {
      this.library = new AscAssetLibraryClient({
        request: (method, url, body) => this.makeApiRequest(method, url, body),
        appId: this.credentials.appId,
        assetIndex: this.libraryAssetIndex,
        log: message => console.log(`[AppStore][library] ${message}`),
      })
    }
    return this.library
  }

  private recordLibraryFallback(locale: string, displayType: string, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error)
    const code = error instanceof AscLibraryError ? error.code : undefined
    console.warn(`[AppStore] Asset Library failed for ${displayType}/${locale} (${code || 'error'}): ${message}. Falling back to screenshot sets.`)
    this.libraryFallbacks.push({ locale, displayType, error: message.slice(0, 500), ...(code ? { code } : {}) })
  }

  /**
   * Uploads each file once to the Asset Library, then makes the target's
   * placements for this display type exactly these images, in order.
   */
  private async syncScreenshotsToLibrary(
    target: PlacementTarget,
    displayType: string,
    screenshots: Array<{ fileName: string; data: Buffer }>
  ): Promise<{ assetIds: string[]; placementIds: string[]; group: string }> {
    const library = this.getLibrary()
    const catalog = await library.getCatalog('APP_SCREENSHOT')
    const group = groupForLegacyDisplayType(catalog, displayType)
    if (!group) {
      throw new AscLibraryError(`No Asset Library group for ${displayType}`, undefined, 'NO_GROUP')
    }
    const assetIds: string[] = []
    for (const screenshot of screenshots) {
      const uploaded = await library.uploadImage({
        fileName: screenshot.fileName,
        data: screenshot.data,
        placementType: 'APP_SCREENSHOT',
        expectedGroup: group,
      })
      assetIds.push(uploaded.assetId)
    }
    const result = await library.syncPlacements(target, 'APP_SCREENSHOT', group, assetIds)
    return { assetIds, placementIds: result.placementIds, group }
  }

  private async waitIfNeeded(): Promise<void> {
    const now = Date.now()

    // Reset hourly counter if needed
    if (now - this.rateLimiter.hourStartTime > 3600000) {
      this.rateLimiter.hourlyCount = 0
      this.rateLimiter.hourStartTime = now
    }

    // Check hourly limit
    if (this.rateLimiter.hourlyCount >= RATE_LIMITS.requestsPerHour) {
      const waitTime = 3600000 - (now - this.rateLimiter.hourStartTime)
      await new Promise(resolve => setTimeout(resolve, waitTime))
      this.rateLimiter.hourlyCount = 0
      this.rateLimiter.hourStartTime = Date.now()
    }

    // Check per-minute limit (180 requests/minute)
    const minInterval = 60000 / RATE_LIMITS.requestsPerMinute // ~333ms
    const timeSinceLastRequest = now - this.rateLimiter.lastRequestTime
    if (timeSinceLastRequest < minInterval) {
      await new Promise(resolve => setTimeout(resolve, minInterval - timeSinceLastRequest))
    }

    this.rateLimiter.lastRequestTime = Date.now()
    this.rateLimiter.requestCount++
    this.rateLimiter.hourlyCount++
  }

  /**
   * Writes one locale through the versioned IAP/subscription endpoints (API
   * 4.4.1), opening a draft when the approved text changes. Returns null when
   * versioning isn't available or fails unexpectedly, so the caller can use the
   * v1 path; an item in review throws.
   */
  private async upsertVersioned(
    kind: VersionedKind,
    parentId: string,
    locale: string,
    attributes: Record<string, string | null>
  ): Promise<{ id: string; attributes: Record<string, string | null>; state: string } | null> {
    try {
      const result = await upsertVersionedLocalization(
        (method, url, body) => this.makeApiRequest(method, url, body),
        kind,
        parentId,
        locale,
        attributes
      )
      if (result.createdDraft) {
        console.log(`[AppStore] Opened draft version ${result.version.version} for ${kind} ${parentId} (${locale})`)
      }
      return { id: result.localization.id, attributes: result.localization.attributes, state: result.version.state }
    } catch (error) {
      if (error instanceof VersionedMetadataError && error.code === 'IN_REVIEW') throw error
      console.warn(`[AppStore] Versioned ${kind} localization failed, using v1:`, error instanceof Error ? error.message : error)
      return null
    }
  }

  private async makeApiRequest(
    method: string,
    url: string,
    body?: object
  ): Promise<Response> {
    await this.waitIfNeeded()

    const headers = {
      'Authorization': `Bearer ${this.getToken()}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    }

    for (let attempt = 0; attempt < RATE_LIMITS.maxRetries; attempt++) {
      try {
        const response = await fetch(url, {
          method,
          headers,
          body: body ? JSON.stringify(body) : undefined
        })

        // Handle rate limit response
        if (response.status === 429) {
          const retryAfter = parseInt(response.headers.get('retry-after') || '60', 10)
          console.log(`Rate limited. Waiting ${retryAfter} seconds...`)
          await new Promise(resolve => setTimeout(resolve, retryAfter * 1000))
          continue
        }

        return response
      } catch (error) {
        if (attempt === RATE_LIMITS.maxRetries - 1) throw error
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000))
      }
    }

    throw new Error('Max retries exceeded')
  }

  private getToken(): string {
    // Check if cached token is still valid (with 5 minute buffer)
    if (this.tokenCache && Date.now() / 1000 < this.tokenExpiry - 300) {
      return this.tokenCache
    }

    const now = Math.floor(Date.now() / 1000)
    const expiry = now + 20 * 60 // 20 minutes

    const payload = {
      iss: this.credentials.issuerId,
      exp: expiry,
      aud: 'appstoreconnect-v1'
    }

    this.tokenCache = jwt.sign(payload, this.credentials.privateKey, {
      algorithm: 'ES256',
      header: {
        alg: 'ES256',
        kid: this.credentials.keyId,
        typ: 'JWT'
      }
    })
    this.tokenExpiry = expiry

    return this.tokenCache
  }

  async getAppInfosId(): Promise<string> {
    const url = `https://api.appstoreconnect.apple.com/v1/apps/${this.credentials.appId}/appInfos`
    const response = await this.makeApiRequest('GET', url)

    if (!response.ok) {
      throw new Error(`Error getting app infos: ${await response.text()}`)
    }

    const data = await response.json()
    const items = data.data as Array<{ id: string; attributes: { appStoreState: string } }>

    // Find the version that's not "READY_FOR_SALE"
    for (const item of items) {
      if (item.attributes.appStoreState !== 'READY_FOR_SALE') {
        return item.id
      }
    }

    // If all are ready for sale, return the first one
    return items[0]?.id || ''
  }

  async getLatestAppStoreVersion(): Promise<string> {
    const url = `https://api.appstoreconnect.apple.com/v1/apps/${this.credentials.appId}/appStoreVersions`
    const response = await this.makeApiRequest('GET', url)

    if (!response.ok) {
      throw new Error(`Error getting app versions: ${await response.text()}`)
    }

    const data = await response.json()
    const versions = data.data as Array<{
      id: string
      attributes: { createdDate: string }
    }>

    // Sort by createdDate descending and return the latest
    versions.sort((a, b) =>
      new Date(b.attributes.createdDate).getTime() -
      new Date(a.attributes.createdDate).getTime()
    )

    return versions[0]?.id || ''
  }

  /**
   * Check if the app has ever had a released version (READY_FOR_SALE).
   * Used to determine if whatsNew is allowed (Apple rejects it on the first version).
   * Result is cached per helper instance to avoid repeated API calls.
   */
  async hasReleasedVersion(): Promise<boolean> {
    if (this.hasReleasedVersionCache !== null) return this.hasReleasedVersionCache

    const url = `https://api.appstoreconnect.apple.com/v1/apps/${this.credentials.appId}/appStoreVersions`
    const response = await this.makeApiRequest('GET', url)

    if (!response.ok) return false

    const data = await response.json()
    const versions = data.data as Array<{
      id: string
      attributes: { appStoreState: string }
    }>

    this.hasReleasedVersionCache = versions.some(v => v.attributes.appStoreState === 'READY_FOR_SALE')
    return this.hasReleasedVersionCache
  }

  async uploadMetadata(metadata: AppStoreMetadata): Promise<UploadResult> {
    try {
      console.log(`[AppStore] Starting metadata upload for locale: ${metadata.locale}`)
      console.log(`[AppStore] Metadata: name="${metadata.name}", subtitle="${metadata.subtitle}", description length=${metadata.description?.length || 0}`)

      const versionId = await this.getLatestAppStoreVersion()
      const appInfoId = await this.getAppInfosId()

      console.log(`[AppStore] Using versionId: ${versionId}, appInfoId: ${appInfoId}`)

      // Skip whatsNew on first version — Apple rejects it before any version is live
      let metadataToUpload = metadata
      if (metadata.whatsNew) {
        const hasReleased = await this.hasReleasedVersion()
        if (!hasReleased) {
          console.log(`[AppStore] Skipping whatsNew for ${metadata.locale}: no released version yet (first submission)`)
          metadataToUpload = { ...metadata, whatsNew: '' }
        }
      }

      // Update appStoreVersionLocalizations (description, keywords, whatsNew)
      await this.updateVersionLocalization(versionId, metadataToUpload)

      // Update appInfoLocalizations (name, subtitle, privacyUrl)
      await this.updateInfoLocalization(appInfoId, metadata)

      console.log(`[AppStore] Successfully uploaded metadata for locale: ${metadata.locale}`)
      return { success: true, locale: metadata.locale }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      console.error(`[AppStore] Failed to upload metadata for locale ${metadata.locale}:`, errorMessage)
      return {
        success: false,
        locale: metadata.locale,
        error: errorMessage
      }
    }
  }

  private async updateVersionLocalization(
    versionId: string,
    metadata: AppStoreMetadata
  ): Promise<void> {
    const type = 'appStoreVersionLocalizations'
    // Add limit to ensure we get all localizations
    const listUrl = `https://api.appstoreconnect.apple.com/v1/appStoreVersions/${versionId}/${type}?limit=200`

    // Check if localization exists
    const listResponse = await this.makeApiRequest('GET', listUrl)
    if (!listResponse.ok) {
      throw new Error(`Error listing version localizations: ${await listResponse.text()}`)
    }

    const listData = await listResponse.json()
    console.log(`[AppStore] Checking version localizations for ${metadata.locale}, found ${listData.data?.length || 0} total`)

    const existing = listData.data.find(
      (item: { attributes: { locale: string }; id: string }) =>
        item.attributes.locale === metadata.locale
    )

    // Filter out undefined values - App Store API doesn't like undefined
    const attributes: Record<string, string> = {}
    if (metadata.description) attributes.description = metadata.description.substring(0, APPSTORE_LIMITS.description)
    if (metadata.keywords) attributes.keywords = metadata.keywords.substring(0, APPSTORE_LIMITS.keywords)
    if (metadata.whatsNew) attributes.whatsNew = metadata.whatsNew.substring(0, APPSTORE_LIMITS.whatsNew)
    if (metadata.marketingUrl) attributes.marketingUrl = metadata.marketingUrl
    if (metadata.supportUrl) attributes.supportUrl = metadata.supportUrl

    if (existing) {
      // Update existing localization
      console.log(`[AppStore] Updating existing version localization for ${metadata.locale} (id: ${existing.id})`)
      const updateUrl = `https://api.appstoreconnect.apple.com/v1/${type}/${existing.id}`
      const payload = {
        data: {
          type,
          id: existing.id,
          attributes
        }
      }

      const updateResponse = await this.makeApiRequest('PATCH', updateUrl, payload)
      if (!updateResponse.ok) {
        const errorText = await updateResponse.text()
        console.error(`[AppStore] Error updating version localization for ${metadata.locale}:`, errorText)
        throw new Error(`Error updating version localization for ${metadata.locale}: ${errorText}`)
      }
      console.log(`[AppStore] Successfully updated version localization for ${metadata.locale}`)
    } else {
      // Create new localization
      console.log(`[AppStore] Creating new version localization for ${metadata.locale}`)
      const createUrl = `https://api.appstoreconnect.apple.com/v1/${type}`
      const payload = {
        data: {
          type,
          attributes: {
            ...attributes,
            locale: metadata.locale
          },
          relationships: {
            appStoreVersion: {
              data: { type: 'appStoreVersions', id: versionId }
            }
          }
        }
      }

      const createResponse = await this.makeApiRequest('POST', createUrl, payload)
      if (!createResponse.ok) {
        const errorText = await createResponse.text()
        console.error(`[AppStore] Error creating version localization for ${metadata.locale}:`, errorText)
        throw new Error(`Error creating version localization for ${metadata.locale}: ${errorText}`)
      }
      console.log(`[AppStore] Successfully created version localization for ${metadata.locale}`)
    }
  }

  private async updateInfoLocalization(
    appInfoId: string,
    metadata: AppStoreMetadata
  ): Promise<void> {
    const type = 'appInfoLocalizations'
    // Add limit to ensure we get all localizations
    const listUrl = `https://api.appstoreconnect.apple.com/v1/appInfos/${appInfoId}/${type}?limit=200`

    // Check if localization exists
    const listResponse = await this.makeApiRequest('GET', listUrl)
    if (!listResponse.ok) {
      throw new Error(`Error listing info localizations: ${await listResponse.text()}`)
    }

    const listData = await listResponse.json()
    console.log(`[AppStore] Checking info localizations for ${metadata.locale}, found ${listData.data?.length || 0} total`)

    const existing = listData.data.find(
      (item: { attributes: { locale: string }; id: string }) =>
        item.attributes.locale === metadata.locale
    )

    // Filter out undefined values - App Store API doesn't like undefined
    const attributes: Record<string, string> = {}
    if (metadata.name) attributes.name = metadata.name.substring(0, APPSTORE_LIMITS.title)
    if (metadata.subtitle) attributes.subtitle = metadata.subtitle.substring(0, APPSTORE_LIMITS.subtitle)
    if (metadata.privacyUrl) attributes.privacyPolicyUrl = metadata.privacyUrl

    if (existing) {
      // Update existing localization
      console.log(`[AppStore] Updating existing info localization for ${metadata.locale} (id: ${existing.id})`)
      const updateUrl = `https://api.appstoreconnect.apple.com/v1/${type}/${existing.id}`
      const payload = {
        data: {
          type,
          id: existing.id,
          attributes
        }
      }

      const updateResponse = await this.makeApiRequest('PATCH', updateUrl, payload)
      if (!updateResponse.ok) {
        const errorText = await updateResponse.text()
        console.error(`[AppStore] Error updating info localization for ${metadata.locale}:`, errorText)
        throw new Error(`Error updating info localization for ${metadata.locale}: ${errorText}`)
      }
      console.log(`[AppStore] Successfully updated info localization for ${metadata.locale}`)
    } else {
      // Create new localization
      console.log(`[AppStore] Creating new info localization for ${metadata.locale}`)
      const createUrl = `https://api.appstoreconnect.apple.com/v1/${type}`
      const payload = {
        data: {
          type,
          attributes: {
            ...attributes,
            locale: metadata.locale
          },
          relationships: {
            appInfo: {
              data: { type: 'appInfos', id: appInfoId }
            }
          }
        }
      }

      const createResponse = await this.makeApiRequest('POST', createUrl, payload)
      if (!createResponse.ok) {
        const errorText = await createResponse.text()
        console.error(`[AppStore] Error creating info localization for ${metadata.locale}:`, errorText)
        throw new Error(`Error creating info localization for ${metadata.locale}: ${errorText}`)
      }
      console.log(`[AppStore] Successfully created info localization for ${metadata.locale}`)
    }
  }

  // ============================================
  // PULL METHODS - Get data from App Store Connect
  // ============================================

  /**
   * Get all app store versions with their states
   */
  async getAppStoreVersions(): Promise<AppStoreVersionInfo[]> {
    const url = `https://api.appstoreconnect.apple.com/v1/apps/${this.credentials.appId}/appStoreVersions`
    const response = await this.makeApiRequest('GET', url)

    if (!response.ok) {
      throw new Error(`Error getting app versions: ${await response.text()}`)
    }

    const data = await response.json()
    const versions = data.data as Array<{
      id: string
      attributes: {
        versionString: string
        appStoreState: string
        createdDate: string
      }
    }>

    const editableStates: AppStoreVersionState[] = [
      'PREPARE_FOR_SUBMISSION',
      'METADATA_REJECTED',
      'DEVELOPER_REJECTED',
    ]

    return versions.map(v => ({
      id: v.id,
      versionString: v.attributes.versionString,
      state: v.attributes.appStoreState as AppStoreVersionState,
      createdDate: v.attributes.createdDate,
      isEditable: editableStates.includes(v.attributes.appStoreState as AppStoreVersionState),
    }))
  }

  /**
   * Get the latest editable version, or the latest version if none are editable
   */
  async getLatestEditableVersion(): Promise<AppStoreVersionInfo | null> {
    const versions = await this.getAppStoreVersions()
    if (versions.length === 0) return null

    // Sort by created date descending
    versions.sort((a, b) =>
      new Date(b.createdDate).getTime() - new Date(a.createdDate).getTime()
    )

    // First try to find an editable version
    const editable = versions.find(v => v.isEditable)
    if (editable) return editable

    // Otherwise return the latest
    return versions[0]
  }

  /**
   * Get app info localizations (name, subtitle, privacyUrl)
   */
  private async getAppInfoLocalizations(appInfoId: string): Promise<Map<string, {
    name: string
    subtitle: string
    privacyUrl: string | null
  }>> {
    const url = `https://api.appstoreconnect.apple.com/v1/appInfos/${appInfoId}/appInfoLocalizations`
    const response = await this.makeApiRequest('GET', url)

    if (!response.ok) {
      throw new Error(`Error getting app info localizations: ${await response.text()}`)
    }

    const data = await response.json()
    const result = new Map<string, { name: string; subtitle: string; privacyUrl: string | null }>()

    for (const item of data.data) {
      result.set(item.attributes.locale, {
        name: item.attributes.name || '',
        subtitle: item.attributes.subtitle || '',
        privacyUrl: item.attributes.privacyPolicyUrl || null,
      })
    }

    return result
  }

  /**
   * Get version localizations (description, keywords, whatsNew, etc.)
   */
  private async getVersionLocalizations(versionId: string): Promise<Map<string, {
    description: string
    keywords: string
    whatsNew: string
    marketingUrl: string | null
    supportUrl: string | null
    promotionalText: string | null
  }>> {
    const url = `https://api.appstoreconnect.apple.com/v1/appStoreVersions/${versionId}/appStoreVersionLocalizations`
    const response = await this.makeApiRequest('GET', url)

    if (!response.ok) {
      throw new Error(`Error getting version localizations: ${await response.text()}`)
    }

    const data = await response.json()
    const result = new Map<string, {
      description: string
      keywords: string
      whatsNew: string
      marketingUrl: string | null
      supportUrl: string | null
      promotionalText: string | null
    }>()

    for (const item of data.data) {
      result.set(item.attributes.locale, {
        description: item.attributes.description || '',
        keywords: item.attributes.keywords || '',
        whatsNew: item.attributes.whatsNew || '',
        marketingUrl: item.attributes.marketingUrl || null,
        supportUrl: item.attributes.supportUrl || null,
        promotionalText: item.attributes.promotionalText || null,
      })
    }

    return result
  }

  /**
   * Pull all localizations from App Store Connect
   * Merges app info (name, subtitle) and version (description, keywords, etc.)
   */
  async pullLocalizations(userId: string): Promise<PullResult> {
    try {
      // Get the latest version
      const versionInfo = await this.getLatestEditableVersion()
      if (!versionInfo) {
        return {
          success: false,
          versionInfo: null,
          localizations: [],
          error: 'No app store versions found',
        }
      }

      // Get app info ID for the current app
      const appInfoId = await this.getAppInfosId()

      // Fetch both types of localizations in parallel
      const [appInfoLocales, versionLocales] = await Promise.all([
        this.getAppInfoLocalizations(appInfoId),
        this.getVersionLocalizations(versionInfo.id),
      ])

      // Merge into LocalizedMetadata format
      const allLocales = new Set([...appInfoLocales.keys(), ...versionLocales.keys()])
      const localizations: LocalizedMetadata[] = []

      for (const locale of allLocales) {
        const appInfo = appInfoLocales.get(locale) || { name: '', subtitle: '', privacyUrl: null }
        const version = versionLocales.get(locale) || {
          description: '',
          keywords: '',
          whatsNew: '',
          marketingUrl: null,
          supportUrl: null,
          promotionalText: null,
        }

        // Create source hash for conflict detection
        const sourceData = { ...appInfo, ...version }
        const sourceHash = this.generateHash(sourceData)

        localizations.push({
          locale,
          name: appInfo.name,
          subtitle: appInfo.subtitle,
          privacyUrl: appInfo.privacyUrl,
          description: version.description,
          keywords: version.keywords,
          whatsNew: version.whatsNew,
          marketingUrl: version.marketingUrl,
          supportUrl: version.supportUrl,
          promotionalText: version.promotionalText,
          // Play Store fields (not applicable for App Store pull)
          shortDescription: null,
          fullDescription: null,
          // Tracking
          lastModifiedAt: Timestamp.now() as any,
          lastModifiedBy: userId,
          sourceHash,
        })
      }

      return {
        success: true,
        versionInfo,
        localizations,
      }
    } catch (error) {
      return {
        success: false,
        versionInfo: null,
        localizations: [],
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  /**
   * Create a new app store version (for when current version is locked)
   */
  async createNewVersion(versionString: string): Promise<AppStoreVersionInfo> {
    const url = 'https://api.appstoreconnect.apple.com/v1/appStoreVersions'
    const payload = {
      data: {
        type: 'appStoreVersions',
        attributes: {
          versionString,
          platform: 'IOS',
        },
        relationships: {
          app: {
            data: {
              type: 'apps',
              id: this.credentials.appId,
            },
          },
        },
      },
    }

    const response = await this.makeApiRequest('POST', url, payload)

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Error creating new version: ${errorText}`)
    }

    const data = await response.json()
    return {
      id: data.data.id,
      versionString: data.data.attributes.versionString,
      state: data.data.attributes.appStoreState as AppStoreVersionState,
      createdDate: data.data.attributes.createdDate,
      isEditable: true,
    }
  }

  /**
   * Generate a simple hash for conflict detection
   */
  private generateHash(data: Record<string, unknown>): string {
    const str = JSON.stringify(data, Object.keys(data).sort())
    let hash = 0
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i)
      hash = ((hash << 5) - hash) + char
      hash = hash & hash
    }
    return Math.abs(hash).toString(36)
  }

  // ============================================
  // UPLOAD METHODS - Push data to App Store Connect
  // ============================================

  /**
   * Push privacy policy URL to all App Store localizations
   */
  async pushPrivacyPolicyUrl(privacyUrl: string): Promise<{
    success: boolean
    results: Array<{ locale: string; success: boolean; error?: string }>
    message?: string
  }> {
    try {
      const appInfoId = await this.getAppInfosId()

      // Get all appInfoLocalizations
      const listUrl = `https://api.appstoreconnect.apple.com/v1/appInfos/${appInfoId}/appInfoLocalizations?limit=200`
      const listResponse = await this.makeApiRequest('GET', listUrl)

      if (!listResponse.ok) {
        const errorText = await listResponse.text()
        throw new Error(`Failed to get localizations: ${errorText}`)
      }

      const listData = await listResponse.json()
      const localizations = listData.data as Array<{
        id: string
        attributes: { locale: string }
      }>

      if (!localizations || localizations.length === 0) {
        return {
          success: false,
          results: [],
          message: 'No App Store localizations found. Pull metadata from App Store Connect first.',
        }
      }

      console.log(`[AppStore] Updating ${localizations.length} localizations with privacy URL: ${privacyUrl}`)

      const results: Array<{ locale: string; success: boolean; error?: string }> = []

      // Update each localization with the privacy URL
      for (const loc of localizations) {
        try {
          const updateUrl = `https://api.appstoreconnect.apple.com/v1/appInfoLocalizations/${loc.id}`
          const payload = {
            data: {
              type: 'appInfoLocalizations',
              id: loc.id,
              attributes: {
                privacyPolicyUrl: privacyUrl,
              },
            },
          }

          const updateResponse = await this.makeApiRequest('PATCH', updateUrl, payload)

          if (updateResponse.ok) {
            results.push({ locale: loc.attributes.locale, success: true })
            console.log(`[AppStore] Updated ${loc.attributes.locale} with privacy URL`)
          } else {
            const errorText = await updateResponse.text()
            results.push({ locale: loc.attributes.locale, success: false, error: errorText })
            console.error(`[AppStore] Failed to update ${loc.attributes.locale}:`, errorText)
          }
        } catch (error) {
          results.push({
            locale: loc.attributes.locale,
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          })
        }
      }

      const successCount = results.filter(r => r.success).length
      const failedCount = results.filter(r => !r.success).length

      return {
        success: successCount > 0,
        results,
        message: failedCount === 0
          ? `Privacy policy URL pushed to ${successCount} locale(s)`
          : `Pushed to ${successCount}/${results.length} locales. ${failedCount} failed.`,
      }
    } catch (error) {
      console.error('[AppStore] Error pushing privacy URL:', error)
      return {
        success: false,
        results: [],
        message: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  async uploadScreenshots(
    locale: string,
    screenshots: Array<{ fileName: string; data: Buffer }>,
    displayType: string
  ): Promise<UploadResult> {
    try {
      const versionId = await this.getLatestAppStoreVersion()

      // Get locale ID
      const localeListUrl = `https://api.appstoreconnect.apple.com/v1/appStoreVersions/${versionId}/appStoreVersionLocalizations`
      const localeResponse = await this.makeApiRequest('GET', localeListUrl)
      if (!localeResponse.ok) {
        throw new Error(`Error getting localizations: ${await localeResponse.text()}`)
      }

      const localeData = await localeResponse.json()
      const localeInfo = localeData.data.find(
        (item: { attributes: { locale: string }; id: string }) =>
          item.attributes.locale === locale
      )

      if (!localeInfo) {
        throw new Error(`Locale ${locale} not found`)
      }

      const localeId = localeInfo.id

      if (this.mediaBackend === 'library') {
        try {
          await this.syncScreenshotsToLibrary(
            { kind: 'appStoreVersionLocalization', id: localeId },
            displayType,
            screenshots
          )
          return { success: true, locale }
        } catch (error) {
          this.recordLibraryFallback(locale, displayType, error)
        }
      }

      // Get existing screenshot sets
      const setListUrl = `https://api.appstoreconnect.apple.com/v1/appStoreVersionLocalizations/${localeId}/appScreenshotSets`
      const setResponse = await this.makeApiRequest('GET', setListUrl)
      if (!setResponse.ok) {
        throw new Error(`Error getting screenshot sets: ${await setResponse.text()}`)
      }

      const setData = await setResponse.json()
      const existingSet = setData.data.find(
        (item: { attributes: { screenshotDisplayType: string }; id: string }) =>
          item.attributes.screenshotDisplayType === displayType
      )

      // Delete existing set if it exists
      if (existingSet) {
        const deleteUrl = `https://api.appstoreconnect.apple.com/v1/appScreenshotSets/${existingSet.id}`
        await this.makeApiRequest('DELETE', deleteUrl)
      }

      // Create new screenshot set
      const createSetUrl = 'https://api.appstoreconnect.apple.com/v1/appScreenshotSets'
      const createSetPayload = {
        data: {
          type: 'appScreenshotSets',
          attributes: { screenshotDisplayType: displayType },
          relationships: {
            appStoreVersionLocalization: {
              data: { type: 'appStoreVersionLocalizations', id: localeId }
            }
          }
        }
      }

      const createSetResponse = await this.makeApiRequest('POST', createSetUrl, createSetPayload)
      if (!createSetResponse.ok) {
        throw new Error(`Error creating screenshot set: ${await createSetResponse.text()}`)
      }

      const newSetData = await createSetResponse.json()
      const screenshotSetId = newSetData.data.id

      // Upload each screenshot
      let successCount = 0
      for (const screenshot of screenshots) {
        const checksum = crypto.createHash('md5').update(screenshot.data).digest('hex')

        // Create screenshot reservation
        const createScreenshotUrl = 'https://api.appstoreconnect.apple.com/v1/appScreenshots'
        const createScreenshotPayload = {
          data: {
            type: 'appScreenshots',
            attributes: {
              fileName: screenshot.fileName,
              fileSize: screenshot.data.length
            },
            relationships: {
              appScreenshotSet: {
                data: { type: 'appScreenshotSets', id: screenshotSetId }
              }
            }
          }
        }

        const createScreenshotResponse = await this.makeApiRequest(
          'POST',
          createScreenshotUrl,
          createScreenshotPayload
        )

        if (!createScreenshotResponse.ok) {
          console.error(`Error creating screenshot ${screenshot.fileName}`)
          continue
        }

        const screenshotData = await createScreenshotResponse.json()
        const screenshotId = screenshotData.data.id
        const uploadOperations = screenshotData.data.attributes.uploadOperations

        // Upload to S3
        let uploadSuccess = false
        for (const op of uploadOperations) {
          const headers: Record<string, string> = {}
          for (const h of op.requestHeaders) {
            headers[h.name] = h.value
          }

          const uploadResponse = await fetch(op.url, {
            method: op.method,
            headers,
            body: new Uint8Array(screenshot.data)
          })

          if (uploadResponse.ok) {
            uploadSuccess = true
            break
          }
        }

        if (!uploadSuccess) {
          console.error(`Upload failed for ${screenshot.fileName}`)
          continue
        }

        // Commit the reservation
        const commitUrl = `https://api.appstoreconnect.apple.com/v1/appScreenshots/${screenshotId}`
        const commitPayload = {
          data: {
            type: 'appScreenshots',
            id: screenshotId,
            attributes: {
              uploaded: true,
              sourceFileChecksum: checksum
            }
          }
        }

        const commitResponse = await this.makeApiRequest('PATCH', commitUrl, commitPayload)
        if (commitResponse.ok) {
          successCount++
        }
      }

      return {
        success: successCount === screenshots.length,
        locale,
        error: successCount < screenshots.length
          ? `${successCount}/${screenshots.length} screenshots uploaded`
          : undefined
      }
    } catch (error) {
      return {
        success: false,
        locale,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }

  /**
   * Delete a screenshot set from App Store Connect
   * @param displayType The display type of the screenshot set to delete (e.g., APP_IPHONE_67)
   * @param locale The locale of the screenshots to delete (e.g., en-US)
   */
  async deleteScreenshotSet(
    displayType: string,
    locale: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const versionId = await this.getLatestAppStoreVersion()

      // Get locale ID
      const localeListUrl = `https://api.appstoreconnect.apple.com/v1/appStoreVersions/${versionId}/appStoreVersionLocalizations`
      const localeResponse = await this.makeApiRequest('GET', localeListUrl)
      if (!localeResponse.ok) {
        throw new Error(`Error getting localizations: ${await localeResponse.text()}`)
      }

      const localeData = await localeResponse.json()
      const localeInfo = localeData.data.find(
        (item: { attributes: { locale: string }; id: string }) =>
          item.attributes.locale === locale
      )

      if (!localeInfo) {
        // No localization found - nothing to delete
        return { success: true }
      }

      const localeId = localeInfo.id

      // Get screenshot sets for this locale
      const setListUrl = `https://api.appstoreconnect.apple.com/v1/appStoreVersionLocalizations/${localeId}/appScreenshotSets`
      const setResponse = await this.makeApiRequest('GET', setListUrl)
      if (!setResponse.ok) {
        throw new Error(`Error getting screenshot sets: ${await setResponse.text()}`)
      }

      const setData = await setResponse.json()
      const existingSet = setData.data.find(
        (item: { attributes: { screenshotDisplayType: string }; id: string }) =>
          item.attributes.screenshotDisplayType === displayType
      )

      // Delete the set if it exists
      if (existingSet) {
        const deleteUrl = `https://api.appstoreconnect.apple.com/v1/appScreenshotSets/${existingSet.id}`
        const deleteResponse = await this.makeApiRequest('DELETE', deleteUrl)
        if (!deleteResponse.ok && deleteResponse.status !== 404) {
          throw new Error(`Error deleting screenshot set: ${await deleteResponse.text()}`)
        }
      }

      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }

  /**
   * Pull screenshots from App Store Connect
   * Returns all screenshots organized by display type and locale
   */
  async pullScreenshots(
    versionId?: string,
    filterDisplayTypes?: string[]
  ): Promise<PulledScreenshotSet[]> {
    const results: PulledScreenshotSet[] = []

    // Get version ID if not provided
    const targetVersionId = versionId || await this.getLatestAppStoreVersion()

    // Get all localizations for this version
    const localeListUrl = `https://api.appstoreconnect.apple.com/v1/appStoreVersions/${targetVersionId}/appStoreVersionLocalizations?limit=200`
    const localeResponse = await this.makeApiRequest('GET', localeListUrl)
    if (!localeResponse.ok) {
      throw new Error(`Error getting localizations: ${await localeResponse.text()}`)
    }

    const localeData = await localeResponse.json()
    const localizations = localeData.data as Array<{
      id: string
      attributes: { locale: string }
    }>

    // For each localization, get screenshot sets
    for (const localization of localizations) {
      const locale = localization.attributes.locale
      const localeId = localization.id

      if (this.mediaBackend === 'library') {
        try {
          results.push(...await this.pullLibraryScreenshots(localeId, locale, filterDisplayTypes))
          continue
        } catch (error) {
          this.recordLibraryFallback(locale, 'ALL', error)
        }
      }

      const setListUrl = `https://api.appstoreconnect.apple.com/v1/appStoreVersionLocalizations/${localeId}/appScreenshotSets?include=appScreenshots`
      const setResponse = await this.makeApiRequest('GET', setListUrl)
      if (!setResponse.ok) {
        console.error(`Error getting screenshot sets for ${locale}:`, await setResponse.text())
        continue
      }

      const setData = await setResponse.json()
      const screenshotSets = setData.data as Array<{
        id: string
        attributes: { screenshotDisplayType: string }
        relationships?: {
          appScreenshots?: {
            data: Array<{ id: string; type: string }>
          }
        }
      }>

      // Include related screenshots
      const includedScreenshots = (setData.included || []) as Array<{
        id: string
        type: string
        attributes: {
          fileName: string
          sourceFileChecksum?: string | null
          assetDeliveryState?: { state: string }
          imageAsset?: { templateUrl: string; width: number; height: number }
        }
      }>

      for (const screenshotSet of screenshotSets) {
        const displayType = screenshotSet.attributes.screenshotDisplayType

        // Filter by display type if specified
        if (filterDisplayTypes && !filterDisplayTypes.includes(displayType)) {
          continue
        }

        const screenshotIds = screenshotSet.relationships?.appScreenshots?.data || []
        const screenshots: PulledScreenshotSet['screenshots'] = []

        for (const ref of screenshotIds) {
          const screenshot = includedScreenshots.find(s => s.id === ref.id)
          if (screenshot?.attributes.imageAsset?.templateUrl) {
            // Build the actual URL from template
            const template = screenshot.attributes.imageAsset.templateUrl
            const width = screenshot.attributes.imageAsset.width
            const height = screenshot.attributes.imageAsset.height
            const url = template
              .replace('{w}', width.toString())
              .replace('{h}', height.toString())
              .replace('{f}', 'png')

            screenshots.push({
              url,
              fileName: screenshot.attributes.fileName,
              width,
              height,
              checksum: screenshot.attributes.sourceFileChecksum || null,
            })
          }
        }

        if (screenshots.length > 0) {
          results.push({
            displayType,
            locale,
            screenshots,
          })
        }
      }
    }

    return results
  }

  /**
   * One localization's screenshots read from library placements, grouped by the
   * legacy display type our screenshot model uses. Groups with no legacy type
   * (iPhone Duo) are left out until the model supports them.
   */
  private async pullLibraryScreenshots(
    localizationId: string,
    locale: string,
    filterDisplayTypes?: string[]
  ): Promise<PulledScreenshotSet[]> {
    const library = this.getLibrary()
    const catalog = await library.getCatalog('APP_SCREENSHOT')
    const placements = await library.listPlacements(
      { kind: 'appStoreVersionLocalization', id: localizationId },
      'APP_SCREENSHOT'
    )
    const byDisplayType = new Map<string, PulledScreenshotSet>()
    for (const placement of placements) {
      const displayType = legacyDisplayTypeForGroup(catalog, placement.placementGroup)
      if (!displayType) continue
      if (filterDisplayTypes && !filterDisplayTypes.includes(displayType)) continue
      const image = placement.image
      if (!image?.templateUrl || !image.width || !image.height) continue
      const set = byDisplayType.get(displayType) ?? { displayType, locale, screenshots: [] }
      set.screenshots.push({
        url: image.templateUrl
          .replace('{w}', image.width.toString())
          .replace('{h}', image.height.toString())
          .replace('{f}', 'png'),
        fileName: image.fileName || `${image.id}.png`,
        width: image.width,
        height: image.height,
        checksum: null,
      })
      byDisplayType.set(displayType, set)
    }
    return [...byDisplayType.values()]
  }

  // ============================================
  // ANALYTICS METHODS - Sales & Trends Reports
  // ============================================

  /**
   * Fetch a sales report from App Store Connect
   * @param vendorNumber Your vendor number from App Store Connect
   * @param frequency DAILY, WEEKLY, MONTHLY, YEARLY
   * @param reportDate Date string in YYYY-MM-DD format
   * @returns Parsed sales data or null if no data available
   */
  async getSalesReport(
    vendorNumber: string,
    frequency: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY',
    reportDate: string
  ): Promise<SalesReportData[] | null> {
    const url = new URL('https://api.appstoreconnect.apple.com/v1/salesReports')
    url.searchParams.set('filter[frequency]', frequency)
    url.searchParams.set('filter[reportDate]', reportDate)
    url.searchParams.set('filter[reportSubType]', 'SUMMARY')
    url.searchParams.set('filter[reportType]', 'SALES')
    url.searchParams.set('filter[vendorNumber]', vendorNumber)

    await this.waitIfNeeded()

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${this.getToken()}`,
        'Accept': 'application/a-gzip',
      },
    })

    // 404 means no data for that date (common for recent dates)
    if (response.status === 404) {
      return null
    }

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Error fetching sales report: ${errorText}`)
    }

    // Response is gzipped TSV
    const buffer = await response.arrayBuffer()
    const { gunzipSync } = await import('zlib')
    const decompressed = gunzipSync(Buffer.from(buffer))
    const tsvData = decompressed.toString('utf-8')

    return this.parseSalesReport(tsvData)
  }

  /**
   * Parse Apple's TSV sales report format
   */
  private parseSalesReport(tsvData: string): SalesReportData[] {
    const lines = tsvData.trim().split('\n')
    if (lines.length < 2) return []

    const headers = lines[0].split('\t')
    const results: SalesReportData[] = []

    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split('\t')
      const row: Record<string, string> = {}
      headers.forEach((header, index) => {
        row[header] = values[index] || ''
      })

      // Map to our SalesReportData type
      results.push({
        provider: row['Provider'] || '',
        providerCountry: row['Provider Country'] || '',
        sku: row['SKU'] || '',
        developer: row['Developer'] || '',
        title: row['Title'] || '',
        version: row['Version'] || '',
        productTypeIdentifier: row['Product Type Identifier'] || '',
        units: parseFloat(row['Units']) || 0,
        developerProceeds: parseFloat(row['Developer Proceeds']) || 0,
        beginDate: row['Begin Date'] || '',
        endDate: row['End Date'] || '',
        customerCurrency: row['Customer Currency'] || '',
        countryCode: row['Country Code'] || '',
        currencyOfProceeds: row['Currency of Proceeds'] || '',
        appleIdentifier: row['Apple Identifier'] || '',
        customerPrice: parseFloat(row['Customer Price']) || 0,
        promoCode: row['Promo Code'] || '',
        parentIdentifier: row['Parent Identifier'] || '',
        subscription: row['Subscription'] || '',
        period: row['Period'] || '',
        category: row['Category'] || '',
        cmb: row['CMB'] || '',
        device: row['Device'] || '',
        supportedPlatforms: row['Supported Platforms'] || '',
        proceedsReason: row['Proceeds Reason'] || '',
        preservedPricing: row['Preserved Pricing'] || '',
        client: row['Client'] || '',
        orderType: row['Order Type'] || '',
      })
    }

    return results
  }

  /**
   * Aggregate sales data by date, country, and product
   */
  aggregateSalesData(reports: SalesReportData[]): AggregatedSalesData {
    const byDate = new Map<string, { units: number; proceeds: number }>()
    const byCountry = new Map<string, { units: number; proceeds: number; name?: string }>()
    const byProduct = new Map<string, { units: number; proceeds: number; name: string }>()

    let totalUnits = 0
    let totalProceeds = 0
    let currency = 'USD'

    for (const row of reports) {
      // Only count actual sales/downloads (not refunds)
      if (row.units <= 0) continue

      totalUnits += row.units
      totalProceeds += row.developerProceeds
      currency = row.currencyOfProceeds || currency

      // By date
      const date = row.beginDate
      const existing = byDate.get(date) || { units: 0, proceeds: 0 }
      byDate.set(date, {
        units: existing.units + row.units,
        proceeds: existing.proceeds + row.developerProceeds,
      })

      // By country
      const countryData = byCountry.get(row.countryCode) || { units: 0, proceeds: 0 }
      byCountry.set(row.countryCode, {
        units: countryData.units + row.units,
        proceeds: countryData.proceeds + row.developerProceeds,
      })

      // By product (using SKU)
      const productData = byProduct.get(row.sku) || { units: 0, proceeds: 0, name: row.title }
      byProduct.set(row.sku, {
        units: productData.units + row.units,
        proceeds: productData.proceeds + row.developerProceeds,
        name: row.title,
      })
    }

    return {
      totalUnits,
      totalProceeds,
      currency,
      daily: Array.from(byDate.entries())
        .map(([date, data]) => ({ date, ...data }))
        .sort((a, b) => a.date.localeCompare(b.date)),
      byCountry: Array.from(byCountry.entries())
        .map(([code, data]) => ({ code, ...data }))
        .sort((a, b) => b.proceeds - a.proceeds),
      byProduct: Array.from(byProduct.entries())
        .map(([id, data]) => ({ id, ...data }))
        .sort((a, b) => b.proceeds - a.proceeds),
    }
  }

  // ============================================
  // IN-APP PURCHASE METHODS
  // ============================================

  /**
   * List all In-App Purchases for this app
   * Uses the V2 endpoint for comprehensive data
   */
  async listInAppPurchases(): Promise<InAppPurchaseInfo[]> {
    const url = `https://api.appstoreconnect.apple.com/v1/apps/${this.credentials.appId}/inAppPurchasesV2?limit=200`
    const response = await this.makeApiRequest('GET', url)

    if (!response.ok) {
      throw new Error(`Error listing IAPs: ${await response.text()}`)
    }

    const data = await response.json()
    const items = data.data as Array<{
      id: string
      attributes: {
        productId: string
        name: string
        inAppPurchaseType: IAPProductTypeAPI
        state: IAPStateAPI
        familySharable: boolean
        contentHosting: boolean
        reviewNote: string | null
        createdDate: string
      }
    }>

    return items.map(item => ({
      id: item.id,
      productId: item.attributes.productId,
      name: item.attributes.name,
      productType: item.attributes.inAppPurchaseType,
      state: item.attributes.state,
      familyShareable: item.attributes.familySharable,
      contentHosting: item.attributes.contentHosting,
      reviewNote: item.attributes.reviewNote,
      createdDate: item.attributes.createdDate,
    }))
  }

  /**
   * Get a specific In-App Purchase by ID
   */
  async getInAppPurchase(iapId: string): Promise<InAppPurchaseInfo | null> {
    const url = `https://api.appstoreconnect.apple.com/v2/inAppPurchases/${iapId}`
    const response = await this.makeApiRequest('GET', url)

    if (response.status === 404) {
      return null
    }

    if (!response.ok) {
      throw new Error(`Error getting IAP: ${await response.text()}`)
    }

    const data = await response.json()
    const item = data.data

    return {
      id: item.id,
      productId: item.attributes.productId,
      name: item.attributes.name,
      productType: item.attributes.inAppPurchaseType,
      state: item.attributes.state,
      familyShareable: item.attributes.familySharable,
      contentHosting: item.attributes.contentHosting,
      reviewNote: item.attributes.reviewNote,
      createdDate: item.attributes.createdDate,
    }
  }

  /**
   * Create a new In-App Purchase
   * Note: This creates the IAP in App Store Connect
   */
  async createInAppPurchase(params: CreateIAPParams): Promise<InAppPurchaseInfo> {
    const url = 'https://api.appstoreconnect.apple.com/v2/inAppPurchases'

    const payload = {
      data: {
        type: 'inAppPurchases',
        attributes: {
          name: params.name,
          productId: params.productId,
          inAppPurchaseType: params.productType,
          familySharable: params.familyShareable ?? false,
          ...(params.reviewNote ? { reviewNote: params.reviewNote } : {}),
        },
        relationships: {
          app: {
            data: {
              type: 'apps',
              id: this.credentials.appId,
            },
          },
        },
      },
    }

    const response = await this.makeApiRequest('POST', url, payload)

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Error creating IAP: ${errorText}`)
    }

    const data = await response.json()
    const item = data.data

    return {
      id: item.id,
      productId: item.attributes.productId,
      name: item.attributes.name,
      productType: item.attributes.inAppPurchaseType,
      state: item.attributes.state,
      familyShareable: item.attributes.familySharable,
      contentHosting: item.attributes.contentHosting,
      reviewNote: item.attributes.reviewNote,
      createdDate: item.attributes.createdDate,
    }
  }

  /**
   * Update an existing In-App Purchase
   */
  async updateInAppPurchase(iapId: string, params: UpdateIAPParams): Promise<InAppPurchaseInfo> {
    const url = `https://api.appstoreconnect.apple.com/v2/inAppPurchases/${iapId}`

    const attributes: Record<string, unknown> = {}
    if (params.name !== undefined) attributes.name = params.name
    if (params.familyShareable !== undefined) attributes.familySharable = params.familyShareable
    if (params.reviewNote !== undefined) attributes.reviewNote = params.reviewNote

    const payload = {
      data: {
        type: 'inAppPurchases',
        id: iapId,
        attributes,
      },
    }

    const response = await this.makeApiRequest('PATCH', url, payload)

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Error updating IAP: ${errorText}`)
    }

    const data = await response.json()
    const item = data.data

    return {
      id: item.id,
      productId: item.attributes.productId,
      name: item.attributes.name,
      productType: item.attributes.inAppPurchaseType,
      state: item.attributes.state,
      familyShareable: item.attributes.familySharable,
      contentHosting: item.attributes.contentHosting,
      reviewNote: item.attributes.reviewNote,
      createdDate: item.attributes.createdDate,
    }
  }

  /**
   * Delete an In-App Purchase
   * Note: Only works if IAP is not approved/live
   */
  async deleteInAppPurchase(iapId: string): Promise<void> {
    const url = `https://api.appstoreconnect.apple.com/v2/inAppPurchases/${iapId}`
    const response = await this.makeApiRequest('DELETE', url)

    if (!response.ok && response.status !== 404) {
      const errorText = await response.text()
      throw new Error(`Error deleting IAP: ${errorText}`)
    }
  }

  /**
   * List localizations for an In-App Purchase
   */
  async listIAPLocalizations(iapId: string): Promise<IAPLocalizationInfo[]> {
    // Try V2 endpoint first, then fall back to getting IAP with included localizations
    const url = `https://api.appstoreconnect.apple.com/v2/inAppPurchases/${iapId}?include=inAppPurchaseLocalizations`
    const response = await this.makeApiRequest('GET', url)

    if (!response.ok) {
      // If 404, IAP might not have localizations yet - return empty array
      if (response.status === 404) {
        console.warn(`No localizations found for IAP ${iapId}`)
        return []
      }
      throw new Error(`Error listing IAP localizations: ${await response.text()}`)
    }

    const data = await response.json()

    // Localizations are in the 'included' array when using ?include=
    const items = (data.included || []).filter((item: { type: string }) =>
      item.type === 'inAppPurchaseLocalizations'
    ) as Array<{
      id: string
      attributes: {
        locale: string
        name: string
        description: string
        state: string
      }
    }>

    return preferDraftPerLocale(items.map(item => ({
      id: item.id,
      locale: item.attributes.locale,
      displayName: item.attributes.name,
      description: item.attributes.description,
      state: item.attributes.state,
    })))
  }

  /**
   * List localizations for an In-App Purchase (legacy method for compatibility)
   */
  async listIAPLocalizationsDirect(iapId: string): Promise<IAPLocalizationInfo[]> {
    const url = `https://api.appstoreconnect.apple.com/v2/inAppPurchases/${iapId}/inAppPurchaseLocalizations`
    const response = await this.makeApiRequest('GET', url)

    if (!response.ok) {
      if (response.status === 404) {
        return []
      }
      throw new Error(`Error listing IAP localizations: ${await response.text()}`)
    }

    const data = await response.json()
    const items = data.data as Array<{
      id: string
      attributes: {
        locale: string
        name: string
        description: string
        state: string
      }
    }>

    return preferDraftPerLocale(items.map(item => ({
      id: item.id,
      locale: item.attributes.locale,
      displayName: item.attributes.name,
      description: item.attributes.description,
      state: item.attributes.state,
    })))
  }

  /**
   * Create or update IAP localization
   */
  async upsertIAPLocalization(
    iapId: string,
    locale: string,
    params: IAPLocalizationParams
  ): Promise<IAPLocalizationInfo> {
    // Enforce character limits
    const displayName = params.displayName.substring(0, IAP_LIMITS.displayName)
    const description = params.description.substring(0, IAP_LIMITS.description)

    const versioned = await this.upsertVersioned('inAppPurchase', iapId, locale, { name: displayName, description })
    if (versioned) {
      return {
        id: versioned.id,
        locale,
        displayName: versioned.attributes.name ?? displayName,
        description: versioned.attributes.description ?? description,
        state: versioned.state,
      }
    }

    // v1 fallback (deprecated in API 4.4.1)
    const existing = await this.listIAPLocalizations(iapId)
    const localization = existing.find(l => l.locale === locale)

    if (localization) {
      // Update existing
      const url = `https://api.appstoreconnect.apple.com/v1/inAppPurchaseLocalizations/${localization.id}`
      const payload = {
        data: {
          type: 'inAppPurchaseLocalizations',
          id: localization.id,
          attributes: {
            name: displayName,
            description,
          },
        },
      }

      const response = await this.makeApiRequest('PATCH', url, payload)
      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`Error updating IAP localization: ${errorText}`)
      }

      const data = await response.json()
      return {
        id: data.data.id,
        locale: data.data.attributes.locale,
        displayName: data.data.attributes.name,
        description: data.data.attributes.description,
        state: data.data.attributes.state,
      }
    } else {
      // Create new
      const url = 'https://api.appstoreconnect.apple.com/v1/inAppPurchaseLocalizations'
      const payload = {
        data: {
          type: 'inAppPurchaseLocalizations',
          attributes: {
            locale,
            name: displayName,
            description,
          },
          relationships: {
            inAppPurchaseV2: {
              data: {
                type: 'inAppPurchases',
                id: iapId,
              },
            },
          },
        },
      }

      const response = await this.makeApiRequest('POST', url, payload)
      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`Error creating IAP localization: ${errorText}`)
      }

      const data = await response.json()
      return {
        id: data.data.id,
        locale: data.data.attributes.locale,
        displayName: data.data.attributes.name,
        description: data.data.attributes.description,
        state: data.data.attributes.state,
      }
    }
  }

  // ============================================
  // SUBSCRIPTION GROUP METHODS
  // ============================================

  /**
   * List all subscription groups for this app
   */
  async listSubscriptionGroups(): Promise<SubscriptionGroupInfo[]> {
    const url = `https://api.appstoreconnect.apple.com/v1/apps/${this.credentials.appId}/subscriptionGroups?limit=200`
    const response = await this.makeApiRequest('GET', url)

    if (!response.ok) {
      throw new Error(`Error listing subscription groups: ${await response.text()}`)
    }

    const data = await response.json()
    const items = data.data as Array<{
      id: string
      attributes: {
        referenceName: string
      }
    }>

    return items.map(item => ({
      id: item.id,
      referenceName: item.attributes.referenceName,
    }))
  }

  /**
   * Create a new subscription group
   */
  async createSubscriptionGroup(referenceName: string): Promise<SubscriptionGroupInfo> {
    const url = 'https://api.appstoreconnect.apple.com/v1/subscriptionGroups'

    const payload = {
      data: {
        type: 'subscriptionGroups',
        attributes: {
          referenceName,
        },
        relationships: {
          app: {
            data: {
              type: 'apps',
              id: this.credentials.appId,
            },
          },
        },
      },
    }

    const response = await this.makeApiRequest('POST', url, payload)

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Error creating subscription group: ${errorText}`)
    }

    const data = await response.json()
    return {
      id: data.data.id,
      referenceName: data.data.attributes.referenceName,
    }
  }

  /**
   * List subscriptions in a group
   */
  async listSubscriptions(groupId: string): Promise<SubscriptionInfo[]> {
    const url = `https://api.appstoreconnect.apple.com/v1/subscriptionGroups/${groupId}/subscriptions?limit=200`
    const response = await this.makeApiRequest('GET', url)

    if (!response.ok) {
      throw new Error(`Error listing subscriptions: ${await response.text()}`)
    }

    const data = await response.json()
    const items = data.data as Array<{
      id: string
      attributes: {
        productId: string
        name: string
        familySharable: boolean
        state: IAPStateAPI
        subscriptionPeriod: SubscriptionPeriodAPI
        groupLevel: number
        reviewNote: string | null
      }
    }>

    return items.map(item => ({
      id: item.id,
      productId: item.attributes.productId,
      name: item.attributes.name,
      familyShareable: item.attributes.familySharable,
      state: item.attributes.state,
      subscriptionPeriod: item.attributes.subscriptionPeriod,
      groupLevel: item.attributes.groupLevel,
      reviewNote: item.attributes.reviewNote,
    }))
  }

  /**
   * Create a new subscription in a group
   */
  async createSubscription(params: CreateSubscriptionParams): Promise<SubscriptionInfo> {
    const url = 'https://api.appstoreconnect.apple.com/v1/subscriptions'

    const payload = {
      data: {
        type: 'subscriptions',
        attributes: {
          name: params.name,
          productId: params.productId,
          familySharable: params.familyShareable ?? false,
          subscriptionPeriod: params.subscriptionPeriod,
          groupLevel: params.groupLevel ?? 1,
          ...(params.reviewNote ? { reviewNote: params.reviewNote } : {}),
        },
        relationships: {
          group: {
            data: {
              type: 'subscriptionGroups',
              id: params.groupId,
            },
          },
        },
      },
    }

    const response = await this.makeApiRequest('POST', url, payload)

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Error creating subscription: ${errorText}`)
    }

    const data = await response.json()
    const item = data.data

    return {
      id: item.id,
      productId: item.attributes.productId,
      name: item.attributes.name,
      familyShareable: item.attributes.familySharable,
      state: item.attributes.state,
      subscriptionPeriod: item.attributes.subscriptionPeriod,
      groupLevel: item.attributes.groupLevel,
      reviewNote: item.attributes.reviewNote,
    }
  }

  /**
   * Get a subscription by ID
   */
  async getSubscription(subscriptionId: string): Promise<SubscriptionInfo> {
    const url = `https://api.appstoreconnect.apple.com/v1/subscriptions/${subscriptionId}`
    const response = await this.makeApiRequest('GET', url)

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Error getting subscription: ${errorText}`)
    }

    const data = await response.json()
    const item = data.data

    return {
      id: item.id,
      productId: item.attributes.productId,
      name: item.attributes.name,
      familyShareable: item.attributes.familySharable,
      state: item.attributes.state,
      subscriptionPeriod: item.attributes.subscriptionPeriod,
      groupLevel: item.attributes.groupLevel,
      reviewNote: item.attributes.reviewNote,
    }
  }

  /**
   * Update a subscription
   */
  async updateSubscription(subscriptionId: string, params: UpdateSubscriptionParams): Promise<SubscriptionInfo> {
    const url = `https://api.appstoreconnect.apple.com/v1/subscriptions/${subscriptionId}`

    const attributes: Record<string, unknown> = {}
    if (params.name !== undefined) attributes.name = params.name
    if (params.familyShareable !== undefined) attributes.familySharable = params.familyShareable
    if (params.groupLevel !== undefined) attributes.groupLevel = params.groupLevel
    if (params.reviewNote !== undefined) attributes.reviewNote = params.reviewNote

    const payload = {
      data: {
        type: 'subscriptions',
        id: subscriptionId,
        attributes,
      },
    }

    const response = await this.makeApiRequest('PATCH', url, payload)

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Error updating subscription: ${errorText}`)
    }

    const data = await response.json()
    const item = data.data

    return {
      id: item.id,
      productId: item.attributes.productId,
      name: item.attributes.name,
      familyShareable: item.attributes.familySharable,
      state: item.attributes.state,
      subscriptionPeriod: item.attributes.subscriptionPeriod,
      groupLevel: item.attributes.groupLevel,
      reviewNote: item.attributes.reviewNote,
    }
  }

  /**
   * Delete a subscription
   */
  async deleteSubscription(subscriptionId: string): Promise<void> {
    const url = `https://api.appstoreconnect.apple.com/v1/subscriptions/${subscriptionId}`
    const response = await this.makeApiRequest('DELETE', url)

    if (!response.ok && response.status !== 404) {
      const errorText = await response.text()
      throw new Error(`Error deleting subscription: ${errorText}`)
    }
  }

  /**
   * List subscription localizations
   */
  async listSubscriptionLocalizations(subscriptionId: string): Promise<IAPLocalizationInfo[]> {
    const url = `https://api.appstoreconnect.apple.com/v1/subscriptions/${subscriptionId}/subscriptionLocalizations`
    const response = await this.makeApiRequest('GET', url)

    if (!response.ok) {
      throw new Error(`Error listing subscription localizations: ${await response.text()}`)
    }

    const data = await response.json()
    const items = data.data as Array<{
      id: string
      attributes: {
        locale: string
        name: string
        description: string
        state: string
      }
    }>

    return preferDraftPerLocale(items.map(item => ({
      id: item.id,
      locale: item.attributes.locale,
      displayName: item.attributes.name,
      description: item.attributes.description,
      state: item.attributes.state,
    })))
  }

  /**
   * Create or update subscription localization
   */
  async upsertSubscriptionLocalization(
    subscriptionId: string,
    locale: string,
    params: IAPLocalizationParams
  ): Promise<IAPLocalizationInfo> {
    const displayName = params.displayName.substring(0, IAP_LIMITS.displayName)
    const description = params.description.substring(0, IAP_LIMITS.description)

    const versioned = await this.upsertVersioned('subscription', subscriptionId, locale, { name: displayName, description })
    if (versioned) {
      return {
        id: versioned.id,
        locale,
        displayName: versioned.attributes.name ?? displayName,
        description: versioned.attributes.description ?? description,
        state: versioned.state,
      }
    }

    // v1 fallback (deprecated in API 4.4.1)
    const existing = await this.listSubscriptionLocalizations(subscriptionId)
    const localization = existing.find(l => l.locale === locale)

    if (localization) {
      const url = `https://api.appstoreconnect.apple.com/v1/subscriptionLocalizations/${localization.id}`
      const payload = {
        data: {
          type: 'subscriptionLocalizations',
          id: localization.id,
          attributes: {
            name: displayName,
            description,
          },
        },
      }

      const response = await this.makeApiRequest('PATCH', url, payload)
      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`Error updating subscription localization: ${errorText}`)
      }

      const data = await response.json()
      return {
        id: data.data.id,
        locale: data.data.attributes.locale,
        displayName: data.data.attributes.name,
        description: data.data.attributes.description,
        state: data.data.attributes.state,
      }
    } else {
      const url = 'https://api.appstoreconnect.apple.com/v1/subscriptionLocalizations'
      const payload = {
        data: {
          type: 'subscriptionLocalizations',
          attributes: {
            locale,
            name: displayName,
            description,
          },
          relationships: {
            subscription: {
              data: {
                type: 'subscriptions',
                id: subscriptionId,
              },
            },
          },
        },
      }

      const response = await this.makeApiRequest('POST', url, payload)
      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`Error creating subscription localization: ${errorText}`)
      }

      const data = await response.json()
      return {
        id: data.data.id,
        locale: data.data.attributes.locale,
        displayName: data.data.attributes.name,
        description: data.data.attributes.description,
        state: data.data.attributes.state,
      }
    }
  }

  // ============================================
  // SUBSCRIPTION GROUP LOCALIZATION METHODS
  // ============================================

  /**
   * List localizations for a subscription group
   */
  async listSubscriptionGroupLocalizations(groupId: string): Promise<{
    id: string
    locale: string
    name: string
    customAppName: string | null
    state: string
  }[]> {
    const url = `https://api.appstoreconnect.apple.com/v1/subscriptionGroups/${groupId}/subscriptionGroupLocalizations`
    const response = await this.makeApiRequest('GET', url)

    if (!response.ok) {
      if (response.status === 404) {
        return []
      }
      throw new Error(`Error listing subscription group localizations: ${await response.text()}`)
    }

    const data = await response.json()
    const items = data.data as Array<{
      id: string
      attributes: {
        locale: string
        name: string
        customAppName: string | null
        state: string
      }
    }>

    return preferDraftPerLocale(items.map(item => ({
      id: item.id,
      locale: item.attributes.locale,
      name: item.attributes.name,
      customAppName: item.attributes.customAppName,
      state: item.attributes.state,
    })))
  }

  /**
   * Create or update subscription group localization
   */
  async setSubscriptionGroupLocalization(
    groupId: string,
    locale: string,
    params: { name: string; customAppName?: string | null }
  ): Promise<{
    id: string
    locale: string
    name: string
    customAppName: string | null
    state: string
  }> {
    // Group name limit is 30 characters (same as other display names)
    const name = params.name.substring(0, 30)

    const versioned = await this.upsertVersioned('subscriptionGroup', groupId, locale, {
      name,
      ...(params.customAppName !== undefined ? { customAppName: params.customAppName } : {}),
    })
    if (versioned) {
      return {
        id: versioned.id,
        locale,
        name: versioned.attributes.name ?? name,
        customAppName: versioned.attributes.customAppName ?? null,
        state: versioned.state,
      }
    }

    // v1 fallback (deprecated in API 4.4.1)
    const existing = await this.listSubscriptionGroupLocalizations(groupId)
    const localization = existing.find(l => l.locale === locale)

    if (localization) {
      // Update existing
      const url = `https://api.appstoreconnect.apple.com/v1/subscriptionGroupLocalizations/${localization.id}`
      const payload = {
        data: {
          type: 'subscriptionGroupLocalizations',
          id: localization.id,
          attributes: {
            name,
            ...(params.customAppName !== undefined ? { customAppName: params.customAppName } : {}),
          },
        },
      }

      const response = await this.makeApiRequest('PATCH', url, payload)
      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`Error updating subscription group localization: ${errorText}`)
      }

      const data = await response.json()
      return {
        id: data.data.id,
        locale: data.data.attributes.locale,
        name: data.data.attributes.name,
        customAppName: data.data.attributes.customAppName,
        state: data.data.attributes.state,
      }
    } else {
      // Create new
      const url = 'https://api.appstoreconnect.apple.com/v1/subscriptionGroupLocalizations'
      const payload = {
        data: {
          type: 'subscriptionGroupLocalizations',
          attributes: {
            locale,
            name,
            ...(params.customAppName ? { customAppName: params.customAppName } : {}),
          },
          relationships: {
            subscriptionGroup: {
              data: {
                type: 'subscriptionGroups',
                id: groupId,
              },
            },
          },
        },
      }

      const response = await this.makeApiRequest('POST', url, payload)
      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`Error creating subscription group localization: ${errorText}`)
      }

      const data = await response.json()
      return {
        id: data.data.id,
        locale: data.data.attributes.locale,
        name: data.data.attributes.name,
        customAppName: data.data.attributes.customAppName,
        state: data.data.attributes.state,
      }
    }
  }

  /**
   * Delete a subscription group localization
   */
  async deleteSubscriptionGroupLocalization(localizationId: string): Promise<void> {
    const url = `https://api.appstoreconnect.apple.com/v1/subscriptionGroupLocalizations/${localizationId}`
    const response = await this.makeApiRequest('DELETE', url)

    if (!response.ok && response.status !== 404) {
      throw new Error(`Error deleting subscription group localization: ${await response.text()}`)
    }
  }

  // ============================================
  // PROMOTIONAL OFFERS METHODS
  // ============================================

  /**
   * Get introductory offers for a subscription
   */
  async listIntroductoryOffers(subscriptionId: string): Promise<IntroductoryOfferInfo[]> {
    const url = `https://api.appstoreconnect.apple.com/v1/subscriptions/${subscriptionId}/introductoryOffers`
    const response = await this.makeApiRequest('GET', url)

    if (!response.ok) {
      throw new Error(`Error listing introductory offers: ${await response.text()}`)
    }

    const data = await response.json()
    const items = data.data as Array<{
      id: string
      attributes: {
        offerMode: OfferModeAPI
        duration: OfferDurationAPI
        numberOfPeriods: number
        startDate: string | null
        endDate: string | null
      }
    }>

    return items.map(item => ({
      id: item.id,
      offerMode: item.attributes.offerMode,
      duration: item.attributes.duration,
      numberOfPeriods: item.attributes.numberOfPeriods,
      startDate: item.attributes.startDate,
      endDate: item.attributes.endDate,
    }))
  }

  /**
   * Create introductory offer for a subscription
   */
  async createIntroductoryOffer(
    subscriptionId: string,
    params: CreateIntroOfferParams
  ): Promise<IntroductoryOfferInfo> {
    const url = 'https://api.appstoreconnect.apple.com/v1/subscriptionIntroductoryOffers'

    const payload = {
      data: {
        type: 'subscriptionIntroductoryOffers',
        attributes: {
          offerMode: params.offerMode,
          duration: params.duration,
          numberOfPeriods: params.numberOfPeriods,
          ...(params.startDate ? { startDate: params.startDate } : {}),
          ...(params.endDate ? { endDate: params.endDate } : {}),
        },
        relationships: {
          subscription: {
            data: {
              type: 'subscriptions',
              id: subscriptionId,
            },
          },
          territory: {
            data: {
              type: 'territories',
              id: params.territoryId || 'USA',
            },
          },
          subscriptionPricePoint: {
            data: {
              type: 'subscriptionPricePoints',
              id: params.pricePointId,
            },
          },
        },
      },
    }

    const response = await this.makeApiRequest('POST', url, payload)

    if (!response.ok) {
      const errorText = await response.text()
      // Parse Apple's structured error for clearer messages
      let detail = errorText
      try {
        const errorJson = JSON.parse(errorText)
        if (errorJson.errors?.length) {
          detail = errorJson.errors.map((e: any) =>
            `${e.status} ${e.code}: ${e.detail || e.title}`
          ).join('; ')
        }
      } catch {
        // Use raw text
      }
      throw new Error(`Error creating introductory offer for ${params.territoryId || 'USA'}: ${detail}`)
    }

    const data = await response.json()
    const item = data.data

    return {
      id: item.id,
      offerMode: item.attributes.offerMode,
      duration: item.attributes.duration,
      numberOfPeriods: item.attributes.numberOfPeriods,
      startDate: item.attributes.startDate,
      endDate: item.attributes.endDate,
    }
  }

  /**
   * Delete introductory offer
   */
  async deleteIntroductoryOffer(offerId: string): Promise<void> {
    const url = `https://api.appstoreconnect.apple.com/v1/subscriptionIntroductoryOffers/${offerId}`
    const response = await this.makeApiRequest('DELETE', url)

    if (!response.ok && response.status !== 404) {
      const errorText = await response.text()
      throw new Error(`Error deleting introductory offer: ${errorText}`)
    }
  }

  /**
   * List promotional offers for a subscription
   */
  async listPromotionalOffers(subscriptionId: string): Promise<PromotionalOfferInfo[]> {
    const url = `https://api.appstoreconnect.apple.com/v1/subscriptions/${subscriptionId}/promotionalOffers`
    const response = await this.makeApiRequest('GET', url)

    if (!response.ok) {
      throw new Error(`Error listing promotional offers: ${await response.text()}`)
    }

    const data = await response.json()
    const items = data.data as Array<{
      id: string
      attributes: {
        name: string
        offerCode: string
        offerMode: OfferModeAPI
        duration: OfferDurationAPI
        numberOfPeriods: number
      }
    }>

    return items.map(item => ({
      id: item.id,
      name: item.attributes.name,
      offerCode: item.attributes.offerCode,
      offerMode: item.attributes.offerMode,
      duration: item.attributes.duration,
      numberOfPeriods: item.attributes.numberOfPeriods,
    }))
  }

  /**
   * Create promotional offer
   */
  async createPromotionalOffer(
    subscriptionId: string,
    params: CreatePromotionalOfferParams
  ): Promise<PromotionalOfferInfo> {
    const url = 'https://api.appstoreconnect.apple.com/v1/subscriptionPromotionalOffers'

    const payload = {
      data: {
        type: 'subscriptionPromotionalOffers',
        attributes: {
          name: params.name,
          offerCode: params.offerCode,
          offerMode: params.offerMode,
          duration: params.duration,
          numberOfPeriods: params.numberOfPeriods,
        },
        relationships: {
          subscription: {
            data: {
              type: 'subscriptions',
              id: subscriptionId,
            },
          },
          prices: {
            data: params.prices.map(p => ({
              type: 'subscriptionPromotionalOfferPrices',
              id: `\${new-price-${p.territoryId}}`,
            })),
          },
        },
      },
      included: params.prices.map(p => ({
        type: 'subscriptionPromotionalOfferPrices',
        id: `\${new-price-${p.territoryId}}`,
        relationships: {
          territory: {
            data: {
              type: 'territories',
              id: p.territoryId,
            },
          },
          subscriptionPricePoint: {
            data: {
              type: 'subscriptionPricePoints',
              id: p.pricePointId,
            },
          },
        },
      })),
    }

    const response = await this.makeApiRequest('POST', url, payload)

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Error creating promotional offer: ${errorText}`)
    }

    const data = await response.json()
    const item = data.data

    return {
      id: item.id,
      name: item.attributes.name,
      offerCode: item.attributes.offerCode,
      offerMode: item.attributes.offerMode,
      duration: item.attributes.duration,
      numberOfPeriods: item.attributes.numberOfPeriods,
    }
  }

  /**
   * Delete promotional offer
   */
  async deletePromotionalOffer(offerId: string): Promise<void> {
    const url = `https://api.appstoreconnect.apple.com/v1/subscriptionPromotionalOffers/${offerId}`
    const response = await this.makeApiRequest('DELETE', url)

    if (!response.ok && response.status !== 404) {
      const errorText = await response.text()
      throw new Error(`Error deleting promotional offer: ${errorText}`)
    }
  }

  /**
   * List offer codes for a promotional offer
   */
  async listOfferCodes(promotionalOfferId: string): Promise<OfferCodeInfo[]> {
    const url = `https://api.appstoreconnect.apple.com/v1/subscriptionPromotionalOffers/${promotionalOfferId}/offerCodes`
    const response = await this.makeApiRequest('GET', url)

    if (!response.ok) {
      throw new Error(`Error listing offer codes: ${await response.text()}`)
    }

    const data = await response.json()
    const items = data.data as Array<{
      id: string
      attributes: {
        name: string
        numberOfCodes: number
        active: boolean
        customCode: string | null
      }
    }>

    return items.map(item => ({
      id: item.id,
      name: item.attributes.name,
      numberOfCodes: item.attributes.numberOfCodes,
      active: item.attributes.active,
      customCode: item.attributes.customCode,
    }))
  }

  /**
   * Create offer code
   */
  async createOfferCode(
    promotionalOfferId: string,
    params: CreateOfferCodeParams
  ): Promise<OfferCodeInfo> {
    const url = 'https://api.appstoreconnect.apple.com/v1/subscriptionOfferCodes'

    const payload = {
      data: {
        type: 'subscriptionOfferCodes',
        attributes: {
          name: params.name,
          numberOfCodes: params.numberOfCodes,
          ...(params.customCode ? { customCode: params.customCode } : {}),
        },
        relationships: {
          offerCodeCustomCode: params.customCode ? {
            data: { type: 'subscriptionOfferCodeCustomCodes', id: 'custom' },
          } : undefined,
          offerCodeOneTimeUseCodes: !params.customCode ? {
            data: { type: 'subscriptionOfferCodeOneTimeUseCodes', id: 'one-time' },
          } : undefined,
          subscription: {
            data: {
              type: 'subscriptions',
              id: promotionalOfferId.split('_')[0], // Extract subscription ID
            },
          },
        },
      },
    }

    const response = await this.makeApiRequest('POST', url, payload)

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Error creating offer code: ${errorText}`)
    }

    const data = await response.json()
    const item = data.data

    return {
      id: item.id,
      name: item.attributes.name,
      numberOfCodes: item.attributes.numberOfCodes,
      active: item.attributes.active,
      customCode: item.attributes.customCode,
    }
  }

  /**
   * Deactivate offer code
   */
  async deactivateOfferCode(codeId: string): Promise<void> {
    const url = `https://api.appstoreconnect.apple.com/v1/subscriptionOfferCodes/${codeId}`

    const payload = {
      data: {
        type: 'subscriptionOfferCodes',
        id: codeId,
        attributes: {
          active: false,
        },
      },
    }

    const response = await this.makeApiRequest('PATCH', url, payload)

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Error deactivating offer code: ${errorText}`)
    }
  }

  // ============================================
  // PRICING METHODS - IAP & Subscription Pricing
  // ============================================

  /**
   * Get available IAP price points for a territory
   * Returns all ~900 price points for the specified territory
   */
  async getIAPPricePoints(iapId: string, territory: string = 'USA'): Promise<IAPPricePointInfo[]> {
    // Price points are listed per IAP; the global /v1/inAppPurchasePricePoints list returns 403
    const url = `https://api.appstoreconnect.apple.com/v2/inAppPurchases/${iapId}/pricePoints?filter[territory]=${territory}&limit=200`
    const response = await this.makeApiRequest('GET', url)

    if (!response.ok) {
      throw new Error(`Error getting IAP price points: ${await response.text()}`)
    }

    const data = await response.json()
    const items = data.data as Array<{
      id: string
      attributes: {
        customerPrice: string
        proceeds: string
        priceTier: string
      }
    }>

    // Handle pagination if there are more price points
    let allItems = [...items]
    let nextLink = data.links?.next

    while (nextLink) {
      const nextResponse = await this.makeApiRequest('GET', nextLink)
      if (!nextResponse.ok) break
      const nextData = await nextResponse.json()
      allItems = [...allItems, ...nextData.data]
      nextLink = nextData.links?.next
    }

    return allItems.map(item => ({
      id: item.id,
      customerPrice: item.attributes.customerPrice,
      proceeds: item.attributes.proceeds,
      priceTier: item.attributes.priceTier,
    }))
  }

  /**
   * Get price point equalizations for a given price point
   * Returns equivalent prices across all territories
   */
  async getIAPPriceEqualizations(pricePointId: string): Promise<PriceEqualization[]> {
    const url = `https://api.appstoreconnect.apple.com/v1/inAppPurchasePricePoints/${pricePointId}/equalizations?limit=200`
    const response = await this.makeApiRequest('GET', url)

    if (!response.ok) {
      throw new Error(`Error getting price equalizations: ${await response.text()}`)
    }

    const data = await response.json()
    const items = data.data as Array<{
      id: string
      attributes: {
        customerPrice: string
        proceeds: string
        priceTier: string
      }
      relationships?: {
        territory?: {
          data?: { id: string }
        }
      }
    }>

    // Get all pages
    let allItems = [...items]
    let nextLink = data.links?.next

    while (nextLink) {
      const nextResponse = await this.makeApiRequest('GET', nextLink)
      if (!nextResponse.ok) break
      const nextData = await nextResponse.json()
      allItems = [...allItems, ...nextData.data]
      nextLink = nextData.links?.next
    }

    return allItems.map(item => ({
      pricePointId: item.id,
      territory: item.relationships?.territory?.data?.id || 'unknown',
      customerPrice: item.attributes.customerPrice,
      proceeds: item.attributes.proceeds,
      priceTier: item.attributes.priceTier,
    }))
  }

  /**
   * Get current price schedule for an IAP
   */
  async getIAPPriceSchedule(iapId: string): Promise<IAPPriceScheduleInfo | null> {
    const url = `https://api.appstoreconnect.apple.com/v2/inAppPurchases/${iapId}/iapPriceSchedule?include=manualPrices,automaticPrices`
    const response = await this.makeApiRequest('GET', url)

    if (response.status === 404) {
      return null
    }

    if (!response.ok) {
      throw new Error(`Error getting IAP price schedule: ${await response.text()}`)
    }

    const data = await response.json()
    return {
      id: data.data?.id || null,
      baseTerritory: data.data?.attributes?.baseTerritory || null,
      manualPrices: (data.included || [])
        .filter((item: { type: string }) => item.type === 'inAppPurchasePrices')
        .map((item: { id: string; attributes: { startDate: string | null }; relationships?: { inAppPurchasePricePoint?: { data?: { id: string } }; territory?: { data?: { id: string } } } }) => ({
          id: item.id,
          startDate: item.attributes.startDate,
          pricePointId: item.relationships?.inAppPurchasePricePoint?.data?.id,
          territory: item.relationships?.territory?.data?.id,
        })),
    }
  }

  /**
   * Get the current customer price for an IAP in a given territory.
   * Uses the schedule's manualPrices endpoint with include to resolve price point details.
   */
  async getIAPCurrentPrice(
    iapId: string,
    territory: string = 'USA'
  ): Promise<{ customerPrice: string; pricePointId: string; territory: string } | null> {
    // First get the schedule to find its ID
    const scheduleUrl = `https://api.appstoreconnect.apple.com/v2/inAppPurchases/${iapId}/iapPriceSchedule`
    const scheduleResponse = await this.makeApiRequest('GET', scheduleUrl)
    if (!scheduleResponse.ok) return null
    const scheduleData = await scheduleResponse.json()
    const scheduleId = scheduleData.data?.id
    if (!scheduleId) return null

    // Get manual prices with included price point details
    const pricesUrl = `https://api.appstoreconnect.apple.com/v1/inAppPurchasePriceSchedules/${scheduleId}/manualPrices?include=inAppPurchasePricePoint,territory&filter[territory]=${territory}&fields[inAppPurchasePricePoints]=customerPrice`
    const pricesResponse = await this.makeApiRequest('GET', pricesUrl)
    if (!pricesResponse.ok) return null
    const pricesData = await pricesResponse.json()

    // Find current price (no start date = current)
    const currentPrice = (pricesData.data || []).find((p: any) => !p.attributes?.startDate) || pricesData.data?.[0]
    if (!currentPrice) return null

    const pricePointId = currentPrice.relationships?.inAppPurchasePricePoint?.data?.id
    if (!pricePointId) return null

    // Find the price point in included array
    const pricePoint = (pricesData.included || []).find(
      (i: any) => i.type === 'inAppPurchasePricePoints' && i.id === pricePointId
    )
    if (!pricePoint?.attributes?.customerPrice) return null

    return {
      customerPrice: pricePoint.attributes.customerPrice,
      pricePointId,
      territory,
    }
  }

  /**
   * Set IAP price schedule
   * This creates a new price schedule for the IAP
   */
  async setIAPPriceSchedule(
    iapId: string,
    basePricePointId: string,
    baseTerritory: string = 'USA',
    manualPrices?: Array<{ territory: string; pricePointId: string }>
  ): Promise<{ success: boolean; scheduleId?: string; error?: string }> {
    const url = 'https://api.appstoreconnect.apple.com/v1/inAppPurchasePriceSchedules'

    // Build the payload
    // The base price must be included in manual prices for the base territory
    const allManualPrices = [
      { territory: baseTerritory, pricePointId: basePricePointId },
      ...(manualPrices || []).filter(p => p.territory !== baseTerritory),
    ]

    const payload: {
      data: {
        type: string
        relationships: {
          inAppPurchase: { data: { type: string; id: string } }
          manualPrices: { data: Array<{ type: string; id: string }> }
          baseTerritory: { data: { type: string; id: string } }
        }
      }
      included: Array<{
        type: string
        id: string
        relationships: {
          inAppPurchasePricePoint: { data: { type: string; id: string } }
          inAppPurchaseV2: { data: { type: string; id: string } }
        }
      }>
    } = {
      data: {
        type: 'inAppPurchasePriceSchedules',
        relationships: {
          inAppPurchase: {
            data: {
              type: 'inAppPurchases',
              id: iapId,
            },
          },
          manualPrices: {
            data: allManualPrices.map((p, index) => ({
              type: 'inAppPurchasePrices',
              id: `\${price${index}}`,
            })),
          },
          baseTerritory: {
            data: {
              type: 'territories',
              id: baseTerritory,
            },
          },
        },
      },
      included: allManualPrices.map((p, index) => ({
        type: 'inAppPurchasePrices',
        id: `\${price${index}}`,
        relationships: {
          inAppPurchasePricePoint: {
            data: {
              type: 'inAppPurchasePricePoints',
              id: p.pricePointId,
            },
          },
          inAppPurchaseV2: {
            data: {
              type: 'inAppPurchases',
              id: iapId,
            },
          },
        },
      })),
    }

    const response = await this.makeApiRequest('POST', url, payload)

    if (!response.ok) {
      const errorText = await response.text()
      console.error('[AppStore] Error setting IAP price schedule:', errorText)
      return {
        success: false,
        error: `Failed to set IAP price schedule: ${errorText}`,
      }
    }

    const data = await response.json()
    return {
      success: true,
      scheduleId: data.data?.id,
    }
  }

  /**
   * Get subscription price points for a territory
   */
  async getSubscriptionPricePoints(
    subscriptionId: string,
    territory: string = 'USA'
  ): Promise<SubscriptionPricePointInfo[]> {
    const url = `https://api.appstoreconnect.apple.com/v1/subscriptions/${subscriptionId}/pricePoints?filter[territory]=${territory}&limit=200`
    const response = await this.makeApiRequest('GET', url)

    if (!response.ok) {
      throw new Error(`Error getting subscription price points: ${await response.text()}`)
    }

    const data = await response.json()
    const items = data.data as Array<{
      id: string
      attributes: {
        customerPrice: string
        proceeds: string
        proceedsYear2: string
      }
    }>

    // Handle pagination
    let allItems = [...items]
    let nextLink = data.links?.next

    while (nextLink) {
      const nextResponse = await this.makeApiRequest('GET', nextLink)
      if (!nextResponse.ok) break
      const nextData = await nextResponse.json()
      allItems = [...allItems, ...nextData.data]
      nextLink = nextData.links?.next
    }

    return allItems.map(item => ({
      id: item.id,
      customerPrice: item.attributes.customerPrice,
      proceeds: item.attributes.proceeds,
      proceedsYear2: item.attributes.proceedsYear2,
    }))
  }

  /**
   * Get all App Store territories
   * Returns the complete list of ~175 territories
   */
  async getAllTerritories(): Promise<string[]> {
    const url = 'https://api.appstoreconnect.apple.com/v1/territories?limit=200'
    const response = await this.makeApiRequest('GET', url)

    if (!response.ok) {
      console.error('[AppStore] Error getting territories:', await response.text())
      return []
    }

    const data = await response.json()
    let allItems = [...(data.data || [])]
    let nextLink = data.links?.next

    // Handle pagination
    while (nextLink) {
      const nextResponse = await this.makeApiRequest('GET', nextLink)
      if (!nextResponse.ok) break
      const nextData = await nextResponse.json()
      allItems = [...allItems, ...(nextData.data || [])]
      nextLink = nextData.links?.next
    }

    const territories = allItems.map((item: { id: string }) => item.id)
    console.log(`[AppStore] Got ${territories.length} territories`)
    return territories
  }

  /**
   * Get subscription price point equalizations
   */
  async getSubscriptionPriceEqualizations(
    subscriptionId: string,
    pricePointId: string
  ): Promise<PriceEqualization[]> {
    const url = `https://api.appstoreconnect.apple.com/v1/subscriptionPricePoints/${pricePointId}/equalizations?limit=200&include=territory`
    const response = await this.makeApiRequest('GET', url)

    if (!response.ok) {
      throw new Error(`Error getting subscription price equalizations: ${await response.text()}`)
    }

    const data = await response.json()
    const items = data.data as Array<{
      id: string
      attributes: {
        customerPrice: string
        proceeds: string
      }
      relationships?: {
        territory?: {
          data?: { id: string }
        }
      }
    }>

    // Get all pages
    let allItems = [...items]
    let nextLink = data.links?.next

    while (nextLink) {
      const nextResponse = await this.makeApiRequest('GET', nextLink)
      if (!nextResponse.ok) break
      const nextData = await nextResponse.json()
      allItems = [...allItems, ...nextData.data]
      nextLink = nextData.links?.next
    }

    return allItems.map(item => ({
      pricePointId: item.id,
      territory: item.relationships?.territory?.data?.id || 'unknown',
      customerPrice: item.attributes.customerPrice,
      proceeds: item.attributes.proceeds,
    }))
  }

  /**
   * Get current subscription prices
   * Returns existing price entries for the subscription
   */
  async getSubscriptionPrices(
    subscriptionId: string,
    territory?: string
  ): Promise<Array<{
    id: string
    startDate: string | null
    territory: string
    pricePointId: string | null
    customerPrice: string | null
  }>> {
    let url = `https://api.appstoreconnect.apple.com/v1/subscriptions/${subscriptionId}/prices?include=subscriptionPricePoint,territory&fields[subscriptionPricePoints]=customerPrice`
    if (territory) {
      url += `&filter[territory]=${territory}`
    }

    const response = await this.makeApiRequest('GET', url)

    if (!response.ok) {
      console.error('[AppStore] Error getting subscription prices:', await response.text())
      return []
    }

    const data = await response.json()
    const items = data.data as Array<{
      id: string
      attributes: {
        startDate: string | null
      }
      relationships?: {
        subscriptionPricePoint?: { data?: { id: string } }
        territory?: { data?: { id: string } }
      }
    }>

    // Build a map of price point ID -> customerPrice from included data
    const pricePointMap = new Map<string, string>()
    for (const included of (data.included || [])) {
      if (included.type === 'subscriptionPricePoints' && included.attributes?.customerPrice) {
        pricePointMap.set(included.id, included.attributes.customerPrice)
      }
    }

    return items.map(item => {
      const pricePointId = item.relationships?.subscriptionPricePoint?.data?.id || null
      return {
        id: item.id,
        startDate: item.attributes.startDate,
        territory: item.relationships?.territory?.data?.id || 'unknown',
        pricePointId,
        customerPrice: pricePointId ? (pricePointMap.get(pricePointId) || null) : null,
      }
    })
  }

  /** The subscription's availability for the upfront plan (API 4.4+), or null. */
  private async getUpfrontPlanAvailability(
    subscriptionId: string
  ): Promise<{ id: string; availableInNewTerritories: boolean } | null> {
    const response = await this.makeApiRequest('GET', `https://api.appstoreconnect.apple.com/v1/subscriptions/${subscriptionId}/planAvailabilities`)
    if (!response.ok) return null
    const data = await response.json()
    const plan = (data.data || []).find((p: { attributes?: { planType?: string } }) => p.attributes?.planType === 'UPFRONT')
    return plan ? { id: plan.id, availableInNewTerritories: plan.attributes?.availableInNewTerritories ?? false } : null
  }

  /**
   * Get existing subscription availability
   */
  async getSubscriptionAvailability(
    subscriptionId: string
  ): Promise<{ id: string; availableInNewTerritories: boolean } | null> {
    // API 4.4: availability is per plan type; the upfront (pay as you go) plan is the classic one
    const plan = await this.getUpfrontPlanAvailability(subscriptionId)
    if (plan) return plan

    const url = `https://api.appstoreconnect.apple.com/v1/subscriptions/${subscriptionId}/subscriptionAvailability`
    const response = await this.makeApiRequest('GET', url)

    if (!response.ok) {
      // 404 means no availability set yet
      return null
    }

    const data = await response.json()
    if (!data.data) return null

    return {
      id: data.data.id,
      availableInNewTerritories: data.data.attributes?.availableInNewTerritories ?? false,
    }
  }

  /**
   * Set subscription availability for territories
   * This must be called BEFORE setting prices
   *
   * @param subscriptionId - The subscription ID
   * @param availableInAllTerritories - If true, fetches and uses ALL App Store territories
   * @param territories - Optional specific territories. If not provided and availableInAllTerritories is true, fetches all.
   */
  async setSubscriptionAvailability(
    subscriptionId: string,
    availableInAllTerritories: boolean = true,
    territories?: string[]
  ): Promise<{ success: boolean; error?: string; territories?: string[] }> {
    // Deprecated in API 4.4 (replaced by subscriptionPlanAvailabilities); used
    // only when the plan availability call fails unexpectedly.
    const url = 'https://api.appstoreconnect.apple.com/v1/subscriptionAvailabilities'

    // Get territories - either provided list or fetch all from API
    let territoryList: string[]
    if (territories && territories.length > 0) {
      territoryList = territories
    } else if (availableInAllTerritories) {
      // Fetch all territories from the API
      console.log('[AppStore] Fetching all territories for availability...')
      territoryList = await this.getAllTerritories()
      if (territoryList.length === 0) {
        return {
          success: false,
          error: 'Failed to fetch territories from App Store Connect',
        }
      }
    } else {
      territoryList = ['USA'] // Default to just USA
    }

    // API 4.4: set availability on the upfront plan; keep an existing one as is
    // (the old endpoint also left existing availability untouched)
    try {
      if (await this.getUpfrontPlanAvailability(subscriptionId)) {
        return { success: true, territories: territoryList }
      }
      const planResponse = await this.makeApiRequest('POST', 'https://api.appstoreconnect.apple.com/v1/subscriptionPlanAvailabilities', {
        data: {
          type: 'subscriptionPlanAvailabilities',
          attributes: { planType: 'UPFRONT', availableInNewTerritories: availableInAllTerritories },
          relationships: {
            subscription: { data: { type: 'subscriptions', id: subscriptionId } },
            availableTerritories: { data: territoryList.map(t => ({ type: 'territories', id: t })) },
          },
        },
      })
      if (planResponse.ok) {
        console.log('[AppStore] Set subscription plan availability for', territoryList.length, 'territories')
        return { success: true, territories: territoryList }
      }
      console.warn('[AppStore] Plan availability failed, falling back to subscriptionAvailabilities:', await planResponse.text())
    } catch (error) {
      console.warn('[AppStore] Plan availability failed, falling back to subscriptionAvailabilities:', error)
    }

    const payload = {
      data: {
        type: 'subscriptionAvailabilities',
        attributes: {
          availableInNewTerritories: availableInAllTerritories,
        },
        relationships: {
          subscription: {
            data: {
              type: 'subscriptions',
              id: subscriptionId,
            },
          },
          availableTerritories: {
            data: territoryList.map(t => ({
              type: 'territories',
              id: t,
            })),
          },
        },
      },
    }

    console.log('[AppStore] Setting subscription availability:', {
      subscriptionId,
      availableInAllTerritories,
      territoriesCount: territoryList.length,
    })

    const response = await this.makeApiRequest('POST', url, payload)

    if (!response.ok) {
      const errorText = await response.text()
      console.error('[AppStore] Error setting subscription availability:', errorText)
      // If it fails because availability already exists, try to check/update instead
      if (errorText.includes('already exists') || errorText.includes('ENTITY_ERROR')) {
        console.log('[AppStore] Availability may already exist, continuing...')
        return { success: true, territories: territoryList }
      }
      return {
        success: false,
        error: `Failed to set subscription availability: ${errorText}`,
      }
    }

    console.log('[AppStore] Successfully set subscription availability for', territoryList.length, 'territories')
    return { success: true, territories: territoryList }
  }

  /**
   * Set subscription prices
   * Creates a new price entry for the subscription
   *
   * For NEW subscriptions: startDate should be null (immediate effect)
   * For EXISTING subscriptions: startDate must be a future date (price change)
   *
   * @param basePricePointId Can be either:
   *   - An actual Apple price point ID (e.g., "eyJzIjoiNjcxNzY3MjYiLCJ0IjoiVVNBIiwicCI6IjEwMTI3In0")
   *   - A price value as string (e.g., "9.99", "14.99") - will be resolved to actual price point ID
   */
  async setSubscriptionPrices(
    subscriptionId: string,
    basePricePointId: string,
    baseTerritory: string = 'USA',
    preserveCurrentPrice: boolean = false,
    isNewSubscription: boolean = true
  ): Promise<{ success: boolean; error?: string }> {
    const url = 'https://api.appstoreconnect.apple.com/v1/subscriptionPrices'

    // Resolve price value to actual price point ID if needed
    let resolvedPricePointId = basePricePointId

    // Check if basePricePointId looks like a price value (e.g., "9.99", "14.99")
    // Price values are typically short numeric strings, while Apple IDs are longer base64-like strings
    const isPriceValue = /^\d+(\.\d{1,2})?$/.test(basePricePointId)

    if (isPriceValue) {
      console.log(`[AppStore] Resolving price value ${basePricePointId} to actual price point ID for territory ${baseTerritory}`)

      try {
        const pricePoints = await this.getSubscriptionPricePoints(subscriptionId, baseTerritory)
        const targetPrice = parseFloat(basePricePointId)

        // Find exact match first
        let matchingPricePoint = pricePoints.find(pp => parseFloat(pp.customerPrice) === targetPrice)

        // If no exact match, find nearest price point
        if (!matchingPricePoint && pricePoints.length > 0) {
          console.log(`[AppStore] No exact match for ${targetPrice}, finding nearest price point`)
          matchingPricePoint = pricePoints.reduce((nearest, pp) => {
            const ppPrice = parseFloat(pp.customerPrice)
            const nearestPrice = parseFloat(nearest.customerPrice)
            return Math.abs(ppPrice - targetPrice) < Math.abs(nearestPrice - targetPrice) ? pp : nearest
          })
          console.log(`[AppStore] Using nearest price point: ${matchingPricePoint.customerPrice} (ID: ${matchingPricePoint.id})`)
        }

        if (matchingPricePoint) {
          resolvedPricePointId = matchingPricePoint.id
          console.log(`[AppStore] Resolved price ${basePricePointId} to price point ID: ${resolvedPricePointId}`)
        } else {
          console.error(`[AppStore] Could not find price point for value ${basePricePointId} in territory ${baseTerritory}`)
          return {
            success: false,
            error: `No price point found for value ${basePricePointId} in territory ${baseTerritory}. Available price points: ${pricePoints.slice(0, 5).map(p => p.customerPrice).join(', ')}...`,
          }
        }
      } catch (error) {
        console.error(`[AppStore] Error resolving price point:`, error)
        return {
          success: false,
          error: `Failed to resolve price point: ${error instanceof Error ? error.message : String(error)}`,
        }
      }
    }

    // Format date as YYYY-MM-DD
    const formatDate = (date: Date): string => {
      const year = date.getFullYear()
      const month = String(date.getMonth() + 1).padStart(2, '0')
      const day = String(date.getDate()).padStart(2, '0')
      return `${year}-${month}-${day}`
    }

    const getFutureDate = (): string => {
      const futureDate = new Date()
      futureDate.setDate(futureDate.getDate() + 2)
      return formatDate(futureDate)
    }

    // Build payload with optional startDate
    const buildPayload = (startDateValue: string | null) => {
      const attributes: { preserveCurrentPrice: boolean; startDate?: string | null } = {
        preserveCurrentPrice,
      }
      // For new subscriptions, use null; for price changes, use a date
      if (startDateValue !== null) {
        attributes.startDate = startDateValue
      } else {
        attributes.startDate = null // Explicitly set to null for new subscriptions
      }

      return {
        data: {
          type: 'subscriptionPrices',
          attributes,
          relationships: {
            subscription: {
              data: {
                type: 'subscriptions',
                id: subscriptionId,
              },
            },
            subscriptionPricePoint: {
              data: {
                type: 'subscriptionPricePoints',
                id: resolvedPricePointId,
              },
            },
            territory: {
              data: {
                type: 'territories',
                id: baseTerritory,
              },
            },
          },
        },
      }
    }

    // For new subscriptions, try null first (immediate price)
    // For existing subscriptions, try future date first (price change)
    const attempts = isNewSubscription
      ? [null, getFutureDate()] // New: try null, then future date
      : [getFutureDate(), null] // Existing: try future date, then null

    for (let i = 0; i < attempts.length; i++) {
      const startDate = attempts[i]
      console.log(`[AppStore] Setting subscription price (attempt ${i + 1}):`, {
        subscriptionId,
        inputPriceValue: basePricePointId,
        resolvedPricePointId,
        territory: baseTerritory,
        startDate: startDate ?? 'null',
        isNewSubscription,
      })

      const payload = buildPayload(startDate)
      console.log('[AppStore] Payload:', JSON.stringify(payload, null, 2))

      const response = await this.makeApiRequest('POST', url, payload)

      if (response.ok) {
        console.log(`[AppStore] Successfully set subscription price (startDate: ${startDate ?? 'null'})`)
        return { success: true }
      }

      const errorText = await response.text()
      console.log(`[AppStore] Attempt ${i + 1} failed:`, errorText)

      // If this was the last attempt, return the error
      if (i === attempts.length - 1) {
        return {
          success: false,
          error: `Failed to set subscription prices: ${errorText}`,
        }
      }

      // If error is about startDate, try the next approach
      if (!errorText.includes('startDate') && !errorText.includes('future date')) {
        // Error is not about startDate, no point retrying with different date
        return {
          success: false,
          error: `Failed to set subscription prices: ${errorText}`,
        }
      }
    }

    return {
      success: false,
      error: 'Failed to set subscription prices after all attempts',
    }
  }

  /**
   * Set subscription prices for multiple territories
   * Convenience method for applying pricing across territories
   */
  async setSubscriptionPricesForTerritories(
    subscriptionId: string,
    territoryPrices: Array<{ territory: string; pricePointId: string }>,
    preserveCurrentPrice: boolean = false
  ): Promise<{
    success: boolean
    results: Array<{ territory: string; success: boolean; error?: string }>
  }> {
    const results: Array<{ territory: string; success: boolean; error?: string }> = []

    for (const { territory, pricePointId } of territoryPrices) {
      const result = await this.setSubscriptionPrices(
        subscriptionId,
        pricePointId,
        territory,
        preserveCurrentPrice
      )

      results.push({
        territory,
        success: result.success,
        error: result.error,
      })
    }

    return {
      success: results.every(r => r.success),
      results,
    }
  }

  // ============================================
  // IAP REVIEW SCREENSHOT METHODS
  // ============================================

  /**
   * Get the current review screenshot for an IAP
   */
  async getIAPReviewScreenshot(iapId: string): Promise<IAPReviewScreenshotInfo | null> {
    const url = `https://api.appstoreconnect.apple.com/v2/inAppPurchases/${iapId}/appStoreReviewScreenshot`
    const response = await this.makeApiRequest('GET', url)

    if (response.status === 404) {
      return null
    }

    if (!response.ok) {
      throw new Error(`Error getting IAP review screenshot: ${await response.text()}`)
    }

    const data = await response.json()
    if (!data.data) return null

    return {
      id: data.data.id,
      fileName: data.data.attributes.fileName,
      fileSize: data.data.attributes.fileSize,
      assetToken: data.data.attributes.assetToken,
      imageAsset: data.data.attributes.imageAsset,
      assetDeliveryState: data.data.attributes.assetDeliveryState?.state,
    }
  }

  /**
   * Upload a review screenshot for an IAP
   * This is required for IAPs to move from MISSING_METADATA to READY_TO_SUBMIT
   */
  async uploadIAPReviewScreenshot(
    iapId: string,
    screenshot: { fileName: string; data: Buffer }
  ): Promise<{ success: boolean; screenshotId?: string; error?: string }> {
    try {
      // First, check if there's an existing screenshot and delete it
      const existing = await this.getIAPReviewScreenshot(iapId)
      if (existing) {
        await this.deleteIAPReviewScreenshot(existing.id)
      }

      // Create screenshot reservation
      const createUrl = 'https://api.appstoreconnect.apple.com/v1/inAppPurchaseAppStoreReviewScreenshots'
      const createPayload = {
        data: {
          type: 'inAppPurchaseAppStoreReviewScreenshots',
          attributes: {
            fileName: screenshot.fileName,
            fileSize: screenshot.data.length,
          },
          relationships: {
            inAppPurchaseV2: {
              data: {
                type: 'inAppPurchases',
                id: iapId,
              },
            },
          },
        },
      }

      const createResponse = await this.makeApiRequest('POST', createUrl, createPayload)
      if (!createResponse.ok) {
        const errorText = await createResponse.text()
        return { success: false, error: `Failed to create screenshot reservation: ${errorText}` }
      }

      const createData = await createResponse.json()
      const screenshotId = createData.data.id
      const uploadOperations = createData.data.attributes.uploadOperations

      if (!uploadOperations || uploadOperations.length === 0) {
        return { success: false, error: 'No upload operations returned' }
      }

      // Upload to S3/CDN
      let uploadSuccess = false
      for (const op of uploadOperations) {
        const headers: Record<string, string> = {}
        for (const h of op.requestHeaders) {
          headers[h.name] = h.value
        }

        const uploadResponse = await fetch(op.url, {
          method: op.method,
          headers,
          body: new Uint8Array(screenshot.data),
        })

        if (uploadResponse.ok) {
          uploadSuccess = true
          break
        }
      }

      if (!uploadSuccess) {
        return { success: false, error: 'Failed to upload screenshot to storage' }
      }

      // Calculate checksum
      const crypto = await import('crypto')
      const checksum = crypto.createHash('md5').update(screenshot.data).digest('hex')

      // Commit the upload
      const commitUrl = `https://api.appstoreconnect.apple.com/v1/inAppPurchaseAppStoreReviewScreenshots/${screenshotId}`
      const commitPayload = {
        data: {
          type: 'inAppPurchaseAppStoreReviewScreenshots',
          id: screenshotId,
          attributes: {
            uploaded: true,
            sourceFileChecksum: checksum,
          },
        },
      }

      const commitResponse = await this.makeApiRequest('PATCH', commitUrl, commitPayload)
      if (!commitResponse.ok) {
        const errorText = await commitResponse.text()
        return { success: false, error: `Failed to commit screenshot: ${errorText}` }
      }

      return { success: true, screenshotId }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error uploading screenshot',
      }
    }
  }

  /**
   * Delete an IAP review screenshot
   */
  async deleteIAPReviewScreenshot(screenshotId: string): Promise<void> {
    const url = `https://api.appstoreconnect.apple.com/v1/inAppPurchaseAppStoreReviewScreenshots/${screenshotId}`
    const response = await this.makeApiRequest('DELETE', url)

    if (!response.ok && response.status !== 404) {
      const errorText = await response.text()
      throw new Error(`Error deleting IAP review screenshot: ${errorText}`)
    }
  }

  // ============================================
  // IAP PROMOTIONAL IMAGE METHODS
  // ============================================

  /**
   * Get the promotional images for an IAP
   * These are displayed on the App Store product page
   */
  async listIAPImages(iapId: string): Promise<SubscriptionImageInfo[]> {
    await this.waitIfNeeded()

    const url = `https://api.appstoreconnect.apple.com/v2/inAppPurchases/${iapId}/images`

    try {
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${await this.getToken()}`,
          'Content-Type': 'application/json',
        },
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => null)
        console.warn(`[AppStore] Failed to fetch IAP images: ${response.status}`, errorData)
        return []
      }

      const data = await response.json()

      return (data.data || []).map((img: any) => ({
        id: img.id,
        fileName: img.attributes?.fileName || 'image.png',
        fileSize: img.attributes?.fileSize || 0,
        assetToken: img.attributes?.assetToken || null,
        imageAsset: img.attributes?.imageAsset || null,
        assetDeliveryState: img.attributes?.assetDeliveryState || null,
      }))
    } catch (error) {
      console.warn(`[AppStore] Error fetching IAP images for ${iapId}:`, error)
      return []
    }
  }

  /**
   * Get a single IAP promotional image (first available)
   */
  async getIAPImage(iapId: string): Promise<SubscriptionImageInfo | null> {
    const images = await this.listIAPImages(iapId)
    return images.length > 0 ? images[0] : null
  }

  /**
   * Upload an IAP promotional image
   */
  async uploadIAPImage(
    iapId: string,
    image: { fileName: string; data: Buffer }
  ): Promise<{ success: boolean; imageId?: string; error?: string }> {
    try {
      // First, check if there's an existing image and delete it
      const existing = await this.getIAPImage(iapId)
      if (existing) {
        await this.deleteIAPImage(existing.id)
      }

      // Create image reservation
      const createUrl = 'https://api.appstoreconnect.apple.com/v1/inAppPurchaseImages'
      const createPayload = {
        data: {
          type: 'inAppPurchaseImages',
          attributes: {
            fileName: image.fileName,
            fileSize: image.data.length,
          },
          relationships: {
            inAppPurchaseV2: {
              data: {
                type: 'inAppPurchases',
                id: iapId,
              },
            },
          },
        },
      }

      const createResponse = await this.makeApiRequest('POST', createUrl, createPayload)
      if (!createResponse.ok) {
        const errorText = await createResponse.text()
        return { success: false, error: `Failed to create image reservation: ${errorText}` }
      }

      const createData = await createResponse.json()
      const imageId = createData.data.id
      const uploadOperations = createData.data.attributes.uploadOperations

      if (!uploadOperations || uploadOperations.length === 0) {
        return { success: false, error: 'No upload operations returned' }
      }

      // Upload to S3/CDN
      let uploadSuccess = false
      for (const op of uploadOperations) {
        const headers: Record<string, string> = {}
        for (const h of op.requestHeaders) {
          headers[h.name] = h.value
        }

        const uploadResponse = await fetch(op.url, {
          method: op.method,
          headers,
          body: new Uint8Array(image.data),
        })

        if (uploadResponse.ok) {
          uploadSuccess = true
          break
        }
      }

      if (!uploadSuccess) {
        return { success: false, error: 'Failed to upload image to storage' }
      }

      // Commit the upload
      const md5 = crypto.createHash('md5').update(image.data).digest('base64')
      const commitUrl = `https://api.appstoreconnect.apple.com/v1/inAppPurchaseImages/${imageId}`
      const commitPayload = {
        data: {
          type: 'inAppPurchaseImages',
          id: imageId,
          attributes: {
            uploaded: true,
            sourceFileChecksum: md5,
          },
        },
      }

      const commitResponse = await this.makeApiRequest('PATCH', commitUrl, commitPayload)
      if (!commitResponse.ok) {
        const errorText = await commitResponse.text()
        return { success: false, error: `Failed to commit image: ${errorText}` }
      }

      return { success: true, imageId }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error uploading image',
      }
    }
  }

  /**
   * Delete an IAP promotional image
   */
  async deleteIAPImage(imageId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const url = `https://api.appstoreconnect.apple.com/v1/inAppPurchaseImages/${imageId}`
      const response = await this.makeApiRequest('DELETE', url)

      if (!response.ok && response.status !== 404) {
        const errorText = await response.text()
        return { success: false, error: `Failed to delete image: ${errorText}` }
      }

      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error deleting image',
      }
    }
  }

  // ============================================
  // SUBSCRIPTION REVIEW SCREENSHOT METHODS
  // ============================================

  /**
   * Get the current review screenshot for a subscription
   */
  async getSubscriptionReviewScreenshot(subscriptionId: string): Promise<IAPReviewScreenshotInfo | null> {
    const url = `https://api.appstoreconnect.apple.com/v1/subscriptions/${subscriptionId}/appStoreReviewScreenshot`
    const response = await this.makeApiRequest('GET', url)

    if (response.status === 404) {
      return null
    }

    if (!response.ok) {
      // Some subscriptions may not support review screenshots
      console.warn(`[AppStore] Failed to get subscription review screenshot: ${response.status}`)
      return null
    }

    const data = await response.json()
    if (!data.data) return null

    return {
      id: data.data.id,
      fileName: data.data.attributes.fileName,
      fileSize: data.data.attributes.fileSize,
      assetToken: data.data.attributes.assetToken,
      imageAsset: data.data.attributes.imageAsset,
      assetDeliveryState: data.data.attributes.assetDeliveryState?.state,
    }
  }

  /**
   * Upload a review screenshot for a subscription
   */
  async uploadSubscriptionReviewScreenshot(
    subscriptionId: string,
    screenshot: { fileName: string; data: Buffer }
  ): Promise<{ success: boolean; screenshotId?: string; error?: string }> {
    try {
      // First, check if there's an existing screenshot and delete it
      const existing = await this.getSubscriptionReviewScreenshot(subscriptionId)
      if (existing) {
        await this.deleteSubscriptionReviewScreenshot(existing.id)
      }

      // Create screenshot reservation
      const createUrl = 'https://api.appstoreconnect.apple.com/v1/subscriptionAppStoreReviewScreenshots'
      const createPayload = {
        data: {
          type: 'subscriptionAppStoreReviewScreenshots',
          attributes: {
            fileName: screenshot.fileName,
            fileSize: screenshot.data.length,
          },
          relationships: {
            subscription: {
              data: {
                type: 'subscriptions',
                id: subscriptionId,
              },
            },
          },
        },
      }

      const createResponse = await this.makeApiRequest('POST', createUrl, createPayload)
      if (!createResponse.ok) {
        const errorText = await createResponse.text()
        return { success: false, error: `Failed to create screenshot reservation: ${errorText}` }
      }

      const createData = await createResponse.json()
      const screenshotId = createData.data.id
      const uploadOperations = createData.data.attributes.uploadOperations

      if (!uploadOperations || uploadOperations.length === 0) {
        return { success: false, error: 'No upload operations returned' }
      }

      // Upload to S3/CDN
      let uploadSuccess = false
      for (const op of uploadOperations) {
        const headers: Record<string, string> = {}
        for (const h of op.requestHeaders) {
          headers[h.name] = h.value
        }

        const uploadResponse = await fetch(op.url, {
          method: op.method,
          headers,
          body: new Uint8Array(screenshot.data),
        })

        if (uploadResponse.ok) {
          uploadSuccess = true
          break
        }
      }

      if (!uploadSuccess) {
        return { success: false, error: 'Failed to upload screenshot to storage' }
      }

      // Commit the upload
      const md5 = crypto.createHash('md5').update(screenshot.data).digest('base64')
      const commitUrl = `https://api.appstoreconnect.apple.com/v1/subscriptionAppStoreReviewScreenshots/${screenshotId}`
      const commitPayload = {
        data: {
          type: 'subscriptionAppStoreReviewScreenshots',
          id: screenshotId,
          attributes: {
            uploaded: true,
            sourceFileChecksum: md5,
          },
        },
      }

      const commitResponse = await this.makeApiRequest('PATCH', commitUrl, commitPayload)
      if (!commitResponse.ok) {
        const errorText = await commitResponse.text()
        return { success: false, error: `Failed to commit screenshot: ${errorText}` }
      }

      return { success: true, screenshotId }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error uploading screenshot',
      }
    }
  }

  /**
   * Delete a subscription review screenshot
   */
  async deleteSubscriptionReviewScreenshot(screenshotId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const url = `https://api.appstoreconnect.apple.com/v1/subscriptionAppStoreReviewScreenshots/${screenshotId}`
      const response = await this.makeApiRequest('DELETE', url)

      if (!response.ok && response.status !== 404) {
        const errorText = await response.text()
        return { success: false, error: `Failed to delete screenshot: ${errorText}` }
      }

      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error deleting screenshot',
      }
    }
  }

  // ============================================
  // SUBSCRIPTION PROMOTIONAL IMAGE METHODS
  // ============================================

  /**
   * Get the promotional images for a subscription
   * Note: These are different from review screenshots - they're promotional images
   * that appear on the subscription management page in the App Store.
   */
  async listSubscriptionImages(subscriptionId: string): Promise<SubscriptionImageInfo[]> {
    await this.waitIfNeeded()

    const url = `https://api.appstoreconnect.apple.com/v1/subscriptions/${subscriptionId}/images`

    try {
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${await this.getToken()}`,
          'Content-Type': 'application/json',
        },
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => null)
        console.warn(`[AppStore] Failed to fetch subscription images: ${response.status}`, errorData)
        return []
      }

      const data = await response.json()

      return (data.data || []).map((img: any) => ({
        id: img.id,
        fileName: img.attributes?.fileName || 'image.png',
        fileSize: img.attributes?.fileSize || 0,
        assetToken: img.attributes?.assetToken || null,
        imageAsset: img.attributes?.imageAsset || null,
        assetDeliveryState: img.attributes?.assetDeliveryState || null,
      }))
    } catch (error) {
      console.warn(`[AppStore] Error fetching subscription images for ${subscriptionId}:`, error)
      return []
    }
  }

  /**
   * Get a single subscription image (first available)
   */
  async getSubscriptionImage(subscriptionId: string): Promise<SubscriptionImageInfo | null> {
    const images = await this.listSubscriptionImages(subscriptionId)
    return images.length > 0 ? images[0] : null
  }

  /**
   * Upload a subscription promotional image (1024x1024)
   * Used for win-back offers, offer code redemptions, and App Store Promotion
   */
  async uploadSubscriptionImage(
    subscriptionId: string,
    image: { fileName: string; data: Buffer }
  ): Promise<{ success: boolean; imageId?: string; error?: string }> {
    try {
      // First, check if there's an existing image and delete it
      const existing = await this.getSubscriptionImage(subscriptionId)
      if (existing) {
        await this.deleteSubscriptionImage(existing.id)
      }

      // Create image reservation
      const createUrl = 'https://api.appstoreconnect.apple.com/v1/subscriptionImages'
      const createPayload = {
        data: {
          type: 'subscriptionImages',
          attributes: {
            fileName: image.fileName,
            fileSize: image.data.length,
          },
          relationships: {
            subscription: {
              data: {
                type: 'subscriptions',
                id: subscriptionId,
              },
            },
          },
        },
      }

      const createResponse = await this.makeApiRequest('POST', createUrl, createPayload)
      if (!createResponse.ok) {
        const errorText = await createResponse.text()
        return { success: false, error: `Failed to create image reservation: ${errorText}` }
      }

      const createData = await createResponse.json()
      const imageId = createData.data.id
      const uploadOperations = createData.data.attributes.uploadOperations

      if (!uploadOperations || uploadOperations.length === 0) {
        return { success: false, error: 'No upload operations returned' }
      }

      // Upload to S3/CDN
      let uploadSuccess = false
      for (const op of uploadOperations) {
        const headers: Record<string, string> = {}
        for (const h of op.requestHeaders) {
          headers[h.name] = h.value
        }

        const uploadResponse = await fetch(op.url, {
          method: op.method,
          headers,
          body: new Uint8Array(image.data),
        })

        if (uploadResponse.ok) {
          uploadSuccess = true
          break
        }
      }

      if (!uploadSuccess) {
        return { success: false, error: 'Failed to upload image to storage' }
      }

      // Commit the upload
      const md5 = crypto.createHash('md5').update(image.data).digest('base64')
      const commitUrl = `https://api.appstoreconnect.apple.com/v1/subscriptionImages/${imageId}`
      const commitPayload = {
        data: {
          type: 'subscriptionImages',
          id: imageId,
          attributes: {
            uploaded: true,
            sourceFileChecksum: md5,
          },
        },
      }

      const commitResponse = await this.makeApiRequest('PATCH', commitUrl, commitPayload)
      if (!commitResponse.ok) {
        const errorText = await commitResponse.text()
        return { success: false, error: `Failed to commit image: ${errorText}` }
      }

      return { success: true, imageId }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error uploading image',
      }
    }
  }

  /**
   * Delete a subscription promotional image
   */
  async deleteSubscriptionImage(imageId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const url = `https://api.appstoreconnect.apple.com/v1/subscriptionImages/${imageId}`
      const response = await this.makeApiRequest('DELETE', url)

      if (!response.ok && response.status !== 404) {
        const errorText = await response.text()
        return { success: false, error: `Failed to delete image: ${errorText}` }
      }

      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error deleting image',
      }
    }
  }

  // ============================================
  // CUSTOM PRODUCT PAGES (CPP) METHODS
  // ============================================

  /**
   * List all Custom Product Pages for the app
   */
  async listCustomProductPages(): Promise<Array<{
    id: string
    name: string
    url: string | null
    state: string
  }>> {
    const pages: Array<{
      id: string
      name: string
      url: string | null
      state: string
    }> = []
    let url: string | null = `https://api.appstoreconnect.apple.com/v1/apps/${this.credentials.appId}/appCustomProductPages?limit=200`
    while (url) {
      const response = await this.makeApiRequest('GET', url)
      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`Failed to list custom product pages: ${errorText}`)
      }
      const data = await response.json()
      pages.push(...(data.data || []).map((item: any) => ({
        id: item.id,
        name: item.attributes?.name || '',
        url: item.attributes?.url || null,
        state: item.attributes?.state || 'UNKNOWN',
      })))
      url = data.links?.next || null
    }
    return pages
  }

  /**
   * Get a single Custom Product Page by ID
   */
  async getCustomProductPage(cppId: string): Promise<{
    id: string
    name: string
    url: string | null
    state: string
  } | null> {
    const url = `https://api.appstoreconnect.apple.com/v1/appCustomProductPages/${cppId}`
    const response = await this.makeApiRequest('GET', url)
    if (!response.ok) return null
    const data = await response.json()
    return {
      id: data.data.id,
      name: data.data.attributes?.name || '',
      url: data.data.attributes?.url || null,
      state: data.data.attributes?.state || 'UNKNOWN',
    }
  }

  private async getAppStoreVersionLocalizationLocales(versionId: string): Promise<string[]> {
    const url = `https://api.appstoreconnect.apple.com/v1/appStoreVersions/${versionId}/appStoreVersionLocalizations?limit=200`
    const response = await this.makeApiRequest('GET', url)
    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Failed to list App Store version localizations: ${errorText}`)
    }
    const data = await response.json()
    return (data.data || [])
      .map((item: any) => item.attributes?.locale)
      .filter((locale: any): locale is string => typeof locale === 'string' && locale.length > 0)
  }

  private async findCustomProductPageByName(
    name: string,
    locale: string
  ): Promise<{
    id: string
    name: string
    url: string | null
    state: string
    versionId?: string | null
    versionState?: string | null
    localizationId?: string | null
    localizationLocale?: string | null
  } | null> {
    const pages = await this.listCustomProductPages()
    const page = pages.find(item => item.name === name)
    if (!page) return null

    const versions = await this.listCPPVersions(page.id).catch(() => [])
    const version = versions[0] || null
    const localizations = version
      ? await this.listCPPLocalizations(version.id).catch(() => [])
      : []
    const localization = localizations.find(item => item.locale === locale) || localizations[0] || null

    return {
      ...page,
      versionId: version?.id || null,
      versionState: version?.state || null,
      localizationId: localization?.id || null,
      localizationLocale: localization?.locale || locale || null,
    }
  }

  /**
   * Create a Custom Product Page
   */
  async createCustomProductPage(
    name: string,
    initialLocalization: CreateCustomProductPageInitialLocalization = { locale: 'en-US' }
  ): Promise<{
    id: string
    name: string
    url: string | null
    state: string
    versionId?: string | null
    versionState?: string | null
    localizationId?: string | null
    localizationLocale?: string | null
  }> {
    const url = 'https://api.appstoreconnect.apple.com/v1/appCustomProductPages'
    const appStoreVersionTemplateId = await this.getLatestAppStoreVersion()
    if (!appStoreVersionTemplateId) {
      throw new Error('No App Store version found to use as the Custom Product Page template')
    }

    const inlineVersionId = '${new-appCustomProductPageVersion-id}'
    const templateLocalizations = await this.getAppStoreVersionLocalizationLocales(appStoreVersionTemplateId)
    const localizationLocales = templateLocalizations.length
      ? [...templateLocalizations]
      : [initialLocalization.locale]
    if (!localizationLocales.includes(initialLocalization.locale)) {
      localizationLocales.push(initialLocalization.locale)
    }
    const localizationRefs = localizationLocales.map(locale => ({
      type: 'appCustomProductPageLocalizations',
      id: getCPPLocalizationInlineId(locale),
    }))
    const relationships: Record<string, any> = {
      app: {
        data: { type: 'apps', id: this.credentials.appId }
      },
      appCustomProductPageVersions: {
        data: [{ type: 'appCustomProductPageVersions', id: inlineVersionId }]
      },
    }
    const payload: any = {
      data: {
        type: 'appCustomProductPages',
        attributes: { name },
        relationships,
      },
      included: [
        {
          type: 'appCustomProductPageVersions',
          id: inlineVersionId,
          relationships: {
            appCustomProductPage: {},
            appCustomProductPageLocalizations: {
              data: localizationRefs
            }
          }
        },
        ...localizationLocales.map(locale => ({
          type: 'appCustomProductPageLocalizations',
          id: getCPPLocalizationInlineId(locale),
          attributes: {
            locale,
            promotionalText: locale === initialLocalization.locale ? (initialLocalization.promotionalText || '') : '',
          },
        })),
      ],
    }

    relationships.appStoreVersionTemplate = {
      data: { type: 'appStoreVersions', id: appStoreVersionTemplateId }
    }

    const parseCreatedPage = async (response: Response) => {
      const data = await response.json()
      const included = Array.isArray(data.included) ? data.included : []
      const versionId =
        getPersistedResourceId(data.data.relationships?.appCustomProductPageVersions?.data?.[0]?.id) ||
        getPersistedResourceId(included.find((item: any) => item.type === 'appCustomProductPageVersions')?.id)
      const version = included.find((item: any) => item.type === 'appCustomProductPageVersions' && item.id === versionId)
        || included.find((item: any) => item.type === 'appCustomProductPageVersions')
      const localizationRelationshipId = version?.relationships?.appCustomProductPageLocalizations?.data?.[0]?.id
      const localization = included.find((item: any) =>
        item.type === 'appCustomProductPageLocalizations' &&
        (item.id === localizationRelationshipId || item.attributes?.locale === initialLocalization.locale)
      )
      const localizationId = getPersistedResourceId(localizationRelationshipId) || getPersistedResourceId(localization?.id)

      return {
        id: data.data.id,
        name: data.data.attributes?.name || name,
        url: data.data.attributes?.url || null,
        state: data.data.attributes?.state || 'PREPARE_FOR_SUBMISSION',
        versionId,
        versionState: version?.attributes?.state || null,
        localizationId,
        localizationLocale: localization?.attributes?.locale || initialLocalization.locale || null,
      }
    }

    let lastErrorText = ''
    const maxAttempts = 2
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const response = await this.makeApiRequest('POST', url, payload)
      if (response.ok) {
        return parseCreatedPage(response)
      }

      lastErrorText = await response.text()
      const reconciled = await this.findCustomProductPageByName(name, initialLocalization.locale)
      if (reconciled) return reconciled

      await new Promise(resolve => setTimeout(resolve, attempt === 1 ? 3000 : 5000))
      const reconciledAfterDelay = await this.findCustomProductPageByName(name, initialLocalization.locale)
      if (reconciledAfterDelay) return reconciledAfterDelay

      const retryable = response.status >= 500
      if (!retryable || attempt === maxAttempts) break
    }

    throw new Error(`Failed to create custom product page after ${maxAttempts} attempt(s): ${lastErrorText}`)
  }

  /**
   * Update a Custom Product Page name
   */
  async updateCustomProductPage(cppId: string, name: string): Promise<void> {
    const url = `https://api.appstoreconnect.apple.com/v1/appCustomProductPages/${cppId}`
    const payload = {
      data: {
        type: 'appCustomProductPages',
        id: cppId,
        attributes: { name }
      }
    }
    const response = await this.makeApiRequest('PATCH', url, payload)
    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Failed to update custom product page: ${errorText}`)
    }
  }

  /**
   * Delete a Custom Product Page
   */
  async deleteCustomProductPage(cppId: string): Promise<void> {
    const url = `https://api.appstoreconnect.apple.com/v1/appCustomProductPages/${cppId}`
    const response = await this.makeApiRequest('DELETE', url)
    if (!response.ok && response.status !== 404) {
      const errorText = await response.text()
      throw new Error(`Failed to delete custom product page: ${errorText}`)
    }
  }

  /**
   * List versions for a Custom Product Page
   */
  async listCPPVersions(cppId: string): Promise<Array<{
    id: string
    state: string
    deepLink: string | null
  }>> {
    const url = `https://api.appstoreconnect.apple.com/v1/appCustomProductPages/${cppId}/appCustomProductPageVersions`
    const response = await this.makeApiRequest('GET', url)
    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Failed to list CPP versions: ${errorText}`)
    }
    const data = await response.json()
    return (data.data || []).map((item: any) => ({
      id: item.id,
      state: item.attributes?.state || 'UNKNOWN',
      deepLink: item.attributes?.deepLink || null,
    }))
  }

  /**
   * Create a new version for a Custom Product Page
   */
  async createCPPVersion(cppId: string, deepLink?: string): Promise<{
    id: string
    state: string
  }> {
    const url = 'https://api.appstoreconnect.apple.com/v1/appCustomProductPageVersions'
    const payload: any = {
      data: {
        type: 'appCustomProductPageVersions',
        attributes: deepLink ? { deepLink } : {},
        relationships: {
          appCustomProductPage: {
            data: { type: 'appCustomProductPages', id: cppId }
          }
        }
      }
    }
    const response = await this.makeApiRequest('POST', url, payload)
    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Failed to create CPP version: ${errorText}`)
    }
    const data = await response.json()
    return {
      id: data.data.id,
      state: data.data.attributes?.state || 'PREPARE_FOR_SUBMISSION',
    }
  }

  /**
   * List localizations for a CPP version
   */
  async listCPPLocalizations(versionId: string): Promise<Array<{
    id: string
    locale: string
    promotionalText: string | null
  }>> {
    const url = `https://api.appstoreconnect.apple.com/v1/appCustomProductPageVersions/${versionId}/appCustomProductPageLocalizations`
    const response = await this.makeApiRequest('GET', url)
    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Failed to list CPP localizations: ${errorText}`)
    }
    const data = await response.json()
    return (data.data || []).map((item: any) => ({
      id: item.id,
      locale: item.attributes?.locale || '',
      promotionalText: item.attributes?.promotionalText || null,
    }))
  }

  /**
   * Create a localization for a CPP version
   */
  async createCPPLocalization(
    versionId: string,
    locale: string,
    promotionalText?: string
  ): Promise<{ id: string; locale: string }> {
    const url = 'https://api.appstoreconnect.apple.com/v1/appCustomProductPageLocalizations'
    const payload = {
      data: {
        type: 'appCustomProductPageLocalizations',
        attributes: {
          locale,
          ...(promotionalText ? { promotionalText } : {}),
        },
        relationships: {
          appCustomProductPageVersion: {
            data: { type: 'appCustomProductPageVersions', id: versionId }
          }
        }
      }
    }
    const response = await this.makeApiRequest('POST', url, payload)
    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Failed to create CPP localization: ${errorText}`)
    }
    const data = await response.json()
    return {
      id: data.data.id,
      locale: data.data.attributes?.locale || locale,
    }
  }

  /**
   * Update a CPP localization (promotional text)
   */
  async updateCPPLocalization(localizationId: string, promotionalText: string): Promise<void> {
    const url = `https://api.appstoreconnect.apple.com/v1/appCustomProductPageLocalizations/${localizationId}`
    const payload = {
      data: {
        type: 'appCustomProductPageLocalizations',
        id: localizationId,
        attributes: { promotionalText }
      }
    }
    const response = await this.makeApiRequest('PATCH', url, payload)
    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Failed to update CPP localization: ${errorText}`)
    }
  }

  /**
   * Get screenshot sets for a CPP localization
   */
  async getCPPScreenshotSets(localizationId: string): Promise<Array<{
    id: string
    displayType: string
    screenshotCount: number
  }>> {
    const url = `https://api.appstoreconnect.apple.com/v1/appCustomProductPageLocalizations/${localizationId}/appScreenshotSets`
    const response = await this.makeApiRequest('GET', url)
    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Failed to get CPP screenshot sets: ${errorText}`)
    }
    const data = await response.json()
    return (data.data || []).map((item: any) => ({
      id: item.id,
      displayType: item.attributes?.screenshotDisplayType || '',
      screenshotCount: item.relationships?.appScreenshots?.data?.length || 0,
    }))
  }

  /**
   * Delete a CPP screenshot set.
   */
  async deleteCPPScreenshotSet(screenshotSetId: string): Promise<{ success: boolean; error?: string }> {
    const url = `https://api.appstoreconnect.apple.com/v1/appScreenshotSets/${screenshotSetId}`
    const response = await this.makeApiRequest('DELETE', url)
    if (!response.ok && response.status !== 404) {
      const errorText = await response.text()
      return { success: false, error: errorText }
    }
    return { success: true }
  }

  /**
   * Remove copied/template CPP screenshot sets that are not represented by the
   * local App Listing Agent screenshot model for this localization.
   */
  async pruneCPPScreenshotSets(
    localizationId: string,
    keepDisplayTypes: string[]
  ): Promise<{
    success: boolean
    deletedSetIds: string[]
    preservedSetIds: string[]
    error?: string
  }> {
    if (this.mediaBackend === 'library') {
      try {
        const library = this.getLibrary()
        const catalog = await library.getCatalog('APP_SCREENSHOT')
        const target: PlacementTarget = { kind: 'appCustomProductPageLocalization', id: localizationId }
        const keepGroups = new Set(
          keepDisplayTypes
            .map(displayType => groupForLegacyDisplayType(catalog, displayType))
            .filter((group): group is string => !!group)
        )
        const groups = new Set((await library.listPlacements(target, 'APP_SCREENSHOT')).map(p => p.placementGroup))
        const deletedSetIds: string[] = []
        const preservedSetIds: string[] = []
        for (const group of groups) {
          if (keepGroups.has(group)) {
            preservedSetIds.push(group)
            continue
          }
          await library.syncPlacements(target, 'APP_SCREENSHOT', group, [])
          deletedSetIds.push(group)
        }
        return { success: true, deletedSetIds, preservedSetIds }
      } catch (error) {
        this.recordLibraryFallback(localizationId, 'CPP_PRUNE', error)
      }
    }

    try {
      const keep = new Set(keepDisplayTypes)
      const existingSets = await this.getCPPScreenshotSets(localizationId)
      const deletedSetIds: string[] = []
      const preservedSetIds: string[] = []

      for (const set of existingSets) {
        if (keep.has(set.displayType)) {
          preservedSetIds.push(set.id)
          continue
        }

        const result = await this.deleteCPPScreenshotSet(set.id)
        if (!result.success) {
          return {
            success: false,
            deletedSetIds,
            preservedSetIds,
            error: `Failed to delete stale CPP screenshot set ${set.displayType} (${set.id}): ${result.error}`,
          }
        }
        deletedSetIds.push(set.id)
      }

      return { success: true, deletedSetIds, preservedSetIds }
    } catch (error) {
      return {
        success: false,
        deletedSetIds: [],
        preservedSetIds: [],
        error: error instanceof Error ? error.message : 'Unknown error pruning CPP screenshot sets',
      }
    }
  }

  /**
   * Create a screenshot set for a CPP localization
   */
  async createCPPScreenshotSet(
    localizationId: string,
    displayType: string
  ): Promise<{ id: string }> {
    const url = 'https://api.appstoreconnect.apple.com/v1/appScreenshotSets'
    const payload = {
      data: {
        type: 'appScreenshotSets',
        attributes: { screenshotDisplayType: displayType },
        relationships: {
          appCustomProductPageLocalization: {
            data: { type: 'appCustomProductPageLocalizations', id: localizationId }
          }
        }
      }
    }
    const response = await this.makeApiRequest('POST', url, payload)
    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Failed to create CPP screenshot set: ${errorText}`)
    }
    const data = await response.json()
    return { id: data.data.id }
  }

  /**
   * Upload a screenshot to a CPP screenshot set (reserve → upload → commit)
   */
  async uploadCPPScreenshot(
    screenshotSetId: string,
    imageData: Buffer,
    fileName: string
  ): Promise<{ id: string; success: boolean; error?: string }> {
    try {
      const checksum = crypto.createHash('md5').update(imageData).digest('hex')

      // Step 1: Reserve screenshot
      const reserveUrl = 'https://api.appstoreconnect.apple.com/v1/appScreenshots'
      const reservePayload = {
        data: {
          type: 'appScreenshots',
          attributes: {
            fileName,
            fileSize: imageData.length,
          },
          relationships: {
            appScreenshotSet: {
              data: { type: 'appScreenshotSets', id: screenshotSetId }
            }
          }
        }
      }
      const reserveResponse = await this.makeApiRequest('POST', reserveUrl, reservePayload)
      if (!reserveResponse.ok) {
        const errorText = await reserveResponse.text()
        return { id: '', success: false, error: `Reserve failed: ${errorText}` }
      }
      const reserveData = await reserveResponse.json()
      const screenshotId = reserveData.data.id
      const uploadOperations = reserveData.data.attributes.uploadOperations

      // Step 2: Upload binary data
      for (const op of uploadOperations) {
        const headers: Record<string, string> = {}
        for (const h of op.requestHeaders) {
          headers[h.name] = h.value
        }
        const uploadResponse = await fetch(op.url, {
          method: op.method,
          headers,
          body: new Uint8Array(imageData),
        })
        if (!uploadResponse.ok) {
          return { id: screenshotId, success: false, error: `Upload failed for operation` }
        }
      }

      // Step 3: Commit
      const commitUrl = `https://api.appstoreconnect.apple.com/v1/appScreenshots/${screenshotId}`
      const commitPayload = {
        data: {
          type: 'appScreenshots',
          id: screenshotId,
          attributes: {
            uploaded: true,
            sourceFileChecksum: checksum,
          }
        }
      }
      const commitResponse = await this.makeApiRequest('PATCH', commitUrl, commitPayload)
      if (!commitResponse.ok) {
        const errorText = await commitResponse.text()
        return { id: screenshotId, success: false, error: `Commit failed: ${errorText}` }
      }

      return { id: screenshotId, success: true }
    } catch (error) {
      return {
        id: '',
        success: false,
        error: error instanceof Error ? error.message : 'Unknown upload error',
      }
    }
  }

  /**
   * Replace a CPP screenshot set for one localization/display type.
   *
   * App Store Connect appends screenshots to a set. For App Listing Agent's
   * editing model, a push should mirror the local ordered list, so this deletes
   * the existing set for the display type and recreates it before uploading.
   */
  async uploadCPPScreenshotSet(
    localizationId: string,
    displayType: string,
    screenshots: Array<{ fileName: string; data: Buffer; checksum?: string }>
  ): Promise<{
    success: boolean
    screenshotSetId?: string
    screenshotIds?: string[]
    screenshotsUploaded?: number
    error?: string
  }> {
    if (this.mediaBackend === 'library') {
      try {
        const { assetIds } = await this.syncScreenshotsToLibrary(
          { kind: 'appCustomProductPageLocalization', id: localizationId },
          displayType,
          screenshots
        )
        // Library assets have no set; screenshotIds are the library asset ids.
        return { success: true, screenshotIds: assetIds, screenshotsUploaded: screenshots.length }
      } catch (error) {
        this.recordLibraryFallback(localizationId, displayType, error)
      }
    }

    try {
      const existingSets = await this.getCPPScreenshotSets(localizationId)
      const existingSet = existingSets.find(set => set.displayType === displayType)

      if (existingSet) {
        const deleteResult = await this.deleteCPPScreenshotSet(existingSet.id)
        if (!deleteResult.success) {
          return { success: false, error: `Failed to delete existing CPP screenshot set: ${deleteResult.error}` }
        }
      }

      if (screenshots.length === 0) {
        return { success: true, screenshotsUploaded: 0, screenshotIds: [] }
      }

      const { id: screenshotSetId } = await this.createCPPScreenshotSet(localizationId, displayType)
      const screenshotIds: string[] = []

      for (const screenshot of screenshots) {
        const result = await this.uploadCPPScreenshot(
          screenshotSetId,
          screenshot.data,
          screenshot.fileName
        )

        if (!result.success) {
          return {
            success: false,
            screenshotSetId,
            screenshotIds,
            screenshotsUploaded: screenshotIds.length,
            error: result.error || `Failed to upload ${screenshot.fileName}`,
          }
        }

        screenshotIds.push(result.id)
      }

      return {
        success: true,
        screenshotSetId,
        screenshotIds,
        screenshotsUploaded: screenshotIds.length,
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error uploading CPP screenshot set',
      }
    }
  }
}

// ============================================
// ANALYTICS TYPES
// ============================================

export interface SalesReportData {
  provider: string
  providerCountry: string
  sku: string
  developer: string
  title: string
  version: string
  productTypeIdentifier: string
  units: number
  developerProceeds: number
  beginDate: string
  endDate: string
  customerCurrency: string
  countryCode: string
  currencyOfProceeds: string
  appleIdentifier: string
  customerPrice: number
  promoCode: string
  parentIdentifier: string
  subscription: string
  period: string
  category: string
  cmb: string
  device: string
  supportedPlatforms: string
  proceedsReason: string
  preservedPricing: string
  client: string
  orderType: string
}

export interface AggregatedSalesData {
  totalUnits: number
  totalProceeds: number
  currency: string
  daily: Array<{ date: string; units: number; proceeds: number }>
  byCountry: Array<{ code: string; units: number; proceeds: number }>
  byProduct: Array<{ id: string; name: string; units: number; proceeds: number }>
}

// ============================================
// IN-APP PURCHASE TYPES
// ============================================

export type IAPProductTypeAPI =
  | 'CONSUMABLE'
  | 'NON_CONSUMABLE'
  | 'NON_RENEWING_SUBSCRIPTION'

export type IAPStateAPI =
  | 'MISSING_METADATA'
  | 'READY_TO_SUBMIT'
  | 'WAITING_FOR_REVIEW'
  | 'IN_REVIEW'
  | 'APPROVED'
  | 'REJECTED'
  | 'REMOVED_FROM_SALE'

export interface InAppPurchaseInfo {
  id: string                    // App Store Connect ID
  productId: string             // Your product identifier
  name: string                  // Reference name
  productType: IAPProductTypeAPI
  state: IAPStateAPI
  familyShareable: boolean
  contentHosting: boolean
  reviewNote: string | null
  createdDate: string
}

export interface CreateIAPParams {
  productId: string
  name: string
  productType: IAPProductTypeAPI
  familyShareable?: boolean
  reviewNote?: string
}

export interface UpdateIAPParams {
  name?: string
  familyShareable?: boolean
  reviewNote?: string | null
}

export interface IAPLocalizationInfo {
  id: string
  locale: string
  displayName: string
  description: string
  state: string
}

export interface IAPLocalizationParams {
  displayName: string          // Max 30 chars
  description: string          // Max 45 chars
}

// App Store Connect limits for IAP
export const IAP_LIMITS = {
  displayName: 30,
  description: 45,
}

// ============================================
// SUBSCRIPTION TYPES
// ============================================

export type SubscriptionPeriodAPI =
  | 'ONE_WEEK'
  | 'ONE_MONTH'
  | 'TWO_MONTHS'
  | 'THREE_MONTHS'
  | 'SIX_MONTHS'
  | 'ONE_YEAR'

export interface SubscriptionGroupInfo {
  id: string
  referenceName: string
}

export interface SubscriptionInfo {
  id: string
  productId: string
  name: string
  familyShareable: boolean
  state: IAPStateAPI
  subscriptionPeriod: SubscriptionPeriodAPI
  groupLevel: number
  reviewNote: string | null
}

export interface CreateSubscriptionParams {
  productId: string
  name: string
  groupId: string
  subscriptionPeriod: SubscriptionPeriodAPI
  familyShareable?: boolean
  groupLevel?: number
  reviewNote?: string
}

export interface UpdateSubscriptionParams {
  name?: string
  familyShareable?: boolean
  groupLevel?: number
  reviewNote?: string | null
}

// ============================================
// PROMOTIONAL OFFERS TYPES
// ============================================

export type OfferModeAPI = 'PAY_AS_YOU_GO' | 'PAY_UP_FRONT' | 'FREE_TRIAL'

export type OfferDurationAPI =
  | 'THREE_DAYS'
  | 'ONE_WEEK'
  | 'TWO_WEEKS'
  | 'ONE_MONTH'
  | 'TWO_MONTHS'
  | 'THREE_MONTHS'
  | 'SIX_MONTHS'
  | 'ONE_YEAR'

export interface IntroductoryOfferInfo {
  id: string
  offerMode: OfferModeAPI
  duration: OfferDurationAPI
  numberOfPeriods: number
  startDate: string | null
  endDate: string | null
}

export interface CreateIntroOfferParams {
  offerMode: OfferModeAPI
  duration: OfferDurationAPI
  numberOfPeriods: number
  pricePointId: string
  territoryId?: string
  startDate?: string
  endDate?: string
}

export interface PromotionalOfferInfo {
  id: string
  name: string
  offerCode: string
  offerMode: OfferModeAPI
  duration: OfferDurationAPI
  numberOfPeriods: number
}

export interface CreatePromotionalOfferParams {
  name: string
  offerCode: string
  offerMode: OfferModeAPI
  duration: OfferDurationAPI
  numberOfPeriods: number
  prices: Array<{
    territoryId: string
    pricePointId: string
  }>
}

export interface OfferCodeInfo {
  id: string
  name: string
  numberOfCodes: number
  active: boolean
  customCode: string | null
}

export interface CreateOfferCodeParams {
  name: string
  numberOfCodes: number
  customCode?: string
}

// ============================================
// PRICING TYPES
// ============================================

export interface IAPPricePointInfo {
  id: string                      // App Store price point ID
  customerPrice: string           // e.g., "0.99"
  proceeds: string                // Developer proceeds
  priceTier: string              // Price tier identifier
}

export interface PriceEqualization {
  pricePointId: string           // Price point ID for this territory
  territory: string              // Territory code (e.g., "USA", "GBR")
  customerPrice: string
  proceeds: string
  priceTier?: string
}

export interface IAPPriceScheduleInfo {
  id: string | null
  baseTerritory: string | null
  manualPrices: Array<{
    id: string
    startDate: string | null
    pricePointId?: string
    territory?: string
  }>
}

export interface SubscriptionPricePointInfo {
  id: string
  customerPrice: string
  proceeds: string               // Developer proceeds year 1
  proceedsYear2: string          // Developer proceeds after year 1 (higher rate)
}

export interface TerritoryPrice {
  territory: string
  pricePointId: string
}

// ============================================
// IAP REVIEW SCREENSHOT TYPES
// ============================================

export interface IAPReviewScreenshotInfo {
  id: string
  fileName: string
  fileSize: number
  assetToken: string | null
  imageAsset: {
    templateUrl: string
    width: number
    height: number
  } | null
  assetDeliveryState: string | null
}

export interface SubscriptionImageInfo {
  id: string
  fileName: string
  fileSize: number
  assetToken: string | null
  imageAsset: {
    templateUrl: string
    width: number
    height: number
  } | null
  assetDeliveryState: string | null
}
