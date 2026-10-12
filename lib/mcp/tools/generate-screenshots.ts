import { generateSingleScreenshot, generateScreenshotSetWithStorage, ScreenshotSize } from '@/lib/services/screenshot-generator'
import crypto from 'crypto'
import { StyleSource, ScreenshotEnhancement, DeviceFrame, ScreenshotGenerationProvider } from '@/lib/services/gemini-screenshot'
import { APP_CATEGORIES, AppCategory, APPSTORE_SCREENSHOT_SIZES } from '@/lib/constants'
import { AccountContext, getProjectContext, hasContextPermission } from '@/lib/org/context'
import { refundUsage, reserveUsage, settleUsage } from '@/lib/api/usage'
import { logAuditEvent, AuditAction } from '@/lib/org/audit'
import { createScreenshotJob, completeScreenshotJob, failScreenshotJob } from './screenshot-jobs'
import { uploadFile } from '@/lib/services/r2'
import { AI_MODELS, getImageCreditWeight } from '@/lib/billing/catalog'

// Batch screenshot generation taking 3+ images runs async to avoid MCP client timeouts
const ASYNC_BATCH_THRESHOLD = 3
const SCREENSHOT_GENERATION_PROVIDERS = new Set<ScreenshotGenerationProvider>(['gemini', 'kie'])

export interface GenerateScreenshotParams {
  __usageOperationId?: string
  projectId: string
  rawImageUrl: string
  headline: string
  subtitle?: string
  styleSource: {
    type: 'category'
    category: AppCategory
    customColors?: { primary: string; secondary: string }
  } | {
    type: 'reference'
    referenceImageUrl: string
  } | {
    type: 'custom'
    style: {
      gradientColors: { primary: string; secondary: string }
      fontStyle: string
      styleDescription: string
      decorativeElements: string[]
    }
  }
  anchorImageUrl?: string
  resizeToSizes?: Array<keyof typeof APPSTORE_SCREENSHOT_SIZES>
  provider?: ScreenshotGenerationProvider
  model?: string
}

export interface GenerateScreenshotSetParams {
  __usageOperationId?: string
  projectId: string
  screenshots: Array<{
    rawImageUrl: string
    headline: string
    subtitle?: string
  }>
  styleSource: {
    type: 'category'
    category: AppCategory
    customColors?: { primary: string; secondary: string }
    anchorIndex?: number
  } | {
    type: 'reference'
    referenceImageUrl: string
  } | {
    type: 'custom'
    style: {
      gradientColors: { primary: string; secondary: string }
      fontStyle: string
      styleDescription: string
      decorativeElements: string[]
    }
  }
  deviceFrame?: DeviceFrame
  resizeToSizes?: Array<keyof typeof APPSTORE_SCREENSHOT_SIZES>
  provider?: ScreenshotGenerationProvider
  model?: string
}

export interface GenerateScreenshotResult {
  success: boolean
  originalUrl?: string
  resizedUrls?: Record<string, string>
  error?: string
  requiresUpgrade?: boolean
  upgradeUrl?: string
}

export interface GenerateScreenshotSetResult {
  success: boolean
  async?: boolean
  jobId?: string
  totalScreenshots?: number
  message?: string
  results?: Array<{
    index: number
    headline: string
    success: boolean
    originalUrl?: string
    resizedUrls?: Record<string, string>
    error?: string
  }>
  stats?: {
    total: number
    success: number
    failed: number
  }
  error?: string
  requiresUpgrade?: boolean
  upgradeUrl?: string
  // Internal: background work to run after response is sent (stripped by JSON.stringify)
  __deferredWork?: () => Promise<void>
}

export interface UploadScreenshotAssetParams {
  projectId: string
  filename: string
  category?: 'raw' | 'reference' | 'temp'
  sourceUrl?: string
  dataUrl?: string
  imageDataBase64?: string
  contentType?: string
}

export interface UploadScreenshotAssetResult {
  success: boolean
  url?: string
  key?: string
  sizeBytes?: number
  contentType?: string
  category?: string
  error?: string
}

function validateGenerationProvider(provider?: ScreenshotGenerationProvider): string | null {
  if (!provider) return null
  if (!SCREENSHOT_GENERATION_PROVIDERS.has(provider)) {
    return `provider must be one of: ${Array.from(SCREENSHOT_GENERATION_PROVIDERS).join(', ')}`
  }
  return null
}

function parseDataUrl(dataUrl: string): { data: Buffer; contentType: string } {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/)
  if (!match) {
    throw new Error('Invalid dataUrl format. Expected data:<content-type>;base64,<data>.')
  }
  return {
    contentType: match[1],
    data: Buffer.from(match[2], 'base64'),
  }
}

async function readAssetInput(params: UploadScreenshotAssetParams): Promise<{ data: Buffer; contentType: string }> {
  const providedInputs = [params.sourceUrl, params.dataUrl, params.imageDataBase64].filter(Boolean).length
  if (providedInputs !== 1) {
    throw new Error('Provide exactly one of sourceUrl, dataUrl, or imageDataBase64')
  }

  if (params.sourceUrl) {
    const response = await fetch(params.sourceUrl)
    if (!response.ok) {
      throw new Error(`Failed to fetch sourceUrl: ${response.status}`)
    }
    return {
      data: Buffer.from(await response.arrayBuffer()),
      contentType: response.headers.get('content-type') || params.contentType || 'image/png',
    }
  }

  if (params.dataUrl) {
    return parseDataUrl(params.dataUrl)
  }

  return {
    data: Buffer.from(params.imageDataBase64!, 'base64'),
    contentType: params.contentType || 'image/png',
  }
}

export async function uploadScreenshotAsset(
  params: UploadScreenshotAssetParams,
  context: AccountContext
): Promise<UploadScreenshotAssetResult> {
  const { projectId, filename, category = 'raw' } = params

  if (!projectId) return { success: false, error: 'projectId is required' }
  if (!filename) return { success: false, error: 'filename is required' }
  if (!['raw', 'reference', 'temp'].includes(category)) {
    return { success: false, error: 'category must be one of: raw, reference, temp' }
  }

  const projectContext = await getProjectContext(context.userId, projectId)
  if (!projectContext) {
    return { success: false, error: 'Project not found' }
  }

  if (!hasContextPermission(projectContext, 'canCreateProjects')) {
    return { success: false, error: 'Permission denied' }
  }

  try {
    const asset = await readAssetInput(params)
    if (asset.data.length === 0) {
      return { success: false, error: 'Cannot upload an empty image asset' }
    }

    const uploaded = await uploadFile({
      userId: projectContext.type === 'personal' ? context.userId : undefined,
      orgId: projectContext.orgId,
      projectId,
      category,
      filename,
      data: asset.data,
      contentType: asset.contentType,
    })

    return {
      success: true,
      url: uploaded.url,
      key: uploaded.key,
      sizeBytes: uploaded.sizeBytes,
      contentType: uploaded.contentType,
      category,
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to upload screenshot asset',
    }
  }
}

export async function generateScreenshot(
  params: GenerateScreenshotParams,
  context: AccountContext
): Promise<GenerateScreenshotResult> {
  const { projectId, rawImageUrl, headline, subtitle, styleSource, anchorImageUrl, resizeToSizes, provider, model } = params

  // Validate project access
  const projectContext = await getProjectContext(context.userId, projectId)
  if (!projectContext) {
    return { success: false, error: 'Project not found' }
  }

  if (!hasContextPermission(projectContext, 'canCreateProjects')) {
    return { success: false, error: 'Permission denied' }
  }

  // Validate category if using category mode
  if (styleSource.type === 'category' && !APP_CATEGORIES.includes(styleSource.category)) {
    return { success: false, error: `Invalid category: ${styleSource.category}` }
  }

  const providerError = validateGenerationProvider(provider)
  if (providerError) return { success: false, error: providerError }

  const effectiveProvider = provider || 'gemini'
  const effectiveModel = model || (effectiveProvider === 'kie' ? AI_MODELS.kieImageDefault : AI_MODELS.imageDefault)
  const creditWeight = getImageCreditWeight(effectiveProvider, effectiveModel, effectiveProvider === 'kie' ? '2K' : '1K')
  const operationId = params.__usageOperationId || crypto.randomUUID()
  const reservation = await reserveUsage(context, {
    operationId,
    usageType: 'screenshots',
    units: creditWeight,
    metadata: { tool: 'generate_screenshot', projectId, provider: effectiveProvider, model: effectiveModel },
  })
  if (!reservation.allowed) {
    if (reservation.requiresUpgrade) {
      return {
        success: false,
        error: 'This feature requires a paid plan. Upgrade to Pro to unlock screenshot generation.',
        requiresUpgrade: true,
        upgradeUrl: '/billing'
      }
    }
    return { success: false, error: `Screenshot limit exceeded. Remaining: ${reservation.remaining}` }
  }
  if (reservation.replayed) return { success: false, error: 'This screenshot operation was already processed' }

  try {
    const result = await generateSingleScreenshot(
      rawImageUrl,
      headline,
      styleSource as StyleSource,
      {
        userId: projectContext.type === 'personal' ? context.userId : undefined,
        orgId: projectContext.orgId,
        projectId,
        resizeToSizes: resizeToSizes as ScreenshotSize[],
        provider,
        model,
      },
      anchorImageUrl,
      undefined,
      subtitle
    )

    if (!result.success) {
      await refundUsage(context, operationId, 'screenshots')
      return { success: false, error: result.error || 'Screenshot generation failed' }
    }

    await settleUsage(context, operationId, 'screenshots', creditWeight)

    // Log audit event
    if (projectContext.type === 'organization' && projectContext.orgId) {
      await logAuditEvent({
        orgId: projectContext.orgId,
        action: AuditAction.SCREENSHOT_GENERATED,
        userId: context.userId,
        resourceType: 'project',
        resourceId: projectId,
        metadata: {
          styleType: styleSource.type,
          headline
        }
      })
    }

    return {
      success: true,
      originalUrl: result.originalUrl,
      resizedUrls: result.resizedUrls
    }
  } catch (error) {
    await refundUsage(context, operationId, 'screenshots')
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Screenshot generation failed'
    }
  }
}

export async function generateScreenshots(
  params: GenerateScreenshotSetParams,
  context: AccountContext
): Promise<GenerateScreenshotSetResult> {
  const { projectId, screenshots, styleSource, resizeToSizes, deviceFrame, provider, model } = params

  // Validate project access
  const projectContext = await getProjectContext(context.userId, projectId)
  if (!projectContext) {
    return { success: false, error: 'Project not found' }
  }

  if (!hasContextPermission(projectContext, 'canCreateProjects')) {
    return { success: false, error: 'Permission denied' }
  }

  // Validate category if using category mode
  if (styleSource.type === 'category' && !APP_CATEGORIES.includes(styleSource.category)) {
    return { success: false, error: `Invalid category: ${styleSource.category}` }
  }

  const providerError = validateGenerationProvider(provider)
  if (providerError) return { success: false, error: providerError }

  const effectiveProvider = provider || 'gemini'
  const effectiveModel = model || (effectiveProvider === 'kie' ? AI_MODELS.kieImageDefault : AI_MODELS.imageDefault)
  const creditWeight = getImageCreditWeight(effectiveProvider, effectiveModel, effectiveProvider === 'kie' ? '2K' : '1K')
  const operationId = params.__usageOperationId || crypto.randomUUID()
  const reservation = await reserveUsage(context, {
    operationId,
    usageType: 'screenshots',
    units: screenshots.length * creditWeight,
    metadata: { tool: 'generate_screenshot_set', projectId, provider: effectiveProvider, model: effectiveModel },
  })
  if (!reservation.allowed) {
    if (reservation.requiresUpgrade) {
      return {
        success: false,
        error: 'This feature requires a paid plan. Upgrade to Pro to unlock screenshot generation.',
        requiresUpgrade: true,
        upgradeUrl: '/billing'
      }
    }
    return {
      success: false,
      error: `Screenshot limit exceeded. Remaining: ${reservation.remaining}, Required: ${screenshots.length * creditWeight}`
    }
  }
  if (reservation.replayed) return { success: false, error: 'This screenshot set was already processed' }

  const generateOptions = {
    userId: projectContext.type === 'personal' ? context.userId : undefined,
    orgId: projectContext.orgId,
    projectId,
    resizeToSizes: resizeToSizes as ScreenshotSize[],
    provider,
    model,
  }

  const rawImages = screenshots.map(s => ({ url: s.rawImageUrl, headline: s.headline, subtitle: s.subtitle }))

  // For large batches, process async to avoid MCP client timeout
  if (screenshots.length >= ASYNC_BATCH_THRESHOLD) {
    const jobId = await createScreenshotJob({
      userId: context.userId,
      projectId,
      toolName: 'generate_screenshot_set',
      totalScreenshots: screenshots.length,
    })

    return {
      success: true,
      async: true,
      jobId,
      totalScreenshots: screenshots.length,
      message: `Generating ${screenshots.length} screenshots in the background. Use get_screenshot_job_status with jobId "${jobId}" to monitor progress and retrieve results.`,
      __deferredWork: async () => {
        try {
          const results = await generateScreenshotSetWithStorage(
            rawImages,
            styleSource as StyleSource,
            generateOptions,
            0,
            undefined,
            deviceFrame
          )

          const successCount = results.filter(r => r.success).length
          await settleUsage(context, operationId, 'screenshots', successCount * creditWeight)

          if (projectContext.type === 'organization' && projectContext.orgId) {
            await logAuditEvent({
              orgId: projectContext.orgId,
              action: AuditAction.SCREENSHOT_GENERATED,
              userId: context.userId,
              resourceType: 'project',
              resourceId: projectId,
              metadata: { styleType: styleSource.type, count: screenshots.length, successCount }
            })
          }

          await completeScreenshotJob(jobId, results.map((r, i) => ({
            index: i,
            headline: screenshots[i].headline,
            success: r.success,
            originalUrl: r.originalUrl,
            resizedUrls: r.resizedUrls,
            error: r.error,
          })), { total: screenshots.length, success: successCount, failed: screenshots.length - successCount })
        } catch (error) {
          await refundUsage(context, operationId, 'screenshots')
          await failScreenshotJob(jobId, error instanceof Error ? error.message : 'Screenshot generation failed')
        }
      }
    }
  }

  // Small batch: process inline
  try {
    const results = await generateScreenshotSetWithStorage(
      rawImages,
      styleSource as StyleSource,
      generateOptions,
      0,
      undefined,
      deviceFrame
    )

    const successCount = results.filter(r => r.success).length

    await settleUsage(context, operationId, 'screenshots', successCount * creditWeight)

    if (projectContext.type === 'organization' && projectContext.orgId) {
      await logAuditEvent({
        orgId: projectContext.orgId,
        action: AuditAction.SCREENSHOT_GENERATED,
        userId: context.userId,
        resourceType: 'project',
        resourceId: projectId,
        metadata: { styleType: styleSource.type, count: screenshots.length, successCount }
      })
    }

    return {
      success: successCount > 0,
      results: results.map((r, i) => ({
        index: i,
        headline: screenshots[i].headline,
        success: r.success,
        originalUrl: r.originalUrl,
        resizedUrls: r.resizedUrls,
        error: r.error
      })),
      stats: {
        total: screenshots.length,
        success: successCount,
        failed: screenshots.length - successCount
      }
    }
  } catch (error) {
    await refundUsage(context, operationId, 'screenshots')
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Screenshot generation failed'
    }
  }
}

// ---- Plan-based screenshot generation (raw images + pre-defined enhancements) ----

export interface GenerateScreenshotsFromPlanParams {
  __usageOperationId?: string
  projectId: string
  screenshots: Array<{
    rawImageUrl: string
    headline: string
    subtitle?: string
    enhancement?: {
      focusArea: string
      visualTechnique: 'none' | 'pop-out' | 'floating-element'
      contextualNote: string
      enhancementPrompt: string
    }
  }>
  styleSource: {
    type: 'category'
    category: AppCategory
    customColors?: { primary: string; secondary: string }
  } | {
    type: 'reference'
    referenceImageUrl: string
  } | {
    type: 'custom'
    style: {
      gradientColors: { primary: string; secondary: string }
      fontStyle: string
      styleDescription: string
      decorativeElements: string[]
    }
  }
  appContext?: { name?: string; description?: string }
  deviceFrame?: DeviceFrame
  resizeToSizes?: Array<keyof typeof APPSTORE_SCREENSHOT_SIZES>
  provider?: ScreenshotGenerationProvider
  model?: string
}

export async function generateScreenshotsFromPlan(
  params: GenerateScreenshotsFromPlanParams,
  context: AccountContext
): Promise<GenerateScreenshotSetResult> {
  const { projectId, screenshots, styleSource, appContext, resizeToSizes, deviceFrame, provider, model } = params

  // Validate project access
  const projectContext = await getProjectContext(context.userId, projectId)
  if (!projectContext) {
    return { success: false, error: 'Project not found' }
  }

  if (!hasContextPermission(projectContext, 'canCreateProjects')) {
    return { success: false, error: 'Permission denied' }
  }

  // Validate category if using category mode
  if (styleSource.type === 'category' && !APP_CATEGORIES.includes(styleSource.category)) {
    return { success: false, error: `Invalid category: ${styleSource.category}` }
  }

  const providerError = validateGenerationProvider(provider)
  if (providerError) return { success: false, error: providerError }

  const effectiveProvider = provider || 'gemini'
  const effectiveModel = model || (effectiveProvider === 'kie' ? AI_MODELS.kieImageDefault : AI_MODELS.imageDefault)
  const creditWeight = getImageCreditWeight(effectiveProvider, effectiveModel, effectiveProvider === 'kie' ? '2K' : '1K')
  const operationId = params.__usageOperationId || crypto.randomUUID()
  const reservation = await reserveUsage(context, {
    operationId,
    usageType: 'screenshots',
    units: screenshots.length * creditWeight,
    metadata: { tool: 'generate_screenshots_from_plan', projectId, provider: effectiveProvider, model: effectiveModel },
  })
  if (!reservation.allowed) {
    if (reservation.requiresUpgrade) {
      return {
        success: false,
        error: 'This feature requires a paid plan. Upgrade to Pro to unlock screenshot generation.',
        requiresUpgrade: true,
        upgradeUrl: '/billing'
      }
    }
    return {
      success: false,
      error: `Screenshot limit exceeded. Remaining: ${reservation.remaining}, Required: ${screenshots.length * creditWeight}`
    }
  }
  if (reservation.replayed) return { success: false, error: 'This screenshot plan was already processed' }

  const generateOptions = {
    userId: projectContext.type === 'personal' ? context.userId : undefined,
    orgId: projectContext.orgId,
    projectId,
    resizeToSizes: resizeToSizes as ScreenshotSize[],
    provider,
    model,
  }

  const rawImages = screenshots.map(s => ({ url: s.rawImageUrl, headline: s.headline, subtitle: s.subtitle }))

  // Collect pre-defined enhancements (skip AI analysis)
  const preDefinedEnhancements: (ScreenshotEnhancement | undefined)[] = screenshots.map(s => s.enhancement as ScreenshotEnhancement | undefined)
  const hasEnhancements = preDefinedEnhancements.some(e => e !== undefined)
  const resolvedEnhancements = hasEnhancements
    ? preDefinedEnhancements.map(e => e || { focusArea: 'none', visualTechnique: 'none' as const, contextualNote: '', enhancementPrompt: '' })
    : undefined

  // For large batches, process async to avoid MCP client timeout
  if (screenshots.length >= ASYNC_BATCH_THRESHOLD) {
    const jobId = await createScreenshotJob({
      userId: context.userId,
      projectId,
      toolName: 'generate_screenshots_from_plan',
      totalScreenshots: screenshots.length,
    })

    return {
      success: true,
      async: true,
      jobId,
      totalScreenshots: screenshots.length,
      message: `Generating ${screenshots.length} screenshots in the background. Use get_screenshot_job_status with jobId "${jobId}" to monitor progress and retrieve results.`,
      __deferredWork: async () => {
        try {
          const results = await generateScreenshotSetWithStorage(
            rawImages,
            styleSource as StyleSource,
            generateOptions,
            0,
            resolvedEnhancements,
            deviceFrame
          )

          const successCount = results.filter(r => r.success).length
          await settleUsage(context, operationId, 'screenshots', successCount * creditWeight)

          if (projectContext.type === 'organization' && projectContext.orgId) {
            await logAuditEvent({
              orgId: projectContext.orgId,
              action: AuditAction.SCREENSHOT_GENERATED,
              userId: context.userId,
              resourceType: 'project',
              resourceId: projectId,
              metadata: { styleType: styleSource.type, source: 'plan', count: screenshots.length, successCount }
            })
          }

          await completeScreenshotJob(jobId, results.map((r, i) => ({
            index: i,
            headline: screenshots[i].headline,
            success: r.success,
            originalUrl: r.originalUrl,
            resizedUrls: r.resizedUrls,
            error: r.error,
          })), { total: screenshots.length, success: successCount, failed: screenshots.length - successCount })
        } catch (error) {
          await refundUsage(context, operationId, 'screenshots')
          await failScreenshotJob(jobId, error instanceof Error ? error.message : 'Screenshot generation failed')
        }
      }
    }
  }

  // Small batch: process inline
  try {
    const results = await generateScreenshotSetWithStorage(
      rawImages,
      styleSource as StyleSource,
      generateOptions,
      0,
      resolvedEnhancements,
      deviceFrame
    )

    const successCount = results.filter(r => r.success).length

    await settleUsage(context, operationId, 'screenshots', successCount * creditWeight)

    if (projectContext.type === 'organization' && projectContext.orgId) {
      await logAuditEvent({
        orgId: projectContext.orgId,
        action: AuditAction.SCREENSHOT_GENERATED,
        userId: context.userId,
        resourceType: 'project',
        resourceId: projectId,
        metadata: { styleType: styleSource.type, source: 'plan', count: screenshots.length, successCount }
      })
    }

    return {
      success: successCount > 0,
      results: results.map((r, i) => ({
        index: i,
        headline: screenshots[i].headline,
        success: r.success,
        originalUrl: r.originalUrl,
        resizedUrls: r.resizedUrls,
        error: r.error
      })),
      stats: {
        total: screenshots.length,
        success: successCount,
        failed: screenshots.length - successCount
      }
    }
  } catch (error) {
    await refundUsage(context, operationId, 'screenshots')
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Screenshot generation failed'
    }
  }
}
