import { readBoundedJson, RequestBodyLimitError } from '@/lib/api/bounded-body'
import { NextRequest } from 'next/server'
import { z } from 'zod'
import { authenticateRequest, errorResponse, unauthorizedResponse } from '@/lib/api/auth'
import { createReservationErrorResponse, UsageLimitError, withUsageReservation } from '@/lib/api/usage'
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
  locales: z.array(z.string()).optional(), // If not provided, publish all enabled locales
  dryRun: z.boolean().default(false),
})

interface PublishResult {
  locale: string
  success: boolean
  error?: string
}

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

  const { projectId, store, locales: requestedLocales, dryRun } = body

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
    return errorResponse(`${store === 'appstore' ? 'App Store' : 'Play Store'} credentials not configured. Go to Settings to add your credentials.`, 400)
  }

  // Get all metadata
  const metadataSnapshot = await basePath.collection('metadata').get()
  const allMetadata: { [locale: string]: LocalizedMetadata } = {}
  for (const doc of metadataSnapshot.docs) {
    allMetadata[doc.id] = doc.data() as LocalizedMetadata
  }

  if (Object.keys(allMetadata).length === 0) {
    return errorResponse('No metadata to publish. Pull from store or add metadata first.', 400)
  }

  // Determine which locales to publish
  const localesToPublish = requestedLocales || Object.keys(allMetadata)
  const missingLocales = localesToPublish.filter(l => !allMetadata[l])
  if (missingLocales.length > 0) {
    return errorResponse(`Locales not found: ${missingLocales.join(', ')}`, 400)
  }

  // Prepare preview data (store-specific fields)
  const previewData = localesToPublish.map(locale => {
    const metadata = allMetadata[locale]
    if (store === 'playstore') {
      const fullDesc = metadata.fullDescription || metadata.description || ''
      const mappedLocale = mapLocale(locale, 'ios', 'android')
      return {
        locale: mappedLocale,
        fields: {
          title: metadata.name || '(empty)',
          shortDescription: metadata.shortDescription || '(empty)',
          fullDescription: fullDesc?.substring(0, 100) + (fullDesc?.length > 100 ? '...' : '') || '(empty)',
        },
        charCounts: {
          title: metadata.name?.length || 0,
          shortDescription: metadata.shortDescription?.length || 0,
          fullDescription: fullDesc?.length || 0,
        },
      }
    }
    return {
      locale,
      fields: {
        name: metadata.name || '(empty)',
        subtitle: metadata.subtitle || '(empty)',
        keywords: metadata.keywords?.substring(0, 50) + (metadata.keywords?.length > 50 ? '...' : '') || '(empty)',
        description: metadata.description?.substring(0, 100) + (metadata.description?.length > 100 ? '...' : '') || '(empty)',
        whatsNew: metadata.whatsNew?.substring(0, 100) + (metadata.whatsNew?.length > 100 ? '...' : '') || '(empty)',
      },
      charCounts: {
        name: metadata.name?.length || 0,
        subtitle: metadata.subtitle?.length || 0,
        keywords: metadata.keywords?.length || 0,
        description: metadata.description?.length || 0,
        whatsNew: metadata.whatsNew?.length || 0,
      },
    }
  })

  // Dry run - just return preview
  if (dryRun) {
    return Response.json({
      success: true,
      dryRun: true,
      preview: previewData,
      totalLocales: localesToPublish.length,
    })
  }

  // Actual publish
  const encryptedCreds = credentialsDoc.data()!

  // Get the project document to get the actual app ID / package name
  const projectDoc = await basePath.get()
  if (!projectDoc.exists) {
    return errorResponse('Project not found', 404)
  }
  const projectData = projectDoc.data()!

  if (store === 'appstore') {
    const appId = projectData.appStoreAppId
    if (!appId) {
      return errorResponse('App Store App ID not configured for this project. Edit the project to add the App ID.', 400)
    }

    const credentials = await decryptAppStoreCredentials({
      encryptedData: encryptedCreds.encryptedData,
      encryptedDek: encryptedCreds.encryptedDek,
      keyVersion: encryptedCreds.keyVersion,
    })

    // Override the appId from account-level credentials with the project's actual app ID
    const helper = new AppStoreHelper({ ...credentials, appId })
    let results: PublishResult[]

    // Get primary locale's URLs to use as fallback for all locales
    // URLs are typically not translated and should be the same across all languages
    const primaryLocale = projectData.primaryLocale || 'en-US'
    const primaryMetadata = allMetadata[primaryLocale]
    const primarySupportUrl = primaryMetadata?.supportUrl || undefined
    const primaryMarketingUrl = primaryMetadata?.marketingUrl || undefined

    try {
      results = await withUsageReservation(
        authContext,
        {
          operationId: `metadata-publish-appstore:${request.headers.get('idempotency-key')?.trim() || randomUUID()}`,
          usageType: 'publishing',
          units: 1,
          metadata: { route: 'metadata/publish', projectId, store },
        },
        async () => {
          const uploadResults: PublishResult[] = []
          for (const locale of localesToPublish) {
            const metadata = allMetadata[locale]
            const appStoreMetadata: AppStoreMetadata = {
              locale,
              name: metadata.name,
              subtitle: metadata.subtitle,
              description: metadata.description,
              keywords: metadata.keywords,
              whatsNew: metadata.whatsNew,
              supportUrl: primarySupportUrl,
              marketingUrl: primaryMarketingUrl,
              privacyUrl: metadata.privacyUrl || undefined,
              promotionalText: metadata.promotionalText || undefined,
            }
            uploadResults.push(await helper.uploadMetadata(appStoreMetadata))
          }
          return uploadResults
        },
        uploadResults => uploadResults.some(result => result.success) ? 1 : 0,
      )
    } catch (error) {
      if (error instanceof UsageLimitError) return createReservationErrorResponse(error.result)
      if (error instanceof Error && error.message.includes('already been processed')) {
        return errorResponse('This publishing operation was already processed', 409)
      }
      throw error
    }

    const successCount = results.filter(r => r.success).length
    const failedCount = results.filter(r => !r.success).length

    const now = Timestamp.now()

    // Create history entry for publish
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
        sourceDetails: `Published to App Store Connect (${successCount}/${localesToPublish.length} locales)`,
        changesSummary: {
          localesModified: results.filter(r => r.success).map(r => r.locale),
          fieldsModified: ['all'],
          description: `Published ${successCount} locales to App Store Connect`,
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
          store: 'appstore',
          totalLocales: localesToPublish.length,
          successCount,
          failedCount,
          failedLocales: results.filter(r => !r.success).map(r => r.locale),
        },
      })
    }

    return Response.json({
      success: successCount > 0,
      results,
      stats: {
        total: localesToPublish.length,
        success: successCount,
        failed: failedCount,
      },
    })
  } else {
    // Play Store publish
    const packageName = projectData.playStorePackage
    if (!packageName) {
      return errorResponse('Play Store Package Name not configured for this project. Edit the project to add the Package Name.', 400)
    }

    const credentials = await decryptPlayStoreCredentials({
      encryptedData: encryptedCreds.encryptedData,
      encryptedDek: encryptedCreds.encryptedDek,
      keyVersion: encryptedCreds.keyVersion,
    })

    // Override the packageName from account-level credentials with the project's actual package name
    const helper = new PlayStoreHelper({ ...credentials, packageName })

    // Map LocalizedMetadata to PlayStoreMetadata format
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

    // Upload all locales in a single batch (more efficient)
    let results: PublishResult[]
    try {
      results = await withUsageReservation(
        authContext,
        {
          operationId: `metadata-publish-playstore:${request.headers.get('idempotency-key')?.trim() || randomUUID()}`,
          usageType: 'publishing',
          units: 1,
          metadata: { route: 'metadata/publish', projectId, store },
        },
        async () => helper.uploadMetadataBatch(playStoreMetadataList),
        uploadResults => uploadResults.some(result => result.success) ? 1 : 0,
      )
    } catch (error) {
      if (error instanceof UsageLimitError) return createReservationErrorResponse(error.result)
      if (error instanceof Error && error.message.includes('already been processed')) {
        return errorResponse('This publishing operation was already processed', 409)
      }
      throw error
    }

    const successCount = results.filter(r => r.success).length
    const failedCount = results.filter(r => !r.success).length

    const now = Timestamp.now()

    // Create history entry for publish
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
        sourceDetails: `Published to Google Play Console (${successCount}/${localesToPublish.length} locales)`,
        changesSummary: {
          localesModified: results.filter(r => r.success).map(r => r.locale),
          fieldsModified: ['all'],
          description: `Published ${successCount} locales to Google Play Console`,
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
          store: 'playstore',
          totalLocales: localesToPublish.length,
          successCount,
          failedCount,
          failedLocales: results.filter(r => !r.success).map(r => r.locale),
        },
      })
    }

    return Response.json({
      success: successCount > 0,
      results,
      stats: {
        total: localesToPublish.length,
        success: successCount,
        failed: failedCount,
      },
    })
  }
}
