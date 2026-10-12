import { NextRequest } from 'next/server'
import { authenticateRequest, errorResponse, unauthorizedResponse } from '@/lib/api/auth'
import { getProjectContext, getAccountContext, AccountContext } from '@/lib/org/context'
import { getSession } from '@/lib/auth/session'
import { adminDb } from '@/lib/firebase/admin'
import type { ScreenshotSet, LocalizedScreenshot } from '@/lib/firebase/firestore'

// Helper to get auth context from either API key or session
async function getAuthContext(request: NextRequest): Promise<{ context: AccountContext | null; error?: string }> {
  // First try API key / header-based auth
  const authHeader = request.headers.get('Authorization')
  if (authHeader) {
    const auth = await authenticateRequest(request)
    if (auth.authenticated && auth.context) {
      return { context: auth.context }
    }
    return { context: null, error: auth.error }
  }

  // Fallback to session-based auth (cookie-based)
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

export async function GET(request: NextRequest) {
  // Authenticate (supports both API key and session)
  const { context, error } = await getAuthContext(request)
  if (!context) {
    return unauthorizedResponse(error)
  }

  // Get projectId from query params
  const { searchParams } = new URL(request.url)
  const projectId = searchParams.get('projectId')

  if (!projectId) {
    return errorResponse('projectId is required')
  }

  // Get project context
  const projectContext = await getProjectContext(context.userId, projectId)
  if (!projectContext) {
    return errorResponse('Project not found', 404)
  }

  // Get base path for this project
  const basePath = projectContext.type === 'organization' && projectContext.orgId
    ? adminDb
        .collection('organizations')
        .doc(projectContext.orgId)
        .collection('projects')
        .doc(projectId)
    : adminDb
        .collection('users')
        .doc(context.userId)
        .collection('projects')
        .doc(projectId)

  // Get project data
  const projectDoc = await basePath.get()
  if (!projectDoc.exists) {
    return errorResponse('Project not found', 404)
  }

  const projectData = projectDoc.data()!

  // Get all screenshot sets
  const screenshotsSnapshot = await basePath.collection('screenshots').get()
  const screenshotSets: { [displayType: string]: ScreenshotSet } = {}

  for (const doc of screenshotsSnapshot.docs) {
    screenshotSets[doc.id] = doc.data() as ScreenshotSet
  }

  // Get localized screenshots
  const localizedSnapshot = await basePath.collection('localizedScreenshots').get()
  const localizedScreenshots: { [key: string]: LocalizedScreenshot } = {}

  for (const doc of localizedSnapshot.docs) {
    // Key format: {displayType}_{screenshotId}_{locale}
    localizedScreenshots[doc.id] = doc.data() as LocalizedScreenshot
  }

  // Get screenshot sync status from project
  const screenshotSyncStatus = projectData.screenshotSyncStatus || 'never_synced'
  const lastScreenshotPulledAt = projectData.lastScreenshotPulledAt || null
  const lastScreenshotPushedAt = projectData.lastScreenshotPushedAt || null

  return Response.json({
    success: true,
    project: {
      id: projectId,
      name: projectData.name,
      storeType: projectData.storeType || (projectData.appStoreAppId ? 'ios' : 'android'),
      appStoreAppId: projectData.appStoreAppId,
      primaryLocale: projectData.primaryLocale || 'en-US',
      enabledLocales: projectData.enabledLocales || [],
      screenshotSyncStatus,
      lastScreenshotPulledAt,
      lastScreenshotPushedAt,
      linkedProjectId: projectData.linkedProjectId || null,
    },
    screenshotSets,
    localizedScreenshots,
    displayTypes: Object.keys(screenshotSets),
  })
}
