import { NextRequest } from 'next/server'
import { z } from 'zod'
import { authenticateRequest, errorResponse, unauthorizedResponse } from '@/lib/api/auth'
import { getProjectContext, hasContextPermission, getAccountContext, AccountContext } from '@/lib/org/context'
import { getSession } from '@/lib/auth/session'
import { adminDb } from '@/lib/firebase/admin'
import { Timestamp } from 'firebase-admin/firestore'
import { getAppStoreHelper } from '@/lib/services/credentials'
import type { SubscriptionGroup, IAPSyncStatus } from '@/lib/firebase/firestore'

const createGroupSchema = z.object({
  projectId: z.string(),
  referenceName: z.string().min(1).max(100),
  pushToStore: z.boolean().optional().default(false),
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

// GET /api/subscriptions/groups?projectId=xxx - List subscription groups
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
    const basePath = projectContext.type === 'organization' && projectContext.orgId
      ? adminDb.collection('organizations').doc(projectContext.orgId).collection('projects').doc(projectId)
      : adminDb.collection('users').doc(authContext.userId).collection('projects').doc(projectId)

    const groupsSnapshot = await basePath.collection('subscriptionGroups').orderBy('createdAt', 'desc').get()

    const groups = await Promise.all(groupsSnapshot.docs.map(async groupDoc => {
      const subscriptionsSnapshot = await groupDoc.ref.collection('subscriptions').orderBy('groupLevel', 'asc').get()
      return {
        id: groupDoc.id,
        ...groupDoc.data(),
        subscriptions: subscriptionsSnapshot.docs.map(subDoc => ({
          id: subDoc.id,
          ...subDoc.data(),
        })),
      }
    }))

    return Response.json({ groups })
  } catch (error) {
    console.error('Error listing subscription groups:', error)
    return errorResponse(error instanceof Error ? error.message : 'Failed to list groups', 500)
  }
}

// POST /api/subscriptions/groups - Create subscription group
export async function POST(request: NextRequest) {
  const { context: authContext, error: authError } = await getAuthContext(request)
  if (!authContext) {
    return unauthorizedResponse(authError)
  }

  let body
  try {
    body = createGroupSchema.parse(await request.json())
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(`Validation error: ${error.errors.map(e => e.message).join(', ')}`)
    }
    return errorResponse('Invalid request body')
  }

  const { projectId, referenceName, pushToStore } = body

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

    const now = Timestamp.now()
    const groupRef = basePath.collection('subscriptionGroups').doc()

    let appStoreId: string | null = null
    let syncStatus: IAPSyncStatus = 'pending_creation'

    // Create in App Store if requested
    if (pushToStore) {
      const appStoreHelper = await getAppStoreHelper(authContext.userId, projectId, projectContext.orgId)
      const created = await appStoreHelper.createSubscriptionGroup(referenceName)
      appStoreId = created.id
      syncStatus = 'synced'
    }

    const group: SubscriptionGroup = {
      id: groupRef.id,
      appStoreId,
      referenceName,
      syncStatus,
      createdAt: now,
      updatedAt: now,
    }

    await groupRef.set(group)

    return Response.json({
      success: true,
      group,
    })
  } catch (error) {
    console.error('Error creating subscription group:', error)
    return errorResponse(error instanceof Error ? error.message : 'Failed to create group', 500)
  }
}
