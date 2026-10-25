import { readBoundedJson, RequestBodyLimitError } from '@/lib/api/bounded-body'
import { NextRequest } from 'next/server'
import { z } from 'zod'
import { errorResponse, unauthorizedResponse, successResponse } from '@/lib/api/auth'
import { getProjectContext, hasContextPermission, getAccountContext, AccountContext } from '@/lib/org/context'
import { getSession } from '@/lib/auth/session'
import { AppStoreHelper } from '@/lib/services/appstore'
import { decryptAppStoreCredentials } from '@/lib/crypto/credentials'
import { adminDb } from '@/lib/firebase/admin'
import { createReservationErrorResponse, UsageLimitError, withUsageReservation } from '@/lib/api/usage'
import { randomUUID } from 'node:crypto'
import { appUrl } from '@/lib/routing/app-url'

// Helper to resolve the project path that owns legal docs.
// Linked projects share legal docs — the link owner (iOS) is the source of truth.
async function resolveLegalProjectPath(
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

const requestSchema = z.object({
  projectId: z.string(),
  type: z.enum(['privacy_policy', 'terms_of_service']),
})

// Helper to get auth context from either API key or session
async function getAuthContext(request: NextRequest): Promise<{ context: AccountContext | null; error?: string }> {
  const authHeader = request.headers.get('Authorization')
  if (authHeader) {
    const { authenticateRequest } = await import('@/lib/api/auth')
    const auth = await authenticateRequest(request)
    if (auth.authenticated && auth.context) {
      return { context: auth.context }
    }
    return { context: null, error: auth.error }
  }

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
  const { context, error: authError } = await getAuthContext(request)
  if (!context) {
    return unauthorizedResponse(authError)
  }

  let body
  try {
    body = requestSchema.parse(await readBoundedJson(request))
  } catch (error) {
    if (error instanceof RequestBodyLimitError) return Response.json({ error: error.message }, { status: 413 })
    if (error instanceof z.ZodError) {
      return errorResponse(error.issues[0]?.message || 'Invalid request body')
    }
    return errorResponse('Invalid request body')
  }

  const { projectId, type } = body

  // Get project context
  const projectContext = await getProjectContext(context.userId, projectId)
  if (!projectContext) {
    return errorResponse('Project not found', 404)
  }

  if (!hasContextPermission(projectContext, 'canCreateProjects')) {
    return errorResponse('Permission denied', 403)
  }

  // Get base path for the current project (for App Store credentials and app ID)
  const isOrgProject = projectContext.type === 'organization' && projectContext.orgId
  const basePath = isOrgProject
    ? adminDb.collection('organizations').doc(projectContext.orgId!).collection('projects').doc(projectId)
    : adminDb.collection('users').doc(context.userId).collection('projects').doc(projectId)

  // Get project document for app ID
  const projectDoc = await basePath.get()
  if (!projectDoc.exists) {
    return errorResponse('Project not found', 404)
  }
  const projectData = projectDoc.data()!

  const appId = projectData.appStoreAppId
  if (!appId) {
    return errorResponse('App Store App ID not configured for this project. Go to Project Settings to add it.', 400)
  }

  // Resolve to the legal doc owner (linked projects share legal docs)
  const legalBasePath = await resolveLegalProjectPath(context.userId, projectId, projectContext)
  const legalProjectDoc = await legalBasePath.get()
  const legalProjectData = legalProjectDoc.data()

  const publicSlug = legalProjectData?.publicSlug
  if (!publicSlug) {
    return errorResponse('No public slug found. Please publish your privacy policy first.', 400)
  }

  // Get legal document from the owner project
  const legalDocRef = legalBasePath.collection('legal').doc(type)
  const legalDoc = await legalDocRef.get()

  if (!legalDoc.exists) {
    return errorResponse(`${type === 'privacy_policy' ? 'Privacy policy' : 'Terms of service'} not found. Create one first.`, 400)
  }

  const legalData = legalDoc.data()!
  if (!legalData.isPublished) {
    return errorResponse(`${type === 'privacy_policy' ? 'Privacy policy' : 'Terms of service'} is not published. Publish it first.`, 400)
  }

  // Construct the public URL
  const urlType = type === 'privacy_policy' ? 'privacy' : 'terms'
  const publicUrl = appUrl(`/legal/${publicSlug}/${urlType}`)

  // Validate URL format
  if (!publicUrl.startsWith('https://')) {
    return errorResponse('Invalid public URL configuration. NEXT_PUBLIC_APP_URL must be set to a valid https URL.', 500)
  }

  // Get App Store credentials
  const accountCredentialsPath = isOrgProject
    ? adminDb.collection('organizations').doc(projectContext.orgId!).collection('credentials')
    : adminDb.collection('users').doc(context.userId).collection('credentials')

  const credentialsDoc = await accountCredentialsPath.doc('appstore').get()
  if (!credentialsDoc.exists) {
    return errorResponse('App Store credentials not configured. Go to Settings to add your credentials.', 400)
  }

  try {
    console.log('[Push to AppStore] Starting credential decryption...')
    const encryptedCreds = credentialsDoc.data()!

    console.log('[Push to AppStore] Encrypted creds found, keyVersion:', encryptedCreds.keyVersion)
    const credentials = await decryptAppStoreCredentials({
      encryptedData: encryptedCreds.encryptedData,
      encryptedDek: encryptedCreds.encryptedDek,
      keyVersion: encryptedCreds.keyVersion,
    })
    console.log('[Push to AppStore] Credentials decrypted successfully')

    const helper = new AppStoreHelper({ ...credentials, appId })
    console.log('[Push to AppStore] AppStoreHelper created, pushing privacy URL...')

    // Push the privacy policy URL to all localizations
    const result = await withUsageReservation(
      context,
      {
        operationId: `legal-push-appstore:${request.headers.get('idempotency-key')?.trim() || randomUUID()}`,
        usageType: 'publishing',
        units: 1,
        metadata: { route: 'legal/push-to-appstore', projectId, type },
      },
      async () => helper.pushPrivacyPolicyUrl(publicUrl),
      pushResult => pushResult.results.some(item => item.success) ? 1 : 0,
    )

    if (!result.success && result.results.length === 0) {
      return errorResponse(result.message || 'Failed to push to App Store Connect', 400)
    }

    return successResponse({
      success: result.success,
      message: result.message,
      publicUrl,
      results: result.results,
      stats: {
        total: result.results.length,
        success: result.results.filter(r => r.success).length,
        failed: result.results.filter(r => !r.success).length,
      },
    })
  } catch (error) {
    console.error('[Push to AppStore] Error:', error)
    if (error instanceof UsageLimitError) return createReservationErrorResponse(error.result)
    if (error instanceof Error && error.message.includes('already been processed')) {
      return errorResponse('This publishing operation was already processed', 409)
    }
    return errorResponse(
      error instanceof Error ? error.message : 'Failed to push to App Store Connect',
      500
    )
  }
}
