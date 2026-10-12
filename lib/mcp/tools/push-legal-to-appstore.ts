import { adminDb } from '@/lib/firebase/admin'
import { appOrigin } from '@/lib/routing/app-url'
import { AccountContext, getProjectContext, hasContextPermission } from '@/lib/org/context'
import { AppStoreHelper } from '@/lib/services/appstore'
import { decryptAppStoreCredentials } from '@/lib/crypto/credentials'
import { LegalDocumentType } from '@/lib/firebase/firestore'
import { createReservationErrorResponse, refundUsage, reserveUsage, settleUsage } from '@/lib/api/usage'
import { randomUUID } from 'node:crypto'

export interface PushLegalToAppStoreParams {
  __usageOperationId?: string
  projectId: string
  type: LegalDocumentType // 'privacy_policy' | 'terms_of_service'
}

export interface PushLegalToAppStoreResult {
  success: boolean
  publicUrl?: string
  message?: string
  results?: Array<{ locale: string; success: boolean; error?: string }>
  stats?: {
    total: number
    success: number
    failed: number
  }
  error?: string
}

/**
 * Resolve the project ref that actually owns the legal documents.
 * Linked projects (e.g. Android linked to iOS) share legal docs — the
 * iOS "link owner" is the source of truth.
 */
async function resolveLegalProjectRef(
  userId: string,
  projectId: string,
  projectContext: Awaited<ReturnType<typeof getProjectContext>>
): Promise<FirebaseFirestore.DocumentReference> {
  const isOrgProject = projectContext!.type === 'organization' && projectContext!.orgId
  const basePath = isOrgProject
    ? adminDb.collection('organizations').doc(projectContext!.orgId!).collection('projects').doc(projectId)
    : adminDb.collection('users').doc(projectContext!.userId).collection('projects').doc(projectId)

  const projectDoc = await basePath.get()
  const projectData = projectDoc.data()

  if (projectData?.linkedProjectId && !projectData?.linkOwner) {
    const ownerContext = await getProjectContext(userId, projectData.linkedProjectId)
    if (ownerContext) {
      const isOwnerOrg = ownerContext.type === 'organization' && ownerContext.orgId
      return isOwnerOrg
        ? adminDb.collection('organizations').doc(ownerContext.orgId!).collection('projects').doc(projectData.linkedProjectId)
        : adminDb.collection('users').doc(ownerContext.userId).collection('projects').doc(projectData.linkedProjectId)
    }
  }

  return basePath
}

/**
 * MCP tool: push a published legal document's public URL to every
 * appInfoLocalization on App Store Connect. Currently only the privacy
 * policy URL has a dedicated ASC field (`privacyPolicyUrl`) — terms of
 * service should be referenced inside the app description instead, so
 * this tool only supports privacy_policy pushes to ASC.
 *
 * Prerequisites:
 *  - Legal doc exists for this project and `isPublished` is true
 *  - Project has `appStoreAppId` configured
 *  - App Store credentials are configured on the account
 */
export async function pushLegalToAppStore(
  params: PushLegalToAppStoreParams,
  context: AccountContext
): Promise<PushLegalToAppStoreResult> {
  const { projectId, type } = params

  // Only privacy_policy is supported (ASC only exposes `privacyPolicyUrl`)
  if (type !== 'privacy_policy') {
    return {
      success: false,
      error:
        'Only privacy_policy is supported for App Store push. Terms of Service must be referenced inside the app description (guideline 3.1.2).',
    }
  }

  // Validate project access
  const projectContext = await getProjectContext(context.userId, projectId)
  if (!projectContext) {
    return { success: false, error: 'Project not found' }
  }

  if (!hasContextPermission(projectContext, 'canCreateProjects')) {
    return { success: false, error: 'Permission denied' }
  }

  // Base path for the target project (where ASC credentials + appId live)
  const isOrgProject = projectContext.type === 'organization' && projectContext.orgId
  const basePath = isOrgProject
    ? adminDb.collection('organizations').doc(projectContext.orgId!).collection('projects').doc(projectId)
    : adminDb.collection('users').doc(context.userId).collection('projects').doc(projectId)

  const projectDoc = await basePath.get()
  if (!projectDoc.exists) {
    return { success: false, error: 'Project not found' }
  }
  const projectData = projectDoc.data()!

  const appId = projectData.appStoreAppId
  if (!appId) {
    return {
      success: false,
      error: 'App Store App ID not configured for this project. Set appStoreAppId in Project Settings first.',
    }
  }

  // Resolve the legal doc owner (linked projects share legal docs)
  const legalBasePath = await resolveLegalProjectRef(context.userId, projectId, projectContext)
  const legalProjectDoc = await legalBasePath.get()
  const legalProjectData = legalProjectDoc.data()

  const publicSlug = legalProjectData?.publicSlug
  if (!publicSlug) {
    return {
      success: false,
      error: 'No public slug found — publish your privacy policy first via update_legal_document.',
    }
  }

  const legalDocRef = legalBasePath.collection('legal').doc(type)
  const legalDoc = await legalDocRef.get()
  if (!legalDoc.exists) {
    return {
      success: false,
      error: 'Privacy policy not found. Create one first via update_legal_document.',
    }
  }
  const legalData = legalDoc.data()!
  if (!legalData.isPublished) {
    return {
      success: false,
      error: 'Privacy policy is not published. Call update_legal_document to publish it first.',
    }
  }

  // Build the public URL
  const baseUrl = appOrigin()
  const publicUrl = `${baseUrl}/legal/${publicSlug}/privacy`

  if (!publicUrl.startsWith('https://')) {
    return {
      success: false,
      error: 'Invalid public URL configuration. NEXT_PUBLIC_APP_URL must be a valid https URL.',
    }
  }

  // Load App Store credentials
  const accountCredentialsPath = isOrgProject
    ? adminDb.collection('organizations').doc(projectContext.orgId!).collection('credentials')
    : adminDb.collection('users').doc(context.userId).collection('credentials')

  const credentialsDoc = await accountCredentialsPath.doc('appstore').get()
  if (!credentialsDoc.exists) {
    return {
      success: false,
      error: 'App Store credentials not configured. Add them in Settings.',
    }
  }

  const operationId = params.__usageOperationId || `publish-legal:${randomUUID()}`
  const reservation = await reserveUsage(context, {
    operationId,
    usageType: 'publishing',
    units: 1,
    metadata: { tool: 'push_legal_to_appstore', projectId },
  })
  if (!reservation.allowed) {
    const response = createReservationErrorResponse(reservation)
    const payload = await response.json()
    return { success: false, error: payload.message || 'Publishing limit reached' }
  }
  if (reservation.replayed) return { success: false, error: 'This publishing operation was already processed' }

  let result: Awaited<ReturnType<AppStoreHelper['pushPrivacyPolicyUrl']>>
  try {
    const encryptedCreds = credentialsDoc.data()!
    const credentials = await decryptAppStoreCredentials({
      encryptedData: encryptedCreds.encryptedData,
      encryptedDek: encryptedCreds.encryptedDek,
      keyVersion: encryptedCreds.keyVersion,
    })

    const helper = new AppStoreHelper({ ...credentials, appId })
    result = await helper.pushPrivacyPolicyUrl(publicUrl)
  } catch (error) {
    await refundUsage(context, operationId, 'publishing')
    console.error('[pushLegalToAppStore] Failed:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to push to App Store Connect',
    }
  }

  await settleUsage(
    context,
    operationId,
    'publishing',
    result.results.some(item => item.success) ? 1 : 0,
  )
  if (!result.success && result.results.length === 0) {
    return { success: false, error: result.message || 'Failed to push to App Store Connect' }
  }

  return {
    success: result.success,
    publicUrl,
    message: result.message,
    results: result.results,
    stats: {
      total: result.results.length,
      success: result.results.filter((r) => r.success).length,
      failed: result.results.filter((r) => !r.success).length,
    },
  }
}
