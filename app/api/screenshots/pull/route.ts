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
import { uploadFromUrl } from '@/lib/services/r2'
import { hasActiveTranslationJob } from '@/lib/jobs/translation-job'
import type { Screenshot, ScreenshotSet, ScreenshotHistoryEntry, LocalizedScreenshot } from '@/lib/firebase/firestore'
import { planScreenshotPull } from '@/lib/services/screenshot-pull-plan'

const requestSchema = z.object({
  projectId: z.string(),
  displayTypes: z.array(z.string()).optional(), // Pull specific display types, or all if not specified
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

// Upload pulled images to R2 a few at a time (a pull can be hundreds of images).
async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  async function worker() {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
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
    body = requestSchema.parse(await request.json())
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(`Validation error: ${error.errors.map(e => e.message).join(', ')}`)
    }
    return errorResponse('Invalid request body')
  }

  const { projectId, displayTypes } = body

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
      'Cannot pull screenshots while a translation job is in progress. Please wait for the translation to complete or cancel it first.',
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

    // Get the latest app store version
    const versionInfo = await appStoreHelper.getLatestEditableVersion()
    if (!versionInfo) {
      return errorResponse('No app store versions found')
    }

    // Pull screenshots from App Store Connect
    const pulledScreenshots = await appStoreHelper.pullScreenshots(versionInfo.id, displayTypes)

    if (pulledScreenshots.length === 0) {
      return Response.json({
        success: true,
        message: 'No screenshots found in App Store Connect',
        screenshotSets: [],
        displayTypesPulled: 0,
      })
    }

    // One base set per device in the primary locale; other locales become
    // localizedScreenshots overrides where their image differs.
    const plan = planScreenshotPull(pulledScreenshots, projectData.primaryLocale)
    const screenshotsCollection = basePath.collection('screenshots')
    const localizedCollection = basePath.collection('localizedScreenshots')
    const now = Timestamp.now()
    const pullStamp = Date.now()

    const screenshotSets: { [displayType: string]: ScreenshotSet } = {}
    const displayTypesPulled: string[] = []
    const localesPulled = new Set<string>()
    const localizedDocs: Array<{ id: string; data: LocalizedScreenshot }> = []
    let extraImagesDropped = 0

    const upload = (displayType: string, locale: string, index: number, sourceUrl: string) => uploadFromUrl({
      userId: projectContext.type === 'organization' ? undefined : authContext.userId,
      orgId: projectContext.orgId || undefined,
      projectId,
      category: 'final',
      filename: `screenshot-${displayType}-${locale}-${index + 1}-${pullStamp}.png`,
      sourceUrl,
    })

    for (const set of plan.sets) {
      const { displayType } = set
      const uploadedBase = await mapWithConcurrency(set.base, 6, (image) =>
        upload(displayType, set.baseLocale, set.base.indexOf(image), image.url))

      const screenshots: Screenshot[] = uploadedBase.map((uploaded, i) => ({
        id: `${displayType}-${i}`,
        position: i,
        rawImageUrl: null,
        rawImageKey: null,
        marketingImageUrl: uploaded.url,
        marketingImageKey: uploaded.key,
        headline: '',
        generatedWith: null,
        styleSource: null,
        createdAt: now as any,
        updatedAt: now as any,
      }))

      const uploadedLocalized = await mapWithConcurrency(set.localized, 6, (item) =>
        upload(displayType, item.locale, item.index, item.image.url))
      set.localized.forEach((item, i) => {
        const screenshotId = `${displayType}-${item.index}`
        localizedDocs.push({
          id: `${displayType}_${screenshotId}_${item.locale}`,
          data: {
            locale: item.locale,
            screenshotId,
            displayType,
            marketingImageUrl: uploadedLocalized[i].url,
            marketingImageKey: uploadedLocalized[i].key,
            headline: '',
            sourceHash: 'pulled-from-app-store',
            primaryUpdatedAt: now as any,
            lastModifiedAt: now as any,
            lastModifiedBy: authContext.userId,
          },
        })
        localesPulled.add(item.locale)
      })
      localesPulled.add(set.baseLocale)
      extraImagesDropped += set.extraImagesDropped

      screenshotSets[displayType] = {
        id: displayType,
        displayType,
        locale: set.baseLocale,
        screenshots,
        styleConfig: null,
        syncStatus: 'synced',
        lastPulledAt: now,
        lastPushedAt: null,
        createdAt: now,
        updatedAt: now,
        createdBy: authContext.userId,
      } as ScreenshotSet
      displayTypesPulled.push(displayType)
    }

    // Writes go in chunks (Firestore batches cap at 500 operations). Old
    // overrides for the pulled devices point at replaced screenshots, so they go.
    const writes: Array<(b: FirebaseFirestore.WriteBatch) => void> = []
    if (displayTypesPulled.length > 0) {
      const existingLocalized = await localizedCollection.get()
      for (const doc of existingLocalized.docs) {
        if (displayTypesPulled.some(type => doc.id.startsWith(`${type}_`))) writes.push(b => b.delete(doc.ref))
      }
    }
    for (const [displayType, set] of Object.entries(screenshotSets)) {
      writes.push(b => b.set(screenshotsCollection.doc(displayType), set))
    }
    for (const doc of localizedDocs) {
      writes.push(b => b.set(localizedCollection.doc(doc.id), doc.data))
    }
    for (let i = 0; i < writes.length; i += 450) {
      const chunk = adminDb.batch()
      writes.slice(i, i + 450).forEach(write => write(chunk))
      await chunk.commit()
    }
    const batch = adminDb.batch()

    // Create history entry
    const historyRef = basePath.collection('screenshotHistory').doc()
    const existingHistory = await basePath
      .collection('screenshotHistory')
      .orderBy('version', 'desc')
      .limit(1)
      .get()

    const nextVersion = existingHistory.empty ? 1 : (existingHistory.docs[0].data().version || 0) + 1

    const historyEntry: ScreenshotHistoryEntry = {
      id: historyRef.id,
      screenshotSets,
      version: nextVersion,
      label: 'Pulled from App Store Connect',
      source: 'pull',
      changesSummary: {
        displayTypesModified: displayTypesPulled,
        localesModified: [...localesPulled],
        screenshotsAdded: Object.values(screenshotSets).reduce((sum, set) => sum + set.screenshots.length, 0),
        screenshotsRemoved: 0,
        description: `Pulled ${displayTypesPulled.length} device types in ${localesPulled.size} languages from App Store Connect`,
      },
      createdAt: now as any,
      createdBy: authContext.userId,
    }

    batch.set(historyRef, historyEntry)

    // Update project
    batch.update(basePath, {
      screenshotSyncStatus: 'synced',
      lastScreenshotPulledAt: now,
      updatedAt: now,
    })

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
          action: 'screenshots_pull',
          displayTypesPulled,
          screenshotCount: Object.values(screenshotSets).reduce((sum, set) => sum + set.screenshots.length, 0),
        },
      })
    }

    return Response.json({
      success: true,
      screenshotSets,
      displayTypesPulled: displayTypesPulled.length,
      localesPulled: localesPulled.size,
      localizedScreenshots: localizedDocs.length,
      extraImagesDropped,
      unsupportedDisplayTypes: plan.unsupported,
      totalScreenshots: Object.values(screenshotSets).reduce((sum, set) => sum + set.screenshots.length, 0),
      historyVersion: nextVersion,
    })
  } catch (error) {
    console.error('Error pulling screenshots:', error)
    return errorResponse(
      error instanceof Error ? error.message : 'Failed to pull screenshots',
      500
    )
  }
}
