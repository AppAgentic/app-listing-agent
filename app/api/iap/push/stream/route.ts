import { NextRequest } from 'next/server'
import { z } from 'zod'
import { authenticateRequest } from '@/lib/api/auth'
import { getProjectContext, hasContextPermission, getAccountContext, AccountContext } from '@/lib/org/context'
import { getSession } from '@/lib/auth/session'
import { adminDb } from '@/lib/firebase/admin'
import { Timestamp } from 'firebase-admin/firestore'
import { getAppStoreHelper } from '@/lib/services/credentials'
import type { InAppPurchase, IAPLocalization, SubscriptionGroup, Subscription } from '@/lib/firebase/firestore'
import type { IAPProductTypeAPI, AppStoreHelper } from '@/lib/services/appstore'
import { canPushInState, canEditField } from '@/lib/iap/state-config'
import { resolveIAPPricingForPush, resolveSubscriptionPricingForPush } from '@/lib/services/iap-pricing'

// Pricing config stored in Firestore
interface PricingConfig {
  baseTerritory: string
  basePricePointId: string
  strategy: 'equalized' | 'custom' | 'indexed'
  pricingStrategyId?: string
  customPrices?: Record<string, string>
  updatedAt: FirebaseFirestore.Timestamp
}

// Intro offer config stored in Firestore
interface IntroOfferConfig {
  offerMode: 'PAY_AS_YOU_GO' | 'PAY_UP_FRONT' | 'FREE_TRIAL'
  duration: string
  numberOfPeriods: number
  territories: string[]
  startDate: string
  endDate: string | null
  subscriptionPricePointId: string | null
  appStoreId: string | null
  updatedAt: FirebaseFirestore.Timestamp
}

// Screenshot config stored in Firestore
interface ScreenshotConfig {
  fileName: string
  mimeType: string
  r2Key?: string
  r2Url?: string
  fileSize: number
}

// Local price point mapping
const LOCAL_PRICE_POINTS: Record<string, number> = {
  p0: 0, p1: 0.99, p2: 1.99, p3: 2.99, p4: 3.99, p5: 4.99,
  p6: 5.99, p7: 6.99, p8: 7.99, p9: 9.99, p10: 11.99,
  p11: 14.99, p12: 19.99, p13: 24.99, p14: 29.99, p15: 39.99,
  p16: 49.99, p17: 59.99, p18: 79.99, p19: 99.99,
}

// Progress event types
type ProgressEvent = {
  type: 'start'
  totalItems: number
  items: { id: string; name: string; itemType: 'iap' | 'subscription' }[]
} | {
  type: 'item_start'
  itemId: string
  itemName: string
  step: string
} | {
  type: 'item_progress'
  itemId: string
  step: string
  detail?: string
  progress?: { current: number; total: number }
} | {
  type: 'item_complete'
  itemId: string
  result: 'created' | 'updated' | 'error'
  error?: string
} | {
  type: 'complete'
  created: string[]
  updated: string[]
  errors: { id: string; error: string }[]
}

const pushSchema = z.object({
  projectId: z.string(),
  iapIds: z.array(z.string()).optional(),
  subscriptionIds: z.array(z.string()).optional(),
  pushAll: z.boolean().optional().default(false),
})

async function getAuthContext(request: NextRequest): Promise<{ context: AccountContext | null; error?: string }> {
  const authHeader = request.headers.get('Authorization')
  if (authHeader) {
    const auth = await authenticateRequest(request)
    if (auth.authenticated && auth.context) {
      return { context: auth.context }
    }
    return { context: null, error: auth.error }
  }

  const session = await getSession()
  if (session) {
    const context = await getAccountContext(session.userId)
    if (context) {
      return { context }
    }
    return { context: null, error: 'User not found' }
  }

  return { context: null, error: 'Authentication required' }
}

// Helper to get image buffer from screenshot config
async function getImageBuffer(config: ScreenshotConfig): Promise<Buffer | null> {
  if (!config.r2Url) return null
  try {
    const response = await fetch(config.r2Url)
    if (response.ok) {
      return Buffer.from(await response.arrayBuffer())
    }
    return null
  } catch {
    return null
  }
}

export async function POST(request: NextRequest) {
  const { context: authContext, error: authError } = await getAuthContext(request)
  if (!authContext) {
    return new Response(JSON.stringify({ error: authError }), { status: 401 })
  }

  let body
  try {
    body = pushSchema.parse(await request.json())
  } catch (error) {
    if (error instanceof z.ZodError) {
      return new Response(JSON.stringify({ error: `Validation error: ${error.errors.map(e => e.message).join(', ')}` }), { status: 400 })
    }
    return new Response(JSON.stringify({ error: 'Invalid request body' }), { status: 400 })
  }

  const { projectId, subscriptionIds, pushAll } = body

  const projectContext = await getProjectContext(authContext.userId, projectId)
  if (!projectContext) {
    return new Response(JSON.stringify({ error: 'Project not found' }), { status: 404 })
  }

  if (!hasContextPermission(projectContext, 'canCreateProjects')) {
    return new Response(JSON.stringify({ error: 'Permission denied' }), { status: 403 })
  }

  // Create SSE stream
  const encoder = new TextEncoder()
  const stream = new TransformStream()
  const writer = stream.writable.getWriter()

  let streamClosed = false
  const sendEvent = async (event: ProgressEvent) => {
    if (streamClosed) return
    try {
      await writer.write(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
    } catch {
      // Client disconnected — continue processing silently
      streamClosed = true
    }
  }

  // Start processing in background
  const processAsync = async () => {
    try {
      const basePath = projectContext.type === 'organization' && projectContext.orgId
        ? adminDb.collection('organizations').doc(projectContext.orgId).collection('projects').doc(projectId)
        : adminDb.collection('users').doc(authContext.userId).collection('projects').doc(projectId)

      const appStoreHelper = await getAppStoreHelper(authContext.userId, projectId, projectContext.orgId)
      const now = Timestamp.now()

      const results = {
        created: [] as string[],
        updated: [] as string[],
        errors: [] as { id: string; error: string }[],
      }

      // Gather all items to process
      const itemsToProcess: { id: string; name: string; itemType: 'iap' | 'subscription'; docRef: FirebaseFirestore.DocumentReference; data: any }[] = []

      // Get IAPs
      if (pushAll) {
        const allIaps = await basePath.collection('inAppPurchases')
          .where('syncStatus', 'in', ['pending_creation', 'local_changes'])
          .get()
        for (const doc of allIaps.docs) {
          const iap = doc.data() as InAppPurchase
          if (iap.productType !== 'AUTO_RENEWABLE_SUBSCRIPTION') {
            itemsToProcess.push({ id: iap.productId, name: iap.name, itemType: 'iap', docRef: doc.ref, data: iap })
          }
        }
      }

      // Get subscriptions
      if (subscriptionIds && subscriptionIds.length > 0) {
        const groupsSnapshot = await basePath.collection('subscriptionGroups').get()
        for (const groupDoc of groupsSnapshot.docs) {
          const group = groupDoc.data() as SubscriptionGroup
          const subsSnapshot = await groupDoc.ref.collection('subscriptions').get()

          for (const subDoc of subsSnapshot.docs) {
            if (subscriptionIds.includes(subDoc.id)) {
              const sub = subDoc.data() as Subscription
              itemsToProcess.push({
                id: sub.productId,
                name: sub.name,
                itemType: 'subscription',
                docRef: subDoc.ref,
                data: { ...sub, group, groupDoc },
              })
            }
          }
        }
      }

      // Send start event
      await sendEvent({
        type: 'start',
        totalItems: itemsToProcess.length,
        items: itemsToProcess.map(i => ({ id: i.id, name: i.name, itemType: i.itemType })),
      })

      // Process each item
      for (const item of itemsToProcess) {
        try {
          if (item.itemType === 'iap') {
            await processIAP(item, appStoreHelper, now, sendEvent, results)
          } else {
            await processSubscription(item, appStoreHelper, basePath, now, sendEvent, results)
          }
        } catch (error) {
          results.errors.push({ id: item.id, error: error instanceof Error ? error.message : 'Unknown error' })
          await sendEvent({ type: 'item_complete', itemId: item.id, result: 'error', error: error instanceof Error ? error.message : 'Unknown error' })
        }
      }

      // Send complete event
      await sendEvent({
        type: 'complete',
        created: results.created,
        updated: results.updated,
        errors: results.errors,
      })
    } catch (error) {
      await sendEvent({
        type: 'complete',
        created: [],
        updated: [],
        errors: [{ id: 'global', error: error instanceof Error ? error.message : 'Unknown error' }],
      })
    } finally {
      if (!streamClosed) {
        try { await writer.close() } catch { /* already closed */ }
      }
    }
  }

  // Process IAP
  async function processIAP(
    item: { id: string; name: string; docRef: FirebaseFirestore.DocumentReference; data: InAppPurchase },
    appStoreHelper: AppStoreHelper,
    now: FirebaseFirestore.Timestamp,
    sendEvent: (event: ProgressEvent) => Promise<void>,
    results: { created: string[]; updated: string[]; errors: { id: string; error: string }[] }
  ) {
    const iap = item.data

    // Check if push is allowed
    const pushStatus = canPushInState(iap.state)
    if (!pushStatus.allowed) {
      results.errors.push({ id: item.id, error: pushStatus.warning || `Cannot push in state: ${iap.state}` })
      await sendEvent({ type: 'item_complete', itemId: item.id, result: 'error', error: pushStatus.warning })
      return
    }

    await sendEvent({ type: 'item_start', itemId: item.id, itemName: item.name, step: 'Validating...' })

    // Get localizations
    const locSnapshot = await item.docRef.collection('localizations').get()
    const localizations = locSnapshot.docs.map(doc => doc.data() as IAPLocalization)

    // Get configs
    const pricingDoc = await item.docRef.collection('config').doc('pricing').get()
    const pricingConfig = pricingDoc.exists ? pricingDoc.data() as PricingConfig : null
    const screenshotDoc = await item.docRef.collection('config').doc('reviewScreenshot').get()
    const screenshotConfig = screenshotDoc.exists ? screenshotDoc.data() as ScreenshotConfig : null
    const promotionalImageDoc = await item.docRef.collection('config').doc('promotionalImage').get()
    const promotionalImageConfig = promotionalImageDoc.exists ? promotionalImageDoc.data() as ScreenshotConfig : null

    // Validate required fields
    const validLocalizations = localizations.filter(loc => loc.displayName && loc.description)
    if (validLocalizations.length === 0) {
      results.errors.push({ id: item.id, error: 'Missing localizations' })
      await sendEvent({ type: 'item_complete', itemId: item.id, result: 'error', error: 'Missing localizations' })
      return
    }
    if (!pricingConfig?.basePricePointId) {
      results.errors.push({ id: item.id, error: 'Missing pricing' })
      await sendEvent({ type: 'item_complete', itemId: item.id, result: 'error', error: 'Missing pricing' })
      return
    }

    const isNew = !iap.appStoreId
    let appStoreId = iap.appStoreId

    if (isNew) {
      await sendEvent({ type: 'item_progress', itemId: item.id, step: 'Creating in App Store Connect...' })
      const created = await appStoreHelper.createInAppPurchase({
        productId: iap.productId,
        name: iap.name,
        productType: iap.productType as IAPProductTypeAPI,
        familyShareable: iap.familyShareable,
        reviewNote: iap.reviewNote || undefined,
      })
      appStoreId = created.id
    }

    // Push localizations
    await sendEvent({ type: 'item_progress', itemId: item.id, step: `Pushing ${localizations.length} localizations...` })
    for (const loc of localizations) {
      await appStoreHelper.upsertIAPLocalization(appStoreId!, loc.locale, {
        displayName: loc.displayName,
        description: loc.description,
      })
    }

    // Push pricing (strategy-aware)
    await sendEvent({ type: 'item_progress', itemId: item.id, step: 'Setting pricing...' })
    let pricingSucceeded = true
    try {
      const { basePricePointId: resolvedBaseId, manualPrices } = await resolveIAPPricingForPush({
        appStoreHelper,
        iapId: appStoreId!,
        basePriceValue: pricingConfig.basePricePointId,
        baseTerritory: pricingConfig.baseTerritory || 'USA',
        strategyId: pricingConfig.pricingStrategyId || pricingConfig.strategy || 'equalized',
      })

      await appStoreHelper.setIAPPriceSchedule(
        appStoreId!,
        resolvedBaseId,
        pricingConfig.baseTerritory || 'USA',
        manualPrices,
      )
    } catch (pricingError) {
      pricingSucceeded = false
      results.errors.push({ id: `${item.id} (pricing)`, error: pricingError instanceof Error ? pricingError.message : 'Pricing failed' })
    }

    // Push screenshot
    if (screenshotConfig?.r2Url) {
      await sendEvent({ type: 'item_progress', itemId: item.id, step: 'Uploading review screenshot...' })
      const imageBuffer = await getImageBuffer(screenshotConfig)
      if (imageBuffer) {
        await appStoreHelper.uploadIAPReviewScreenshot(appStoreId!, { fileName: screenshotConfig.fileName, data: imageBuffer })
      }
    }

    // Push promotional image
    if (promotionalImageConfig?.r2Url) {
      await sendEvent({ type: 'item_progress', itemId: item.id, step: 'Uploading promotional image...' })
      const imageBuffer = await getImageBuffer(promotionalImageConfig)
      if (imageBuffer) {
        await appStoreHelper.uploadIAPImage(appStoreId!, { fileName: promotionalImageConfig.fileName, data: imageBuffer })
      }
    }

    // Re-fetch IAP state from App Store Connect after all operations
    let finalIAPState: string | undefined
    try {
      const refreshed = await appStoreHelper.getInAppPurchase(appStoreId!)
      finalIAPState = refreshed?.state
    } catch {
      // Fall back — state will update on next pull
    }

    // Update Firestore
    await item.docRef.update({
      appStoreId: appStoreId!,
      ...(finalIAPState ? { state: finalIAPState } : {}),
      syncStatus: pricingSucceeded ? 'synced' : 'local_changes',
      updatedAt: now,
    })

    if (isNew) {
      results.created.push(item.id)
    } else {
      results.updated.push(item.id)
    }
    await sendEvent({ type: 'item_complete', itemId: item.id, result: isNew ? 'created' : 'updated' })
  }

  // Process subscription
  async function processSubscription(
    item: { id: string; name: string; docRef: FirebaseFirestore.DocumentReference; data: Subscription & { group: SubscriptionGroup; groupDoc: FirebaseFirestore.QueryDocumentSnapshot } },
    appStoreHelper: AppStoreHelper,
    basePath: FirebaseFirestore.DocumentReference,
    now: FirebaseFirestore.Timestamp,
    sendEvent: (event: ProgressEvent) => Promise<void>,
    results: { created: string[]; updated: string[]; errors: { id: string; error: string }[] }
  ) {
    const sub = item.data
    const group = sub.group
    const groupDoc = sub.groupDoc

    // Check if push is allowed
    const pushStatus = canPushInState(sub.state)
    if (!pushStatus.allowed) {
      results.errors.push({ id: item.id, error: pushStatus.warning || `Cannot push in state: ${sub.state}` })
      await sendEvent({ type: 'item_complete', itemId: item.id, result: 'error', error: pushStatus.warning })
      return
    }

    await sendEvent({ type: 'item_start', itemId: item.id, itemName: item.name, step: 'Validating...' })

    // Get group localizations
    const groupLocSnapshot = await groupDoc.ref.collection('localizations').get()
    const groupLocalizations = groupLocSnapshot.docs.map(doc => {
      const data = doc.data() as { name?: string; displayName?: string; customAppName?: string }
      return { locale: doc.id, displayName: data.name || data.displayName || '', customAppName: data.customAppName }
    }).filter(loc => loc.displayName)

    if (groupLocalizations.length === 0) {
      results.errors.push({ id: item.id, error: `Group "${group.referenceName}" missing localizations` })
      await sendEvent({ type: 'item_complete', itemId: item.id, result: 'error', error: `Group "${group.referenceName}" missing localizations` })
      return
    }

    // Get subscription localizations
    const locSnapshot = await item.docRef.collection('localizations').get()
    const localizations = locSnapshot.docs.map(doc => doc.data() as IAPLocalization)
    const validLocalizations = localizations.filter(loc => loc.displayName && loc.description)
    if (validLocalizations.length === 0) {
      results.errors.push({ id: item.id, error: 'Missing localizations' })
      await sendEvent({ type: 'item_complete', itemId: item.id, result: 'error', error: 'Missing localizations' })
      return
    }

    // Get configs
    const pricingDoc = await item.docRef.collection('config').doc('pricing').get()
    const pricingConfig = pricingDoc.exists ? pricingDoc.data() as PricingConfig : null
    const screenshotDoc = await item.docRef.collection('config').doc('reviewScreenshot').get()
    const screenshotConfig = screenshotDoc.exists ? screenshotDoc.data() as ScreenshotConfig : null
    const promotionalImageDoc = await item.docRef.collection('config').doc('promotionalImage').get()
    const promotionalImageConfig = promotionalImageDoc.exists ? promotionalImageDoc.data() as ScreenshotConfig : null
    const introOfferDoc = await item.docRef.collection('config').doc('introOffer').get()
    const introOfferConfig = introOfferDoc.exists ? introOfferDoc.data() as IntroOfferConfig : null

    if (!pricingConfig?.basePricePointId) {
      results.errors.push({ id: item.id, error: 'Missing pricing' })
      await sendEvent({ type: 'item_complete', itemId: item.id, result: 'error', error: 'Missing pricing' })
      return
    }

    // Ensure group exists — re-read from Firestore in case another subscription already created it
    const freshGroupDoc = await groupDoc.ref.get()
    let groupAppStoreId = freshGroupDoc.data()?.appStoreId || group.appStoreId
    if (!groupAppStoreId) {
      await sendEvent({ type: 'item_progress', itemId: item.id, step: 'Creating subscription group...' })
      try {
        const createdGroup = await appStoreHelper.createSubscriptionGroup(group.referenceName)
        groupAppStoreId = createdGroup.id
      } catch (createError: any) {
        // If group already exists in App Store (duplicate), find it by reference name
        const errMsg = createError?.message || String(createError)
        if (errMsg.includes('INVALID.DUPLICATE') || errMsg.includes('already been used')) {
          await sendEvent({ type: 'item_progress', itemId: item.id, step: 'Finding existing subscription group...' })
          const existingGroups = await appStoreHelper.listSubscriptionGroups()
          const match = existingGroups.find(g => g.referenceName === group.referenceName)
          if (match) {
            groupAppStoreId = match.id
          } else {
            throw new Error(`Subscription group "${group.referenceName}" exists in App Store but could not be found by name`)
          }
        } else {
          throw createError
        }
      }
      await groupDoc.ref.update({ appStoreId: groupAppStoreId, syncStatus: 'synced', updatedAt: now })
    }

    // Push group localizations
    await sendEvent({ type: 'item_progress', itemId: item.id, step: `Pushing ${groupLocalizations.length} group localizations...` })
    for (const groupLoc of groupLocalizations) {
      await appStoreHelper.setSubscriptionGroupLocalization(groupAppStoreId, groupLoc.locale, {
        name: groupLoc.displayName,
        customAppName: groupLoc.customAppName || null,
      })
    }

    const isNew = !sub.appStoreId
    let appStoreId = sub.appStoreId

    if (isNew) {
      await sendEvent({ type: 'item_progress', itemId: item.id, step: 'Creating subscription in App Store Connect...' })
      try {
        const created = await appStoreHelper.createSubscription({
          productId: sub.productId,
          name: sub.name,
          groupId: groupAppStoreId,
          groupLevel: sub.groupLevel,
          subscriptionPeriod: sub.subscriptionPeriod,
          familyShareable: sub.familyShareable,
        })
        appStoreId = created.id
      } catch (createError: any) {
        const errMsg = createError?.message || String(createError)
        if (errMsg.includes('INVALID.DUPLICATE') || errMsg.includes('already been used')) {
          await sendEvent({ type: 'item_progress', itemId: item.id, step: 'Finding existing subscription...' })
          const existingSubs = await appStoreHelper.listSubscriptions(groupAppStoreId)
          const match = existingSubs.find((s: any) => s.productId === sub.productId)
          if (match) {
            appStoreId = match.id
          } else {
            throw new Error(`Subscription "${sub.productId}" already exists in App Store but could not be found in group`)
          }
        } else {
          throw createError
        }
      }
    }

    // Push localizations
    await sendEvent({ type: 'item_progress', itemId: item.id, step: `Pushing ${localizations.length} localizations...` })
    for (const loc of localizations) {
      await appStoreHelper.upsertSubscriptionLocalization(appStoreId!, loc.locale, {
        displayName: loc.displayName,
        description: loc.description,
      })
    }

    // Push pricing with progress
    await sendEvent({ type: 'item_progress', itemId: item.id, step: 'Setting pricing...' })
    let pricingSucceeded = true
    try {
      await pushSubscriptionPricingWithProgress(appStoreHelper, appStoreId!, pricingConfig, item.id, sendEvent)
    } catch (pricingError) {
      pricingSucceeded = false
      results.errors.push({ id: `${item.id} (pricing)`, error: pricingError instanceof Error ? pricingError.message : 'Pricing failed' })
    }

    // Push screenshot
    if (screenshotConfig?.r2Url) {
      await sendEvent({ type: 'item_progress', itemId: item.id, step: 'Uploading review screenshot...' })
      const imageBuffer = await getImageBuffer(screenshotConfig)
      if (imageBuffer) {
        await appStoreHelper.uploadSubscriptionReviewScreenshot(appStoreId!, { fileName: screenshotConfig.fileName, data: imageBuffer })
      }
    }

    // Push promotional image
    if (promotionalImageConfig?.r2Url) {
      await sendEvent({ type: 'item_progress', itemId: item.id, step: 'Uploading promotional image...' })
      const imageBuffer = await getImageBuffer(promotionalImageConfig)
      if (imageBuffer) {
        await appStoreHelper.uploadSubscriptionImage(appStoreId!, { fileName: promotionalImageConfig.fileName, data: imageBuffer })
      }
    }

    // Push intro offer with progress
    if (introOfferConfig) {
      await pushIntroOfferWithProgress(appStoreHelper, appStoreId!, introOfferConfig, pricingConfig, item.id, sendEvent, results)
    }

    // Re-fetch subscription state from App Store Connect after all operations
    let finalState: string | undefined
    try {
      const refreshed = await appStoreHelper.getSubscription(appStoreId!)
      finalState = refreshed.state
    } catch {
      // Fall back — state will update on next pull
    }

    // Update Firestore
    await item.docRef.update({
      appStoreId: appStoreId!,
      ...(finalState ? { state: finalState } : {}),
      syncStatus: pricingSucceeded ? 'synced' : 'local_changes',
      updatedAt: now,
    })

    if (isNew) {
      results.created.push(item.id)
    } else {
      results.updated.push(item.id)
    }
    await sendEvent({ type: 'item_complete', itemId: item.id, result: isNew ? 'created' : 'updated' })
  }

  // Push subscription pricing with progress (strategy-aware)
  async function pushSubscriptionPricingWithProgress(
    appStoreHelper: AppStoreHelper,
    appStoreId: string,
    pricingConfig: PricingConfig,
    itemId: string,
    sendEvent: (event: ProgressEvent) => Promise<void>
  ) {
    const territory = pricingConfig.baseTerritory || 'USA'
    const strategyId = pricingConfig.pricingStrategyId || pricingConfig.strategy || 'equalized'

    // Check existing prices
    const existingPrices = await appStoreHelper.getSubscriptionPrices(appStoreId, territory)
    const isNewSubscription = existingPrices.length === 0

    // Resolve pricing using the shared strategy-aware resolver
    await sendEvent({ type: 'item_progress', itemId, step: `Resolving pricing (${strategyId})...` })
    const { basePricePointId, territoryPrices } = await resolveSubscriptionPricingForPush({
      appStoreHelper,
      subscriptionId: appStoreId,
      basePriceValue: pricingConfig.basePricePointId,
      baseTerritory: territory,
      strategyId,
    })

    // Set availability if new
    if (isNewSubscription) {
      await sendEvent({ type: 'item_progress', itemId, step: 'Setting subscription availability...' })
      await appStoreHelper.setSubscriptionAvailability(appStoreId, true)
    }

    // Set base territory price
    await sendEvent({ type: 'item_progress', itemId, step: `Setting ${territory} price...` })
    await appStoreHelper.setSubscriptionPrices(appStoreId, basePricePointId, territory, false, isNewSubscription)

    // Set prices for other territories (strategy-aware)
    if (territoryPrices.length > 0 && isNewSubscription) {
      const otherTerritories = territoryPrices.filter(tp => tp.territory !== territory)
      for (let i = 0; i < otherTerritories.length; i++) {
        const tp = otherTerritories[i]
        if (i % 10 === 0) {
          await sendEvent({
            type: 'item_progress',
            itemId,
            step: 'Setting territory prices...',
            progress: { current: i + 1, total: otherTerritories.length },
          })
        }
        await appStoreHelper.setSubscriptionPrices(appStoreId, tp.pricePointId, tp.territory, false, isNewSubscription)
      }
      await sendEvent({
        type: 'item_progress',
        itemId,
        step: `Set prices for ${otherTerritories.length + 1} territories`,
      })
    }
  }

  // Push intro offer with progress
  async function pushIntroOfferWithProgress(
    appStoreHelper: AppStoreHelper,
    appStoreId: string,
    introOfferConfig: IntroOfferConfig,
    pricingConfig: PricingConfig | null,
    itemId: string,
    sendEvent: (event: ProgressEvent) => Promise<void>,
    results: { errors: { id: string; error: string }[] }
  ) {
    await sendEvent({ type: 'item_progress', itemId, step: 'Configuring intro offer...' })

    // Delete existing intro offers
    const existingOffers = await appStoreHelper.listIntroductoryOffers(appStoreId)
    for (const offer of existingOffers) {
      await appStoreHelper.deleteIntroductoryOffer(offer.id)
    }

    const baseTerritory = pricingConfig?.baseTerritory || 'USA'
    const usaPricePoints = await appStoreHelper.getSubscriptionPricePoints(appStoreId, baseTerritory)
    if (usaPricePoints.length === 0) {
      results.errors.push({ id: `${itemId} (intro offer)`, error: 'No price points for intro offer' })
      return
    }

    // Find base price point
    let basePricePointId: string
    if (introOfferConfig.offerMode === 'FREE_TRIAL') {
      // FREE_TRIAL doesn't need a $0 price point — Apple charges nothing during the trial.
      // Use the subscription's actual price for the territory.
      if (pricingConfig?.basePricePointId) {
        const basePrice = parseFloat(pricingConfig.basePricePointId)
        if (!isNaN(basePrice)) {
          const match = usaPricePoints.find(pp => Math.abs(parseFloat(pp.customerPrice) - basePrice) < 0.01)
          basePricePointId = match?.id || usaPricePoints[0].id
        } else {
          basePricePointId = usaPricePoints[0].id
        }
      } else {
        basePricePointId = usaPricePoints[0].id
      }
    } else if (introOfferConfig.subscriptionPricePointId) {
      basePricePointId = introOfferConfig.subscriptionPricePointId
    } else if (pricingConfig?.basePricePointId) {
      const basePrice = parseFloat(pricingConfig.basePricePointId)
      if (!isNaN(basePrice)) {
        const matchingPoint = usaPricePoints.find(pp => Math.abs(parseFloat(pp.customerPrice) - basePrice) < 0.01)
        basePricePointId = matchingPoint?.id || usaPricePoints[0].id
      } else {
        basePricePointId = usaPricePoints[0].id
      }
    } else {
      basePricePointId = usaPricePoints[0].id
    }

    // Create base territory intro offer
    await sendEvent({ type: 'item_progress', itemId, step: `Creating ${baseTerritory} intro offer...` })
    try {
      await appStoreHelper.createIntroductoryOffer(appStoreId, {
        offerMode: introOfferConfig.offerMode,
        duration: introOfferConfig.duration as any,
        numberOfPeriods: introOfferConfig.numberOfPeriods,
        pricePointId: basePricePointId,
        territoryId: baseTerritory,
        startDate: introOfferConfig.startDate,
        endDate: introOfferConfig.endDate || undefined,
      })
    } catch (offerError: any) {
      const errMsg = offerError?.message || String(offerError)
      if (errMsg.includes('STATE_ERROR') && errMsg.includes('overlaps')) {
        console.log(`[Push] Intro offer already exists for ${baseTerritory}, skipping`)
      } else {
        throw offerError
      }
    }

    // Get equalizations for all territories
    let equalizations: Array<{ pricePointId: string; territory: string; customerPrice: string }> = []
    try {
      equalizations = await appStoreHelper.getSubscriptionPriceEqualizations(appStoreId, basePricePointId)
    } catch {
      // Continue with base territory only
    }

    // Create intro offers for all territories in parallel batches
    const territories = equalizations.filter(eq => eq.territory !== baseTerritory && eq.territory !== 'unknown')
    let successCount = 1
    const BATCH_SIZE = 5

    for (let i = 0; i < territories.length; i += BATCH_SIZE) {
      const batch = territories.slice(i, i + BATCH_SIZE)

      await Promise.all(batch.map(async (eq) => {
        try {
          // Equalization of $0 gives $0 price points for all territories (FREE_TRIAL).
          // For paid intro offers, equalization gives territory-specific prices.
          // No per-territory getSubscriptionPricePoints calls needed.
          await appStoreHelper.createIntroductoryOffer(appStoreId, {
            offerMode: introOfferConfig.offerMode,
            duration: introOfferConfig.duration as any,
            numberOfPeriods: introOfferConfig.numberOfPeriods,
            pricePointId: eq.pricePointId,
            territoryId: eq.territory,
            startDate: introOfferConfig.startDate,
            endDate: introOfferConfig.endDate || undefined,
          })
          successCount++
        } catch (territoryOfferError: any) {
          const terrErrMsg = territoryOfferError?.message || String(territoryOfferError)
          if (terrErrMsg.includes('STATE_ERROR') && terrErrMsg.includes('overlaps')) {
            successCount++
          }
        }
      }))

      // Update progress after each batch
      await sendEvent({
        type: 'item_progress',
        itemId,
        step: 'Creating intro offers...',
        progress: { current: Math.min(i + BATCH_SIZE, territories.length), total: territories.length },
      })
    }

    await sendEvent({ type: 'item_progress', itemId, step: `Created intro offers for ${successCount} territories` })
  }

  // Start processing
  processAsync()

  // Return SSE response
  return new Response(stream.readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  })
}
