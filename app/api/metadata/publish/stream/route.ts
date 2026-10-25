import { readBoundedJson, RequestBodyLimitError } from '@/lib/api/bounded-body'
import { NextRequest } from 'next/server'
import { z } from 'zod'
import { authenticateRequest, errorResponse, unauthorizedResponse } from '@/lib/api/auth'
import { createReservationErrorResponse, refundUsage, reserveUsage, settleUsage } from '@/lib/api/usage'
import { getProjectContext, hasContextPermission, getAccountContext, AccountContext } from '@/lib/org/context'
import { getSession } from '@/lib/auth/session'
import { AppStoreHelper, AppStoreMetadata } from '@/lib/services/appstore'
import { PlayStoreHelper, PlayStoreMetadata } from '@/lib/services/playstore'
import { decryptAppStoreCredentials, decryptPlayStoreCredentials } from '@/lib/crypto/credentials'
import { adminDb } from '@/lib/firebase/admin'
import { logAuditEvent, AuditAction } from '@/lib/org/audit'
import { Timestamp } from 'firebase-admin/firestore'
import type { LocalizedMetadata, MetadataHistoryEntry } from '@/lib/firebase/firestore'
import { mapLocale } from '@/lib/constants'
import { randomUUID } from 'node:crypto'

const requestSchema = z.object({
  projectId: z.string(),
  store: z.enum(['appstore', 'playstore']).default('appstore'),
  locales: z.array(z.string()).optional(),
})

interface PublishResult {
  locale: string
  success: boolean
  error?: string
}

// Helper to get auth context from either API key or session
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

// Helper to send SSE event
function sendEvent(controller: ReadableStreamDefaultController, event: string, data: any) {
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
    body = requestSchema.parse(await readBoundedJson(request))
  } catch (error) {
    if (error instanceof RequestBodyLimitError) return Response.json({ error: error.message }, { status: 413 })
    return errorResponse('Invalid request body')
  }

  const { projectId, store, locales: requestedLocales } = body

  // Get project context
  const projectContext = await getProjectContext(authContext.userId, projectId)
  if (!projectContext) {
    return errorResponse('Project not found', 404)
  }

  // Check permission
  if (!hasContextPermission(projectContext, 'canCreateProjects')) {
    return errorResponse('Permission denied', 403)
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

  const credentialsDoc = await accountCredentialsPath.doc(store).get()
  if (!credentialsDoc.exists) {
    return errorResponse(`${store === 'appstore' ? 'App Store' : 'Play Store'} credentials not configured.`, 400)
  }

  // Get all metadata
  const metadataSnapshot = await basePath.collection('metadata').get()
  const allMetadata: { [locale: string]: LocalizedMetadata } = {}
  for (const doc of metadataSnapshot.docs) {
    allMetadata[doc.id] = doc.data() as LocalizedMetadata
  }

  if (Object.keys(allMetadata).length === 0) {
    return errorResponse('No metadata to publish.', 400)
  }

  // Determine which locales to publish
  const localesToPublish = requestedLocales || Object.keys(allMetadata)
  const missingLocales = localesToPublish.filter(l => !allMetadata[l])
  if (missingLocales.length > 0) {
    return errorResponse(`Locales not found: ${missingLocales.join(', ')}`, 400)
  }

  const encryptedCreds = credentialsDoc.data()!

  // Get the project document
  const projectDoc = await basePath.get()
  if (!projectDoc.exists) {
    return errorResponse('Project not found', 404)
  }
  const projectData = projectDoc.data()!

  if (store === 'appstore' && !projectData.appStoreAppId) {
    return errorResponse('App Store App ID not configured', 400)
  }
  if (store === 'playstore' && !projectData.playStorePackage) {
    return errorResponse('Play Store Package Name not configured', 400)
  }

  const usageOperationId = `metadata-publish-stream:${request.headers.get('idempotency-key')?.trim() || randomUUID()}`
  const reservation = await reserveUsage(authContext, {
    operationId: usageOperationId,
    usageType: 'publishing',
    units: 1,
    metadata: { route: 'metadata/publish/stream', projectId, store },
  })
  if (!reservation.allowed) return createReservationErrorResponse(reservation)
  if (reservation.replayed) return errorResponse('This publishing operation was already processed', 409)

  // Create streaming response
  const stream = new ReadableStream({
    async start(controller) {
      const results: PublishResult[] = []
      let usageFinalized = false

      try {
        // Send initial event
        sendEvent(controller, 'start', {
          total: localesToPublish.length,
          locales: localesToPublish,
        })

        if (store === 'appstore') {
          const appId = projectData.appStoreAppId

          const credentials = await decryptAppStoreCredentials({
            encryptedData: encryptedCreds.encryptedData,
            encryptedDek: encryptedCreds.encryptedDek,
            keyVersion: encryptedCreds.keyVersion,
          })

          const helper = new AppStoreHelper({ ...credentials, appId })

          // Get primary locale's URLs to use as fallback for all locales
          // URLs are typically not translated and should be the same across all languages
          const primaryLocale = projectData.primaryLocale || 'en-US'
          const primaryMetadata = allMetadata[primaryLocale]
          const primarySupportUrl = primaryMetadata?.supportUrl || undefined
          const primaryMarketingUrl = primaryMetadata?.marketingUrl || undefined

          // Parallel upload with concurrency limit for faster publishing
          const CONCURRENCY_LIMIT = 5
          let completedCount = 0

          // Process locales in parallel batches
          for (let i = 0; i < localesToPublish.length; i += CONCURRENCY_LIMIT) {
            const batch = localesToPublish.slice(i, i + CONCURRENCY_LIMIT)

            // Send progress for batch starting
            sendEvent(controller, 'progress', {
              current: completedCount,
              total: localesToPublish.length,
              locale: batch.join(', '),
              status: 'uploading',
              batch: batch,
            })

            // Process batch in parallel
            const batchPromises = batch.map(async (locale) => {
              const metadata = allMetadata[locale]
              const appStoreMetadata: AppStoreMetadata = {
                locale,
                name: metadata.name,
                subtitle: metadata.subtitle,
                description: metadata.description,
                keywords: metadata.keywords,
                whatsNew: metadata.whatsNew,
                // Use primary locale URLs for all languages (URLs are not translated)
                supportUrl: primarySupportUrl,
                marketingUrl: primaryMarketingUrl,
                privacyUrl: metadata.privacyUrl || undefined,
                promotionalText: metadata.promotionalText || undefined,
              }

              const result = await helper.uploadMetadata(appStoreMetadata)

              // Increment completed count and send progress
              completedCount++
              sendEvent(controller, 'progress', {
                current: completedCount,
                total: localesToPublish.length,
                locale,
                status: result.success ? 'success' : 'failed',
                error: result.error,
              })

              return result
            })

            const batchResults = await Promise.all(batchPromises)
            results.push(...batchResults)
          }
        } else {
          // Play Store
          const packageName = projectData.playStorePackage

          const credentials = await decryptPlayStoreCredentials({
            encryptedData: encryptedCreds.encryptedData,
            encryptedDek: encryptedCreds.encryptedDek,
            keyVersion: encryptedCreds.keyVersion,
          })

          const helper = new PlayStoreHelper({ ...credentials, packageName })

          // For Play Store, we batch upload but still report progress
          // Priority: Android-specific fields first, then iOS fallbacks (from cross-store sync)
          // Convert locale codes from iOS format to Android format (e.g., 'he' → 'iw-IL', 'zh-Hans' → 'zh-CN')
          const playStoreMetadataList: PlayStoreMetadata[] = localesToPublish.map(locale => {
            const metadata = allMetadata[locale]
            return {
              locale: mapLocale(locale, 'ios', 'android'),
              title: metadata.name || '',
              shortDescription: metadata.shortDescription || metadata.subtitle || '',
              fullDescription: metadata.fullDescription || metadata.description || '',
            }
          })

          sendEvent(controller, 'progress', {
            current: 0,
            total: localesToPublish.length,
            status: 'uploading',
          })

          const batchResults = await helper.uploadMetadataBatch(playStoreMetadataList)
          results.push(...batchResults)

          // Log any failures
          const failures = batchResults.filter(r => !r.success)
          if (failures.length > 0) {
            console.error('[Publish Stream] Play Store failures:', failures)
          }

          // Send individual results
          for (let i = 0; i < batchResults.length; i++) {
            sendEvent(controller, 'progress', {
              current: i + 1,
              total: localesToPublish.length,
              locale: batchResults[i].locale,
              status: batchResults[i].success ? 'success' : 'failed',
              error: batchResults[i].error,
            })
          }
        }

        const successCount = results.filter(r => r.success).length
        const failedCount = results.filter(r => !r.success).length

        await settleUsage(authContext, usageOperationId, 'publishing', successCount > 0 ? 1 : 0)
        usageFinalized = true

        const now = Timestamp.now()

        // Create history entry
        if (successCount > 0) {
          const existingHistory = await basePath
            .collection('metadataHistory')
            .orderBy('version', 'desc')
            .limit(1)
            .get()

          const newVersion = existingHistory.empty ? 1 : (existingHistory.docs[0].data().version || 0) + 1

          const historyRef = basePath.collection('metadataHistory').doc()
          const historyEntry: MetadataHistoryEntry = {
            id: historyRef.id,
            locales: allMetadata,
            version: newVersion,
            label: null,
            source: 'publish',
            sourceDetails: `Published to ${store === 'appstore' ? 'App Store Connect' : 'Google Play Console'} (${successCount}/${localesToPublish.length} locales)`,
            changesSummary: {
              localesModified: results.filter(r => r.success).map(r => r.locale),
              fieldsModified: ['all'],
              description: `Published ${successCount} locales`,
            },
            createdAt: now as any,
            createdBy: authContext.userId,
          }

          await historyRef.set(historyEntry)

          // Update project
          await basePath.update({
            lastPushedAt: now,
            syncStatus: failedCount === 0 ? 'synced' : 'local_changes',
            updatedAt: now,
          })
        }

        // Log audit event
        if (projectContext.type === 'organization' && projectContext.orgId) {
          await logAuditEvent({
            orgId: projectContext.orgId,
            action: AuditAction.UPLOAD_RUN,
            userId: authContext.userId,
            resourceType: 'project',
            resourceId: projectId,
            metadata: {
              store,
              totalLocales: localesToPublish.length,
              successCount,
              failedCount,
            },
          })
        }

        // Send complete event
        sendEvent(controller, 'complete', {
          success: successCount > 0,
          results,
          stats: {
            total: localesToPublish.length,
            success: successCount,
            failed: failedCount,
          },
        })

      } catch (err) {
        console.error('[Publish Stream] Error:', err)
        if (!usageFinalized) {
          try {
            if (results.some(result => result.success)) {
              await settleUsage(authContext, usageOperationId, 'publishing', 1)
            } else {
              await refundUsage(authContext, usageOperationId, 'publishing')
            }
            usageFinalized = true
          } catch (usageError) {
            console.error('[Publish Stream] Failed to finalize usage reservation:', usageError)
          }
        }
        sendEvent(controller, 'error', {
          message: err instanceof Error ? err.message : 'Publish failed',
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
