import { NextRequest } from 'next/server'
import { Timestamp } from 'firebase-admin/firestore'
import { getPlayStoreHelper, errorResponse } from '../../_helpers'
import { usdToPriceMicros, usdToMoney } from '@/lib/services/playstore'

// POST /api/playstore-iap/push/stream — Push with SSE progress events
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
  if ('error' in ctx && !ctx.helper) return errorResponse(ctx.error || 'Auth failed')
  const { helper, basePath } = ctx as any

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      function send(event: string, data: any) {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
      }

      try {
        const now = Timestamp.now()
        const results = { created: [] as string[], updated: [] as string[], errors: [] as any[] }

        // Collect items
        let products: any[] = []
        let subs: any[] = []

        if (pushAll) {
          const pQuery = force
            ? basePath.collection('playStoreProducts')
            : basePath.collection('playStoreProducts').where('syncStatus', 'in', ['pending_creation', 'local_changes'])
          const pSnap = await pQuery.get()
          products = pSnap.docs.map((d: any) => ({ id: d.id, ref: d.ref, ...d.data() }))
          const sQuery = force
            ? basePath.collection('playStoreSubscriptions')
            : basePath.collection('playStoreSubscriptions').where('syncStatus', 'in', ['pending_creation', 'local_changes'])
          const sSnap = await sQuery.get()
          subs = sSnap.docs.map((d: any) => ({ id: d.id, ref: d.ref, ...d.data() }))
        } else {
          for (const id of productIds || []) {
            const doc = await basePath.collection('playStoreProducts').doc(id).get()
            if (doc.exists) products.push({ id: doc.id, ref: doc.ref, ...doc.data() })
          }
          for (const id of subscriptionIds || []) {
            const doc = await basePath.collection('playStoreSubscriptions').doc(id).get()
            if (doc.exists) subs.push({ id: doc.id, ref: doc.ref, ...doc.data() })
          }
        }

        const allItems = [
          ...products.map(p => p.sku || p.id),
          ...subs.map(s => s.productId || s.id),
        ]
        send('start', { items: allItems })

        // Push products
        for (const product of products) {
          const itemId = product.sku || product.id
          send('item_start', { productId: itemId, step: 'Preparing product...' })

          try {
            send('item_progress', { productId: itemId, step: 'Loading localizations...', progress: 10 })
            const locSnap = await product.ref.collection('localizations').get()
            const listings: Record<string, { title: string; description: string }> = {}
            for (const d of locSnap.docs) {
              listings[d.id] = { title: d.data().title, description: d.data().description }
            }

            send('item_progress', { productId: itemId, step: 'Resolving pricing...', progress: 30 })
            const pricingDoc = await product.ref.collection('config').doc('pricing').get()
            const basePriceUsd = pricingDoc.exists ? pricingDoc.data()?.basePriceUsd : product.defaultPriceUsd
            if (!basePriceUsd) throw new Error('No pricing configured')

            const defaultPrice = { priceMicros: usdToPriceMicros(basePriceUsd), currency: 'USD' }
            let prices: Record<string, { priceMicros: string; currency: string }> = {}
            try {
              const converted = await helper.convertRegionPrices(basePriceUsd)
              for (const [region, data] of Object.entries(converted)) {
                const d = data as any
                if (d.price) {
                  const usd = Number(d.price.units || 0) + (d.price.nanos || 0) / 1e9
                  prices[region] = { priceMicros: usdToPriceMicros(usd), currency: d.price.currencyCode }
                }
              }
            } catch {
              // Ensure at least US pricing
              prices = { US: { priceMicros: usdToPriceMicros(basePriceUsd), currency: 'USD' } }
            }

            send('item_progress', { productId: itemId, step: 'Pushing to Play Store...', progress: 60 })
            if (product.syncStatus === 'pending_creation') {
              await helper.createProduct({ sku: product.sku, defaultPrice, defaultLanguage: product.defaultLanguage, listings, prices })
              results.created.push(itemId)
            } else {
              await helper.updateProduct(product.sku, { defaultPrice, listings, prices })
              results.updated.push(itemId)
            }

            await product.ref.update({ status: 'ACTIVE', syncStatus: 'synced', updatedAt: now })
            send('item_complete', { productId: itemId, status: product.syncStatus === 'pending_creation' ? 'created' : 'updated' })
          } catch (error: any) {
            results.errors.push({ id: product.id, error: error.message })
            send('item_complete', { productId: itemId, status: 'error', error: error.message })
          }
        }

        // Push subscriptions
        for (const sub of subs) {
          const itemId = sub.productId || sub.id
          send('item_start', { productId: itemId, step: 'Preparing subscription...' })

          try {
            send('item_progress', { productId: itemId, step: 'Loading localizations...', progress: 10 })
            const locSnap = await sub.ref.collection('localizations').get()
            const listings = locSnap.docs.map((d: any) => ({
              languageCode: d.id, title: d.data().title, description: d.data().description,
            }))

            send('item_progress', { productId: itemId, step: 'Resolving base plan pricing...', progress: 30 })
            // Convert prices once for all base plans (they share the same conversion)
            let allRegionalPrices: Record<string, { price: any }> = {}
            let otherRegionsFallback: { usdPrice: any; eurPrice: any } | null = null
            let regionsVersionStr: string | null = null

            const basePlans = await Promise.all((sub.basePlans || []).map(async (bp: any) => {
              const pricingDoc = await sub.ref.collection('config').doc(`basePlan_${bp.basePlanId}_pricing`).get()
              const price = pricingDoc.exists ? pricingDoc.data()?.basePriceUsd : bp.defaultPriceUsd
              const usdPrice = usdToMoney(price || 0.99)

              // Build per-country regionalConfigs from convertRegionPrices
              let regionalConfigs: any[] = []
              let otherRegionsConfig: any = undefined

              if (price) {
                try {
                  const { regionalPrices, otherRegionsPrice, regionsVersion } = await helper.convertRegionPricesWithOther(price)
                  regionsVersionStr = regionsVersion

                  // Build a regionalConfig for every region returned
                  for (const [regionCode, data] of Object.entries(regionalPrices)) {
                    const d = data as any
                    if (d.price) {
                      regionalConfigs.push({
                        regionCode,
                        newSubscriberAvailability: true,
                        price: d.price,
                      })
                    }
                  }

                  // Also set otherRegionsConfig for future countries
                  if (otherRegionsPrice) {
                    otherRegionsConfig = {
                      usdPrice: otherRegionsPrice.usdPrice,
                      eurPrice: otherRegionsPrice.eurPrice,
                      newSubscriberAvailability: true,
                    }
                  }

                  console.log(`[Push] Base plan ${bp.basePlanId}: price=$${price}, ${regionalConfigs.length} regions, regionsVersion=${regionsVersion}`)
                } catch (err: any) {
                  console.warn(`[Push] convertRegionPrices failed for ${bp.basePlanId}:`, err?.message)
                  // Fallback: just US
                  regionalConfigs = [{ regionCode: 'US', newSubscriberAvailability: true, price: usdPrice }]
                  otherRegionsConfig = { usdPrice, eurPrice: usdPrice, newSubscriberAvailability: true }
                }
              } else {
                regionalConfigs = [{ regionCode: 'US', newSubscriberAvailability: true, price: usdPrice }]
                otherRegionsConfig = { usdPrice: usdToMoney(0.99), eurPrice: usdToMoney(0.99), newSubscriberAvailability: true }
              }

              const plan: any = { basePlanId: bp.basePlanId, regionalConfigs, otherRegionsConfig }
              if (bp.type === 'AUTO_RENEWING') {
                plan.autoRenewingBasePlanType = { billingPeriodDuration: bp.billingPeriodDuration || 'P1M' }
              } else {
                plan.prepaidBasePlanType = {}
              }
              return plan
            }))

            send('item_progress', { productId: itemId, step: 'Pushing to Play Store...', progress: 60 })
            if (sub.syncStatus === 'pending_creation') {
              await helper.createSubscription({ productId: sub.productId, listings, basePlans, regionsVersion: regionsVersionStr || undefined })
              results.created.push(itemId)
              send('item_progress', { productId: itemId, step: 'Activating base plans...', progress: 80 })
              for (const bp of sub.basePlans || []) {
                try { await helper.activateBasePlan(sub.productId, bp.basePlanId) } catch { /* */ }
              }
            } else {
              // For existing subscriptions, GET the full raw subscription first,
              // then merge our local pricing into the remote base plans structure.
              // The API requires complete basePlan objects — partial objects fail silently.
              send('item_progress', { productId: itemId, step: 'Fetching remote subscription...', progress: 50 })
              const rawRemoteSub = await helper.getSubscriptionRaw(sub.productId)

              // If subscription doesn't exist remotely, create it instead of updating
              if (!rawRemoteSub) {
                console.log(`[Push] Subscription ${sub.productId} not found remotely, creating instead of updating`)
                send('item_progress', { productId: itemId, step: 'Creating subscription (not found remotely)...', progress: 60 })
                await helper.createSubscription({ productId: sub.productId, listings, basePlans, regionsVersion: regionsVersionStr || undefined })
                results.created.push(itemId)
                send('item_progress', { productId: itemId, step: 'Activating base plans...', progress: 80 })
                for (const bp of sub.basePlans || []) {
                  try { await helper.activateBasePlan(sub.productId, bp.basePlanId) } catch { /* */ }
                }
              } else {
              // Build a lookup of our computed regionalConfigs by basePlanId
              const localBasePlanMap = new Map<string, any>()
              for (const bp of basePlans) {
                localBasePlanMap.set(bp.basePlanId, bp)
              }

              // Merge: take raw remote base plans as base, overlay our regionalConfigs
              let mergedBasePlans: any[]
              if (rawRemoteSub?.basePlans?.length > 0) {
                mergedBasePlans = rawRemoteSub.basePlans.map((remoteBp: any) => {
                  const localBp = localBasePlanMap.get(remoteBp.basePlanId)
                  // Strip output-only 'state' field, keep everything else from remote
                  const { state, ...remoteBpWithoutState } = remoteBp
                  return {
                    ...remoteBpWithoutState,
                    // Replace regionalConfigs with our computed ones (with per-country pricing)
                    regionalConfigs: localBp ? localBp.regionalConfigs : remoteBp.regionalConfigs,
                    // Carry over otherRegionsConfig for future countries
                    ...(localBp?.otherRegionsConfig ? { otherRegionsConfig: localBp.otherRegionsConfig } : {}),
                  }
                })
                // Add any new base plans not in remote
                for (const bp of basePlans) {
                  if (!rawRemoteSub.basePlans.find((r: any) => r.basePlanId === bp.basePlanId)) {
                    mergedBasePlans.push(bp)
                  }
                }
              } else {
                mergedBasePlans = basePlans
              }

              console.log(`[Push] Updating subscription ${sub.productId} with ${mergedBasePlans.length} base plans`)
              for (const bp of mergedBasePlans) {
                console.log(`  Base plan ${bp.basePlanId}: ${bp.regionalConfigs?.length || 0} regional configs, hasOtherRegions: ${!!bp.otherRegionsConfig}, keys: ${Object.keys(bp).join(',')}`)
                if (bp.otherRegionsConfig) {
                  console.log(`    otherRegionsConfig: ${JSON.stringify(bp.otherRegionsConfig)}`)
                }
              }

              const updateResult = await helper.updateSubscription(sub.productId, { listings, basePlans: mergedBasePlans, regionsVersion: regionsVersionStr || undefined })
              results.updated.push(itemId)

              // Re-activate base plans after update
              send('item_progress', { productId: itemId, step: 'Activating base plans...', progress: 80 })
              for (const bp of sub.basePlans || []) {
                try {
                  await helper.activateBasePlan(sub.productId, bp.basePlanId)
                } catch (activateErr: any) {
                  console.warn(`[Push] activateBasePlan ${bp.basePlanId} failed:`, activateErr?.message)
                }
              }
              } // end of rawRemoteSub exists branch

              // Verify: GET the subscription back and check if pricing was applied
              send('item_progress', { productId: itemId, step: 'Verifying pricing...', progress: 90 })
              const verifyRaw = await helper.getSubscriptionRaw(sub.productId)
              const verifyInfo: any = {}
              if (verifyRaw?.basePlans) {
                for (const vBp of verifyRaw.basePlans) {
                  verifyInfo[vBp.basePlanId] = {
                    state: vBp.state,
                    regionalConfigCount: vBp.regionalConfigs?.length || 0,
                    firstRegion: vBp.regionalConfigs?.[0]?.regionCode || 'NONE',
                    firstPrice: vBp.regionalConfigs?.[0]?.price || null,
                  }
                }
              }
              console.log(`[Push] Verify after update:`, JSON.stringify(verifyInfo))
              send('item_progress', { productId: itemId, step: `Verified: ${JSON.stringify(verifyInfo)}`, progress: 95 })
            }

            // Push pending offers
            try {
              const offersSnap = await sub.ref.collection('offers')
                .where('syncStatus', 'in', ['pending_creation', 'local_changes']).get()
              if (!offersSnap.empty) {
                send('item_progress', { productId: itemId, step: `Pushing ${offersSnap.size} offer(s)...`, progress: 92 })
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
                        regionsVersion: regionsVersionStr || undefined,
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
                    send('item_progress', { productId: itemId, step: `Pushed offer ${offer.offerId}` })
                  } catch (offerErr: any) {
                    console.warn(`[Push] Offer ${offer.offerId} failed:`, offerErr?.message)
                  }
                }
              }
            } catch (offersErr: any) {
              console.warn(`[Push] Offer push failed for ${sub.productId}:`, offersErr?.message)
            }

            const updatedBasePlans = (sub.basePlans || []).map((bp: any) => ({ ...bp, state: 'ACTIVE' }))
            await sub.ref.update({ syncStatus: 'synced', basePlans: updatedBasePlans, updatedAt: now })
            send('item_complete', { productId: itemId, status: sub.syncStatus === 'pending_creation' ? 'created' : 'updated' })
          } catch (error: any) {
            results.errors.push({ id: sub.id, error: error.message })
            send('item_complete', { productId: itemId, status: 'error', error: error.message })
          }
        }

        send('complete', results)
      } catch (error: any) {
        send('complete', { created: [], updated: [], errors: [{ error: error.message }] })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}
