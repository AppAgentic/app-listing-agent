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
import type { ScreenshotSet, ScreenshotDisplayType } from '@/lib/firebase/firestore'
import { createReservationErrorResponse, refundUsage, reserveUsage, settleUsage } from '@/lib/api/usage'
import { randomUUID } from 'node:crypto'

const pushRequestSchema = z.object({
  projectId: z.string(),
  displayTypes: z.array(z.string()).optional(),
  locales: z.array(z.string()).optional(),
})

interface UploadTask {
  displayType: string
  locale: string
  screenshots: Array<{ id: string; url: string; position: number }>
  ascDisplayType: string
  screenshotSize: ScreenshotSize
}

interface UploadResult {
  displayType: string
  locale: string
  success: boolean
  error?: string
  screenshotsUploaded?: number
}

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

// Helper to send SSE event
function sendEvent(controller: ReadableStreamDefaultController, event: string, data: unknown) {
  const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
  controller.enqueue(new TextEncoder().encode(message))
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
    return errorResponse('App Store credentials not configured.', 400)
  }

  const encryptedCreds = credentialsDoc.data()!

  const publishingOperationId = `publish-screenshots-stream:${request.headers.get('idempotency-key')?.trim() || randomUUID()}`
  const reservation = await reserveUsage(authContext, {
    operationId: publishingOperationId,
    usageType: 'publishing',
    units: 1,
    metadata: { route: 'screenshots/push/stream', projectId },
  })
  if (!reservation.allowed) return createReservationErrorResponse(reservation)
  if (reservation.replayed) return errorResponse('This screenshot push was already processed', 409)

  // Create streaming response
  const stream = new ReadableStream({
    async start(controller) {
      const results: UploadResult[] = []
      let usageFinalized = false

      try {
        const credentials = await decryptAppStoreCredentials({
          encryptedData: encryptedCreds.encryptedData,
          encryptedDek: encryptedCreds.encryptedDek,
          keyVersion: encryptedCreds.keyVersion,
        })

        const appStoreHelper = new AppStoreHelper({ ...credentials, appId })
        configureAscMediaBackend(appStoreHelper, projectData, appId)

        // Get the latest editable version
        const versionInfo = await appStoreHelper.getLatestEditableVersion()
        if (!versionInfo) {
          await settleUsage(authContext, publishingOperationId, 'publishing', 0)
          usageFinalized = true
          sendEvent(controller, 'error', { message: 'No app store versions found' })
          controller.close()
          return
        }

        if (!versionInfo.isEditable) {
          await settleUsage(authContext, publishingOperationId, 'publishing', 0)
          usageFinalized = true
          sendEvent(controller, 'error', {
            message: `Version ${versionInfo.versionString} is in state "${versionInfo.state}" and cannot be edited.`
          })
          controller.close()
          return
        }

        // Get all screenshot sets
        const screenshotsSnapshot = await basePath.collection('screenshots').get()
        const screenshotSets: { [displayType: string]: ScreenshotSet } = {}

        for (const doc of screenshotsSnapshot.docs) {
          if (!displayTypes || displayTypes.includes(doc.id)) {
            screenshotSets[doc.id] = doc.data() as ScreenshotSet
          }
        }

        if (Object.keys(screenshotSets).length === 0) {
          await settleUsage(authContext, publishingOperationId, 'publishing', 0)
          usageFinalized = true
          sendEvent(controller, 'error', { message: 'No screenshots to push' })
          controller.close()
          return
        }

        // Get localized screenshots
        const localizedSnapshot = await basePath.collection('localizedScreenshots').get()
        const localizedScreenshots: { [key: string]: { url: string } } = {}

        for (const doc of localizedSnapshot.docs) {
          const data = doc.data()
          localizedScreenshots[doc.id] = { url: data.marketingImageUrl }
        }

        // Build list of upload tasks
        const uploadTasks: UploadTask[] = []

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
            const screenshots = sortByPosition(screenshotSet.screenshots).map(s => {
              const localizedKey = `${displayType}_${s.id}_${targetLocale}`
              const localizedVersion = localizedScreenshots[localizedKey]
              return {
                id: s.id,
                url: localizedVersion?.url || s.marketingImageUrl,
                position: s.position,
              }
            })

            uploadTasks.push({
              displayType,
              locale: targetLocale,
              screenshots,
              ascDisplayType,
              screenshotSize,
            })
          }
        }

        // Send start event
        sendEvent(controller, 'start', {
          total: uploadTasks.length,
          tasks: uploadTasks.map(t => ({
            displayType: t.displayType,
            locale: t.locale,
            screenshotCount: t.screenshots.length,
          })),
        })

        // Process uploads in parallel with concurrency limit
        const CONCURRENCY_LIMIT = 3
        let completedCount = 0

        for (let i = 0; i < uploadTasks.length; i += CONCURRENCY_LIMIT) {
          const batch = uploadTasks.slice(i, i + CONCURRENCY_LIMIT)

          // Send progress for batch starting
          sendEvent(controller, 'progress', {
            current: completedCount,
            total: uploadTasks.length,
            status: 'uploading',
            batch: batch.map(t => ({ displayType: t.displayType, locale: t.locale })),
          })

          // Process batch in parallel
          const batchPromises = batch.map(async (task) => {
            try {
              // Fetch and resize all screenshots
              const screenshotsToUpload: Array<{ fileName: string; data: Buffer }> = []

              for (const screenshot of task.screenshots) {
                const response = await fetch(screenshot.url)
                if (!response.ok) {
                  console.error(`Failed to fetch image: ${screenshot.url}`)
                  continue
                }

                const imageBuffer = Buffer.from(await response.arrayBuffer())
                const resizedBuffer = await resizeToAppStoreSize(imageBuffer, task.screenshotSize)

                screenshotsToUpload.push({
                  fileName: `screenshot-${screenshot.position + 1}.jpg`,
                  data: resizedBuffer,
                })
              }

              if (screenshotsToUpload.length === 0) {
                const result: UploadResult = {
                  displayType: task.displayType,
                  locale: task.locale,
                  success: false,
                  error: 'No valid screenshots to upload',
                }
                completedCount++
                sendEvent(controller, 'progress', {
                  current: completedCount,
                  total: uploadTasks.length,
                  displayType: task.displayType,
                  locale: task.locale,
                  status: 'failed',
                  error: result.error,
                })
                return result
              }

              // Upload to App Store Connect
              const uploadResult = await appStoreHelper.uploadScreenshots(
                task.locale,
                screenshotsToUpload,
                task.ascDisplayType
              )

              const result: UploadResult = uploadResult.success
                ? {
                    displayType: task.displayType,
                    locale: task.locale,
                    success: true,
                    screenshotsUploaded: screenshotsToUpload.length,
                  }
                : {
                    displayType: task.displayType,
                    locale: task.locale,
                    success: false,
                    error: uploadResult.error,
                  }

              completedCount++
              sendEvent(controller, 'progress', {
                current: completedCount,
                total: uploadTasks.length,
                displayType: task.displayType,
                locale: task.locale,
                status: result.success ? 'success' : 'failed',
                screenshotsUploaded: result.screenshotsUploaded,
                error: result.error,
              })

              return result
            } catch (error) {
              const result: UploadResult = {
                displayType: task.displayType,
                locale: task.locale,
                success: false,
                error: error instanceof Error ? error.message : 'Upload failed',
              }

              completedCount++
              sendEvent(controller, 'progress', {
                current: completedCount,
                total: uploadTasks.length,
                displayType: task.displayType,
                locale: task.locale,
                status: 'failed',
                error: result.error,
              })

              return result
            }
          })

          const batchResults = await Promise.all(batchPromises)
          results.push(...batchResults)
        }

        const now = Timestamp.now()
        const totalUploaded = results.filter(r => r.success).reduce((sum, r) => sum + (r.screenshotsUploaded || 0), 0)
        const totalFailed = results.filter(r => !r.success).length

        // Update screenshot sets sync status
        const updateBatch = adminDb.batch()

        for (const displayType of Object.keys(screenshotSets)) {
          const docRef = basePath.collection('screenshots').doc(displayType)
          updateBatch.update(docRef, {
            syncStatus: totalFailed === 0 ? 'synced' : 'local_changes',
            lastPushedAt: now,
            updatedAt: now,
          })
        }

        // Update project
        updateBatch.update(basePath, {
          screenshotSyncStatus: totalFailed === 0 ? 'synced' : 'local_changes',
          lastScreenshotPushedAt: now,
          updatedAt: now,
        })

        await settleUsage(authContext, publishingOperationId, 'publishing', totalUploaded > 0 ? 1 : 0)
        usageFinalized = true
        await updateBatch.commit()

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

        // Send complete event
        sendEvent(controller, 'complete', {
          ...appStoreHelper.mediaReport(),
          success: totalFailed === 0,
          results,
          stats: {
            total: uploadTasks.length,
            success: results.filter(r => r.success).length,
            failed: totalFailed,
            screenshotsUploaded: totalUploaded,
          },
          versionInfo: {
            id: versionInfo.id,
            version: versionInfo.versionString,
            state: versionInfo.state,
          },
        })

      } catch (err) {
        if (!usageFinalized) {
          try {
            const providerChanged = results.some(result => result.success && (result.screenshotsUploaded || 0) > 0)
            if (providerChanged) await settleUsage(authContext, publishingOperationId, 'publishing', 1)
            else await refundUsage(authContext, publishingOperationId, 'publishing')
            usageFinalized = true
          } catch (usageError) {
            console.error('[Screenshot Push Stream] Failed to finalize usage reservation:', usageError)
          }
        }
        sendEvent(controller, 'error', {
          message: err instanceof Error ? err.message : 'Push failed',
        })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  })
}
