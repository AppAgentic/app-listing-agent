import { NextRequest } from 'next/server'
import { authenticateRequest, errorResponse, unauthorizedResponse } from '@/lib/api/auth'
import { getProjectContext, getAccountContext, AccountContext } from '@/lib/org/context'
import { getSession } from '@/lib/auth/session'
import { adminDb } from '@/lib/firebase/admin'
import type { Subscription, SubscriptionGroup } from '@/lib/firebase/firestore'

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

// GET /api/subscriptions?projectId=xxx&groupId=xxx - List subscriptions
export async function GET(request: NextRequest) {
  const { context: authContext, error: authError } = await getAuthContext(request)
  if (!authContext) {
    return unauthorizedResponse(authError)
  }

  const { searchParams } = new URL(request.url)
  const projectId = searchParams.get('projectId')
  const groupId = searchParams.get('groupId')

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

    // If groupId specified, get subscriptions for that group only
    if (groupId) {
      const groupDoc = await basePath.collection('subscriptionGroups').doc(groupId).get()
      if (!groupDoc.exists) {
        return errorResponse('Subscription group not found', 404)
      }

      const subscriptionsSnapshot = await groupDoc.ref.collection('subscriptions').orderBy('groupLevel', 'asc').get()
      const subscriptions = subscriptionsSnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
      })) as Subscription[]

      return Response.json({
        group: { id: groupDoc.id, ...groupDoc.data() } as SubscriptionGroup,
        subscriptions,
      })
    }

    // Otherwise, get all subscriptions across all groups
    const groupsSnapshot = await basePath.collection('subscriptionGroups').get()
    const allSubscriptions: Array<Subscription & { groupReferenceName: string }> = []

    for (const groupDoc of groupsSnapshot.docs) {
      const group = groupDoc.data() as SubscriptionGroup
      const subscriptionsSnapshot = await groupDoc.ref.collection('subscriptions').orderBy('groupLevel', 'asc').get()

      for (const subDoc of subscriptionsSnapshot.docs) {
        allSubscriptions.push({
          id: subDoc.id,
          ...subDoc.data(),
          groupReferenceName: group.referenceName,
        } as Subscription & { groupReferenceName: string })
      }
    }

    return Response.json({ subscriptions: allSubscriptions })
  } catch (error) {
    console.error('Error listing subscriptions:', error)
    return errorResponse(error instanceof Error ? error.message : 'Failed to list subscriptions', 500)
  }
}
