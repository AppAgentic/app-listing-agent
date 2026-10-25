import { readBoundedJson, RequestBodyLimitError } from '@/lib/api/bounded-body'
import { NextRequest } from 'next/server'
import { z } from 'zod'
import { authenticateRequest, errorResponse, unauthorizedResponse } from '@/lib/api/auth'
import { getProjectContext, hasContextPermission, getAccountContext, AccountContext } from '@/lib/org/context'
import { getSession } from '@/lib/auth/session'
import { adminDb } from '@/lib/firebase/admin'
import { Timestamp } from 'firebase-admin/firestore'
import { getAppStoreHelper } from '@/lib/services/credentials'
import type { InAppPurchase, IAPLocalization } from '@/lib/firebase/firestore'

const updateIAPSchema = z.object({
  projectId: z.string(),
  name: z.string().optional(),
  familyShareable: z.boolean().optional(),
  reviewNote: z.string().optional(),
  localizations: z.array(z.object({
    locale: z.string(),
    displayName: z.string().max(30),
    description: z.string().max(45),
  })).optional(),
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

// GET /api/iap/[iapId]?projectId=xxx - Get single IAP with localizations
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

    const iapDoc = await basePath.collection('inAppPurchases').doc(iapId).get()
    if (!iapDoc.exists) {
      return errorResponse('IAP not found', 404)
    }

    const iap = { id: iapDoc.id, ...iapDoc.data() } as InAppPurchase

    // Get localizations
    const locSnapshot = await iapDoc.ref.collection('localizations').get()
    const localizations = locSnapshot.docs.map(doc => ({
      locale: doc.id,
      ...doc.data(),
    })) as IAPLocalization[]

    return Response.json({
      iap,
      localizations,
    })
  } catch (error) {
    console.error('Error getting IAP:', error)
    return errorResponse(error instanceof Error ? error.message : 'Failed to get IAP', 500)
  }
}

// PATCH /api/iap/[iapId] - Update IAP
export async function PATCH(
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
    body = updateIAPSchema.parse(await readBoundedJson(request))
  } catch (error) {
    if (error instanceof RequestBodyLimitError) return Response.json({ error: error.message }, { status: 413 })
    if (error instanceof z.ZodError) {
      return errorResponse(`Validation error: ${error.issues.map(e => e.message).join(', ')}`)
    }
    return errorResponse('Invalid request body')
  }

  const { projectId, name, familyShareable, reviewNote, localizations } = body

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

    const iapRef = basePath.collection('inAppPurchases').doc(iapId)
    const iapDoc = await iapRef.get()

    if (!iapDoc.exists) {
      return errorResponse('IAP not found', 404)
    }

    const currentIAP = iapDoc.data() as InAppPurchase
    const now = Timestamp.now()

    // Build update object
    const updates: Partial<InAppPurchase> = {
      updatedAt: now,
    }

    if (name !== undefined) updates.name = name
    if (familyShareable !== undefined) updates.familyShareable = familyShareable
    if (reviewNote !== undefined) updates.reviewNote = reviewNote

    // Mark as having local changes if already synced
    if (currentIAP.syncStatus === 'synced') {
      updates.syncStatus = 'local_changes'
    }

    await iapRef.update(updates)

    // Update localizations if provided
    if (localizations && localizations.length > 0) {
      const batch = adminDb.batch()
      for (const loc of localizations) {
        const locRef = iapRef.collection('localizations').doc(loc.locale)
        batch.set(locRef, {
          locale: loc.locale,
          displayName: loc.displayName,
          description: loc.description,
        }, { merge: true })
      }
      await batch.commit()
    }

    // Return updated IAP
    const updatedDoc = await iapRef.get()
    const locSnapshot = await iapRef.collection('localizations').get()

    return Response.json({
      success: true,
      iap: { id: updatedDoc.id, ...updatedDoc.data() },
      localizations: locSnapshot.docs.map(doc => ({
        locale: doc.id,
        ...doc.data(),
      })),
    })
  } catch (error) {
    console.error('Error updating IAP:', error)
    return errorResponse(error instanceof Error ? error.message : 'Failed to update IAP', 500)
  }
}

// DELETE /api/iap/[iapId] - Delete IAP
export async function DELETE(
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
  const deleteFromStore = searchParams.get('deleteFromStore') === 'true'

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

    const iapRef = basePath.collection('inAppPurchases').doc(iapId)
    const iapDoc = await iapRef.get()

    if (!iapDoc.exists) {
      return errorResponse('IAP not found', 404)
    }

    const iap = iapDoc.data() as InAppPurchase

    // Delete from App Store if requested and has an App Store ID
    if (deleteFromStore && iap.appStoreId) {
      try {
        const appStoreHelper = await getAppStoreHelper(authContext.userId, projectId, projectContext.orgId)
        await appStoreHelper.deleteInAppPurchase(iap.appStoreId)
      } catch (storeError) {
        console.error('Error deleting from App Store:', storeError)
        // Continue with local deletion even if App Store deletion fails
      }
    }

    // Delete localizations subcollection
    const locSnapshot = await iapRef.collection('localizations').get()
    const batch = adminDb.batch()
    locSnapshot.docs.forEach(doc => batch.delete(doc.ref))
    batch.delete(iapRef)
    await batch.commit()

    return Response.json({
      success: true,
      deleted: iap.productId,
    })
  } catch (error) {
    console.error('Error deleting IAP:', error)
    return errorResponse(error instanceof Error ? error.message : 'Failed to delete IAP', 500)
  }
}
