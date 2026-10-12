import { adminDb } from '@/lib/firebase/admin'
import { Timestamp } from 'firebase-admin/firestore'
import { randomUUID } from 'crypto'
import { appendFileSync } from 'fs'
const DEBUG_LOG = '/tmp/intro-offer-debug.log'
function debugLog(msg: string) {
  try { appendFileSync(DEBUG_LOG, `[${new Date().toISOString()}] ${msg}\n`) } catch {}
}
import { AccountContext, getProjectContext, hasContextPermission } from '@/lib/org/context'
import { getAppStoreHelper } from '@/lib/services/credentials'
import {
  generateSourceHash,
  getGroupLocalesRequiringTranslation,
  getIAPLocalesRequiringTranslation,
  translateGroupNames,
  translateIAPFields,
  type GroupTranslationCache,
  type IAPTranslationCache,
} from '@/lib/services/iap-translator'
import { refundUsage, reserveUsage, settleUsage } from '@/lib/api/usage'
import { IAPPricingCalculator, resolveIAPPricingForPush, resolveSubscriptionPricingForPush, type PricingPreviewResult } from '@/lib/services/iap-pricing'
import { getPricingStrategyOptions, PRICING_STRATEGIES } from '@/lib/constants'
import type { IAPProductTypeAPI } from '@/lib/services/appstore'
import { canPushInState } from '@/lib/iap/state-config'
import type {
  InAppPurchase,
  IAPLocalization,
  SubscriptionGroup,
  Subscription,
  IAPProductType,
  IAPSyncStatus,
  SubscriptionPeriod,
  IAPState,
} from '@/lib/firebase/firestore'

async function reserveTranslationCredits(
  context: AccountContext,
  params: object,
  units: number,
  metadata: Record<string, string | number | boolean | null>
): Promise<{ operationId?: string; error?: string }> {
  if (units === 0) return {}
  const operationId = (params as { __usageOperationId?: string }).__usageOperationId || randomUUID()
  const reservation = await reserveUsage(context, {
    operationId,
    usageType: 'translations',
    units,
    metadata,
  })
  if (!reservation.allowed) {
    return { error: `Translation credit limit reached. Remaining: ${reservation.remaining}, required: ${units}` }
  }
  if (reservation.replayed) return { error: 'This translation request has already been processed' }
  return { operationId }
}

// List IAP Products
export interface ListIAPProductsParams {
  projectId: string
  filter?: 'all' | 'iaps' | 'subscriptions'
}

interface PricingInfo {
  basePrice?: string
  baseCurrency?: string
  baseTerritory?: string
  strategy?: string
}

interface IntroOfferInfo {
  offerMode: 'PAY_AS_YOU_GO' | 'PAY_UP_FRONT' | 'FREE_TRIAL'
  duration: string
  numberOfPeriods: number
  territories: string[]
  startDate: string
  endDate: string | null
}

export interface ListIAPProductsResult {
  success: boolean
  iaps?: Array<InAppPurchase & { pricing?: PricingInfo }>
  subscriptionGroups?: Array<SubscriptionGroup & { subscriptions: Array<Subscription & { pricing?: PricingInfo; introOffer?: IntroOfferInfo }> }>
  error?: string
}

export async function listIAPProducts(
  params: ListIAPProductsParams,
  context: AccountContext
): Promise<ListIAPProductsResult> {
  const { projectId, filter = 'all' } = params

  const projectContext = await getProjectContext(context.userId, projectId)
  if (!projectContext) {
    return { success: false, error: 'Project not found' }
  }

  try {
    const basePath = projectContext.type === 'organization' && projectContext.orgId
      ? adminDb.collection('organizations').doc(projectContext.orgId).collection('projects').doc(projectId)
      : adminDb.collection('users').doc(context.userId).collection('projects').doc(projectId)

    const result: ListIAPProductsResult = { success: true }

    // Get IAPs with pricing
    if (filter === 'all' || filter === 'iaps') {
      const iapsSnapshot = await basePath.collection('inAppPurchases').orderBy('createdAt', 'desc').get()
      result.iaps = await Promise.all(iapsSnapshot.docs.map(async doc => {
        const pricingDoc = await doc.ref.collection('config').doc('pricing').get()
        const pricingData = pricingDoc.exists ? pricingDoc.data() : null
        return {
          id: doc.id,
          ...doc.data(),
          ...(pricingData ? {
            pricing: {
              basePrice: pricingData.basePrice,
              baseCurrency: pricingData.baseCurrency,
              baseTerritory: pricingData.baseTerritory,
              strategy: pricingData.strategy,
            }
          } : {}),
        } as InAppPurchase & { pricing?: PricingInfo }
      }))
    }

    // Get subscription groups with subscriptions, pricing, and intro offers
    if (filter === 'all' || filter === 'subscriptions') {
      const groupsSnapshot = await basePath.collection('subscriptionGroups').get()
      result.subscriptionGroups = await Promise.all(groupsSnapshot.docs.map(async groupDoc => {
        const subscriptionsSnapshot = await groupDoc.ref.collection('subscriptions').orderBy('groupLevel', 'asc').get()
        const subscriptions = await Promise.all(subscriptionsSnapshot.docs.map(async subDoc => {
          const [pricingDoc, introOfferDoc] = await Promise.all([
            subDoc.ref.collection('config').doc('pricing').get(),
            subDoc.ref.collection('config').doc('introOffer').get(),
          ])
          const pricingData = pricingDoc.exists ? pricingDoc.data() : null
          const introOfferData = introOfferDoc.exists ? introOfferDoc.data() : null
          return {
            id: subDoc.id,
            ...subDoc.data(),
            ...(pricingData ? {
              pricing: {
                basePrice: pricingData.basePrice,
                baseCurrency: pricingData.baseCurrency,
                baseTerritory: pricingData.baseTerritory,
                strategy: pricingData.strategy,
              }
            } : {}),
            ...(introOfferData ? {
              introOffer: {
                offerMode: introOfferData.offerMode,
                duration: introOfferData.duration,
                numberOfPeriods: introOfferData.numberOfPeriods,
                territories: introOfferData.territories,
                startDate: introOfferData.startDate,
                endDate: introOfferData.endDate || null,
              }
            } : {}),
          } as Subscription & { pricing?: PricingInfo; introOffer?: IntroOfferInfo }
        }))
        return {
          id: groupDoc.id,
          ...groupDoc.data(),
          subscriptions,
        } as SubscriptionGroup & { subscriptions: Array<Subscription & { pricing?: PricingInfo; introOffer?: IntroOfferInfo }> }
      }))
    }

    return result
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to list IAP products' }
  }
}

// Create IAP Product
export interface CreateIAPProductParams {
  projectId: string
  productId: string
  name: string
  productType: 'CONSUMABLE' | 'NON_CONSUMABLE' | 'NON_RENEWING_SUBSCRIPTION'
  familyShareable?: boolean
  reviewNote?: string
  localizations?: Array<{
    locale: string
    displayName: string
    description: string
  }>
}

export interface CreateIAPProductResult {
  success: boolean
  iap?: InAppPurchase
  error?: string
}

export async function createIAPProduct(
  params: CreateIAPProductParams,
  context: AccountContext
): Promise<CreateIAPProductResult> {
  const { projectId, productId, name, productType, familyShareable = false, reviewNote, localizations } = params

  const projectContext = await getProjectContext(context.userId, projectId)
  if (!projectContext) {
    return { success: false, error: 'Project not found' }
  }

  if (!hasContextPermission(projectContext, 'canCreateProjects')) {
    return { success: false, error: 'Permission denied' }
  }

  try {
    const basePath = projectContext.type === 'organization' && projectContext.orgId
      ? adminDb.collection('organizations').doc(projectContext.orgId).collection('projects').doc(projectId)
      : adminDb.collection('users').doc(context.userId).collection('projects').doc(projectId)

    // Check if productId already exists
    const existingSnapshot = await basePath.collection('inAppPurchases')
      .where('productId', '==', productId)
      .limit(1)
      .get()

    if (!existingSnapshot.empty) {
      return { success: false, error: 'Product ID already exists' }
    }

    const now = Timestamp.now()
    const iapRef = basePath.collection('inAppPurchases').doc()

    const iap = {
      id: iapRef.id,
      appStoreId: null,
      productId,
      name,
      productType: productType as IAPProductType,
      state: null,
      syncStatus: 'pending_creation' as IAPSyncStatus,
      familyShareable,
      reviewNote: reviewNote || null,
      createdAt: now,
      updatedAt: now,
    }

    await iapRef.set(iap)

    // Save localizations locally
    if (localizations && localizations.length > 0) {
      const batch = adminDb.batch()
      for (const loc of localizations) {
        const locRef = iapRef.collection('localizations').doc(loc.locale)
        batch.set(locRef, {
          locale: loc.locale,
          displayName: loc.displayName,
          description: loc.description,
        })
      }
      await batch.commit()
    }

    return { success: true, iap }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to create IAP product' }
  }
}

// Create Subscription
export interface CreateSubscriptionParams {
  projectId: string
  groupId?: string
  newGroupName?: string
  productId: string
  name: string
  groupLevel?: number
  subscriptionPeriod: 'ONE_WEEK' | 'ONE_MONTH' | 'TWO_MONTHS' | 'THREE_MONTHS' | 'SIX_MONTHS' | 'ONE_YEAR'
  familyShareable?: boolean
  localizations?: Array<{
    locale: string
    displayName: string
    description: string
  }>
}

export interface CreateSubscriptionResult {
  success: boolean
  group?: SubscriptionGroup
  subscription?: Subscription
  error?: string
}

export async function createSubscription(
  params: CreateSubscriptionParams,
  context: AccountContext
): Promise<CreateSubscriptionResult> {
  const {
    projectId,
    groupId,
    newGroupName,
    productId,
    name,
    groupLevel = 1,
    subscriptionPeriod,
    familyShareable = false,
    localizations,
  } = params

  if (!groupId && !newGroupName) {
    return { success: false, error: 'Either groupId or newGroupName is required' }
  }

  const projectContext = await getProjectContext(context.userId, projectId)
  if (!projectContext) {
    return { success: false, error: 'Project not found' }
  }

  if (!hasContextPermission(projectContext, 'canCreateProjects')) {
    return { success: false, error: 'Permission denied' }
  }

  try {
    const basePath = projectContext.type === 'organization' && projectContext.orgId
      ? adminDb.collection('organizations').doc(projectContext.orgId).collection('projects').doc(projectId)
      : adminDb.collection('users').doc(context.userId).collection('projects').doc(projectId)

    const now = Timestamp.now()
    let groupRef: FirebaseFirestore.DocumentReference
    let groupData: SubscriptionGroup

    // Get or create subscription group
    if (groupId) {
      groupRef = basePath.collection('subscriptionGroups').doc(groupId)
      const groupDoc = await groupRef.get()
      if (!groupDoc.exists) {
        return { success: false, error: 'Subscription group not found' }
      }
      groupData = { id: groupDoc.id, ...groupDoc.data() } as SubscriptionGroup
    } else {
      groupRef = basePath.collection('subscriptionGroups').doc()

      groupData = {
        id: groupRef.id,
        appStoreId: null,
        referenceName: newGroupName!,
        syncStatus: 'pending_creation' as IAPSyncStatus,
        createdAt: now,
        updatedAt: now,
      } as any  // Cast to any for admin SDK Timestamp compatibility

      await groupRef.set(groupData)
    }

    // Create subscription
    const subRef = groupRef.collection('subscriptions').doc()

    const subscription: Subscription = {
      id: subRef.id,
      appStoreId: null,
      productId,
      name,
      groupId: groupRef.id,
      groupLevel,
      subscriptionPeriod: subscriptionPeriod as SubscriptionPeriod,
      familyShareable,
      state: null,
      syncStatus: 'pending_creation' as IAPSyncStatus,
      createdAt: now,
      updatedAt: now,
    }

    await subRef.set(subscription)

    // Save localizations locally
    if (localizations && localizations.length > 0) {
      const batch = adminDb.batch()
      for (const loc of localizations) {
        const locRef = subRef.collection('localizations').doc(loc.locale)
        batch.set(locRef, {
          locale: loc.locale,
          displayName: loc.displayName,
          description: loc.description,
        })
      }
      await batch.commit()
    }

    return { success: true, group: groupData, subscription }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to create subscription' }
  }
}

// Update IAP Product
export interface UpdateIAPProductParams {
  projectId: string
  iapId: string
  name?: string
  familyShareable?: boolean
  reviewNote?: string
  localizations?: Array<{
    locale: string
    displayName: string
    description: string
  }>
}

export interface UpdateIAPProductResult {
  success: boolean
  iap?: InAppPurchase
  error?: string
}

export async function updateIAPProduct(
  params: UpdateIAPProductParams,
  context: AccountContext
): Promise<UpdateIAPProductResult> {
  const { projectId, iapId, name, familyShareable, reviewNote, localizations } = params

  const projectContext = await getProjectContext(context.userId, projectId)
  if (!projectContext) {
    return { success: false, error: 'Project not found' }
  }

  if (!hasContextPermission(projectContext, 'canCreateProjects')) {
    return { success: false, error: 'Permission denied' }
  }

  try {
    const basePath = projectContext.type === 'organization' && projectContext.orgId
      ? adminDb.collection('organizations').doc(projectContext.orgId).collection('projects').doc(projectId)
      : adminDb.collection('users').doc(context.userId).collection('projects').doc(projectId)

    const iapRef = basePath.collection('inAppPurchases').doc(iapId)
    const iapDoc = await iapRef.get()

    if (!iapDoc.exists) {
      return { success: false, error: 'IAP not found' }
    }

    const currentIAP = iapDoc.data() as InAppPurchase
    const now = Timestamp.now()

    const updates: Partial<InAppPurchase> = { updatedAt: now }
    if (name !== undefined) updates.name = name
    if (familyShareable !== undefined) updates.familyShareable = familyShareable
    if (reviewNote !== undefined) updates.reviewNote = reviewNote

    if (currentIAP.syncStatus === 'synced') {
      updates.syncStatus = 'local_changes'
    }

    await iapRef.update(updates)

    // Update localizations
    if (localizations && localizations.length > 0) {
      const batch = adminDb.batch()
      for (const loc of localizations) {
        const locRef = iapRef.collection('localizations').doc(loc.locale)
        batch.set(locRef, {
          locale: loc.locale,
          displayName: loc.displayName,
          description: loc.description,
        }, { merge: true })
      }
      await batch.commit()
    }

    const updatedDoc = await iapRef.get()
    return { success: true, iap: { id: updatedDoc.id, ...updatedDoc.data() } as InAppPurchase }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to update IAP product' }
  }
}

// Delete IAP Product
export interface DeleteIAPProductParams {
  projectId: string
  iapId: string
  deleteFromStore?: boolean
  confirmed?: boolean // Required when deleteFromStore=true
}

export interface DeleteIAPProductResult {
  success: boolean
  deleted?: string
  error?: string
}

export async function deleteIAPProduct(
  params: DeleteIAPProductParams,
  context: AccountContext
): Promise<DeleteIAPProductResult> {
  const { projectId, iapId, deleteFromStore = false, confirmed = false } = params

  // Require confirmation when deleting from store
  if (deleteFromStore && !confirmed) {
    return {
      success: false,
      error: 'Deleting from App Store requires confirmation. Please ask the user to confirm, then call again with confirmed=true.',
    }
  }

  const projectContext = await getProjectContext(context.userId, projectId)
  if (!projectContext) {
    return { success: false, error: 'Project not found' }
  }

  if (!hasContextPermission(projectContext, 'canCreateProjects')) {
    return { success: false, error: 'Permission denied' }
  }

  try {
    const basePath = projectContext.type === 'organization' && projectContext.orgId
      ? adminDb.collection('organizations').doc(projectContext.orgId).collection('projects').doc(projectId)
      : adminDb.collection('users').doc(context.userId).collection('projects').doc(projectId)

    const iapRef = basePath.collection('inAppPurchases').doc(iapId)
    const iapDoc = await iapRef.get()

    if (!iapDoc.exists) {
      return { success: false, error: 'IAP not found' }
    }

    const iap = iapDoc.data() as InAppPurchase

    // Delete from App Store if requested
    if (deleteFromStore && iap.appStoreId) {
      try {
        const appStoreHelper = await getAppStoreHelper(context.userId, projectId, projectContext.orgId)
        await appStoreHelper.deleteInAppPurchase(iap.appStoreId)
      } catch {
        // Continue with local deletion
      }
    }

    // Delete localizations and IAP
    const locSnapshot = await iapRef.collection('localizations').get()
    const batch = adminDb.batch()
    locSnapshot.docs.forEach(doc => batch.delete(doc.ref))
    batch.delete(iapRef)
    await batch.commit()

    return { success: true, deleted: iap.productId }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to delete IAP product' }
  }
}

// Sync IAP Products
export interface SyncIAPProductsParams {
  projectId: string
  direction: 'pull' | 'push'
  iapIds?: string[]
  subscriptionIds?: string[]
  pushAll?: boolean
  skipValidation?: boolean // Set to true to skip validation (not recommended)
  confirmed?: boolean // Required for push — must be true to execute
}

export interface ValidationIssue {
  id: string
  productId: string
  type: 'iap' | 'subscription'
  missingFields: string[]
  suggestedActions: Array<{
    tool: string
    description: string
    params: Record<string, any>
  }>
}

export interface SyncIAPProductsResult {
  success: boolean
  summary?: {
    created: string[]
    updated: string[]
    errors: Array<{ id: string; error: string }>
    skipped: Array<{ id: string; productId?: string; reason: string }>
    requested: number
    processed: number
  }
  // Validation results (only when push fails validation)
  validationFailed?: boolean
  validationIssues?: ValidationIssue[]
  validationMessage?: string
  message?: string
  error?: string
}

// Helper to get suggested actions for missing fields
function getSuggestedActions(
  type: 'iap' | 'subscription',
  id: string,
  projectId: string,
  missingFields: string[]
): ValidationIssue['suggestedActions'] {
  const actions: ValidationIssue['suggestedActions'] = []

  for (const field of missingFields) {
    if (field.includes('Localizations')) {
      if (type === 'iap') {
        actions.push({
          tool: 'translateIAPProduct',
          description: 'Add localizations with Display Name and Description for at least one locale. Use translateIAPProduct to auto-translate from primary locale, or updateIAPProduct to set manually.',
          params: { projectId, iapId: id, targetLocales: ['en-US'] },
        })
      } else {
        actions.push({
          tool: 'translateSubscription',
          description: 'Add localizations with Display Name and Description for at least one locale. Use translateSubscription to auto-translate from primary locale, or updateSubscription to set manually.',
          params: { projectId, subscriptionId: id, targetLocales: ['en-US'] },
        })
      }
    }

    if (field.includes('Pricing')) {
      if (type === 'iap') {
        actions.push({
          tool: 'setIAPPricing',
          description: 'Set a base price for the IAP. Use previewIAPPricing first to see available price points.',
          params: { projectId, iapId: id, basePricePointId: 'p1', baseTerritory: 'USA', strategy: 'equalized' },
        })
      } else {
        actions.push({
          tool: 'setSubscriptionPricing',
          description: 'Set a base price for the subscription.',
          params: { projectId, subscriptionId: id, basePricePointId: 'p1', baseTerritory: 'USA' },
        })
      }
    }

    if (field.includes('Reference Name')) {
      if (type === 'iap') {
        actions.push({
          tool: 'updateIAPProduct',
          description: 'Set the Reference Name (internal name for App Store Connect).',
          params: { projectId, iapId: id, name: '<reference_name>' },
        })
      } else {
        actions.push({
          tool: 'updateSubscription',
          description: 'Set the Reference Name (internal name for App Store Connect).',
          params: { projectId, subscriptionId: id, name: '<reference_name>' },
        })
      }
    }

    if (field.includes('Subscription Period')) {
      actions.push({
        tool: 'updateSubscription',
        description: 'Set the subscription period (ONE_WEEK, ONE_MONTH, TWO_MONTHS, THREE_MONTHS, SIX_MONTHS, ONE_YEAR).',
        params: { projectId, subscriptionId: id },
      })
    }
  }

  return actions
}

export async function syncIAPProducts(
  params: SyncIAPProductsParams,
  context: AccountContext
): Promise<SyncIAPProductsResult> {
  const { projectId, direction, iapIds, subscriptionIds, pushAll, skipValidation = false, confirmed = false } = params
  debugLog(`\n\n========== syncIAPProducts CALLED ==========`)
  debugLog(`direction=${direction}, confirmed=${confirmed}, subscriptionIds=${JSON.stringify(subscriptionIds)}, pushAll=${pushAll}`)

  // Require confirmation for push operations
  if (direction === 'push' && !confirmed) {
    return {
      success: false,
      error: 'Push to App Store requires confirmation. Please ask the user to confirm, then call again with confirmed=true.',
      requiresConfirmation: true,
    } as any
  }

  const projectContext = await getProjectContext(context.userId, projectId)
  if (!projectContext) {
    return { success: false, error: 'Project not found' }
  }

  if (!hasContextPermission(projectContext, 'canCreateProjects')) {
    return { success: false, error: 'Permission denied' }
  }

  try {
    const basePath = projectContext.type === 'organization' && projectContext.orgId
      ? adminDb.collection('organizations').doc(projectContext.orgId).collection('projects').doc(projectId)
      : adminDb.collection('users').doc(context.userId).collection('projects').doc(projectId)

    const appStoreHelper = await getAppStoreHelper(context.userId, projectId, projectContext.orgId)

    if (direction === 'pull') {
      // Pull from App Store
      const appStoreIAPs = await appStoreHelper.listInAppPurchases()
      const now = Timestamp.now()
      const batch = adminDb.batch()
      const created: string[] = []
      const updated: string[] = []

      // Note: listInAppPurchases only returns CONSUMABLE, NON_CONSUMABLE, NON_RENEWING_SUBSCRIPTION
      // Auto-renewable subscriptions come from a separate API endpoint
      for (const appStoreIAP of appStoreIAPs) {
        let existingDoc = await basePath.collection('inAppPurchases')
          .where('appStoreId', '==', appStoreIAP.id)
          .limit(1)
          .get()

        if (existingDoc.empty) {
          existingDoc = await basePath.collection('inAppPurchases')
            .where('productId', '==', appStoreIAP.productId)
            .limit(1)
            .get()
        }

        const iapData: Partial<InAppPurchase> = {
          appStoreId: appStoreIAP.id,
          productId: appStoreIAP.productId,
          name: appStoreIAP.name,
          productType: appStoreIAP.productType as IAPProductType,
          state: appStoreIAP.state as any,
          syncStatus: 'synced' as IAPSyncStatus,
          familyShareable: appStoreIAP.familyShareable,
          reviewNote: appStoreIAP.reviewNote,
          updatedAt: now,
        }

        if (existingDoc.empty) {
          const newRef = basePath.collection('inAppPurchases').doc()
          batch.set(newRef, { id: newRef.id, ...iapData, createdAt: now })
          created.push(appStoreIAP.productId)
        } else {
          batch.update(existingDoc.docs[0].ref, iapData)
          updated.push(appStoreIAP.productId)
        }
      }

      await batch.commit()
      return { success: true, summary: { created, updated, errors: [], skipped: [], requested: appStoreIAPs.length, processed: created.length + updated.length } }
    } else {
      // Push to App Store - with validation
      const created: string[] = []
      const updated: string[] = []
      const errors: Array<{ id: string; error: string }> = []
      const skipped: Array<{ id: string; productId?: string; reason: string }> = []
      const validationIssues: ValidationIssue[] = []
      let requestedCount = 0

      // Collect IAPs to process
      let iapsToProcess: FirebaseFirestore.QueryDocumentSnapshot[] = []
      if (pushAll) {
        // First get ALL IAPs to report on skipped ones
        const allIapsSnapshot = await basePath.collection('inAppPurchases').get()
        const pushableIaps = await basePath.collection('inAppPurchases')
          .where('syncStatus', 'in', ['pending_creation', 'local_changes'])
          .get()
        iapsToProcess = pushableIaps.docs
        requestedCount += allIapsSnapshot.docs.length

        // Report items skipped due to syncStatus
        const skippedBySyncStatus = allIapsSnapshot.docs.filter(
          doc => !['pending_creation', 'local_changes'].includes(doc.data().syncStatus)
        )
        for (const doc of skippedBySyncStatus) {
          const data = doc.data() as InAppPurchase
          skipped.push({
            id: doc.id,
            productId: data.productId,
            reason: `Already synced (syncStatus: ${data.syncStatus}). No changes to push.`,
          })
        }
      } else if (iapIds && iapIds.length > 0) {
        requestedCount += iapIds.length
        const iapDocs = await Promise.all(
          iapIds.map(id => basePath.collection('inAppPurchases').doc(id).get())
        )
        for (let i = 0; i < iapIds.length; i++) {
          if (!iapDocs[i].exists) {
            skipped.push({
              id: iapIds[i],
              reason: 'IAP not found in project. Check the ID is correct.',
            })
          }
        }
        iapsToProcess = iapDocs.filter(doc => doc.exists) as FirebaseFirestore.QueryDocumentSnapshot[]
      }

      // Collect subscriptions to process
      debugLog(`[sync] Collecting subscriptions to process...`)
      const subsToProcess: Array<{ doc: FirebaseFirestore.DocumentSnapshot; groupDoc: FirebaseFirestore.DocumentSnapshot }> = []
      if (subscriptionIds && subscriptionIds.length > 0) {
        requestedCount += subscriptionIds.length
        const groupsSnapshot = await basePath.collection('subscriptionGroups').get()
        debugLog(`[sync] Found ${groupsSnapshot.docs.length} subscription groups`)
        const foundSubIds = new Set<string>()
        for (const groupDoc of groupsSnapshot.docs) {
          for (const subId of subscriptionIds) {
            const subDoc = await groupDoc.ref.collection('subscriptions').doc(subId).get()
            if (subDoc.exists) {
              const subData = subDoc.data()
              debugLog(`[sync] Found subscription ${subId}: productId=${subData?.productId}, appStoreId=${subData?.appStoreId}, state=${subData?.state}, syncStatus=${subData?.syncStatus}`)
              subsToProcess.push({ doc: subDoc, groupDoc })
              foundSubIds.add(subId)
            }
          }
        }
        debugLog(`[sync] Total subscriptions to process: ${subsToProcess.length}`)
        // Report subscriptions not found
        for (const subId of subscriptionIds) {
          if (!foundSubIds.has(subId)) {
            debugLog(`[sync] Subscription ${subId} NOT FOUND`)
            skipped.push({
              id: subId,
              reason: 'Subscription not found in any subscription group. Check the ID is correct.',
            })
          }
        }
      }

      // If nothing was requested, return early with helpful message
      if (requestedCount === 0 && !pushAll) {
        return {
          success: false,
          error: 'No items specified. Provide iapIds, subscriptionIds, or set pushAll: true.',
          summary: { created: [], updated: [], errors: [], skipped: [], requested: 0, processed: 0 },
        }
      }

      // VALIDATION PHASE - Check all products before pushing
      if (!skipValidation) {
        // Validate IAPs
        for (const iapDoc of iapsToProcess) {
          const iap = iapDoc.data() as InAppPurchase
          if (iap.productType === 'AUTO_RENEWABLE_SUBSCRIPTION') continue

          const missingFields: string[] = []

          if (!iap.productId) missingFields.push('Product ID')
          if (!iap.name) missingFields.push('Reference Name')

          // Check localizations
          const locSnapshot = await iapDoc.ref.collection('localizations').get()
          const localizations = locSnapshot.docs.map(doc => doc.data() as IAPLocalization)
          const validLocs = localizations.filter(loc => loc.displayName && loc.description)
          if (validLocs.length === 0) {
            missingFields.push('Localizations (need at least one with Display Name and Description)')
          }

          // Check pricing
          const pricingDoc = await iapDoc.ref.collection('config').doc('pricing').get()
          if (!pricingDoc.exists || !pricingDoc.data()?.basePricePointId) {
            missingFields.push('Pricing')
          }

          if (missingFields.length > 0) {
            validationIssues.push({
              id: iapDoc.id,
              productId: iap.productId,
              type: 'iap',
              missingFields,
              suggestedActions: getSuggestedActions('iap', iapDoc.id, projectId, missingFields),
            })
          }
        }

        // Validate Subscriptions
        for (const { doc: subDoc, groupDoc } of subsToProcess) {
          const sub = subDoc.data() as Subscription
          const group = groupDoc.data() as SubscriptionGroup
          const missingFields: string[] = []

          if (!sub.productId) missingFields.push('Product ID')
          if (!sub.name) missingFields.push('Reference Name')
          if (!sub.subscriptionPeriod) missingFields.push('Subscription Period')
          if (!group.appStoreId && !group.referenceName) missingFields.push('Subscription Group')

          // Check localizations
          const locSnapshot = await subDoc.ref.collection('localizations').get()
          const localizations = locSnapshot.docs.map(doc => doc.data() as IAPLocalization)
          const validLocs = localizations.filter(loc => loc.displayName && loc.description)
          if (validLocs.length === 0) {
            missingFields.push('Localizations (need at least one with Display Name and Description)')
          }

          // Check pricing
          const pricingDoc = await subDoc.ref.collection('config').doc('pricing').get()
          if (!pricingDoc.exists || !pricingDoc.data()?.basePricePointId) {
            missingFields.push('Pricing')
          }

          if (missingFields.length > 0) {
            validationIssues.push({
              id: subDoc.id,
              productId: sub.productId,
              type: 'subscription',
              missingFields,
              suggestedActions: getSuggestedActions('subscription', subDoc.id, projectId, missingFields),
            })
          }
        }

        // If validation failed, return with actionable guidance
        if (validationIssues.length > 0) {
          const totalProducts = iapsToProcess.length + subsToProcess.length
          const invalidCount = validationIssues.length
          return {
            success: false,
            validationFailed: true,
            validationIssues,
            validationMessage: `${invalidCount} of ${totalProducts} product(s) are missing required fields for App Store submission. Review the suggestedActions for each product to fix the issues, then retry the push.`,
            summary: { created: [], updated: [], errors: [], skipped, requested: requestedCount, processed: 0 },
          }
        }
      }

      // PUSH PHASE - All validation passed, proceed with push
      const now = Timestamp.now()

      // Push IAPs
      for (const iapDoc of iapsToProcess) {
        const iap = iapDoc.data() as InAppPurchase

        // Skip subscription types - they use a different API
        if (iap.productType === 'AUTO_RENEWABLE_SUBSCRIPTION') {
          skipped.push({
            id: iapDoc.id,
            productId: iap.productId,
            reason: 'Auto-renewable subscriptions must be pushed using subscriptionIds, not iapIds. They use the Subscriptions API.',
          })
          continue
        }

        // Check if push is allowed for current state
        const pushStatus = canPushInState(iap.state)
        if (!pushStatus.allowed) {
          skipped.push({
            id: iapDoc.id,
            productId: iap.productId,
            reason: pushStatus.warning || `Cannot push in state "${iap.state}". Wait for state to change before pushing.`,
          })
          continue
        }

        try {
          const locSnapshot = await iapDoc.ref.collection('localizations').get()
          const localizations = locSnapshot.docs.map(doc => doc.data() as IAPLocalization)

          if (iap.syncStatus === 'pending_creation' && !iap.appStoreId) {
            const createdIAP = await appStoreHelper.createInAppPurchase({
              productId: iap.productId,
              name: iap.name,
              productType: iap.productType as IAPProductTypeAPI,
              familyShareable: iap.familyShareable,
              reviewNote: iap.reviewNote || undefined,
            })

            const appStoreId = createdIAP.id

            await iapDoc.ref.update({
              appStoreId,
              state: createdIAP.state,
              updatedAt: now,
            })

            for (const loc of localizations) {
              await appStoreHelper.upsertIAPLocalization(appStoreId, loc.locale, {
                displayName: loc.displayName,
                description: loc.description,
              })
            }

            // Push pricing if configured (strategy-aware)
            const pricingDoc = await iapDoc.ref.collection('config').doc('pricing').get()
            const pricing = pricingDoc.exists ? pricingDoc.data() : null
            if (pricing?.basePricePointId) {
              try {
                const { basePricePointId: resolvedBaseId, manualPrices } = await resolveIAPPricingForPush({
                  appStoreHelper,
                  iapId: appStoreId,
                  basePriceValue: pricing.basePricePointId,
                  baseTerritory: pricing.baseTerritory || 'USA',
                  strategyId: pricing.pricingStrategyId || pricing.strategy || 'equalized',
                })

                await appStoreHelper.setIAPPriceSchedule(
                  appStoreId,
                  resolvedBaseId,
                  pricing.baseTerritory || 'USA',
                  manualPrices,
                )
                await iapDoc.ref.update({ syncStatus: 'synced', updatedAt: now })
              } catch (pricingError) {
                console.warn(`[Push] Warning: Failed to set pricing for IAP ${iap.productId}:`, pricingError)
                // Keep syncStatus as local_changes so user knows pricing wasn't pushed
                await iapDoc.ref.update({ syncStatus: 'local_changes', updatedAt: now })
              }
            } else {
              await iapDoc.ref.update({ syncStatus: 'synced', updatedAt: now })
            }

            created.push(iap.productId)
          } else if (iap.appStoreId) {
            await appStoreHelper.updateInAppPurchase(iap.appStoreId, {
              name: iap.name,
              familyShareable: iap.familyShareable,
              reviewNote: iap.reviewNote || undefined,
            })

            for (const loc of localizations) {
              await appStoreHelper.upsertIAPLocalization(iap.appStoreId, loc.locale, {
                displayName: loc.displayName,
                description: loc.description,
              })
            }

            // Push pricing if configured (strategy-aware)
            const pricingDoc = await iapDoc.ref.collection('config').doc('pricing').get()
            const pricing = pricingDoc.exists ? pricingDoc.data() : null
            if (pricing?.basePricePointId) {
              try {
                const { basePricePointId: resolvedBaseId, manualPrices } = await resolveIAPPricingForPush({
                  appStoreHelper,
                  iapId: iap.appStoreId,
                  basePriceValue: pricing.basePricePointId,
                  baseTerritory: pricing.baseTerritory || 'USA',
                  strategyId: pricing.pricingStrategyId || pricing.strategy || 'equalized',
                })

                await appStoreHelper.setIAPPriceSchedule(
                  iap.appStoreId,
                  resolvedBaseId,
                  pricing.baseTerritory || 'USA',
                  manualPrices,
                )
                await iapDoc.ref.update({ syncStatus: 'synced', updatedAt: now })
              } catch (pricingError) {
                console.warn(`[Push] Warning: Failed to set pricing for IAP ${iap.productId}:`, pricingError)
                await iapDoc.ref.update({ syncStatus: 'local_changes', updatedAt: now })
              }
            } else {
              await iapDoc.ref.update({ syncStatus: 'synced', updatedAt: now })
            }

            updated.push(iap.productId)
          }
        } catch (error) {
          errors.push({ id: iap.productId, error: error instanceof Error ? error.message : 'Unknown error' })
        }
      }

      // Push Subscriptions
      debugLog(`[sync] Processing ${subsToProcess.length} subscriptions...`)
      for (const { doc: subDoc, groupDoc } of subsToProcess) {
        const sub = subDoc.data() as Subscription
        const group = groupDoc.data() as SubscriptionGroup
        debugLog(`[sync] Processing sub: ${sub.productId}, state=${sub.state}, appStoreId=${sub.appStoreId}, syncStatus=${sub.syncStatus}`)

        // Check if push is allowed for current state
        const subPushStatus = canPushInState(sub.state)
        if (!subPushStatus.allowed) {
          debugLog(`[sync] SKIPPED: state ${sub.state} not allowed for push`)
          skipped.push({
            id: subDoc.id,
            productId: sub.productId,
            reason: subPushStatus.warning || `Cannot push subscription in state "${sub.state}". Wait for state to change before pushing.`,
          })
          continue
        }

        try {
          // Validate group has localizations (required by App Store)
          const groupLocSnapshot = await groupDoc.ref.collection('localizations').get()
          const groupLocalizations = groupLocSnapshot.docs.map(doc => {
            const data = doc.data() as { name?: string; displayName?: string }
            return { locale: doc.id, displayName: data.name || data.displayName || '' }
          })
          const validGroupLocalizations = groupLocalizations.filter(loc => loc.displayName)
          if (validGroupLocalizations.length === 0) {
            errors.push({
              id: sub.productId,
              error: `Subscription group "${group.referenceName}" is missing localizations. Add at least one group display name before pushing.`,
            })
            continue
          }

          // Ensure group exists in App Store — re-read in case another subscription already created it
          const freshGroupDoc = await groupDoc.ref.get()
          let groupAppStoreId = freshGroupDoc.data()?.appStoreId || group.appStoreId
          if (!groupAppStoreId) {
            try {
              const createdGroup = await appStoreHelper.createSubscriptionGroup(group.referenceName)
              groupAppStoreId = createdGroup.id
            } catch (createError: any) {
              const errMsg = createError?.message || String(createError)
              if (errMsg.includes('INVALID.DUPLICATE') || errMsg.includes('already been used')) {
                const existingGroups = await appStoreHelper.listSubscriptionGroups()
                const match = existingGroups.find((g: any) => g.referenceName === group.referenceName)
                if (match) {
                  groupAppStoreId = match.id
                } else {
                  throw new Error(`Subscription group "${group.referenceName}" exists in App Store but could not be found by name`)
                }
              } else {
                throw createError
              }
            }
            await groupDoc.ref.update({
              appStoreId: groupAppStoreId,
              syncStatus: 'synced',
              updatedAt: now,
            })
          }

          // Push group localizations
          for (const groupLoc of validGroupLocalizations) {
            try {
              await appStoreHelper.setSubscriptionGroupLocalization(groupAppStoreId, groupLoc.locale, {
                name: groupLoc.displayName,
                customAppName: null,
              })
            } catch (locError) {
              console.warn(`[Push] Warning: Failed to set group localization for ${groupLoc.locale}:`, locError)
            }
          }

          const locSnapshot = await subDoc.ref.collection('localizations').get()
          const localizations = locSnapshot.docs.map(doc => doc.data() as IAPLocalization)

          if (!sub.appStoreId) {
            let createdSubId: string
            let createdSubState: string | undefined
            try {
              const createdSub = await appStoreHelper.createSubscription({
                productId: sub.productId,
                name: sub.name,
                groupId: groupAppStoreId,
                groupLevel: sub.groupLevel,
                subscriptionPeriod: sub.subscriptionPeriod,
                familyShareable: sub.familyShareable,
              })
              createdSubId = createdSub.id
              createdSubState = createdSub.state
            } catch (createError: any) {
              const errMsg = createError?.message || String(createError)
              if (errMsg.includes('INVALID.DUPLICATE') || errMsg.includes('already been used')) {
                const existingSubs = await appStoreHelper.listSubscriptions(groupAppStoreId)
                const match = existingSubs.find((s: any) => s.productId === sub.productId)
                if (match) {
                  createdSubId = match.id
                  createdSubState = match.state
                } else {
                  throw new Error(`Subscription "${sub.productId}" already exists in App Store but could not be found in group`)
                }
              } else {
                throw createError
              }
            }

            await subDoc.ref.update({
              appStoreId: createdSubId,
              state: createdSubState || 'MISSING_METADATA',
              updatedAt: now,
            })

            for (const loc of localizations) {
              await appStoreHelper.upsertSubscriptionLocalization(createdSubId, loc.locale, {
                displayName: loc.displayName,
                description: loc.description,
              })
            }

            // Push availability and pricing if configured (strategy-aware)
            const pricingDoc = await subDoc.ref.collection('config').doc('pricing').get()
            const pricing = pricingDoc.exists ? pricingDoc.data() : null
            let pricingPushedOk = false
            if (pricing?.basePricePointId) {
              try {
                const strategyId = pricing.pricingStrategyId || pricing.strategy || 'equalized'
                const baseTerritory = pricing.baseTerritory || 'USA'

                // Resolve pricing with strategy
                const { basePricePointId: resolvedBaseId, territoryPrices } = await resolveSubscriptionPricingForPush({
                  appStoreHelper,
                  subscriptionId: createdSubId,
                  basePriceValue: pricing.basePricePointId,
                  baseTerritory,
                  strategyId,
                })

                // Availability must be set BEFORE pricing
                await appStoreHelper.setSubscriptionAvailability(createdSubId, true)

                // Set base territory price
                await appStoreHelper.setSubscriptionPrices(
                  createdSubId, resolvedBaseId, baseTerritory, false, true,
                )

                // Set prices for other territories
                for (const tp of territoryPrices) {
                  if (tp.territory === baseTerritory) continue
                  try {
                    await appStoreHelper.setSubscriptionPrices(
                      createdSubId, tp.pricePointId, tp.territory, false, true,
                    )
                  } catch {
                    // Non-fatal: individual territory price failures don't block the push
                  }
                }

                pricingPushedOk = true
                await subDoc.ref.update({ syncStatus: 'synced', updatedAt: now })
              } catch (pricingError) {
                const pricingErrMsg = pricingError instanceof Error ? pricingError.message : String(pricingError)
                errors.push({ id: sub.productId, error: `Pricing failed: ${pricingErrMsg}` })
                await subDoc.ref.update({ syncStatus: 'local_changes', updatedAt: now })
              }
            } else {
              await subDoc.ref.update({ syncStatus: 'synced', updatedAt: now })
            }

            // Push intro offer if configured (requires pricing to be set in Apple first)
            const introOfferDoc = await subDoc.ref.collection('config').doc('introOffer').get()
            if (introOfferDoc.exists) {
              const introOffer = introOfferDoc.data()
              if (introOffer?.offerMode) {
                if (!pricing?.basePricePointId && !pricingPushedOk) {
                  errors.push({ id: sub.productId, error: 'Intro offer skipped: no pricing configured. Set subscription pricing first.' })
                } else {
                  const introResult = await pushIntroOfferForSubscription(
                    appStoreHelper, createdSubId, introOffer, pricing, subDoc.ref
                  )
                  if (!introResult.success) {
                    errors.push({ id: sub.productId, error: `Intro offer: ${introResult.error}` })
                  }
                  if (introResult.warnings?.length) {
                    errors.push({ id: sub.productId, error: `Intro offer warnings: ${introResult.warnings.join('; ')}` })
                  }
                }
              }
            }

            // Re-fetch state after all operations
            try {
              const refreshed = await appStoreHelper.getSubscription(createdSubId)
              await subDoc.ref.update({ state: refreshed.state })
            } catch {
              // State will update on next pull
            }

            created.push(sub.productId)
          } else {
            await appStoreHelper.updateSubscription(sub.appStoreId, {
              name: sub.name,
              groupLevel: sub.groupLevel,
              familyShareable: sub.familyShareable,
            })

            for (const loc of localizations) {
              await appStoreHelper.upsertSubscriptionLocalization(sub.appStoreId, loc.locale, {
                displayName: loc.displayName,
                description: loc.description,
              })
            }

            // Push pricing if configured (strategy-aware)
            const pricingDoc = await subDoc.ref.collection('config').doc('pricing').get()
            const pricing = pricingDoc.exists ? pricingDoc.data() : null
            let pricingSynced = true
            if (pricing?.basePricePointId) {
              try {
                const strategyId = pricing.pricingStrategyId || pricing.strategy || 'equalized'
                const baseTerritory = pricing.baseTerritory || 'USA'

                const { basePricePointId: resolvedBaseId, territoryPrices } = await resolveSubscriptionPricingForPush({
                  appStoreHelper,
                  subscriptionId: sub.appStoreId,
                  basePriceValue: pricing.basePricePointId,
                  baseTerritory,
                  strategyId,
                })

                await appStoreHelper.setSubscriptionAvailability(sub.appStoreId, true)
                await appStoreHelper.setSubscriptionPrices(
                  sub.appStoreId, resolvedBaseId, baseTerritory, false, false,
                )

                // Set prices for other territories (only for new subs or strategy changes)
                for (const tp of territoryPrices) {
                  if (tp.territory === baseTerritory) continue
                  try {
                    await appStoreHelper.setSubscriptionPrices(
                      sub.appStoreId, tp.pricePointId, tp.territory, false, false,
                    )
                  } catch {
                    // Non-fatal
                  }
                }
              } catch (pricingError) {
                const pricingErrMsg = pricingError instanceof Error ? pricingError.message : String(pricingError)
                errors.push({ id: sub.productId, error: `Pricing failed: ${pricingErrMsg}` })
                pricingSynced = false
              }
            }

            // Push intro offer if configured (pricing must exist in Apple first)
            const introOfferDoc = await subDoc.ref.collection('config').doc('introOffer').get()
            debugLog(`[sync] Subscription ${sub.productId} (appStoreId=${sub.appStoreId}): introOffer doc exists=${introOfferDoc.exists}, pricingSynced=${pricingSynced}`)
            if (introOfferDoc.exists) {
              const introOffer = introOfferDoc.data()
              debugLog(`[sync] Intro offer data: ${JSON.stringify(introOffer)}`)
              if (introOffer?.offerMode) {
                debugLog(`[sync] Calling pushIntroOfferForSubscription...`)
                const introResult = await pushIntroOfferForSubscription(
                  appStoreHelper, sub.appStoreId, introOffer, pricing, subDoc.ref
                )
                debugLog(`[sync] Intro offer result: ${JSON.stringify(introResult)}`)
                if (!introResult.success) {
                  errors.push({ id: sub.productId, error: `Intro offer: ${introResult.error}` })
                  pricingSynced = false
                }
                if (introResult.warnings?.length) {
                  errors.push({ id: sub.productId, error: `Intro offer warnings: ${introResult.warnings.join('; ')}` })
                }
              }
            }

            // Re-fetch state after update
            try {
              const refreshed = await appStoreHelper.getSubscription(sub.appStoreId)
              await subDoc.ref.update({
                state: refreshed.state,
                syncStatus: pricingSynced ? 'synced' : 'local_changes',
                updatedAt: now,
              })
            } catch {
              await subDoc.ref.update({
                syncStatus: pricingSynced ? 'synced' : 'local_changes',
                updatedAt: now,
              })
            }
            updated.push(sub.productId)
          }
        } catch (error) {
          errors.push({ id: sub.productId, error: error instanceof Error ? error.message : 'Unknown error' })
        }
      }

      const processed = created.length + updated.length
      const hasErrors = errors.length > 0
      const nothingProcessed = processed === 0

      // Build informative message
      let message: string | undefined
      if (nothingProcessed && !hasErrors && skipped.length > 0) {
        message = `No items were pushed. ${skipped.length} item(s) were skipped: ${skipped.map(s => `${s.productId || s.id}: ${s.reason}`).join('; ')}`
      } else if (nothingProcessed && hasErrors) {
        message = `Push failed for all items. See errors for details.`
      } else if (nothingProcessed && skipped.length === 0 && requestedCount === 0) {
        message = 'No items to push. Provide iapIds, subscriptionIds, or set pushAll: true.'
      }

      debugLog(`[sync] RESULT: created=${created.length}, updated=${updated.length}, errors=${errors.length}, skipped=${skipped.length}`)
      if (errors.length > 0) debugLog(`[sync] Errors: ${JSON.stringify(errors)}`)
      if (skipped.length > 0) debugLog(`[sync] Skipped: ${JSON.stringify(skipped)}`)

      return {
        success: !hasErrors && processed > 0,
        message,
        summary: { created, updated, errors, skipped, requested: requestedCount, processed },
      }
    }
  } catch (error) {
    debugLog(`[sync] TOP-LEVEL ERROR: ${error instanceof Error ? error.message : String(error)}`)
    return { success: false, error: error instanceof Error ? error.message : 'Failed to sync IAP products' }
  }
}

// Translate IAP Product
export interface TranslateIAPProductParams {
  projectId: string
  iapId: string
  targetLocales?: string[]  // Optional - if not provided, translates all untranslated enabled locales
  force?: boolean
}

export interface TranslateIAPProductResult {
  success: boolean
  translations?: Array<{
    locale: string
    displayName: string
    description: string
    fromCache: boolean
  }>
  summary?: {
    total: number
    fromCache: number
    translated: number
  }
  error?: string
}

export async function translateIAPProduct(
  params: TranslateIAPProductParams,
  context: AccountContext
): Promise<TranslateIAPProductResult> {
  const { projectId, iapId, targetLocales: providedLocales, force = false } = params

  const projectContext = await getProjectContext(context.userId, projectId)
  if (!projectContext) {
    return { success: false, error: 'Project not found' }
  }

  if (!hasContextPermission(projectContext, 'canCreateProjects')) {
    return { success: false, error: 'Permission denied' }
  }

  let usageOperationId: string | undefined
  try {
    const basePath = projectContext.type === 'organization' && projectContext.orgId
      ? adminDb.collection('organizations').doc(projectContext.orgId).collection('projects').doc(projectId)
      : adminDb.collection('users').doc(context.userId).collection('projects').doc(projectId)

    const iapDoc = await basePath.collection('inAppPurchases').doc(iapId).get()
    if (!iapDoc.exists) {
      return { success: false, error: 'IAP not found' }
    }

    // Get project for primary locale and enabled locales
    const project = await basePath.get()
    const projectData = project.data()
    const primaryLocale = projectData?.primaryLocale || 'en-US'
    const enabledLocales: string[] = projectData?.enabledLocales || ['en-US']

    const primaryLocDoc = await basePath
      .collection('inAppPurchases')
      .doc(iapId)
      .collection('localizations')
      .doc(primaryLocale)
      .get()

    if (!primaryLocDoc.exists) {
      return { success: false, error: 'Primary locale localization not found. Add content for the primary locale first.' }
    }

    const primaryLoc = primaryLocDoc.data() as IAPLocalization

    // Auto-detect target locales if not provided
    let targetLocales = providedLocales
    if (!targetLocales || targetLocales.length === 0) {
      // Get existing localizations to find untranslated locales
      const existingLocsSnapshot = await basePath
        .collection('inAppPurchases')
        .doc(iapId)
        .collection('localizations')
        .get()

      const existingLocales = new Set(existingLocsSnapshot.docs.map(d => d.id))

      // Filter to enabled locales that don't have translations (excluding primary)
      targetLocales = enabledLocales.filter(locale =>
        locale !== primaryLocale && (force || !existingLocales.has(locale) || !existingLocsSnapshot.docs.find(d => d.id === locale)?.data()?.displayName)
      )

      if (targetLocales.length === 0) {
        return {
          success: true,
          translations: [],
          summary: { total: 0, fromCache: 0, translated: 0 },
          error: force ? undefined : 'All enabled locales already have translations'
        }
      }
    }

    // Get existing cache
    const cacheSnapshot = await basePath.collection('iapTranslations').get()
    const existingCache = new Map<string, IAPTranslationCache>()
    cacheSnapshot.docs.forEach(doc => {
      const data = doc.data() as IAPTranslationCache
      existingCache.set(`${data.locale}_${data.field}`, data)
    })

    const billableLocales = getIAPLocalesRequiringTranslation({
      sourceLocale: primaryLocale,
      targetLocales,
      displayName: primaryLoc.displayName,
      description: primaryLoc.description,
      existingCache: force ? undefined : existingCache,
      forceTranslate: force,
    })
    const usage = await reserveTranslationCredits(context, params, billableLocales.length, {
      tool: 'translate_iap_product',
      projectId,
      iapId,
    })
    if (usage.error) return { success: false, error: usage.error }
    usageOperationId = usage.operationId

    // Translate
    const results = await translateIAPFields({
      sourceLocale: primaryLocale,
      targetLocales,
      displayName: primaryLoc.displayName,
      description: primaryLoc.description,
      existingCache: force ? undefined : existingCache,
      forceTranslate: force,
    })

    // Save translations
    const batch = adminDb.batch()
    const now = Timestamp.now()

    for (const result of results) {
      const locRef = basePath
        .collection('inAppPurchases')
        .doc(iapId)
        .collection('localizations')
        .doc(result.locale)

      batch.set(locRef, {
        locale: result.locale,
        displayName: result.displayName,
        description: result.description,
      }, { merge: true })

      if (!result.fromCache) {
        batch.set(basePath.collection('iapTranslations').doc(`${iapId}_${result.locale}_displayName`), {
          locale: result.locale,
          field: 'displayName',
          sourceHash: result.sourceHash,
          translatedText: result.displayName,
          createdAt: now,
        })

        batch.set(basePath.collection('iapTranslations').doc(`${iapId}_${result.locale}_description`), {
          locale: result.locale,
          field: 'description',
          sourceHash: result.sourceHash,
          translatedText: result.description,
          createdAt: now,
        })
      }
    }

    await batch.commit()
    if (usageOperationId) {
      await settleUsage(
        context,
        usageOperationId,
        'translations',
        results.filter(result => !result.fromCache).length
      )
    }

    return {
      success: true,
      translations: results,
      summary: {
        total: results.length,
        fromCache: results.filter(r => r.fromCache).length,
        translated: results.filter(r => !r.fromCache).length,
      },
    }
  } catch (error) {
    if (usageOperationId) await refundUsage(context, usageOperationId, 'translations')
    return { success: false, error: error instanceof Error ? error.message : 'Failed to translate IAP product' }
  }
}

// Set IAP Pricing
export interface SetIAPPricingParams {
  projectId: string
  iapId: string
  basePricePointId: string
  baseTerritory?: string
  strategy: string
}

export interface SetIAPPricingResult {
  success: boolean
  preview?: PricingPreviewResult
  error?: string
}

export async function setIAPPricing(
  params: SetIAPPricingParams,
  context: AccountContext
): Promise<SetIAPPricingResult> {
  const { projectId, iapId, basePricePointId, baseTerritory = 'USA', strategy } = params

  const projectContext = await getProjectContext(context.userId, projectId)
  if (!projectContext) {
    return { success: false, error: 'Project not found' }
  }

  if (!hasContextPermission(projectContext, 'canCreateProjects')) {
    return { success: false, error: 'Permission denied' }
  }

  try {
    const basePath = projectContext.type === 'organization' && projectContext.orgId
      ? adminDb.collection('organizations').doc(projectContext.orgId).collection('projects').doc(projectId)
      : adminDb.collection('users').doc(context.userId).collection('projects').doc(projectId)

    // Check IAP exists
    const iapDoc = await basePath.collection('inAppPurchases').doc(iapId).get()
    if (!iapDoc.exists) {
      return { success: false, error: 'IAP not found' }
    }

    const appStoreHelper = await getAppStoreHelper(context.userId, projectId, projectContext.orgId)
    const calculator = new IAPPricingCalculator(appStoreHelper)

    const preview = await calculator.previewPricing({
      basePricePointId,
      baseTerritory,
      strategyId: strategy,
    })

    // Save pricing config to Firestore
    const pricingConfig = {
      baseTerritory,
      basePricePointId: preview.basePricePointId, // Use the resolved price point ID
      basePrice: preview.basePrice,
      baseCurrency: preview.baseCurrency,
      strategy,
      pricingStrategyId: strategy,
      updatedAt: Timestamp.now(),
    }

    await basePath
      .collection('inAppPurchases')
      .doc(iapId)
      .collection('config')
      .doc('pricing')
      .set(pricingConfig, { merge: true })

    // Mark IAP as having local changes
    await basePath.collection('inAppPurchases').doc(iapId).update({
      syncStatus: 'local_changes',
      updatedAt: Timestamp.now(),
    })

    return {
      success: true,
      preview,
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to set IAP pricing' }
  }
}

// Preview IAP Pricing
export interface PreviewIAPPricingParams {
  projectId: string
  basePricePointId: string
  baseTerritory?: string
  strategy: string
}

export interface PreviewIAPPricingResult {
  success: boolean
  preview?: PricingPreviewResult
  availableStrategies?: Array<{ id: string; name: string; description: string }>
  error?: string
}

export async function previewIAPPricing(
  params: PreviewIAPPricingParams,
  context: AccountContext
): Promise<PreviewIAPPricingResult> {
  const { projectId, basePricePointId, baseTerritory = 'USA', strategy } = params

  const projectContext = await getProjectContext(context.userId, projectId)
  if (!projectContext) {
    return { success: false, error: 'Project not found' }
  }

  try {
    const appStoreHelper = await getAppStoreHelper(context.userId, projectId, projectContext.orgId)
    const calculator = new IAPPricingCalculator(appStoreHelper)

    const preview = await calculator.previewPricing({
      basePricePointId,
      baseTerritory,
      strategyId: strategy,
    })

    return {
      success: true,
      preview,
      availableStrategies: getPricingStrategyOptions(),
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to preview IAP pricing' }
  }
}

// Update Subscription
export interface UpdateSubscriptionParams {
  projectId: string
  subscriptionId: string
  name?: string
  groupLevel?: number
  familyShareable?: boolean
  localizations?: Array<{
    locale: string
    displayName: string
    description: string
  }>
}

export interface UpdateSubscriptionResult {
  success: boolean
  subscription?: Subscription
  error?: string
}

export async function updateSubscription(
  params: UpdateSubscriptionParams,
  context: AccountContext
): Promise<UpdateSubscriptionResult> {
  const { projectId, subscriptionId, name, groupLevel, familyShareable, localizations } = params

  const projectContext = await getProjectContext(context.userId, projectId)
  if (!projectContext) {
    return { success: false, error: 'Project not found' }
  }

  if (!hasContextPermission(projectContext, 'canCreateProjects')) {
    return { success: false, error: 'Permission denied' }
  }

  try {
    const basePath = projectContext.type === 'organization' && projectContext.orgId
      ? adminDb.collection('organizations').doc(projectContext.orgId).collection('projects').doc(projectId)
      : adminDb.collection('users').doc(context.userId).collection('projects').doc(projectId)

    // Find the subscription
    const groupsSnapshot = await basePath.collection('subscriptionGroups').get()
    let subscriptionRef: FirebaseFirestore.DocumentReference | null = null
    let currentSub: Subscription | null = null

    for (const groupDoc of groupsSnapshot.docs) {
      const subDoc = await groupDoc.ref.collection('subscriptions').doc(subscriptionId).get()
      if (subDoc.exists) {
        subscriptionRef = subDoc.ref
        currentSub = { id: subDoc.id, ...subDoc.data() } as Subscription
        break
      }
    }

    if (!subscriptionRef || !currentSub) {
      return { success: false, error: 'Subscription not found' }
    }

    const now = Timestamp.now()
    const updates: Partial<Subscription> = { updatedAt: now }
    if (name !== undefined) updates.name = name
    if (groupLevel !== undefined) updates.groupLevel = groupLevel
    if (familyShareable !== undefined) updates.familyShareable = familyShareable

    if (currentSub.syncStatus === 'synced') {
      updates.syncStatus = 'local_changes'
    }

    await subscriptionRef.update(updates)

    // Update localizations
    if (localizations && localizations.length > 0) {
      const batch = adminDb.batch()
      for (const loc of localizations) {
        const locRef = subscriptionRef.collection('localizations').doc(loc.locale)
        batch.set(locRef, {
          locale: loc.locale,
          displayName: loc.displayName,
          description: loc.description,
        }, { merge: true })
      }
      await batch.commit()
    }

    const updatedDoc = await subscriptionRef.get()
    return { success: true, subscription: { id: updatedDoc.id, ...updatedDoc.data() } as Subscription }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to update subscription' }
  }
}

// Delete Subscription
export interface DeleteSubscriptionParams {
  projectId: string
  subscriptionId: string
  deleteFromStore?: boolean
}

export interface DeleteSubscriptionResult {
  success: boolean
  deleted?: string
  error?: string
}

export async function deleteSubscription(
  params: DeleteSubscriptionParams,
  context: AccountContext
): Promise<DeleteSubscriptionResult> {
  const { projectId, subscriptionId, deleteFromStore = false } = params

  const projectContext = await getProjectContext(context.userId, projectId)
  if (!projectContext) {
    return { success: false, error: 'Project not found' }
  }

  if (!hasContextPermission(projectContext, 'canCreateProjects')) {
    return { success: false, error: 'Permission denied' }
  }

  try {
    const basePath = projectContext.type === 'organization' && projectContext.orgId
      ? adminDb.collection('organizations').doc(projectContext.orgId).collection('projects').doc(projectId)
      : adminDb.collection('users').doc(context.userId).collection('projects').doc(projectId)

    // Find the subscription
    const groupsSnapshot = await basePath.collection('subscriptionGroups').get()
    let subscriptionRef: FirebaseFirestore.DocumentReference | null = null
    let subscription: Subscription | null = null

    for (const groupDoc of groupsSnapshot.docs) {
      const subDoc = await groupDoc.ref.collection('subscriptions').doc(subscriptionId).get()
      if (subDoc.exists) {
        subscriptionRef = subDoc.ref
        subscription = { id: subDoc.id, ...subDoc.data() } as Subscription
        break
      }
    }

    if (!subscriptionRef || !subscription) {
      return { success: false, error: 'Subscription not found' }
    }

    // Delete from App Store if requested
    if (deleteFromStore && subscription.appStoreId) {
      try {
        const appStoreHelper = await getAppStoreHelper(context.userId, projectId, projectContext.orgId)
        await appStoreHelper.deleteSubscription(subscription.appStoreId)
      } catch {
        // Continue with local deletion
      }
    }

    // Delete subcollections and subscription
    const collections = ['localizations', 'config', 'promotionalOffers']
    for (const collectionName of collections) {
      const snapshot = await subscriptionRef.collection(collectionName).get()
      const batch = adminDb.batch()
      snapshot.docs.forEach(doc => batch.delete(doc.ref))
      if (!snapshot.empty) {
        await batch.commit()
      }
    }

    await subscriptionRef.delete()

    return { success: true, deleted: subscription.productId }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to delete subscription' }
  }
}

// Translate Subscription
export interface TranslateSubscriptionParams {
  projectId: string
  subscriptionId: string
  targetLocales?: string[]  // Optional - if not provided, translates all untranslated enabled locales
  force?: boolean
}

export interface TranslateSubscriptionResult {
  success: boolean
  translations?: Array<{
    locale: string
    displayName: string
    description: string
    fromCache: boolean
  }>
  summary?: {
    total: number
    fromCache: number
    translated: number
  }
  error?: string
}

export async function translateSubscription(
  params: TranslateSubscriptionParams,
  context: AccountContext
): Promise<TranslateSubscriptionResult> {
  const { projectId, subscriptionId, targetLocales: providedLocales, force = false } = params

  const projectContext = await getProjectContext(context.userId, projectId)
  if (!projectContext) {
    return { success: false, error: 'Project not found' }
  }

  if (!hasContextPermission(projectContext, 'canCreateProjects')) {
    return { success: false, error: 'Permission denied' }
  }

  let usageOperationId: string | undefined
  try {
    const basePath = projectContext.type === 'organization' && projectContext.orgId
      ? adminDb.collection('organizations').doc(projectContext.orgId).collection('projects').doc(projectId)
      : adminDb.collection('users').doc(context.userId).collection('projects').doc(projectId)

    // Find the subscription
    const groupsSnapshot = await basePath.collection('subscriptionGroups').get()
    let subscriptionRef: FirebaseFirestore.DocumentReference | null = null

    for (const groupDoc of groupsSnapshot.docs) {
      const subDoc = await groupDoc.ref.collection('subscriptions').doc(subscriptionId).get()
      if (subDoc.exists) {
        subscriptionRef = subDoc.ref
        break
      }
    }

    if (!subscriptionRef) {
      return { success: false, error: 'Subscription not found' }
    }

    // Get project for primary locale and enabled locales
    const project = await basePath.get()
    const projectData = project.data()
    const primaryLocale = projectData?.primaryLocale || 'en-US'
    const enabledLocales: string[] = projectData?.enabledLocales || ['en-US']

    const primaryLocDoc = await subscriptionRef.collection('localizations').doc(primaryLocale).get()

    if (!primaryLocDoc.exists) {
      return { success: false, error: 'Primary locale localization not found. Add content for the primary locale first.' }
    }

    const primaryLoc = primaryLocDoc.data() as IAPLocalization

    // Auto-detect target locales if not provided
    let targetLocales = providedLocales
    if (!targetLocales || targetLocales.length === 0) {
      const existingLocsSnapshot = await subscriptionRef.collection('localizations').get()
      const existingLocales = new Set(existingLocsSnapshot.docs.map(d => d.id))

      targetLocales = enabledLocales.filter(locale =>
        locale !== primaryLocale && (force || !existingLocales.has(locale) || !existingLocsSnapshot.docs.find(d => d.id === locale)?.data()?.displayName)
      )

      if (targetLocales.length === 0) {
        return {
          success: true,
          translations: [],
          summary: { total: 0, fromCache: 0, translated: 0 },
          error: force ? undefined : 'All enabled locales already have translations'
        }
      }
    }

    // Get existing cache
    const cacheSnapshot = await basePath.collection('iapTranslations').get()
    const existingCache = new Map<string, IAPTranslationCache>()
    cacheSnapshot.docs.forEach(doc => {
      const data = doc.data() as IAPTranslationCache
      existingCache.set(`${data.locale}_${data.field}`, data)
    })

    const billableLocales = getIAPLocalesRequiringTranslation({
      sourceLocale: primaryLocale,
      targetLocales,
      displayName: primaryLoc.displayName,
      description: primaryLoc.description,
      existingCache: force ? undefined : existingCache,
      forceTranslate: force,
    })
    const usage = await reserveTranslationCredits(context, params, billableLocales.length, {
      tool: 'translate_subscription',
      projectId,
      subscriptionId,
    })
    if (usage.error) return { success: false, error: usage.error }
    usageOperationId = usage.operationId

    // Translate
    const results = await translateIAPFields({
      sourceLocale: primaryLocale,
      targetLocales,
      displayName: primaryLoc.displayName,
      description: primaryLoc.description,
      existingCache: force ? undefined : existingCache,
      forceTranslate: force,
    })

    // Save translations
    const batch = adminDb.batch()
    const now = Timestamp.now()

    for (const result of results) {
      const locRef = subscriptionRef.collection('localizations').doc(result.locale)

      batch.set(locRef, {
        locale: result.locale,
        displayName: result.displayName,
        description: result.description,
      }, { merge: true })

      if (!result.fromCache) {
        batch.set(basePath.collection('iapTranslations').doc(`${subscriptionId}_${result.locale}_displayName`), {
          locale: result.locale,
          field: 'displayName',
          sourceHash: result.sourceHash,
          translatedText: result.displayName,
          createdAt: now,
        })

        batch.set(basePath.collection('iapTranslations').doc(`${subscriptionId}_${result.locale}_description`), {
          locale: result.locale,
          field: 'description',
          sourceHash: result.sourceHash,
          translatedText: result.description,
          createdAt: now,
        })
      }
    }

    await batch.commit()
    if (usageOperationId) {
      await settleUsage(
        context,
        usageOperationId,
        'translations',
        results.filter(result => !result.fromCache).length
      )
    }

    return {
      success: true,
      translations: results,
      summary: {
        total: results.length,
        fromCache: results.filter(r => r.fromCache).length,
        translated: results.filter(r => !r.fromCache).length,
      },
    }
  } catch (error) {
    if (usageOperationId) await refundUsage(context, usageOperationId, 'translations')
    return { success: false, error: error instanceof Error ? error.message : 'Failed to translate subscription' }
  }
}

// Helper: Push intro offer to App Store Connect for a subscription
// Creates intro offers for the base territory + all equalized territories
async function pushIntroOfferForSubscription(
  appStoreHelper: Awaited<ReturnType<typeof getAppStoreHelper>>,
  appStoreId: string,
  introOffer: FirebaseFirestore.DocumentData,
  pricingConfig: FirebaseFirestore.DocumentData | null | undefined,
  subscriptionRef: FirebaseFirestore.DocumentReference
): Promise<{ success: boolean; error?: string; warnings?: string[] }> {
  const baseTerritory = pricingConfig?.baseTerritory || 'USA'
  const warnings: string[] = []

  debugLog(`=== pushIntroOfferForSubscription START ===`)
  debugLog(`appStoreId=${appStoreId}, offerMode=${introOffer.offerMode}, duration=${introOffer.duration}, numberOfPeriods=${introOffer.numberOfPeriods} (type: ${typeof introOffer.numberOfPeriods})`)
  debugLog(`pricingConfig: ${JSON.stringify(pricingConfig ? { basePricePointId: pricingConfig.basePricePointId, baseTerritory: pricingConfig.baseTerritory, strategy: pricingConfig.pricingStrategyId || pricingConfig.strategy } : null)}`)

  // PREREQUISITE: Apple requires pricing to be set before intro offers can be created.
  // Check if the subscription has any active prices in App Store Connect.
  try {
    const existingPrices = await appStoreHelper.getSubscriptionPrices(appStoreId)
    debugLog(`Existing prices in Apple: ${existingPrices.length} territories`)
    if (existingPrices.length === 0) {
      debugLog(`FAIL: No pricing set in Apple`)
      return {
        success: false,
        error: 'Subscription has no pricing set in App Store Connect. Pricing must be configured before adding intro offers. Push pricing first, then retry.',
      }
    }
  } catch (priceCheckErr: any) {
    debugLog(`WARNING: Price check failed: ${priceCheckErr?.message || String(priceCheckErr)}`)
    warnings.push(`Could not verify pricing prerequisite: ${priceCheckErr?.message || String(priceCheckErr)}`)
  }

  // Delete existing intro offers first
  const existingOffers = await appStoreHelper.listIntroductoryOffers(appStoreId)
  debugLog(`Existing intro offers to delete: ${existingOffers.length}`)
  for (const offer of existingOffers) {
    try {
      await appStoreHelper.deleteIntroductoryOffer(offer.id)
      debugLog(`Deleted intro offer ${offer.id}`)
    } catch (delErr: any) {
      debugLog(`Failed to delete intro offer ${offer.id}: ${delErr?.message}`)
    }
  }

  // Resolve the price point for the intro offer
  const pricePoints = await appStoreHelper.getSubscriptionPricePoints(appStoreId, baseTerritory)
  debugLog(`Price points for ${baseTerritory}: ${pricePoints.length} (first 3: ${pricePoints.slice(0, 3).map(pp => `${pp.customerPrice}=${pp.id}`).join(', ')})`)
  if (pricePoints.length === 0) {
    debugLog(`FAIL: No price points available`)
    return { success: false, error: 'No price points available for intro offer' }
  }

  let basePricePointId: string
  if (introOffer.offerMode === 'FREE_TRIAL') {
    // FREE_TRIAL doesn't need a $0 price point — Apple charges nothing during the trial
    // regardless of the price point. Use the subscription's actual price for the territory.
    if (pricingConfig?.basePricePointId) {
      const basePrice = parseFloat(pricingConfig.basePricePointId)
      if (!isNaN(basePrice)) {
        const match = pricePoints.find(pp => Math.abs(parseFloat(pp.customerPrice) - basePrice) < 0.01)
        basePricePointId = match?.id || pricePoints[0].id
        debugLog(`FREE_TRIAL: Using subscription price point $${match?.customerPrice || 'fallback'} = ${basePricePointId}`)
      } else {
        basePricePointId = pricePoints[0].id
        debugLog(`FREE_TRIAL: basePricePointId not numeric, using first price point = ${basePricePointId}`)
      }
    } else {
      basePricePointId = pricePoints[0].id
      debugLog(`FREE_TRIAL: No pricing config, using first price point = ${basePricePointId}`)
    }
  } else if (introOffer.subscriptionPricePointId) {
    basePricePointId = introOffer.subscriptionPricePointId
  } else if (pricingConfig?.basePricePointId) {
    const basePrice = parseFloat(pricingConfig.basePricePointId)
    if (!isNaN(basePrice)) {
      const match = pricePoints.find(pp => Math.abs(parseFloat(pp.customerPrice) - basePrice) < 0.01)
      basePricePointId = match?.id || pricePoints[0].id
    } else {
      basePricePointId = pricePoints[0].id
    }
  } else {
    basePricePointId = pricePoints[0].id
  }

  // Coerce numberOfPeriods to a number (MCP may pass it as a string)
  const numberOfPeriods = typeof introOffer.numberOfPeriods === 'string'
    ? parseInt(introOffer.numberOfPeriods, 10) || 1
    : introOffer.numberOfPeriods || 1

  // Default startDate to today if missing (Apple requires it)
  const startDate = introOffer.startDate || new Date().toISOString().split('T')[0]

  // Create intro offer for base territory
  const offerParams = {
    offerMode: introOffer.offerMode,
    duration: introOffer.duration,
    numberOfPeriods,
    pricePointId: basePricePointId,
    territoryId: baseTerritory,
    startDate,
    endDate: introOffer.endDate || undefined,
  }

  debugLog(`Creating base territory intro offer: ${JSON.stringify(offerParams)}`)

  let created: { id: string }
  try {
    created = await appStoreHelper.createIntroductoryOffer(appStoreId, offerParams)
    debugLog(`SUCCESS: Created intro offer ${created.id} for ${baseTerritory}`)
  } catch (err: any) {
    debugLog(`FAIL: Base territory create failed: ${err?.message || String(err)}`)
    return { success: false, error: `Failed to create intro offer for base territory ${baseTerritory}: ${err?.message || String(err)}` }
  }

  // Save the Apple ID back to Firestore
  await subscriptionRef.collection('config').doc('introOffer').update({
    appStoreId: created.id,
  })

  // For FREE_TRIAL: use equalization on the $0 price point to get all territory $0 price points
  // in a single API call, instead of fetching price points per-territory (~169 extra calls).
  // For paid intro offers: use equalization on the base price point to get territory prices.
  let territoryPriceMap: Map<string, string> = new Map()

  debugLog(`Getting equalizations for price point ${basePricePointId}...`)
  try {
    const equalizations = await appStoreHelper.getSubscriptionPriceEqualizations(appStoreId, basePricePointId)
    debugLog(`Got ${equalizations.length} equalizations`)
    for (const eq of equalizations) {
      if (eq.territory !== baseTerritory && eq.territory !== 'unknown') {
        territoryPriceMap.set(eq.territory, eq.pricePointId)
      }
    }
  } catch (err: any) {
    debugLog(`FAIL: Equalizations failed: ${err?.message || String(err)}`)
    warnings.push(`Could not get equalizations — intro offer set for ${baseTerritory} only: ${err?.message || String(err)}`)
    return { success: true, warnings }
  }

  // Create intro offers for other territories in batches
  const territories = Array.from(territoryPriceMap.entries())
  debugLog(`Creating intro offers for ${territories.length} territories in batches of 10...`)
  const BATCH_SIZE = 10
  let failedTerritories = 0
  let successTerritories = 0
  for (let i = 0; i < territories.length; i += BATCH_SIZE) {
    const batch = territories.slice(i, i + BATCH_SIZE)
    await Promise.all(batch.map(async ([territory, pricePointId]) => {
      try {
        await appStoreHelper.createIntroductoryOffer(appStoreId, {
          ...offerParams,
          pricePointId,
          territoryId: territory,
        })
        successTerritories++
      } catch (err: any) {
        failedTerritories++
        const errMsg = err?.message || String(err)
        if (!errMsg.includes('overlaps')) {
          if (failedTerritories <= 3) { // Only log first 3 failures in detail
            debugLog(`FAIL territory ${territory}: ${errMsg}`)
            warnings.push(`Intro offer failed for ${territory}: ${errMsg}`)
          }
        }
      }
    }))
    debugLog(`Batch progress: ${Math.min(i + BATCH_SIZE, territories.length)}/${territories.length} (${successTerritories} ok, ${failedTerritories} failed)`)
  }

  if (failedTerritories > 0) {
    warnings.push(`${failedTerritories}/${territories.length} territories failed for intro offer`)
  }

  debugLog(`=== pushIntroOfferForSubscription DONE: ${successTerritories + 1} ok, ${failedTerritories} failed ===`)
  return { success: true, warnings: warnings.length > 0 ? warnings : undefined }
}

// Set Introductory Offer
export interface SetIntroOfferParams {
  projectId: string
  subscriptionId: string
  offerMode: 'PAY_AS_YOU_GO' | 'PAY_UP_FRONT' | 'FREE_TRIAL'
  duration: string
  numberOfPeriods: number
  startDate: string
  endDate?: string | null
}

export interface SetIntroOfferResult {
  success: boolean
  introOffer?: {
    offerMode: string
    duration: string
    numberOfPeriods: number
    startDate: string | null
    endDate: string | null
  }
  error?: string
}

export async function setIntroOffer(
  params: SetIntroOfferParams,
  context: AccountContext
): Promise<SetIntroOfferResult> {
  const { projectId, subscriptionId, offerMode, duration, numberOfPeriods, startDate, endDate } = params

  if (!startDate) {
    return { success: false, error: 'startDate is required. Provide an ISO date string (e.g. "2025-03-01").' }
  }

  const projectContext = await getProjectContext(context.userId, projectId)
  if (!projectContext) {
    return { success: false, error: 'Project not found' }
  }

  if (!hasContextPermission(projectContext, 'canCreateProjects')) {
    return { success: false, error: 'Permission denied' }
  }

  try {
    const basePath = projectContext.type === 'organization' && projectContext.orgId
      ? adminDb.collection('organizations').doc(projectContext.orgId).collection('projects').doc(projectId)
      : adminDb.collection('users').doc(context.userId).collection('projects').doc(projectId)

    // Find the subscription
    const groupsSnapshot = await basePath.collection('subscriptionGroups').get()
    let subscriptionRef: FirebaseFirestore.DocumentReference | null = null

    for (const groupDoc of groupsSnapshot.docs) {
      const subDoc = await groupDoc.ref.collection('subscriptions').doc(subscriptionId).get()
      if (subDoc.exists) {
        subscriptionRef = subDoc.ref
        break
      }
    }

    if (!subscriptionRef) {
      return { success: false, error: 'Subscription not found' }
    }

    // Coerce numberOfPeriods to a number (MCP may pass it as a string)
    const resolvedPeriods = typeof numberOfPeriods === 'string'
      ? parseInt(numberOfPeriods as string, 10) || 1
      : numberOfPeriods || 1

    const introOfferData = {
      offerMode,
      duration,
      numberOfPeriods: resolvedPeriods,
      startDate: startDate || null,
      endDate: endDate || null,
      appStoreId: null,
      updatedAt: Timestamp.now(),
    }

    await subscriptionRef.collection('config').doc('introOffer').set(introOfferData, { merge: true })

    // Mark subscription as having local changes
    await subscriptionRef.update({ syncStatus: 'local_changes' })

    return { success: true, introOffer: introOfferData }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to set intro offer' }
  }
}

// Delete Introductory Offer
export interface DeleteIntroOfferParams {
  projectId: string
  subscriptionId: string
}

export interface DeleteIntroOfferResult {
  success: boolean
  error?: string
}

export async function deleteIntroOffer(
  params: DeleteIntroOfferParams,
  context: AccountContext
): Promise<DeleteIntroOfferResult> {
  const { projectId, subscriptionId } = params

  const projectContext = await getProjectContext(context.userId, projectId)
  if (!projectContext) {
    return { success: false, error: 'Project not found' }
  }

  if (!hasContextPermission(projectContext, 'canCreateProjects')) {
    return { success: false, error: 'Permission denied' }
  }

  try {
    const basePath = projectContext.type === 'organization' && projectContext.orgId
      ? adminDb.collection('organizations').doc(projectContext.orgId).collection('projects').doc(projectId)
      : adminDb.collection('users').doc(context.userId).collection('projects').doc(projectId)

    // Find the subscription
    const groupsSnapshot = await basePath.collection('subscriptionGroups').get()
    let subscriptionRef: FirebaseFirestore.DocumentReference | null = null

    for (const groupDoc of groupsSnapshot.docs) {
      const subDoc = await groupDoc.ref.collection('subscriptions').doc(subscriptionId).get()
      if (subDoc.exists) {
        subscriptionRef = subDoc.ref
        break
      }
    }

    if (!subscriptionRef) {
      return { success: false, error: 'Subscription not found' }
    }

    await subscriptionRef.collection('config').doc('introOffer').delete()
    await subscriptionRef.update({ syncStatus: 'local_changes' })

    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to delete intro offer' }
  }
}

// Create Promotional Offer
export interface CreatePromoOfferParams {
  projectId: string
  subscriptionId: string
  name: string
  offerCode?: string
  offerMode: 'PAY_AS_YOU_GO' | 'PAY_UP_FRONT' | 'FREE_TRIAL'
  duration: string
  numberOfPeriods: number
  customerEligibility: 'NEW' | 'EXISTING' | 'EXPIRED'
  startDate?: string | null
  endDate?: string | null
}

export interface CreatePromoOfferResult {
  success: boolean
  offer?: {
    id: string
    name: string
    offerCode: string | null
    offerMode: string
    duration: string
    numberOfPeriods: number
    customerEligibility: string
  }
  error?: string
}

export async function createPromoOffer(
  params: CreatePromoOfferParams,
  context: AccountContext
): Promise<CreatePromoOfferResult> {
  const { projectId, subscriptionId, name, offerCode, offerMode, duration, numberOfPeriods, customerEligibility, startDate, endDate } = params

  const projectContext = await getProjectContext(context.userId, projectId)
  if (!projectContext) {
    return { success: false, error: 'Project not found' }
  }

  if (!hasContextPermission(projectContext, 'canCreateProjects')) {
    return { success: false, error: 'Permission denied' }
  }

  try {
    const basePath = projectContext.type === 'organization' && projectContext.orgId
      ? adminDb.collection('organizations').doc(projectContext.orgId).collection('projects').doc(projectId)
      : adminDb.collection('users').doc(context.userId).collection('projects').doc(projectId)

    // Find the subscription
    const groupsSnapshot = await basePath.collection('subscriptionGroups').get()
    let subscriptionRef: FirebaseFirestore.DocumentReference | null = null

    for (const groupDoc of groupsSnapshot.docs) {
      const subDoc = await groupDoc.ref.collection('subscriptions').doc(subscriptionId).get()
      if (subDoc.exists) {
        subscriptionRef = subDoc.ref
        break
      }
    }

    if (!subscriptionRef) {
      return { success: false, error: 'Subscription not found' }
    }

    const now = Timestamp.now()
    const offerData = {
      name,
      offerCode: offerCode || null,
      offerMode,
      duration,
      numberOfPeriods,
      customerEligibility,
      startDate: startDate || null,
      endDate: endDate || null,
      appStoreId: null,
      createdAt: now,
      updatedAt: now,
    }

    const offerRef = await subscriptionRef.collection('promotionalOffers').add(offerData)

    return {
      success: true,
      offer: {
        id: offerRef.id,
        name,
        offerCode: offerCode || null,
        offerMode,
        duration,
        numberOfPeriods,
        customerEligibility,
      },
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to create promo offer' }
  }
}

// List Promotional Offers
export interface ListPromoOffersParams {
  projectId: string
  subscriptionId: string
}

export interface ListPromoOffersResult {
  success: boolean
  offers?: Array<{
    id: string
    name: string
    offerCode: string | null
    offerMode: string
    duration: string
    numberOfPeriods: number
    customerEligibility: string
  }>
  error?: string
}

export async function listPromoOffers(
  params: ListPromoOffersParams,
  context: AccountContext
): Promise<ListPromoOffersResult> {
  const { projectId, subscriptionId } = params

  const projectContext = await getProjectContext(context.userId, projectId)
  if (!projectContext) {
    return { success: false, error: 'Project not found' }
  }

  try {
    const basePath = projectContext.type === 'organization' && projectContext.orgId
      ? adminDb.collection('organizations').doc(projectContext.orgId).collection('projects').doc(projectId)
      : adminDb.collection('users').doc(context.userId).collection('projects').doc(projectId)

    // Find the subscription
    const groupsSnapshot = await basePath.collection('subscriptionGroups').get()
    let subscriptionRef: FirebaseFirestore.DocumentReference | null = null

    for (const groupDoc of groupsSnapshot.docs) {
      const subDoc = await groupDoc.ref.collection('subscriptions').doc(subscriptionId).get()
      if (subDoc.exists) {
        subscriptionRef = subDoc.ref
        break
      }
    }

    if (!subscriptionRef) {
      return { success: false, error: 'Subscription not found' }
    }

    const offersSnapshot = await subscriptionRef.collection('promotionalOffers').get()
    const offers = offersSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
    })) as ListPromoOffersResult['offers']

    return { success: true, offers }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to list promo offers' }
  }
}

// Translate Subscription Group
export interface TranslateSubscriptionGroupParams {
  projectId: string
  groupId: string
  targetLocales?: string[]  // Optional - if not provided, translates all untranslated enabled locales
  force?: boolean
}

export interface TranslateSubscriptionGroupResult {
  success: boolean
  translations?: Array<{
    locale: string
    name: string
    fromCache: boolean
  }>
  summary?: {
    total: number
    fromCache: number
    translated: number
  }
  error?: string
}

export async function translateSubscriptionGroup(
  params: TranslateSubscriptionGroupParams,
  context: AccountContext
): Promise<TranslateSubscriptionGroupResult> {
  const { projectId, groupId, targetLocales: providedLocales, force = false } = params

  const projectContext = await getProjectContext(context.userId, projectId)
  if (!projectContext) {
    return { success: false, error: 'Project not found' }
  }

  if (!hasContextPermission(projectContext, 'canCreateProjects')) {
    return { success: false, error: 'Permission denied' }
  }

  let usageOperationId: string | undefined
  try {
    const basePath = projectContext.type === 'organization' && projectContext.orgId
      ? adminDb.collection('organizations').doc(projectContext.orgId).collection('projects').doc(projectId)
      : adminDb.collection('users').doc(context.userId).collection('projects').doc(projectId)

    const groupRef = basePath.collection('subscriptionGroups').doc(groupId)
    const groupDoc = await groupRef.get()

    if (!groupDoc.exists) {
      return { success: false, error: 'Subscription group not found' }
    }

    // Get project for primary locale and enabled locales
    const project = await basePath.get()
    const projectData = project.data()
    const primaryLocale = projectData?.primaryLocale || 'en-US'
    const enabledLocales: string[] = projectData?.enabledLocales || ['en-US']

    // Get primary locale localization
    const primaryLocDoc = await groupRef.collection('localizations').doc(primaryLocale).get()

    if (!primaryLocDoc.exists || !primaryLocDoc.data()?.name) {
      return { success: false, error: 'Primary locale localization not found. Add content for the primary locale first.' }
    }

    const primaryLoc = primaryLocDoc.data() as { name: string; customAppName?: string | null }

    // Auto-detect target locales if not provided
    let targetLocales = providedLocales
    if (!targetLocales || targetLocales.length === 0) {
      const existingLocsSnapshot = await groupRef.collection('localizations').get()
      const existingLocales = new Set(existingLocsSnapshot.docs.map(d => d.id))

      targetLocales = enabledLocales.filter(locale =>
        locale !== primaryLocale && (force || !existingLocales.has(locale) || !existingLocsSnapshot.docs.find(d => d.id === locale)?.data()?.name)
      )

      if (targetLocales.length === 0) {
        return {
          success: true,
          translations: [],
          summary: { total: 0, fromCache: 0, translated: 0 },
          error: force ? undefined : 'All enabled locales already have translations'
        }
      }
    }

    const cacheSnapshot = await basePath.collection('groupTranslations').get()
    const existingCache = new Map<string, GroupTranslationCache>()
    cacheSnapshot.docs.forEach(doc => {
      const data = doc.data()
      existingCache.set(`${data.locale}_${data.field}`, {
        sourceHash: data.sourceHash,
        translatedText: data.translatedText,
      })
    })

    const billableLocales = getGroupLocalesRequiringTranslation({
      sourceLocale: primaryLocale,
      targetLocales,
      name: primaryLoc.name,
      existingCache: force ? undefined : existingCache,
      forceTranslate: force,
    })
    const usage = await reserveTranslationCredits(context, params, billableLocales.length, {
      tool: 'translate_subscription_group',
      projectId,
      groupId,
    })
    if (usage.error) return { success: false, error: usage.error }
    usageOperationId = usage.operationId

    const translations = await translateGroupNames({
      sourceLocale: primaryLocale,
      targetLocales,
      name: primaryLoc.name,
      existingCache: force ? undefined : existingCache,
      forceTranslate: force,
    })

    const batch = adminDb.batch()
    const now = Timestamp.now()
    for (const translation of translations) {
      batch.set(groupRef.collection('localizations').doc(translation.locale), {
        locale: translation.locale,
        name: translation.name,
        customAppName: primaryLoc.customAppName || null,
      }, { merge: true })

      if (!translation.fromCache) {
        batch.set(basePath.collection('groupTranslations').doc(`group_${groupId}_${translation.locale}_name`), {
          locale: translation.locale,
          field: 'name',
          sourceHash: translation.sourceHash,
          translatedText: translation.name,
          createdAt: now,
        })
      }
    }
    batch.update(groupRef, { syncStatus: 'local_changes', updatedAt: now })
    await batch.commit()

    if (usageOperationId) {
      await settleUsage(
        context,
        usageOperationId,
        'translations',
        translations.filter(translation => !translation.fromCache).length
      )
    }

    return {
      success: true,
      translations,
      summary: {
        total: translations.length,
        fromCache: translations.filter(translation => translation.fromCache).length,
        translated: translations.filter(translation => !translation.fromCache).length,
      },
    }
  } catch (error) {
    if (usageOperationId) await refundUsage(context, usageOperationId, 'translations')
    return { success: false, error: error instanceof Error ? error.message : 'Failed to translate subscription group' }
  }
}

// List Subscription Groups
export interface ListSubscriptionGroupsParams {
  projectId: string
}

export interface ListSubscriptionGroupsResult {
  success: boolean
  groups?: Array<{
    id: string
    appStoreId: string | null
    referenceName: string
    syncStatus: string
    subscriptionCount: number
  }>
  error?: string
}

export async function listSubscriptionGroups(
  params: ListSubscriptionGroupsParams,
  context: AccountContext
): Promise<ListSubscriptionGroupsResult> {
  const { projectId } = params

  const projectContext = await getProjectContext(context.userId, projectId)
  if (!projectContext) {
    return { success: false, error: 'Project not found' }
  }

  try {
    const basePath = projectContext.type === 'organization' && projectContext.orgId
      ? adminDb.collection('organizations').doc(projectContext.orgId).collection('projects').doc(projectId)
      : adminDb.collection('users').doc(context.userId).collection('projects').doc(projectId)

    const groupsSnapshot = await basePath.collection('subscriptionGroups').get()

    const groups = await Promise.all(groupsSnapshot.docs.map(async doc => {
      const subsSnapshot = await doc.ref.collection('subscriptions').get()
      return {
        id: doc.id,
        appStoreId: doc.data().appStoreId || null,
        referenceName: doc.data().referenceName,
        syncStatus: doc.data().syncStatus,
        subscriptionCount: subsSnapshot.size,
      }
    }))

    return { success: true, groups }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to list subscription groups' }
  }
}

// Update Subscription Group
export interface UpdateSubscriptionGroupParams {
  projectId: string
  groupId: string
  referenceName?: string
  localizations?: Array<{
    locale: string
    name: string
    customAppName?: string | null
  }>
}

export interface UpdateSubscriptionGroupResult {
  success: boolean
  group?: {
    id: string
    referenceName: string
    syncStatus: string
  }
  error?: string
}

export async function updateSubscriptionGroup(
  params: UpdateSubscriptionGroupParams,
  context: AccountContext
): Promise<UpdateSubscriptionGroupResult> {
  const { projectId, groupId, referenceName, localizations } = params

  const projectContext = await getProjectContext(context.userId, projectId)
  if (!projectContext) {
    return { success: false, error: 'Project not found' }
  }

  if (!hasContextPermission(projectContext, 'canCreateProjects')) {
    return { success: false, error: 'Permission denied' }
  }

  try {
    const basePath = projectContext.type === 'organization' && projectContext.orgId
      ? adminDb.collection('organizations').doc(projectContext.orgId).collection('projects').doc(projectId)
      : adminDb.collection('users').doc(context.userId).collection('projects').doc(projectId)

    const groupRef = basePath.collection('subscriptionGroups').doc(groupId)
    const groupDoc = await groupRef.get()

    if (!groupDoc.exists) {
      return { success: false, error: 'Subscription group not found' }
    }

    const now = Timestamp.now()
    const updates: Record<string, any> = { updatedAt: now }

    if (referenceName !== undefined) {
      updates.referenceName = referenceName
    }

    if (groupDoc.data()?.syncStatus === 'synced') {
      updates.syncStatus = 'local_changes'
    }

    await groupRef.update(updates)

    // Update localizations
    if (localizations && localizations.length > 0) {
      const batch = adminDb.batch()
      for (const loc of localizations) {
        const locRef = groupRef.collection('localizations').doc(loc.locale)
        batch.set(locRef, {
          locale: loc.locale,
          name: loc.name,
          customAppName: loc.customAppName || null,
        }, { merge: true })
      }
      await batch.commit()
    }

    const updatedDoc = await groupRef.get()
    return {
      success: true,
      group: {
        id: updatedDoc.id,
        referenceName: updatedDoc.data()?.referenceName,
        syncStatus: updatedDoc.data()?.syncStatus,
      },
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to update subscription group' }
  }
}

// Validate IAP for Push (check required fields)
export interface ValidateIAPForPushParams {
  projectId: string
  iapIds?: string[]
  subscriptionIds?: string[]
}

export interface ValidateIAPForPushResult {
  success: boolean
  valid: Array<{
    id: string
    productId: string
    type: 'iap' | 'subscription'
    syncStatus: string
    state: string | null
  }>
  invalid: Array<{
    id: string
    productId: string
    type: 'iap' | 'subscription'
    missingFields: string[]
    syncStatus: string
    state: string | null
  }>
  warnings: Array<{
    id: string
    productId: string
    type: 'iap' | 'subscription'
    warning: string
  }>
  error?: string
}

export async function validateIAPForPush(
  params: ValidateIAPForPushParams,
  context: AccountContext
): Promise<ValidateIAPForPushResult> {
  const { projectId, iapIds, subscriptionIds } = params

  const projectContext = await getProjectContext(context.userId, projectId)
  if (!projectContext) {
    return { success: false, valid: [], invalid: [], warnings: [], error: 'Project not found' }
  }

  try {
    const basePath = projectContext.type === 'organization' && projectContext.orgId
      ? adminDb.collection('organizations').doc(projectContext.orgId).collection('projects').doc(projectId)
      : adminDb.collection('users').doc(context.userId).collection('projects').doc(projectId)

    const valid: ValidateIAPForPushResult['valid'] = []
    const invalid: ValidateIAPForPushResult['invalid'] = []
    const warnings: ValidateIAPForPushResult['warnings'] = []

    // Validate IAPs
    if (iapIds && iapIds.length > 0) {
      for (const iapId of iapIds) {
        const iapDoc = await basePath.collection('inAppPurchases').doc(iapId).get()
        if (!iapDoc.exists) {
          warnings.push({ id: iapId, productId: 'unknown', type: 'iap', warning: 'IAP not found in project' })
          continue
        }

        const iap = iapDoc.data() as InAppPurchase
        const missingFields: string[] = []

        // Check if it's a subscription type in the IAP collection
        if (iap.productType === 'AUTO_RENEWABLE_SUBSCRIPTION') {
          warnings.push({
            id: iapId,
            productId: iap.productId,
            type: 'iap',
            warning: 'This is an auto-renewable subscription. Use subscriptionIds instead of iapIds to push it.',
          })
          continue
        }

        // Check syncStatus
        if (iap.syncStatus === 'synced') {
          warnings.push({
            id: iapId,
            productId: iap.productId,
            type: 'iap',
            warning: `Already synced (syncStatus: ${iap.syncStatus}). Push will skip this item unless there are local changes.`,
          })
        }

        // Check state
        const pushStatus = canPushInState(iap.state)
        if (!pushStatus.allowed) {
          warnings.push({
            id: iapId,
            productId: iap.productId,
            type: 'iap',
            warning: pushStatus.warning || `Cannot push in state "${iap.state}". Push will skip this item.`,
          })
        }

        if (!iap.productId) missingFields.push('Product ID')
        if (!iap.name) missingFields.push('Reference Name')

        // Check localizations
        const locSnapshot = await iapDoc.ref.collection('localizations').get()
        const localizations = locSnapshot.docs.map(doc => doc.data() as IAPLocalization)
        const validLocs = localizations.filter(loc => loc.displayName && loc.description)
        if (validLocs.length === 0) {
          missingFields.push('Localizations (need at least one with Display Name and Description)')
        }

        // Check pricing
        const pricingDoc = await iapDoc.ref.collection('config').doc('pricing').get()
        if (!pricingDoc.exists || !pricingDoc.data()?.basePricePointId) {
          missingFields.push('Pricing')
        }

        if (missingFields.length > 0) {
          invalid.push({ id: iapId, productId: iap.productId, type: 'iap', missingFields, syncStatus: iap.syncStatus, state: iap.state || null })
        } else {
          valid.push({ id: iapId, productId: iap.productId, type: 'iap', syncStatus: iap.syncStatus, state: iap.state || null })
        }
      }
    }

    // Validate Subscriptions
    if (subscriptionIds && subscriptionIds.length > 0) {
      const groupsSnapshot = await basePath.collection('subscriptionGroups').get()
      const foundSubIds = new Set<string>()

      for (const groupDoc of groupsSnapshot.docs) {
        const group = groupDoc.data() as SubscriptionGroup

        for (const subId of subscriptionIds) {
          const subDoc = await groupDoc.ref.collection('subscriptions').doc(subId).get()
          if (!subDoc.exists) continue

          foundSubIds.add(subId)
          const sub = subDoc.data() as Subscription
          const missingFields: string[] = []

          // Check syncStatus
          if (sub.syncStatus === 'synced') {
            warnings.push({
              id: subId,
              productId: sub.productId,
              type: 'subscription',
              warning: `Already synced (syncStatus: ${sub.syncStatus}). Push will skip this item unless there are local changes.`,
            })
          }

          // Check state
          const subPushStatus = canPushInState(sub.state)
          if (!subPushStatus.allowed) {
            warnings.push({
              id: subId,
              productId: sub.productId,
              type: 'subscription',
              warning: subPushStatus.warning || `Cannot push in state "${sub.state}". Push will skip this item.`,
            })
          }

          // Check group localizations
          const groupLocSnapshot = await groupDoc.ref.collection('localizations').get()
          const groupLocs = groupLocSnapshot.docs.map(doc => {
            const data = doc.data() as { name?: string; displayName?: string }
            return data.name || data.displayName || ''
          }).filter(Boolean)
          if (groupLocs.length === 0) {
            missingFields.push(`Subscription Group "${group.referenceName}" localizations (need at least one display name)`)
          }

          if (!sub.productId) missingFields.push('Product ID')
          if (!sub.name) missingFields.push('Reference Name')
          if (!sub.subscriptionPeriod) missingFields.push('Subscription Period')

          // Check localizations
          const locSnapshot = await subDoc.ref.collection('localizations').get()
          const localizations = locSnapshot.docs.map(doc => doc.data() as IAPLocalization)
          const validLocs = localizations.filter(loc => loc.displayName && loc.description)
          if (validLocs.length === 0) {
            missingFields.push('Localizations (need at least one with Display Name and Description)')
          }

          // Check pricing
          const pricingDoc = await subDoc.ref.collection('config').doc('pricing').get()
          if (!pricingDoc.exists || !pricingDoc.data()?.basePricePointId) {
            missingFields.push('Pricing')
          }

          if (missingFields.length > 0) {
            invalid.push({ id: subId, productId: sub.productId, type: 'subscription', missingFields, syncStatus: sub.syncStatus, state: sub.state || null })
          } else {
            valid.push({ id: subId, productId: sub.productId, type: 'subscription', syncStatus: sub.syncStatus, state: sub.state || null })
          }
        }
      }

      // Report subscriptions not found in any group
      for (const subId of subscriptionIds) {
        if (!foundSubIds.has(subId)) {
          warnings.push({ id: subId, productId: 'unknown', type: 'subscription', warning: 'Subscription not found in any subscription group' })
        }
      }
    }

    return { success: true, valid, invalid, warnings }
  } catch (error) {
    return { success: false, valid: [], invalid: [], warnings: [], error: error instanceof Error ? error.message : 'Failed to validate' }
  }
}

// Set Subscription Pricing
export interface SetSubscriptionPricingParams {
  projectId: string
  subscriptionId: string
  basePricePointId: string
  baseTerritory?: string
  strategy?: string
}

export interface SetSubscriptionPricingResult {
  success: boolean
  error?: string
}

export async function setSubscriptionPricing(
  params: SetSubscriptionPricingParams,
  context: AccountContext
): Promise<SetSubscriptionPricingResult> {
  const { projectId, subscriptionId, basePricePointId, baseTerritory = 'USA', strategy = 'equalized' } = params

  const projectContext = await getProjectContext(context.userId, projectId)
  if (!projectContext) {
    return { success: false, error: 'Project not found' }
  }

  if (!hasContextPermission(projectContext, 'canCreateProjects')) {
    return { success: false, error: 'Permission denied' }
  }

  try {
    const basePath = projectContext.type === 'organization' && projectContext.orgId
      ? adminDb.collection('organizations').doc(projectContext.orgId).collection('projects').doc(projectId)
      : adminDb.collection('users').doc(context.userId).collection('projects').doc(projectId)

    // Find the subscription
    const groupsSnapshot = await basePath.collection('subscriptionGroups').get()
    let subscriptionRef: FirebaseFirestore.DocumentReference | null = null

    for (const groupDoc of groupsSnapshot.docs) {
      const subDoc = await groupDoc.ref.collection('subscriptions').doc(subscriptionId).get()
      if (subDoc.exists) {
        subscriptionRef = subDoc.ref
        break
      }
    }

    if (!subscriptionRef) {
      return { success: false, error: 'Subscription not found' }
    }

    // Use pricing calculator to resolve price value to price point if needed
    const appStoreHelper = await getAppStoreHelper(context.userId, projectId, projectContext.orgId)
    const calculator = new IAPPricingCalculator(appStoreHelper)

    const preview = await calculator.previewPricing({
      basePricePointId,
      baseTerritory,
      strategyId: strategy,
    })

    const now = Timestamp.now()

    // Save pricing config with resolved price point
    await subscriptionRef.collection('config').doc('pricing').set({
      basePricePointId: preview.basePricePointId,
      baseTerritory,
      basePrice: preview.basePrice,
      baseCurrency: preview.baseCurrency,
      strategy,
      pricingStrategyId: strategy,
      updatedAt: now,
    }, { merge: true })

    // Mark subscription as having local changes
    await subscriptionRef.update({
      syncStatus: 'local_changes',
      updatedAt: now,
    })

    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to set subscription pricing' }
  }
}

// ============================================
// IAP & Subscription Media (Screenshots/Promotional Images)
// ============================================

import { uploadFile, deleteFile } from '@/lib/services/r2'

// Get IAP Screenshot
export interface GetIAPScreenshotParams {
  projectId: string
  iapId: string
}

export interface GetIAPScreenshotResult {
  success: boolean
  screenshot?: {
    fileName: string
    mimeType: string
    fileSize: number
    r2Url: string
    uploadedAt: string
  } | null
  error?: string
}

export async function getIAPScreenshot(
  params: GetIAPScreenshotParams,
  context: AccountContext
): Promise<GetIAPScreenshotResult> {
  const { projectId, iapId } = params

  const projectContext = await getProjectContext(context.userId, projectId)
  if (!projectContext) {
    return { success: false, error: 'Project not found' }
  }

  try {
    const basePath = projectContext.type === 'organization' && projectContext.orgId
      ? adminDb.collection('organizations').doc(projectContext.orgId).collection('projects').doc(projectId)
      : adminDb.collection('users').doc(context.userId).collection('projects').doc(projectId)

    const iapDoc = await basePath.collection('inAppPurchases').doc(iapId).get()
    if (!iapDoc.exists) {
      return { success: false, error: 'IAP not found' }
    }

    const screenshotDoc = await iapDoc.ref.collection('config').doc('reviewScreenshot').get()

    return {
      success: true,
      screenshot: screenshotDoc.exists ? screenshotDoc.data() as GetIAPScreenshotResult['screenshot'] : null,
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to get IAP screenshot' }
  }
}

// Helper to fetch image from URL
async function fetchImageFromUrl(imageUrl: string): Promise<{ buffer: Buffer; mimeType: string; size: number }> {
  const response = await fetch(imageUrl)
  if (!response.ok) {
    throw new Error(`Failed to fetch image from URL: ${response.status} ${response.statusText}`)
  }

  const contentType = response.headers.get('content-type') || 'image/png'
  const arrayBuffer = await response.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)

  return {
    buffer,
    mimeType: contentType,
    size: buffer.length,
  }
}

// Upload IAP Screenshot
export interface UploadIAPScreenshotParams {
  projectId: string
  iapId: string
  fileName: string
  imageUrl: string   // URL to fetch image from. Use tmpfiles.org, 0x0.st, or freeimage.host for temp uploads
  mimeType?: string
}

export interface UploadIAPScreenshotResult {
  success: boolean
  screenshot?: {
    fileName: string
    mimeType: string
    fileSize: number
    r2Url: string
  }
  error?: string
}

export async function uploadIAPScreenshot(
  params: UploadIAPScreenshotParams,
  context: AccountContext
): Promise<UploadIAPScreenshotResult> {
  const { projectId, iapId, fileName, imageUrl, mimeType: providedMimeType } = params

  if (!imageUrl) {
    return { success: false, error: 'imageUrl is required. Use tmpfiles.org, 0x0.st, or freeimage.host to upload your image first.' }
  }

  const projectContext = await getProjectContext(context.userId, projectId)
  if (!projectContext) {
    return { success: false, error: 'Project not found' }
  }

  if (!hasContextPermission(projectContext, 'canCreateProjects')) {
    return { success: false, error: 'Permission denied' }
  }

  try {
    // Fetch image from URL
    const fetched = await fetchImageFromUrl(imageUrl)
    const imageBuffer = fetched.buffer
    const mimeType = providedMimeType || fetched.mimeType
    const fileSize = fetched.size

    // Validate size (max 5MB)
    if (fileSize > 5 * 1024 * 1024) {
      return { success: false, error: 'Screenshot too large. Maximum size is 5MB.' }
    }

    const basePath = projectContext.type === 'organization' && projectContext.orgId
      ? adminDb.collection('organizations').doc(projectContext.orgId).collection('projects').doc(projectId)
      : adminDb.collection('users').doc(context.userId).collection('projects').doc(projectId)

    const iapDoc = await basePath.collection('inAppPurchases').doc(iapId).get()
    if (!iapDoc.exists) {
      return { success: false, error: 'IAP not found' }
    }

    const iapData = iapDoc.data()

    // Delete old file from R2 if it exists
    const existingScreenshot = await iapDoc.ref.collection('config').doc('reviewScreenshot').get()
    if (existingScreenshot.exists) {
      const oldR2Key = existingScreenshot.data()?.r2Key
      if (oldR2Key) {
        try {
          await deleteFile(oldR2Key)
        } catch {
          // Continue even if delete fails (file may not exist)
        }
      }
    }

    // Upload to R2
    const { key, url } = await uploadFile({
      userId: projectContext.type === 'organization' ? undefined : context.userId,
      orgId: projectContext.type === 'organization' ? projectContext.orgId : undefined,
      projectId,
      category: 'iap-media',
      filename: fileName,
      data: imageBuffer,
      contentType: mimeType,
      iapProductId: iapData?.productId || iapId,
      iapMediaType: 'reviewScreenshot',
    })

    // Save metadata to Firestore
    const screenshotData = {
      fileName,
      mimeType,
      fileSize,
      r2Key: key,
      r2Url: url,
      uploadedAt: Timestamp.now(),
      uploadedBy: context.userId,
    }

    await iapDoc.ref.collection('config').doc('reviewScreenshot').set(screenshotData)

    // Mark IAP as having local changes
    await iapDoc.ref.update({ syncStatus: 'local_changes' })

    return {
      success: true,
      screenshot: {
        fileName,
        mimeType,
        fileSize,
        r2Url: url,
      },
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to upload IAP screenshot' }
  }
}

// Delete IAP Screenshot
export interface DeleteIAPScreenshotParams {
  projectId: string
  iapId: string
}

export interface DeleteIAPScreenshotResult {
  success: boolean
  error?: string
}

export async function deleteIAPScreenshot(
  params: DeleteIAPScreenshotParams,
  context: AccountContext
): Promise<DeleteIAPScreenshotResult> {
  const { projectId, iapId } = params

  const projectContext = await getProjectContext(context.userId, projectId)
  if (!projectContext) {
    return { success: false, error: 'Project not found' }
  }

  if (!hasContextPermission(projectContext, 'canCreateProjects')) {
    return { success: false, error: 'Permission denied' }
  }

  try {
    const basePath = projectContext.type === 'organization' && projectContext.orgId
      ? adminDb.collection('organizations').doc(projectContext.orgId).collection('projects').doc(projectId)
      : adminDb.collection('users').doc(context.userId).collection('projects').doc(projectId)

    const screenshotDoc = await basePath
      .collection('inAppPurchases')
      .doc(iapId)
      .collection('config')
      .doc('reviewScreenshot')
      .get()

    if (screenshotDoc.exists) {
      const data = screenshotDoc.data()
      if (data?.r2Key) {
        try {
          await deleteFile(data.r2Key)
        } catch (r2Error) {
          console.warn('Failed to delete from R2:', r2Error)
        }
      }
    }

    await screenshotDoc.ref.delete()

    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to delete IAP screenshot' }
  }
}

// Get IAP Promotional Image
export interface GetIAPPromotionalImageParams {
  projectId: string
  iapId: string
}

export interface GetIAPPromotionalImageResult {
  success: boolean
  image?: {
    fileName: string
    mimeType: string
    fileSize: number
    r2Url: string
    uploadedAt: string
  } | null
  error?: string
}

export async function getIAPPromotionalImage(
  params: GetIAPPromotionalImageParams,
  context: AccountContext
): Promise<GetIAPPromotionalImageResult> {
  const { projectId, iapId } = params

  const projectContext = await getProjectContext(context.userId, projectId)
  if (!projectContext) {
    return { success: false, error: 'Project not found' }
  }

  try {
    const basePath = projectContext.type === 'organization' && projectContext.orgId
      ? adminDb.collection('organizations').doc(projectContext.orgId).collection('projects').doc(projectId)
      : adminDb.collection('users').doc(context.userId).collection('projects').doc(projectId)

    const iapDoc = await basePath.collection('inAppPurchases').doc(iapId).get()
    if (!iapDoc.exists) {
      return { success: false, error: 'IAP not found' }
    }

    const imageDoc = await iapDoc.ref.collection('config').doc('promotionalImage').get()

    return {
      success: true,
      image: imageDoc.exists ? imageDoc.data() as GetIAPPromotionalImageResult['image'] : null,
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to get IAP promotional image' }
  }
}

// Upload IAP Promotional Image
export interface UploadIAPPromotionalImageParams {
  projectId: string
  iapId: string
  fileName: string
  imageUrl: string   // URL to fetch image from. Use tmpfiles.org, 0x0.st, or freeimage.host for temp uploads
  mimeType?: string
}

export interface UploadIAPPromotionalImageResult {
  success: boolean
  image?: {
    fileName: string
    mimeType: string
    fileSize: number
    r2Url: string
  }
  error?: string
}

export async function uploadIAPPromotionalImage(
  params: UploadIAPPromotionalImageParams,
  context: AccountContext
): Promise<UploadIAPPromotionalImageResult> {
  const { projectId, iapId, fileName, imageUrl, mimeType: providedMimeType } = params

  if (!imageUrl) {
    return { success: false, error: 'imageUrl is required. Use tmpfiles.org, 0x0.st, or freeimage.host to upload your image first.' }
  }

  const projectContext = await getProjectContext(context.userId, projectId)
  if (!projectContext) {
    return { success: false, error: 'Project not found' }
  }

  if (!hasContextPermission(projectContext, 'canCreateProjects')) {
    return { success: false, error: 'Permission denied' }
  }

  try {
    // Fetch image from URL
    const fetched = await fetchImageFromUrl(imageUrl)
    const imageBuffer = fetched.buffer
    const mimeType = providedMimeType || fetched.mimeType
    const fileSize = fetched.size

    // Validate size (max 5MB)
    if (fileSize > 5 * 1024 * 1024) {
      return { success: false, error: 'Image too large. Maximum size is 5MB.' }
    }

    const basePath = projectContext.type === 'organization' && projectContext.orgId
      ? adminDb.collection('organizations').doc(projectContext.orgId).collection('projects').doc(projectId)
      : adminDb.collection('users').doc(context.userId).collection('projects').doc(projectId)

    const iapDoc = await basePath.collection('inAppPurchases').doc(iapId).get()
    if (!iapDoc.exists) {
      return { success: false, error: 'IAP not found' }
    }

    const iapData = iapDoc.data()

    // Delete old file from R2 if it exists
    const existingImage = await iapDoc.ref.collection('config').doc('promotionalImage').get()
    if (existingImage.exists) {
      const oldR2Key = existingImage.data()?.r2Key
      if (oldR2Key) {
        try {
          await deleteFile(oldR2Key)
        } catch {
          // Continue even if delete fails
        }
      }
    }

    const { key, url } = await uploadFile({
      userId: projectContext.type === 'organization' ? undefined : context.userId,
      orgId: projectContext.type === 'organization' ? projectContext.orgId : undefined,
      projectId,
      category: 'iap-media',
      filename: fileName,
      data: imageBuffer,
      contentType: mimeType,
      iapProductId: iapData?.productId || iapId,
      iapMediaType: 'promotionalImage',
    })

    const imageDataObj = {
      fileName,
      mimeType,
      fileSize,
      r2Key: key,
      r2Url: url,
      uploadedAt: Timestamp.now(),
      uploadedBy: context.userId,
    }

    await iapDoc.ref.collection('config').doc('promotionalImage').set(imageDataObj)
    await iapDoc.ref.update({ syncStatus: 'local_changes' })

    return {
      success: true,
      image: {
        fileName,
        mimeType,
        fileSize,
        r2Url: url,
      },
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to upload IAP promotional image' }
  }
}

// Delete IAP Promotional Image
export interface DeleteIAPPromotionalImageParams {
  projectId: string
  iapId: string
}

export interface DeleteIAPPromotionalImageResult {
  success: boolean
  error?: string
}

export async function deleteIAPPromotionalImage(
  params: DeleteIAPPromotionalImageParams,
  context: AccountContext
): Promise<DeleteIAPPromotionalImageResult> {
  const { projectId, iapId } = params

  const projectContext = await getProjectContext(context.userId, projectId)
  if (!projectContext) {
    return { success: false, error: 'Project not found' }
  }

  if (!hasContextPermission(projectContext, 'canCreateProjects')) {
    return { success: false, error: 'Permission denied' }
  }

  try {
    const basePath = projectContext.type === 'organization' && projectContext.orgId
      ? adminDb.collection('organizations').doc(projectContext.orgId).collection('projects').doc(projectId)
      : adminDb.collection('users').doc(context.userId).collection('projects').doc(projectId)

    const imageDoc = await basePath
      .collection('inAppPurchases')
      .doc(iapId)
      .collection('config')
      .doc('promotionalImage')
      .get()

    if (imageDoc.exists) {
      const data = imageDoc.data()
      if (data?.r2Key) {
        try {
          await deleteFile(data.r2Key)
        } catch (r2Error) {
          console.warn('Failed to delete from R2:', r2Error)
        }
      }
    }

    await imageDoc.ref.delete()

    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to delete IAP promotional image' }
  }
}

// Helper to find subscription document
async function findSubscriptionDoc(basePath: FirebaseFirestore.DocumentReference, subId: string) {
  const groupsSnapshot = await basePath.collection('subscriptionGroups').get()

  for (const groupDoc of groupsSnapshot.docs) {
    const subDoc = await groupDoc.ref.collection('subscriptions').doc(subId).get()
    if (subDoc.exists) {
      return { doc: subDoc, ref: subDoc.ref, groupRef: groupDoc.ref }
    }
  }

  return null
}

// Get Subscription Screenshot
export interface GetSubscriptionScreenshotParams {
  projectId: string
  subscriptionId: string
}

export interface GetSubscriptionScreenshotResult {
  success: boolean
  screenshot?: {
    fileName: string
    mimeType: string
    fileSize: number
    r2Url: string
    uploadedAt: string
  } | null
  error?: string
}

export async function getSubscriptionScreenshot(
  params: GetSubscriptionScreenshotParams,
  context: AccountContext
): Promise<GetSubscriptionScreenshotResult> {
  const { projectId, subscriptionId } = params

  const projectContext = await getProjectContext(context.userId, projectId)
  if (!projectContext) {
    return { success: false, error: 'Project not found' }
  }

  try {
    const basePath = projectContext.type === 'organization' && projectContext.orgId
      ? adminDb.collection('organizations').doc(projectContext.orgId).collection('projects').doc(projectId)
      : adminDb.collection('users').doc(context.userId).collection('projects').doc(projectId)

    const subscription = await findSubscriptionDoc(basePath, subscriptionId)
    if (!subscription) {
      return { success: false, error: 'Subscription not found' }
    }

    const screenshotDoc = await subscription.ref.collection('config').doc('reviewScreenshot').get()

    return {
      success: true,
      screenshot: screenshotDoc.exists ? screenshotDoc.data() as GetSubscriptionScreenshotResult['screenshot'] : null,
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to get subscription screenshot' }
  }
}

// Upload Subscription Screenshot
export interface UploadSubscriptionScreenshotParams {
  projectId: string
  subscriptionId: string
  fileName: string
  imageUrl: string   // URL to fetch image from. Use tmpfiles.org, 0x0.st, or freeimage.host for temp uploads
  mimeType?: string
}

export interface UploadSubscriptionScreenshotResult {
  success: boolean
  screenshot?: {
    fileName: string
    mimeType: string
    fileSize: number
    r2Url: string
  }
  error?: string
}

export async function uploadSubscriptionScreenshot(
  params: UploadSubscriptionScreenshotParams,
  context: AccountContext
): Promise<UploadSubscriptionScreenshotResult> {
  const { projectId, subscriptionId, fileName, imageUrl, mimeType: providedMimeType } = params

  if (!imageUrl) {
    return { success: false, error: 'imageUrl is required. Use tmpfiles.org, 0x0.st, or freeimage.host to upload your image first.' }
  }

  const projectContext = await getProjectContext(context.userId, projectId)
  if (!projectContext) {
    return { success: false, error: 'Project not found' }
  }

  if (!hasContextPermission(projectContext, 'canCreateProjects')) {
    return { success: false, error: 'Permission denied' }
  }

  try {
    // Fetch image from URL
    const fetched = await fetchImageFromUrl(imageUrl)
    const imageBuffer = fetched.buffer
    const mimeType = providedMimeType || fetched.mimeType
    const fileSize = fetched.size

    // Validate size (max 5MB)
    if (fileSize > 5 * 1024 * 1024) {
      return { success: false, error: 'Screenshot too large. Maximum size is 5MB.' }
    }

    const basePath = projectContext.type === 'organization' && projectContext.orgId
      ? adminDb.collection('organizations').doc(projectContext.orgId).collection('projects').doc(projectId)
      : adminDb.collection('users').doc(context.userId).collection('projects').doc(projectId)

    const subscription = await findSubscriptionDoc(basePath, subscriptionId)
    if (!subscription) {
      return { success: false, error: 'Subscription not found' }
    }

    const subData = subscription.doc.data()

    // Delete old file from R2 if it exists
    const existingScreenshot = await subscription.ref.collection('config').doc('reviewScreenshot').get()
    if (existingScreenshot.exists) {
      const oldR2Key = existingScreenshot.data()?.r2Key
      if (oldR2Key) {
        try {
          await deleteFile(oldR2Key)
        } catch {
          // Continue even if delete fails
        }
      }
    }

    const { key, url } = await uploadFile({
      userId: projectContext.type === 'organization' ? undefined : context.userId,
      orgId: projectContext.type === 'organization' ? projectContext.orgId : undefined,
      projectId,
      category: 'iap-media',
      filename: fileName,
      data: imageBuffer,
      contentType: mimeType,
      iapProductId: subData?.productId || subscriptionId,
      iapMediaType: 'reviewScreenshot',
    })

    const screenshotData = {
      fileName,
      mimeType,
      fileSize,
      r2Key: key,
      r2Url: url,
      uploadedAt: Timestamp.now(),
      uploadedBy: context.userId,
    }

    await subscription.ref.collection('config').doc('reviewScreenshot').set(screenshotData)
    await subscription.ref.update({ syncStatus: 'local_changes' })

    return {
      success: true,
      screenshot: {
        fileName,
        mimeType,
        fileSize,
        r2Url: url,
      },
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to upload subscription screenshot' }
  }
}

// Delete Subscription Screenshot
export interface DeleteSubscriptionScreenshotParams {
  projectId: string
  subscriptionId: string
}

export interface DeleteSubscriptionScreenshotResult {
  success: boolean
  error?: string
}

export async function deleteSubscriptionScreenshot(
  params: DeleteSubscriptionScreenshotParams,
  context: AccountContext
): Promise<DeleteSubscriptionScreenshotResult> {
  const { projectId, subscriptionId } = params

  const projectContext = await getProjectContext(context.userId, projectId)
  if (!projectContext) {
    return { success: false, error: 'Project not found' }
  }

  if (!hasContextPermission(projectContext, 'canCreateProjects')) {
    return { success: false, error: 'Permission denied' }
  }

  try {
    const basePath = projectContext.type === 'organization' && projectContext.orgId
      ? adminDb.collection('organizations').doc(projectContext.orgId).collection('projects').doc(projectId)
      : adminDb.collection('users').doc(context.userId).collection('projects').doc(projectId)

    const subscription = await findSubscriptionDoc(basePath, subscriptionId)
    if (!subscription) {
      return { success: false, error: 'Subscription not found' }
    }

    const screenshotDoc = await subscription.ref.collection('config').doc('reviewScreenshot').get()

    if (screenshotDoc.exists) {
      const data = screenshotDoc.data()
      if (data?.r2Key) {
        try {
          await deleteFile(data.r2Key)
        } catch (r2Error) {
          console.warn('Failed to delete from R2:', r2Error)
        }
      }
    }

    await screenshotDoc.ref.delete()

    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to delete subscription screenshot' }
  }
}

// Get Subscription Promotional Image
export interface GetSubscriptionPromotionalImageParams {
  projectId: string
  subscriptionId: string
}

export interface GetSubscriptionPromotionalImageResult {
  success: boolean
  image?: {
    fileName: string
    mimeType: string
    fileSize: number
    r2Url: string
    uploadedAt: string
  } | null
  error?: string
}

export async function getSubscriptionPromotionalImage(
  params: GetSubscriptionPromotionalImageParams,
  context: AccountContext
): Promise<GetSubscriptionPromotionalImageResult> {
  const { projectId, subscriptionId } = params

  const projectContext = await getProjectContext(context.userId, projectId)
  if (!projectContext) {
    return { success: false, error: 'Project not found' }
  }

  try {
    const basePath = projectContext.type === 'organization' && projectContext.orgId
      ? adminDb.collection('organizations').doc(projectContext.orgId).collection('projects').doc(projectId)
      : adminDb.collection('users').doc(context.userId).collection('projects').doc(projectId)

    const subscription = await findSubscriptionDoc(basePath, subscriptionId)
    if (!subscription) {
      return { success: false, error: 'Subscription not found' }
    }

    const imageDoc = await subscription.ref.collection('config').doc('promotionalImage').get()

    return {
      success: true,
      image: imageDoc.exists ? imageDoc.data() as GetSubscriptionPromotionalImageResult['image'] : null,
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to get subscription promotional image' }
  }
}

// Upload Subscription Promotional Image
export interface UploadSubscriptionPromotionalImageParams {
  projectId: string
  subscriptionId: string
  fileName: string
  imageUrl: string   // URL to fetch image from. Use tmpfiles.org, 0x0.st, or freeimage.host for temp uploads
  mimeType?: string
}

export interface UploadSubscriptionPromotionalImageResult {
  success: boolean
  image?: {
    fileName: string
    mimeType: string
    fileSize: number
    r2Url: string
  }
  error?: string
}

export async function uploadSubscriptionPromotionalImage(
  params: UploadSubscriptionPromotionalImageParams,
  context: AccountContext
): Promise<UploadSubscriptionPromotionalImageResult> {
  const { projectId, subscriptionId, fileName, imageUrl, mimeType: providedMimeType } = params

  if (!imageUrl) {
    return { success: false, error: 'imageUrl is required. Use tmpfiles.org, 0x0.st, or freeimage.host to upload your image first.' }
  }

  const projectContext = await getProjectContext(context.userId, projectId)
  if (!projectContext) {
    return { success: false, error: 'Project not found' }
  }

  if (!hasContextPermission(projectContext, 'canCreateProjects')) {
    return { success: false, error: 'Permission denied' }
  }

  try {
    // Fetch image from URL
    const fetched = await fetchImageFromUrl(imageUrl)
    const imageBuffer = fetched.buffer
    const mimeType = providedMimeType || fetched.mimeType
    const fileSize = fetched.size

    // Validate size (max 5MB)
    if (fileSize > 5 * 1024 * 1024) {
      return { success: false, error: 'Image too large. Maximum size is 5MB.' }
    }

    const basePath = projectContext.type === 'organization' && projectContext.orgId
      ? adminDb.collection('organizations').doc(projectContext.orgId).collection('projects').doc(projectId)
      : adminDb.collection('users').doc(context.userId).collection('projects').doc(projectId)

    const subscription = await findSubscriptionDoc(basePath, subscriptionId)
    if (!subscription) {
      return { success: false, error: 'Subscription not found' }
    }

    const subData = subscription.doc.data()

    // Delete old file from R2 if it exists
    const existingImage = await subscription.ref.collection('config').doc('promotionalImage').get()
    if (existingImage.exists) {
      const oldR2Key = existingImage.data()?.r2Key
      if (oldR2Key) {
        try {
          await deleteFile(oldR2Key)
        } catch {
          // Continue even if delete fails
        }
      }
    }

    const { key, url } = await uploadFile({
      userId: projectContext.type === 'organization' ? undefined : context.userId,
      orgId: projectContext.type === 'organization' ? projectContext.orgId : undefined,
      projectId,
      category: 'iap-media',
      filename: fileName,
      data: imageBuffer,
      contentType: mimeType,
      iapProductId: subData?.productId || subscriptionId,
      iapMediaType: 'promotionalImage',
    })

    const imageDataObj = {
      fileName,
      mimeType,
      fileSize,
      r2Key: key,
      r2Url: url,
      uploadedAt: Timestamp.now(),
      uploadedBy: context.userId,
    }

    await subscription.ref.collection('config').doc('promotionalImage').set(imageDataObj)
    await subscription.ref.update({ syncStatus: 'local_changes' })

    return {
      success: true,
      image: {
        fileName,
        mimeType,
        fileSize,
        r2Url: url,
      },
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to upload subscription promotional image' }
  }
}

// Delete Subscription Promotional Image
export interface DeleteSubscriptionPromotionalImageParams {
  projectId: string
  subscriptionId: string
}

export interface DeleteSubscriptionPromotionalImageResult {
  success: boolean
  error?: string
}

export async function deleteSubscriptionPromotionalImage(
  params: DeleteSubscriptionPromotionalImageParams,
  context: AccountContext
): Promise<DeleteSubscriptionPromotionalImageResult> {
  const { projectId, subscriptionId } = params

  const projectContext = await getProjectContext(context.userId, projectId)
  if (!projectContext) {
    return { success: false, error: 'Project not found' }
  }

  if (!hasContextPermission(projectContext, 'canCreateProjects')) {
    return { success: false, error: 'Permission denied' }
  }

  try {
    const basePath = projectContext.type === 'organization' && projectContext.orgId
      ? adminDb.collection('organizations').doc(projectContext.orgId).collection('projects').doc(projectId)
      : adminDb.collection('users').doc(context.userId).collection('projects').doc(projectId)

    const subscription = await findSubscriptionDoc(basePath, subscriptionId)
    if (!subscription) {
      return { success: false, error: 'Subscription not found' }
    }

    const imageDoc = await subscription.ref.collection('config').doc('promotionalImage').get()

    if (imageDoc.exists) {
      const data = imageDoc.data()
      if (data?.r2Key) {
        try {
          await deleteFile(data.r2Key)
        } catch (r2Error) {
          console.warn('Failed to delete from R2:', r2Error)
        }
      }
    }

    await imageDoc.ref.delete()

    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to delete subscription promotional image' }
  }
}

// ==============================
// Get Territory Prices (Verification)
// ==============================

export interface GetTerritoryPricesParams {
  projectId: string
  itemId: string         // IAP ID or subscription ID
  itemType: 'iap' | 'subscription'
  territories?: string[] // Specific territories to check (default: key markets sample)
}

export interface GetTerritoryPricesResult {
  success: boolean
  error?: string
  data?: {
    itemId: string
    itemType: string
    productId: string
    appStoreId: string | null
    savedPricing: {
      basePricePointId: string | null
      baseTerritory: string | null
      strategy: string | null
      basePrice: number | null
    } | null
    applePricing: {
      totalTerritoriesWithPrices: number
      baseTerritory: string | null
      territories: Array<{
        territory: string
        pricePointId: string | null
        customerPrice?: string
      }>
    } | null
    strategyExpected?: {
      totalTerritories: number
      tiers: Array<{
        name: string
        multiplier: number
        territoryCount: number
        expectedPrice: number
      }>
    }
  }
}

export async function getTerritoryPrices(
  params: GetTerritoryPricesParams,
  context: AccountContext
): Promise<GetTerritoryPricesResult> {
  const { projectId, itemId, itemType, territories: requestedTerritories } = params

  const projectContext = await getProjectContext(context.userId, projectId)
  if (!projectContext) {
    return { success: false, error: 'Project not found' }
  }

  try {
    const basePath = projectContext.type === 'organization' && projectContext.orgId
      ? adminDb.collection('organizations').doc(projectContext.orgId).collection('projects').doc(projectId)
      : adminDb.collection('users').doc(context.userId).collection('projects').doc(projectId)

    const appStoreHelper = await getAppStoreHelper(context.userId, projectId, projectContext.orgId)

    if (itemType === 'iap') {
      // Get IAP from Firestore
      const iapDoc = await basePath.collection('inAppPurchases').doc(itemId).get()
      if (!iapDoc.exists) {
        return { success: false, error: 'IAP not found' }
      }
      const iap = iapDoc.data() as InAppPurchase

      // Get saved pricing config
      const pricingDoc = await iapDoc.ref.collection('config').doc('pricing').get()
      const pricing = pricingDoc.exists ? pricingDoc.data() : null

      const savedPricing = pricing ? {
        basePricePointId: pricing.basePricePointId || null,
        baseTerritory: pricing.baseTerritory || null,
        strategy: pricing.pricingStrategyId || pricing.strategy || null,
        basePrice: pricing.basePrice || null,
      } : null

      // Get actual prices from Apple
      let applePricing = null
      if (iap.appStoreId) {
        const schedule = await appStoreHelper.getIAPPriceSchedule(iap.appStoreId)

        if (schedule) {
          // Get customer prices for requested territories (or key markets sample)
          const keyTerritories = requestedTerritories || [
            'USA', 'GBR', 'DEU', 'JPN', 'AUS', 'CAN', 'BRA', 'IND', 'KOR', 'MEX',
            'FRA', 'ITA', 'ESP', 'SGP', 'TUR', 'RUS', 'IDN', 'THA', 'ARG', 'COL',
          ]

          // Fetch price points for the key territories to resolve customer prices
          const territoriesWithPrices = schedule.manualPrices
            .filter(p => p.territory && p.startDate === null) // Current prices only
            .map(p => ({
              territory: p.territory!,
              pricePointId: p.pricePointId || null,
            }))

          // For enrichment: fetch USA price points to match pricePointIds to values
          const enrichedTerritories: Array<{ territory: string; pricePointId: string | null; customerPrice?: string }> = []

          // Use equalizations from base price to get customer prices per territory
          if (savedPricing?.basePricePointId) {
            try {
              const baseTerritory = savedPricing.baseTerritory || 'USA'
              const basePricePoints = await appStoreHelper.getIAPPricePoints(iap.appStoreId, baseTerritory)
              const basePrice = parseFloat(savedPricing.basePricePointId)
              const basePP = basePricePoints.find(pp => Math.abs(parseFloat(pp.customerPrice) - basePrice) < 0.01)

              if (basePP) {
                const equalizations = await appStoreHelper.getIAPPriceEqualizations(basePP.id)
                const eqMap = new Map(equalizations.map(eq => [eq.territory, eq.customerPrice]))

                for (const t of territoriesWithPrices) {
                  enrichedTerritories.push({
                    territory: t.territory,
                    pricePointId: t.pricePointId,
                    customerPrice: eqMap.get(t.territory),
                  })
                }
              }
            } catch {
              // Fall back to pricePointIds only
              enrichedTerritories.push(...territoriesWithPrices)
            }
          } else {
            enrichedTerritories.push(...territoriesWithPrices)
          }

          // Filter to key territories for the response (full list can be huge)
          const filtered = enrichedTerritories.filter(t => keyTerritories.includes(t.territory))

          applePricing = {
            totalTerritoriesWithPrices: territoriesWithPrices.length,
            baseTerritory: schedule.baseTerritory,
            territories: filtered.length > 0 ? filtered : enrichedTerritories.slice(0, 20),
          }
        }
      }

      // Calculate strategy expectations
      let strategyExpected = undefined
      if (savedPricing?.strategy && savedPricing.strategy !== 'equalized' && savedPricing.basePrice) {
        const strategy = PRICING_STRATEGIES[savedPricing.strategy]
        if (strategy) {
          strategyExpected = {
            totalTerritories: strategy.tiers.reduce((sum, t) => sum + (t.territories.includes('*') ? 20 : t.territories.length), 0),
            tiers: strategy.tiers.map(tier => ({
              name: tier.name,
              multiplier: tier.multiplier,
              territoryCount: tier.territories.includes('*') ? 20 : tier.territories.length,
              expectedPrice: Math.round(savedPricing.basePrice! * tier.multiplier * 100) / 100,
            })),
          }
        }
      }

      return {
        success: true,
        data: {
          itemId,
          itemType: 'iap',
          productId: iap.productId,
          appStoreId: iap.appStoreId || null,
          savedPricing,
          applePricing,
          strategyExpected,
        },
      }
    } else {
      // Subscription
      const groupsSnapshot = await basePath.collection('subscriptionGroups').get()
      let sub: Subscription | null = null
      let subRef: FirebaseFirestore.DocumentReference | null = null

      for (const groupDoc of groupsSnapshot.docs) {
        const subDoc = await groupDoc.ref.collection('subscriptions').doc(itemId).get()
        if (subDoc.exists) {
          sub = subDoc.data() as Subscription
          subRef = subDoc.ref
          break
        }
      }

      if (!sub || !subRef) {
        return { success: false, error: 'Subscription not found' }
      }

      // Get saved pricing config
      const pricingDoc = await subRef.collection('config').doc('pricing').get()
      const pricing = pricingDoc.exists ? pricingDoc.data() : null

      const savedPricing = pricing ? {
        basePricePointId: pricing.basePricePointId || null,
        baseTerritory: pricing.baseTerritory || null,
        strategy: pricing.pricingStrategyId || pricing.strategy || null,
        basePrice: pricing.basePrice || null,
      } : null

      // Get actual prices from Apple
      let applePricing = null
      if (sub.appStoreId) {
        const prices = await appStoreHelper.getSubscriptionPrices(sub.appStoreId)
        const currentPrices = prices.filter(p => p.startDate === null)

        applePricing = {
          totalTerritoriesWithPrices: currentPrices.length,
          baseTerritory: savedPricing?.baseTerritory || null,
          territories: currentPrices.slice(0, 30).map(p => ({
            territory: p.territory,
            pricePointId: p.pricePointId,
          })),
        }
      }

      // Calculate strategy expectations
      let strategyExpected = undefined
      if (savedPricing?.strategy && savedPricing.strategy !== 'equalized' && savedPricing.basePrice) {
        const strategy = PRICING_STRATEGIES[savedPricing.strategy]
        if (strategy) {
          strategyExpected = {
            totalTerritories: strategy.tiers.reduce((sum, t) => sum + (t.territories.includes('*') ? 20 : t.territories.length), 0),
            tiers: strategy.tiers.map(tier => ({
              name: tier.name,
              multiplier: tier.multiplier,
              territoryCount: tier.territories.includes('*') ? 20 : tier.territories.length,
              expectedPrice: Math.round(savedPricing.basePrice! * tier.multiplier * 100) / 100,
            })),
          }
        }
      }

      return {
        success: true,
        data: {
          itemId,
          itemType: 'subscription',
          productId: sub.productId,
          appStoreId: sub.appStoreId || null,
          savedPricing,
          applePricing,
          strategyExpected,
        },
      }
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to get territory prices' }
  }
}
