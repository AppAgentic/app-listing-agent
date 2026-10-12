import { google } from 'googleapis'
import { IOS_TO_ANDROID_LOCALE_MAP, PLAYSTORE_LIMITS } from '../constants'
import type { ScreenshotDisplayType } from '@/lib/firebase/firestore'

// Map our display types to Google Play image types
const DISPLAY_TYPE_TO_IMAGE_TYPE: Partial<Record<ScreenshotDisplayType, string>> = {
  'PLAY_PHONE': 'phoneScreenshots',
  'PLAY_TABLET': 'sevenInchScreenshots', // Play Store uses this for tablet screenshots
  'PLAY_FEATURE_GRAPHIC': 'featureGraphic',
}

/**
 * Get the Play Store imageType for a given display type
 * Defaults to 'phoneScreenshots' for backwards compatibility
 */
function getPlayStoreImageType(displayType?: ScreenshotDisplayType): string {
  if (!displayType) return 'phoneScreenshots'
  return DISPLAY_TYPE_TO_IMAGE_TYPE[displayType] || 'phoneScreenshots'
}

export interface PlayStoreCredentials {
  packageName: string
  serviceAccountJson: string // JSON string of service account
}

// ============================================
// IAP TYPES
// ============================================

export interface Money {
  currencyCode: string
  units: string
  nanos: number
}

export interface PlayStoreProductInfo {
  sku: string
  status: string
  purchaseType: string
  defaultPrice: { priceMicros: string; currency: string }
  defaultLanguage: string
  listings: Record<string, { title: string; description: string; benefits?: string[] }>
  prices: Record<string, { priceMicros: string; currency: string }>
}

export interface PlayStoreSubscriptionInfo {
  productId: string
  packageName: string
  basePlans: Array<{
    basePlanId: string
    state: string
    autoRenewingBasePlanType?: {
      billingPeriodDuration: string
      gracePeriodDuration?: string
    }
    prepaidBasePlanType?: Record<string, unknown>
    regionalConfigs: Array<{
      regionCode: string
      newSubscriberAvailability: boolean
      price: Money
    }>
  }>
  listings: Array<{
    languageCode: string
    title: string
    description: string
    benefits?: string[]
  }>
}

export interface PlayStoreOfferInfo {
  productId: string
  basePlanId: string
  offerId: string
  state: string
  phases: Array<{
    recurrenceCount: number
    duration: string
    regionalConfigs: Array<{
      regionCode: string
      price?: Money
      relativeDiscount?: number
      absoluteDiscount?: Money
      free?: Record<string, unknown>
    }>
  }>
  targeting?: {
    acquisitionRule?: { scope: { scopeType: string } }
  }
}

export interface PlayStorePriceConversion {
  convertedPrices: Record<string, {
    regionCode: string
    price: Money
    taxAmount?: Money
  }>
}

// Helper: Convert USD to Google Money type
export function usdToMoney(usd: number): Money {
  const units = Math.floor(usd)
  const nanos = Math.round((usd - units) * 1e9)
  return { currencyCode: 'USD', units: String(units), nanos }
}

// Helper: Convert Google Money type to USD
export function moneyToUsd(money: Money): number {
  return Number(money.units) + money.nanos / 1e9
}

// Helper: Convert USD to priceMicros (legacy API)
export function usdToPriceMicros(usd: number): string {
  return String(Math.round(usd * 1e6))
}

// Helper: Convert priceMicros to USD (legacy API)
export function priceMicrosToUsd(micros: string): number {
  return Number(micros) / 1e6
}

export interface PlayStoreMetadata {
  locale: string
  title: string
  shortDescription: string
  fullDescription: string
}

export interface UploadResult {
  success: boolean
  locale: string
  error?: string
}

export interface PullResult {
  success: boolean
  metadata?: PlayStoreMetadata[]
  availableLocales?: string[]
  error?: string
}

export class PlayStoreHelper {
  private credentials: PlayStoreCredentials
  private androidPublisher: ReturnType<typeof google.androidpublisher>

  constructor(credentials: PlayStoreCredentials) {
    this.credentials = credentials

    const serviceAccount = JSON.parse(credentials.serviceAccountJson)
    const auth = new google.auth.GoogleAuth({
      credentials: serviceAccount,
      scopes: ['https://www.googleapis.com/auth/androidpublisher']
    })

    this.androidPublisher = google.androidpublisher({
      version: 'v3',
      auth
    })
  }

  /**
   * Convert iOS locale to Android locale
   */
  static convertLocale(iosLocale: string): string | null {
    return IOS_TO_ANDROID_LOCALE_MAP[iosLocale] || null
  }

  /**
   * Sanitize text for Play Store requirements
   */
  private sanitize(text: string, field: keyof typeof PLAYSTORE_LIMITS): string {
    if (!text) return text

    // Normalize Unicode to NFC
    let sanitized = text.normalize('NFC')

    // Remove emoji and pictographic symbols
    const emojiPattern = /[\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]|[\u{1F700}-\u{1F77F}]|[\u{1F780}-\u{1F7FF}]|[\u{1F800}-\u{1F8FF}]|[\u{1F900}-\u{1F9FF}]|[\u{1FA00}-\u{1FA6F}]|[\u{1FA70}-\u{1FAFF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/gu
    sanitized = sanitized.replace(emojiPattern, '')

    // Remove variation selectors and zero-width characters
    sanitized = sanitized.replace(/[\u200C\u200D\uFE0E\uFE0F]/g, '')

    // Collapse all whitespace to single spaces and trim
    sanitized = sanitized.replace(/\s+/g, ' ').trim()

    // Enforce field-specific limits
    const limit = PLAYSTORE_LIMITS[field]
    if (sanitized.length > limit) {
      sanitized = sanitized.substring(0, limit).trim()
    }

    return sanitized
  }

  /**
   * Commit an edit. Published apps with managed review auto-send for review
   * and reject changesNotSentForReview. Draft apps require it set to true.
   * Try without it first, then retry with it for draft apps.
   */
  private async commitEdit(editId: string): Promise<void> {
    try {
      // Try with changesNotSentForReview=true (required for draft apps
      // with managed publishing enabled)
      await this.androidPublisher.edits.commit({
        editId,
        packageName: this.credentials.packageName,
        changesNotSentForReview: true,
      })
    } catch (err: any) {
      const msg = String(err?.message || '')
      if (msg.includes('changesNotSentForReview must not be set')) {
        // Managed publishing is off — commit without the parameter
        await this.androidPublisher.edits.commit({
          editId,
          packageName: this.credentials.packageName,
        })
      } else {
        throw err
      }
    }
  }

  /**
   * Get all available listings (metadata) from Play Store
   */
  async getListings(locales?: string[]): Promise<PullResult> {
    try {
      // Create an edit (required for reading listings)
      const editResponse = await this.androidPublisher.edits.insert({
        packageName: this.credentials.packageName,
        requestBody: {}
      })

      const editId = editResponse.data.id!

      // List all available listings
      const listingsResponse = await this.androidPublisher.edits.listings.list({
        editId,
        packageName: this.credentials.packageName
      })

      const allListings = listingsResponse.data.listings || []

      // Filter by requested locales if provided
      const filteredListings = locales
        ? allListings.filter(l => l.language && locales.includes(l.language))
        : allListings

      // Map to PlayStoreMetadata format
      const metadata: PlayStoreMetadata[] = filteredListings.map(listing => ({
        locale: listing.language || '',
        title: listing.title || '',
        shortDescription: listing.shortDescription || '',
        fullDescription: listing.fullDescription || ''
      }))

      // Delete the edit (we're just reading, not committing changes)
      await this.androidPublisher.edits.delete({
        editId,
        packageName: this.credentials.packageName
      })

      return {
        success: true,
        metadata,
        availableLocales: allListings.map(l => l.language || '').filter(Boolean)
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }

  /**
   * Get available locales from Play Store
   */
  async getAvailableLocales(): Promise<string[]> {
    const result = await this.getListings()
    return result.availableLocales || []
  }

  /**
   * Upload metadata for a single locale
   */
  async uploadMetadata(metadata: PlayStoreMetadata): Promise<UploadResult> {
    try {
      // Create an edit
      const editResponse = await this.androidPublisher.edits.insert({
        packageName: this.credentials.packageName,
        requestBody: {}
      })

      const editId = editResponse.data.id!

      // Sanitize metadata
      const sanitizedTitle = this.sanitize(metadata.title, 'title')
      const sanitizedShort = this.sanitize(metadata.shortDescription, 'shortDescription')
      const sanitizedFull = this.sanitize(metadata.fullDescription, 'fullDescription')

      // Update listing
      await this.androidPublisher.edits.listings.update({
        editId,
        packageName: this.credentials.packageName,
        language: metadata.locale,
        requestBody: {
          title: sanitizedTitle,
          shortDescription: sanitizedShort,
          fullDescription: sanitizedFull
        }
      })

      // Commit the edit
      await this.commitEdit(editId)

      return { success: true, locale: metadata.locale }
    } catch (error) {
      return {
        success: false,
        locale: metadata.locale,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }

  /**
   * Upload metadata for multiple locales in a single edit (more efficient)
   */
  async uploadMetadataBatch(metadataList: PlayStoreMetadata[]): Promise<UploadResult[]> {
    const results: UploadResult[] = []

    try {
      // Create a single edit for all locales
      const editResponse = await this.androidPublisher.edits.insert({
        packageName: this.credentials.packageName,
        requestBody: {}
      })

      const editId = editResponse.data.id!

      // Update each locale
      for (const metadata of metadataList) {
        try {
          const sanitizedTitle = this.sanitize(metadata.title, 'title')
          const sanitizedShort = this.sanitize(metadata.shortDescription, 'shortDescription')
          const sanitizedFull = this.sanitize(metadata.fullDescription, 'fullDescription')

          await this.androidPublisher.edits.listings.update({
            editId,
            packageName: this.credentials.packageName,
            language: metadata.locale,
            requestBody: {
              title: sanitizedTitle,
              shortDescription: sanitizedShort,
              fullDescription: sanitizedFull
            }
          })

          results.push({ success: true, locale: metadata.locale })
        } catch (error) {
          results.push({
            success: false,
            locale: metadata.locale,
            error: error instanceof Error ? error.message : 'Unknown error'
          })
        }
      }

      // Commit the edit
      await this.commitEdit(editId)

      return results
    } catch (error) {
      // If edit creation fails, mark all as failed
      return metadataList.map(m => ({
        success: false,
        locale: m.locale,
        error: error instanceof Error ? error.message : 'Unknown error'
      }))
    }
  }

  /**
   * Upload screenshots for multiple locales
   */
  async uploadScreenshots(
    screenshots: Array<{
      locale: string
      filePath: string
      displayType?: ScreenshotDisplayType
    }>
  ): Promise<UploadResult[]> {
    const results: UploadResult[] = []

    try {
      // Create an edit
      const editResponse = await this.androidPublisher.edits.insert({
        packageName: this.credentials.packageName,
        requestBody: {}
      })

      const editId = editResponse.data.id!

      // Track which locale+imageType combos have been cleared
      const clearedLocaleImageTypes = new Set<string>()

      for (const screenshot of screenshots) {
        try {
          const imageType = getPlayStoreImageType(screenshot.displayType)
          const clearKey = `${screenshot.locale}-${imageType}`

          // Delete existing screenshots for this locale+imageType (only once per combo)
          if (!clearedLocaleImageTypes.has(clearKey)) {
            try {
              const existing = await this.androidPublisher.edits.images.list({
                editId,
                packageName: this.credentials.packageName,
                language: screenshot.locale,
                imageType,
              })

              if (existing.data.images && existing.data.images.length > 0) {
                await this.androidPublisher.edits.images.deleteall({
                  editId,
                  packageName: this.credentials.packageName,
                  language: screenshot.locale,
                  imageType,
                })
              }
            } catch {
              // Ignore errors when listing/deleting - locale might not exist yet
            }
            clearedLocaleImageTypes.add(clearKey)
          }

          // Upload new screenshot
          await this.androidPublisher.edits.images.upload({
            editId,
            packageName: this.credentials.packageName,
            language: screenshot.locale,
            imageType,
            media: {
              mimeType: 'image/png',
              body: require('fs').createReadStream(screenshot.filePath)
            }
          })

          results.push({ success: true, locale: screenshot.locale })
        } catch (error) {
          results.push({
            success: false,
            locale: screenshot.locale,
            error: error instanceof Error ? error.message : 'Unknown error'
          })
        }
      }

      // Commit the edit
      await this.commitEdit(editId)

      return results
    } catch (error) {
      return screenshots.map(s => ({
        success: false,
        locale: s.locale,
        error: error instanceof Error ? error.message : 'Unknown error'
      }))
    }
  }

  // ============================================
  // IN-APP PRODUCTS (legacy inappproducts API)
  // ============================================

  /**
   * List all in-app products (one-time / managed products)
   */
  async listProducts(): Promise<PlayStoreProductInfo[]> {
    const response = await this.androidPublisher.inappproducts.list({
      packageName: this.credentials.packageName,
    })
    const items = response.data.inappproduct || []
    // Filter to managed products only (excludes legacy subs)
    return items
      .filter((p: any) => p.purchaseType === 'managedUser' || !p.purchaseType)
      .map((p: any) => ({
        sku: p.sku || '',
        status: p.status || 'active',
        purchaseType: p.purchaseType || 'managedUser',
        defaultPrice: p.defaultPrice || { priceMicros: '0', currency: 'USD' },
        defaultLanguage: p.defaultLanguage || 'en-US',
        listings: p.listings || {},
        prices: p.prices || {},
      }))
  }

  /**
   * Get a single in-app product by SKU
   */
  async getProduct(sku: string): Promise<PlayStoreProductInfo | null> {
    try {
      const response = await this.androidPublisher.inappproducts.get({
        packageName: this.credentials.packageName,
        sku,
      })
      const p = response.data as any
      return {
        sku: p.sku || sku,
        status: p.status || 'active',
        purchaseType: p.purchaseType || 'managedUser',
        defaultPrice: p.defaultPrice || { priceMicros: '0', currency: 'USD' },
        defaultLanguage: p.defaultLanguage || 'en-US',
        listings: p.listings || {},
        prices: p.prices || {},
      }
    } catch (error: any) {
      if (error?.code === 404) return null
      throw error
    }
  }

  /**
   * Create a new in-app product
   */
  async createProduct(params: {
    sku: string
    defaultPrice: { priceMicros: string; currency: string }
    defaultLanguage: string
    listings: Record<string, { title: string; description: string }>
    prices?: Record<string, { priceMicros: string; currency: string }>
  }): Promise<PlayStoreProductInfo> {
    const response = await this.androidPublisher.inappproducts.insert({
      packageName: this.credentials.packageName,
      requestBody: {
        sku: params.sku,
        purchaseType: 'managedUser',
        status: 'active',
        defaultPrice: params.defaultPrice,
        defaultLanguage: params.defaultLanguage,
        listings: params.listings,
        prices: params.prices || {},
      },
    })
    const p = response.data as any
    return {
      sku: p.sku || params.sku,
      status: p.status || 'active',
      purchaseType: p.purchaseType || 'managedUser',
      defaultPrice: p.defaultPrice || params.defaultPrice,
      defaultLanguage: p.defaultLanguage || params.defaultLanguage,
      listings: p.listings || params.listings,
      prices: p.prices || {},
    }
  }

  /**
   * Update an existing in-app product
   */
  async updateProduct(sku: string, params: {
    defaultPrice?: { priceMicros: string; currency: string }
    listings?: Record<string, { title: string; description: string }>
    prices?: Record<string, { priceMicros: string; currency: string }>
  }): Promise<PlayStoreProductInfo> {
    // Fetch current to merge
    const current = await this.getProduct(sku)
    if (!current) throw new Error(`Product ${sku} not found`)

    const response = await this.androidPublisher.inappproducts.update({
      packageName: this.credentials.packageName,
      sku,
      requestBody: {
        sku,
        purchaseType: 'managedUser',
        status: current.status,
        defaultPrice: params.defaultPrice || current.defaultPrice,
        defaultLanguage: current.defaultLanguage,
        listings: params.listings || current.listings,
        prices: params.prices || current.prices,
      },
    })
    const p = response.data as any
    return {
      sku: p.sku || sku,
      status: p.status || 'active',
      purchaseType: p.purchaseType || 'managedUser',
      defaultPrice: p.defaultPrice || current.defaultPrice,
      defaultLanguage: p.defaultLanguage || current.defaultLanguage,
      listings: p.listings || current.listings,
      prices: p.prices || current.prices,
    }
  }

  /**
   * Delete an in-app product
   */
  async deleteProduct(sku: string): Promise<void> {
    await this.androidPublisher.inappproducts.delete({
      packageName: this.credentials.packageName,
      sku,
    })
  }

  // ============================================
  // SUBSCRIPTIONS (monetization API)
  // ============================================

  /**
   * List all subscriptions
   */
  async listSubscriptions(): Promise<PlayStoreSubscriptionInfo[]> {
    const results: PlayStoreSubscriptionInfo[] = []
    let pageToken: string | undefined

    do {
      const response = await (this.androidPublisher as any).monetization.subscriptions.list({
        packageName: this.credentials.packageName,
        pageToken,
      })
      const subs = response.data.subscriptions || []
      for (const s of subs) {
        results.push(this.mapSubscription(s))
      }
      pageToken = response.data.nextPageToken || undefined
    } while (pageToken)

    return results
  }

  /**
   * Get a single subscription
   */
  async getSubscription(productId: string): Promise<PlayStoreSubscriptionInfo | null> {
    try {
      const response = await (this.androidPublisher as any).monetization.subscriptions.get({
        packageName: this.credentials.packageName,
        productId,
      })
      return this.mapSubscription(response.data)
    } catch (error: any) {
      if (error?.code === 404) return null
      throw error
    }
  }

  /**
   * Get a single subscription's raw API response (for merge-then-patch operations).
   * Returns the raw basePlans array with all fields the API expects.
   */
  async getSubscriptionRaw(productId: string): Promise<any | null> {
    try {
      const response = await (this.androidPublisher as any).monetization.subscriptions.get({
        packageName: this.credentials.packageName,
        productId,
      })
      return response.data
    } catch (error: any) {
      if (error?.code === 404) return null
      throw error
    }
  }

  /**
   * Create a new subscription
   */
  async createSubscription(params: {
    productId: string
    listings: Array<{ languageCode: string; title: string; description: string; benefits?: string[] }>
    basePlans: Array<{
      basePlanId: string
      autoRenewingBasePlanType?: { billingPeriodDuration: string; gracePeriodDuration?: string }
      prepaidBasePlanType?: Record<string, unknown>
      regionalConfigs: Array<{
        regionCode: string
        newSubscriberAvailability: boolean
        price: Money
      }>
    }>
    regionsVersion?: string
  }): Promise<PlayStoreSubscriptionInfo> {
    const response = await (this.androidPublisher as any).monetization.subscriptions.create({
      packageName: this.credentials.packageName,
      productId: params.productId,
      'regionsVersion.version': params.regionsVersion || '2022/02',
      requestBody: {
        productId: params.productId,
        packageName: this.credentials.packageName,
        listings: params.listings,
        basePlans: params.basePlans,
      },
    })
    return this.mapSubscription(response.data)
  }

  /**
   * Update an existing subscription
   */
  async updateSubscription(productId: string, params: {
    listings?: Array<{ languageCode: string; title: string; description: string; benefits?: string[] }>
    basePlans?: Array<{
      basePlanId: string
      autoRenewingBasePlanType?: { billingPeriodDuration: string; gracePeriodDuration?: string }
      prepaidBasePlanType?: Record<string, unknown>
      regionalConfigs: Array<{
        regionCode: string
        newSubscriberAvailability: boolean
        price: Money
      }>
    }>
    regionsVersion?: string
  }): Promise<PlayStoreSubscriptionInfo> {
    const { regionsVersion, ...bodyParams } = params
    const updateMaskParts: string[] = []
    if (bodyParams.listings) updateMaskParts.push('listings')
    if (bodyParams.basePlans) updateMaskParts.push('basePlans')

    const updateMask = updateMaskParts.join(',')
    console.log(`[PlayStore] updateSubscription ${productId} updateMask=${updateMask} regionsVersion=${regionsVersion || '2022/02'}`)
    if (bodyParams.basePlans) {
      console.log(`[PlayStore] basePlans payload:`, JSON.stringify(bodyParams.basePlans.map((bp: any) => ({
        basePlanId: bp.basePlanId,
        hasAutoRenewing: !!bp.autoRenewingBasePlanType,
        hasPrepaid: !!bp.prepaidBasePlanType,
        regionalConfigsCount: bp.regionalConfigs?.length || 0,
        firstRegion: bp.regionalConfigs?.[0]?.regionCode,
        hasOtherRegionsConfig: !!bp.otherRegionsConfig,
        otherRegionsConfig: bp.otherRegionsConfig || null,
      }))))
    }

    try {
      const response = await (this.androidPublisher as any).monetization.subscriptions.patch({
        packageName: this.credentials.packageName,
        productId,
        updateMask,
        'regionsVersion.version': regionsVersion || '2022/02',
        requestBody: {
          productId,
          packageName: this.credentials.packageName,
          ...bodyParams,
        },
      })

      // Log the response to verify basePlans were applied
      const resultBasePlans = response.data?.basePlans || []
      console.log(`[PlayStore] updateSubscription response: ${resultBasePlans.length} base plans returned`)
      for (const bp of resultBasePlans) {
        console.log(`  ${bp.basePlanId}: state=${bp.state}, regionalConfigs=${bp.regionalConfigs?.length || 0}`)
      }

      return this.mapSubscription(response.data)
    } catch (error: any) {
      console.error(`[PlayStore] updateSubscription FAILED:`, error?.message || error)
      if (error?.response?.data) {
        console.error(`[PlayStore] API error details:`, JSON.stringify(error.response.data))
      }
      throw error
    }
  }

  // ============================================
  // BASE PLANS
  // ============================================

  /**
   * Activate a base plan (makes it available for purchase)
   */
  async activateBasePlan(productId: string, basePlanId: string): Promise<void> {
    await (this.androidPublisher as any).monetization.subscriptions.basePlans.activate({
      packageName: this.credentials.packageName,
      productId,
      basePlanId,
      requestBody: {},
    })
  }

  /**
   * Deactivate a base plan (no new subscribers, existing retain access)
   */
  async deactivateBasePlan(productId: string, basePlanId: string): Promise<void> {
    await (this.androidPublisher as any).monetization.subscriptions.basePlans.deactivate({
      packageName: this.credentials.packageName,
      productId,
      basePlanId,
      requestBody: {},
    })
  }

  // ============================================
  // SUBSCRIPTION OFFERS
  // ============================================

  /**
   * List offers for a base plan
   */
  async listOffers(productId: string, basePlanId: string): Promise<PlayStoreOfferInfo[]> {
    try {
      const response = await (this.androidPublisher as any).monetization.subscriptions.basePlans.offers.list({
        packageName: this.credentials.packageName,
        productId,
        basePlanId,
      })
      return (response.data.subscriptionOffers || []).map((o: any) => this.mapOffer(o))
    } catch (error: any) {
      if (error?.code === 404) return []
      throw error
    }
  }

  /**
   * Create a subscription offer
   */
  async createOffer(productId: string, basePlanId: string, params: {
    offerId: string
    phases: Array<{
      recurrenceCount: number
      duration: string
      regionalConfigs: Array<{
        regionCode: string
        price?: Money
        free?: Record<string, unknown>
        relativeDiscount?: number
      }>
      otherRegionsConfig?: {
        free?: Record<string, unknown>
        relativeDiscount?: number
      }
    }>
    regionalConfigs?: Array<{ regionCode: string; newSubscriberAvailability: boolean }>
    otherRegionsConfig?: { otherRegionsNewSubscriberAvailability: boolean }
    targeting?: { acquisitionRule?: { scope: { scopeType: string } } }
    regionsVersion?: string
  }): Promise<PlayStoreOfferInfo> {
    // Build offer-level regionalConfigs (availability) from phase-level regionalConfigs if not provided
    const offerRegionalConfigs = params.regionalConfigs
      || params.phases[0]?.regionalConfigs?.map(rc => ({ regionCode: rc.regionCode, newSubscriberAvailability: true }))
      || []

    const response = await (this.androidPublisher as any).monetization.subscriptions.basePlans.offers.create({
      packageName: this.credentials.packageName,
      productId,
      basePlanId,
      offerId: params.offerId,
      'regionsVersion.version': params.regionsVersion || '2022/02',
      requestBody: {
        productId,
        basePlanId,
        offerId: params.offerId,
        phases: params.phases,
        regionalConfigs: offerRegionalConfigs,
        ...(params.otherRegionsConfig ? { otherRegionsConfig: params.otherRegionsConfig } : {}),
        targeting: params.targeting,
      },
    })
    return this.mapOffer(response.data)
  }

  /**
   * Update a subscription offer
   */
  async updateOffer(productId: string, basePlanId: string, offerId: string, params: {
    phases?: Array<{
      recurrenceCount: number
      duration: string
      regionalConfigs: Array<{
        regionCode: string
        price?: Money
        free?: Record<string, unknown>
      }>
    }>
  }): Promise<PlayStoreOfferInfo> {
    const response = await (this.androidPublisher as any).monetization.subscriptions.basePlans.offers.patch({
      packageName: this.credentials.packageName,
      productId,
      basePlanId,
      offerId,
      updateMask: 'phases',
      'regionsVersion.version': '2022/02',
      requestBody: {
        productId,
        basePlanId,
        offerId,
        ...params,
      },
    })
    return this.mapOffer(response.data)
  }

  /**
   * Activate an offer
   */
  async activateOffer(productId: string, basePlanId: string, offerId: string): Promise<void> {
    await (this.androidPublisher as any).monetization.subscriptions.basePlans.offers.activate({
      packageName: this.credentials.packageName,
      productId,
      basePlanId,
      offerId,
      requestBody: {},
    })
  }

  /**
   * Deactivate an offer
   */
  async deactivateOffer(productId: string, basePlanId: string, offerId: string): Promise<void> {
    await (this.androidPublisher as any).monetization.subscriptions.basePlans.offers.deactivate({
      packageName: this.credentials.packageName,
      productId,
      basePlanId,
      offerId,
      requestBody: {},
    })
  }

  // ============================================
  // PRICING
  // ============================================

  /**
   * Convert a base USD price to all regional prices
   */
  async convertRegionPrices(basePriceUsd: number): Promise<Record<string, { price: Money; taxAmount?: Money }>> {
    const money = usdToMoney(basePriceUsd)
    const response = await (this.androidPublisher as any).monetization.convertRegionPrices({
      packageName: this.credentials.packageName,
      requestBody: {
        price: money,
      },
    })
    return response.data.convertedRegionPrices || {}
  }

  /**
   * Convert a base USD price and also return the "other regions" fallback prices.
   * Used for subscription base plans which support otherRegionsConfig.
   */
  async convertRegionPricesWithOther(basePriceUsd: number): Promise<{
    regionalPrices: Record<string, { price: Money; taxAmount?: Money }>
    otherRegionsPrice: { usdPrice: Money; eurPrice: Money } | null
    regionsVersion: string | null
  }> {
    const money = usdToMoney(basePriceUsd)
    const response = await (this.androidPublisher as any).monetization.convertRegionPrices({
      packageName: this.credentials.packageName,
      requestBody: {
        price: money,
      },
    })
    const regionalPrices = response.data.convertedRegionPrices || {}
    const otherRegions = response.data.convertedOtherRegionsPrice
    const regionsVersion = response.data.regionVersion?.version || null
    let otherRegionsPrice: { usdPrice: Money; eurPrice: Money } | null = null
    if (otherRegions) {
      otherRegionsPrice = {
        usdPrice: otherRegions.usdPrice || money,
        eurPrice: otherRegions.eurPrice || money,
      }
    }
    return { regionalPrices, otherRegionsPrice, regionsVersion }
  }

  // ============================================
  // PRIVATE HELPERS
  // ============================================

  private mapSubscription(s: any): PlayStoreSubscriptionInfo {
    return {
      productId: s.productId || '',
      packageName: s.packageName || this.credentials.packageName,
      basePlans: (s.basePlans || []).map((bp: any) => ({
        basePlanId: bp.basePlanId || '',
        state: bp.state || 'DRAFT',
        autoRenewingBasePlanType: bp.autoRenewingBasePlanType || undefined,
        prepaidBasePlanType: bp.prepaidBasePlanType || undefined,
        regionalConfigs: (bp.regionalConfigs || []).map((rc: any) => ({
          regionCode: rc.regionCode || '',
          newSubscriberAvailability: rc.newSubscriberAvailability ?? true,
          price: rc.price || { currencyCode: 'USD', units: '0', nanos: 0 },
        })),
      })),
      listings: (s.listings || []).map((l: any) => ({
        languageCode: l.languageCode || '',
        title: l.title || '',
        description: l.description || '',
        benefits: l.benefits || [],
      })),
    }
  }

  private mapOffer(o: any): PlayStoreOfferInfo {
    return {
      productId: o.productId || '',
      basePlanId: o.basePlanId || '',
      offerId: o.offerId || '',
      state: o.state || 'DRAFT',
      phases: (o.phases || []).map((p: any) => ({
        recurrenceCount: p.recurrenceCount || 0,
        duration: p.duration || '',
        regionalConfigs: (p.regionalConfigs || []).map((rc: any) => ({
          regionCode: rc.regionCode || '',
          price: rc.price || undefined,
          relativeDiscount: rc.relativeDiscount || undefined,
          absoluteDiscount: rc.absoluteDiscount || undefined,
          free: rc.free || undefined,
        })),
      })),
      targeting: o.targeting || undefined,
    }
  }

  // ============================================
  // SCREENSHOTS (existing methods below)
  // ============================================

  /**
   * Upload screenshots from buffers (for cloud environments)
   */
  async uploadScreenshotsFromBuffers(
    screenshots: Array<{
      locale: string
      fileName: string
      data: Buffer
      displayType?: ScreenshotDisplayType
    }>
  ): Promise<UploadResult[]> {
    const results: UploadResult[] = []
    const { Readable } = require('stream')

    try {
      // Create an edit
      const editResponse = await this.androidPublisher.edits.insert({
        packageName: this.credentials.packageName,
        requestBody: {}
      })

      const editId = editResponse.data.id!

      // Track which locale+imageType combos have been cleared
      const clearedLocaleImageTypes = new Set<string>()

      for (const screenshot of screenshots) {
        try {
          const imageType = getPlayStoreImageType(screenshot.displayType)
          const clearKey = `${screenshot.locale}-${imageType}`

          // Delete existing screenshots for this locale+imageType (only once per combo)
          if (!clearedLocaleImageTypes.has(clearKey)) {
            try {
              const existing = await this.androidPublisher.edits.images.list({
                editId,
                packageName: this.credentials.packageName,
                language: screenshot.locale,
                imageType,
              })

              if (existing.data.images && existing.data.images.length > 0) {
                await this.androidPublisher.edits.images.deleteall({
                  editId,
                  packageName: this.credentials.packageName,
                  language: screenshot.locale,
                  imageType,
                })
              }
            } catch {
              // Ignore errors
            }
            clearedLocaleImageTypes.add(clearKey)
          }

          // Convert buffer to readable stream
          const stream = Readable.from(screenshot.data)

          // Upload new screenshot
          await this.androidPublisher.edits.images.upload({
            editId,
            packageName: this.credentials.packageName,
            language: screenshot.locale,
            imageType,
            media: {
              mimeType: 'image/png',
              body: stream
            }
          })

          results.push({ success: true, locale: screenshot.locale })
        } catch (error) {
          results.push({
            success: false,
            locale: screenshot.locale,
            error: error instanceof Error ? error.message : 'Unknown error'
          })
        }
      }

      // Commit the edit
      await this.commitEdit(editId)

      return results
    } catch (error) {
      return screenshots.map(s => ({
        success: false,
        locale: s.locale,
        error: error instanceof Error ? error.message : 'Unknown error'
      }))
    }
  }

  /**
   * Pull images of a specific type from Google Play Store across locales.
   * Returns the image URLs for each locale that has the requested image type.
   */
  async pullImages(params: {
    imageType: string
    locales?: string[]
  }): Promise<Array<{ locale: string; imageUrls: string[] }>> {
    const editResponse = await this.androidPublisher.edits.insert({
      packageName: this.credentials.packageName,
      requestBody: {}
    })
    const editId = editResponse.data.id!

    try {
      // Get available locales if not specified
      const listingsResponse = await this.androidPublisher.edits.listings.list({
        editId,
        packageName: this.credentials.packageName,
      })
      const availableLocales = listingsResponse.data.listings?.map(l => l.language || '').filter(Boolean) || []
      const targetLocales = params.locales
        ? params.locales.filter(l => availableLocales.includes(l))
        : availableLocales

      const results: Array<{ locale: string; imageUrls: string[] }> = []

      for (const locale of targetLocales) {
        try {
          const imagesResponse = await this.androidPublisher.edits.images.list({
            editId,
            packageName: this.credentials.packageName,
            language: locale,
            imageType: params.imageType,
          })
          const imageUrls = (imagesResponse.data.images || [])
            .map(img => img.url || '')
            .filter(Boolean)
          if (imageUrls.length > 0) {
            results.push({ locale, imageUrls })
          }
        } catch {
          // Locale may not have this image type — skip
        }
      }

      return results
    } finally {
      // Delete read-only edit (don't commit changes)
      try {
        await this.androidPublisher.edits.delete({
          editId,
          packageName: this.credentials.packageName,
        })
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  // ============================================
  // CUSTOM STORE LISTINGS (CSL) METHODS
  // ============================================

  /**
   * List Custom Store Listings via edits API
   * Note: Uses raw HTTP since googleapis SDK may not have typed CSL methods
   */
  async listCustomStoreListings(): Promise<Array<{
    listingId: string
    name: string
    targetingType: string
    targetingCountries: string[]
  }>> {
    const editResponse = await this.androidPublisher.edits.insert({
      packageName: this.credentials.packageName,
      requestBody: {}
    })
    const editId = editResponse.data.id!

    try {
      const auth = this.androidPublisher.context._options.auth as any
      const accessToken = await auth.getAccessToken()
      const token = typeof accessToken === 'string' ? accessToken : accessToken?.token

      const url = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${this.credentials.packageName}/edits/${editId}/countryAvailability`
      // Custom store listings are available via the listings endpoint with countryTargeting
      // Fall back to edits.listings and filter for custom ones
      const listingsResponse = await this.androidPublisher.edits.listings.list({
        editId,
        packageName: this.credentials.packageName,
      })

      // For now, return standard listings info — CSL-specific API may need raw HTTP
      // The Google Play Developer API v3 exposes custom store listings differently
      // depending on the app's eligibility
      const listings = listingsResponse.data.listings || []
      return listings.map((l: any) => ({
        listingId: l.language || '',
        name: l.title || '',
        targetingType: 'COUNTRY',
        targetingCountries: [],
      }))
    } finally {
      try {
        await this.androidPublisher.edits.delete({
          editId,
          packageName: this.credentials.packageName,
        })
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  /**
   * Create a Custom Store Listing
   * Creates an edit, adds the listing, and commits
   */
  async createCustomStoreListing(params: {
    name: string
    language: string
    title: string
    shortDescription: string
    fullDescription: string
    targetingCountries?: string[]
  }): Promise<{ success: boolean; error?: string }> {
    const editResponse = await this.androidPublisher.edits.insert({
      packageName: this.credentials.packageName,
      requestBody: {}
    })
    const editId = editResponse.data.id!

    try {
      await this.androidPublisher.edits.listings.update({
        editId,
        packageName: this.credentials.packageName,
        language: params.language,
        requestBody: {
          language: params.language,
          title: this.sanitize(params.title, 'title'),
          shortDescription: this.sanitize(params.shortDescription, 'shortDescription'),
          fullDescription: this.sanitize(params.fullDescription, 'fullDescription'),
        }
      })

      await this.commitEdit(editId)
      return { success: true }
    } catch (error) {
      try {
        await this.androidPublisher.edits.delete({
          editId,
          packageName: this.credentials.packageName,
        })
      } catch { /* ignore */ }
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to create custom store listing',
      }
    }
  }

  /**
   * Update a Custom Store Listing
   */
  async updateCustomStoreListing(
    language: string,
    params: {
      title?: string
      shortDescription?: string
      fullDescription?: string
    }
  ): Promise<{ success: boolean; error?: string }> {
    const editResponse = await this.androidPublisher.edits.insert({
      packageName: this.credentials.packageName,
      requestBody: {}
    })
    const editId = editResponse.data.id!

    try {
      // Get existing listing first
      const existing = await this.androidPublisher.edits.listings.get({
        editId,
        packageName: this.credentials.packageName,
        language,
      })

      const updateBody: any = {
        language,
        title: params.title ? this.sanitize(params.title, 'title') : existing.data.title,
        shortDescription: params.shortDescription
          ? this.sanitize(params.shortDescription, 'shortDescription')
          : existing.data.shortDescription,
        fullDescription: params.fullDescription
          ? this.sanitize(params.fullDescription, 'fullDescription')
          : existing.data.fullDescription,
      }

      await this.androidPublisher.edits.listings.update({
        editId,
        packageName: this.credentials.packageName,
        language,
        requestBody: updateBody,
      })

      await this.commitEdit(editId)
      return { success: true }
    } catch (error) {
      try {
        await this.androidPublisher.edits.delete({
          editId,
          packageName: this.credentials.packageName,
        })
      } catch { /* ignore */ }
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update custom store listing',
      }
    }
  }

  /**
   * Delete a Custom Store Listing
   */
  async deleteCustomStoreListing(language: string): Promise<{ success: boolean; error?: string }> {
    const editResponse = await this.androidPublisher.edits.insert({
      packageName: this.credentials.packageName,
      requestBody: {}
    })
    const editId = editResponse.data.id!

    try {
      await this.androidPublisher.edits.listings.delete({
        editId,
        packageName: this.credentials.packageName,
        language,
      })

      await this.commitEdit(editId)
      return { success: true }
    } catch (error) {
      try {
        await this.androidPublisher.edits.delete({
          editId,
          packageName: this.credentials.packageName,
        })
      } catch { /* ignore */ }
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete custom store listing',
      }
    }
  }

  /**
   * Get localizations for a Custom Store Listing
   */
  async getCSLLocalizations(): Promise<Array<{
    language: string
    title: string
    shortDescription: string
    fullDescription: string
  }>> {
    const editResponse = await this.androidPublisher.edits.insert({
      packageName: this.credentials.packageName,
      requestBody: {}
    })
    const editId = editResponse.data.id!

    try {
      const response = await this.androidPublisher.edits.listings.list({
        editId,
        packageName: this.credentials.packageName,
      })

      return (response.data.listings || []).map((l: any) => ({
        language: l.language || '',
        title: l.title || '',
        shortDescription: l.shortDescription || '',
        fullDescription: l.fullDescription || '',
      }))
    } finally {
      try {
        await this.androidPublisher.edits.delete({
          editId,
          packageName: this.credentials.packageName,
        })
      } catch { /* ignore */ }
    }
  }

  /**
   * Upload a screenshot for a Custom Store Listing
   */
  async uploadCSLScreenshot(params: {
    language: string
    imageType: 'phoneScreenshots' | 'sevenInchScreenshots' | 'tenInchScreenshots'
    filePath: string
  }): Promise<{ success: boolean; error?: string }> {
    const editResponse = await this.androidPublisher.edits.insert({
      packageName: this.credentials.packageName,
      requestBody: {}
    })
    const editId = editResponse.data.id!

    try {
      await this.androidPublisher.edits.images.upload({
        editId,
        packageName: this.credentials.packageName,
        language: params.language,
        imageType: params.imageType,
        media: {
          mimeType: 'image/png',
          body: require('fs').createReadStream(params.filePath),
        }
      })

      await this.commitEdit(editId)
      return { success: true }
    } catch (error) {
      try {
        await this.androidPublisher.edits.delete({
          editId,
          packageName: this.credentials.packageName,
        })
      } catch { /* ignore */ }
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to upload CSL screenshot',
      }
    }
  }

  /**
   * Upload an icon for a Custom Store Listing
   */
  async uploadCSLIcon(params: {
    language: string
    filePath: string
  }): Promise<{ success: boolean; error?: string }> {
    const editResponse = await this.androidPublisher.edits.insert({
      packageName: this.credentials.packageName,
      requestBody: {}
    })
    const editId = editResponse.data.id!

    try {
      await this.androidPublisher.edits.images.upload({
        editId,
        packageName: this.credentials.packageName,
        language: params.language,
        imageType: 'icon',
        media: {
          mimeType: 'image/png',
          body: require('fs').createReadStream(params.filePath),
        }
      })

      await this.commitEdit(editId)
      return { success: true }
    } catch (error) {
      try {
        await this.androidPublisher.edits.delete({
          editId,
          packageName: this.credentials.packageName,
        })
      } catch { /* ignore */ }
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to upload CSL icon',
      }
    }
  }

  /**
   * Update localization text for a Custom Store Listing
   */
  async updateCSLLocalization(language: string, params: {
    title?: string
    shortDescription?: string
    fullDescription?: string
  }): Promise<{ success: boolean; error?: string }> {
    const editResponse = await this.androidPublisher.edits.insert({
      packageName: this.credentials.packageName,
      requestBody: {}
    })
    const editId = editResponse.data.id!

    try {
      await this.androidPublisher.edits.listings.update({
        editId,
        packageName: this.credentials.packageName,
        language,
        requestBody: {
          language,
          ...(params.title !== undefined && { title: params.title }),
          ...(params.shortDescription !== undefined && { shortDescription: params.shortDescription }),
          ...(params.fullDescription !== undefined && { fullDescription: params.fullDescription }),
        }
      })

      await this.commitEdit(editId)
      return { success: true }
    } catch (error) {
      try {
        await this.androidPublisher.edits.delete({
          editId,
          packageName: this.credentials.packageName,
        })
      } catch { /* ignore */ }
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update CSL localization',
      }
    }
  }
}
