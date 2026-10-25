import { startJobSchema } from '@/lib/api/translation-input'
import { readBoundedJson, RequestBodyLimitError } from '@/lib/api/bounded-body'
import { NextRequest } from 'next/server'
import crypto from 'crypto'
import { z } from 'zod'
import { authenticateRequest, errorResponse, unauthorizedResponse } from '@/lib/api/auth'
import { getProjectContext, hasContextPermission, getAccountContext, AccountContext } from '@/lib/org/context'
import { getSession } from '@/lib/auth/session'
import { adminDb } from '@/lib/firebase/admin'
import { createTranslationJob, estimateJobDuration } from '@/lib/jobs/translation-job'
import { createReservationErrorResponse, readUsage, refundUsage, reserveUsage } from '@/lib/api/usage'
import type { ScreenshotSet } from '@/lib/firebase/firestore'
import { AI_MODELS, getImageCreditWeight, type ImageProvider } from '@/lib/billing/catalog'

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
    body = startJobSchema.parse(await readBoundedJson(request, 1024 * 1024, 125_000))
  } catch (error) {
    if (error instanceof RequestBodyLimitError) return Response.json({ error: error.message }, { status: 413 })
    if (error instanceof z.ZodError) {
      return errorResponse(`Validation error: ${error.issues.map(e => e.message).join(', ')}`)
    }
    return errorResponse('Invalid request body')
  }

  const {
    projectId,
    targetLocales,
    displayTypes,
    screenshotIds,
    screenshotIdsByLocale,
    translateInAppText,
    preserveInPhoneUI,
    translateMarketingOnly,
    translationInstructions,
    translationMode,
    textLengthPolicy,
    provider,
    model,
    perScreenshotInstructions,
  } = body

  const effectiveTranslateInAppText = translationMode === 'ui_full'
    ? true
    : preserveInPhoneUI || translateMarketingOnly
      ? false
      : translateInAppText

  console.log('[TranslateStart] Received request:', {
    projectId,
    targetLocales,
    screenshotIds: screenshotIds || 'ALL',
    screenshotIdsCount: screenshotIds?.length || 'N/A',
    screenshotIdsByLocale: screenshotIdsByLocale ? Object.keys(screenshotIdsByLocale).length + ' locales' : 'N/A',
    translationMode: translationMode || 'literal',
    provider: provider || 'kie',
    model: model || 'default',
  })

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

  let usageOperationId: string | null = null
  try {
    // Get screenshot sets to validate and calculate total
    let screenshotSetsToProcess: Array<{ displayType: string; set: ScreenshotSet }> = []

    if (displayTypes && displayTypes.length > 0) {
      // Specific display types
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
      // All display types
      const allSetsSnapshot = await basePath.collection('screenshots').get()
      allSetsSnapshot.docs.forEach(doc => {
        screenshotSetsToProcess.push({
          displayType: doc.id,
          set: doc.data() as ScreenshotSet,
        })
      })
    }

    // Sort display types: iPhones first (by size descending), then iPads (by size descending)
    // This ensures the most common/important screenshots are processed first
    const displayTypePriority: Record<string, number> = {
      'APP_IPHONE_69': 1,
      'APP_IPHONE_65': 2,
      'APP_IPHONE_63': 3,
      'APP_IPHONE_61': 4,
      'APP_IPHONE_55': 5,
      'APP_IPAD_PRO_13': 6,
      'APP_IPAD_PRO_129': 7,
      'APP_IPAD_PRO_11': 8,
      'APP_WATCH_ULTRA_3': 9,
      'APP_WATCH_ULTRA': 10,
      'APP_WATCH_SERIES_10': 11,
      'APP_WATCH_SERIES_7': 12,
      'APP_WATCH_SERIES_4': 13,
      'APP_WATCH_SERIES_3': 14,
    }
    screenshotSetsToProcess.sort((a, b) => {
      const priorityA = displayTypePriority[a.displayType] ?? 99
      const priorityB = displayTypePriority[b.displayType] ?? 99
      return priorityA - priorityB
    })

    if (screenshotSetsToProcess.length === 0) {
      return errorResponse('No screenshots found to translate', 404)
    }

    // Calculate total tasks - supports per-locale filtering
    let totalTasks = 0
    for (const { set } of screenshotSetsToProcess) {
      // Filter out source locale from target locales
      const effectiveTargetLocales = targetLocales.filter(l => l !== set.locale)

      if (screenshotIdsByLocale) {
        // Per-locale filtering: count screenshots per locale
        for (const locale of effectiveTargetLocales) {
          const localeScreenshotIds = screenshotIdsByLocale[locale] || []
          const screenshotCount = set.screenshots.filter(s => localeScreenshotIds.includes(s.id)).length
          totalTasks += screenshotCount
        }
      } else if (screenshotIds) {
        // Legacy: same screenshots for all locales
        const screenshotCount = set.screenshots.filter(s => screenshotIds.includes(s.id)).length
        totalTasks += screenshotCount * effectiveTargetLocales.length
      } else {
        // All screenshots to all locales
        totalTasks += set.screenshots.length * effectiveTargetLocales.length
      }
    }

    if (totalTasks === 0) {
      return errorResponse('No screenshots to translate (check locales)')
    }

    const effectiveProvider = (provider || 'kie') as ImageProvider
    const effectiveModel = model || (
      effectiveProvider === 'openai' ? AI_MODELS.openAiImagePremium
        : effectiveProvider === 'fal' ? AI_MODELS.falImagePremium
          : AI_MODELS.kieImageDefault
    )
    const unitWeight = getImageCreditWeight(effectiveProvider, effectiveModel, '2K')
    const reservedUnits = totalTasks * unitWeight
    usageOperationId = request.headers.get('idempotency-key') || crypto.randomUUID()
    const reservation = await reserveUsage(authContext, {
      operationId: usageOperationId,
      usageType: 'screenshots',
      units: reservedUnits,
      ttlSeconds: 4 * 60 * 60,
      metadata: {
        route: '/api/screenshots/translate/start',
        projectId,
        provider: effectiveProvider,
        model: effectiveModel,
      },
    })
    if (!reservation.allowed) return createReservationErrorResponse(reservation)
    if (reservation.replayed) return errorResponse('This screenshot translation job was already created', 409)

    // Create the translation job
    const job = await createTranslationJob({
      userId: authContext.userId,
      ...(projectContext.orgId ? { orgId: projectContext.orgId } : {}),
      projectId,
      config: {
        targetLocales,
        displayTypes: screenshotSetsToProcess.map(s => s.displayType),
        ...(screenshotIdsByLocale ? { screenshotIdsByLocale } : {}),
        ...(screenshotIds && screenshotIds.length > 0 && !screenshotIdsByLocale ? { screenshotIds } : {}),
        translateInAppText: effectiveTranslateInAppText,
        ...(preserveInPhoneUI !== undefined ? { preserveInPhoneUI } : {}),
        ...(translateMarketingOnly !== undefined ? { translateMarketingOnly } : {}),
        ...(translationInstructions ? { translationInstructions } : {}),
        ...(translationMode ? { translationMode } : {}),
        ...(textLengthPolicy ? { textLengthPolicy } : {}),
        ...(provider ? { provider } : {}),
        ...(model ? { model } : {}),
        ...(perScreenshotInstructions ? { perScreenshotInstructions } : {}),
        usageReservation: {
          operationId: usageOperationId,
          usageType: 'screenshots',
          reservedUnits,
          unitWeight,
        },
      },
    })

    const usage = await readUsage(authContext, 'screenshots')

    // Estimate duration
    const estimatedDuration = estimateJobDuration(totalTasks)

    return Response.json({
      jobId: job.id,
      status: 'pending',
      totalTasks,
      estimatedDuration,
      message: `Translation job created. Processing ${totalTasks} screenshots.`,
      // Usage and billing info
      billing: {
        currentUsage: usage.used,
        reservedUsage: usage.reserved,
        monthlyLimit: usage.limit,
        willExceedLimit: false,
        withinPlanCount: reservedUnits,
        overageCount: 0,
        estimatedOverageCost: 0,
        plan: usage.plan,
        unitWeight,
      },
    })
  } catch (error) {
    if (usageOperationId) {
      await refundUsage(authContext, usageOperationId, 'screenshots')
    }
    console.error('Error starting translation job:', error)
    return errorResponse(
      error instanceof Error ? error.message : 'Failed to start translation job',
      500
    )
  }
}
