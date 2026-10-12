import { NextRequest } from 'next/server'
import { z } from 'zod'
import { authenticateRequest, errorResponse, unauthorizedResponse } from '@/lib/api/auth'
import { getProjectContext, hasContextPermission, getAccountContext, AccountContext } from '@/lib/org/context'
import { getSession } from '@/lib/auth/session'
import { adminDb } from '@/lib/firebase/admin'
import { logAuditEvent, AuditAction } from '@/lib/org/audit'
import { Timestamp } from 'firebase-admin/firestore'
import type { ScreenshotSet, ScreenshotHistoryEntry, ScreenshotSource } from '@/lib/firebase/firestore'

const screenshotSchema = z.object({
  id: z.string(),
  position: z.number(),
  rawImageUrl: z.string().nullable(),
  rawImageKey: z.string().nullable(),
  marketingImageUrl: z.string(),
  marketingImageKey: z.string(),
  headline: z.string(),
  generatedWith: z.enum(['gemini', 'manual']).nullable(),
  styleSource: z.enum(['category', 'reference']).nullable(),
})

const screenshotSetSchema = z.object({
  id: z.string(),
  displayType: z.string(),
  locale: z.string(),
  screenshots: z.array(screenshotSchema),
  styleConfig: z.object({
    type: z.enum(['category', 'reference']),
    category: z.string().optional(),
    referenceImageUrl: z.string().optional(),
    customColors: z.object({
      primary: z.string(),
      secondary: z.string(),
    }).optional(),
  }).nullable(),
})

const requestSchema = z.object({
  projectId: z.string(),
  screenshotSets: z.record(z.string(), screenshotSetSchema),
  source: z.enum(['upload', 'ai_generation', 'ai_edit', 'ai_translation', 'rollback']).default('upload'),
  sourceDetails: z.string().optional(),
  label: z.string().optional(),
  createHistoryEntry: z.boolean().default(true),
})

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

  const { projectId, screenshotSets, source, sourceDetails, label, createHistoryEntry } = body

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

  try {
    const batch = adminDb.batch()
    const screenshotsCollection = basePath.collection('screenshots')
    const now = Timestamp.now()

    // Get existing screenshots for comparison
    const existingSnapshot = await screenshotsCollection.get()
    const existingScreenshots: { [displayType: string]: ScreenshotSet } = {}
    for (const doc of existingSnapshot.docs) {
      existingScreenshots[doc.id] = doc.data() as ScreenshotSet
    }

    // Track what changed
    const displayTypesModified: string[] = []
    let screenshotsAdded = 0
    let screenshotsRemoved = 0

    // Update each screenshot set
    for (const [displayType, setData] of Object.entries(screenshotSets)) {
      const docRef = screenshotsCollection.doc(displayType)
      const existing = existingScreenshots[displayType]

      // Track changes
      if (existing) {
        const existingCount = existing.screenshots?.length || 0
        const newCount = setData.screenshots.length
        if (newCount > existingCount) {
          screenshotsAdded += newCount - existingCount
        } else if (newCount < existingCount) {
          screenshotsRemoved += existingCount - newCount
        }
      } else {
        screenshotsAdded += setData.screenshots.length
      }

      if (!existing || JSON.stringify(setData) !== JSON.stringify(existing)) {
        displayTypesModified.push(displayType)
      }

      const screenshotSet: ScreenshotSet = {
        ...setData,
        syncStatus: 'local_changes',
        lastPulledAt: existing?.lastPulledAt || null,
        lastPushedAt: existing?.lastPushedAt || null,
        createdAt: existing?.createdAt || now,
        updatedAt: now,
        createdBy: existing?.createdBy || authContext.userId,
      } as ScreenshotSet

      batch.set(docRef, screenshotSet)
    }

    // Create history entry if requested and there were changes
    let historyVersion: number | null = null
    if (createHistoryEntry && displayTypesModified.length > 0) {
      // Get all current screenshot sets (including newly saved)
      const allScreenshotSets: { [displayType: string]: ScreenshotSet } = { ...existingScreenshots }
      for (const [displayType, setData] of Object.entries(screenshotSets)) {
        allScreenshotSets[displayType] = {
          ...setData,
          syncStatus: 'local_changes',
          lastPulledAt: existingScreenshots[displayType]?.lastPulledAt || null,
          lastPushedAt: existingScreenshots[displayType]?.lastPushedAt || null,
          createdAt: existingScreenshots[displayType]?.createdAt || now,
          updatedAt: now,
          createdBy: existingScreenshots[displayType]?.createdBy || authContext.userId,
        } as ScreenshotSet
      }

      // Get next version number
      const existingHistory = await basePath
        .collection('screenshotHistory')
        .orderBy('version', 'desc')
        .limit(1)
        .get()

      const nextVersion = existingHistory.empty ? 1 : (existingHistory.docs[0].data().version || 0) + 1
      historyVersion = nextVersion

      const historyRef = basePath.collection('screenshotHistory').doc()
      const historyEntry: ScreenshotHistoryEntry = {
        id: historyRef.id,
        screenshotSets: allScreenshotSets,
        version: nextVersion,
        label: label || null,
        source: source as ScreenshotSource,
        ...(sourceDetails && { sourceDetails }),
        changesSummary: {
          displayTypesModified,
          localesModified: [],
          screenshotsAdded,
          screenshotsRemoved,
          description: generateChangeDescription(source, displayTypesModified, screenshotsAdded, screenshotsRemoved),
        },
        createdAt: now as any,
        createdBy: authContext.userId,
      }

      batch.set(historyRef, historyEntry)
    }

    // Update project screenshot sync status
    batch.update(basePath, {
      screenshotSyncStatus: 'local_changes',
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
          action: 'screenshots_save',
          source,
          displayTypesModified,
          screenshotsAdded,
          screenshotsRemoved,
          historyVersion,
        },
      })
    }

    return Response.json({
      success: true,
      displayTypesSaved: Object.keys(screenshotSets).length,
      displayTypesModified: displayTypesModified.length,
      screenshotsAdded,
      screenshotsRemoved,
      historyVersion,
    })
  } catch (error) {
    console.error('Error saving screenshots:', error)
    return errorResponse(
      error instanceof Error ? error.message : 'Failed to save screenshots',
      500
    )
  }
}

function generateChangeDescription(
  source: string,
  displayTypesModified: string[],
  screenshotsAdded: number,
  screenshotsRemoved: number
): string {
  const typeCount = displayTypesModified.length
  const typeText = typeCount === 1 ? `${displayTypesModified[0]}` : `${typeCount} device types`

  let action = ''
  if (screenshotsAdded > 0 && screenshotsRemoved > 0) {
    action = `modified ${screenshotsAdded + screenshotsRemoved} screenshots in`
  } else if (screenshotsAdded > 0) {
    action = `added ${screenshotsAdded} screenshots to`
  } else if (screenshotsRemoved > 0) {
    action = `removed ${screenshotsRemoved} screenshots from`
  } else {
    action = `updated`
  }

  switch (source) {
    case 'upload':
      return `Uploaded ${action} ${typeText}`
    case 'ai_generation':
      return `AI generated ${action} ${typeText}`
    case 'ai_edit':
      return `AI edited ${action} ${typeText}`
    case 'ai_translation':
      return `AI translated ${action} ${typeText}`
    case 'rollback':
      return `Rolled back ${typeText}`
    default:
      return `Updated ${typeText}`
  }
}
