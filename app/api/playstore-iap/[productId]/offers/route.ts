import { NextRequest, NextResponse } from 'next/server'
import { Timestamp } from 'firebase-admin/firestore'
import { getPlayStoreContext, errorResponse, unauthorizedResponse } from '../../_helpers'

type Params = { params: Promise<{ productId: string }> }

// GET — List offers for a subscription
export async function GET(request: NextRequest, { params }: Params) {
  const { productId } = await params
  const { searchParams } = new URL(request.url)
  const projectId = searchParams.get('projectId')
  if (!projectId) return errorResponse('projectId is required')

  const ctx = await getPlayStoreContext(request, projectId)
  if ('error' in ctx && !ctx.basePath) return unauthorizedResponse(ctx.error)
  const { basePath } = ctx as any

  try {
    const subRef = basePath.collection('playStoreSubscriptions').doc(productId)
    const subDoc = await subRef.get()
    if (!subDoc.exists) return errorResponse('Subscription not found', 404)

    const offersSnap = await subRef.collection('offers').get()
    const offers = offersSnap.docs.map((d: any) => ({ id: d.id, ...d.data() }))
    return NextResponse.json({ offers })
  } catch (error: any) {
    return errorResponse(error.message, 500)
  }
}

// POST — Create an offer
export async function POST(request: NextRequest, { params }: Params) {
  const { productId } = await params
  const body = await request.json()
  const { projectId, offerId, basePlanId, phases, targeting } = body
  if (!projectId || !offerId || !basePlanId) {
    return errorResponse('projectId, offerId, and basePlanId are required')
  }

  const ctx = await getPlayStoreContext(request, projectId)
  if ('error' in ctx && !ctx.basePath) return unauthorizedResponse(ctx.error)
  const { basePath } = ctx as any

  try {
    const subRef = basePath.collection('playStoreSubscriptions').doc(productId)
    const subDoc = await subRef.get()
    if (!subDoc.exists) return errorResponse('Subscription not found', 404)

    const now = Timestamp.now()
    const offerData = {
      offerId,
      basePlanId,
      state: null,
      syncStatus: 'pending_creation' as const,
      phases: phases || [],
      ...(targeting ? { targeting } : {}),
      createdAt: now,
      updatedAt: now,
    }

    const docRef = await subRef.collection('offers').add(offerData)
    return NextResponse.json({ success: true, id: docRef.id, ...offerData })
  } catch (error: any) {
    return errorResponse(error.message, 500)
  }
}
