import { NextRequest, NextResponse } from 'next/server'
import { Timestamp } from 'firebase-admin/firestore'
import { getPlayStoreContext, errorResponse, unauthorizedResponse } from '../../_helpers'

type Params = { params: Promise<{ productId: string }> }

// GET — Get pricing config for a product or base plan
export async function GET(request: NextRequest, { params }: Params) {
  const { productId } = await params
  const { searchParams } = new URL(request.url)
  const projectId = searchParams.get('projectId')
  const basePlanId = searchParams.get('basePlanId')
  if (!projectId) return errorResponse('projectId is required')

  const ctx = await getPlayStoreContext(request, projectId)
  if ('error' in ctx && !ctx.basePath) return unauthorizedResponse(ctx.error)
  const { basePath } = ctx as any

  try {
    for (const collection of ['playStoreProducts', 'playStoreSubscriptions']) {
      const ref = basePath.collection(collection).doc(productId)
      const doc = await ref.get()
      if (doc.exists) {
        const configKey = basePlanId ? `basePlan_${basePlanId}_pricing` : 'pricing'
        const pricingDoc = await ref.collection('config').doc(configKey).get()
        return NextResponse.json({ pricing: pricingDoc.exists ? pricingDoc.data() : null })
      }
    }
    return errorResponse('Product not found', 404)
  } catch (error: any) {
    return errorResponse(error.message, 500)
  }
}

// PUT — Set pricing config
export async function PUT(request: NextRequest, { params }: Params) {
  const { productId } = await params
  const body = await request.json()
  const { projectId, basePriceUsd, strategy, basePlanId, manualPrices } = body
  if (!projectId) return errorResponse('projectId is required')
  if (!basePriceUsd) return errorResponse('basePriceUsd is required')

  const ctx = await getPlayStoreContext(request, projectId)
  if ('error' in ctx && !ctx.basePath) return unauthorizedResponse(ctx.error)
  const { basePath } = ctx as any

  try {
    for (const collection of ['playStoreProducts', 'playStoreSubscriptions']) {
      const ref = basePath.collection(collection).doc(productId)
      const doc = await ref.get()
      if (doc.exists) {
        const configKey = basePlanId ? `basePlan_${basePlanId}_pricing` : 'pricing'
        const pricingData = {
          basePriceUsd,
          strategy: strategy || 'auto_convert',
          manualPrices: manualPrices || undefined,
          updatedAt: Timestamp.now(),
        }
        await ref.collection('config').doc(configKey).set(pricingData)

        // Update product default price
        if (!basePlanId && collection === 'playStoreProducts') {
          await ref.update({ defaultPriceUsd: basePriceUsd, updatedAt: Timestamp.now() })
        }

        if (doc.data()?.syncStatus === 'synced') {
          await ref.update({ syncStatus: 'local_changes', updatedAt: Timestamp.now() })
        }
        return NextResponse.json({ success: true, pricing: pricingData })
      }
    }
    return errorResponse('Product not found', 404)
  } catch (error: any) {
    return errorResponse(error.message, 500)
  }
}
