import { NextRequest, NextResponse } from 'next/server'
import { Timestamp } from 'firebase-admin/firestore'
import { getPlayStoreContext, errorResponse, unauthorizedResponse } from '../../_helpers'

type Params = { params: Promise<{ productId: string }> }

// GET — Get availability config
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

    // Availability is embedded in base plans via regionalConfigs.newSubscriberAvailability
    const data = subDoc.data()
    const availability = (data?.basePlans || []).map((bp: any) => ({
      basePlanId: bp.basePlanId,
      state: bp.state,
    }))

    return NextResponse.json({ availability })
  } catch (error: any) {
    return errorResponse(error.message, 500)
  }
}

// PUT — Update base plan availability (stored locally)
export async function PUT(request: NextRequest, { params }: Params) {
  const { productId } = await params
  const body = await request.json()
  const { projectId, basePlanId, regions } = body
  if (!projectId || !basePlanId) return errorResponse('projectId and basePlanId are required')

  const ctx = await getPlayStoreContext(request, projectId)
  if ('error' in ctx && !ctx.basePath) return unauthorizedResponse(ctx.error)
  const { basePath } = ctx as any

  try {
    const subRef = basePath.collection('playStoreSubscriptions').doc(productId)
    const subDoc = await subRef.get()
    if (!subDoc.exists) return errorResponse('Subscription not found', 404)

    // Store availability config for the base plan
    await subRef.collection('config').doc(`basePlan_${basePlanId}_availability`).set({
      regions: regions || [],
      updatedAt: Timestamp.now(),
    })

    if (subDoc.data()?.syncStatus === 'synced') {
      await subRef.update({ syncStatus: 'local_changes', updatedAt: Timestamp.now() })
    }

    return NextResponse.json({ success: true })
  } catch (error: any) {
    return errorResponse(error.message, 500)
  }
}
