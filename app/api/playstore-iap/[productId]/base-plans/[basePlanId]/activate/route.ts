import { NextRequest, NextResponse } from 'next/server'
import { getPlayStoreHelper, errorResponse, unauthorizedResponse } from '../../../../_helpers'

type Params = { params: Promise<{ productId: string; basePlanId: string }> }

// POST — Activate a base plan in Play Store
export async function POST(request: NextRequest, { params }: Params) {
  const { productId: firestoreId, basePlanId } = await params
  const body = await request.json()
  const { projectId, subscriptionProductId } = body
  if (!projectId || !subscriptionProductId) {
    return errorResponse('projectId and subscriptionProductId are required')
  }

  const ctx = await getPlayStoreHelper(request, projectId)
  if ('error' in ctx && !ctx.helper) return unauthorizedResponse(ctx.error)
  const { helper } = ctx as any

  try {
    await helper.activateBasePlan(subscriptionProductId, basePlanId)
    return NextResponse.json({ success: true })
  } catch (error: any) {
    return errorResponse(error.message || 'Failed to activate base plan', 500)
  }
}
