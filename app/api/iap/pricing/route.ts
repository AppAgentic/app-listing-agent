import { NextRequest } from 'next/server'
import { z } from 'zod'
import { authenticateRequest, errorResponse, unauthorizedResponse } from '@/lib/api/auth'
import { getProjectContext, hasContextPermission, getAccountContext, AccountContext } from '@/lib/org/context'
import { getSession } from '@/lib/auth/session'
import { adminDb } from '@/lib/firebase/admin'
import { IAPPricingCalculator } from '@/lib/services/iap-pricing'
import { getPricingStrategyOptions, PRICING_STRATEGIES } from '@/lib/constants'
import { getAppStoreHelper } from '@/lib/services/credentials'

const previewPricingSchema = z.object({
  projectId: z.string(),
  basePricePointId: z.string(),
  baseTerritory: z.string().default('USA'),
  strategyId: z.string(),
})

async function getAuthContext(request: NextRequest): Promise<{ context: AccountContext | null; error?: string }> {
  const authHeader = request.headers.get('Authorization')
  if (authHeader) {
    const auth = await authenticateRequest(request)
    if (auth.authenticated && auth.context) {
      return { context: auth.context }
    }
    return { context: null, error: auth.error }
  }

  const session = await getSession()
  if (session) {
    const context = await getAccountContext(session.userId)
    if (context) {
      return { context }
    }
    return { context: null, error: 'User not found' }
  }

  return { context: null, error: 'Authentication required' }
}

// GET /api/iap/pricing - Get available pricing strategies
export async function GET(request: NextRequest) {
  const { context: authContext, error: authError } = await getAuthContext(request)
  if (!authContext) {
    return unauthorizedResponse(authError)
  }

  return Response.json({
    strategies: getPricingStrategyOptions(),
    details: PRICING_STRATEGIES,
  })
}

// POST /api/iap/pricing - Preview pricing for a strategy
export async function POST(request: NextRequest) {
  const { context: authContext, error: authError } = await getAuthContext(request)
  if (!authContext) {
    return unauthorizedResponse(authError)
  }

  let body
  try {
    body = previewPricingSchema.parse(await request.json())
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(`Validation error: ${error.errors.map(e => e.message).join(', ')}`)
    }
    return errorResponse('Invalid request body')
  }

  const { projectId, basePricePointId, baseTerritory, strategyId } = body

  const projectContext = await getProjectContext(authContext.userId, projectId)
  if (!projectContext) {
    return errorResponse('Project not found', 404)
  }

  if (!hasContextPermission(projectContext, 'canCreateProjects')) {
    return errorResponse('Permission denied', 403)
  }

  try {
    // Get App Store helper for this project (for price point data)
    const appStoreHelper = await getAppStoreHelper(authContext.userId, projectId, projectContext.orgId)

    const calculator = new IAPPricingCalculator(appStoreHelper)
    const preview = await calculator.previewPricing({
      basePricePointId,
      baseTerritory,
      strategyId,
    })

    return Response.json({
      success: true,
      preview,
    })
  } catch (error) {
    console.error('Error previewing pricing:', error)
    return errorResponse(error instanceof Error ? error.message : 'Failed to preview pricing', 500)
  }
}
