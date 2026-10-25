import { readBoundedJson, RequestBodyLimitError } from '@/lib/api/bounded-body'
import { NextRequest } from 'next/server'
import { z } from 'zod'
import { authenticateRequest, errorResponse, unauthorizedResponse } from '@/lib/api/auth'
import { getProjectContext, hasContextPermission, getAccountContext, AccountContext } from '@/lib/org/context'
import { getSession } from '@/lib/auth/session'
import { adminDb } from '@/lib/firebase/admin'
import { estimateJobDuration } from '@/lib/jobs/translation-job'
import { calculateBillingInfo, getUpgradeSuggestions } from '@/lib/api/billing-utils'
import type { ScreenshotSet } from '@/lib/firebase/firestore'

const previewJobSchema = z.object({
  projectId: z.string(),
  targetLocales: z.array(z.string().max(100)).min(1).max(200),
  displayTypes: z.array(z.string().max(100)).max(32).optional(),
  screenshotIds: z.array(z.string().max(200)).max(500).optional(),
  screenshotIdsByLocale: z.record(z.string().max(100), z.array(z.string().max(200)).max(500)).refine(value => Object.keys(value).length <= 200, 'Too many locales').optional(),
  translateInAppText: z.boolean().optional(),
  preserveInPhoneUI: z.boolean().optional(),
  translateMarketingOnly: z.boolean().optional(),
  translationInstructions: z.string().max(4000).optional(),
  translationMode: z.enum(['literal', 'marketing_short', 'transcreate', 'ui_full']).optional(),
  textLengthPolicy: z.object({
    headlineMaxChars: z.number().int().positive().max(200).optional(),
    subtitleMaxChars: z.number().int().positive().max(300).optional(),
    allowLineBreaks: z.boolean().optional(),
    shrinkFontLimitPercent: z.number().int().min(0).max(50).optional(),
  }).optional(),
  provider: z.enum(['kie', 'fal', 'openai']).optional(),
  model: z.string().min(1).max(100).optional(),
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
    body = previewJobSchema.parse(await readBoundedJson(request, 1024 * 1024, 125_000))
  } catch (error) {
    if (error instanceof RequestBodyLimitError) return Response.json({ error: error.message }, { status: 413 })
    if (error instanceof z.ZodError) {
      return errorResponse(`Validation error: ${error.issues.map(e => e.message).join(', ')}`)
    }
    return errorResponse('Invalid request body')
  }

  const { projectId, targetLocales, displayTypes, screenshotIds, screenshotIdsByLocale } = body

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
    // Get screenshot sets to validate and calculate total
    let screenshotSetsToProcess: Array<{ displayType: string; set: ScreenshotSet }> = []

    if (displayTypes && displayTypes.length > 0) {
      for (const dt of displayTypes) {
        const screenshotSetDoc = await basePath.collection('screenshots').doc(dt).get()
        if (screenshotSetDoc.exists) {
          screenshotSetsToProcess.push({
            displayType: dt,
            set: screenshotSetDoc.data() as ScreenshotSet,
          })
        }
      }
    } else {
      const allSetsSnapshot = await basePath.collection('screenshots').get()
      allSetsSnapshot.docs.forEach(doc => {
        screenshotSetsToProcess.push({
          displayType: doc.id,
          set: doc.data() as ScreenshotSet,
        })
      })
    }

    if (screenshotSetsToProcess.length === 0) {
      return errorResponse('No screenshots found to translate', 404)
    }

    // Calculate total tasks
    let totalTasks = 0
    for (const { set } of screenshotSetsToProcess) {
      const effectiveTargetLocales = targetLocales.filter(l => l !== set.locale)

      if (screenshotIdsByLocale) {
        for (const locale of effectiveTargetLocales) {
          const localeScreenshotIds = screenshotIdsByLocale[locale] || []
          totalTasks += set.screenshots.filter(s => localeScreenshotIds.includes(s.id)).length
        }
      } else {
        const screenshotCount = screenshotIds
          ? set.screenshots.filter(s => screenshotIds.includes(s.id)).length
          : set.screenshots.length
        totalTasks += screenshotCount * effectiveTargetLocales.length
      }
    }

    if (totalTasks === 0) {
      return errorResponse('No screenshots to translate (check locales)')
    }

    // Calculate billing info using shared utility
    const billing = await calculateBillingInfo(authContext, 'translations', totalTasks)

    // Calculate upgrade suggestions
    const upgradeSuggestions = getUpgradeSuggestions(
      billing.plan,
      'translations',
      billing.currentUsage,
      totalTasks
    )

    return Response.json({
      totalTasks,
      estimatedDuration: estimateJobDuration(totalTasks),
      billing,
      upgradeSuggestions,
    })
  } catch (error) {
    console.error('Error previewing translation job:', error)
    return errorResponse(
      error instanceof Error ? error.message : 'Failed to preview translation job',
      500
    )
  }
}
