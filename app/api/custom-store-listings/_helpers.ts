import { NextRequest } from 'next/server'
import { authenticateRequest, errorResponse, unauthorizedResponse } from '@/lib/api/auth'
import { getProjectContext, getAccountContext, AccountContext } from '@/lib/org/context'
import { getMutableProjectContext } from '@/lib/org/project-authorization'
import { adminDb } from '@/lib/firebase/admin'
import { PlayStoreHelper } from '@/lib/services/playstore'
import { decryptPlayStoreCredentials } from '@/lib/crypto/credentials'

export { errorResponse, unauthorizedResponse }

export async function getAuthContext(request: NextRequest): Promise<{ context: AccountContext | null; error?: string }> {
  const authHeader = request.headers.get('Authorization')
  if (authHeader) {
    const auth = await authenticateRequest(request)
    if (auth.authenticated && auth.context) return { context: auth.context }
    return { context: null, error: auth.error }
  }
  const { getSession } = await import('@/lib/auth/session')
  const session = await getSession()
  if (session) {
    const context = await getAccountContext(session.userId)
    if (context) return { context }
    return { context: null, error: 'User not found' }
  }
  return { context: null, error: 'Authentication required' }
}

export async function getPlayStoreHelper(request: NextRequest, projectId: string) {
  const { context: authContext, error: authError } = await getAuthContext(request)
  if (!authContext) return { error: authError || 'Authentication required' }

  const projectContext = await getMutableProjectContext(authContext.userId, projectId)
  if (!projectContext) return { error: 'Project not found' }

  const basePath = projectContext.type === 'organization' && projectContext.orgId
    ? adminDb.collection('organizations').doc(projectContext.orgId).collection('projects').doc(projectId)
    : adminDb.collection('users').doc(authContext.userId).collection('projects').doc(projectId)

  const accountCredentialsPath = projectContext.type === 'organization' && projectContext.orgId
    ? adminDb.collection('organizations').doc(projectContext.orgId).collection('credentials')
    : adminDb.collection('users').doc(authContext.userId).collection('credentials')
  const credentialsDoc = await accountCredentialsPath.doc('playstore').get()
  if (!credentialsDoc.exists) return { error: 'Play Store credentials not configured' }

  const encryptedCreds = credentialsDoc.data()!
  const credentials = await decryptPlayStoreCredentials({
    encryptedData: encryptedCreds.encryptedData,
    encryptedDek: encryptedCreds.encryptedDek,
    keyVersion: encryptedCreds.keyVersion,
  })

  const projectDoc = await basePath.get()
  const projectData = projectDoc.data()
  const packageName = projectData?.playStorePackage || credentials.packageName

  const helper = new PlayStoreHelper({ packageName, serviceAccountJson: credentials.serviceAccountJson })
  return { helper, basePath, authContext, projectContext }
}
