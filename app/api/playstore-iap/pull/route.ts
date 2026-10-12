import { NextRequest, NextResponse } from 'next/server'
import { Timestamp } from 'firebase-admin/firestore'
import { getPlayStoreHelper, errorResponse, unauthorizedResponse } from '../_helpers'
import { priceMicrosToUsd, moneyToUsd } from '@/lib/services/playstore'

// POST /api/playstore-iap/pull — Sync products from Play Store into Firestore
export async function POST(request: NextRequest) {
  const body = await request.json()
  const { projectId } = body
  if (!projectId) return errorResponse('projectId is required')

  const ctx = await getPlayStoreHelper(request, projectId)
  if ('error' in ctx && !ctx.helper) return unauthorizedResponse(ctx.error)
  const { helper, basePath } = ctx as any

  try {
    const now = Timestamp.now()
    const results = { products: 0, subscriptions: 0, offers: 0, orphans: [] as any[] }

    // === Pull one-time products ===
    const remoteProducts = await helper.listProducts()
    const pulledProductSkus = new Set<string>()

    for (const rp of remoteProducts) {
      pulledProductSkus.add(rp.sku)

      // Find or create local product
      const existingSnap = await basePath.collection('playStoreProducts').where('sku', '==', rp.sku).get()
      const ref = existingSnap.empty
        ? basePath.collection('playStoreProducts').doc()
        : existingSnap.docs[0].ref

      const productData: any = {
        sku: rp.sku,
        productType: 'ONE_TIME',
        status: rp.status === 'active' ? 'ACTIVE' : 'INACTIVE',
        syncStatus: 'synced',
        defaultLanguage: rp.defaultLanguage || 'en-US',
        defaultPriceUsd: rp.defaultPrice ? priceMicrosToUsd(rp.defaultPrice.priceMicros) : null,
        updatedAt: now,
      }
      if (existingSnap.empty) productData.createdAt = now

      await ref.set(productData, { merge: true })

      // Upsert localizations
      for (const [locale, listing] of Object.entries(rp.listings || {})) {
        await ref.collection('localizations').doc(locale).set({
          locale,
          title: (listing as any).title || '',
          description: (listing as any).description || '',
        })
      }

      // Store pricing
      if (rp.defaultPrice) {
        await ref.collection('config').doc('pricing').set({
          basePriceUsd: priceMicrosToUsd(rp.defaultPrice.priceMicros),
          strategy: 'auto_convert',
          updatedAt: now,
        })
      }

      results.products++
    }

    // === Pull subscriptions ===
    const remoteSubs = await helper.listSubscriptions()
    const pulledSubIds = new Set<string>()

    for (const rs of remoteSubs) {
      pulledSubIds.add(rs.productId)

      const existingSnap = await basePath.collection('playStoreSubscriptions').where('productId', '==', rs.productId).get()
      const ref = existingSnap.empty
        ? basePath.collection('playStoreSubscriptions').doc()
        : existingSnap.docs[0].ref

      const subData: any = {
        productId: rs.productId,
        syncStatus: 'synced',
        defaultLanguage: rs.listings?.[0]?.languageCode || 'en-US',
        basePlans: (rs.basePlans || []).map((bp: any) => ({
          basePlanId: bp.basePlanId,
          state: bp.state || 'DRAFT',
          type: bp.autoRenewingBasePlanType ? 'AUTO_RENEWING' : 'PREPAID',
          billingPeriodDuration: bp.autoRenewingBasePlanType?.billingPeriodDuration || undefined,
          gracePeriodDuration: bp.autoRenewingBasePlanType?.gracePeriodDuration || undefined,
          defaultPriceUsd: bp.regionalConfigs?.find((rc: any) => rc.regionCode === 'US')?.price
            ? moneyToUsd(bp.regionalConfigs.find((rc: any) => rc.regionCode === 'US')!.price)
            : null,
        })),
        updatedAt: now,
      }
      if (existingSnap.empty) subData.createdAt = now

      await ref.set(subData, { merge: true })

      // Upsert localizations
      for (const listing of rs.listings || []) {
        await ref.collection('localizations').doc(listing.languageCode).set({
          locale: listing.languageCode,
          title: listing.title || '',
          description: listing.description || '',
        })
      }

      // Store base plan pricing
      for (const bp of rs.basePlans || []) {
        const usPrice = bp.regionalConfigs?.find((rc: any) => rc.regionCode === 'US')?.price
        if (usPrice) {
          await ref.collection('config').doc(`basePlan_${bp.basePlanId}_pricing`).set({
            basePriceUsd: moneyToUsd(usPrice),
            strategy: 'auto_convert',
            updatedAt: now,
          })
        }
      }

      // Pull offers for each base plan
      for (const bp of rs.basePlans || []) {
        try {
          const offers = await helper.listOffers(rs.productId, bp.basePlanId)
          for (const offer of offers) {
            const existingOffer = await ref.collection('offers').where('offerId', '==', offer.offerId).get()
            const offerRef = existingOffer.empty ? ref.collection('offers').doc() : existingOffer.docs[0].ref
            await offerRef.set({
              offerId: offer.offerId,
              basePlanId: offer.basePlanId,
              state: offer.state || 'DRAFT',
              syncStatus: 'synced',
              phases: offer.phases.map((p: any) => ({
                recurrenceCount: p.recurrenceCount,
                duration: p.duration,
                priceType: p.regionalConfigs?.some((rc: any) => rc.free) ? 'FREE' : 'DISCOUNTED',
              })),
              updatedAt: now,
              ...(!existingOffer.empty ? {} : { createdAt: now }),
            }, { merge: true })
            results.offers++
          }
        } catch {
          // Some base plans might not have offers
        }
      }

      results.subscriptions++
    }

    // === Detect orphans ===
    const localProducts = await basePath.collection('playStoreProducts').get()
    for (const doc of localProducts.docs) {
      const data = doc.data()
      if (data.syncStatus === 'synced' && !pulledProductSkus.has(data.sku)) {
        results.orphans.push({ id: doc.id, type: 'product', sku: data.sku })
      }
    }

    const localSubs = await basePath.collection('playStoreSubscriptions').get()
    for (const doc of localSubs.docs) {
      const data = doc.data()
      if (data.syncStatus === 'synced' && !pulledSubIds.has(data.productId)) {
        results.orphans.push({ id: doc.id, type: 'subscription', productId: data.productId })
      }
    }

    return NextResponse.json({ success: true, ...results })
  } catch (error: any) {
    return errorResponse(error.message || 'Pull failed', 500)
  }
}
