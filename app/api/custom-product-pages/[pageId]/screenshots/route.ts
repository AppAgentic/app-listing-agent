import { NextRequest } from 'next/server'
import { authenticateRequest, errorResponse, unauthorizedResponse } from '@/lib/api/auth'
import { getProjectContext, getAccountContext, AccountContext } from '@/lib/org/context'
import { getMutableProjectContext } from '@/lib/org/project-authorization'
import { getSession } from '@/lib/auth/session'
import { adminDb } from '@/lib/firebase/admin'
import { Timestamp } from 'firebase-admin/firestore'
import type { CPPLocalization, CPPScreenshotReference } from '@/lib/firebase/firestore'

const VALID_DISPLAY_TYPES = new Set([
  'APP_IPHONE_69',
  'APP_IPHONE_67',
  'APP_IPHONE_65',
  'APP_IPHONE_63',
  'APP_IPHONE_61',
  'APP_IPHONE_55',
  'APP_IPAD_PRO_13',
  'APP_IPAD_PRO_129',
  'APP_IPAD_PRO_11',
  'APP_IPAD_PRO_3GEN_129',
  'APP_IPAD_PRO_3GEN_11',
])

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

// POST /api/custom-product-pages/[pageId]/screenshots — Upload screenshot reference
export async function POST(request: NextRequest, { params }: { params: Promise<{ pageId: string }> }) {
  const { context: authContext, error: authError } = await getAuthContext(request)
  if (!authContext) return unauthorizedResponse(authError)

  const { pageId } = await params
  let body: any
  try { body = await request.json() } catch { return errorResponse('Invalid request body') }

  const { projectId, locale, displayType, imageUrl, imageKey, fileName, fileSize } = body
  if (!projectId || !locale || !displayType || !imageUrl || !fileName) {
    return errorResponse('projectId, locale, displayType, imageUrl, and fileName are required')
  }
  if (!VALID_DISPLAY_TYPES.has(displayType)) {
    return errorResponse(`Unsupported CPP screenshot display type: ${displayType}`)
  }

  const projectContext = await getMutableProjectContext(authContext.userId, projectId)
  if (!projectContext) return errorResponse('Project not found', 404)

  try {
    const basePath = getBasePath(projectContext, authContext.userId, projectId)
    const locRef = basePath.collection('customProductPages').doc(pageId).collection('localizations').doc(locale)
    const locDoc = await locRef.get()
    if (!locDoc.exists) return errorResponse('Localization not found', 404)

    const locData = locDoc.data() as CPPLocalization
    const existing = locData.screenshots || []
    const newScreenshot: CPPScreenshotReference = {
      id: `cpp_ss_${Date.now()}_${Math.random().toString(36).substring(7)}`,
      position: existing.length,
      displayType,
      imageUrl,
      imageKey: imageKey || imageUrl,
      fileName,
      fileSize: fileSize || 0,
    }

    await locRef.update({ screenshots: [...existing, newScreenshot] })

    const pageRef = basePath.collection('customProductPages').doc(pageId)
    const pageDoc = await pageRef.get()
    if (pageDoc.exists && pageDoc.data()?.syncStatus === 'synced') {
      await pageRef.update({ syncStatus: 'local_changes', updatedAt: Timestamp.now() })
    }

    return Response.json({ success: true, screenshot: newScreenshot })
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : 'Failed to upload screenshot', 500)
  }
}

// DELETE /api/custom-product-pages/[pageId]/screenshots
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ pageId: string }> }) {
  const { context: authContext, error: authError } = await getAuthContext(request)
  if (!authContext) return unauthorizedResponse(authError)

  const { pageId } = await params
  let body: any
  try { body = await request.json() } catch { return errorResponse('Invalid request body') }

  const { projectId, locale, screenshotId } = body
  if (!projectId || !locale || !screenshotId) {
    return errorResponse('projectId, locale, and screenshotId are required')
  }

  const projectContext = await getMutableProjectContext(authContext.userId, projectId)
  if (!projectContext) return errorResponse('Project not found', 404)

  try {
    const basePath = getBasePath(projectContext, authContext.userId, projectId)
    const locRef = basePath.collection('customProductPages').doc(pageId).collection('localizations').doc(locale)
    const locDoc = await locRef.get()
    if (!locDoc.exists) return errorResponse('Localization not found', 404)

    const locData = locDoc.data() as CPPLocalization
    const updated = (locData.screenshots || [])
      .filter(s => s.id !== screenshotId)
      .map((s, i) => ({ ...s, position: i }))

    await locRef.update({ screenshots: updated })

    const pageRef = basePath.collection('customProductPages').doc(pageId)
    const pageDoc = await pageRef.get()
    if (pageDoc.exists && pageDoc.data()?.syncStatus === 'synced') {
      await pageRef.update({ syncStatus: 'local_changes', updatedAt: Timestamp.now() })
    }

    return Response.json({ success: true })
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : 'Failed to delete screenshot', 500)
  }
}
