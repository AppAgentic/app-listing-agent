import { NextRequest } from 'next/server'
import { z } from 'zod'
import { authenticateRequest, errorResponse, unauthorizedResponse } from '@/lib/api/auth'
import { getProjectContext, hasContextPermission, getAccountContext, AccountContext } from '@/lib/org/context'
import { getSession } from '@/lib/auth/session'
import { adminDb } from '@/lib/firebase/admin'
import { Timestamp } from 'firebase-admin/firestore'

const setIntroOfferSchema = z.object({
  projectId: z.string(),
  offerMode: z.enum(['PAY_AS_YOU_GO', 'PAY_UP_FRONT', 'FREE_TRIAL']),
  duration: z.enum([
    'THREE_DAYS', 'ONE_WEEK', 'TWO_WEEKS', 'ONE_MONTH',
    'TWO_MONTHS', 'THREE_MONTHS', 'SIX_MONTHS', 'ONE_YEAR'
  ]),
  numberOfPeriods: z.number().int().min(1).max(12),
  territories: z.array(z.string()).min(1).default(['ALL']),
  startDate: z.string(), // Required - YYYY-MM-DD
  endDate: z.string().nullable().optional(), // Optional - null means no end date
  subscriptionPricePointId: z.string().optional(), // For paid offers
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

// Helper to find subscription document
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

// GET /api/subscriptions/[subId]/intro-offer - Get intro offer for a subscription
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

    // Get intro offer config
    const introOfferDoc = await subscription.ref.collection('config').doc('introOffer').get()

    return Response.json({
      introOffer: introOfferDoc.exists ? introOfferDoc.data() : null,
    })
  } catch (error) {
    console.error('Error fetching intro offer:', error)
    return errorResponse(error instanceof Error ? error.message : 'Failed to fetch intro offer', 500)
  }
}

// POST /api/subscriptions/[subId]/intro-offer - Set/update intro offer
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
    body = setIntroOfferSchema.parse(await request.json())
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(`Validation error: ${error.errors.map(e => e.message).join(', ')}`)
    }
    return errorResponse('Invalid request body')
  }

  const { projectId, offerMode, duration, numberOfPeriods, territories, startDate, endDate, subscriptionPricePointId } = body

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

    // Set intro offer
    const introOfferData = {
      offerMode,
      duration,
      numberOfPeriods,
      territories,
      startDate,
      endDate,
      subscriptionPricePointId: subscriptionPricePointId || null,
      appStoreId: null,
      updatedAt: Timestamp.now(),
    }

    await subscription.ref.collection('config').doc('introOffer').set(introOfferData, { merge: true })

    // Mark subscription as having local changes
    await subscription.ref.update({
      syncStatus: 'local_changes',
    })

    return Response.json({
      success: true,
      introOffer: introOfferData,
    })
  } catch (error) {
    console.error('Error setting intro offer:', error)
    return errorResponse(error instanceof Error ? error.message : 'Failed to set intro offer', 500)
  }
}

// DELETE /api/subscriptions/[subId]/intro-offer - Remove intro offer
export async function DELETE(
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

    // Delete intro offer
    await subscription.ref.collection('config').doc('introOffer').delete()

    // Mark subscription as having local changes
    await subscription.ref.update({
      syncStatus: 'local_changes',
    })

    return Response.json({ success: true })
  } catch (error) {
    console.error('Error deleting intro offer:', error)
    return errorResponse(error instanceof Error ? error.message : 'Failed to delete intro offer', 500)
  }
}
