import { NextRequest } from 'next/server'
import { authenticateRequest, errorResponse, unauthorizedResponse } from '@/lib/api/auth'
import { getProjectContext, hasContextPermission, getAccountContext, AccountContext } from '@/lib/org/context'
import { getSession } from '@/lib/auth/session'
import { adminDb } from '@/lib/firebase/admin'
import type { InAppPurchase } from '@/lib/firebase/firestore'

// Helper to get auth context
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

// GET /api/iap?projectId=xxx - List all IAPs for a project
export async function GET(request: NextRequest) {
  const { context: authContext, error: authError } = await getAuthContext(request)
  if (!authContext) {
    return unauthorizedResponse(authError)
  }

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
    // Get base path for this project
    const basePath = projectContext.type === 'organization' && projectContext.orgId
      ? adminDb.collection('organizations').doc(projectContext.orgId).collection('projects').doc(projectId)
      : adminDb.collection('users').doc(authContext.userId).collection('projects').doc(projectId)

    // Get all IAPs
    const iapsSnapshot = await basePath.collection('inAppPurchases').orderBy('createdAt', 'desc').get()
    const iaps: InAppPurchase[] = iapsSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    } as InAppPurchase))

    // Get subscription groups
    const groupsSnapshot = await basePath.collection('subscriptionGroups').get()
    const groups = await Promise.all(groupsSnapshot.docs.map(async groupDoc => {
      const subscriptionsSnapshot = await groupDoc.ref.collection('subscriptions').orderBy('groupLevel', 'asc').get()
      return {
        id: groupDoc.id,
        ...groupDoc.data(),
        subscriptions: subscriptionsSnapshot.docs.map(subDoc => ({
          id: subDoc.id,
          ...subDoc.data()
        }))
      }
    }))

    return Response.json({
      iaps,
      subscriptionGroups: groups,
    })
  } catch (error) {
    console.error('Error listing IAPs:', error)
    return errorResponse(error instanceof Error ? error.message : 'Failed to list IAPs', 500)
  }
}
