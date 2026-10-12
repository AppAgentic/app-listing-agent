import { NextRequest } from 'next/server'
import { z } from 'zod'
import { authenticateRequest, errorResponse, unauthorizedResponse } from '@/lib/api/auth'
import { getProjectContext, hasContextPermission, getAccountContext, AccountContext } from '@/lib/org/context'
import { getSession } from '@/lib/auth/session'
import { adminDb } from '@/lib/firebase/admin'

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
      return { doc: subDoc, ref: subDoc.ref, groupRef: groupDoc.ref }
    }
  }

  return null
}

// DELETE /api/subscriptions/[subId] - Delete a subscription
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

    // Check if subscription exists in App Store Connect
    const subData = subscription.doc.data()
    if (subData?.appStoreId) {
      return errorResponse('Cannot delete subscription that exists in App Store Connect. Remove it from App Store first.', 400)
    }

    // Delete subcollections first (localizations, config)
    const localizationsSnapshot = await subscription.ref.collection('localizations').get()
    const configSnapshot = await subscription.ref.collection('config').get()

    const batch = adminDb.batch()

    localizationsSnapshot.docs.forEach(doc => {
      batch.delete(doc.ref)
    })

    configSnapshot.docs.forEach(doc => {
      batch.delete(doc.ref)
    })

    // Delete the subscription document
    batch.delete(subscription.ref)

    await batch.commit()

    return Response.json({
      success: true,
      message: 'Subscription deleted successfully',
    })
  } catch (error) {
    console.error('Error deleting subscription:', error)
    return errorResponse(error instanceof Error ? error.message : 'Failed to delete subscription', 500)
  }
}
