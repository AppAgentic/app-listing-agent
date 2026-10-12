import { NextRequest } from 'next/server'
import { configureAscMediaBackend } from '@/lib/services/asc-media-backend'
import { z } from 'zod'
import { authenticateRequest, errorResponse, unauthorizedResponse } from '@/lib/api/auth'
import { getProjectContext, hasContextPermission, getAccountContext, AccountContext } from '@/lib/org/context'
import { getSession } from '@/lib/auth/session'
import { adminDb } from '@/lib/firebase/admin'
import { decryptAppStoreCredentials } from '@/lib/crypto/credentials'
import { AppStoreHelper } from '@/lib/services/appstore'
import { logAuditEvent, AuditAction } from '@/lib/org/audit'
import { Timestamp } from 'firebase-admin/firestore'
import { resizeToAppStoreSize, type ScreenshotSize } from '@/lib/services/screenshot-generator'
import { assignAscSlots, sortByPosition } from '@/lib/services/asc-screenshot-slots'
import { hasActiveTranslationJob } from '@/lib/jobs/translation-job'
import type { ScreenshotSet, ScreenshotDisplayType, SCREENSHOT_DISPLAY_TYPES } from '@/lib/firebase/firestore'
import { createReservationErrorResponse, refundUsage, reserveUsage, settleUsage } from '@/lib/api/usage'
import { randomUUID } from 'node:crypto'

const pushRequestSchema = z.object({
  projectId: z.string(),
  displayTypes: z.array(z.string()).optional(), // Push specific display types, or all if not specified
  locales: z.array(z.string()).optional(), // Push to specific locales, or primary locale if not specified
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

// Map display type to screenshot size for resizing
function getScreenshotSize(displayType: ScreenshotDisplayType): ScreenshotSize {
  const mapping: Partial<Record<ScreenshotDisplayType, ScreenshotSize>> = {
    'APP_IPHONE_69': '6.9',
    'APP_IPHONE_65': '6.5',
    'APP_IPHONE_63': '6.3',
    'APP_IPHONE_61': '6.1',
    'APP_IPHONE_55': '5.5',
    'APP_IPAD_PRO_13': 'ipad-13',
    'APP_IPAD_PRO_129': 'ipad-12.9',
    'APP_IPAD_PRO_11': 'ipad-11',
    'APP_WATCH_ULTRA_3': 'watch-ultra-3',
    'APP_WATCH_ULTRA': 'watch-ultra',
    'APP_WATCH_SERIES_10': 'watch-10',
    'APP_WATCH_SERIES_7': 'watch-7',
    'APP_WATCH_SERIES_4': 'watch-4',
    'APP_WATCH_SERIES_3': 'watch-3',
  }
  return mapping[displayType] || '6.9'
}

export async function POST(request: NextRequest) {
  // Authenticate
  const { context: authContext, error: authError } = await getAuthContext(request)
  if (!authContext) {
    return unauthorizedResponse(authError)
  }

  // Parse request
  let body
  let publishingOperationId: string | null = null
  let totalUploaded = 0
  try {
    body = pushRequestSchema.parse(await request.json())
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(`Validation error: ${error.errors.map(e => e.message).join(', ')}`)
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
  const appId = projectData.appStoreAppId

  if (!appId) {
    return errorResponse('Project is not connected to App Store Connect')
  }

  // Get account-level credentials
  const accountCredentialsPath = projectContext.type === 'organization' && projectContext.orgId
    ? adminDb.collection('organizations').doc(projectContext.orgId).collection('credentials')
    : adminDb.collection('users').doc(authContext.userId).collection('credentials')

  const credentialsDoc = await accountCredentialsPath.doc('appstore').get()
  if (!credentialsDoc.exists) {
    return errorResponse('App Store credentials not configured. Go to Settings to add your credentials.', 400)
  }

  const encryptedCreds = credentialsDoc.data()!

  try {
    const credentials = await decryptAppStoreCredentials({
      encryptedData: encryptedCreds.encryptedData,
      encryptedDek: encryptedCreds.encryptedDek,
      keyVersion: encryptedCreds.keyVersion,
    })

    // Override the appId from account-level credentials with the project's actual app ID
    const appStoreHelper = new AppStoreHelper({ ...credentials, appId })
    configureAscMediaBackend(appStoreHelper, projectData, appId)

    // Get the latest editable version
    const versionInfo = await appStoreHelper.getLatestEditableVersion()
    if (!versionInfo) {
      return errorResponse('No app store versions found')
    }

    if (!versionInfo.isEditable) {
      return errorResponse(`Version ${versionInfo.versionString} is in state "${versionInfo.state}" and cannot be edited. Create a new version to upload screenshots.`)
    }

    const now = Timestamp.now()

    // Get all screenshot sets
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

    publishingOperationId = `publish-screenshots:${request.headers.get('idempotency-key')?.trim() || randomUUID()}`
    const reservation = await reserveUsage(authContext, {
      operationId: publishingOperationId,
      usageType: 'publishing',
      units: 1,
      metadata: { route: 'screenshots/push', projectId },
    })
    if (!reservation.allowed) return createReservationErrorResponse(reservation)
    if (reservation.replayed) return errorResponse('This screenshot push was already processed', 409)

    // Get localized screenshots if pushing to multiple locales
    const localizedSnapshot = await basePath.collection('localizedScreenshots').get()
    const localizedScreenshots: { [key: string]: { url: string } } = {}

    for (const doc of localizedSnapshot.docs) {
      const data = doc.data()
      localizedScreenshots[doc.id] = { url: data.marketingImageUrl }
    }

    const results: Array<{
      displayType: string
      locale: string
      success: boolean
      error?: string
      screenshotsUploaded?: number
    }> = []

    let totalFailed = 0

    // Push each screenshot set
    // One App Store slot per device type, so two of ours never overwrite each other
    const { slots: ascSlots } = assignAscSlots(
      Object.entries(screenshotSets).filter(([, set]) => set.screenshots.length > 0).map(([type]) => type)
    )

    for (const [displayType, screenshotSet] of Object.entries(screenshotSets)) {
      const targetLocales = locales || [screenshotSet.locale]
      const ascDisplayType = ascSlots[displayType]
      if (!ascDisplayType) continue
      const screenshotSize = getScreenshotSize(displayType as ScreenshotDisplayType)

      for (const targetLocale of targetLocales) {
        try {
          // Get screenshots for this locale
          const screenshotsToUpload: Array<{ fileName: string; data: Buffer }> = []

          for (const screenshot of sortByPosition(screenshotSet.screenshots)) {
            // Check if we have a localized version
            const localizedKey = `${displayType}_${screenshot.id}_${targetLocale}`
            const localizedVersion = localizedScreenshots[localizedKey]

            const imageUrl = localizedVersion?.url || screenshot.marketingImageUrl

            // Fetch and resize image
            const response = await fetch(imageUrl)
            if (!response.ok) {
              console.error(`Failed to fetch image: ${imageUrl}`)
              continue
            }

            const imageBuffer = Buffer.from(await response.arrayBuffer())
            const resizedBuffer = await resizeToAppStoreSize(imageBuffer, screenshotSize)

            screenshotsToUpload.push({
              fileName: `screenshot-${screenshot.position + 1}.jpg`,
              data: resizedBuffer,
            })
          }

          if (screenshotsToUpload.length === 0) {
            results.push({
              displayType,
              locale: targetLocale,
              success: false,
              error: 'No valid screenshots to upload',
            })
            totalFailed++
            continue
          }

          // Upload to App Store Connect
          const uploadResult = await appStoreHelper.uploadScreenshots(
            targetLocale,
            screenshotsToUpload,
            ascDisplayType
          )

          if (uploadResult.success) {
            results.push({
              displayType,
              locale: targetLocale,
              success: true,
              screenshotsUploaded: screenshotsToUpload.length,
            })
            totalUploaded += screenshotsToUpload.length
          } else {
            results.push({
              displayType,
              locale: targetLocale,
              success: false,
              error: uploadResult.error,
            })
            totalFailed++
          }
        } catch (error) {
          results.push({
            displayType,
            locale: targetLocale,
            success: false,
            error: error instanceof Error ? error.message : 'Upload failed',
          })
          totalFailed++
        }
      }
    }

    // Update screenshot sets sync status
    const batch = adminDb.batch()

    for (const displayType of Object.keys(screenshotSets)) {
      const docRef = basePath.collection('screenshots').doc(displayType)
      batch.update(docRef, {
        syncStatus: totalFailed === 0 ? 'synced' : 'local_changes',
        lastPushedAt: now,
        updatedAt: now,
      })
    }

    // Update project
    batch.update(basePath, {
      screenshotSyncStatus: totalFailed === 0 ? 'synced' : 'local_changes',
      lastScreenshotPushedAt: now,
      updatedAt: now,
    })

    await settleUsage(authContext, publishingOperationId, 'publishing', totalUploaded > 0 ? 1 : 0)
    publishingOperationId = null
    await batch.commit()

    // Log audit event
    if (projectContext.type === 'organization' && projectContext.orgId) {
      await logAuditEvent({
        orgId: projectContext.orgId,
        action: AuditAction.PROJECT_UPDATED,
        userId: authContext.userId,
        resourceType: 'project',
        resourceId: projectId,
        metadata: {
          action: 'screenshots_push',
          displayTypesPushed: Object.keys(screenshotSets),
          totalUploaded,
          totalFailed,
        },
      })
    }

    return Response.json({
      ...appStoreHelper.mediaReport(),
      success: totalFailed === 0,
      totalUploaded,
      totalFailed,
      results,
      versionInfo: {
        id: versionInfo.id,
        version: versionInfo.versionString,
        state: versionInfo.state,
      },
    })
  } catch (error) {
    if (publishingOperationId) {
      if (totalUploaded > 0) await settleUsage(authContext, publishingOperationId, 'publishing', 1)
      else await refundUsage(authContext, publishingOperationId, 'publishing')
    }
    console.error('Error pushing screenshots:', error)
    return errorResponse(
      error instanceof Error ? error.message : 'Failed to push screenshots',
      500
    )
  }
}
