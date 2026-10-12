/**
 * Custom Store Listings (Android) MCP Tools
 * MCP tools for managing Google Play Custom Store Listings
 */

import { adminDb } from '@/lib/firebase/admin'
import { Timestamp } from 'firebase-admin/firestore'
import { AccountContext, getProjectContext, hasContextPermission } from '@/lib/org/context'
import { canMutateProject, PROJECT_MUTATION_FORBIDDEN } from '@/lib/org/project-authorization'
import { PlayStoreHelper } from '@/lib/services/playstore'
import { decryptPlayStoreCredentials } from '@/lib/crypto/credentials'
import { getProjectBasePath } from './playstore-iap'
import { createReservationErrorResponse, refundUsage, reserveUsage, settleUsage } from '@/lib/api/usage'
import crypto from 'node:crypto'
import type {
  CustomStoreListing,
  CSLLocalization,
  CSLScreenshotReference,
  CSLTargetingType,
  IAPSyncStatus,
} from '@/lib/firebase/firestore'

// Helper: Get Play Store credentials + helper (same as playstore-iap.ts)
async function getPlayStoreHelper(userId: string, projectId: string) {
  const result = await getProjectBasePath(userId, projectId)
  if (!result) return null

  const { basePath, projectContext } = result

  if (!hasContextPermission(projectContext, 'canCreateProjects')) {
    return null
  }

  const accountCredentialsPath = projectContext.type === 'organization' && projectContext.orgId
    ? adminDb.collection('organizations').doc(projectContext.orgId).collection('credentials')
    : adminDb.collection('users').doc(userId).collection('credentials')
  const credentialsDoc = await accountCredentialsPath.doc('playstore').get()
  if (!credentialsDoc.exists) return null

  const encryptedCreds = credentialsDoc.data()!
  const credentials = await decryptPlayStoreCredentials({
    encryptedData: encryptedCreds.encryptedData,
    encryptedDek: encryptedCreds.encryptedDek,
    keyVersion: encryptedCreds.keyVersion,
  })

  const projectDoc = await basePath.get()
  const projectData = projectDoc.data()
  const packageName = projectData?.playStorePackage || credentials.packageName

  const helper = new PlayStoreHelper({ packageName, serviceAccountJson: credentials.serviceAccountJson })

  return { helper, basePath, projectContext }
}

// Helper to get basePath for a project
function getBasePath(projectContext: any, userId: string, projectId: string) {
  return projectContext.type === 'organization' && projectContext.orgId
    ? adminDb.collection('organizations').doc(projectContext.orgId).collection('projects').doc(projectId)
    : adminDb.collection('users').doc(userId).collection('projects').doc(projectId)
}

// ============================================
// List Custom Store Listings
// ============================================

export interface ListCustomStoreListingsParams {
  projectId: string
}

export interface ListCustomStoreListingsResult {
  success: boolean
  listings?: Array<CustomStoreListing & { localizationCount?: number }>
  error?: string
}

export async function listCustomStoreListings(
  params: ListCustomStoreListingsParams,
  context: AccountContext
): Promise<ListCustomStoreListingsResult> {
  const { projectId } = params

  const projectContext = await getProjectContext(context.userId, projectId)
  if (!projectContext) {
    return { success: false, error: 'Project not found' }
  }

  try {
    const basePath = getBasePath(projectContext, context.userId, projectId)
    const snapshot = await basePath.collection('customStoreListings').orderBy('createdAt', 'desc').get()

    const listings = await Promise.all(snapshot.docs.map(async doc => {
      const locSnap = await doc.ref.collection('localizations').get()
      return {
        id: doc.id,
        ...doc.data(),
        localizationCount: locSnap.size,
      } as CustomStoreListing & { localizationCount?: number }
    }))

    return { success: true, listings }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to list custom store listings' }
  }
}

// ============================================
// Create Custom Store Listing
// ============================================

export interface CreateCustomStoreListingParams {
  projectId: string
  name: string
  targetingType?: CSLTargetingType
  targetingCountries?: string[]
  localizations?: Array<{
    locale: string
    title: string
    shortDescription?: string
    fullDescription?: string
  }>
}

export interface CreateCustomStoreListingResult {
  success: boolean
  listing?: CustomStoreListing
  error?: string
}

export async function createCustomStoreListing(
  params: CreateCustomStoreListingParams,
  context: AccountContext
): Promise<CreateCustomStoreListingResult> {
  const { projectId, name, targetingType = 'COUNTRY', targetingCountries = [], localizations } = params

  if (!name) {
    return { success: false, error: 'Name is required' }
  }

  const projectContext = await getProjectContext(context.userId, projectId)
  if (!projectContext) {
    return { success: false, error: 'Project not found' }
  }
  if (!canMutateProject(projectContext)) return { success: false, error: PROJECT_MUTATION_FORBIDDEN }

  try {
    const basePath = getBasePath(projectContext, context.userId, projectId)
    const now = Timestamp.now()

    const listingData: Omit<CustomStoreListing, 'id'> = {
      playStoreId: null,
      name,
      targetingType,
      targetingCountries,
      syncStatus: 'pending_creation',
      createdAt: now,
      updatedAt: now,
    }

    const listingRef = basePath.collection('customStoreListings').doc()
    const batch = adminDb.batch()
    batch.set(listingRef, listingData)

    if (localizations?.length) {
      for (const loc of localizations) {
        const locRef = listingRef.collection('localizations').doc(loc.locale)
        const locData: CSLLocalization = {
          locale: loc.locale,
          title: loc.title || '',
          shortDescription: loc.shortDescription || '',
          fullDescription: loc.fullDescription || '',
          iconUrl: null,
          iconKey: null,
          featureGraphicUrl: null,
          featureGraphicKey: null,
          videoUrl: null,
          screenshots: [],
        }
        batch.set(locRef, locData)
      }
    }

    await batch.commit()

    return {
      success: true,
      listing: { id: listingRef.id, ...listingData } as CustomStoreListing,
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to create custom store listing' }
  }
}

// ============================================
// Update Custom Store Listing
// ============================================

export interface UpdateCustomStoreListingParams {
  projectId: string
  listingId: string
  name?: string
  targetingType?: CSLTargetingType
  targetingCountries?: string[]
}

export interface UpdateCustomStoreListingResult {
  success: boolean
  error?: string
}

export async function updateCustomStoreListing(
  params: UpdateCustomStoreListingParams,
  context: AccountContext
): Promise<UpdateCustomStoreListingResult> {
  const { projectId, listingId, name, targetingType, targetingCountries } = params

  const projectContext = await getProjectContext(context.userId, projectId)
  if (!projectContext) {
    return { success: false, error: 'Project not found' }
  }
  if (!canMutateProject(projectContext)) return { success: false, error: PROJECT_MUTATION_FORBIDDEN }

  try {
    const basePath = getBasePath(projectContext, context.userId, projectId)
    const listingRef = basePath.collection('customStoreListings').doc(listingId)
    const doc = await listingRef.get()
    if (!doc.exists) {
      return { success: false, error: 'Custom store listing not found' }
    }

    const updates: any = { updatedAt: Timestamp.now() }
    if (name) updates.name = name
    if (targetingType) updates.targetingType = targetingType
    if (targetingCountries) updates.targetingCountries = targetingCountries

    const currentData = doc.data()
    if (currentData?.syncStatus === 'synced') {
      updates.syncStatus = 'local_changes'
    }

    await listingRef.update(updates)
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to update custom store listing' }
  }
}

// ============================================
// Delete Custom Store Listing
// ============================================

export interface DeleteCustomStoreListingParams {
  projectId: string
  listingId: string
}

export interface DeleteCustomStoreListingResult {
  success: boolean
  error?: string
}

export async function deleteCustomStoreListing(
  params: DeleteCustomStoreListingParams,
  context: AccountContext
): Promise<DeleteCustomStoreListingResult> {
  const { projectId, listingId } = params

  const projectContext = await getProjectContext(context.userId, projectId)
  if (!projectContext) {
    return { success: false, error: 'Project not found' }
  }
  if (!canMutateProject(projectContext)) return { success: false, error: PROJECT_MUTATION_FORBIDDEN }

  try {
    const basePath = getBasePath(projectContext, context.userId, projectId)
    const listingRef = basePath.collection('customStoreListings').doc(listingId)
    const doc = await listingRef.get()
    if (!doc.exists) {
      return { success: false, error: 'Custom store listing not found' }
    }

    // Delete subcollections first
    const locSnap = await listingRef.collection('localizations').get()
    const batch = adminDb.batch()
    for (const d of locSnap.docs) batch.delete(d.ref)
    batch.delete(listingRef)
    await batch.commit()

    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to delete custom store listing' }
  }
}

// ============================================
// Update CSL Localization
// ============================================

export interface UpdateCSLLocalizationParams {
  projectId: string
  listingId: string
  locale: string
  title?: string
  shortDescription?: string
  fullDescription?: string
}

export interface UpdateCSLLocalizationResult {
  success: boolean
  error?: string
}

export async function updateCSLLocalization(
  params: UpdateCSLLocalizationParams,
  context: AccountContext
): Promise<UpdateCSLLocalizationResult> {
  const { projectId, listingId, locale, title, shortDescription, fullDescription } = params

  if (title && title.length > 30) {
    return { success: false, error: 'Title must be 30 characters or less' }
  }
  if (shortDescription && shortDescription.length > 80) {
    return { success: false, error: 'Short description must be 80 characters or less' }
  }
  if (fullDescription && fullDescription.length > 4000) {
    return { success: false, error: 'Full description must be 4000 characters or less' }
  }

  const projectContext = await getProjectContext(context.userId, projectId)
  if (!projectContext) {
    return { success: false, error: 'Project not found' }
  }
  if (!canMutateProject(projectContext)) return { success: false, error: PROJECT_MUTATION_FORBIDDEN }

  try {
    const basePath = getBasePath(projectContext, context.userId, projectId)
    const listingRef = basePath.collection('customStoreListings').doc(listingId)
    const listingDoc = await listingRef.get()
    if (!listingDoc.exists) {
      return { success: false, error: 'Custom store listing not found' }
    }

    const locRef = listingRef.collection('localizations').doc(locale)
    const locDoc = await locRef.get()

    if (locDoc.exists) {
      const updates: any = {}
      if (title !== undefined) updates.title = title
      if (shortDescription !== undefined) updates.shortDescription = shortDescription
      if (fullDescription !== undefined) updates.fullDescription = fullDescription
      await locRef.update(updates)
    } else {
      const locData: CSLLocalization = {
        locale,
        title: title || '',
        shortDescription: shortDescription || '',
        fullDescription: fullDescription || '',
        iconUrl: null,
        iconKey: null,
        featureGraphicUrl: null,
        featureGraphicKey: null,
        videoUrl: null,
        screenshots: [],
      }
      await locRef.set(locData)
    }

    // Mark listing as having local changes
    const currentData = listingDoc.data()
    if (currentData?.syncStatus === 'synced') {
      await listingRef.update({ syncStatus: 'local_changes', updatedAt: Timestamp.now() })
    }

    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to update CSL localization' }
  }
}

// ============================================
// Sync Custom Store Listings (Pull/Push)
// ============================================

export interface SyncCustomStoreListingsParams {
  __usageOperationId?: string
  projectId: string
  direction: 'pull' | 'push'
  confirmed?: boolean
}

export interface SyncCustomStoreListingsResult {
  success: boolean
  created?: string[]
  updated?: string[]
  errors?: Array<{ id: string; error: string }>
  error?: string
}

export async function syncCustomStoreListings(
  params: SyncCustomStoreListingsParams,
  context: AccountContext
): Promise<SyncCustomStoreListingsResult> {
  const { projectId, direction, confirmed } = params

  const helperResult = await getPlayStoreHelper(context.userId, projectId)
  if (!helperResult) {
    return { success: false, error: 'Play Store credentials not configured or permission denied' }
  }
  const { helper, basePath } = helperResult

  let publishingOperationId: string | null = null
  let providerChanged = false
  try {
    const projectDoc = await basePath.get()
    const projectData = projectDoc.data()

    if (projectData?.storeType !== 'android') {
      return { success: false, error: 'Custom Store Listings are only available for Android projects' }
    }

    const now = Timestamp.now()
    const results: SyncCustomStoreListingsResult = { success: true, created: [], updated: [], errors: [] }

    if (direction === 'pull') {
      // Pull listings from Play Store
      const remoteLocs = await helper.getCSLLocalizations()

      for (const remote of remoteLocs) {
        try {
          // Check if we already have this listing locally by language
          const existingQuery = await basePath.collection('customStoreListings')
            .where('playStoreId', '==', remote.language).limit(1).get()

          if (existingQuery.empty) {
            // Create new local listing
            const listingData: Omit<CustomStoreListing, 'id'> = {
              playStoreId: remote.language,
              name: remote.title || remote.language,
              targetingType: 'COUNTRY',
              targetingCountries: [],
              syncStatus: 'synced',
              createdAt: now,
              updatedAt: now,
            }
            const newRef = basePath.collection('customStoreListings').doc()
            await newRef.set(listingData)

            // Save localization
            const locData: CSLLocalization = {
              locale: remote.language,
              title: remote.title,
              shortDescription: remote.shortDescription,
              fullDescription: remote.fullDescription,
              iconUrl: null,
              iconKey: null,
              featureGraphicUrl: null,
              featureGraphicKey: null,
              videoUrl: null,
              screenshots: [],
            }
            await newRef.collection('localizations').doc(remote.language).set(locData)
            results.created!.push(remote.title || remote.language)
          } else {
            // Update existing
            const existingRef = existingQuery.docs[0].ref
            await existingRef.update({ syncStatus: 'synced', updatedAt: now })

            const locRef = existingRef.collection('localizations').doc(remote.language)
            await locRef.set({
              locale: remote.language,
              title: remote.title,
              shortDescription: remote.shortDescription,
              fullDescription: remote.fullDescription,
            }, { merge: true })
            results.updated!.push(remote.title || remote.language)
          }
        } catch (error: any) {
          results.errors!.push({ id: remote.language, error: error.message })
        }
      }
    } else {
      // Push listings to Play Store
      if (!confirmed) {
        return { success: false, error: 'Push requires confirmation. Set confirmed=true to proceed.' }
      }

      publishingOperationId = params.__usageOperationId || `publish-custom-store-listings:${crypto.randomUUID()}`
      const reservation = await reserveUsage(context, {
        operationId: publishingOperationId,
        usageType: 'publishing',
        units: 1,
        metadata: { tool: 'sync_custom_store_listings', projectId },
      })
      if (!reservation.allowed) {
        const response = createReservationErrorResponse(reservation)
        const payload = await response.json()
        return { success: false, error: payload.message || 'Publishing limit reached' }
      }
      if (reservation.replayed) return { success: false, error: 'This publishing operation was already processed' }

      const pendingQuery = await basePath.collection('customStoreListings')
        .where('syncStatus', 'in', ['pending_creation', 'local_changes']).get()

      for (const doc of pendingQuery.docs) {
        const listing = { id: doc.id, ...doc.data() } as CustomStoreListing
        try {
          // Get the first localization for this listing
          const locSnap = await doc.ref.collection('localizations').limit(1).get()
          if (locSnap.empty) {
            results.errors!.push({ id: listing.id, error: 'No localizations configured' })
            continue
          }
          const locData = locSnap.docs[0].data() as CSLLocalization

          if (listing.syncStatus === 'pending_creation') {
            const result = await helper.createCustomStoreListing({
              name: listing.name,
              language: locData.locale,
              title: locData.title,
              shortDescription: locData.shortDescription,
              fullDescription: locData.fullDescription,
              targetingCountries: listing.targetingCountries,
            })
            if (result.success) {
              providerChanged = true
              await doc.ref.update({
                playStoreId: locData.locale,
                syncStatus: 'synced',
                updatedAt: now,
              })
              results.created!.push(listing.name)
            } else {
              results.errors!.push({ id: listing.id, error: result.error || 'Creation failed' })
            }
          } else {
            const result = await helper.updateCustomStoreListing(locData.locale, {
              title: locData.title,
              shortDescription: locData.shortDescription,
              fullDescription: locData.fullDescription,
            })
            if (result.success) {
              providerChanged = true
              await doc.ref.update({ syncStatus: 'synced', updatedAt: now })
              results.updated!.push(listing.name)
            } else {
              results.errors!.push({ id: listing.id, error: result.error || 'Update failed' })
            }
          }
        } catch (error: any) {
          results.errors!.push({ id: listing.id, error: error.message })
        }
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
// Upload CSL Screenshot
// ============================================

export interface UploadCSLScreenshotParams {
  projectId: string
  listingId: string
  locale: string
  imageType: 'phone' | '7inch' | '10inch'
  imageUrl: string
  imageKey: string
  fileName: string
  fileSize: number
}

export interface UploadCSLScreenshotResult {
  success: boolean
  screenshot?: CSLScreenshotReference
  error?: string
}

export async function uploadCSLScreenshot(
  params: UploadCSLScreenshotParams,
  context: AccountContext
): Promise<UploadCSLScreenshotResult> {
  const { projectId, listingId, locale, imageType, imageUrl, imageKey, fileName, fileSize } = params

  const projectContext = await getProjectContext(context.userId, projectId)
  if (!projectContext) {
    return { success: false, error: 'Project not found' }
  }
  if (!canMutateProject(projectContext)) return { success: false, error: PROJECT_MUTATION_FORBIDDEN }

  try {
    const basePath = getBasePath(projectContext, context.userId, projectId)
    const locRef = basePath.collection('customStoreListings').doc(listingId).collection('localizations').doc(locale)
    const locDoc = await locRef.get()

    if (!locDoc.exists) {
      return { success: false, error: `Localization ${locale} not found for this custom store listing` }
    }

    const locData = locDoc.data() as CSLLocalization
    const existingScreenshots = locData.screenshots || []
    const newScreenshot: CSLScreenshotReference = {
      id: `csl_ss_${Date.now()}_${Math.random().toString(36).substring(7)}`,
      position: existingScreenshots.length,
      imageType,
      imageUrl,
      imageKey,
      fileName,
      fileSize,
    }

    await locRef.update({
      screenshots: [...existingScreenshots, newScreenshot],
    })

    // Mark listing as having local changes
    const listingRef = basePath.collection('customStoreListings').doc(listingId)
    const listingDoc = await listingRef.get()
    if (listingDoc.exists && listingDoc.data()?.syncStatus === 'synced') {
      await listingRef.update({ syncStatus: 'local_changes', updatedAt: Timestamp.now() })
    }

    return { success: true, screenshot: newScreenshot }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to upload screenshot' }
  }
}

// ============================================
// Delete CSL Screenshot
// ============================================

export interface DeleteCSLScreenshotParams {
  projectId: string
  listingId: string
  locale: string
  screenshotId: string
}

export interface DeleteCSLScreenshotResult {
  success: boolean
  error?: string
}

export async function deleteCSLScreenshot(
  params: DeleteCSLScreenshotParams,
  context: AccountContext
): Promise<DeleteCSLScreenshotResult> {
  const { projectId, listingId, locale, screenshotId } = params

  const projectContext = await getProjectContext(context.userId, projectId)
  if (!projectContext) {
    return { success: false, error: 'Project not found' }
  }
  if (!canMutateProject(projectContext)) return { success: false, error: PROJECT_MUTATION_FORBIDDEN }

  try {
    const basePath = getBasePath(projectContext, context.userId, projectId)
    const locRef = basePath.collection('customStoreListings').doc(listingId).collection('localizations').doc(locale)
    const locDoc = await locRef.get()

    if (!locDoc.exists) {
      return { success: false, error: `Localization ${locale} not found` }
    }

    const locData = locDoc.data() as CSLLocalization
    const updatedScreenshots = (locData.screenshots || [])
      .filter(s => s.id !== screenshotId)
      .map((s, i) => ({ ...s, position: i }))

    await locRef.update({ screenshots: updatedScreenshots })

    // Mark listing as having local changes
    const listingRef = basePath.collection('customStoreListings').doc(listingId)
    const listingDoc = await listingRef.get()
    if (listingDoc.exists && listingDoc.data()?.syncStatus === 'synced') {
      await listingRef.update({ syncStatus: 'local_changes', updatedAt: Timestamp.now() })
    }

    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to delete screenshot' }
  }
}

// ============================================
// Upload CSL Icon
// ============================================

export interface UploadCSLIconParams {
  projectId: string
  listingId: string
  locale: string
  imageUrl: string
  imageKey: string
}

export interface UploadCSLIconResult {
  success: boolean
  error?: string
}

export async function uploadCSLIcon(
  params: UploadCSLIconParams,
  context: AccountContext
): Promise<UploadCSLIconResult> {
  const { projectId, listingId, locale, imageUrl, imageKey } = params

  const projectContext = await getProjectContext(context.userId, projectId)
  if (!projectContext) {
    return { success: false, error: 'Project not found' }
  }
  if (!canMutateProject(projectContext)) return { success: false, error: PROJECT_MUTATION_FORBIDDEN }

  try {
    const basePath = getBasePath(projectContext, context.userId, projectId)
    const locRef = basePath.collection('customStoreListings').doc(listingId).collection('localizations').doc(locale)
    const locDoc = await locRef.get()

    if (!locDoc.exists) {
      return { success: false, error: `Localization ${locale} not found` }
    }

    await locRef.update({ iconUrl: imageUrl, iconKey: imageKey })

    // Mark listing as having local changes
    const listingRef = basePath.collection('customStoreListings').doc(listingId)
    const listingDoc = await listingRef.get()
    if (listingDoc.exists && listingDoc.data()?.syncStatus === 'synced') {
      await listingRef.update({ syncStatus: 'local_changes', updatedAt: Timestamp.now() })
    }

    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to upload icon' }
  }
}

// ============================================
// Upload CSL Feature Graphic
// ============================================

export interface UploadCSLFeatureGraphicParams {
  projectId: string
  listingId: string
  locale: string
  imageUrl: string
  imageKey: string
}

export interface UploadCSLFeatureGraphicResult {
  success: boolean
  error?: string
}

export async function uploadCSLFeatureGraphic(
  params: UploadCSLFeatureGraphicParams,
  context: AccountContext
): Promise<UploadCSLFeatureGraphicResult> {
  const { projectId, listingId, locale, imageUrl, imageKey } = params

  const projectContext = await getProjectContext(context.userId, projectId)
  if (!projectContext) {
    return { success: false, error: 'Project not found' }
  }
  if (!canMutateProject(projectContext)) return { success: false, error: PROJECT_MUTATION_FORBIDDEN }

  try {
    const basePath = getBasePath(projectContext, context.userId, projectId)
    const locRef = basePath.collection('customStoreListings').doc(listingId).collection('localizations').doc(locale)
    const locDoc = await locRef.get()

    if (!locDoc.exists) {
      return { success: false, error: `Localization ${locale} not found` }
    }

    await locRef.update({ featureGraphicUrl: imageUrl, featureGraphicKey: imageKey })

    // Mark listing as having local changes
    const listingRef = basePath.collection('customStoreListings').doc(listingId)
    const listingDoc = await listingRef.get()
    if (listingDoc.exists && listingDoc.data()?.syncStatus === 'synced') {
      await listingRef.update({ syncStatus: 'local_changes', updatedAt: Timestamp.now() })
    }

    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to upload feature graphic' }
  }
}
