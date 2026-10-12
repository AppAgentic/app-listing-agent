import { AppStoreHelper, AppStoreCredentials } from './appstore'
import { decryptAppStoreCredentials } from '@/lib/crypto/credentials'
import { adminDb } from '@/lib/firebase/admin'
import { getProjectContext } from '@/lib/org/context'

/**
 * Helper function to get an authenticated AppStoreHelper for a project.
 * Retrieves and decrypts credentials from account-level storage (user or org).
 */
export async function getAppStoreHelper(
  userId: string,
  projectId: string,
  orgId?: string | null
): Promise<AppStoreHelper> {
  // Get project context to determine path
  const projectContext = await getProjectContext(userId, projectId)

  // Get account-level credentials (NOT project-level)
  const accountCredentialsPath = projectContext?.type === 'organization' && projectContext.orgId
    ? adminDb.collection('organizations').doc(projectContext.orgId).collection('credentials')
    : adminDb.collection('users').doc(userId).collection('credentials')

  const credentialsDoc = await accountCredentialsPath.doc('appstore').get()
  if (!credentialsDoc.exists) {
    throw new Error('App Store credentials not configured. Please add your App Store Connect API key in Settings.')
  }

  const encryptedCreds = credentialsDoc.data()!
  const credentials = await decryptAppStoreCredentials({
    encryptedData: encryptedCreds.encryptedData,
    encryptedDek: encryptedCreds.encryptedDek,
    keyVersion: encryptedCreds.keyVersion
  })

  // Get project's App ID to use with the credentials
  const projectBasePath = projectContext?.type === 'organization' && projectContext.orgId
    ? adminDb.collection('organizations').doc(projectContext.orgId).collection('projects').doc(projectId)
    : adminDb.collection('users').doc(userId).collection('projects').doc(projectId)

  const projectDoc = await projectBasePath.get()
  const appId = projectDoc.data()?.appStoreAppId

  // Return helper with project's app ID
  return new AppStoreHelper({ ...credentials, appId })
}
