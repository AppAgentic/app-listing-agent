import { NextRequest } from 'next/server'
import { authenticateRequest, errorResponse, unauthorizedResponse } from '@/lib/api/auth'
import { getProjectContext, getAccountContext, AccountContext, ProjectContext } from '@/lib/org/context'
import { adminDb } from '@/lib/firebase/admin'
import { PlayStoreHelper, PlayStoreCredentials } from '@/lib/services/playstore'
import { decryptPlayStoreCredentials } from '@/lib/crypto/credentials'

export async function getAuthContext(request: NextRequest): Promise<{ context: AccountContext | null; error?: string }> {
  const authHeader = request.headers.get('Authorization')
  if (authHeader) {
    const auth = await authenticateRequest(request)
    if (auth.authenticated && auth.context) {
      return { context: auth.context }
    }
    return { context: null, error: auth.error }
  }

  const { getSession } = await import('@/lib/auth/session')
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

export async function getPlayStoreContext(request: NextRequest, projectId: string) {
  const { context: authContext, error: authError } = await getAuthContext(request)
  if (!authContext) {
    return { error: authError || 'Authentication required' }
  }

  const projectContext = await getProjectContext(authContext.userId, projectId)
  if (!projectContext) {
    return { error: 'Project not found' }
  }

  const basePath = projectContext.type === 'organization' && projectContext.orgId
    ? adminDb.collection('organizations').doc(projectContext.orgId).collection('projects').doc(projectId)
    : adminDb.collection('users').doc(authContext.userId).collection('projects').doc(projectId)

  return { authContext, projectContext, basePath }
}

export async function getPlayStoreHelper(request: NextRequest, projectId: string) {
  const ctx = await getPlayStoreContext(request, projectId)
  if ('error' in ctx && !ctx.authContext) {
    return { error: ctx.error, helper: undefined }
  }

  return resolvePlayStoreHelper(ctx as Exclude<typeof ctx, { error: string }>)
}

/** Server-internal entry point for already authenticated MCP context. */
export async function getPlayStoreHelperForContext(authContext: AccountContext, projectId: string) {
  const projectContext = await getProjectContext(authContext.userId, projectId)
  if (!projectContext) return { error: 'Project not found' }
  const basePath = projectContext.type === 'organization' && projectContext.orgId
    ? adminDb.collection('organizations').doc(projectContext.orgId).collection('projects').doc(projectId)
    : adminDb.collection('users').doc(authContext.userId).collection('projects').doc(projectId)
  return resolvePlayStoreHelper({ authContext, projectContext, basePath })
}

async function resolvePlayStoreHelper(ctx: { authContext: AccountContext; projectContext: ProjectContext; basePath: FirebaseFirestore.DocumentReference }) {
  const { authContext, projectContext, basePath } = ctx

  // Get credentials from account level (same as screenshot push + Cloud Functions)
  const accountCredentialsPath = projectContext.type === 'organization' && projectContext.orgId
    ? adminDb.collection('organizations').doc(projectContext.orgId).collection('credentials')
    : adminDb.collection('users').doc(authContext.userId).collection('credentials')
  const credentialsRef = accountCredentialsPath.doc('playstore')
  const credentialsDoc = await credentialsRef.get()
  if (!credentialsDoc.exists) {
    return { error: 'Play Store credentials not configured' }
  }

  const encryptedCreds = credentialsDoc.data()!
  let credentials: { packageName: string; serviceAccountJson: string }
  try {
    credentials = await decryptPlayStoreCredentials({
      encryptedData: encryptedCreds.encryptedData,
      encryptedDek: encryptedCreds.encryptedDek,
      keyVersion: encryptedCreds.keyVersion,
    })
  } catch (error: any) {
    return { error: `Failed to decrypt credentials: ${error.message}` }
  }

  if (!credentials.serviceAccountJson) {
    return { error: 'Play Store credentials missing serviceAccountJson' }
  }

  // Get package name from project
  const projectDoc = await basePath.get()
  const projectData = projectDoc.data()
  const packageName = projectData?.playStorePackage || credentials.packageName

  let helper: PlayStoreHelper
  try {
    helper = new PlayStoreHelper({
      packageName,
      serviceAccountJson: credentials.serviceAccountJson,
    })
  } catch (error: any) {
    return { error: `Failed to initialize Play Store helper: ${error.message}` }
  }

  return { authContext, projectContext, basePath, helper, packageName }
}

export { errorResponse, unauthorizedResponse }
