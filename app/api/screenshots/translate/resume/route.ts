import { NextRequest } from 'next/server'
import crypto from 'crypto'
import { z } from 'zod'
import { errorResponse, unauthorizedResponse } from '@/lib/api/auth'
import { getProjectContext, hasContextPermission, getAccountContext, AccountContext } from '@/lib/org/context'
import { getSession } from '@/lib/auth/session'
import { adminDb } from '@/lib/firebase/admin'
import { getTranslationJob, createTranslationJob, estimateJobDuration } from '@/lib/jobs/translation-job'
import type { ScreenshotSet } from '@/lib/firebase/firestore'
import { createReservationErrorResponse, refundUsage, reserveUsage } from '@/lib/api/usage'
import { AI_MODELS, getImageCreditWeight, type ImageProvider } from '@/lib/billing/catalog'

const resumeJobSchema = z.object({
  jobId: z.string(),
})

// Helper to get auth context
async function getAuthContext(request: NextRequest): Promise<{ context: AccountContext | null; userId?: string; error?: string }> {
  const session = await getSession()
  if (session) {
    const context = await getAccountContext(session.userId)
    if (context) {
      return { context, userId: session.userId }
    }
    return { context: null, error: 'User not found' }
  }
  return { context: null, error: 'Authentication required' }
}

export async function POST(request: NextRequest) {
  // Authenticate
  const { context: authContext, userId, error: authError } = await getAuthContext(request)
  if (!authContext || !userId) {
    return unauthorizedResponse(authError)
  }

  // Parse request
  let body
  try {
    body = resumeJobSchema.parse(await request.json())
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(`Validation error: ${error.errors.map(e => e.message).join(', ')}`)
    }
    return errorResponse('Invalid request body')
  }

  const { jobId } = body

  let usageOperationId: string | null = null
  try {
    // Get the original job
    const originalJob = await getTranslationJob(userId, jobId)
    if (!originalJob) {
      return errorResponse('Job not found', 404)
    }

    // Only resume failed or completed jobs with failures
    if (originalJob.status !== 'failed' && originalJob.status !== 'completed') {
      return errorResponse('Can only resume failed or completed jobs')
    }

    const { projectId, config } = originalJob

    // Get project context
    const projectContext = await getProjectContext(userId, projectId)
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
          .doc(userId)
          .collection('projects')
          .doc(projectId)

    // Build a set of successfully completed tasks
    const completedTasks = new Set(
      originalJob.results
        .filter(r => r.success)
        .map(r => `${r.displayType}:${r.screenshotId}:${r.locale}`)
    )

    // Get screenshot sets and find what's missing
    const missingTasks: Array<{
      displayType: string
      screenshotId: string
      locale: string
    }> = []

    for (const displayType of config.displayTypes) {
      const screenshotSetDoc = await basePath.collection('screenshots').doc(displayType).get()
      if (!screenshotSetDoc.exists) continue

      const screenshotSet = screenshotSetDoc.data() as ScreenshotSet
      const sourceLocale = screenshotSet.locale

      for (const targetLocale of config.targetLocales) {
        if (targetLocale === sourceLocale) continue

        const localeScreenshotIds = config.screenshotIdsByLocale?.[targetLocale]
        const screenshotsToCheck = localeScreenshotIds
          ? screenshotSet.screenshots.filter(s => localeScreenshotIds.includes(s.id))
          : config.screenshotIds
            ? screenshotSet.screenshots.filter(s => config.screenshotIds!.includes(s.id))
            : screenshotSet.screenshots

        for (const screenshot of screenshotsToCheck) {
          const taskKey = `${displayType}:${screenshot.id}:${targetLocale}`
          if (!completedTasks.has(taskKey)) {
            missingTasks.push({
              displayType,
              screenshotId: screenshot.id,
              locale: targetLocale,
            })
          }
        }
      }
    }

    if (missingTasks.length === 0) {
      return Response.json({
        message: 'All screenshots were already translated successfully',
        alreadyComplete: true,
      })
    }

    // Group missing tasks by locale to preserve the original job structure
    const missingByLocale = new Map<string, Set<string>>()
    const missingDisplayTypes = new Set<string>()
    const missingScreenshotIds = new Set<string>()

    for (const task of missingTasks) {
      if (!missingByLocale.has(task.locale)) {
        missingByLocale.set(task.locale, new Set())
      }
      missingByLocale.get(task.locale)!.add(task.screenshotId)
      missingDisplayTypes.add(task.displayType)
      missingScreenshotIds.add(task.screenshotId)
    }

    const missingIdsByLocale = Object.fromEntries(
      Array.from(missingByLocale.entries()).map(([locale, ids]) => [locale, Array.from(ids)])
    )

    const nextConfig = {
      ...config,
      targetLocales: Array.from(missingByLocale.keys()),
      displayTypes: Array.from(missingDisplayTypes),
    }

    if (config.screenshotIdsByLocale) {
      nextConfig.screenshotIdsByLocale = missingIdsByLocale
      delete nextConfig.screenshotIds
    } else {
      nextConfig.screenshotIds = Array.from(missingScreenshotIds)
      delete nextConfig.screenshotIdsByLocale
    }

    const effectiveProvider = (config.provider || 'kie') as ImageProvider
    const effectiveModel = config.model || (
      effectiveProvider === 'openai' ? AI_MODELS.openAiImagePremium
        : effectiveProvider === 'fal' ? AI_MODELS.falImagePremium
          : AI_MODELS.kieImageDefault
    )
    const unitWeight = getImageCreditWeight(effectiveProvider, effectiveModel, '2K')
    const reservedUnits = missingTasks.length * unitWeight
    usageOperationId = request.headers.get('idempotency-key') || crypto.randomUUID()
    const reservation = await reserveUsage(authContext, {
      operationId: usageOperationId,
      usageType: 'screenshots',
      units: reservedUnits,
      ttlSeconds: 4 * 60 * 60,
      metadata: { route: '/api/screenshots/translate/resume', projectId, provider: effectiveProvider, model: effectiveModel },
    })
    if (!reservation.allowed) return createReservationErrorResponse(reservation)
    if (reservation.replayed) return errorResponse('This resume operation was already processed', 409)
    nextConfig.usageReservation = {
      operationId: usageOperationId,
      usageType: 'screenshots',
      reservedUnits,
      unitWeight,
    }

    // Create a new job for the missing screenshots
    const newJob = await createTranslationJob({
      userId,
      ...(projectContext.orgId ? { orgId: projectContext.orgId } : {}),
      projectId,
      config: nextConfig,
    })

    // Estimate duration
    const estimatedDuration = estimateJobDuration(missingTasks.length)

    return Response.json({
      jobId: newJob.id,
      originalJobId: jobId,
      status: 'pending',
      totalTasks: missingTasks.length,
      completedInOriginal: completedTasks.size,
      estimatedDuration,
      message: `Resuming translation for ${missingTasks.length} remaining screenshots.`,
    })
  } catch (error) {
    if (usageOperationId) await refundUsage(authContext, usageOperationId, 'screenshots')
    console.error('Error resuming translation job:', error)
    return errorResponse(
      error instanceof Error ? error.message : 'Failed to resume translation job',
      500
    )
  }
}
