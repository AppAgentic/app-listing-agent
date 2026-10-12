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

// GET /api/custom-product-pages/[pageId]?projectId=xxx
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
    const doc = await basePath.collection('customProductPages').doc(pageId).get()
    if (!doc.exists) return errorResponse('Custom product page not found', 404)

    const locSnap = await doc.ref.collection('localizations').get()
    const localizations = locSnap.docs.map(d => ({ locale: d.id, ...d.data() }))

    const versSnap = await doc.ref.collection('versions').get()
    const versions = versSnap.docs.map(d => ({ id: d.id, ...d.data() }))

    return Response.json({ page: { id: doc.id, ...doc.data(), localizations, versions } })
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : 'Failed to get custom product page', 500)
  }
}

// PATCH /api/custom-product-pages/[pageId]
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ pageId: string }> }) {
  const { context: authContext, error: authError } = await getAuthContext(request)
  if (!authContext) return unauthorizedResponse(authError)

  const { pageId } = await params
  let body: any
  try { body = await request.json() } catch { return errorResponse('Invalid request body') }

  const { projectId, name } = body
  if (!projectId) return errorResponse('projectId is required')
  if (name && name.length > 64) return errorResponse('Name must be 64 characters or less')

  const projectContext = await getMutableProjectContext(authContext.userId, projectId)
  if (!projectContext) return errorResponse('Project not found', 404)

  try {
    const basePath = getBasePath(projectContext, authContext.userId, projectId)
    const ref = basePath.collection('customProductPages').doc(pageId)
    const doc = await ref.get()
    if (!doc.exists) return errorResponse('Custom product page not found', 404)

    const updates: any = { updatedAt: Timestamp.now() }
    if (name) updates.name = name
    if (doc.data()?.syncStatus === 'synced') updates.syncStatus = 'local_changes'

    await ref.update(updates)
    return Response.json({ success: true })
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : 'Failed to update', 500)
  }
}

// DELETE /api/custom-product-pages/[pageId]
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ pageId: string }> }) {
  const { context: authContext, error: authError } = await getAuthContext(request)
  if (!authContext) return unauthorizedResponse(authError)

  const { pageId } = await params
  const urlProjectId = new URL(request.url).searchParams.get('projectId')
  let bodyProjectId: string | null = null
  try {
    const body = await request.json()
    bodyProjectId = body?.projectId || null
  } catch {
    // DELETE callers may provide projectId in the query string instead.
  }
  const projectId = urlProjectId || bodyProjectId
  if (!projectId) return errorResponse('projectId is required')

  const projectContext = await getMutableProjectContext(authContext.userId, projectId)
  if (!projectContext) return errorResponse('Project not found', 404)

  try {
    const basePath = getBasePath(projectContext, authContext.userId, projectId)
    const ref = basePath.collection('customProductPages').doc(pageId)
    const doc = await ref.get()
    if (!doc.exists) return errorResponse('Custom product page not found', 404)

    const locSnap = await ref.collection('localizations').get()
    const versSnap = await ref.collection('versions').get()
    const batch = adminDb.batch()
    for (const d of locSnap.docs) batch.delete(d.ref)
    for (const d of versSnap.docs) batch.delete(d.ref)
    batch.delete(ref)
    await batch.commit()

    return Response.json({ success: true })
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : 'Failed to delete', 500)
  }
}
