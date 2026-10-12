import { NextRequest } from 'next/server'
import { z } from 'zod'
import { authenticateRequest, errorResponse, unauthorizedResponse } from '@/lib/api/auth'
import { getProjectContext, hasContextPermission, getAccountContext, AccountContext } from '@/lib/org/context'
import { getSession } from '@/lib/auth/session'
import { adminDb } from '@/lib/firebase/admin'
import { Timestamp } from 'firebase-admin/firestore'

const createOfferSchema = z.object({
  projectId: z.string(),
  name: z.string().min(1).max(100),
  offerIdentifier: z.string().min(1).max(64).regex(/^[a-zA-Z0-9_]+$/, 'Offer identifier must be alphanumeric with underscores only'),
  offerMode: z.enum(['PAY_AS_YOU_GO', 'PAY_UP_FRONT', 'FREE_TRIAL']),
  duration: z.string(), // e.g., 'ONE_WEEK', 'ONE_MONTH', 'THREE_MONTHS'
  numberOfPeriods: z.number().int().min(1).max(12).default(1),
  pricePointId: z.string().nullable().optional(), // The discounted price point (required for non-free offers)
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

// GET /api/subscriptions/[subId]/offers - List promotional offers for a subscription
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

    // Get all subscription groups and find the subscription
    const groupsSnapshot = await basePath.collection('subscriptionGroups').get()
    let subscriptionDoc = null

    for (const groupDoc of groupsSnapshot.docs) {
      const subDoc = await groupDoc.ref.collection('subscriptions').doc(subId).get()
      if (subDoc.exists) {
        subscriptionDoc = subDoc
        break
      }
    }

    if (!subscriptionDoc || !subscriptionDoc.exists) {
      return errorResponse('Subscription not found', 404)
    }

    // Get promotional offers
    const offersSnapshot = await subscriptionDoc.ref.collection('promotionalOffers').get()
    const offers = offersSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
    }))

    return Response.json({ offers })
  } catch (error) {
    console.error('Error fetching promotional offers:', error)
    return errorResponse(error instanceof Error ? error.message : 'Failed to fetch offers', 500)
  }
}

// POST /api/subscriptions/[subId]/offers - Create a promotional offer
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
    body = createOfferSchema.parse(await request.json())
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(`Validation error: ${error.errors.map(e => e.message).join(', ')}`)
    }
    return errorResponse('Invalid request body')
  }

  const { projectId, name, offerIdentifier, offerMode, duration, numberOfPeriods, pricePointId } = body

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

    // Find the subscription
    const groupsSnapshot = await basePath.collection('subscriptionGroups').get()
    let subscriptionRef = null

    for (const groupDoc of groupsSnapshot.docs) {
      const subDoc = await groupDoc.ref.collection('subscriptions').doc(subId).get()
      if (subDoc.exists) {
        subscriptionRef = subDoc.ref
        break
      }
    }

    if (!subscriptionRef) {
      return errorResponse('Subscription not found', 404)
    }

    // Validate price point for non-free offers
    if (offerMode !== 'FREE_TRIAL' && !pricePointId) {
      return errorResponse('Price point is required for paid offers')
    }

    // Create promotional offer
    const offerData = {
      name,
      offerIdentifier,
      offerMode,
      duration,
      numberOfPeriods: offerMode === 'PAY_AS_YOU_GO' ? numberOfPeriods : 1,
      pricePointId: offerMode === 'FREE_TRIAL' ? null : pricePointId,
      appStoreId: null,
      syncStatus: 'pending_creation',
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    }

    const offerRef = await subscriptionRef.collection('promotionalOffers').add(offerData)

    return Response.json({
      success: true,
      offer: {
        id: offerRef.id,
        ...offerData,
      },
    })
  } catch (error) {
    console.error('Error creating promotional offer:', error)
    return errorResponse(error instanceof Error ? error.message : 'Failed to create offer', 500)
  }
}
