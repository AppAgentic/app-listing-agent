import { NextRequest } from 'next/server'
import { z } from 'zod'
import { authenticateRequest, errorResponse, unauthorizedResponse } from '@/lib/api/auth'
import { getProjectContext, hasContextPermission, getAccountContext, AccountContext } from '@/lib/org/context'
import { getSession } from '@/lib/auth/session'
import { adminDb } from '@/lib/firebase/admin'
import type { IAPLocalization } from '@/lib/firebase/firestore'

const saveLocalizationSchema = z.object({
  projectId: z.string(),
  locale: z.string(),
  displayName: z.string().max(30),
  description: z.string().max(45),
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

// GET /api/iap/[iapId]/localizations - List localizations for an IAP
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

    // Check IAP exists
    const iapDoc = await basePath.collection('inAppPurchases').doc(iapId).get()
    if (!iapDoc.exists) {
      return errorResponse('IAP not found', 404)
    }

    // Get localizations
    const localizationsSnapshot = await basePath
      .collection('inAppPurchases')
      .doc(iapId)
      .collection('localizations')
      .get()

    const localizations: IAPLocalization[] = localizationsSnapshot.docs.map(doc => ({
      locale: doc.id,
      displayName: doc.data().displayName || '',
      description: doc.data().description || '',
    }))

    return Response.json({ localizations })
  } catch (error) {
    console.error('Error fetching IAP localizations:', error)
    return errorResponse(error instanceof Error ? error.message : 'Failed to fetch localizations', 500)
  }
}

// POST /api/iap/[iapId]/localizations - Save a localization
export async function POST(
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
    body = saveLocalizationSchema.parse(await request.json())
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(`Validation error: ${error.errors.map(e => e.message).join(', ')}`)
    }
    return errorResponse('Invalid request body')
  }

  const { projectId, locale, displayName, description } = body

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

    // Check IAP exists
    const iapDoc = await basePath.collection('inAppPurchases').doc(iapId).get()
    if (!iapDoc.exists) {
      return errorResponse('IAP not found', 404)
    }

    // Save localization
    await basePath
      .collection('inAppPurchases')
      .doc(iapId)
      .collection('localizations')
      .doc(locale)
      .set({
        locale,
        displayName,
        description,
      }, { merge: true })

    // Mark IAP as having local changes
    await basePath.collection('inAppPurchases').doc(iapId).update({
      syncStatus: 'local_changes',
    })

    return Response.json({
      success: true,
      localization: { locale, displayName, description },
    })
  } catch (error) {
    console.error('Error saving IAP localization:', error)
    return errorResponse(error instanceof Error ? error.message : 'Failed to save localization', 500)
  }
}
