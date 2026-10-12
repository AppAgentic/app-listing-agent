import { adminDb } from '@/lib/firebase/admin'
import { configureAscMediaBackend } from '@/lib/services/asc-media-backend'
import { Timestamp } from 'firebase-admin/firestore'
import crypto from 'crypto'
import { AccountContext, getProjectContext } from '@/lib/org/context'
import { canMutateProject, PROJECT_MUTATION_FORBIDDEN } from '@/lib/org/project-authorization'
import { getAppStoreHelper } from '@/lib/services/credentials'
import { createReservationErrorResponse, refundUsage, reserveUsage, settleUsage } from '@/lib/api/usage'
import type {
  CustomProductPage,
  CPPLocalization,
  CPPScreenshotReference,
  IAPSyncStatus,
} from '@/lib/firebase/firestore'

// Helper to get basePath for a project (same as iap.ts pattern)
function getBasePath(projectContext: any, userId: string, projectId: string) {
  return projectContext.type === 'organization' && projectContext.orgId
    ? adminDb.collection('organizations').doc(projectContext.orgId).collection('projects').doc(projectId)
    : adminDb.collection('users').doc(userId).collection('projects').doc(projectId)
}

const LOCALE_RE = /^[a-z]{2,3}(-([A-Z]{2}|[A-Z][a-z]{3}))?$/

const ASC_DISPLAY_TYPE_MAPPING: Record<string, string> = {
  APP_IPHONE_69: 'APP_IPHONE_67',
  APP_IPHONE_67: 'APP_IPHONE_67',
  APP_IPHONE_65: 'APP_IPHONE_65',
  APP_IPHONE_63: 'APP_IPHONE_61',
  APP_IPHONE_61: 'APP_IPHONE_61',
  APP_IPHONE_55: 'APP_IPHONE_55',
  APP_IPAD_PRO_13: 'APP_IPAD_PRO_3GEN_129',
  APP_IPAD_PRO_129: 'APP_IPAD_PRO_3GEN_129',
  APP_IPAD_PRO_11: 'APP_IPAD_PRO_3GEN_11',
  APP_IPAD_PRO_3GEN_129: 'APP_IPAD_PRO_3GEN_129',
  APP_IPAD_PRO_3GEN_11: 'APP_IPAD_PRO_3GEN_11',
}

const VALID_DISPLAY_TYPES = new Set([
  ...Object.keys(ASC_DISPLAY_TYPE_MAPPING),
  ...Object.values(ASC_DISPLAY_TYPE_MAPPING),
])

const EDITABLE_CPP_VERSION_STATES = new Set([
  'PREPARE_FOR_SUBMISSION',
  'REJECTED',
])

function isValidLocale(locale: string): boolean {
  return LOCALE_RE.test(locale)
}

function normalizeDisplayType(displayType: string): string {
  return ASC_DISPLAY_TYPE_MAPPING[displayType] || displayType
}

function validateDisplayType(displayType: string): string | null {
  if (!VALID_DISPLAY_TYPES.has(displayType)) {
    return `Unsupported CPP screenshot display type: ${displayType}`
  }
  return null
}

async function fetchImageBuffer(imageUrl: string): Promise<{ buffer: Buffer; checksum: string }> {
  const response = await fetch(imageUrl)
  if (!response.ok) {
    throw new Error(`Failed to fetch image ${imageUrl}: HTTP ${response.status}`)
  }

  const buffer = Buffer.from(await response.arrayBuffer())
  if (buffer.length === 0) {
    throw new Error(`Fetched image is empty: ${imageUrl}`)
  }

  return {
    buffer,
    checksum: crypto.createHash('md5').update(buffer).digest('hex'),
  }
}

async function ensureEditableCPPVersion(
  helper: any,
  pageRef: FirebaseFirestore.DocumentReference,
  page: CustomProductPage,
  now: FirebaseFirestore.Timestamp
): Promise<string | null> {
  if (!page.appStoreId) return null

  const versions = await helper.listCPPVersions(page.appStoreId)
  const editable = versions.find((version: { state: string }) =>
    EDITABLE_CPP_VERSION_STATES.has(version.state)
  )

  if (editable) {
    await pageRef.collection('versions').doc(editable.id).set({
      appStoreId: editable.id,
      state: editable.state,
      deepLink: editable.deepLink || null,
      updatedAt: now,
    }, { merge: true })
    return editable.id
  }

  const created = await helper.createCPPVersion(page.appStoreId)
  await pageRef.collection('versions').doc(created.id).set({
    appStoreId: created.id,
    state: created.state,
    deepLink: null,
    createdAt: now,
    updatedAt: now,
  }, { merge: true })
  return created.id
}

async function getInitialLocalizationForCPPCreate(
  pageRef: FirebaseFirestore.DocumentReference
): Promise<{
  locale: string
  promotionalText?: string
  ref: FirebaseFirestore.DocumentReference
} | null> {
  const locSnap = await pageRef.collection('localizations').get()
  if (locSnap.empty) return null

  const initialDoc = locSnap.docs.find(doc => {
    const loc = doc.data() as CPPLocalization
    return (loc.locale || doc.id) === 'en-US'
  }) || locSnap.docs[0]

  const locData = initialDoc.data() as CPPLocalization
  const locale = locData.locale || initialDoc.id
  if (!isValidLocale(locale)) {
    throw new Error(`Invalid locale code: ${locale}`)
  }
  if (locData.promotionalText && locData.promotionalText.length > 170) {
    throw new Error(`Promotional text for ${locale} must be 170 characters or less`)
  }

  return {
    locale,
    promotionalText: locData.promotionalText || undefined,
    ref: initialDoc.ref,
  }
}

// ============================================
// List Custom Product Pages
// ============================================

export interface ListCustomProductPagesParams {
  projectId: string
}

export interface ListCustomProductPagesResult {
  success: boolean
  pages?: Array<CustomProductPage & { localizationCount?: number }>
  error?: string
}

export async function listCustomProductPages(
  params: ListCustomProductPagesParams,
  context: AccountContext
): Promise<ListCustomProductPagesResult> {
  const { projectId } = params

  const projectContext = await getProjectContext(context.userId, projectId)
  if (!projectContext) {
    return { success: false, error: 'Project not found' }
  }

  try {
    const basePath = getBasePath(projectContext, context.userId, projectId)
    const snapshot = await basePath.collection('customProductPages').orderBy('createdAt', 'desc').get()

    const pages = await Promise.all(snapshot.docs.map(async doc => {
      const locSnap = await doc.ref.collection('localizations').get()
      return {
        id: doc.id,
        ...doc.data(),
        localizationCount: locSnap.size,
      } as CustomProductPage & { localizationCount?: number }
    }))

    return { success: true, pages }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to list custom product pages' }
  }
}

// ============================================
// Create Custom Product Page
// ============================================

export interface CreateCustomProductPageParams {
  projectId: string
  name: string
  localizations?: Array<{
    locale: string
    promotionalText?: string
  }>
}

export interface CreateCustomProductPageResult {
  success: boolean
  page?: CustomProductPage
  error?: string
}

export async function createCustomProductPage(
  params: CreateCustomProductPageParams,
  context: AccountContext
): Promise<CreateCustomProductPageResult> {
  const { projectId, name, localizations } = params

  if (!name || name.length > 64) {
    return { success: false, error: 'Name is required and must be 64 characters or less' }
  }

  for (const loc of localizations || []) {
    if (!isValidLocale(loc.locale)) {
      return { success: false, error: `Invalid locale code: ${loc.locale}` }
    }
    if (loc.promotionalText && loc.promotionalText.length > 170) {
      return { success: false, error: `Promotional text for ${loc.locale} must be 170 characters or less` }
    }
  }

  const projectContext = await getProjectContext(context.userId, projectId)
  if (!projectContext) {
    return { success: false, error: 'Project not found' }
  }
  if (!canMutateProject(projectContext)) return { success: false, error: PROJECT_MUTATION_FORBIDDEN }

  try {
    const basePath = getBasePath(projectContext, context.userId, projectId)
    const now = Timestamp.now()

    const pageData: Omit<CustomProductPage, 'id'> = {
      appStoreId: null,
      name,
      url: null,
      state: null,
      syncStatus: 'pending_creation',
      createdAt: now,
      updatedAt: now,
    }

    const pageRef = basePath.collection('customProductPages').doc()
    const batch = adminDb.batch()
    batch.set(pageRef, pageData)

    // Add localizations if provided
    if (localizations?.length) {
      for (const loc of localizations) {
        const locRef = pageRef.collection('localizations').doc(loc.locale)
        const locData: CPPLocalization = {
          locale: loc.locale,
          promotionalText: loc.promotionalText || null,
          screenshots: [],
          appStoreLocalizationId: null,
        }
        batch.set(locRef, locData)
      }
    }

    await batch.commit()

    return {
      success: true,
      page: { id: pageRef.id, ...pageData } as CustomProductPage,
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to create custom product page' }
  }
}

// ============================================
// Update Custom Product Page
// ============================================

export interface UpdateCustomProductPageParams {
  projectId: string
  pageId: string
  name?: string
}

export interface UpdateCustomProductPageResult {
  success: boolean
  error?: string
}

export async function updateCustomProductPage(
  params: UpdateCustomProductPageParams,
  context: AccountContext
): Promise<UpdateCustomProductPageResult> {
  const { projectId, pageId, name } = params

  if (name && name.length > 64) {
    return { success: false, error: 'Name must be 64 characters or less' }
  }

  const projectContext = await getProjectContext(context.userId, projectId)
  if (!projectContext) {
    return { success: false, error: 'Project not found' }
  }
  if (!canMutateProject(projectContext)) return { success: false, error: PROJECT_MUTATION_FORBIDDEN }

  try {
    const basePath = getBasePath(projectContext, context.userId, projectId)
    const pageRef = basePath.collection('customProductPages').doc(pageId)
    const doc = await pageRef.get()
    if (!doc.exists) {
      return { success: false, error: 'Custom product page not found' }
    }

    const updates: any = { updatedAt: Timestamp.now() }
    if (name) updates.name = name

    const currentData = doc.data()
    if (currentData?.syncStatus === 'synced') {
      updates.syncStatus = 'local_changes'
    }

    await pageRef.update(updates)
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to update custom product page' }
  }
}

// ============================================
// Delete Custom Product Page
// ============================================

export interface DeleteCustomProductPageParams {
  projectId: string
  pageId: string
}

export interface DeleteCustomProductPageResult {
  success: boolean
  error?: string
}

export async function deleteCustomProductPage(
  params: DeleteCustomProductPageParams,
  context: AccountContext
): Promise<DeleteCustomProductPageResult> {
  const { projectId, pageId } = params

  const projectContext = await getProjectContext(context.userId, projectId)
  if (!projectContext) {
    return { success: false, error: 'Project not found' }
  }
  if (!canMutateProject(projectContext)) return { success: false, error: PROJECT_MUTATION_FORBIDDEN }

  try {
    const basePath = getBasePath(projectContext, context.userId, projectId)
    const pageRef = basePath.collection('customProductPages').doc(pageId)
    const doc = await pageRef.get()
    if (!doc.exists) {
      return { success: false, error: 'Custom product page not found' }
    }

    // Delete subcollections first
    const locSnap = await pageRef.collection('localizations').get()
    const versSnap = await pageRef.collection('versions').get()
    const batch = adminDb.batch()
    for (const d of locSnap.docs) batch.delete(d.ref)
    for (const d of versSnap.docs) batch.delete(d.ref)
    batch.delete(pageRef)
    await batch.commit()

    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to delete custom product page' }
  }
}

// ============================================
// Update CPP Localization
// ============================================

export interface UpdateCPPLocalizationParams {
  projectId: string
  pageId: string
  locale: string
  promotionalText?: string
}

export interface UpdateCPPLocalizationResult {
  success: boolean
  error?: string
}

export async function updateCPPLocalization(
  params: UpdateCPPLocalizationParams,
  context: AccountContext
): Promise<UpdateCPPLocalizationResult> {
  const { projectId, pageId, locale, promotionalText } = params

  if (promotionalText && promotionalText.length > 170) {
    return { success: false, error: 'Promotional text must be 170 characters or less' }
  }

  if (!isValidLocale(locale)) {
    return { success: false, error: `Invalid locale code: ${locale}` }
  }

  const projectContext = await getProjectContext(context.userId, projectId)
  if (!projectContext) {
    return { success: false, error: 'Project not found' }
  }
  if (!canMutateProject(projectContext)) return { success: false, error: PROJECT_MUTATION_FORBIDDEN }

  try {
    const basePath = getBasePath(projectContext, context.userId, projectId)
    const pageRef = basePath.collection('customProductPages').doc(pageId)
    const pageDoc = await pageRef.get()
    if (!pageDoc.exists) {
      return { success: false, error: 'Custom product page not found' }
    }

    const locRef = pageRef.collection('localizations').doc(locale)
    const locDoc = await locRef.get()

    if (locDoc.exists) {
      const updates: any = {}
      if (promotionalText !== undefined) updates.promotionalText = promotionalText
      await locRef.update(updates)
    } else {
      const locData: CPPLocalization = {
        locale,
        promotionalText: promotionalText || null,
        screenshots: [],
        appStoreLocalizationId: null,
      }
      await locRef.set(locData)
    }

    // Mark page as having local changes
    const currentData = pageDoc.data()
    if (currentData?.syncStatus === 'synced') {
      await pageRef.update({ syncStatus: 'local_changes', updatedAt: Timestamp.now() })
    }

    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to update CPP localization' }
  }
}

// ============================================
// Delete CPP Localization
// ============================================

export interface DeleteCPPLocalizationParams {
  projectId: string
  pageId: string
  locale: string
}

export interface DeleteCPPLocalizationResult {
  success: boolean
  error?: string
}

export async function deleteCPPLocalization(
  params: DeleteCPPLocalizationParams,
  context: AccountContext
): Promise<DeleteCPPLocalizationResult> {
  const { projectId, pageId, locale } = params

  const projectContext = await getProjectContext(context.userId, projectId)
  if (!projectContext) {
    return { success: false, error: 'Project not found' }
  }
  if (!canMutateProject(projectContext)) return { success: false, error: PROJECT_MUTATION_FORBIDDEN }

  try {
    const basePath = getBasePath(projectContext, context.userId, projectId)
    const pageRef = basePath.collection('customProductPages').doc(pageId)
    const pageDoc = await pageRef.get()
    if (!pageDoc.exists) {
      return { success: false, error: 'Custom product page not found' }
    }

    const locRef = pageRef.collection('localizations').doc(locale)
    const locDoc = await locRef.get()
    if (!locDoc.exists) {
      return { success: false, error: `Localization ${locale} not found` }
    }

    await locRef.delete()
    if (pageDoc.data()?.syncStatus === 'synced') {
      await pageRef.update({ syncStatus: 'local_changes', updatedAt: Timestamp.now() })
    }

    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to delete CPP localization' }
  }
}

// ============================================
// Sync Custom Product Pages (Pull/Push)
// ============================================

export interface SyncCustomProductPagesParams {
  __usageOperationId?: string
  projectId: string
  direction: 'pull' | 'push'
  confirmed?: boolean
  pageIds?: string[]
  locales?: string[]
  pushAll?: boolean
  force?: boolean
}

export interface SyncCustomProductPagesResult {
  success: boolean
  created?: string[]
  updated?: string[]
  preview?: Array<{ id: string; name: string; syncStatus: string; localizations: number; screenshots: number }>
  pushedLocalizations?: number
  pushedScreenshots?: number
  prunedScreenshotSets?: number
  warnings?: string[]
  errors?: Array<{ id: string; name?: string; error: string }>
  error?: string
}

async function pushPageContentToASC(params: {
  helper: any
  pageRef: FirebaseFirestore.DocumentReference
  page: CustomProductPage
  now: FirebaseFirestore.Timestamp
  locales?: string[]
}): Promise<{ localizations: number; screenshots: number; prunedScreenshotSets: number; warnings: string[] }> {
  const { helper, pageRef, page, now, locales } = params
  const locSnap = await pageRef.collection('localizations').get()

  if (locSnap.empty) {
    return { localizations: 0, screenshots: 0, prunedScreenshotSets: 0, warnings: ['No localizations configured'] }
  }

  const requestedLocales = locales?.length ? new Set(locales) : null
  const locDocs = requestedLocales
    ? locSnap.docs.filter(doc => requestedLocales.has((doc.data() as CPPLocalization).locale || doc.id))
    : locSnap.docs

  if (requestedLocales && locDocs.length === 0) {
    return {
      localizations: 0,
      screenshots: 0,
      prunedScreenshotSets: 0,
      warnings: [`No matching localizations configured for ${[...requestedLocales].join(', ')}`],
    }
  }

  const versionId = await ensureEditableCPPVersion(helper, pageRef, page, now)
  if (!versionId) {
    throw new Error('Could not create or find an editable Custom Product Page version')
  }
  const remoteLocalizations = await helper.listCPPLocalizations(versionId)
  const remoteLocalizationIds = new Map(
    remoteLocalizations.map((loc: { id: string; locale: string }) => [loc.locale, loc.id])
  )

  let pushedLocalizations = 0
  let pushedScreenshots = 0
  let prunedScreenshotSets = 0
  const warnings: string[] = []

  for (const locDoc of locDocs) {
    const locData = locDoc.data() as CPPLocalization
    const locale = locData.locale || locDoc.id

    if (!isValidLocale(locale)) {
      throw new Error(`Invalid locale code: ${locale}`)
    }
    if (locData.promotionalText && locData.promotionalText.length > 170) {
      throw new Error(`Promotional text for ${locale} must be 170 characters or less`)
    }

    let appStoreLocalizationId = remoteLocalizationIds.get(locale) || null
    if (!appStoreLocalizationId) {
      const createdLoc = await helper.createCPPLocalization(
        versionId,
        locale,
        locData.promotionalText || undefined
      )
      appStoreLocalizationId = createdLoc.id
      await locDoc.ref.update({ appStoreLocalizationId })
    } else {
      if (appStoreLocalizationId !== locData.appStoreLocalizationId) {
        await locDoc.ref.update({ appStoreLocalizationId })
      }
      await helper.updateCPPLocalization(appStoreLocalizationId, locData.promotionalText || '')
    }
    pushedLocalizations++

    const screenshots = [...(locData.screenshots || [])]
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))

    const grouped = new Map<string, CPPScreenshotReference[]>()
    for (const screenshot of screenshots) {
      const displayTypeError = validateDisplayType(screenshot.displayType)
      if (displayTypeError) throw new Error(displayTypeError)
      if (!screenshot.imageUrl) throw new Error(`Screenshot ${screenshot.id} is missing imageUrl`)
      if (!screenshot.fileName) throw new Error(`Screenshot ${screenshot.id} is missing fileName`)

      const ascDisplayType = normalizeDisplayType(screenshot.displayType)
      const existing = grouped.get(ascDisplayType) || []
      existing.push(screenshot)
      grouped.set(ascDisplayType, existing)
    }

    if (!appStoreLocalizationId && grouped.size > 0) {
      throw new Error(`Could not resolve App Store localization ID for ${locale}`)
    }
    const resolvedLocalizationId = appStoreLocalizationId as string

    const updatedScreenshots = screenshots.map(s => ({ ...s }))
    const intendedDisplayTypes = new Set(grouped.keys())
    for (const [ascDisplayType, group] of grouped.entries()) {
      const payload: Array<{ id: string; fileName: string; data: Buffer; checksum: string }> = []
      for (const screenshot of group) {
        const { buffer, checksum } = await fetchImageBuffer(screenshot.imageUrl)
        payload.push({
          id: screenshot.id,
          fileName: screenshot.fileName,
          data: buffer,
          checksum,
        })
      }

      const uploadResult = await helper.uploadCPPScreenshotSet(
        resolvedLocalizationId,
        ascDisplayType,
        payload
      )

      if (!uploadResult.success) {
        throw new Error(uploadResult.error || `Failed to upload ${ascDisplayType} screenshots for ${locale}`)
      }

      const screenshotIds = uploadResult.screenshotIds || []
      group.forEach((screenshot, index) => {
        const target = updatedScreenshots.find(s => s.id === screenshot.id)
        if (!target) return
        target.appStoreScreenshotId = screenshotIds[index] || null
        target.appStoreScreenshotSetId = uploadResult.screenshotSetId || null
        target.sourceFileChecksum = payload[index]?.checksum || null
        target.uploadedAt = now
      })

      pushedScreenshots += uploadResult.screenshotsUploaded || 0
    }

    if (intendedDisplayTypes.size > 0 && typeof helper.pruneCPPScreenshotSets === 'function') {
      const pruneResult = await helper.pruneCPPScreenshotSets(
        resolvedLocalizationId,
        [...intendedDisplayTypes]
      )
      if (!pruneResult.success) {
        throw new Error(pruneResult.error || `Failed to prune stale CPP screenshot sets for ${locale}`)
      }
      const deletedCount = pruneResult.deletedSetIds?.length || 0
      if (deletedCount > 0) {
        prunedScreenshotSets += deletedCount
        warnings.push(`${locale}: pruned ${deletedCount} stale copied screenshot set(s) not present locally`)
      }
    } else if (intendedDisplayTypes.size > 0) {
      warnings.push(`${locale}: helper cannot prune stale copied screenshot sets`)
    }

    if (updatedScreenshots.length > 0) {
      await locDoc.ref.update({ screenshots: updatedScreenshots })
    } else {
      warnings.push(`${locale}: no screenshots configured`)
    }
  }

  return {
    localizations: pushedLocalizations,
    screenshots: pushedScreenshots,
    prunedScreenshotSets,
    warnings,
  }
}

export async function syncCustomProductPages(
  params: SyncCustomProductPagesParams,
  context: AccountContext
): Promise<SyncCustomProductPagesResult> {
  const { projectId, direction, confirmed, pageIds, locales, pushAll, force } = params

  const projectContext = await getProjectContext(context.userId, projectId)
  if (!projectContext) {
    return { success: false, error: 'Project not found' }
  }
  if (!canMutateProject(projectContext)) return { success: false, error: PROJECT_MUTATION_FORBIDDEN }

  let publishingOperationId: string | null = null
  let providerChanged = false
  try {
    const basePath = getBasePath(projectContext, context.userId, projectId)
    const projectDoc = await basePath.get()
    const projectData = projectDoc.data()

    if (projectData?.storeType !== 'ios') {
      return { success: false, error: 'Custom Product Pages are only available for iOS projects' }
    }

    let helper
    try {
      helper = await getAppStoreHelper(
        context.userId,
        projectId,
        projectContext.type === 'organization' ? projectContext.orgId : undefined
      )
    } catch (error: any) {
      return { success: false, error: error.message || 'App Store credentials not configured' }
    }
    if (typeof projectData?.appStoreAppId === 'string') {
      configureAscMediaBackend(helper, projectData, projectData.appStoreAppId)
    }

    const now = Timestamp.now()
    const results: SyncCustomProductPagesResult = {
      success: true,
      created: [],
      updated: [],
      errors: [],
      pushedLocalizations: 0,
      pushedScreenshots: 0,
      prunedScreenshotSets: 0,
      warnings: [],
    }

    if (direction === 'pull') {
      // Pull CPPs from App Store Connect
      const remoteCPPs = await helper.listCustomProductPages()

      for (const remote of remoteCPPs) {
        try {
          // Check if we already have this CPP locally
          const existingQuery = await basePath.collection('customProductPages')
            .where('appStoreId', '==', remote.id).limit(1).get()

          const pageData: any = {
            appStoreId: remote.id,
            name: remote.name,
            url: remote.url,
            state: remote.state,
            syncStatus: 'synced' as IAPSyncStatus,
            updatedAt: now,
          }

          if (existingQuery.empty) {
            pageData.createdAt = now
            const newRef = basePath.collection('customProductPages').doc()
            await newRef.set(pageData)

            // Pull versions and localizations
            const versions = await helper.listCPPVersions(remote.id)
            for (const ver of versions) {
              const verRef = newRef.collection('versions').doc(ver.id)
              await verRef.set({
                appStoreId: ver.id,
                state: ver.state,
                deepLink: ver.deepLink,
                createdAt: now,
                updatedAt: now,
              })

              // Pull localizations for this version
              const locs = await helper.listCPPLocalizations(ver.id)
              for (const loc of locs) {
                await newRef.collection('localizations').doc(loc.locale).set({
                  locale: loc.locale,
                  promotionalText: loc.promotionalText,
                  screenshots: [],
                  appStoreLocalizationId: loc.id,
                })
              }
            }

            results.created!.push(remote.name)
          } else {
            await existingQuery.docs[0].ref.update(pageData)
            results.updated!.push(remote.name)
          }
        } catch (error: any) {
          results.errors!.push({ id: remote.id, error: error.message })
        }
      }
    } else {
      // Push CPPs to App Store Connect
      let pagesToProcess: Array<CustomProductPage & { ref: FirebaseFirestore.DocumentReference }> = []

      if (pageIds?.length) {
        for (const id of pageIds) {
          const doc = await basePath.collection('customProductPages').doc(id).get()
          if (doc.exists) {
            pagesToProcess.push({ id: doc.id, ref: doc.ref, ...doc.data() } as CustomProductPage & { ref: FirebaseFirestore.DocumentReference })
          }
        }
      } else if (pushAll || force) {
        const query = force
          ? basePath.collection('customProductPages')
          : basePath.collection('customProductPages').where('syncStatus', 'in', ['pending_creation', 'local_changes'])
        const snapshot = await query.get()
        pagesToProcess = snapshot.docs.map(doc => ({ id: doc.id, ref: doc.ref, ...doc.data() } as CustomProductPage & { ref: FirebaseFirestore.DocumentReference }))
      } else {
        const pendingQuery = await basePath.collection('customProductPages')
          .where('syncStatus', 'in', ['pending_creation', 'local_changes']).get()
        pagesToProcess = pendingQuery.docs.map(doc => ({ id: doc.id, ref: doc.ref, ...doc.data() } as CustomProductPage & { ref: FirebaseFirestore.DocumentReference }))
      }

      if (!confirmed) {
        const preview = []
        for (const page of pagesToProcess) {
          const locSnap = await page.ref.collection('localizations').get()
          let screenshotCount = 0
          for (const locDoc of locSnap.docs) {
            const loc = locDoc.data() as CPPLocalization
            screenshotCount += loc.screenshots?.length || 0
          }
          preview.push({
            id: page.id,
            name: page.name,
            syncStatus: page.syncStatus,
            localizations: locSnap.size,
            screenshots: screenshotCount,
          })
        }

        return {
          success: true,
          preview,
          error: preview.length === 0 ? 'No pending Custom Product Page changes to push' : undefined,
        }
      }

      publishingOperationId = params.__usageOperationId || `publish-custom-product-pages:${crypto.randomUUID()}`
      const reservation = await reserveUsage(context, {
        operationId: publishingOperationId,
        usageType: 'publishing',
        units: 1,
        metadata: { tool: 'sync_custom_product_pages', projectId },
      })
      if (!reservation.allowed) {
        const response = createReservationErrorResponse(reservation)
        const payload = await response.json()
        return { success: false, error: payload.message || 'Publishing limit reached' }
      }
      if (reservation.replayed) return { success: false, error: 'This publishing operation was already processed' }

      for (const page of pagesToProcess) {
        try {
          if (page.syncStatus === 'pending_creation' && !page.appStoreId) {
            const initialLocalization = await getInitialLocalizationForCPPCreate(page.ref)
            if (!initialLocalization) {
              throw new Error('At least one localization is required before creating a Custom Product Page in App Store Connect')
            }

            const created = await helper.createCustomProductPage(page.name, {
              locale: initialLocalization.locale,
              promotionalText: initialLocalization.promotionalText,
            })
            providerChanged = true
            await page.ref.update({
              appStoreId: created.id,
              url: created.url,
              state: created.state,
              syncStatus: 'local_changes',
              updatedAt: now,
            })
            if (created.versionId) {
              await page.ref.collection('versions').doc(created.versionId).set({
                appStoreId: created.versionId,
                state: created.versionState || 'PREPARE_FOR_SUBMISSION',
                deepLink: null,
                createdAt: now,
                updatedAt: now,
              }, { merge: true })
            }
            if (created.localizationId) {
              await initialLocalization.ref.update({ appStoreLocalizationId: created.localizationId })
            }
            page.appStoreId = created.id
            page.url = created.url
            page.state = created.state as any
          }

          if (page.appStoreId) {
            await helper.updateCustomProductPage(page.appStoreId, page.name)
            providerChanged = true
            const pushedContent = await pushPageContentToASC({
              helper,
              pageRef: page.ref,
              page,
              now,
              locales,
            })

            await page.ref.update({ syncStatus: 'synced', updatedAt: now })
            results.pushedLocalizations! += pushedContent.localizations
            results.pushedScreenshots! += pushedContent.screenshots
            results.prunedScreenshotSets! += pushedContent.prunedScreenshotSets
            results.warnings!.push(...pushedContent.warnings.map(warning => `${page.name}: ${warning}`))

            if (page.syncStatus === 'pending_creation') {
              results.created!.push(page.name)
            } else {
              results.updated!.push(page.name)
            }
          } else {
            results.errors!.push({ id: page.id, name: page.name, error: 'Missing App Store Custom Product Page ID' })
          }
        } catch (error: any) {
          results.errors!.push({ id: page.id, name: page.name, error: error.message })
        }
      }

      for (const fallback of helper.mediaReport?.().libraryFallbacks ?? []) {
        results.warnings!.push(`Asset Library unavailable for ${fallback.displayType}, used screenshot sets instead: ${fallback.error}`)
      }

      if (results.errors!.length > 0) {
        results.success = false
        results.error = `${results.errors!.length} Custom Product Page push error(s)`
      }

      const settledOperationId = publishingOperationId
      publishingOperationId = null
      await settleUsage(context, settledOperationId, 'publishing', providerChanged ? 1 : 0)
    }

    return results
  } catch (error) {
    if (publishingOperationId) {
      if (providerChanged) await settleUsage(context, publishingOperationId, 'publishing', 1)
      else await refundUsage(context, publishingOperationId, 'publishing')
    }
    return { success: false, error: error instanceof Error ? error.message : 'Sync failed' }
  }
}

// ============================================
// Upload CPP Screenshot
// ============================================

export interface UploadCPPScreenshotParams {
  projectId: string
  pageId: string
  locale: string
  displayType: string
  imageUrl: string
  imageKey?: string
  fileName: string
  fileSize?: number
}

export interface UploadCPPScreenshotResult {
  success: boolean
  screenshot?: CPPScreenshotReference
  error?: string
}

export async function uploadCPPScreenshot(
  params: UploadCPPScreenshotParams,
  context: AccountContext
): Promise<UploadCPPScreenshotResult> {
  const { projectId, pageId, locale, displayType, imageUrl, imageKey, fileName, fileSize } = params

  if (!isValidLocale(locale)) {
    return { success: false, error: `Invalid locale code: ${locale}` }
  }

  const displayTypeError = validateDisplayType(displayType)
  if (displayTypeError) {
    return { success: false, error: displayTypeError }
  }

  const projectContext = await getProjectContext(context.userId, projectId)
  if (!projectContext) {
    return { success: false, error: 'Project not found' }
  }
  if (!canMutateProject(projectContext)) return { success: false, error: PROJECT_MUTATION_FORBIDDEN }

  try {
    const basePath = getBasePath(projectContext, context.userId, projectId)
    const locRef = basePath.collection('customProductPages').doc(pageId).collection('localizations').doc(locale)
    const locDoc = await locRef.get()

    if (!locDoc.exists) {
      return { success: false, error: `Localization ${locale} not found for this custom product page` }
    }

    const locData = locDoc.data() as CPPLocalization
    const existingScreenshots = locData.screenshots || []
    const newScreenshot: CPPScreenshotReference = {
      id: `cpp_ss_${Date.now()}_${Math.random().toString(36).substring(7)}`,
      position: existingScreenshots.length,
      displayType,
      imageUrl,
      imageKey: imageKey || imageUrl,
      fileName,
      fileSize: fileSize || 0,
    }

    await locRef.update({
      screenshots: [...existingScreenshots, newScreenshot],
    })

    // Mark page as having local changes
    const pageRef = basePath.collection('customProductPages').doc(pageId)
    const pageDoc = await pageRef.get()
    if (pageDoc.exists && pageDoc.data()?.syncStatus === 'synced') {
      await pageRef.update({ syncStatus: 'local_changes', updatedAt: Timestamp.now() })
    }

    return { success: true, screenshot: newScreenshot }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to upload screenshot' }
  }
}

// ============================================
// Delete CPP Screenshot
// ============================================

export interface DeleteCPPScreenshotParams {
  projectId: string
  pageId: string
  locale: string
  screenshotId: string
}

export interface DeleteCPPScreenshotResult {
  success: boolean
  error?: string
}

export async function deleteCPPScreenshot(
  params: DeleteCPPScreenshotParams,
  context: AccountContext
): Promise<DeleteCPPScreenshotResult> {
  const { projectId, pageId, locale, screenshotId } = params

  const projectContext = await getProjectContext(context.userId, projectId)
  if (!projectContext) {
    return { success: false, error: 'Project not found' }
  }
  if (!canMutateProject(projectContext)) return { success: false, error: PROJECT_MUTATION_FORBIDDEN }

  try {
    const basePath = getBasePath(projectContext, context.userId, projectId)
    const locRef = basePath.collection('customProductPages').doc(pageId).collection('localizations').doc(locale)
    const locDoc = await locRef.get()

    if (!locDoc.exists) {
      return { success: false, error: `Localization ${locale} not found` }
    }

    const locData = locDoc.data() as CPPLocalization
    const updatedScreenshots = (locData.screenshots || [])
      .filter(s => s.id !== screenshotId)
      .map((s, i) => ({ ...s, position: i }))

    await locRef.update({ screenshots: updatedScreenshots })

    // Mark page as having local changes
    const pageRef = basePath.collection('customProductPages').doc(pageId)
    const pageDoc = await pageRef.get()
    if (pageDoc.exists && pageDoc.data()?.syncStatus === 'synced') {
      await pageRef.update({ syncStatus: 'local_changes', updatedAt: Timestamp.now() })
    }

    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to delete screenshot' }
  }
}
