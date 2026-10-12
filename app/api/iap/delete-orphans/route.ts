import { NextRequest } from 'next/server'
import { z } from 'zod'
import { authenticateRequest, errorResponse, unauthorizedResponse } from '@/lib/api/auth'
import { getProjectContext, hasContextPermission, getAccountContext, AccountContext } from '@/lib/org/context'
import { getSession } from '@/lib/auth/session'
import { adminDb } from '@/lib/firebase/admin'

const deleteOrphansSchema = z.object({
  projectId: z.string(),
  orphans: z.array(z.object({
    id: z.string(),
    type: z.enum(['iap', 'subscription']),
    groupId: z.string().optional(),
  })),
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

export async function POST(request: NextRequest) {
  const { context: authContext, error: authError } = await getAuthContext(request)
  if (!authContext) {
    return unauthorizedResponse(authError)
  }

  let body
  try {
    body = deleteOrphansSchema.parse(await request.json())
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(`Validation error: ${error.errors.map(e => e.message).join(', ')}`)
    }
    return errorResponse('Invalid request body')
  }

  const { projectId, orphans } = body

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

    const batch = adminDb.batch()
    let deletedCount = 0

    for (const orphan of orphans) {
      if (orphan.type === 'iap') {
        // Delete IAP and its subcollections
        const iapRef = basePath.collection('inAppPurchases').doc(orphan.id)

        // Delete localizations subcollection
        const localizations = await iapRef.collection('localizations').get()
        for (const doc of localizations.docs) {
          batch.delete(doc.ref)
        }

        // Delete config subcollection (screenshots, etc.)
        const configs = await iapRef.collection('config').get()
        for (const doc of configs.docs) {
          batch.delete(doc.ref)
        }

        // Delete the IAP document
        batch.delete(iapRef)
        deletedCount++
      } else if (orphan.type === 'subscription' && orphan.groupId) {
        // Delete subscription and its subcollections
        const subRef = basePath.collection('subscriptionGroups').doc(orphan.groupId)
          .collection('subscriptions').doc(orphan.id)

        // Delete localizations subcollection
        const localizations = await subRef.collection('localizations').get()
        for (const doc of localizations.docs) {
          batch.delete(doc.ref)
        }

        // Delete config subcollection
        const configs = await subRef.collection('config').get()
        for (const doc of configs.docs) {
          batch.delete(doc.ref)
        }

        // Delete intro offers subcollection
        const introOffers = await subRef.collection('introOffers').get()
        for (const doc of introOffers.docs) {
          batch.delete(doc.ref)
        }

        // Delete the subscription document
        batch.delete(subRef)
        deletedCount++
      }
    }

    await batch.commit()

    return Response.json({
      success: true,
      deletedCount,
    })
  } catch (error) {
    console.error('Error deleting orphaned products:', error)
    return errorResponse(error instanceof Error ? error.message : 'Failed to delete orphaned products', 500)
  }
}
