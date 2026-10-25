import { readBoundedJson, RequestBodyLimitError } from '@/lib/api/bounded-body'
import { NextRequest } from 'next/server'
import { z } from 'zod'
import { authenticateRequest, errorResponse, unauthorizedResponse } from '@/lib/api/auth'
import { getProjectContext, hasContextPermission, getAccountContext, AccountContext } from '@/lib/org/context'
import { getSession } from '@/lib/auth/session'
import { adminDb } from '@/lib/firebase/admin'
import { logAuditEvent, AuditAction } from '@/lib/org/audit'
import { Timestamp } from 'firebase-admin/firestore'
import { deleteFile } from '@/lib/services/r2'
import type { ScreenshotDisplayType, ScreenshotSet } from '@/lib/firebase/firestore'

const requestSchema = z.object({
  projectId: z.string(),
  displayType: z.string(), // The device type to delete
  locale: z.string().optional(), // Locale to delete - if primary locale, deletes primary screenshots; otherwise deletes localized
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
    body = requestSchema.parse(await readBoundedJson(request))
  } catch (error) {
    if (error instanceof RequestBodyLimitError) return Response.json({ error: error.message }, { status: 413 })
    if (error instanceof z.ZodError) {
      return errorResponse(`Validation error: ${error.issues.map(e => e.message).join(', ')}`)
    }
    return errorResponse('Invalid request body')
  }

  const { projectId, displayType, locale } = body

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

  // Get project data
  const projectDoc = await basePath.get()
  if (!projectDoc.exists) {
    return errorResponse('Project not found', 404)
  }

  const projectData = projectDoc.data()!
  const primaryLocale = projectData.primaryLocale || 'en-US'
  const targetLocale = locale || primaryLocale
  const isDeletingPrimaryLocale = targetLocale === primaryLocale

  try {
    const batch = adminDb.batch()
    const now = Timestamp.now()
    let screenshotsDeleted = 0
    const deletePromises: Promise<void>[] = []

    if (isDeletingPrimaryLocale) {
      // Deleting primary locale screenshots - delete from screenshots collection
      const screenshotDoc = await basePath.collection('screenshots').doc(displayType).get()

      if (!screenshotDoc.exists) {
        return errorResponse('Screenshot set not found', 404)
      }

      const screenshotSet = screenshotDoc.data() as ScreenshotSet
      screenshotsDeleted = screenshotSet.screenshots.length

      // Delete R2 files for primary screenshots
      for (const screenshot of screenshotSet.screenshots) {
        if (screenshot.marketingImageKey) {
          deletePromises.push(deleteFile(screenshot.marketingImageKey).catch(err => {
            console.warn(`Failed to delete R2 file ${screenshot.marketingImageKey}:`, err)
          }))
        }
        if (screenshot.rawImageKey) {
          deletePromises.push(deleteFile(screenshot.rawImageKey).catch(err => {
            console.warn(`Failed to delete R2 file ${screenshot.rawImageKey}:`, err)
          }))
        }
      }

      // Delete the primary screenshot set document
      batch.delete(basePath.collection('screenshots').doc(displayType))

      // Also delete any localized versions for this display type
      const localizedDocs = await basePath.collection('localizedScreenshots')
        .where('displayType', '==', displayType)
        .get()

      for (const doc of localizedDocs.docs) {
        const data = doc.data()
        if (data.marketingImageKey) {
          deletePromises.push(deleteFile(data.marketingImageKey).catch(err => {
            console.warn(`Failed to delete R2 file ${data.marketingImageKey}:`, err)
          }))
        }
        batch.delete(doc.ref)
      }
    } else {
      // Deleting translated locale screenshots - only delete from localizedScreenshots
      // First, get the primary screenshot set to know which screenshots exist
      const screenshotDoc = await basePath.collection('screenshots').doc(displayType).get()

      if (!screenshotDoc.exists) {
        return errorResponse('Screenshot set not found', 404)
      }

      const screenshotSet = screenshotDoc.data() as ScreenshotSet

      // Delete localized screenshots for this display type and locale
      for (const screenshot of screenshotSet.screenshots) {
        const localizedKey = `${displayType}_${screenshot.id}_${targetLocale}`
        const localizedDoc = await basePath.collection('localizedScreenshots').doc(localizedKey).get()

        if (localizedDoc.exists) {
          const data = localizedDoc.data()!
          screenshotsDeleted++

          if (data.marketingImageKey) {
            deletePromises.push(deleteFile(data.marketingImageKey).catch(err => {
              console.warn(`Failed to delete R2 file ${data.marketingImageKey}:`, err)
            }))
          }

          batch.delete(localizedDoc.ref)
        }
      }

      if (screenshotsDeleted === 0) {
        return errorResponse(`No screenshots found for locale ${targetLocale}`, 404)
      }
    }

    // Wait for R2 deletions
    await Promise.all(deletePromises)

    // Update project metadata
    batch.update(basePath, {
      screenshotSyncStatus: 'local_changes',
      updatedAt: now,
    })

    // Create history entry
    const historyRef = basePath.collection('screenshotHistory').doc()
    const existingHistory = await basePath
      .collection('screenshotHistory')
      .orderBy('version', 'desc')
      .limit(1)
      .get()

    const nextVersion = existingHistory.empty ? 1 : (existingHistory.docs[0].data().version || 0) + 1

    batch.set(historyRef, {
      id: historyRef.id,
      screenshotSets: {},
      version: nextVersion,
      label: isDeletingPrimaryLocale
        ? `Deleted ${displayType} screenshots`
        : `Deleted ${displayType} screenshots for ${targetLocale}`,
      source: 'delete',
      changesSummary: {
        displayTypesModified: [displayType],
        localesModified: [targetLocale],
        screenshotsAdded: 0,
        screenshotsRemoved: screenshotsDeleted,
        description: isDeletingPrimaryLocale
          ? `Deleted ${screenshotsDeleted} primary screenshots for ${displayType}`
          : `Deleted ${screenshotsDeleted} translated screenshots for ${displayType} (${targetLocale})`,
      },
      createdAt: now,
      createdBy: authContext.userId,
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
          action: 'screenshots_delete',
          displayType,
          locale: targetLocale,
          isPrimaryLocale: isDeletingPrimaryLocale,
          screenshotsDeleted,
        },
      })
    }

    return Response.json({
      success: true,
      displayType,
      locale: targetLocale,
      isPrimaryLocale: isDeletingPrimaryLocale,
      screenshotsDeleted,
      historyVersion: nextVersion,
      message: isDeletingPrimaryLocale
        ? `Deleted ${screenshotsDeleted} screenshots locally. Push to App Store Connect to sync changes.`
        : `Deleted ${screenshotsDeleted} translated screenshots for ${targetLocale}. Push to App Store Connect to sync changes.`,
    })
  } catch (error) {
    console.error('Error deleting screenshot set:', error)
    return errorResponse(
      error instanceof Error ? error.message : 'Failed to delete screenshot set',
      500
    )
  }
}
