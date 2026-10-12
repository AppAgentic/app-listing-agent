import { NextRequest, NextResponse } from 'next/server'
import { Timestamp } from 'firebase-admin/firestore'
import { getPlayStoreHelper, errorResponse, unauthorizedResponse } from '../../../../_helpers'

type Params = { params: Promise<{ productId: string; offerId: string }> }

// POST — Activate an offer on Play Store
export async function POST(request: NextRequest, { params }: Params) {
  const { productId: subscriptionDocId, offerId } = await params
  const body = await request.json()
  const { projectId, basePlanId } = body
  if (!projectId || !basePlanId) {
    return errorResponse('projectId and basePlanId are required')
  }

  let ctx: any
  try {
    ctx = await getPlayStoreHelper(request, projectId)
  } catch (error: any) {
    return errorResponse(`Failed to initialize: ${error.message}`)
  }
  if ('error' in ctx && !ctx.helper) return unauthorizedResponse(ctx.error)
  const { helper, basePath } = ctx as any

  try {
    const subRef = basePath.collection('playStoreSubscriptions').doc(subscriptionDocId)
    const subDoc = await subRef.get()
    if (!subDoc.exists) return errorResponse('Subscription not found', 404)
    const productId = subDoc.data().productId

    // Find the offer doc by offerId field
    const offersSnap = await subRef.collection('offers').where('offerId', '==', offerId).get()
    if (offersSnap.empty) return errorResponse('Offer not found', 404)
    const offerDocRef = offersSnap.docs[0].ref

    await helper.activateOffer(productId, basePlanId, offerId)
    await offerDocRef.update({
      state: 'ACTIVE',
      syncStatus: 'synced',
      updatedAt: Timestamp.now(),
    })

    return NextResponse.json({ success: true })
  } catch (error: any) {
    return errorResponse(error.message, 500)
  }
}
