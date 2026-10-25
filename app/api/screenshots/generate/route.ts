import { readBoundedJson, RequestBodyLimitError } from '@/lib/api/bounded-body'
import { NextRequest } from 'next/server'
import crypto from 'crypto'
import { z } from 'zod'
import { authenticateRequest, errorResponse, unauthorizedResponse } from '@/lib/api/auth'
import { getProjectContext, hasContextPermission, getAccountContext, AccountContext } from '@/lib/org/context'
import { getSession } from '@/lib/auth/session'
import { adminDb } from '@/lib/firebase/admin'
import {
  createReservationErrorResponse,
  refundUsage,
  reserveUsage,
  settleUsage,
} from '@/lib/api/usage'
import { logAuditEvent, AuditAction } from '@/lib/org/audit'
import { Timestamp } from 'firebase-admin/firestore'
import { generateMarketingScreenshot, generateScreenshotSet, analyzeScreenshotForEnhancement } from '@/lib/services/gemini-screenshot'
import { uploadFromUrl, uploadFile } from '@/lib/services/r2'
import { resizeToAppStoreSize } from '@/lib/services/screenshot-generator'
import type { Screenshot, ScreenshotSet, ScreenshotDisplayType, SCREENSHOT_DISPLAY_TYPES } from '@/lib/firebase/firestore'
import { AI_MODELS, getImageCreditWeight } from '@/lib/billing/catalog'

const generateRequestSchema = z.object({
  projectId: z.string(),
  displayType: z.string(),
  rawImages: z.array(z.object({
    url: z.string(),
    headline: z.string(),
  })).optional().default([]),
  headline: z.string().optional(), // Top-level headline for feature graphic (no raw image needed)
  styleConfig: z.object({
    type: z.enum(['category', 'reference', 'match-existing', 'appstore']),
    category: z.string().optional(),
    referenceImageUrl: z.string().optional(),
    customColors: z.object({
      primary: z.string(),
      secondary: z.string(),
    }).optional(),
    appStoreAppId: z.string().optional(),
    appStoreAppName: z.string().optional(),
  }),
  locale: z.string().default('en-US'),
  appMetadata: z.object({
    name: z.string(),
    description: z.string(),
  }).optional(),
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
    body = generateRequestSchema.parse(await readBoundedJson(request))
  } catch (error) {
    if (error instanceof RequestBodyLimitError) return Response.json({ error: error.message }, { status: 413 })
    if (error instanceof z.ZodError) {
      return errorResponse(`Validation error: ${error.issues.map(e => e.message).join(', ')}`)
    }
    return errorResponse('Invalid request body')
  }

  const { projectId, displayType, rawImages, headline: topLevelHeadline, styleConfig, locale, appMetadata } = body
  const isFeatureGraphic = displayType === 'PLAY_FEATURE_GRAPHIC'

  // Feature graphic only supports 1 image per locale
  if (isFeatureGraphic && rawImages.length > 1) {
    return errorResponse('Feature graphic supports only 1 image per locale', 400)
  }

  // Non-feature-graphic screenshots require at least 1 raw image
  if (!isFeatureGraphic && rawImages.length === 0) {
    return errorResponse('At least one raw image is required for screenshot generation', 400)
  }

  // Feature graphic requires a headline (either top-level or from rawImages[0])
  const featureGraphicHeadline = topLevelHeadline || rawImages[0]?.headline
  if (isFeatureGraphic && !featureGraphicHeadline) {
    return errorResponse('A headline is required for feature graphic generation', 400)
  }

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

  const creditWeight = getImageCreditWeight('gemini', AI_MODELS.imageDefault, '1K')
  const requestedOutputs = isFeatureGraphic ? 1 : rawImages.length
  const operationId = request.headers.get('idempotency-key') || crypto.randomUUID()
  const reservation = await reserveUsage(authContext, {
    operationId,
    usageType: 'screenshots',
    units: requestedOutputs * creditWeight,
    metadata: { route: '/api/screenshots/generate', projectId, model: AI_MODELS.imageDefault },
  })
  if (!reservation.allowed) return createReservationErrorResponse(reservation)
  if (reservation.replayed) return errorResponse('This screenshot operation was already processed', 409)

  try {
    const now = Timestamp.now()
    const screenshots: Screenshot[] = []
    const errors: Array<{ index: number; error: string }> = []

    // Build style source for Gemini
    // 'reference', 'match-existing', and 'appstore' all use reference images
    const usesReferenceImage = ['reference', 'match-existing', 'appstore'].includes(styleConfig.type) && styleConfig.referenceImageUrl
    const geminiStyleSource = usesReferenceImage
      ? { type: 'reference' as const, referenceImageUrl: styleConfig.referenceImageUrl! }
      : { type: 'category' as const, category: styleConfig.category as any, customColors: styleConfig.customColors }

    // Feature graphic: generate standalone branded banner (no raw image required)
    if (isFeatureGraphic) {
      const result = await generateMarketingScreenshot({
        rawImageUrl: rawImages[0]?.url, // Optional: incorporate a screenshot as visual element
        headline: featureGraphicHeadline!,
        styleSource: geminiStyleSource,
        deviceFrame: 'none',
        targetAspectRatio: 'landscape',
        appName: appMetadata?.name,
        appDescription: appMetadata?.description,
      })

      if (!result.success) {
        await refundUsage(authContext, operationId, 'screenshots')
        return errorResponse(result.error || 'Failed to generate feature graphic')
      }

      // Upload raw image to R2 (only if provided)
      let rawUrl: string | null = null
      let rawKey: string | null = null
      if (rawImages[0]?.url) {
        const rawUploaded = await uploadFromUrl({
          userId: projectContext.type === 'organization' ? undefined : authContext.userId,
          orgId: projectContext.orgId || undefined,
          projectId,
          category: 'raw',
          filename: `raw-feature-graphic-${Date.now()}.png`,
          sourceUrl: rawImages[0].url,
        })
        rawUrl = rawUploaded.url
        rawKey = rawUploaded.key
      }

      // Upload generated banner to R2
      const marketingUploaded = await uploadFromUrl({
        userId: projectContext.type === 'organization' ? undefined : authContext.userId,
        orgId: projectContext.orgId || undefined,
        projectId,
        category: 'generated',
        filename: `feature-graphic-${Date.now()}.png`,
        sourceUrl: result.url,
      })

      screenshots.push({
        id: `fg-${Date.now()}`,
        position: 0,
        rawImageUrl: rawUrl,
        rawImageKey: rawKey,
        marketingImageUrl: marketingUploaded.url,
        marketingImageKey: marketingUploaded.key,
        headline: featureGraphicHeadline!,
        generatedWith: 'gemini',
        styleSource: styleConfig.type as any,
        createdAt: now as any,
        updatedAt: now as any,
      })
    } else if (rawImages.length === 1) {
      // Single screenshot generation - analyze for enhancement first
      const enhancement = await analyzeScreenshotForEnhancement(
        rawImages[0].url,
        rawImages[0].headline,
        appMetadata
      )

      const result = await generateMarketingScreenshot({
        rawImageUrl: rawImages[0].url,
        headline: rawImages[0].headline,
        styleSource: geminiStyleSource,
        enhancement,
      })

      if (!result.success) {
        await refundUsage(authContext, operationId, 'screenshots')
        return errorResponse(result.error || 'Failed to generate screenshot')
      }

      // Upload raw image to R2
      const rawUploaded = await uploadFromUrl({
        userId: projectContext.type === 'organization' ? undefined : authContext.userId,
        orgId: projectContext.orgId || undefined,
        projectId,
        category: 'raw',
        filename: `raw-${displayType}-0-${Date.now()}.png`,
        sourceUrl: rawImages[0].url,
      })

      // Upload generated image to R2
      const marketingUploaded = await uploadFromUrl({
        userId: projectContext.type === 'organization' ? undefined : authContext.userId,
        orgId: projectContext.orgId || undefined,
        projectId,
        category: 'generated',
        filename: `generated-${displayType}-0-${Date.now()}.png`,
        sourceUrl: result.url,
      })

      screenshots.push({
        id: `${displayType}-0`,
        position: 0,
        rawImageUrl: rawUploaded.url,
        rawImageKey: rawUploaded.key,
        marketingImageUrl: marketingUploaded.url,
        marketingImageKey: marketingUploaded.key,
        headline: rawImages[0].headline,
        generatedWith: 'gemini',
        styleSource: styleConfig.type as any,
        createdAt: now as any,
        updatedAt: now as any,
      })
    } else {
      // Batch generation with anchor and enhancement analysis
      const results = await generateScreenshotSet({
        rawImages,
        styleSource: geminiStyleSource,
        anchorIndex: 0,
        appContext: appMetadata,
        enableEnhancement: true,
      })

      for (let i = 0; i < results.length; i++) {
        const result = results[i]
        const rawImage = rawImages[i]

        if (!result.success) {
          errors.push({ index: i, error: result.error || 'Generation failed' })
          continue
        }

        // Upload raw image to R2
        const rawUploaded = await uploadFromUrl({
          userId: projectContext.type === 'organization' ? undefined : authContext.userId,
          orgId: projectContext.orgId || undefined,
          projectId,
          category: 'raw',
          filename: `raw-${displayType}-${i}-${Date.now()}.png`,
          sourceUrl: rawImage.url,
        })

        // Upload generated image to R2
        const marketingUploaded = await uploadFromUrl({
          userId: projectContext.type === 'organization' ? undefined : authContext.userId,
          orgId: projectContext.orgId || undefined,
          projectId,
          category: 'generated',
          filename: `generated-${displayType}-${i}-${Date.now()}.png`,
          sourceUrl: result.url,
        })

        screenshots.push({
          id: `${displayType}-${i}`,
          position: i,
          rawImageUrl: rawUploaded.url,
          rawImageKey: rawUploaded.key,
          marketingImageUrl: marketingUploaded.url,
          marketingImageKey: marketingUploaded.key,
          headline: rawImage.headline,
          generatedWith: 'gemini',
          styleSource: styleConfig.type as any,
          createdAt: now as any,
          updatedAt: now as any,
        })
      }
    }

    if (screenshots.length === 0) {
      await refundUsage(authContext, operationId, 'screenshots')
      return errorResponse('All screenshots failed to generate')
    }

    // Fetch existing screenshot set to merge with new screenshots
    const screenshotsCollection = basePath.collection('screenshots')
    const docRef = screenshotsCollection.doc(displayType)
    const existingDoc = await docRef.get()

    let existingScreenshots: Screenshot[] = []
    let createdAt = now

    if (existingDoc.exists) {
      const existingData = existingDoc.data() as ScreenshotSet
      existingScreenshots = existingData.screenshots || []
      createdAt = existingData.createdAt || now
      console.log(`[Generate] Found ${existingScreenshots.length} existing screenshots, appending ${screenshots.length} new ones`)
    }

    // Calculate next position based on existing screenshots
    const maxPosition = existingScreenshots.length > 0
      ? Math.max(...existingScreenshots.map(s => s.position)) + 1
      : 0

    // Update positions for new screenshots to append after existing ones
    const repositionedScreenshots = screenshots.map((s, index) => ({
      ...s,
      id: `${displayType}-${maxPosition + index}`,
      position: maxPosition + index,
    }))

    // Feature graphic replaces existing (only 1 allowed); regular screenshots append
    const mergedScreenshots = isFeatureGraphic
      ? repositionedScreenshots.slice(0, 1)
      : [...existingScreenshots, ...repositionedScreenshots]

    // Create screenshot set with merged screenshots
    const screenshotSet: ScreenshotSet = {
      id: displayType,
      displayType: displayType as ScreenshotDisplayType,
      locale,
      screenshots: mergedScreenshots,
      styleConfig,
      syncStatus: 'local_changes',
      lastPulledAt: null,
      lastPushedAt: null,
      createdAt,
      updatedAt: now,
      createdBy: authContext.userId,
    } as ScreenshotSet

    // Save to Firestore
    const batch = adminDb.batch()
    batch.set(docRef, screenshotSet)

    // Update project
    batch.update(basePath, {
      screenshotSyncStatus: 'local_changes',
      updatedAt: now,
    })

    await batch.commit()

    await settleUsage(authContext, operationId, 'screenshots', screenshots.length * creditWeight)

    // Log audit event
    if (projectContext.type === 'organization' && projectContext.orgId) {
      await logAuditEvent({
        orgId: projectContext.orgId,
        action: AuditAction.PROJECT_UPDATED,
        userId: authContext.userId,
        resourceType: 'project',
        resourceId: projectId,
        metadata: {
          action: 'screenshots_generate',
          displayType,
          screenshotsGenerated: screenshots.length,
          styleType: styleConfig.type,
        },
      })
    }

    return Response.json({
      success: true,
      screenshotSet,
      generated: screenshots.length,
      errors: errors.length > 0 ? errors : undefined,
    })
  } catch (error) {
    await refundUsage(authContext, operationId, 'screenshots')
    console.error('Error generating screenshots:', error)
    return errorResponse(
      error instanceof Error ? error.message : 'Failed to generate screenshots',
      500
    )
  }
}
