import { readBoundedJson, RequestBodyLimitError } from '@/lib/api/bounded-body'
import { NextRequest } from 'next/server'
import { z } from 'zod'
import { authenticateRequest, errorResponse, unauthorizedResponse } from '@/lib/api/auth'
import { getProjectContext, hasContextPermission, getAccountContext, AccountContext } from '@/lib/org/context'
import { getSession } from '@/lib/auth/session'
import { AppStoreHelper } from '@/lib/services/appstore'
import { decryptAppStoreCredentials } from '@/lib/crypto/credentials'
import { adminDb } from '@/lib/firebase/admin'
import { isAppStoreVersionEditable } from '@/lib/firebase/firestore'

const requestSchema = z.object({
  projectId: z.string(),
})

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

export async function POST(request: NextRequest) {
  // Authenticate (supports both API key and session)
  const { context: authContext, error: authError } = await getAuthContext(request)
  if (!authContext) {
    return unauthorizedResponse(authError)
  }

  // Parse request
  let body
  try {
    body = requestSchema.parse(await readBoundedJson(request))
  } catch (error) {
    if (error instanceof RequestBodyLimitError) return Response.json({ error: error.message }, { status: 413 })
    return errorResponse('Invalid request body')
  }

  const { projectId } = body

  // Get project context (this already validates user access)
  const projectContext = await getProjectContext(authContext.userId, projectId)
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
        .doc(authContext.userId)
        .collection('projects')
        .doc(projectId)

  // Get account-level credentials
  const accountCredentialsPath = projectContext.type === 'organization' && projectContext.orgId
    ? adminDb.collection('organizations').doc(projectContext.orgId).collection('credentials')
    : adminDb.collection('users').doc(authContext.userId).collection('credentials')

  const credentialsDoc = await accountCredentialsPath.doc('appstore').get()
  if (!credentialsDoc.exists) {
    return errorResponse('App Store credentials not configured. Go to Settings to add your credentials.', 400)
  }

  // Get the project document to get the actual app ID
  const projectDoc = await basePath.get()
  if (!projectDoc.exists) {
    return errorResponse('Project not found', 404)
  }
  const projectData = projectDoc.data()!
  const appId = projectData.appStoreAppId
  if (!appId) {
    return errorResponse('App Store App ID not configured for this project. Edit the project to add the App ID.', 400)
  }

  const encryptedCreds = credentialsDoc.data()!
  const credentials = await decryptAppStoreCredentials({
    encryptedData: encryptedCreds.encryptedData,
    encryptedDek: encryptedCreds.encryptedDek,
    keyVersion: encryptedCreds.keyVersion,
  })

  // Override the appId from account-level credentials with the project's actual app ID
  const helper = new AppStoreHelper({ ...credentials, appId })

  try {
    const versions = await helper.getAppStoreVersions()

    // Sort by created date descending
    versions.sort((a, b) =>
      new Date(b.createdDate).getTime() - new Date(a.createdDate).getTime()
    )

    const latestVersion = versions[0] || null
    const editableVersion = versions.find(v => v.isEditable) || null

    return Response.json({
      success: true,
      versions: versions.map(v => ({
        id: v.id,
        versionString: v.versionString,
        state: v.state,
        isEditable: v.isEditable,
        createdDate: v.createdDate,
      })),
      latestVersion: latestVersion ? {
        id: latestVersion.id,
        versionString: latestVersion.versionString,
        state: latestVersion.state,
        isEditable: latestVersion.isEditable,
      } : null,
      editableVersion: editableVersion ? {
        id: editableVersion.id,
        versionString: editableVersion.versionString,
        state: editableVersion.state,
      } : null,
      canEdit: !!editableVersion,
      needsNewVersion: !editableVersion && versions.length > 0,
    })
  } catch (error) {
    return errorResponse(
      error instanceof Error ? error.message : 'Failed to get version state',
      500
    )
  }
}
