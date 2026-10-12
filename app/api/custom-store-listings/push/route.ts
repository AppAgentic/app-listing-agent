import { NextRequest } from 'next/server'
import { Timestamp } from 'firebase-admin/firestore'
import { getPlayStoreHelper, errorResponse, unauthorizedResponse } from '../_helpers'
import type { CustomStoreListing, CSLLocalization } from '@/lib/firebase/firestore'
import { createReservationErrorResponse, refundUsage, reserveUsage, settleUsage } from '@/lib/api/usage'
import { randomUUID } from 'node:crypto'

// POST /api/custom-store-listings/push — Push CSLs to Play Store
export async function POST(request: NextRequest) {
  let body: any
  try { body = await request.json() } catch { return errorResponse('Invalid request body') }
  const { projectId, listingIds, pushAll, force } = body
  if (!projectId) return errorResponse('projectId is required')

  let ctx: any
  try {
    ctx = await getPlayStoreHelper(request, projectId)
  } catch (error: any) {
    return errorResponse(`Failed to initialize: ${error.message}`)
  }
  if ('error' in ctx && !ctx.helper) return unauthorizedResponse(ctx.error)
  const { helper, basePath, authContext } = ctx as any

  let publishingOperationId: string | null = null
  let providerChanged = false
  try {
    const now = Timestamp.now()
    const results = { created: [] as string[], updated: [] as string[], errors: [] as any[] }

    // Collect listings to push
    let listingsToProcess: any[] = []
    if (pushAll) {
      const query = force
        ? basePath.collection('customStoreListings')
        : basePath.collection('customStoreListings').where('syncStatus', 'in', ['pending_creation', 'local_changes'])
      const snapshot = await query.get()
      listingsToProcess = snapshot.docs.map((d: any) => ({ id: d.id, ref: d.ref, ...d.data() }))
    } else if (listingIds?.length) {
      for (const id of listingIds) {
        const doc = await basePath.collection('customStoreListings').doc(id).get()
        if (doc.exists) listingsToProcess.push({ id: doc.id, ref: doc.ref, ...doc.data() })
      }
    }

    if (listingsToProcess.length === 0) {
      return Response.json({ success: true, created: [], updated: [], errors: [] })
    }

    publishingOperationId = `publish-custom-store-listings-web:${request.headers.get('idempotency-key')?.trim() || randomUUID()}`
    const reservation = await reserveUsage(authContext, {
      operationId: publishingOperationId,
      usageType: 'publishing',
      units: 1,
      metadata: { route: 'custom-store-listings/push', projectId },
    })
    if (!reservation.allowed) return createReservationErrorResponse(reservation)
    if (reservation.replayed) return errorResponse('This publishing operation was already processed', 409)

    for (const listing of listingsToProcess) {
      try {
        // Get first localization
        const locSnap = await listing.ref.collection('localizations').limit(1).get()
        if (locSnap.empty) {
          results.errors.push({ id: listing.id, name: listing.name, error: 'No localizations configured' })
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
            await listing.ref.update({
              playStoreId: locData.locale,
              syncStatus: 'synced',
              updatedAt: now,
            })
            results.created.push(listing.name)
          } else {
            results.errors.push({ id: listing.id, name: listing.name, error: result.error })
          }
        } else {
          const result = await helper.updateCustomStoreListing(locData.locale, {
            title: locData.title,
            shortDescription: locData.shortDescription,
            fullDescription: locData.fullDescription,
          })
          if (result.success) {
            providerChanged = true
            await listing.ref.update({ syncStatus: 'synced', updatedAt: now })
            results.updated.push(listing.name)
          } else {
            results.errors.push({ id: listing.id, name: listing.name, error: result.error })
          }
        }
      } catch (error: any) {
        results.errors.push({ id: listing.id, name: listing.name, error: error.message })
      }
    }

    const settledOperationId = publishingOperationId
    publishingOperationId = null
    await settleUsage(authContext, settledOperationId, 'publishing', providerChanged ? 1 : 0)

    return Response.json({ success: true, ...results })
  } catch (error) {
    if (publishingOperationId) {
      if (providerChanged) await settleUsage(authContext, publishingOperationId, 'publishing', 1)
      else await refundUsage(authContext, publishingOperationId, 'publishing')
    }
    return errorResponse(error instanceof Error ? error.message : 'Push failed', 500)
  }
}
