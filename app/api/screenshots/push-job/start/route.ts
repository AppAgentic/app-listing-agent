import { readBoundedJson, RequestBodyLimitError } from '@/lib/api/bounded-body'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateRequest, errorResponse, unauthorizedResponse } from '@/lib/api/auth'
import { getProjectContext, hasContextPermission, getAccountContext, AccountContext } from '@/lib/org/context'
import { getSession } from '@/lib/auth/session'
import { adminDb } from '@/lib/firebase/admin'
import { createPushJob, estimatePushJobDuration } from '@/lib/jobs/push-job'
import { hasActiveTranslationJob } from '@/lib/jobs/translation-job'
import type { ScreenshotSet } from '@/lib/firebase/firestore'
import { createReservationErrorResponse, refundUsage, reserveUsage, settleUsage } from '@/lib/api/usage'
import { randomUUID } from 'node:crypto'

const startJobSchema = z.object({
  projectId: z.string(),
  displayTypes: z.array(z.string()).optional(),
  locales: z.array(z.string()).optional(),
})

// Helper to get auth context
async function getAuthContext(request: NextRequest): Promise<{ context: AccountContext | null; error?: string }> {
  const authHeader = request.headers.get('Authorization')
  if (authHeader) {
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
  // Authenticate
  const { context: authContext, error: authError } = await getAuthContext(request)
  if (!authContext) {
    return unauthorizedResponse(authError)
  }

  // Parse request
  let body
  try {
    body = startJobSchema.parse(await readBoundedJson(request))
  } catch (error) {
    if (error instanceof RequestBodyLimitError) return Response.json({ error: error.message }, { status: 413 })
    if (error instanceof z.ZodError) {
      return errorResponse(`Validation error: ${error.issues.map(e => e.message).join(', ')}`)
    }
    return errorResponse('Invalid request body')
  }

  const { projectId, displayTypes, locales } = body

  // Get project context
  const projectContext = await getProjectContext(authContext.userId, projectId)
  if (!projectContext) {
    return errorResponse('Project not found', 404)
  }

  // Check permission
  if (!hasContextPermission(projectContext, 'canCreateProjects')) {
    return errorResponse('Permission denied', 403)
  }

  // Check for active translation job
  const translationCheck = await hasActiveTranslationJob(authContext.userId, projectId)
  if (translationCheck.active) {
    return errorResponse(
      'Cannot push screenshots while a translation job is in progress. Please wait for the translation to complete or cancel it first.',
      409
    )
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

  // Get project data
  const projectDoc = await basePath.get()
  if (!projectDoc.exists) {
    return errorResponse('Project not found', 404)
  }

  const projectData = projectDoc.data()!
  const storeType = projectData.storeType || (projectData.appStoreAppId ? 'ios' : 'android')
  const isAndroid = storeType === 'android'

  // Get the app identifier based on platform
  const appId = isAndroid ? projectData.playStorePackage : projectData.appStoreAppId

  if (!appId) {
    return errorResponse(isAndroid
      ? 'Project is not connected to Google Play Store'
      : 'Project is not connected to App Store Connect'
    )
  }

  // Verify store credentials exist
  const accountCredentialsPath = projectContext.type === 'organization' && projectContext.orgId
    ? adminDb.collection('organizations').doc(projectContext.orgId).collection('credentials')
    : adminDb.collection('users').doc(authContext.userId).collection('credentials')

  const credentialType = isAndroid ? 'playstore' : 'appstore'
  const credentialsDoc = await accountCredentialsPath.doc(credentialType).get()
  if (!credentialsDoc.exists) {
    return errorResponse(isAndroid
      ? 'Play Store credentials not configured.'
      : 'App Store credentials not configured.',
      400
    )
  }

  // Get all screenshot sets to determine what needs to be uploaded
  const screenshotsSnapshot = await basePath.collection('screenshots').get()
  const screenshotSets: { [displayType: string]: ScreenshotSet } = {}

  for (const doc of screenshotsSnapshot.docs) {
    if (!displayTypes || displayTypes.includes(doc.id)) {
      screenshotSets[doc.id] = doc.data() as ScreenshotSet
    }
  }

  if (Object.keys(screenshotSets).length === 0) {
    return errorResponse('No screenshots to push')
  }

  // Determine all locales to process
  const primaryLocale = projectData.primaryLocale || 'en-US'
  const unsortedLocales = locales && locales.length > 0
    ? locales
    : projectData.enabledLocales || [primaryLocale]

  // Sort locales: primary first, then alphabetically by locale code
  // This matches App Store Connect's ordering (Primary at top, then alphabetical)
  const allLocales = [...unsortedLocales].sort((a, b) => {
    // Primary locale always comes first
    if (a === primaryLocale) return -1
    if (b === primaryLocale) return 1
    // Otherwise sort alphabetically by locale code
    return a.localeCompare(b)
  })

  // Calculate total tasks (displayTypes * locales) and total screenshots
  const totalTasks = Object.keys(screenshotSets).length * allLocales.length

  // Calculate total screenshots across all sets and locales
  let totalScreenshots = 0
  for (const [, screenshotSet] of Object.entries(screenshotSets)) {
    for (const locale of allLocales) {
      // Check localized screenshots first, then fall back to primary
      const localizedKey = `screenshots_${locale}`
      // Use type assertion to access dynamic keys
      const setData = screenshotSet as unknown as Record<string, unknown>
      const screenshots = (setData[localizedKey] as unknown[] | undefined)
        || screenshotSet.screenshots || []
      totalScreenshots += screenshots.length
    }
  }

  const operationId = `publish-screenshot-job:${request.headers.get('idempotency-key')?.trim() || randomUUID()}`
  const reservation = await reserveUsage(authContext, {
    operationId,
    usageType: 'publishing',
    units: 1,
    metadata: { route: 'screenshots/push-job/start', projectId },
  })
  if (!reservation.allowed) return createReservationErrorResponse(reservation)
  if (reservation.replayed) return errorResponse('This screenshot push job was already created', 409)

  let job
  try {
    // A queued job is a committed publishing operation. The background worker
    // owns delivery retries; charge once for the root job, never continuations.
    job = await createPushJob({
      userId: authContext.userId,
      orgId: projectContext.type === 'organization' ? projectContext.orgId : undefined,
      projectId,
      appId,
      platform: isAndroid ? 'android' : 'ios',
      config: {
        displayTypes: displayTypes || Object.keys(screenshotSets),
        locales: allLocales,
      },
    })
    // Once the durable job exists, background delivery may begin. Finalize the
    // charge before non-critical progress metadata so later local errors cannot
    // refund a queued provider operation.
    await settleUsage(authContext, operationId, 'publishing', 1)

  // Update the job with total count
  const jobRef = adminDb
    .collection('users')
    .doc(authContext.userId)
    .collection('pushJobs')
    .doc(job.id)

    await jobRef.update({
      'progress.totalSets': totalTasks,
      'progress.totalScreenshots': totalScreenshots,
    })
  } catch (error) {
    if (!job) await refundUsage(authContext, operationId, 'publishing')
    throw error
  }

  // Estimate duration
  const estimatedDuration = estimatePushJobDuration(totalTasks)

  return NextResponse.json({
    success: true,
    jobId: job.id,
    totalTasks,
    totalScreenshots,
    estimatedDuration,
    displayTypes: Object.keys(screenshotSets),
    locales: allLocales,
  })
}
