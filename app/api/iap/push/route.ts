import { NextRequest } from 'next/server'
import { z } from 'zod'
import { authenticateRequest, errorResponse, unauthorizedResponse } from '@/lib/api/auth'
import { getProjectContext, hasContextPermission, getAccountContext, AccountContext } from '@/lib/org/context'
import { getSession } from '@/lib/auth/session'
import { adminDb } from '@/lib/firebase/admin'
import { Timestamp } from 'firebase-admin/firestore'
import { getAppStoreHelper } from '@/lib/services/credentials'
import type { InAppPurchase, IAPLocalization, SubscriptionGroup, Subscription, IAPState } from '@/lib/firebase/firestore'
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

// Helper to push pricing for an IAP (strategy-aware)
async function pushIAPPricing(
  appStoreHelper: AppStoreHelper,
  appStoreId: string,
  pricingConfig: PricingConfig | null
): Promise<{ success: boolean; error?: string }> {
  if (!pricingConfig || !pricingConfig.basePricePointId) {
    return { success: true } // No pricing config, skip
  }

  try {
    // Resolve pricing using the shared strategy-aware resolver
    // This handles: price value → Apple ID resolution + strategy multipliers per territory
    const { basePricePointId, manualPrices } = await resolveIAPPricingForPush({
      appStoreHelper,
      iapId: appStoreId,
      basePriceValue: pricingConfig.basePricePointId,
      baseTerritory: pricingConfig.baseTerritory || 'USA',
      strategyId: pricingConfig.pricingStrategyId || pricingConfig.strategy || 'equalized',
    })

    const result = await appStoreHelper.setIAPPriceSchedule(
      appStoreId,
      basePricePointId,
      pricingConfig.baseTerritory || 'USA',
      manualPrices,
    )

    return result
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to set pricing',
    }
  }
}

// Local price point mapping (matches PricingTab.tsx)
const LOCAL_PRICE_POINTS: Record<string, number> = {
  p0: 0, p1: 0.99, p2: 1.99, p3: 2.99, p4: 3.99, p5: 4.99,
  p6: 5.99, p7: 6.99, p8: 7.99, p9: 9.99, p10: 11.99,
  p11: 14.99, p12: 19.99, p13: 24.99, p14: 29.99, p15: 39.99,
  p16: 49.99, p17: 59.99, p18: 79.99, p19: 99.99,
}

// Helper to push pricing for a subscription (strategy-aware)
async function pushSubscriptionPricing(
  appStoreHelper: AppStoreHelper,
  appStoreId: string,
  pricingConfig: PricingConfig | null
): Promise<{ success: boolean; error?: string }> {
  if (!pricingConfig || !pricingConfig.basePricePointId) {
    return { success: true } // No pricing config, skip
  }

  try {
    const territory = pricingConfig.baseTerritory || 'USA'
    const strategyId = pricingConfig.pricingStrategyId || pricingConfig.strategy || 'equalized'

    console.log(`[Push] Starting pricing push for subscription ${appStoreId} (strategy: ${strategyId})`)

    // Step 1: Check if subscription already has prices
    const existingPrices = await appStoreHelper.getSubscriptionPrices(appStoreId, territory)
    const isNewSubscription = existingPrices.length === 0

    // Step 2: Resolve pricing using the shared strategy-aware resolver
    const { basePricePointId, territoryPrices } = await resolveSubscriptionPricingForPush({
      appStoreHelper,
      subscriptionId: appStoreId,
      basePriceValue: pricingConfig.basePricePointId,
      baseTerritory: territory,
      strategyId,
    })

    // Check if base price already set
    const currentPrice = existingPrices.find(p => p.startDate === null)
    if (currentPrice && currentPrice.pricePointId === basePricePointId) {
      console.log(`[Push] Price already set to ${basePricePointId}, skipping`)
      return { success: true }
    }

    // Step 3: Set subscription availability (REQUIRED for new subscriptions before prices)
    if (isNewSubscription) {
      console.log(`[Push] Setting subscription availability for new subscription ${appStoreId}`)
      const availabilityResult = await appStoreHelper.setSubscriptionAvailability(appStoreId, true)
      if (!availabilityResult.success) {
        if (!availabilityResult.error?.includes('already exists') && !availabilityResult.error?.includes('ENTITY_ERROR')) {
          return {
            success: false,
            error: `Failed to set subscription availability: ${availabilityResult.error}`,
          }
        }
        console.log(`[Push] Availability may already exist, continuing...`)
      }
    }

    // Step 4: Set prices for all territories (strategy-aware)
    const errors: string[] = []
    let successCount = 0

    // Set base territory price first
    console.log(`[Push] Setting base territory price: ${territory}`)
    const baseResult = await appStoreHelper.setSubscriptionPrices(
      appStoreId, basePricePointId, territory, false, isNewSubscription
    )

    if (baseResult.success) {
      successCount++
    } else {
      errors.push(`${territory}: ${baseResult.error}`)
    }

    // Set prices for other territories using strategy-resolved prices
    if (territoryPrices.length > 0 && isNewSubscription) {
      console.log(`[Push] Setting prices for ${territoryPrices.length} additional territories...`)

      for (const tp of territoryPrices) {
        if (tp.territory === territory) continue

        try {
          const result = await appStoreHelper.setSubscriptionPrices(
            appStoreId, tp.pricePointId, tp.territory, false, isNewSubscription
          )

          if (result.success) {
            successCount++
          } else {
            errors.push(`${tp.territory}: ${result.error}`)
          }
        } catch (error) {
          errors.push(`${tp.territory}: ${error instanceof Error ? error.message : 'Unknown error'}`)
        }

        if (successCount % 20 === 0) {
          console.log(`[Push] Progress: ${successCount} territories set successfully`)
        }
      }
    }

    console.log(`[Push] Pricing complete: ${successCount} territories successful, ${errors.length} errors`)

    if (errors.length > 0 && successCount === 0) {
      return {
        success: false,
        error: `Failed to set any prices. First error: ${errors[0]}`,
      }
    }

    return { success: true }
  } catch (error) {
    console.error(`[Push] Exception in pushSubscriptionPricing:`, error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to set subscription pricing',
    }
  }
}

// Screenshot config stored in Firestore
interface ScreenshotConfig {
  fileName: string
  mimeType: string
  r2Key?: string     // R2 storage key
  r2Url?: string     // R2 public URL
  fileSize: number
}

// Helper to get image buffer from screenshot config (fetches from R2)
async function getImageBuffer(config: ScreenshotConfig): Promise<Buffer | null> {
  if (!config.r2Url) {
    return null
  }

  try {
    const response = await fetch(config.r2Url)
    if (response.ok) {
      return Buffer.from(await response.arrayBuffer())
    }
    console.warn('Failed to fetch from R2:', response.statusText)
    return null
  } catch (error) {
    console.warn('Failed to fetch from R2:', error)
    return null
  }
}

// Helper to push review screenshot for an IAP
async function pushIAPScreenshot(
  appStoreHelper: AppStoreHelper,
  appStoreId: string,
  screenshotConfig: ScreenshotConfig | null
): Promise<{ success: boolean; error?: string }> {
  if (!screenshotConfig || !screenshotConfig.r2Url) {
    return { success: true } // No screenshot config, skip
  }

  try {
    const imageBuffer = await getImageBuffer(screenshotConfig)
    if (!imageBuffer) {
      return { success: false, error: 'Failed to retrieve image data' }
    }

    const result = await appStoreHelper.uploadIAPReviewScreenshot(appStoreId, {
      fileName: screenshotConfig.fileName,
      data: imageBuffer,
    })

    return result
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to upload screenshot',
    }
  }
}

// Helper to push review screenshot for a subscription
async function pushSubscriptionScreenshot(
  appStoreHelper: AppStoreHelper,
  appStoreId: string,
  screenshotConfig: ScreenshotConfig | null
): Promise<{ success: boolean; error?: string }> {
  if (!screenshotConfig || !screenshotConfig.r2Url) {
    return { success: true } // No screenshot config, skip
  }

  try {
    const imageBuffer = await getImageBuffer(screenshotConfig)
    if (!imageBuffer) {
      return { success: false, error: 'Failed to retrieve image data' }
    }

    const result = await appStoreHelper.uploadSubscriptionReviewScreenshot(appStoreId, {
      fileName: screenshotConfig.fileName,
      data: imageBuffer,
    })

    return result
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to upload subscription screenshot',
    }
  }
}

// Helper to push promotional image for a subscription (1024x1024)
async function pushSubscriptionPromotionalImage(
  appStoreHelper: AppStoreHelper,
  appStoreId: string,
  imageConfig: ScreenshotConfig | null
): Promise<{ success: boolean; error?: string }> {
  if (!imageConfig || !imageConfig.r2Url) {
    return { success: true } // No image config, skip
  }

  try {
    const imageBuffer = await getImageBuffer(imageConfig)
    if (!imageBuffer) {
      return { success: false, error: 'Failed to retrieve image data' }
    }

    const result = await appStoreHelper.uploadSubscriptionImage(appStoreId, {
      fileName: imageConfig.fileName,
      data: imageBuffer,
    })

    return result
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to upload subscription promotional image',
    }
  }
}

// Helper to push promotional image for an IAP
async function pushIAPPromotionalImage(
  appStoreHelper: AppStoreHelper,
  appStoreId: string,
  imageConfig: ScreenshotConfig | null
): Promise<{ success: boolean; error?: string }> {
  if (!imageConfig || !imageConfig.r2Url) {
    return { success: true } // No image config, skip
  }

  try {
    const imageBuffer = await getImageBuffer(imageConfig)
    if (!imageBuffer) {
      return { success: false, error: 'Failed to retrieve image data' }
    }

    const result = await appStoreHelper.uploadIAPImage(appStoreId, {
      fileName: imageConfig.fileName,
      data: imageBuffer,
    })

    return result
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to upload IAP promotional image',
    }
  }
}

// Helper to push intro offer for a subscription
async function pushSubscriptionIntroOffer(
  appStoreHelper: AppStoreHelper,
  appStoreId: string,
  introOfferConfig: IntroOfferConfig | null,
  pricingConfig: PricingConfig | null
): Promise<{ success: boolean; error?: string }> {
  if (!introOfferConfig) {
    return { success: true } // No intro offer config, skip
  }

  try {
    // First, delete any existing intro offers for this subscription
    const existingOffers = await appStoreHelper.listIntroductoryOffers(appStoreId)
    for (const offer of existingOffers) {
      try {
        await appStoreHelper.deleteIntroductoryOffer(offer.id)
        console.log(`[Push] Deleted existing intro offer ${offer.id}`)
      } catch (deleteError) {
        console.warn(`[Push] Warning: Failed to delete existing intro offer:`, deleteError)
      }
    }

    // Get the base territory and price point
    const baseTerritory = pricingConfig?.baseTerritory || 'USA'

    // Get base price point for USA first
    const usaPricePoints = await appStoreHelper.getSubscriptionPricePoints(appStoreId, baseTerritory)
    if (usaPricePoints.length === 0) {
      return {
        success: false,
        error: 'No price points available for intro offer',
      }
    }

    // Find the appropriate base price point
    let basePricePointId: string
    if (introOfferConfig.offerMode === 'FREE_TRIAL') {
      // FREE_TRIAL doesn't need a $0 price point — Apple charges nothing during the trial
      // regardless of the price point. Use the subscription's actual price for the territory.
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
      // Resolve price value to actual price point ID
      const basePrice = parseFloat(pricingConfig.basePricePointId)
      if (!isNaN(basePrice)) {
        const matchingPoint = usaPricePoints.find(pp =>
          Math.abs(parseFloat(pp.customerPrice) - basePrice) < 0.01
        )
        basePricePointId = matchingPoint?.id || usaPricePoints[0].id
      } else {
        basePricePointId = usaPricePoints[0].id
      }
    } else {
      basePricePointId = usaPricePoints[0].id
    }

    // Create intro offer for base territory first
    console.log(`[Push] Creating intro offer for base territory ${baseTerritory}`)
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
      console.log(`[Push] Created intro offer for territory ${baseTerritory}`)
    } catch (baseOfferError: any) {
      const errMsg = baseOfferError?.message || String(baseOfferError)
      if (errMsg.includes('STATE_ERROR') && errMsg.includes('overlaps')) {
        console.log(`[Push] Intro offer already exists for ${baseTerritory}, skipping`)
      } else {
        throw baseOfferError
      }
    }

    // Get price equalizations for all other territories (similar to pricing)
    let equalizations: Array<{ pricePointId: string; territory: string; customerPrice: string }> = []
    try {
      equalizations = await appStoreHelper.getSubscriptionPriceEqualizations(appStoreId, basePricePointId)
      console.log(`[Push] Got ${equalizations.length} territory equalizations for intro offers`)
    } catch (eqError) {
      console.warn(`[Push] Could not get equalizations for intro offers, base territory only: ${eqError}`)
    }

    // Create intro offers for all other territories in parallel batches
    let successCount = 1 // Count base territory
    let errorCount = 0
    const territories = equalizations.filter(eq => eq.territory !== baseTerritory && eq.territory !== 'unknown')

    console.log(`[Push] Creating intro offers for ${territories.length} additional territories...`)

    const BATCH_SIZE = 5
    for (let i = 0; i < territories.length; i += BATCH_SIZE) {
      const batch = territories.slice(i, i + BATCH_SIZE)

      await Promise.all(batch.map(async (eq) => {
        try {
          // For FREE_TRIAL: equalization of $0 gives us $0 price points for all territories.
          // For paid intro offers: equalization gives us territory-specific price points.
          // No need for per-territory getSubscriptionPricePoints calls.
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
        } catch (territoryError: any) {
          const terrErrMsg = territoryError?.message || String(territoryError)
          if (terrErrMsg.includes('STATE_ERROR') && terrErrMsg.includes('overlaps')) {
            successCount++
          } else {
            errorCount++
            console.warn(`[Push] Warning: Failed to create intro offer for ${eq.territory}:`, territoryError)
          }
        }
      }))

      if ((i + BATCH_SIZE) % 25 < BATCH_SIZE) {
        console.log(`[Push] Intro offer progress: ${Math.min(i + BATCH_SIZE, territories.length)}/${territories.length} territories processed`)
      }
    }

    console.log(`[Push] Created intro offers for ${successCount} territories (${errorCount} failed)`)
    return { success: true }
  } catch (error) {
    console.error(`[Push] Error pushing intro offer:`, error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create intro offer',
    }
  }
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

export async function POST(request: NextRequest) {
  const { context: authContext, error: authError } = await getAuthContext(request)
  if (!authContext) {
    return unauthorizedResponse(authError)
  }

  let body
  try {
    body = pushSchema.parse(await request.json())
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(`Validation error: ${error.errors.map(e => e.message).join(', ')}`)
    }
    return errorResponse('Invalid request body')
  }

  const { projectId, iapIds, subscriptionIds, pushAll } = body

  const projectContext = await getProjectContext(authContext.userId, projectId)
  if (!projectContext) {
    return errorResponse('Project not found', 404)
  }

  if (!hasContextPermission(projectContext, 'canCreateProjects')) {
    return errorResponse('Permission denied', 403)
  }

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
      skipped: [] as { id: string; productId?: string; reason: string }[],
      debug: [] as string[],
    }

    // Get IAPs to push
    let iapsToProcess: FirebaseFirestore.QueryDocumentSnapshot[] = []
    if (pushAll) {
      const allIaps = await basePath.collection('inAppPurchases')
        .where('syncStatus', 'in', ['pending_creation', 'local_changes'])
        .get()
      iapsToProcess = allIaps.docs
    } else if (iapIds && iapIds.length > 0) {
      const iapDocs = await Promise.all(
        iapIds.map(id => basePath.collection('inAppPurchases').doc(id).get())
      )
      for (let i = 0; i < iapIds.length; i++) {
        if (!iapDocs[i].exists) {
          results.skipped.push({ id: iapIds[i], reason: 'IAP not found in project' })
        }
      }
      iapsToProcess = iapDocs.filter(doc => doc.exists) as FirebaseFirestore.QueryDocumentSnapshot[]
    }

    // Process IAPs (non-subscription types only)
    // AUTO_RENEWABLE_SUBSCRIPTION uses the subscriptions API, not the IAP API
    for (const iapDoc of iapsToProcess) {
      const iap = iapDoc.data() as InAppPurchase

      // Skip subscription types - they use a different API
      if (iap.productType === 'AUTO_RENEWABLE_SUBSCRIPTION') {
        results.skipped.push({
          id: iapDoc.id,
          productId: iap.productId,
          reason: 'Auto-renewable subscriptions must be pushed using subscriptionIds, not iapIds.',
        })
        continue
      }

      // Check if push is allowed for current state
      const pushStatus = canPushInState(iap.state)
      if (!pushStatus.allowed) {
        results.errors.push({
          id: iap.productId,
          error: pushStatus.warning || `Cannot push in state: ${iap.state}`,
        })
        continue
      }

      try {
        // Get localizations
        const locSnapshot = await iapDoc.ref.collection('localizations').get()
        const localizations = locSnapshot.docs.map(doc => doc.data() as IAPLocalization)

        // Get pricing config if exists
        const pricingDoc = await iapDoc.ref.collection('config').doc('pricing').get()
        const pricingConfig = pricingDoc.exists ? pricingDoc.data() as PricingConfig : null

        // Get screenshot config if exists
        const screenshotDoc = await iapDoc.ref.collection('config').doc('reviewScreenshot').get()
        const screenshotConfig = screenshotDoc.exists ? screenshotDoc.data() as ScreenshotConfig : null

        // Get promotional image config if exists
        const promotionalImageDoc = await iapDoc.ref.collection('config').doc('promotionalImage').get()
        const promotionalImageConfig = promotionalImageDoc.exists ? promotionalImageDoc.data() as ScreenshotConfig : null

        // Validate required fields for submission (except review screenshot)
        const missingFields: string[] = []

        // Check basic fields
        if (!iap.productId) missingFields.push('Product ID')
        if (!iap.name) missingFields.push('Reference Name')

        // Check localizations - need at least one with display name and description
        const validLocalizations = localizations.filter(loc => loc.displayName && loc.description)
        if (validLocalizations.length === 0) {
          missingFields.push('Localizations (need at least one with Display Name and Description)')
        }

        // Check pricing - required for submission
        if (!pricingConfig || !pricingConfig.basePricePointId) {
          missingFields.push('Pricing')
        }

        if (missingFields.length > 0) {
          results.errors.push({
            id: iap.productId || 'unknown',
            error: `Missing required fields: ${missingFields.join(', ')}`,
          })
          continue
        }

        if (!iap.appStoreId) {
          // Create new IAP in App Store (handles both pending_creation and local_changes without appStoreId)
          const created = await appStoreHelper.createInAppPurchase({
            productId: iap.productId,
            name: iap.name,
            productType: iap.productType as IAPProductTypeAPI,
            familyShareable: iap.familyShareable,
            reviewNote: iap.reviewNote || undefined,
          })

          // Push localizations
          for (const loc of localizations) {
            await appStoreHelper.upsertIAPLocalization(created.id, loc.locale, {
              displayName: loc.displayName,
              description: loc.description,
            })
          }

          // Push pricing
          let pricingSucceeded = true
          const pricingResult = await pushIAPPricing(appStoreHelper, created.id, pricingConfig)
          if (!pricingResult.success) {
            pricingSucceeded = false
            console.warn(`[Push] Warning: Failed to set pricing for ${iap.productId}: ${pricingResult.error}`)
            results.errors.push({
              id: `${iap.productId} (pricing)`,
              error: pricingResult.error || 'Failed to set pricing',
            })
          }

          // Push review screenshot
          const screenshotResult = await pushIAPScreenshot(appStoreHelper, created.id, screenshotConfig)
          if (!screenshotResult.success) {
            console.warn(`[Push] Warning: Failed to upload screenshot for ${iap.productId}: ${screenshotResult.error}`)
          }

          // Push promotional image
          const promoImageResult = await pushIAPPromotionalImage(appStoreHelper, created.id, promotionalImageConfig)
          if (!promoImageResult.success) {
            console.warn(`[Push] Warning: Failed to upload promotional image for ${iap.productId}: ${promoImageResult.error}`)
          }

          // Re-fetch IAP state from App Store Connect after all operations
          let finalIAPState = created.state
          try {
            const refreshed = await appStoreHelper.getInAppPurchase(created.id)
            if (refreshed) finalIAPState = refreshed.state
          } catch {
            // Fall back to created state
          }

          // Update local record - only mark synced if pricing succeeded
          await iapDoc.ref.update({
            appStoreId: created.id,
            state: finalIAPState,
            syncStatus: pricingSucceeded ? 'synced' : 'local_changes',
            updatedAt: now,
          })

          results.created.push(iap.productId)
        } else if (iap.appStoreId) {
          // Update existing IAP
          // Check field-level edit permissions based on state
          const canEditReferenceName = canEditField(iap.state, 'referenceName')
          const canEditLocalizations = canEditField(iap.state, 'localizations')
          const canEditPricing = canEditField(iap.state, 'pricing')
          const canEditScreenshot = canEditField(iap.state, 'reviewScreenshot')
          const canEditPromoImage = canEditField(iap.state, 'promotionalImage')
          const canEditFamilySharing = canEditField(iap.state, 'familySharing')

          // Track if pricing succeeded
          let pricingSucceeded = true

          // Update reference name and family sharing if allowed
          if (canEditReferenceName || canEditFamilySharing) {
            await appStoreHelper.updateInAppPurchase(iap.appStoreId, {
              name: canEditReferenceName ? iap.name : undefined,
              familyShareable: canEditFamilySharing ? iap.familyShareable : undefined,
              reviewNote: iap.reviewNote || undefined,
            })
          }

          // Push localizations (if allowed)
          if (canEditLocalizations) {
            for (const loc of localizations) {
              await appStoreHelper.upsertIAPLocalization(iap.appStoreId, loc.locale, {
                displayName: loc.displayName,
                description: loc.description,
              })
            }
          } else if (localizations.length > 0) {
            console.warn(`[Push] Skipping localizations for ${iap.productId}: Not editable in state ${iap.state}`)
          }

          // Push pricing (always allowed in most states)
          if (canEditPricing) {
            const pricingResult = await pushIAPPricing(appStoreHelper, iap.appStoreId, pricingConfig)
            if (!pricingResult.success) {
              pricingSucceeded = false
              console.warn(`[Push] Warning: Failed to set pricing for ${iap.productId}: ${pricingResult.error}`)
              results.errors.push({
                id: `${iap.productId} (pricing)`,
                error: pricingResult.error || 'Failed to set pricing',
              })
            }
          }

          // Push review screenshot (if allowed)
          if (canEditScreenshot) {
            const screenshotResult = await pushIAPScreenshot(appStoreHelper, iap.appStoreId, screenshotConfig)
            if (!screenshotResult.success) {
              console.warn(`[Push] Warning: Failed to upload screenshot for ${iap.productId}: ${screenshotResult.error}`)
            }
          } else if (screenshotConfig) {
            console.warn(`[Push] Skipping screenshot for ${iap.productId}: Not editable in state ${iap.state}`)
          }

          // Push promotional image (if allowed)
          if (canEditPromoImage) {
            const promoImageResult = await pushIAPPromotionalImage(appStoreHelper, iap.appStoreId, promotionalImageConfig)
            if (!promoImageResult.success) {
              console.warn(`[Push] Warning: Failed to upload promotional image for ${iap.productId}: ${promoImageResult.error}`)
            }
          } else if (promotionalImageConfig) {
            console.warn(`[Push] Skipping promotional image for ${iap.productId}: Not editable in state ${iap.state}`)
          }

          // Re-fetch IAP state from App Store Connect
          let updatedIAPState: string | undefined
          try {
            const refreshed = await appStoreHelper.getInAppPurchase(iap.appStoreId)
            updatedIAPState = refreshed?.state
          } catch {
            // Fall back — state will update on next pull
          }

          // Only mark as synced if pricing succeeded, otherwise keep as local_changes
          await iapDoc.ref.update({
            ...(updatedIAPState ? { state: updatedIAPState } : {}),
            syncStatus: pricingSucceeded ? 'synced' : 'local_changes',
            updatedAt: now,
          })

          results.updated.push(iap.productId)
        }
      } catch (error) {
        results.errors.push({
          id: iap.productId,
          error: error instanceof Error ? error.message : 'Unknown error',
        })
      }
    }

    // Process subscriptions if specified
    if (subscriptionIds && subscriptionIds.length > 0) {
      results.debug.push(`Processing subscriptions, IDs requested: ${JSON.stringify(subscriptionIds)}`)

      const groupsSnapshot = await basePath.collection('subscriptionGroups').get()
      results.debug.push(`Found ${groupsSnapshot.docs.length} subscription groups`)

      for (const groupDoc of groupsSnapshot.docs) {
        const group = groupDoc.data() as SubscriptionGroup
        const subsSnapshot = await groupDoc.ref.collection('subscriptions').get()
        results.debug.push(`Group "${group.referenceName}" has ${subsSnapshot.docs.length} subscriptions`)

        // Get group localizations from Firestore
        const groupLocSnapshot = await groupDoc.ref.collection('localizations').get()
        const groupLocalizations = groupLocSnapshot.docs.map(doc => {
          const data = doc.data() as { name?: string; displayName?: string; customAppName?: string }
          return {
            locale: doc.id,
            // Support both 'name' (new format) and 'displayName' (legacy) fields
            displayName: data.name || data.displayName || '',
            customAppName: data.customAppName,
          }
        })
        results.debug.push(`Group "${group.referenceName}" has ${groupLocalizations.length} localizations`)

        for (const subDoc of subsSnapshot.docs) {
          const sub = subDoc.data() as Subscription
          results.debug.push(`Checking: docId=${subDoc.id}, productId=${sub.productId}, syncStatus=${sub.syncStatus}`)
          if (!subscriptionIds.includes(subDoc.id)) {
            results.debug.push(`  -> Skipping - doc ID not in requested list`)
            continue
          }
          results.debug.push(`  -> MATCHED! Processing subscription: ${sub.productId}`)

          // Check if push is allowed for current state
          const subPushStatus = canPushInState(sub.state)
          if (!subPushStatus.allowed) {
            results.errors.push({
              id: sub.productId,
              error: subPushStatus.warning || `Cannot push in state: ${sub.state}`,
            })
            continue
          }

          try {
            // Validate group has localizations (required by App Store)
            const validGroupLocalizations = groupLocalizations.filter(loc => loc.displayName)
            if (validGroupLocalizations.length === 0) {
              results.errors.push({
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

            // Push group localizations (required for subscriptions to work)
            for (const groupLoc of validGroupLocalizations) {
              try {
                await appStoreHelper.setSubscriptionGroupLocalization(groupAppStoreId, groupLoc.locale, {
                  name: groupLoc.displayName,
                  customAppName: groupLoc.customAppName || null,
                })
                results.debug.push(`Pushed group localization: ${groupLoc.locale} -> "${groupLoc.displayName}"`)
              } catch (locError) {
                console.warn(`[Push] Warning: Failed to set group localization for ${groupLoc.locale}:`, locError)
              }
            }

            // Get pricing config
            const pricingDoc = await subDoc.ref.collection('config').doc('pricing').get()
            const pricingConfig = pricingDoc.exists ? pricingDoc.data() as PricingConfig : null

            // Get screenshot config (review screenshot)
            const screenshotDoc = await subDoc.ref.collection('config').doc('reviewScreenshot').get()
            const screenshotConfig = screenshotDoc.exists ? screenshotDoc.data() as ScreenshotConfig : null

            // Get promotional image config (1024x1024 image)
            const promotionalImageDoc = await subDoc.ref.collection('config').doc('promotionalImage').get()
            const promotionalImageConfig = promotionalImageDoc.exists ? promotionalImageDoc.data() as ScreenshotConfig : null

            // Get intro offer config
            const introOfferDoc = await subDoc.ref.collection('config').doc('introOffer').get()
            const introOfferConfig = introOfferDoc.exists ? introOfferDoc.data() as IntroOfferConfig : null

            // Get localizations
            const locSnapshot = await subDoc.ref.collection('localizations').get()
            const localizations = locSnapshot.docs.map(doc => doc.data() as IAPLocalization)

            // Validate required fields for submission (except review screenshot)
            const subMissingFields: string[] = []

            // Check basic fields
            if (!sub.productId) subMissingFields.push('Product ID')
            if (!sub.name) subMissingFields.push('Reference Name')
            if (!sub.subscriptionPeriod) subMissingFields.push('Subscription Period')
            if (!groupAppStoreId) subMissingFields.push('Subscription Group')

            // Check localizations - need at least one with display name and description
            const validSubLocalizations = localizations.filter(loc => loc.displayName && loc.description)
            if (validSubLocalizations.length === 0) {
              subMissingFields.push('Localizations (need at least one with Display Name and Description)')
            }

            // Check pricing - required for submission
            if (!pricingConfig || !pricingConfig.basePricePointId) {
              subMissingFields.push('Pricing')
            }

            if (subMissingFields.length > 0) {
              results.errors.push({
                id: sub.productId || 'unknown',
                error: `Missing required fields: ${subMissingFields.join(', ')}`,
              })
              continue
            }

            if (!sub.appStoreId) {
              // Create subscription (handles both pending_creation and local_changes without appStoreId)
              let createdId: string
              let createdState: string | undefined
              try {
                const created = await appStoreHelper.createSubscription({
                  productId: sub.productId,
                  name: sub.name,
                  groupId: groupAppStoreId,
                  groupLevel: sub.groupLevel,
                  subscriptionPeriod: sub.subscriptionPeriod,
                  familyShareable: sub.familyShareable,
                })
                createdId = created.id
                createdState = created.state
              } catch (createError: any) {
                const errMsg = createError?.message || String(createError)
                if (errMsg.includes('INVALID.DUPLICATE') || errMsg.includes('already been used')) {
                  const existingSubs = await appStoreHelper.listSubscriptions(groupAppStoreId)
                  const match = existingSubs.find((s: any) => s.productId === sub.productId)
                  if (match) {
                    createdId = match.id
                    createdState = match.state
                  } else {
                    throw new Error(`Subscription "${sub.productId}" already exists in App Store but could not be found in group`)
                  }
                } else {
                  throw createError
                }
              }

              // Push localizations
              for (const loc of localizations) {
                await appStoreHelper.upsertSubscriptionLocalization(createdId, loc.locale, {
                  displayName: loc.displayName,
                  description: loc.description,
                })
              }

              // Push pricing
              let pricingSucceeded = true
              const pricingResult = await pushSubscriptionPricing(appStoreHelper, createdId, pricingConfig)
              if (!pricingResult.success) {
                pricingSucceeded = false
                console.warn(`[Push] Warning: Failed to set pricing for ${sub.productId}: ${pricingResult.error}`)
                results.errors.push({
                  id: `${sub.productId} (pricing)`,
                  error: pricingResult.error || 'Failed to set pricing',
                })
              }

              // Push review screenshot
              const screenshotResult = await pushSubscriptionScreenshot(appStoreHelper, createdId, screenshotConfig)
              if (!screenshotResult.success) {
                console.warn(`[Push] Warning: Failed to upload screenshot for ${sub.productId}: ${screenshotResult.error}`)
              }

              // Push promotional image (1024x1024)
              const promoImageResult = await pushSubscriptionPromotionalImage(appStoreHelper, createdId, promotionalImageConfig)
              if (!promoImageResult.success) {
                console.warn(`[Push] Warning: Failed to upload promotional image for ${sub.productId}: ${promoImageResult.error}`)
              }

              // Push intro offer (if configured)
              if (introOfferConfig) {
                const introOfferResult = await pushSubscriptionIntroOffer(appStoreHelper, createdId, introOfferConfig, pricingConfig)
                if (!introOfferResult.success) {
                  console.warn(`[Push] Warning: Failed to create intro offer for ${sub.productId}: ${introOfferResult.error}`)
                  results.errors.push({
                    id: `${sub.productId} (intro offer)`,
                    error: introOfferResult.error || 'Failed to create intro offer',
                  })
                } else {
                  results.debug.push(`Created intro offer for ${sub.productId}`)
                }
              }

              // Re-fetch subscription state from App Store Connect after all operations
              let finalState = createdState || 'MISSING_METADATA'
              try {
                const refreshed = await appStoreHelper.getSubscription(createdId)
                finalState = refreshed.state
              } catch {
                // Fall back to createdState
              }

              // Only mark as synced if pricing succeeded, otherwise keep as local_changes
              await subDoc.ref.update({
                appStoreId: createdId,
                state: finalState,
                syncStatus: pricingSucceeded ? 'synced' : 'local_changes',
                updatedAt: now,
              })

              results.created.push(sub.productId)
            } else if (sub.appStoreId) {
              // Update subscription
              // Check field-level edit permissions based on state
              const canEditSubReferenceName = canEditField(sub.state, 'referenceName')
              const canEditSubLocalizations = canEditField(sub.state, 'localizations')
              const canEditSubPricing = canEditField(sub.state, 'pricing')
              const canEditSubScreenshot = canEditField(sub.state, 'reviewScreenshot')
              const canEditSubPromoImage = canEditField(sub.state, 'promotionalImage')
              const canEditSubFamilySharing = canEditField(sub.state, 'familySharing')

              // Track if pricing succeeded
              let pricingSucceeded = true

              // Update reference name and family sharing if allowed
              if (canEditSubReferenceName || canEditSubFamilySharing) {
                await appStoreHelper.updateSubscription(sub.appStoreId, {
                  name: canEditSubReferenceName ? sub.name : undefined,
                  groupLevel: sub.groupLevel,
                  familyShareable: canEditSubFamilySharing ? sub.familyShareable : undefined,
                })
              }

              // Push localizations (if allowed)
              if (canEditSubLocalizations) {
                for (const loc of localizations) {
                  await appStoreHelper.upsertSubscriptionLocalization(sub.appStoreId, loc.locale, {
                    displayName: loc.displayName,
                    description: loc.description,
                  })
                }
              } else if (localizations.length > 0) {
                console.warn(`[Push] Skipping localizations for ${sub.productId}: Not editable in state ${sub.state}`)
              }

              // Push pricing (if allowed)
              if (canEditSubPricing) {
                const pricingResult = await pushSubscriptionPricing(appStoreHelper, sub.appStoreId, pricingConfig)
                if (!pricingResult.success) {
                  pricingSucceeded = false
                  console.warn(`[Push] Warning: Failed to set pricing for ${sub.productId}: ${pricingResult.error}`)
                  results.errors.push({
                    id: `${sub.productId} (pricing)`,
                    error: pricingResult.error || 'Failed to set pricing',
                  })
                }
              }

              // Push review screenshot (if allowed)
              if (canEditSubScreenshot) {
                const screenshotResult = await pushSubscriptionScreenshot(appStoreHelper, sub.appStoreId, screenshotConfig)
                if (!screenshotResult.success) {
                  console.warn(`[Push] Warning: Failed to upload screenshot for ${sub.productId}: ${screenshotResult.error}`)
                }
              } else if (screenshotConfig) {
                console.warn(`[Push] Skipping screenshot for ${sub.productId}: Not editable in state ${sub.state}`)
              }

              // Push promotional image (1024x1024) if allowed
              if (canEditSubPromoImage) {
                const promoImageResult = await pushSubscriptionPromotionalImage(appStoreHelper, sub.appStoreId, promotionalImageConfig)
                if (!promoImageResult.success) {
                  console.warn(`[Push] Warning: Failed to upload promotional image for ${sub.productId}: ${promoImageResult.error}`)
                }
              } else if (promotionalImageConfig) {
                console.warn(`[Push] Skipping promotional image for ${sub.productId}: Not editable in state ${sub.state}`)
              }

              // Push intro offer (if configured and allowed)
              const canEditSubOffers = canEditField(sub.state, 'offers')
              if (canEditSubOffers && introOfferConfig) {
                const introOfferResult = await pushSubscriptionIntroOffer(appStoreHelper, sub.appStoreId, introOfferConfig, pricingConfig)
                if (!introOfferResult.success) {
                  console.warn(`[Push] Warning: Failed to create intro offer for ${sub.productId}: ${introOfferResult.error}`)
                  results.errors.push({
                    id: `${sub.productId} (intro offer)`,
                    error: introOfferResult.error || 'Failed to create intro offer',
                  })
                } else {
                  results.debug.push(`Updated intro offer for ${sub.productId}`)
                }
              } else if (introOfferConfig && !canEditSubOffers) {
                console.warn(`[Push] Skipping intro offer for ${sub.productId}: Not editable in state ${sub.state}`)
              }

              // Re-fetch subscription state from App Store Connect
              let updatedState: string | undefined
              try {
                const refreshed = await appStoreHelper.getSubscription(sub.appStoreId)
                updatedState = refreshed.state
              } catch {
                // Fall back — state will update on next pull
              }

              // Only mark as synced if pricing succeeded, otherwise keep as local_changes
              await subDoc.ref.update({
                ...(updatedState ? { state: updatedState } : {}),
                syncStatus: pricingSucceeded ? 'synced' : 'local_changes',
                updatedAt: now,
              })

              results.updated.push(sub.productId)
            }
          } catch (error) {
            results.errors.push({
              id: sub.productId,
              error: error instanceof Error ? error.message : 'Unknown error',
            })
          }
        }
      }
    }

    return Response.json({
      success: results.errors.length === 0,
      results,
    })
  } catch (error) {
    console.error('Error pushing IAPs:', error)
    return errorResponse(error instanceof Error ? error.message : 'Failed to push IAPs', 500)
  }
}
