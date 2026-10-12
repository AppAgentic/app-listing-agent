import { NextRequest, NextResponse } from 'next/server'
import { Timestamp } from 'firebase-admin/firestore'
import { getPlayStoreHelper, errorResponse, unauthorizedResponse } from '../_helpers'
import { usdToPriceMicros, usdToMoney } from '@/lib/services/playstore'

// POST /api/playstore-iap/push — Push local products to Play Store
export async function POST(request: NextRequest) {
  let body: any
  try {
    body = await request.json()
  } catch {
    return errorResponse('Invalid request body')
  }
  const { projectId, productIds, subscriptionIds, pushAll, force } = body
  if (!projectId) return errorResponse('projectId is required')

  let ctx: any
  try {
    ctx = await getPlayStoreHelper(request, projectId)
  } catch (error: any) {
    return errorResponse(`Failed to initialize: ${error.message}`)
  }
  if ('error' in ctx && !ctx.helper) return unauthorizedResponse(ctx.error)
  const { helper, basePath } = ctx as any

  try {
    const now = Timestamp.now()
    const results = { created: [] as string[], updated: [] as string[], errors: [] as any[] }

    // Collect items to push
    let productsToProcess: any[] = []
    let subsToProcess: any[] = []

    if (pushAll) {
      const pQuery = force
        ? basePath.collection('playStoreProducts')
        : basePath.collection('playStoreProducts').where('syncStatus', 'in', ['pending_creation', 'local_changes'])
      const productsSnap = await pQuery.get()
      productsToProcess = productsSnap.docs.map((d: any) => ({ id: d.id, ref: d.ref, ...d.data() }))

      const sQuery = force
        ? basePath.collection('playStoreSubscriptions')
        : basePath.collection('playStoreSubscriptions').where('syncStatus', 'in', ['pending_creation', 'local_changes'])
      const subsSnap = await sQuery.get()
      subsToProcess = subsSnap.docs.map((d: any) => ({ id: d.id, ref: d.ref, ...d.data() }))
    } else {
      if (productIds?.length) {
        for (const id of productIds) {
          const doc = await basePath.collection('playStoreProducts').doc(id).get()
          if (doc.exists) productsToProcess.push({ id: doc.id, ref: doc.ref, ...doc.data() })
        }
      }
      if (subscriptionIds?.length) {
        for (const id of subscriptionIds) {
          const doc = await basePath.collection('playStoreSubscriptions').doc(id).get()
          if (doc.exists) subsToProcess.push({ id: doc.id, ref: doc.ref, ...doc.data() })
        }
      }
    }

    // === Push one-time products ===
    for (const product of productsToProcess) {
      try {
        // Get localizations
        const locSnap = await product.ref.collection('localizations').get()
        const listings: Record<string, { title: string; description: string }> = {}
        for (const d of locSnap.docs) {
          const data = d.data()
          listings[d.id] = { title: data.title || '', description: data.description || '' }
        }

        // Get pricing
        const pricingDoc = await product.ref.collection('config').doc('pricing').get()
        const basePriceUsd = pricingDoc.exists ? pricingDoc.data()?.basePriceUsd : product.defaultPriceUsd

        if (!basePriceUsd) {
          results.errors.push({ id: product.id, sku: product.sku, error: 'No pricing configured' })
          continue
        }

        const defaultPrice = { priceMicros: usdToPriceMicros(basePriceUsd), currency: 'USD' }

        // Convert regional prices
        let prices: Record<string, { priceMicros: string; currency: string }> = {}
        try {
          const converted = await helper.convertRegionPrices(basePriceUsd)
          for (const [region, data] of Object.entries(converted)) {
            const d = data as any
            if (d.price) {
              const usd = Number(d.price.units || 0) + (d.price.nanos || 0) / 1e9
              prices[region] = { priceMicros: usdToPriceMicros(usd), currency: d.price.currencyCode || 'USD' }
            }
          }
        } catch (priceErr) {
          console.warn(`[Push] Regional price conversion failed for ${product.sku}, using US-only:`, priceErr)
          // Ensure at least US pricing is set
          prices = { US: { priceMicros: usdToPriceMicros(basePriceUsd), currency: 'USD' } }
        }

        if (product.syncStatus === 'pending_creation') {
          await helper.createProduct({
            sku: product.sku,
            defaultPrice,
            defaultLanguage: product.defaultLanguage || 'en-US',
            listings,
            prices,
          })
          results.created.push(product.sku)
        } else {
          await helper.updateProduct(product.sku, { defaultPrice, listings, prices })
          results.updated.push(product.sku)
        }

        await product.ref.update({ status: 'ACTIVE', syncStatus: 'synced', updatedAt: now })
      } catch (error: any) {
        results.errors.push({ id: product.id, sku: product.sku, error: error.message })
      }
    }

    // === Push subscriptions ===
    for (const sub of subsToProcess) {
      try {
        // Get localizations
        const locSnap = await sub.ref.collection('localizations').get()
        const listings = locSnap.docs.map((d: any) => ({
          languageCode: d.id,
          title: d.data().title || '',
          description: d.data().description || '',
        }))

        // Build base plans with per-country pricing from convertRegionPrices
        let resolvedRegionsVersion: string | null = null
        const basePlans = await Promise.all((sub.basePlans || []).map(async (bp: any) => {
          const pricingDoc = await sub.ref.collection('config').doc(`basePlan_${bp.basePlanId}_pricing`).get()
          const basePriceUsd = pricingDoc.exists ? pricingDoc.data()?.basePriceUsd : bp.defaultPriceUsd
          const usdPrice = usdToMoney(basePriceUsd || 0.99)

          let regionalConfigs: any[] = []
          let otherRegionsConfig: any = undefined

          if (basePriceUsd) {
            try {
              const { regionalPrices, otherRegionsPrice, regionsVersion } = await helper.convertRegionPricesWithOther(basePriceUsd)
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

          const plan: any = { basePlanId: bp.basePlanId, regionalConfigs, otherRegionsConfig }
          if (bp.type === 'AUTO_RENEWING') {
            plan.autoRenewingBasePlanType = {
              billingPeriodDuration: bp.billingPeriodDuration || 'P1M',
              ...(bp.gracePeriodDuration ? { gracePeriodDuration: bp.gracePeriodDuration } : {}),
            }
          } else {
            plan.prepaidBasePlanType = {}
          }
          return plan
        }))

        if (sub.syncStatus === 'pending_creation') {
          await helper.createSubscription({
            productId: sub.productId,
            listings,
            basePlans,
            regionsVersion: resolvedRegionsVersion || undefined,
          })
          results.created.push(sub.productId)

          // Activate base plans
          for (const bp of sub.basePlans || []) {
            try {
              await helper.activateBasePlan(sub.productId, bp.basePlanId)
            } catch {
              // May already be active or draft-only
            }
          }
        } else {
          // For existing subscriptions, GET the full raw subscription first,
          // then merge our local pricing into the remote base plans structure.
          // The API requires complete basePlan objects — partial objects fail silently.
          const rawRemoteSub = await helper.getSubscriptionRaw(sub.productId)

          if (!rawRemoteSub) {
            // Subscription doesn't exist remotely — create it instead of updating
            console.log(`[Push] Subscription ${sub.productId} not found remotely, creating instead of updating`)
            await helper.createSubscription({
              productId: sub.productId,
              listings,
              basePlans,
              regionsVersion: resolvedRegionsVersion || undefined,
            })
            results.created.push(sub.productId)
            for (const bp of sub.basePlans || []) {
              try { await helper.activateBasePlan(sub.productId, bp.basePlanId) } catch { /* */ }
            }
          } else {
            const localBasePlanMap = new Map<string, any>()
            for (const bp of basePlans) {
              localBasePlanMap.set(bp.basePlanId, bp)
            }

            let mergedBasePlans: any[]
            if (rawRemoteSub.basePlans?.length > 0) {
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

            console.log(`[Push] Updating subscription ${sub.productId} with ${mergedBasePlans.length} base plans`)

            await helper.updateSubscription(sub.productId, { listings, basePlans: mergedBasePlans, regionsVersion: resolvedRegionsVersion || undefined })
            results.updated.push(sub.productId)

            // Re-activate base plans after update
            for (const bp of sub.basePlans || []) {
              try {
                await helper.activateBasePlan(sub.productId, bp.basePlanId)
              } catch {
                // May already be active
              }
            }
          }
        }

        // Push pending offers
        try {
          const offersSnap = await sub.ref.collection('offers')
            .where('syncStatus', 'in', ['pending_creation', 'local_changes']).get()
          for (const offerDoc of offersSnap.docs) {
            const offer = offerDoc.data()
            try {
              // Get all region codes from the parent base plan's regionalConfigs
              const parentBp = basePlans.find((bp: any) => bp.basePlanId === offer.basePlanId)
              const regionCodes: string[] = parentBp?.regionalConfigs?.map((rc: any) => rc.regionCode) || ['US']

              const apiPhases = (offer.phases || []).map((p: any) => ({
                recurrenceCount: p.recurrenceCount,
                duration: p.duration,
                regionalConfigs: p.priceType === 'FREE'
                  ? regionCodes.map(rc => ({ regionCode: rc, free: {} }))
                  : regionCodes.map(rc => ({ regionCode: rc, relativeDiscount: { percentage: (p.discountPercent || 0) * 10000 } })),
                otherRegionsConfig: p.priceType === 'FREE'
                  ? { free: {} }
                  : { relativeDiscount: { percentage: (p.discountPercent || 0) * 10000 } },
              }))
              if (offer.syncStatus === 'pending_creation') {
                await helper.createOffer(sub.productId, offer.basePlanId, {
                  offerId: offer.offerId,
                  phases: apiPhases,
                  targeting: offer.targeting,
                  regionsVersion: resolvedRegionsVersion || undefined,
                })
                try {
                  await helper.activateOffer(sub.productId, offer.basePlanId, offer.offerId)
                  await offerDoc.ref.update({ state: 'ACTIVE', syncStatus: 'synced', updatedAt: now })
                } catch {
                  await offerDoc.ref.update({ state: 'DRAFT', syncStatus: 'synced', updatedAt: now })
                }
              } else {
                await helper.updateOffer(sub.productId, offer.basePlanId, offer.offerId, { phases: apiPhases })
                await offerDoc.ref.update({ syncStatus: 'synced', updatedAt: now })
              }
            } catch (offerErr: any) {
              console.warn(`[Push] Offer ${offer.offerId} failed:`, offerErr?.message)
            }
          }
        } catch (offersErr: any) {
          console.warn(`[Push] Offer push failed for ${sub.productId}:`, offersErr?.message)
        }

        // Update local base plan states
        const updatedBasePlans = (sub.basePlans || []).map((bp: any) => ({
          ...bp,
          state: 'ACTIVE',
        }))

        await sub.ref.update({
          syncStatus: 'synced',
          basePlans: updatedBasePlans,
          updatedAt: now,
        })
      } catch (error: any) {
        results.errors.push({ id: sub.id, productId: sub.productId, error: error.message })
      }
    }

    return NextResponse.json({ success: true, ...results })
  } catch (error: any) {
    return errorResponse(error.message || 'Push failed', 500)
  }
}
