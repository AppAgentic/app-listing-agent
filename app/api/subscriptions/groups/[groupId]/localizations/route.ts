import { readBoundedJson, RequestBodyLimitError } from '@/lib/api/bounded-body'
import { NextRequest } from 'next/server'
import { z } from 'zod'
import { authenticateRequest, errorResponse, unauthorizedResponse } from '@/lib/api/auth'
import { getProjectContext, hasContextPermission, getAccountContext, AccountContext } from '@/lib/org/context'
import { getSession } from '@/lib/auth/session'
import { adminDb } from '@/lib/firebase/admin'
import { Timestamp } from 'firebase-admin/firestore'
import { getAppStoreHelper } from '@/lib/services/credentials'

const setLocalizationSchema = z.object({
  projectId: z.string(),
  locale: z.string(),
  name: z.string().min(1).max(30),
  customAppName: z.string().max(30).nullable().optional(),
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

// GET /api/subscriptions/groups/[groupId]/localizations?projectId=xxx
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ groupId: string }> }
) {
  const { groupId } = await params
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

    // Get local localizations
    const groupRef = basePath.collection('subscriptionGroups').doc(groupId)
    const groupDoc = await groupRef.get()

    if (!groupDoc.exists) {
      return errorResponse('Subscription group not found', 404)
    }

    const localizationsSnapshot = await groupRef.collection('localizations').get()
    const localizations = localizationsSnapshot.docs.map(doc => ({
      locale: doc.id,
      ...doc.data(),
    }))

    return Response.json({ localizations })
  } catch (error) {
    console.error('Error getting group localizations:', error)
    return errorResponse(error instanceof Error ? error.message : 'Failed to get localizations', 500)
  }
}

// POST /api/subscriptions/groups/[groupId]/localizations - Set localization
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ groupId: string }> }
) {
  const { groupId } = await params
  const { context: authContext, error: authError } = await getAuthContext(request)
  if (!authContext) {
    return unauthorizedResponse(authError)
  }

  let body
  try {
    body = setLocalizationSchema.parse(await readBoundedJson(request))
  } catch (error) {
    if (error instanceof RequestBodyLimitError) return Response.json({ error: error.message }, { status: 413 })
    if (error instanceof z.ZodError) {
      return errorResponse(`Validation error: ${error.issues.map(e => e.message).join(', ')}`)
    }
    return errorResponse('Invalid request body')
  }

  const { projectId, locale, name, customAppName, pushToStore } = body

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

    const groupRef = basePath.collection('subscriptionGroups').doc(groupId)
    const groupDoc = await groupRef.get()

    if (!groupDoc.exists) {
      return errorResponse('Subscription group not found', 404)
    }

    const groupData = groupDoc.data()
    const now = Timestamp.now()

    // Save locally
    const locRef = groupRef.collection('localizations').doc(locale)
    await locRef.set({
      locale,
      name,
      customAppName: customAppName || null,
      updatedAt: now,
    }, { merge: true })

    // Push to App Store if requested and group is synced
    if (pushToStore && groupData?.appStoreId) {
      const appStoreHelper = await getAppStoreHelper(authContext.userId, projectId, projectContext.orgId)
      await appStoreHelper.setSubscriptionGroupLocalization(groupData.appStoreId, locale, {
        name,
        customAppName,
      })
    }

    // Mark group as modified if not pushing to store immediately
    if (!pushToStore) {
      // If group has appStoreId, mark as local_changes; otherwise mark as pending_creation
      const newSyncStatus = groupData?.appStoreId ? 'local_changes' : 'pending_creation'
      await groupRef.update({
        syncStatus: newSyncStatus,
        updatedAt: now,
      })
    }

    return Response.json({
      success: true,
      localization: {
        locale,
        name,
        customAppName: customAppName || null,
      },
    })
  } catch (error) {
    console.error('Error setting group localization:', error)
    return errorResponse(error instanceof Error ? error.message : 'Failed to set localization', 500)
  }
}
