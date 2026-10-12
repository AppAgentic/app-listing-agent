import { NextRequest, NextResponse } from 'next/server'
import { Timestamp } from 'firebase-admin/firestore'
import { getPlayStoreContext, errorResponse, unauthorizedResponse } from '../../../_helpers'

type Params = { params: Promise<{ productId: string; offerId: string }> }

// PATCH — Update an offer
export async function PATCH(request: NextRequest, { params }: Params) {
  const { productId, offerId } = await params
  const body = await request.json()
  const { projectId, phases, targeting } = body
  if (!projectId) return errorResponse('projectId is required')

  const ctx = await getPlayStoreContext(request, projectId)
  if ('error' in ctx && !ctx.basePath) return unauthorizedResponse(ctx.error)
  const { basePath } = ctx as any

  try {
    const offerRef = basePath.collection('playStoreSubscriptions').doc(productId).collection('offers').doc(offerId)
    const offerDoc = await offerRef.get()
    if (!offerDoc.exists) return errorResponse('Offer not found', 404)

    const updates: any = { updatedAt: Timestamp.now() }
    if (phases) updates.phases = phases
    if (targeting !== undefined) updates.targeting = targeting
    if (offerDoc.data()?.syncStatus === 'synced') updates.syncStatus = 'local_changes'

    await offerRef.update(updates)
    return NextResponse.json({ success: true })
  } catch (error: any) {
    return errorResponse(error.message, 500)
  }
}

// DELETE — Delete an offer
export async function DELETE(request: NextRequest, { params }: Params) {
  const { productId, offerId } = await params
  const { searchParams } = new URL(request.url)
  const projectId = searchParams.get('projectId')
  if (!projectId) return errorResponse('projectId is required')

  const ctx = await getPlayStoreContext(request, projectId)
  if ('error' in ctx && !ctx.basePath) return unauthorizedResponse(ctx.error)
  const { basePath } = ctx as any

  try {
    const offerRef = basePath.collection('playStoreSubscriptions').doc(productId).collection('offers').doc(offerId)
    await offerRef.delete()
    return NextResponse.json({ success: true })
  } catch (error: any) {
    return errorResponse(error.message, 500)
  }
}
