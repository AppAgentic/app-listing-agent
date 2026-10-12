import { NextRequest } from 'next/server'
import { authenticateRequest, errorResponse, unauthorizedResponse } from '@/lib/api/auth'
import { getProjectContext, getAccountContext, AccountContext } from '@/lib/org/context'
import { getMutableProjectContext } from '@/lib/org/project-authorization'
import { getSession } from '@/lib/auth/session'
import { adminDb } from '@/lib/firebase/admin'
import { Timestamp } from 'firebase-admin/firestore'
import type { CustomProductPage, CPPLocalization } from '@/lib/firebase/firestore'

const LOCALE_RE = /^[a-z]{2,3}(-[A-Z]{2})?$/

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

// GET /api/custom-product-pages?projectId=xxx
export async function GET(request: NextRequest) {
  const { context: authContext, error: authError } = await getAuthContext(request)
  if (!authContext) return unauthorizedResponse(authError)

  const projectId = new URL(request.url).searchParams.get('projectId')
  if (!projectId) return errorResponse('projectId is required')

  const projectContext = await getProjectContext(authContext.userId, projectId)
  if (!projectContext) return errorResponse('Project not found', 404)

  try {
    const basePath = getBasePath(projectContext, authContext.userId, projectId)
    const snapshot = await basePath.collection('customProductPages').orderBy('createdAt', 'desc').get()

    const pages = await Promise.all(snapshot.docs.map(async doc => {
      const locSnap = await doc.ref.collection('localizations').get()
      const localizations = locSnap.docs.map(d => ({ locale: d.id, ...d.data() }))
      return { id: doc.id, ...doc.data(), localizations }
    }))

    return Response.json({ pages })
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : 'Failed to list custom product pages', 500)
  }
}

// POST /api/custom-product-pages
export async function POST(request: NextRequest) {
  const { context: authContext, error: authError } = await getAuthContext(request)
  if (!authContext) return unauthorizedResponse(authError)

  let body: any
  try { body = await request.json() } catch { return errorResponse('Invalid request body') }

  const { projectId, name, localizations } = body
  if (!projectId) return errorResponse('projectId is required')
  if (!name) return errorResponse('name is required')
  if (name.length > 64) return errorResponse('Name must be 64 characters or less')
  for (const loc of localizations || []) {
    if (!loc.locale || !LOCALE_RE.test(loc.locale)) {
      return errorResponse(`Invalid locale code: ${loc.locale}`)
    }
    if (loc.promotionalText && loc.promotionalText.length > 170) {
      return errorResponse(`Promotional text for ${loc.locale} must be 170 characters or less`)
    }
  }

  const projectContext = await getMutableProjectContext(authContext.userId, projectId)
  if (!projectContext) return errorResponse('Project not found', 404)

  try {
    const basePath = getBasePath(projectContext, authContext.userId, projectId)
    const now = Timestamp.now()

    const pageData = {
      appStoreId: null,
      name,
      url: null,
      state: null,
      syncStatus: 'pending_creation',
      createdAt: now,
      updatedAt: now,
    }

    const pageRef = basePath.collection('customProductPages').doc()
    const batch = adminDb.batch()
    batch.set(pageRef, pageData)

    if (localizations?.length) {
      for (const loc of localizations) {
        const locRef = pageRef.collection('localizations').doc(loc.locale)
        batch.set(locRef, {
          locale: loc.locale,
          promotionalText: loc.promotionalText || null,
          screenshots: [],
          appStoreLocalizationId: null,
        })
      }
    }

    await batch.commit()
    return Response.json({ success: true, page: { id: pageRef.id, ...pageData } })
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : 'Failed to create custom product page', 500)
  }
}
