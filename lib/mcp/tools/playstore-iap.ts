/**
 * Play Store IAP MCP Tools
 * MCP tools for managing Google Play Store in-app purchases and subscriptions
 */

import { adminDb } from '@/lib/firebase/admin'
import { Timestamp, FieldPath } from 'firebase-admin/firestore'
import { randomUUID } from 'crypto'
import { AccountContext, getProjectContext, hasContextPermission } from '@/lib/org/context'
import { PlayStoreHelper, usdToMoney, moneyToUsd, usdToPriceMicros, priceMicrosToUsd } from '@/lib/services/playstore'
import { decryptPlayStoreCredentials } from '@/lib/crypto/credentials'
import {
  generateSourceHash,
  getIAPLocalesRequiringTranslation,
  translateIAPFields,
  type IAPTranslationCache,
} from '@/lib/services/iap-translator'
import { refundUsage, reserveUsage, settleUsage } from '@/lib/api/usage'
import { PLAYSTORE_IAP_LIMITS } from '@/lib/constants'
import type {
  PlayStoreProduct,
  PlayStoreProductLocalization,
  PlayStoreSubscription,
  PlayStoreBasePlan,
  PlayStoreOffer,
  PlayStoreOfferPhase,
  PlayStorePricingConfig,
  IAPSyncStatus,
  PlayStoreProductState,
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

// ============================================
// HELPER: Get Project Base Path
// ============================================

export async function getProjectBasePath(userId: string, projectId: string) {
  const projectContext = await getProjectContext(userId, projectId)
  if (!projectContext) return null

  const basePath = projectContext.type === 'organization' && projectContext.orgId
    ? adminDb.collection('organizations').doc(projectContext.orgId).collection('projects').doc(projectId)
    : adminDb.collection('users').doc(userId).collection('projects').doc(projectId)

  return { basePath, projectContext }
}

// ============================================
// HELPER: Get Play Store Credentials + Helper
// ============================================

async function getPlayStoreHelper(userId: string, projectId: string) {
  const result = await getProjectBasePath(userId, projectId)
  if (!result) return null

  const { basePath, projectContext } = result

  if (!hasContextPermission(projectContext, 'canCreateProjects')) {
    return null
  }

  // Get credentials from account level (same as screenshot push + Cloud Functions)
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

  // Get package name from project or credentials
  const projectDoc = await basePath.get()
  const projectData = projectDoc.data()
  const packageName = projectData?.playStorePackage || credentials.packageName

  const helper = new PlayStoreHelper({ packageName, serviceAccountJson: credentials.serviceAccountJson })

  return { helper, basePath, projectContext }
}

// ============================================
// 1. LIST PLAY STORE PRODUCTS
// ============================================

export interface ListPlayStoreProductsParams {
  projectId: string
  filter?: 'all' | 'products' | 'subscriptions'
}

export interface ListPlayStoreProductsResult {
  success: boolean
  products?: PlayStoreProduct[]
  subscriptions?: PlayStoreSubscription[]
  error?: string
}

export async function listPlayStoreProducts(
  params: ListPlayStoreProductsParams,
  context: AccountContext
): Promise<ListPlayStoreProductsResult> {
  const { projectId, filter = 'all' } = params

  const result = await getProjectBasePath(context.userId, projectId)
  if (!result) return { success: false, error: 'Project not found' }

  const { basePath } = result

  try {
    const output: ListPlayStoreProductsResult = { success: true }

    // Get one-time products
    if (filter === 'all' || filter === 'products') {
      const productsSnapshot = await basePath.collection('playStoreProducts').orderBy('createdAt', 'desc').get()
      output.products = productsSnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
      })) as PlayStoreProduct[]
    }

    // Get subscriptions with offers
    if (filter === 'all' || filter === 'subscriptions') {
      const subscriptionsSnapshot = await basePath.collection('playStoreSubscriptions').orderBy('createdAt', 'desc').get()
      output.subscriptions = await Promise.all(subscriptionsSnapshot.docs.map(async doc => {
        const offersSnapshot = await doc.ref.collection('offers').get()
        const offers = offersSnapshot.docs.map(offerDoc => ({
          id: offerDoc.id,
          ...offerDoc.data(),
        }))
        return {
          id: doc.id,
          ...doc.data(),
          offers,
        }
      })) as any[]
    }

    return output
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to list products' }
  }
}

// ============================================
// 2. CREATE PLAY STORE PRODUCT (one-time)
// ============================================

export interface CreatePlayStoreProductParams {
  projectId: string
  sku: string
  defaultLanguage?: string
  defaultPriceUsd?: number
  title?: string
  description?: string
  localizations?: Array<{
    locale: string
    title: string
    description: string
  }>
}

export interface CreatePlayStoreProductResult {
  success: boolean
  product?: PlayStoreProduct
  error?: string
}

export async function createPlayStoreProduct(
  params: CreatePlayStoreProductParams,
  context: AccountContext
): Promise<CreatePlayStoreProductResult> {
  const { projectId, sku, defaultLanguage = 'en-US', defaultPriceUsd, title, description, localizations } = params

  const result = await getProjectBasePath(context.userId, projectId)
  if (!result) return { success: false, error: 'Project not found' }

  const { basePath, projectContext } = result

  if (!hasContextPermission(projectContext, 'canCreateProjects')) {
    return { success: false, error: 'Permission denied' }
  }

  try {
    // Check if SKU already exists
    const existingSnapshot = await basePath.collection('playStoreProducts')
      .where('sku', '==', sku)
      .limit(1)
      .get()

    if (!existingSnapshot.empty) {
      return { success: false, error: 'SKU already exists' }
    }

    const now = Timestamp.now()
    const productRef = basePath.collection('playStoreProducts').doc()

    const product: PlayStoreProduct = {
      id: productRef.id,
      sku,
      productType: 'ONE_TIME',
      status: null,
      syncStatus: 'pending_creation',
      defaultLanguage,
      defaultPriceUsd: defaultPriceUsd ?? null,
      createdAt: now,
      updatedAt: now,
    }

    await productRef.set(product)

    // Save localizations — support both top-level title/description and localizations array
    const allLocalizations = localizations && localizations.length > 0
      ? localizations
      : (title ? [{ locale: defaultLanguage, title, description: description || '' }] : [])

    if (allLocalizations.length > 0) {
      const batch = adminDb.batch()
      for (const loc of allLocalizations) {
        const locRef = productRef.collection('localizations').doc(loc.locale)
        const locData: PlayStoreProductLocalization = {
          locale: loc.locale,
          title: loc.title.substring(0, PLAYSTORE_IAP_LIMITS.title),
          description: loc.description.substring(0, PLAYSTORE_IAP_LIMITS.description),
        }
        batch.set(locRef, locData)
      }
      await batch.commit()
    }

    // Save pricing config if price provided
    if (defaultPriceUsd) {
      await productRef.collection('config').doc('pricing').set({
        basePriceUsd: defaultPriceUsd,
        strategy: 'auto_convert',
        updatedAt: now,
      })
    }

    return { success: true, product }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to create product' }
  }
}

// ============================================
// 3. CREATE PLAY STORE SUBSCRIPTION
// ============================================

export interface CreatePlayStoreSubscriptionParams {
  projectId: string
  productId: string
  defaultLanguage?: string
  title?: string
  description?: string
  localizations?: Array<{
    locale: string
    title: string
    description: string
    benefits?: string[]
  }>
  basePlans: Array<{
    basePlanId: string
    type: 'AUTO_RENEWING' | 'PREPAID'
    billingPeriodDuration?: string
    gracePeriodDuration?: string
    defaultPriceUsd?: number
  }>
}

export interface CreatePlayStoreSubscriptionResult {
  success: boolean
  subscription?: PlayStoreSubscription
  error?: string
}

export async function createPlayStoreSubscription(
  params: CreatePlayStoreSubscriptionParams,
  context: AccountContext
): Promise<CreatePlayStoreSubscriptionResult> {
  const { projectId, productId, defaultLanguage = 'en-US', title, description, localizations, basePlans } = params

  const result = await getProjectBasePath(context.userId, projectId)
  if (!result) return { success: false, error: 'Project not found' }

  const { basePath, projectContext } = result

  if (!hasContextPermission(projectContext, 'canCreateProjects')) {
    return { success: false, error: 'Permission denied' }
  }

  try {
    // Check if productId already exists
    const existingSnapshot = await basePath.collection('playStoreSubscriptions')
      .where('productId', '==', productId)
      .limit(1)
      .get()

    if (!existingSnapshot.empty) {
      return { success: false, error: 'Product ID already exists' }
    }

    const now = Timestamp.now()
    const subscriptionRef = basePath.collection('playStoreSubscriptions').doc()

    const mappedBasePlans: PlayStoreBasePlan[] = basePlans.map(bp => {
      const plan: PlayStoreBasePlan = {
        basePlanId: bp.basePlanId,
        state: null,
        type: bp.type,
        defaultPriceUsd: bp.defaultPriceUsd ?? null,
      }
      if (bp.billingPeriodDuration) plan.billingPeriodDuration = bp.billingPeriodDuration
      if (bp.gracePeriodDuration) plan.gracePeriodDuration = bp.gracePeriodDuration
      return plan
    })

    const subscriptionData: Record<string, any> = {
      id: subscriptionRef.id,
      productId,
      syncStatus: 'pending_creation',
      defaultLanguage,
      basePlans: mappedBasePlans,
      createdAt: now,
      updatedAt: now,
    }

    await subscriptionRef.set(subscriptionData)

    // Save localizations — support both top-level title/description and localizations array
    const allLocalizations = localizations && localizations.length > 0
      ? localizations
      : (title ? [{ locale: defaultLanguage, title, description: description || '' }] : [])

    if (allLocalizations.length > 0) {
      const batch = adminDb.batch()
      for (const loc of allLocalizations) {
        const locRef = subscriptionRef.collection('localizations').doc(loc.locale)
        const locData: Record<string, any> = {
          locale: loc.locale,
          title: loc.title.substring(0, PLAYSTORE_IAP_LIMITS.title),
          description: loc.description.substring(0, PLAYSTORE_IAP_LIMITS.description),
        }
        if ('benefits' in loc && loc.benefits) {
          locData.benefits = loc.benefits.slice(0, PLAYSTORE_IAP_LIMITS.benefits)
        }
        batch.set(locRef, locData)
      }
      await batch.commit()
    }

    // Save pricing configs for base plans that have prices
    const pricingBatch = adminDb.batch()
    let hasPricing = false
    for (const bp of basePlans) {
      if (bp.defaultPriceUsd) {
        hasPricing = true
        const pricingRef = subscriptionRef.collection('config').doc(`basePlan_${bp.basePlanId}_pricing`)
        pricingBatch.set(pricingRef, {
          basePriceUsd: bp.defaultPriceUsd,
          strategy: 'auto_convert',
          updatedAt: now,
        })
      }
    }
    if (hasPricing) await pricingBatch.commit()

    return { success: true, subscription: subscriptionData as PlayStoreSubscription }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to create subscription' }
  }
}

// ============================================
// 4. UPDATE PLAY STORE PRODUCT
// ============================================

export interface UpdatePlayStoreProductParams {
  projectId: string
  productId: string // Firestore document ID
  sku?: string
  defaultLanguage?: string
  defaultPriceUsd?: number
  localizations?: Array<{
    locale: string
    title: string
    description: string
  }>
}

export interface UpdatePlayStoreProductResult {
  success: boolean
  product?: PlayStoreProduct
  error?: string
}

export async function updatePlayStoreProduct(
  params: UpdatePlayStoreProductParams,
  context: AccountContext
): Promise<UpdatePlayStoreProductResult> {
  const { projectId, productId, sku, defaultLanguage, defaultPriceUsd, localizations } = params

  const result = await getProjectBasePath(context.userId, projectId)
  if (!result) return { success: false, error: 'Project not found' }

  const { basePath, projectContext } = result

  if (!hasContextPermission(projectContext, 'canCreateProjects')) {
    return { success: false, error: 'Permission denied' }
  }

  try {
    const productRef = basePath.collection('playStoreProducts').doc(productId)
    const productDoc = await productRef.get()

    if (!productDoc.exists) {
      return { success: false, error: 'Product not found' }
    }

    const updates: Partial<PlayStoreProduct> = { updatedAt: Timestamp.now() }

    if (sku !== undefined) updates.sku = sku
    if (defaultLanguage !== undefined) updates.defaultLanguage = defaultLanguage
    if (defaultPriceUsd !== undefined) updates.defaultPriceUsd = defaultPriceUsd

    // Mark as having local changes if synced
    const currentData = productDoc.data() as PlayStoreProduct
    if (currentData.syncStatus === 'synced') {
      updates.syncStatus = 'local_changes'
    }

    await productRef.update(updates)

    // Update localizations
    if (localizations && localizations.length > 0) {
      const batch = adminDb.batch()
      for (const loc of localizations) {
        const locRef = productRef.collection('localizations').doc(loc.locale)
        const locData: PlayStoreProductLocalization = {
          locale: loc.locale,
          title: loc.title.substring(0, PLAYSTORE_IAP_LIMITS.title),
          description: loc.description.substring(0, PLAYSTORE_IAP_LIMITS.description),
        }
        batch.set(locRef, locData, { merge: true })
      }
      await batch.commit()
    }

    const updatedDoc = await productRef.get()
    const product = { id: updatedDoc.id, ...updatedDoc.data() } as PlayStoreProduct

    return { success: true, product }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to update product' }
  }
}

// ============================================
// 5. DELETE PLAY STORE PRODUCT
// ============================================

export interface DeletePlayStoreProductParams {
  projectId: string
  productId: string // Firestore document ID
  productType: 'product' | 'subscription'
}

export interface DeletePlayStoreProductResult {
  success: boolean
  error?: string
}

export async function deletePlayStoreProduct(
  params: DeletePlayStoreProductParams,
  context: AccountContext
): Promise<DeletePlayStoreProductResult> {
  const { projectId, productId, productType } = params

  const result = await getProjectBasePath(context.userId, projectId)
  if (!result) return { success: false, error: 'Project not found' }

  const { basePath, projectContext } = result

  if (!hasContextPermission(projectContext, 'canCreateProjects')) {
    return { success: false, error: 'Permission denied' }
  }

  try {
    const collection = productType === 'product' ? 'playStoreProducts' : 'playStoreSubscriptions'
    const productRef = basePath.collection(collection).doc(productId)

    // Delete localizations subcollection
    const localizationsSnapshot = await productRef.collection('localizations').get()
    const batch = adminDb.batch()
    localizationsSnapshot.docs.forEach(doc => batch.delete(doc.ref))

    // Delete offers subcollection (subscriptions only)
    if (productType === 'subscription') {
      const offersSnapshot = await productRef.collection('offers').get()
      offersSnapshot.docs.forEach(doc => batch.delete(doc.ref))
    }

    // Delete config subcollection
    const configSnapshot = await productRef.collection('config').get()
    configSnapshot.docs.forEach(doc => batch.delete(doc.ref))

    await batch.commit()

    // Delete the product document
    await productRef.delete()

    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to delete product' }
  }
}

// ============================================
// 6. SYNC PLAY STORE PRODUCTS (Pull)
// ============================================

export interface SyncPlayStoreProductsParams {
  projectId: string
}

export interface SyncPlayStoreProductsResult {
  success: boolean
  stats?: {
    productsAdded: number
    productsUpdated: number
    subscriptionsAdded: number
    subscriptionsUpdated: number
    offersAdded: number
    offersUpdated: number
  }
  error?: string
}

export async function syncPlayStoreProducts(
  params: SyncPlayStoreProductsParams,
  context: AccountContext
): Promise<SyncPlayStoreProductsResult> {
  const { projectId } = params

  const helperResult = await getPlayStoreHelper(context.userId, projectId)
  if (!helperResult) {
    return { success: false, error: 'Play Store credentials not configured or permission denied' }
  }

  const { helper, basePath } = helperResult

  try {
    const stats = {
      productsAdded: 0,
      productsUpdated: 0,
      subscriptionsAdded: 0,
      subscriptionsUpdated: 0,
      offersAdded: 0,
      offersUpdated: 0,
    }

    const now = Timestamp.now()

    // Pull one-time products
    const remoteProducts = await helper.listProducts()
    const localProductsSnapshot = await basePath.collection('playStoreProducts').get()
    const localProductsBySku = new Map<string, any>()
    localProductsSnapshot.docs.forEach(doc => {
      const data = doc.data()
      localProductsBySku.set(data.sku, { id: doc.id, ...data })
    })

    for (const remoteProduct of remoteProducts) {
      const local = localProductsBySku.get(remoteProduct.sku)

      const productData: Partial<PlayStoreProduct> = {
        sku: remoteProduct.sku,
        productType: 'ONE_TIME',
        status: remoteProduct.status as PlayStoreProductState,
        syncStatus: 'synced',
        defaultLanguage: remoteProduct.defaultLanguage,
        defaultPriceUsd: remoteProduct.defaultPrice ? priceMicrosToUsd(remoteProduct.defaultPrice.priceMicros) : null,
        updatedAt: now,
      }

      if (local) {
        // Update existing
        await basePath.collection('playStoreProducts').doc(local.id).update(productData)
        stats.productsUpdated++
      } else {
        // Create new
        const productRef = basePath.collection('playStoreProducts').doc()
        await productRef.set({
          id: productRef.id,
          ...productData,
          createdAt: now,
        })
        stats.productsAdded++
      }

      // Sync localizations
      const productRef = local
        ? basePath.collection('playStoreProducts').doc(local.id)
        : basePath.collection('playStoreProducts').doc()

      const batch = adminDb.batch()
      for (const [locale, listing] of Object.entries(remoteProduct.listings)) {
        const locRef = productRef.collection('localizations').doc(locale)
        batch.set(locRef, {
          locale,
          title: listing.title || '',
          description: listing.description || '',
        })
      }
      await batch.commit()
    }

    // Pull subscriptions
    const remoteSubscriptions = await helper.listSubscriptions()
    const localSubscriptionsSnapshot = await basePath.collection('playStoreSubscriptions').get()
    const localSubscriptionsByProductId = new Map<string, any>()
    localSubscriptionsSnapshot.docs.forEach(doc => {
      const data = doc.data()
      localSubscriptionsByProductId.set(data.productId, { id: doc.id, ...data })
    })

    for (const remoteSub of remoteSubscriptions) {
      const local = localSubscriptionsByProductId.get(remoteSub.productId)

      const mappedBasePlans: PlayStoreBasePlan[] = remoteSub.basePlans.map(bp => ({
        basePlanId: bp.basePlanId,
        state: bp.state as PlayStoreProductState,
        type: bp.autoRenewingBasePlanType ? 'AUTO_RENEWING' : 'PREPAID',
        billingPeriodDuration: bp.autoRenewingBasePlanType?.billingPeriodDuration,
        gracePeriodDuration: bp.autoRenewingBasePlanType?.gracePeriodDuration,
        defaultPriceUsd: bp.regionalConfigs.length > 0
          ? moneyToUsd(bp.regionalConfigs[0].price)
          : null,
      }))

      const subscriptionData: Partial<PlayStoreSubscription> = {
        productId: remoteSub.productId,
        syncStatus: 'synced',
        defaultLanguage: remoteSub.listings[0]?.languageCode || 'en-US',
        basePlans: mappedBasePlans,
        updatedAt: now,
      }

      if (local) {
        // Update existing
        await basePath.collection('playStoreSubscriptions').doc(local.id).update(subscriptionData)
        stats.subscriptionsUpdated++
      } else {
        // Create new
        const subscriptionRef = basePath.collection('playStoreSubscriptions').doc()
        await subscriptionRef.set({
          id: subscriptionRef.id,
          ...subscriptionData,
          createdAt: now,
        })
        stats.subscriptionsAdded++
      }

      // Sync localizations
      const subscriptionRef = local
        ? basePath.collection('playStoreSubscriptions').doc(local.id)
        : basePath.collection('playStoreSubscriptions').doc()

      const batch = adminDb.batch()
      for (const listing of remoteSub.listings) {
        const locRef = subscriptionRef.collection('localizations').doc(listing.languageCode)
        batch.set(locRef, {
          locale: listing.languageCode,
          title: listing.title || '',
          description: listing.description || '',
          benefits: listing.benefits || [],
        })
      }
      await batch.commit()

      // Sync offers for each base plan
      for (const basePlan of remoteSub.basePlans) {
        const remoteOffers = await helper.listOffers(remoteSub.productId, basePlan.basePlanId)
        for (const remoteOffer of remoteOffers) {
          const offerRef = subscriptionRef.collection('offers').doc(remoteOffer.offerId)
          const offerDoc = await offerRef.get()

          const offerPhases: PlayStoreOfferPhase[] = remoteOffer.phases.map(p => ({
            recurrenceCount: p.recurrenceCount,
            duration: p.duration,
            priceType: p.regionalConfigs[0]?.free ? 'FREE' : 'DISCOUNTED',
            discountPercent: p.regionalConfigs[0]?.relativeDiscount,
          }))

          const offerData: Partial<PlayStoreOffer> = {
            id: remoteOffer.offerId,
            offerId: remoteOffer.offerId,
            basePlanId: remoteOffer.basePlanId,
            state: remoteOffer.state as PlayStoreProductState,
            syncStatus: 'synced',
            phases: offerPhases,
            targeting: remoteOffer.targeting as any,
            updatedAt: now,
          }

          if (offerDoc.exists) {
            await offerRef.update(offerData)
            stats.offersUpdated++
          } else {
            await offerRef.set({ ...offerData, createdAt: now })
            stats.offersAdded++
          }
        }
      }
    }

    return { success: true, stats }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to sync products' }
  }
}

// ============================================
// 7. PUSH PLAY STORE PRODUCTS
// ============================================

export interface PushPlayStoreProductsParams {
  projectId: string
  productIds?: string[] // Optional filter
  subscriptionIds?: string[] // Optional subscription filter
  pushAll?: boolean
  force?: boolean // Push all items regardless of syncStatus
  confirmed?: boolean // Required — must be true to execute
}

export interface PushPlayStoreProductsResult {
  success: boolean
  results?: Array<{
    id: string
    sku: string
    type: 'product' | 'subscription'
    success: boolean
    error?: string
  }>
  stats?: {
    total: number
    success: number
    failed: number
  }
  error?: string
}

export async function pushPlayStoreProducts(
  params: PushPlayStoreProductsParams,
  context: AccountContext
): Promise<PushPlayStoreProductsResult> {
  const { projectId, productIds, force = false, confirmed = false } = params

  // Require confirmation for push operations
  if (!confirmed) {
    return {
      success: false,
      error: 'Push to Google Play Store requires confirmation. Please ask the user to confirm, then call again with confirmed=true.',
    }
  }

  const helperResult = await getPlayStoreHelper(context.userId, projectId)
  if (!helperResult) {
    return { success: false, error: 'Play Store credentials not configured or permission denied' }
  }

  const { helper, basePath } = helperResult

  try {
    const results: Array<{
      id: string
      sku: string
      type: 'product' | 'subscription'
      success: boolean
      error?: string
    }> = []

    // Push one-time products
    let productsQuery = force
      ? basePath.collection('playStoreProducts')
      : basePath.collection('playStoreProducts').where('syncStatus', 'in', ['pending_creation', 'local_changes'])

    if (productIds && productIds.length > 0) {
      productsQuery = basePath.collection('playStoreProducts')
        .where(FieldPath.documentId(), 'in', productIds)
    }

    const productsSnapshot = await productsQuery.get()

    for (const productDoc of productsSnapshot.docs) {
      const productData = productDoc.data() as PlayStoreProduct

      try {
        // Get localizations
        const localizationsSnapshot = await productDoc.ref.collection('localizations').get()
        const listings: Record<string, { title: string; description: string }> = {}

        for (const locDoc of localizationsSnapshot.docs) {
          const locData = locDoc.data() as PlayStoreProductLocalization
          listings[locData.locale] = {
            title: locData.title,
            description: locData.description,
          }
        }

        // Get pricing from config subcollection (preferred) or fall back to defaultPriceUsd
        const pricingDoc = await productDoc.ref.collection('config').doc('pricing').get()
        const basePriceUsd = pricingDoc.exists ? pricingDoc.data()?.basePriceUsd : productData.defaultPriceUsd

        const defaultPriceMicros = basePriceUsd
          ? usdToPriceMicros(basePriceUsd)
          : '0'

        const defaultPrice = {
          priceMicros: defaultPriceMicros,
          currency: 'USD',
        }

        // Convert regional prices for availability
        let prices: Record<string, { priceMicros: string; currency: string }> = {}
        if (basePriceUsd) {
          try {
            const converted = await helper.convertRegionPrices(basePriceUsd)
            for (const [region, data] of Object.entries(converted)) {
              const d = data as any
              if (d.price) {
                const usd = Number(d.price.units || 0) + (d.price.nanos || 0) / 1e9
                prices[region] = { priceMicros: usdToPriceMicros(usd), currency: d.price.currencyCode || 'USD' }
              }
            }
          } catch {
            prices = { US: { priceMicros: usdToPriceMicros(basePriceUsd), currency: 'USD' } }
          }
        }

        // Create or update product
        const existingProduct = await helper.getProduct(productData.sku)

        if (existingProduct) {
          await helper.updateProduct(productData.sku, { listings, defaultPrice, prices })
        } else {
          await helper.createProduct({
            sku: productData.sku,
            defaultPrice,
            defaultLanguage: productData.defaultLanguage,
            listings,
            prices,
          })
        }

        // Mark as synced
        await productDoc.ref.update({
          syncStatus: 'synced',
          updatedAt: Timestamp.now(),
        })

        results.push({
          id: productDoc.id,
          sku: productData.sku,
          type: 'product',
          success: true,
        })
      } catch (error) {
        results.push({
          id: productDoc.id,
          sku: productData.sku,
          type: 'product',
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        })
      }
    }

    // Push subscriptions
    let subscriptionsQuery = force
      ? basePath.collection('playStoreSubscriptions')
      : basePath.collection('playStoreSubscriptions').where('syncStatus', 'in', ['pending_creation', 'local_changes'])

    if (productIds && productIds.length > 0) {
      subscriptionsQuery = basePath.collection('playStoreSubscriptions')
        .where(FieldPath.documentId(), 'in', productIds)
    }

    const subscriptionsSnapshot = await subscriptionsQuery.get()

    for (const subscriptionDoc of subscriptionsSnapshot.docs) {
      const subscriptionData = subscriptionDoc.data() as PlayStoreSubscription

      try {
        // Get localizations
        const localizationsSnapshot = await subscriptionDoc.ref.collection('localizations').get()
        const listings: Array<{ languageCode: string; title: string; description: string; benefits?: string[] }> = []

        for (const locDoc of localizationsSnapshot.docs) {
          const locData = locDoc.data()
          listings.push({
            languageCode: locData.locale,
            title: locData.title,
            description: locData.description,
            benefits: locData.benefits || [],
          })
        }

        // Build base plans with per-country pricing from convertRegionPrices
        let resolvedRegionsVersion: string | null = null
        const basePlans = await Promise.all(
          subscriptionData.basePlans.map(async bp => {
            const bpPricingDoc = await subscriptionDoc.ref.collection('config').doc(`basePlan_${bp.basePlanId}_pricing`).get()
            const bpPriceUsd = bpPricingDoc.exists ? bpPricingDoc.data()?.basePriceUsd : bp.defaultPriceUsd
            const usdPrice = usdToMoney(bpPriceUsd || 0.99)

            let regionalConfigs: any[] = []
            let otherRegionsConfig: any = undefined

            if (bpPriceUsd) {
              try {
                const { regionalPrices, otherRegionsPrice, regionsVersion } = await helper.convertRegionPricesWithOther(bpPriceUsd)
                resolvedRegionsVersion = regionsVersion

                for (const [regionCode, data] of Object.entries(regionalPrices)) {
                  const d = data as any
                  if (d.price) {
                    regionalConfigs.push({ regionCode, newSubscriberAvailability: true, price: d.price })
                  }
                }

                if (otherRegionsPrice) {
                  otherRegionsConfig = {
                    usdPrice: otherRegionsPrice.usdPrice,
                    eurPrice: otherRegionsPrice.eurPrice,
                    newSubscriberAvailability: true,
                  }
                }
              } catch {
                regionalConfigs = [{ regionCode: 'US', newSubscriberAvailability: true, price: usdPrice }]
                otherRegionsConfig = { usdPrice, eurPrice: usdPrice, newSubscriberAvailability: true }
              }
            } else {
              regionalConfigs = [{ regionCode: 'US', newSubscriberAvailability: true, price: usdPrice }]
              otherRegionsConfig = { usdPrice: usdToMoney(0.99), eurPrice: usdToMoney(0.99), newSubscriberAvailability: true }
            }

            const plan: any = {
              basePlanId: bp.basePlanId,
              autoRenewingBasePlanType: bp.type === 'AUTO_RENEWING' ? {
                billingPeriodDuration: bp.billingPeriodDuration || 'P1M',
                gracePeriodDuration: bp.gracePeriodDuration,
              } : undefined,
              prepaidBasePlanType: bp.type === 'PREPAID' ? {} : undefined,
              regionalConfigs,
              otherRegionsConfig,
            }
            return plan
          })
        )

        // Create or update subscription
        const existingSubscription = await helper.getSubscription(subscriptionData.productId)

        if (existingSubscription) {
          // GET the full raw subscription to merge our pricing into.
          // The API requires complete basePlan objects — partial objects fail silently.
          const rawRemoteSub = await helper.getSubscriptionRaw(subscriptionData.productId)

          const localBasePlanMap = new Map<string, any>()
          for (const bp of basePlans) {
            localBasePlanMap.set(bp.basePlanId, bp)
          }

          let mergedBasePlans: any[]
          if (rawRemoteSub?.basePlans?.length > 0) {
            mergedBasePlans = rawRemoteSub.basePlans.map((remoteBp: any) => {
              const localBp = localBasePlanMap.get(remoteBp.basePlanId)
              const { state, ...remoteBpWithoutState } = remoteBp
              return {
                ...remoteBpWithoutState,
                regionalConfigs: localBp ? localBp.regionalConfigs : remoteBp.regionalConfigs,
                ...(localBp?.otherRegionsConfig ? { otherRegionsConfig: localBp.otherRegionsConfig } : {}),
              }
            })
            for (const bp of basePlans) {
              if (!rawRemoteSub.basePlans.find((r: any) => r.basePlanId === bp.basePlanId)) {
                mergedBasePlans.push(bp)
              }
            }
          } else {
            mergedBasePlans = basePlans
          }

          await helper.updateSubscription(subscriptionData.productId, { listings, basePlans: mergedBasePlans, regionsVersion: resolvedRegionsVersion || undefined })

          // Re-activate base plans after update (they may revert to DRAFT)
          for (const bp of subscriptionData.basePlans) {
            try {
              await helper.activateBasePlan(subscriptionData.productId, bp.basePlanId)
            } catch {
              // May already be active
            }
          }
        } else {
          await helper.createSubscription({
            productId: subscriptionData.productId,
            listings,
            basePlans,
            regionsVersion: resolvedRegionsVersion || undefined,
          })

          // Activate base plans for new subscriptions
          for (const bp of subscriptionData.basePlans) {
            await helper.activateBasePlan(subscriptionData.productId, bp.basePlanId)
          }
        }

        // Mark as synced
        await subscriptionDoc.ref.update({
          syncStatus: 'synced',
          updatedAt: Timestamp.now(),
        })

        results.push({
          id: subscriptionDoc.id,
          sku: subscriptionData.productId,
          type: 'subscription',
          success: true,
        })
      } catch (error) {
        results.push({
          id: subscriptionDoc.id,
          sku: subscriptionData.productId,
          type: 'subscription',
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        })
      }
    }

    const successCount = results.filter(r => r.success).length

    return {
      success: successCount > 0,
      results,
      stats: {
        total: results.length,
        success: successCount,
        failed: results.length - successCount,
      },
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to push products' }
  }
}

// ============================================
// 8. SET PLAY STORE PRICING
// ============================================

export interface SetPlayStorePricingParams {
  projectId: string
  productId: string // Firestore document ID
  productType: 'product' | 'subscription'
  basePlanId?: string // Required for subscriptions
  basePriceUsd: number
  strategy: 'auto_convert' | 'manual'
}

export interface SetPlayStorePricingResult {
  success: boolean
  error?: string
}

export async function setPlayStorePricing(
  params: SetPlayStorePricingParams,
  context: AccountContext
): Promise<SetPlayStorePricingResult> {
  const { projectId, productId, productType, basePlanId, basePriceUsd, strategy } = params

  const result = await getProjectBasePath(context.userId, projectId)
  if (!result) return { success: false, error: 'Project not found' }

  const { basePath, projectContext } = result

  if (!hasContextPermission(projectContext, 'canCreateProjects')) {
    return { success: false, error: 'Permission denied' }
  }

  try {
    const collection = productType === 'product' ? 'playStoreProducts' : 'playStoreSubscriptions'
    const productRef = basePath.collection(collection).doc(productId)

    const pricingConfig: PlayStorePricingConfig = {
      basePriceUsd,
      strategy,
      updatedAt: Timestamp.now(),
    }

    const configDocId = productType === 'subscription' && basePlanId
      ? `basePlan_${basePlanId}_pricing`
      : 'pricing'

    await productRef.collection('config').doc(configDocId).set(pricingConfig)

    // Update product with base price
    if (productType === 'product') {
      await productRef.update({
        defaultPriceUsd: basePriceUsd,
        syncStatus: 'local_changes',
        updatedAt: Timestamp.now(),
      })
    } else if (basePlanId) {
      // Update base plan price in subscription
      const subscriptionDoc = await productRef.get()
      const subscriptionData = subscriptionDoc.data() as PlayStoreSubscription
      const updatedBasePlans = subscriptionData.basePlans.map(bp =>
        bp.basePlanId === basePlanId
          ? { ...bp, defaultPriceUsd: basePriceUsd }
          : bp
      )
      await productRef.update({
        basePlans: updatedBasePlans,
        syncStatus: 'local_changes',
        updatedAt: Timestamp.now(),
      })
    }

    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to set pricing' }
  }
}

// ============================================
// 9. PREVIEW PLAY STORE PRICING
// ============================================

export interface PreviewPlayStorePricingParams {
  projectId: string
  basePriceUsd: number
}

export interface PreviewPlayStorePricingResult {
  success: boolean
  regionalPrices?: Record<string, {
    regionCode: string
    price: { currencyCode: string; units: string; nanos: number }
    displayPrice: string
  }>
  error?: string
}

export async function previewPlayStorePricing(
  params: PreviewPlayStorePricingParams,
  context: AccountContext
): Promise<PreviewPlayStorePricingResult> {
  const { projectId, basePriceUsd } = params

  const helperResult = await getPlayStoreHelper(context.userId, projectId)
  if (!helperResult) {
    return { success: false, error: 'Play Store credentials not configured or permission denied' }
  }

  const { helper } = helperResult

  try {
    const convertedPrices = await helper.convertRegionPrices(basePriceUsd)

    const regionalPrices: Record<string, {
      regionCode: string
      price: { currencyCode: string; units: string; nanos: number }
      displayPrice: string
    }> = {}

    for (const [regionCode, priceInfo] of Object.entries(convertedPrices)) {
      const price = priceInfo.price
      const displayPrice = `${price.currencyCode} ${moneyToUsd(price).toFixed(2)}`

      regionalPrices[regionCode] = {
        regionCode,
        price,
        displayPrice,
      }
    }

    return { success: true, regionalPrices }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to preview pricing' }
  }
}

// ============================================
// 10. TRANSLATE PLAY STORE PRODUCTS
// ============================================

export interface TranslatePlayStoreProductsParams {
  projectId: string
  productId: string // Firestore document ID
  productType: 'product' | 'subscription'
  sourceLocale: string
  targetLocales: string[]
  forceTranslate?: boolean
}

export interface TranslatePlayStoreProductsResult {
  success: boolean
  translations?: Array<{
    locale: string
    title: string
    description: string
    fromCache: boolean
  }>
  error?: string
}

export async function translatePlayStoreProducts(
  params: TranslatePlayStoreProductsParams,
  context: AccountContext
): Promise<TranslatePlayStoreProductsResult> {
  const { projectId, productId, productType, sourceLocale, targetLocales, forceTranslate = false } = params

  const result = await getProjectBasePath(context.userId, projectId)
  if (!result) return { success: false, error: 'Project not found' }

  const { basePath, projectContext } = result

  if (!hasContextPermission(projectContext, 'canCreateProjects')) {
    return { success: false, error: 'Permission denied' }
  }

  let usageOperationId: string | undefined
  try {
    const collection = productType === 'product' ? 'playStoreProducts' : 'playStoreSubscriptions'
    const productRef = basePath.collection(collection).doc(productId)

    // Get source localization
    const sourceLocDoc = await productRef.collection('localizations').doc(sourceLocale).get()
    if (!sourceLocDoc.exists) {
      return { success: false, error: 'Source localization not found' }
    }

    const sourceLocData = sourceLocDoc.data()!
    const sourceTitle = sourceLocData.title || ''
    const sourceDescription = sourceLocData.description || ''

    // Load existing translation cache
    const cacheSnapshot = await productRef.collection('translationCache').get()
    const existingCache = new Map<string, IAPTranslationCache>()
    cacheSnapshot.docs.forEach(doc => {
      const data = doc.data() as IAPTranslationCache
      existingCache.set(doc.id, data)
    })

    const billableLocales = getIAPLocalesRequiringTranslation({
      sourceLocale,
      targetLocales,
      displayName: sourceTitle,
      description: sourceDescription,
      existingCache: forceTranslate ? undefined : existingCache,
      forceTranslate,
    })
    const usage = await reserveTranslationCredits(context, params, billableLocales.length, {
      tool: 'translate_play_store_products',
      projectId,
      productId,
      productType,
    })
    if (usage.error) return { success: false, error: usage.error }
    usageOperationId = usage.operationId

    // Translate using AI
    const translations = await translateIAPFields({
      sourceLocale,
      targetLocales,
      displayName: sourceTitle,
      description: sourceDescription,
      existingCache,
      forceTranslate,
    })

    // Save translations to Firestore
    const batch = adminDb.batch()

    for (const translation of translations) {
      // Save localization
      const locRef = productRef.collection('localizations').doc(translation.locale)
      batch.set(locRef, {
        locale: translation.locale,
        title: translation.displayName,
        description: translation.description,
      }, { merge: true })

      // Save cache entries
      const cacheKeyTitle = `${translation.locale}_displayName`
      const cacheKeyDesc = `${translation.locale}_description`

      batch.set(productRef.collection('translationCache').doc(cacheKeyTitle), {
        locale: translation.locale,
        field: 'displayName',
        sourceHash: translation.sourceHash,
        translatedText: translation.displayName,
        createdAt: Timestamp.now(),
      })

      batch.set(productRef.collection('translationCache').doc(cacheKeyDesc), {
        locale: translation.locale,
        field: 'description',
        sourceHash: translation.sourceHash,
        translatedText: translation.description,
        createdAt: Timestamp.now(),
      })
    }

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
      translations: translations.map(t => ({
        locale: t.locale,
        title: t.displayName,
        description: t.description,
        fromCache: t.fromCache,
      })),
    }
  } catch (error) {
    if (usageOperationId) await refundUsage(context, usageOperationId, 'translations')
    return { success: false, error: error instanceof Error ? error.message : 'Failed to translate products' }
  }
}

// ============================================
// 11. ACTIVATE PLAY STORE BASE PLAN
// ============================================

export interface ActivatePlayStoreBasePlanParams {
  projectId: string
  productId: string // Firestore document ID
  basePlanId: string
}

export interface ActivatePlayStoreBasePlanResult {
  success: boolean
  error?: string
}

export async function activatePlayStoreBasePlan(
  params: ActivatePlayStoreBasePlanParams,
  context: AccountContext
): Promise<ActivatePlayStoreBasePlanResult> {
  const { projectId, productId, basePlanId } = params

  const helperResult = await getPlayStoreHelper(context.userId, projectId)
  if (!helperResult) {
    return { success: false, error: 'Play Store credentials not configured or permission denied' }
  }

  const { helper, basePath } = helperResult

  try {
    const subscriptionRef = basePath.collection('playStoreSubscriptions').doc(productId)
    const subscriptionDoc = await subscriptionRef.get()

    if (!subscriptionDoc.exists) {
      return { success: false, error: 'Subscription not found' }
    }

    const subscriptionData = subscriptionDoc.data() as PlayStoreSubscription

    // Activate base plan in Play Store
    await helper.activateBasePlan(subscriptionData.productId, basePlanId)

    // Update local state
    const updatedBasePlans = subscriptionData.basePlans.map(bp =>
      bp.basePlanId === basePlanId
        ? { ...bp, state: 'ACTIVE' as PlayStoreProductState }
        : bp
    )

    await subscriptionRef.update({
      basePlans: updatedBasePlans,
      updatedAt: Timestamp.now(),
    })

    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to activate base plan' }
  }
}

// ============================================
// 12. DEACTIVATE PLAY STORE BASE PLAN
// ============================================

export interface DeactivatePlayStoreBasePlanParams {
  projectId: string
  productId: string // Firestore document ID
  basePlanId: string
}

export interface DeactivatePlayStoreBasePlanResult {
  success: boolean
  error?: string
}

export async function deactivatePlayStoreBasePlan(
  params: DeactivatePlayStoreBasePlanParams,
  context: AccountContext
): Promise<DeactivatePlayStoreBasePlanResult> {
  const { projectId, productId, basePlanId } = params

  const helperResult = await getPlayStoreHelper(context.userId, projectId)
  if (!helperResult) {
    return { success: false, error: 'Play Store credentials not configured or permission denied' }
  }

  const { helper, basePath } = helperResult

  try {
    const subscriptionRef = basePath.collection('playStoreSubscriptions').doc(productId)
    const subscriptionDoc = await subscriptionRef.get()

    if (!subscriptionDoc.exists) {
      return { success: false, error: 'Subscription not found' }
    }

    const subscriptionData = subscriptionDoc.data() as PlayStoreSubscription

    // Deactivate base plan in Play Store
    await helper.deactivateBasePlan(subscriptionData.productId, basePlanId)

    // Update local state
    const updatedBasePlans = subscriptionData.basePlans.map(bp =>
      bp.basePlanId === basePlanId
        ? { ...bp, state: 'INACTIVE' as PlayStoreProductState }
        : bp
    )

    await subscriptionRef.update({
      basePlans: updatedBasePlans,
      updatedAt: Timestamp.now(),
    })

    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to deactivate base plan' }
  }
}

// ============================================
// 13. CREATE PLAY STORE OFFER (free trial, discount)
// ============================================

export interface CreatePlayStoreOfferParams {
  projectId: string
  subscriptionId: string // Firestore document ID
  basePlanId: string
  offerId: string
  phases: Array<{
    duration: string // ISO 8601: P3D, P1W, P1M, P3M, P6M, P1Y
    recurrenceCount: number
    priceType: 'FREE' | 'DISCOUNTED'
    discountPercent?: number
  }>
}

export interface CreatePlayStoreOfferResult {
  success: boolean
  offer?: any
  error?: string
}

export async function createPlayStoreOffer(
  params: CreatePlayStoreOfferParams,
  context: AccountContext
): Promise<CreatePlayStoreOfferResult> {
  const { projectId, subscriptionId, basePlanId, offerId, phases } = params

  const result = await getProjectBasePath(context.userId, projectId)
  if (!result) return { success: false, error: 'Project not found' }

  const { basePath, projectContext } = result
  if (!hasContextPermission(projectContext, 'canCreateProjects')) {
    return { success: false, error: 'Permission denied' }
  }

  try {
    const subRef = basePath.collection('playStoreSubscriptions').doc(subscriptionId)
    const subDoc = await subRef.get()
    if (!subDoc.exists) return { success: false, error: 'Subscription not found' }

    // Validate basePlanId exists
    const subData = subDoc.data() as PlayStoreSubscription
    const basePlan = subData.basePlans?.find(bp => bp.basePlanId === basePlanId)
    if (!basePlan) return { success: false, error: `Base plan '${basePlanId}' not found` }

    // Check duplicate offerId
    const existingOffer = await subRef.collection('offers').where('offerId', '==', offerId).get()
    if (!existingOffer.empty) return { success: false, error: `Offer '${offerId}' already exists` }

    const now = Timestamp.now()
    const offerData = {
      offerId,
      basePlanId,
      state: null,
      syncStatus: 'pending_creation' as IAPSyncStatus,
      phases,
      createdAt: now,
      updatedAt: now,
    }

    const offerRef = await subRef.collection('offers').add(offerData)

    // Mark subscription as having local changes
    if (subData.syncStatus === 'synced') {
      await subRef.update({ syncStatus: 'local_changes', updatedAt: now })
    }

    return { success: true, offer: { id: offerRef.id, ...offerData } }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to create offer' }
  }
}

// ============================================
// 14. LIST PLAY STORE OFFERS
// ============================================

export interface ListPlayStoreOffersParams {
  projectId: string
  subscriptionId: string
}

export interface ListPlayStoreOffersResult {
  success: boolean
  offers?: any[]
  error?: string
}

export async function listPlayStoreOffers(
  params: ListPlayStoreOffersParams,
  context: AccountContext
): Promise<ListPlayStoreOffersResult> {
  const { projectId, subscriptionId } = params

  const result = await getProjectBasePath(context.userId, projectId)
  if (!result) return { success: false, error: 'Project not found' }

  const { basePath } = result

  try {
    const subRef = basePath.collection('playStoreSubscriptions').doc(subscriptionId)
    const subDoc = await subRef.get()
    if (!subDoc.exists) return { success: false, error: 'Subscription not found' }

    const offersSnapshot = await subRef.collection('offers').get()
    const offers = offersSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))

    return { success: true, offers }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to list offers' }
  }
}

// ============================================
// 15. ACTIVATE PLAY STORE OFFER
// ============================================

export interface ActivatePlayStoreOfferParams {
  projectId: string
  subscriptionId: string // Firestore document ID
  basePlanId: string
  offerId: string
}

export interface ActivatePlayStoreOfferResult {
  success: boolean
  error?: string
}

export async function activatePlayStoreOffer(
  params: ActivatePlayStoreOfferParams,
  context: AccountContext
): Promise<ActivatePlayStoreOfferResult> {
  const { projectId, subscriptionId, basePlanId, offerId } = params

  const helperResult = await getPlayStoreHelper(context.userId, projectId)
  if (!helperResult) {
    return { success: false, error: 'Play Store credentials not configured or permission denied' }
  }

  const { helper, basePath } = helperResult

  try {
    const subRef = basePath.collection('playStoreSubscriptions').doc(subscriptionId)
    const subDoc = await subRef.get()
    if (!subDoc.exists) return { success: false, error: 'Subscription not found' }

    const subData = subDoc.data() as PlayStoreSubscription

    await helper.activateOffer(subData.productId, basePlanId, offerId)

    // Update local offer state
    const offersSnapshot = await subRef.collection('offers').where('offerId', '==', offerId).get()
    if (!offersSnapshot.empty) {
      await offersSnapshot.docs[0].ref.update({
        state: 'ACTIVE',
        syncStatus: 'synced',
        updatedAt: Timestamp.now(),
      })
    }

    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to activate offer' }
  }
}

// ============================================
// 16. DEACTIVATE PLAY STORE OFFER
// ============================================

export interface DeactivatePlayStoreOfferParams {
  projectId: string
  subscriptionId: string
  basePlanId: string
  offerId: string
}

export interface DeactivatePlayStoreOfferResult {
  success: boolean
  error?: string
}

export async function deactivatePlayStoreOffer(
  params: DeactivatePlayStoreOfferParams,
  context: AccountContext
): Promise<DeactivatePlayStoreOfferResult> {
  const { projectId, subscriptionId, basePlanId, offerId } = params

  const helperResult = await getPlayStoreHelper(context.userId, projectId)
  if (!helperResult) {
    return { success: false, error: 'Play Store credentials not configured or permission denied' }
  }

  const { helper, basePath } = helperResult

  try {
    const subRef = basePath.collection('playStoreSubscriptions').doc(subscriptionId)
    const subDoc = await subRef.get()
    if (!subDoc.exists) return { success: false, error: 'Subscription not found' }

    const subData = subDoc.data() as PlayStoreSubscription

    await helper.deactivateOffer(subData.productId, basePlanId, offerId)

    // Update local offer state
    const offersSnapshot = await subRef.collection('offers').where('offerId', '==', offerId).get()
    if (!offersSnapshot.empty) {
      await offersSnapshot.docs[0].ref.update({
        state: 'INACTIVE',
        syncStatus: 'synced',
        updatedAt: Timestamp.now(),
      })
    }

    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to deactivate offer' }
  }
}

// ============================================
// 17. PUSH PLAY STORE OFFERS
// ============================================

export interface PushPlayStoreOffersParams {
  projectId: string
  subscriptionId?: string // Optional: limit to a specific subscription
  offerIds?: string[] // Optional: limit to specific offer IDs
  activate?: boolean // Auto-activate after creation (default: true)
  confirmed?: boolean // Required — must be true to execute
}

export interface PushPlayStoreOffersResult {
  success: boolean
  results?: Array<{
    subscriptionId: string
    productId: string
    basePlanId: string
    offerId: string
    action: 'created' | 'created_with_warning' | 'activated' | 'already_exists' | 'skipped'
    success: boolean
    error?: string
    warning?: string
  }>
  stats?: {
    total: number
    created: number
    activated: number
    alreadyExisted: number
    failed: number
  }
  error?: string
}

export async function pushPlayStoreOffers(
  params: PushPlayStoreOffersParams,
  context: AccountContext
): Promise<PushPlayStoreOffersResult> {
  const { projectId, subscriptionId, offerIds, activate = true, confirmed = false } = params

  // Require confirmation for push operations
  if (!confirmed) {
    return {
      success: false,
      error: 'Push offers to Google Play Store requires confirmation. Please ask the user to confirm, then call again with confirmed=true.',
    }
  }

  const helperResult = await getPlayStoreHelper(context.userId, projectId)
  if (!helperResult) {
    return { success: false, error: 'Play Store credentials not configured or permission denied' }
  }

  const { helper, basePath } = helperResult

  try {
    const results: PushPlayStoreOffersResult['results'] = []

    // Get subscriptions to process
    let subscriptionsQuery = subscriptionId
      ? basePath.collection('playStoreSubscriptions').where(FieldPath.documentId(), '==', subscriptionId)
      : basePath.collection('playStoreSubscriptions')

    const subscriptionsSnapshot = await subscriptionsQuery.get()

    for (const subscriptionDoc of subscriptionsSnapshot.docs) {
      const subscriptionData = subscriptionDoc.data() as PlayStoreSubscription

      // Get offers for this subscription
      let offersQuery = subscriptionDoc.ref.collection('offers')
        .where('syncStatus', 'in', ['pending_creation', 'local_changes'])

      if (offerIds && offerIds.length > 0) {
        // If specific offerIds requested, get those regardless of syncStatus
        offersQuery = subscriptionDoc.ref.collection('offers')
          .where('offerId', 'in', offerIds)
      }

      const offersSnapshot = await offersQuery.get()

      for (const offerDoc of offersSnapshot.docs) {
        const offerData = offerDoc.data() as PlayStoreOffer

        try {
          // Check if offer already exists on Play Console
          const existingOffers = await helper.listOffers(subscriptionData.productId, offerData.basePlanId)
          const existingOffer = existingOffers.find(o => o.offerId === offerData.offerId)

          if (existingOffer) {
            // Offer already exists on Play Console — mark as synced
            await offerDoc.ref.update({
              state: existingOffer.state || 'DRAFT',
              syncStatus: 'synced',
              updatedAt: Timestamp.now(),
            })

            results.push({
              subscriptionId: subscriptionDoc.id,
              productId: subscriptionData.productId,
              basePlanId: offerData.basePlanId,
              offerId: offerData.offerId,
              action: 'already_exists',
              success: true,
            })
            continue
          }

          // Build phases for the Play Console API
          // For FREE phases, use `free: {}` in regionalConfigs
          // For DISCOUNTED phases, use `relativeDiscount: <fraction>` in regionalConfigs (e.g. 0.5 = 50%)
          const basePlan = subscriptionData.basePlans?.find(bp => bp.basePlanId === offerData.basePlanId)
          const bpPriceUsd = basePlan?.defaultPriceUsd || 0.99

          // Get regional prices for discounted phases
          let regionalPrices: Record<string, { price: any; taxAmount?: any }> = {}
          let regionsVersion: string | null = null
          try {
            const converted = await helper.convertRegionPricesWithOther(bpPriceUsd)
            regionalPrices = converted.regionalPrices
            regionsVersion = converted.regionsVersion
          } catch {
            // Fallback to US-only
          }

          const regionCodes = Object.keys(regionalPrices)
          if (regionCodes.length === 0) {
            regionCodes.push('US')
          }

          const apiPhases = offerData.phases.map(phase => {
            const phaseRegionalConfigs = regionCodes.map(regionCode => {
              if (phase.priceType === 'FREE') {
                return { regionCode, free: {} }
              } else {
                // DISCOUNTED — use relative discount
                return {
                  regionCode,
                  relativeDiscount: (phase.discountPercent || 0) / 100,
                }
              }
            })

            // otherRegionsConfig is required on each phase when the base plan has it
            const otherRegionsConfig = phase.priceType === 'FREE'
              ? { free: {} }
              : { relativeDiscount: (phase.discountPercent || 0) / 100 }

            return {
              recurrenceCount: phase.recurrenceCount,
              duration: phase.duration,
              regionalConfigs: phaseRegionalConfigs,
              otherRegionsConfig,
            }
          })

          // Create offer on Play Console
          await helper.createOffer(subscriptionData.productId, offerData.basePlanId, {
            offerId: offerData.offerId,
            phases: apiPhases,
            targeting: offerData.targeting
              ? { acquisitionRule: { scope: { scopeType: offerData.targeting.acquisitionRule?.scope || 'ALL_NEW_BUYER_ACQUISITIONS' } } }
              : undefined,
            regionsVersion: regionsVersion || undefined,
          })

          // Update local state
          await offerDoc.ref.update({
            state: 'DRAFT',
            syncStatus: 'synced',
            updatedAt: Timestamp.now(),
          })

          results.push({
            subscriptionId: subscriptionDoc.id,
            productId: subscriptionData.productId,
            basePlanId: offerData.basePlanId,
            offerId: offerData.offerId,
            action: 'created',
            success: true,
          })

          // Auto-activate if requested
          if (activate) {
            try {
              await helper.activateOffer(subscriptionData.productId, offerData.basePlanId, offerData.offerId)

              await offerDoc.ref.update({
                state: 'ACTIVE',
                updatedAt: Timestamp.now(),
              })

              results.push({
                subscriptionId: subscriptionDoc.id,
                productId: subscriptionData.productId,
                basePlanId: offerData.basePlanId,
                offerId: offerData.offerId,
                action: 'activated',
                success: true,
              })
            } catch (activateError) {
              results.push({
                subscriptionId: subscriptionDoc.id,
                productId: subscriptionData.productId,
                basePlanId: offerData.basePlanId,
                offerId: offerData.offerId,
                action: 'activated',
                success: false,
                error: activateError instanceof Error ? activateError.message : 'Failed to activate offer',
              })
            }
          }
        } catch (error) {
          // Check if offer was actually created despite the error (partial success)
          try {
            const existingOffers = await helper.listOffers(subscriptionData.productId, offerData.basePlanId)
            const wasCreated = existingOffers.find(o => o.offerId === offerData.offerId)
            if (wasCreated) {
              await offerDoc.ref.update({
                state: wasCreated.state || 'DRAFT',
                syncStatus: 'synced',
                updatedAt: Timestamp.now(),
              })
              results.push({
                subscriptionId: subscriptionDoc.id,
                productId: subscriptionData.productId,
                basePlanId: offerData.basePlanId,
                offerId: offerData.offerId,
                action: 'created_with_warning',
                success: true,
                warning: error instanceof Error ? error.message : 'Unknown warning',
              })
              // Still try to activate if requested
              if (activate) {
                try {
                  await helper.activateOffer(subscriptionData.productId, offerData.basePlanId, offerData.offerId)
                  await offerDoc.ref.update({ state: 'ACTIVE', updatedAt: Timestamp.now() })
                } catch { /* already created, activation can be retried */ }
              }
              continue
            }
          } catch { /* list failed too, report original error */ }

          results.push({
            subscriptionId: subscriptionDoc.id,
            productId: subscriptionData.productId,
            basePlanId: offerData.basePlanId,
            offerId: offerData.offerId,
            action: 'created',
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          })
        }
      }
    }

    const created = results.filter(r => (r.action === 'created' || r.action === 'created_with_warning') && r.success).length
    const activated = results.filter(r => r.action === 'activated' && r.success).length
    const alreadyExisted = results.filter(r => r.action === 'already_exists').length
    const failed = results.filter(r => !r.success).length

    return {
      success: failed === 0 || created > 0 || alreadyExisted > 0,
      results,
      stats: {
        total: results.length,
        created,
        activated,
        alreadyExisted,
        failed,
      },
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to push offers' }
  }
}
