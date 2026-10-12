import { NextRequest } from 'next/server'
import { authenticateRequest, errorResponse, unauthorizedResponse } from '@/lib/api/auth'
import { getSession } from '@/lib/auth/session'
import { getProjectContext, getAccountContext, AccountContext } from '@/lib/org/context'
import { adminDb } from '@/lib/firebase/admin'
import type { MetadataHistoryEntry } from '@/lib/firebase/firestore'
import { hasInternalIntegrationAccess } from '@/lib/features/internal-integrations'

interface RouteParams {
  params: Promise<{ projectId: string }>
}

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

function getSourceDescription(source: string, storeType?: string): string {
  const storeName = storeType === 'android' ? 'Play Store' : 'App Store'
  switch (source) {
    case 'pull':
      return `Pulled from ${storeName}`
    case 'publish':
      return `Published to ${storeName}`
    case 'ai_translation':
      return 'AI translated'
    case 'manual_edit':
      return 'Manually edited'
    case 'rollback':
      return 'Rolled back'
    default:
      return 'Updated'
  }
}

// GET - Get project overview data
export async function GET(request: NextRequest, { params }: RouteParams) {
  const { projectId } = await params

  // Authenticate (supports both API key and session)
  const { context, error } = await getAuthContext(request)
  if (!context) {
    return unauthorizedResponse(error)
  }

  // Get project context
  const projectContext = await getProjectContext(context.userId, projectId)
  if (!projectContext) {
    return errorResponse('Project not found', 404)
  }
  if (projectContext.project.storeType === 'web' && !hasInternalIntegrationAccess(context)) {
    return errorResponse('Project not found', 404)
  }

  // Get base path
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

  // Get project document
  const projectDoc = await basePath.get()
  if (!projectDoc.exists) {
    return errorResponse('Project not found', 404)
  }

  const projectData = projectDoc.data()!

  // Get recent activity (last 10 history entries)
  const historySnapshot = await basePath
    .collection('metadataHistory')
    .orderBy('createdAt', 'desc')
    .limit(10)
    .get()

  const recentActivity = historySnapshot.docs.map(doc => {
    const entry = doc.data() as MetadataHistoryEntry
    return {
      id: doc.id,
      source: entry.source,
      description: entry.changesSummary?.description || getSourceDescription(entry.source, projectData.storeType),
      localesCount: entry.changesSummary?.localesModified?.length || Object.keys(entry.locales || {}).length,
      createdAt: entry.createdAt?.toDate?.()?.toISOString() || new Date().toISOString(),
    }
  })

  // Calculate stats
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
  const activityThisWeek = recentActivity.filter(a => {
    const activityTime = new Date(a.createdAt).getTime()
    return activityTime > weekAgo
  }).length

  // Get metadata to count locales
  const metadataDoc = await basePath.collection('metadata').doc('current').get()
  const metadataData = metadataDoc.exists ? metadataDoc.data() : null
  const localesCount = metadataData?.locales
    ? Object.keys(metadataData.locales).length
    : (projectData.enabledLocales?.length || 1)

  return Response.json({
    project: {
      id: projectId,
      name: projectData.name,
      storeType: projectData.storeType || 'ios',
      appStoreAppId: projectData.appStoreAppId || null,
      playStorePackage: projectData.playStorePackage || null,
      primaryLocale: projectData.primaryLocale || 'en-US',
      syncStatus: projectData.syncStatus || 'synced',
      lastPulledAt: projectData.lastPulledAt?.toDate?.()?.toISOString() || null,
      lastPublishedAt: projectData.lastPublishedAt?.toDate?.()?.toISOString() || null,
    },
    stats: {
      localesCount,
      activityThisWeek,
    },
    recentActivity,
  })
}
