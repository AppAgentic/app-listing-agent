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

// GET /api/custom-store-listings/[listingId]?projectId=xxx
export async function GET(request: NextRequest, { params }: { params: Promise<{ listingId: string }> }) {
  const { context: authContext, error: authError } = await getAuthContext(request)
  if (!authContext) return unauthorizedResponse(authError)

  const { listingId } = await params
  const projectId = new URL(request.url).searchParams.get('projectId')
  if (!projectId) return errorResponse('projectId is required')

  const projectContext = await getProjectContext(authContext.userId, projectId)
  if (!projectContext) return errorResponse('Project not found', 404)

  try {
    const basePath = getBasePath(projectContext, authContext.userId, projectId)
    const doc = await basePath.collection('customStoreListings').doc(listingId).get()
    if (!doc.exists) return errorResponse('Custom store listing not found', 404)

    const locSnap = await doc.ref.collection('localizations').get()
    const localizations = locSnap.docs.map(d => ({ locale: d.id, ...d.data() }))

    return Response.json({ listing: { id: doc.id, ...doc.data(), localizations } })
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : 'Failed to get custom store listing', 500)
  }
}

// PATCH /api/custom-store-listings/[listingId]
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ listingId: string }> }) {
  const { context: authContext, error: authError } = await getAuthContext(request)
  if (!authContext) return unauthorizedResponse(authError)

  const { listingId } = await params
  let body: any
  try { body = await request.json() } catch { return errorResponse('Invalid request body') }

  const { projectId, name, targetingType, targetingCountries } = body
  if (!projectId) return errorResponse('projectId is required')

  const projectContext = await getMutableProjectContext(authContext.userId, projectId)
  if (!projectContext) return errorResponse('Project not found', 404)

  try {
    const basePath = getBasePath(projectContext, authContext.userId, projectId)
    const ref = basePath.collection('customStoreListings').doc(listingId)
    const doc = await ref.get()
    if (!doc.exists) return errorResponse('Custom store listing not found', 404)

    const updates: any = { updatedAt: Timestamp.now() }
    if (name) updates.name = name
    if (targetingType) updates.targetingType = targetingType
    if (targetingCountries) updates.targetingCountries = targetingCountries
    if (doc.data()?.syncStatus === 'synced') updates.syncStatus = 'local_changes'

    await ref.update(updates)
    return Response.json({ success: true })
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : 'Failed to update', 500)
  }
}

// DELETE /api/custom-store-listings/[listingId]
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ listingId: string }> }) {
  const { context: authContext, error: authError } = await getAuthContext(request)
  if (!authContext) return unauthorizedResponse(authError)

  const { listingId } = await params
  const projectId = new URL(request.url).searchParams.get('projectId')
  if (!projectId) return errorResponse('projectId is required')

  const projectContext = await getMutableProjectContext(authContext.userId, projectId)
  if (!projectContext) return errorResponse('Project not found', 404)

  try {
    const basePath = getBasePath(projectContext, authContext.userId, projectId)
    const ref = basePath.collection('customStoreListings').doc(listingId)
    const doc = await ref.get()
    if (!doc.exists) return errorResponse('Custom store listing not found', 404)

    const locSnap = await ref.collection('localizations').get()
    const batch = adminDb.batch()
    for (const d of locSnap.docs) batch.delete(d.ref)
    batch.delete(ref)
    await batch.commit()

    return Response.json({ success: true })
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : 'Failed to delete', 500)
  }
}
