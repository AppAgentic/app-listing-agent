import { NextRequest, NextResponse } from 'next/server'
import { getPlayStoreHelper, errorResponse } from '../../_helpers'

// POST /api/playstore-iap/pricing/convert — Preview regional prices
export async function POST(request: NextRequest) {
  const body = await request.json()
  const { projectId, basePriceUsd } = body
  if (!projectId) return errorResponse('projectId is required')
  if (!basePriceUsd || typeof basePriceUsd !== 'number' || basePriceUsd <= 0) {
    return errorResponse('basePriceUsd must be a positive number')
  }

  const ctx = await getPlayStoreHelper(request, projectId)
  if ('error' in ctx && !ctx.helper) return errorResponse(ctx.error || 'Auth failed')
  const { helper } = ctx as any

  try {
    const converted = await helper.convertRegionPrices(basePriceUsd)
    return NextResponse.json({ success: true, basePriceUsd, regionalPrices: converted })
  } catch (error: any) {
    return errorResponse(error.message || 'Failed to convert regional prices', 500)
  }
}
