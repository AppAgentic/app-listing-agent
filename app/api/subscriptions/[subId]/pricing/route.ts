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

// Helper to find subscription document across all groups
async function findSubscription(basePath: FirebaseFirestore.DocumentReference, subId: string) {
  const groupsSnapshot = await basePath.collection('subscriptionGroups').get()

  for (const groupDoc of groupsSnapshot.docs) {
    const subDoc = await groupDoc.ref.collection('subscriptions').doc(subId).get()
    if (subDoc.exists) {
      return { doc: subDoc, ref: subDoc.ref }
    }
  }

  return null
}

// GET /api/subscriptions/[subId]/pricing - Get current pricing config for a subscription
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ subId: string }> }
) {
  const { context: authContext, error: authError } = await getAuthContext(request)
  if (!authContext) {
    return unauthorizedResponse(authError)
  }

  const { subId } = await params
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

    const subscription = await findSubscription(basePath, subId)
    if (!subscription) {
      return errorResponse('Subscription not found', 404)
    }

    // Get pricing config if exists
    const pricingDoc = await subscription.ref.collection('config').doc('pricing').get()

    return Response.json({
      pricing: pricingDoc.exists ? pricingDoc.data() : null,
    })
  } catch (error) {
    console.error('Error fetching subscription pricing:', error)
    return errorResponse(error instanceof Error ? error.message : 'Failed to fetch pricing', 500)
  }
}

// POST /api/subscriptions/[subId]/pricing - Set pricing strategy for a subscription
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ subId: string }> }
) {
  const { context: authContext, error: authError } = await getAuthContext(request)
  if (!authContext) {
    return unauthorizedResponse(authError)
  }

  const { subId } = await params

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

    const subscription = await findSubscription(basePath, subId)
    if (!subscription) {
      return errorResponse('Subscription not found', 404)
    }

    // Save pricing config
    const pricingConfig = {
      baseTerritory,
      basePricePointId,
      strategy: strategyId,
      pricingStrategyId: strategyId,
      updatedAt: Timestamp.now(),
    }

    await subscription.ref.collection('config').doc('pricing').set(pricingConfig, { merge: true })

    // Mark subscription as having local changes
    await subscription.ref.update({
      syncStatus: 'local_changes',
    })

    return Response.json({
      success: true,
      pricing: pricingConfig,
    })
  } catch (error) {
    console.error('Error setting subscription pricing:', error)
    return errorResponse(error instanceof Error ? error.message : 'Failed to set pricing', 500)
  }
}
