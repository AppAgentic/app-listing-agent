import { NextRequest } from 'next/server'
import { authenticateRequest, errorResponse, unauthorizedResponse } from '@/lib/api/auth'
import { getProjectContext, getAccountContext, AccountContext } from '@/lib/org/context'
import { getSession } from '@/lib/auth/session'
import { adminDb } from '@/lib/firebase/admin'
import type { LocalizedMetadata } from '@/lib/firebase/firestore'
import { hasInternalIntegrationAccess } from '@/lib/features/internal-integrations'

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
  const internalIntegrationsEnabled = hasInternalIntegrationAccess(context)

  // Get all metadata documents
  const metadataSnapshot = await basePath.collection('metadata').get()
  const metadata: { [locale: string]: LocalizedMetadata } = {}

  for (const doc of metadataSnapshot.docs) {
    metadata[doc.id] = doc.data() as LocalizedMetadata
  }

  // Get any drafts
  const draftsSnapshot = await basePath.collection('drafts').get()
  const drafts: { [locale: string]: Partial<LocalizedMetadata> } = {}

  for (const doc of draftsSnapshot.docs) {
    drafts[doc.id] = doc.data().data
  }

  return Response.json({
    success: true,
    project: {
      id: projectId,
      name: projectData.name,
      storeType: projectData.storeType || (projectData.appStoreAppId ? 'ios' : 'android'),
      appStoreAppId: projectData.appStoreAppId,
      playStorePackage: projectData.playStorePackage,
      vendorNumber: projectData.vendorNumber || null,
      appStoreVersionState: projectData.appStoreVersionState || null,
      appStoreVersionId: projectData.appStoreVersionId || null,
      appStoreVersionNumber: projectData.appStoreVersionNumber || null,
      lastPulledAt: projectData.lastPulledAt || null,
      lastPushedAt: projectData.lastPushedAt || null,
      syncStatus: projectData.syncStatus || 'never_synced',
      primaryLocale: projectData.primaryLocale || 'en-US',
      enabledLocales: projectData.enabledLocales || [],
      linkedProjectId: projectData.linkedProjectId || null,
      revenueCatSecretKey: internalIntegrationsEnabled ? projectData.revenueCatSecretKey || null : null,
      revenueCatProjectId: internalIntegrationsEnabled ? projectData.revenueCatProjectId || null : null,
      gleapApiToken: internalIntegrationsEnabled ? projectData.gleapApiToken || null : null,
      gleapProjectId: internalIntegrationsEnabled ? projectData.gleapProjectId || null : null,
      whopApiKey: internalIntegrationsEnabled ? projectData.whopApiKey || null : null,
      whopCompanyId: internalIntegrationsEnabled ? projectData.whopCompanyId || null : null,
      whopWebhookSecret: internalIntegrationsEnabled ? projectData.whopWebhookSecret || null : null,
      firebaseAppId: internalIntegrationsEnabled ? projectData.firebaseAppId || null : null,
      firebaseAnalyticsPropertyId: internalIntegrationsEnabled ? projectData.firebaseAnalyticsPropertyId || null : null,
      firebaseProjectId: internalIntegrationsEnabled ? projectData.firebaseProjectId || null : null,
    },
    metadata,
    drafts,
    locales: Object.keys(metadata),
  })
}
