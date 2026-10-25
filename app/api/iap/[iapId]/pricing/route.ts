import { readBoundedJson, RequestBodyLimitError } from '@/lib/api/bounded-body'
import { NextRequest } from 'next/server'
import { z } from 'zod'
import { authenticateRequest, errorResponse, unauthorizedResponse } from '@/lib/api/auth'
import { getProjectContext, hasContextPermission, getAccountContext, AccountContext } from '@/lib/org/context'
import { getSession } from '@/lib/auth/session'
import { adminDb } from '@/lib/firebase/admin'
import { Timestamp } from 'firebase-admin/firestore'

const setPricingSchema = z.object({
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

// GET /api/iap/[iapId]/pricing - Get current pricing config for an IAP
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ iapId: string }> }
) {
  const { context: authContext, error: authError } = await getAuthContext(request)
  if (!authContext) {
    return unauthorizedResponse(authError)
  }

  const { iapId } = await params
  const { searchParams } = new URL(request.url)
  const projectId = searchParams.get('projectId')

  if (!projectId) {
    return errorResponse('projectId is required')
  }

  const projectContext = await getProjectContext(authContext.userId, projectId)
  if (!projectContext) {
    return errorResponse('Project not found', 404)
  }

  try {
    const basePath = projectContext.type === 'organization' && projectContext.orgId
      ? adminDb.collection('organizations').doc(projectContext.orgId).collection('projects').doc(projectId)
      : adminDb.collection('users').doc(authContext.userId).collection('projects').doc(projectId)

    // Get IAP
    const iapDoc = await basePath.collection('inAppPurchases').doc(iapId).get()
    if (!iapDoc.exists) {
      return errorResponse('IAP not found', 404)
    }

    // Get pricing config if exists
    const pricingDoc = await basePath
      .collection('inAppPurchases')
      .doc(iapId)
      .collection('config')
      .doc('pricing')
      .get()

    return Response.json({
      pricing: pricingDoc.exists ? pricingDoc.data() : null,
    })
  } catch (error) {
    console.error('Error fetching IAP pricing:', error)
    return errorResponse(error instanceof Error ? error.message : 'Failed to fetch pricing', 500)
  }
}

// POST /api/iap/[iapId]/pricing - Set pricing strategy for an IAP
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ iapId: string }> }
) {
  const { context: authContext, error: authError } = await getAuthContext(request)
  if (!authContext) {
    return unauthorizedResponse(authError)
  }

  const { iapId } = await params

  let body
  try {
    body = setPricingSchema.parse(await readBoundedJson(request))
  } catch (error) {
    if (error instanceof RequestBodyLimitError) return Response.json({ error: error.message }, { status: 413 })
    if (error instanceof z.ZodError) {
      return errorResponse(`Validation error: ${error.issues.map(e => e.message).join(', ')}`)
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
    const basePath = projectContext.type === 'organization' && projectContext.orgId
      ? adminDb.collection('organizations').doc(projectContext.orgId).collection('projects').doc(projectId)
      : adminDb.collection('users').doc(authContext.userId).collection('projects').doc(projectId)

    // Check IAP exists
    const iapDoc = await basePath.collection('inAppPurchases').doc(iapId).get()
    if (!iapDoc.exists) {
      return errorResponse('IAP not found', 404)
    }

    // Save pricing config
    const pricingConfig = {
      baseTerritory,
      basePricePointId,
      strategy: strategyId,
      pricingStrategyId: strategyId,
      updatedAt: Timestamp.now(),
    }

    await basePath
      .collection('inAppPurchases')
      .doc(iapId)
      .collection('config')
      .doc('pricing')
      .set(pricingConfig, { merge: true })

    // Mark IAP as having local changes
    await basePath.collection('inAppPurchases').doc(iapId).update({
      syncStatus: 'local_changes',
    })

    return Response.json({
      success: true,
      pricing: pricingConfig,
    })
  } catch (error) {
    console.error('Error setting IAP pricing:', error)
    return errorResponse(error instanceof Error ? error.message : 'Failed to set pricing', 500)
  }
}
