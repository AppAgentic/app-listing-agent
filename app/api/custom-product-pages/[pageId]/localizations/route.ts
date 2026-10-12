import { NextRequest } from 'next/server'
import { authenticateRequest, errorResponse, unauthorizedResponse } from '@/lib/api/auth'
import { getProjectContext, getAccountContext, AccountContext } from '@/lib/org/context'
import { getMutableProjectContext } from '@/lib/org/project-authorization'
import { getSession } from '@/lib/auth/session'
import { adminDb } from '@/lib/firebase/admin'
import { Timestamp } from 'firebase-admin/firestore'

async function getAuthContext(request: NextRequest): Promise<{ context: AccountContext | null; error?: string }> {
  const authHeader = request.headers.get('Authorization')
  if (authHeader) {
    const auth = await authenticateRequest(request)
    if (auth.authenticated && auth.context) return { context: auth.context }
    return { context: null, error: auth.error }
  }
  const session = await getSession()
  if (session) {
    const context = await getAccountContext(session.userId)
    if (context) return { context }
    return { context: null, error: 'User not found' }
  }
  return { context: null, error: 'Authentication required' }
}

function getBasePath(projectContext: any, userId: string, projectId: string) {
  return projectContext.type === 'organization' && projectContext.orgId
    ? adminDb.collection('organizations').doc(projectContext.orgId).collection('projects').doc(projectId)
    : adminDb.collection('users').doc(userId).collection('projects').doc(projectId)
}

// GET /api/custom-product-pages/[pageId]/localizations?projectId=xxx
export async function GET(request: NextRequest, { params }: { params: Promise<{ pageId: string }> }) {
  const { context: authContext, error: authError } = await getAuthContext(request)
  if (!authContext) return unauthorizedResponse(authError)

  const { pageId } = await params
  const projectId = new URL(request.url).searchParams.get('projectId')
  if (!projectId) return errorResponse('projectId is required')

  const projectContext = await getProjectContext(authContext.userId, projectId)
  if (!projectContext) return errorResponse('Project not found', 404)

  try {
    const basePath = getBasePath(projectContext, authContext.userId, projectId)
    const locSnap = await basePath.collection('customProductPages').doc(pageId).collection('localizations').get()
    const localizations = locSnap.docs.map(d => ({ locale: d.id, ...d.data() }))
    return Response.json({ localizations })
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : 'Failed to get localizations', 500)
  }
}

// POST /api/custom-product-pages/[pageId]/localizations
export async function POST(request: NextRequest, { params }: { params: Promise<{ pageId: string }> }) {
  const { context: authContext, error: authError } = await getAuthContext(request)
  if (!authContext) return unauthorizedResponse(authError)

  const { pageId } = await params
  let body: any
  try { body = await request.json() } catch { return errorResponse('Invalid request body') }

  const { projectId, locale, promotionalText } = body
  if (!projectId) return errorResponse('projectId is required')
  if (!locale) return errorResponse('locale is required')
  if (promotionalText && promotionalText.length > 170) {
    return errorResponse('Promotional text must be 170 characters or less')
  }

  const projectContext = await getMutableProjectContext(authContext.userId, projectId)
  if (!projectContext) return errorResponse('Project not found', 404)

  try {
    const basePath = getBasePath(projectContext, authContext.userId, projectId)
    const pageRef = basePath.collection('customProductPages').doc(pageId)
    const pageDoc = await pageRef.get()
    if (!pageDoc.exists) return errorResponse('Custom product page not found', 404)

    const locRef = pageRef.collection('localizations').doc(locale)
    await locRef.set({
      locale,
      promotionalText: promotionalText || null,
      screenshots: [],
      appStoreLocalizationId: null,
    })

    if (pageDoc.data()?.syncStatus === 'synced') {
      await pageRef.update({ syncStatus: 'local_changes', updatedAt: Timestamp.now() })
    }

    return Response.json({ success: true })
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : 'Failed to create localization', 500)
  }
}

// PATCH /api/custom-product-pages/[pageId]/localizations
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ pageId: string }> }) {
  const { context: authContext, error: authError } = await getAuthContext(request)
  if (!authContext) return unauthorizedResponse(authError)

  const { pageId } = await params
  let body: any
  try { body = await request.json() } catch { return errorResponse('Invalid request body') }

  const { projectId, locale, promotionalText } = body
  if (!projectId) return errorResponse('projectId is required')
  if (!locale) return errorResponse('locale is required')
  if (promotionalText && promotionalText.length > 170) {
    return errorResponse('Promotional text must be 170 characters or less')
  }

  const projectContext = await getMutableProjectContext(authContext.userId, projectId)
  if (!projectContext) return errorResponse('Project not found', 404)

  try {
    const basePath = getBasePath(projectContext, authContext.userId, projectId)
    const pageRef = basePath.collection('customProductPages').doc(pageId)
    const locRef = pageRef.collection('localizations').doc(locale)
    const locDoc = await locRef.get()
    if (!locDoc.exists) return errorResponse('Localization not found', 404)

    const updates: any = {}
    if (promotionalText !== undefined) updates.promotionalText = promotionalText
    await locRef.update(updates)

    const pageDoc = await pageRef.get()
    if (pageDoc.exists && pageDoc.data()?.syncStatus === 'synced') {
      await pageRef.update({ syncStatus: 'local_changes', updatedAt: Timestamp.now() })
    }

    return Response.json({ success: true })
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : 'Failed to update localization', 500)
  }
}

// DELETE /api/custom-product-pages/[pageId]/localizations
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ pageId: string }> }) {
  const { context: authContext, error: authError } = await getAuthContext(request)
  if (!authContext) return unauthorizedResponse(authError)

  const { pageId } = await params
  let body: any
  try { body = await request.json() } catch { return errorResponse('Invalid request body') }

  const { projectId, locale } = body
  if (!projectId) return errorResponse('projectId is required')
  if (!locale) return errorResponse('locale is required')

  const projectContext = await getMutableProjectContext(authContext.userId, projectId)
  if (!projectContext) return errorResponse('Project not found', 404)

  try {
    const basePath = getBasePath(projectContext, authContext.userId, projectId)
    const pageRef = basePath.collection('customProductPages').doc(pageId)
    const pageDoc = await pageRef.get()
    if (!pageDoc.exists) return errorResponse('Custom product page not found', 404)

    const locRef = pageRef.collection('localizations').doc(locale)
    const locDoc = await locRef.get()
    if (!locDoc.exists) return errorResponse('Localization not found', 404)

    await locRef.delete()
    if (pageDoc.data()?.syncStatus === 'synced') {
      await pageRef.update({ syncStatus: 'local_changes', updatedAt: Timestamp.now() })
    }

    return Response.json({ success: true })
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : 'Failed to delete localization', 500)
  }
}
