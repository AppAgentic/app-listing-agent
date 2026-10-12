import { saveIconRecord } from '@/lib/services/icon-records'
import {
  generateIcon as generateIconService,
  generateIconVariations as generateIconVariationsService,
  fetchAppStoreIcon,
  resizeExternalIcon,
  IconSource,
  GeneratedIcon,
  IconVariation,
} from '@/lib/services/icon-generator'
import crypto from 'crypto'
import { APP_CATEGORIES, AppCategory, ICON_STYLES, IconStyle, isIconStyle } from '@/lib/constants'
import { AccountContext, getProjectContext, hasContextPermission } from '@/lib/org/context'
import { refundUsage, reserveUsage, settleUsage } from '@/lib/api/usage'
import { logAuditEvent, AuditAction } from '@/lib/org/audit'
import { getIconEngine } from '@/lib/services/icon-engine'

export interface GenerateIconParams {
  __usageOperationId?: string
  projectId: string
  source:
    | { type: 'prompt'; prompt: string }
    | { type: 'metadata'; appMetadata: { title: string; category?: AppCategory; subtitle?: string; description?: string; keywords?: string } }
    | { type: 'reference'; referenceImageUrl: string; prompt?: string }
    | { type: 'appstore'; appId: string }
  style?: IconStyle
  colors?: { primary: string; secondary?: string }
  background?: 'solid' | 'gradient'
}

export interface GenerateIconVariationsParams {
  __usageOperationId?: string
  projectId: string
  prompt: string
  colors?: { primary: string; secondary?: string }
}

export interface GenerateIconResult {
  id?: string
  success: boolean
  originalUrl?: string
  ios?: string
  android?: string
  error?: string
  requiresUpgrade?: boolean
  upgradeUrl?: string
}

export interface GenerateIconVariationsResult {
  success: boolean
  variations?: Array<{
    id?: string
    style: IconStyle
    success: boolean
    originalUrl?: string
    ios?: string
    android?: string
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
}

export interface FetchAppStoreIconResult {
  success: boolean
  appName?: string
  originalUrl?: string
  ios?: string
  android?: string
  error?: string
}

export interface ResizeIconResult {
  success: boolean
  ios?: string
  android?: string
  error?: string
}

/**
 * Generate a single app icon using AI
 */
export async function generateIcon(
  params: GenerateIconParams,
  context: AccountContext
): Promise<GenerateIconResult> {
  const { projectId, source, style, colors, background } = params

  // Validate project access
  const projectContext = await getProjectContext(context.userId, projectId)
  if (!projectContext) {
    return { success: false, error: 'Project not found' }
  }

  if (!hasContextPermission(projectContext, 'canCreateProjects')) {
    return { success: false, error: 'Permission denied' }
  }

  // Validate style if provided
  if (style && !isIconStyle(style)) {
    return { success: false, error: `Invalid style: ${style}. Valid styles: ${ICON_STYLES.join(', ')}` }
  }

  // Validate category if using metadata source
  if (source.type === 'metadata' && source.appMetadata.category) {
    if (!APP_CATEGORIES.includes(source.appMetadata.category)) {
      return { success: false, error: `Invalid category: ${source.appMetadata.category}` }
    }
  }

  const creditWeight = getIconEngine().creditWeight
  const operationId = params.__usageOperationId || crypto.randomUUID()
  const reservation = await reserveUsage(context, {
    operationId,
    usageType: 'icons',
    units: creditWeight,
    metadata: { tool: 'generate_icon', projectId, model: getIconEngine().model },
  })
  if (!reservation.allowed) {
    if (reservation.requiresUpgrade) {
      return {
        success: false,
        error: 'This feature requires a paid plan. Upgrade to Pro to unlock icon generation.',
        requiresUpgrade: true,
        upgradeUrl: '/billing',
      }
    }
    return { success: false, error: `Icon limit exceeded. Remaining: ${reservation.remaining}` }
  }
  if (reservation.replayed) return { success: false, error: 'This icon operation was already processed' }

  try {
    const result = await generateIconService(
      {
        source: source as IconSource,
        style,
        colors,
        background,
      },
      {
        userId: projectContext.type === 'personal' ? context.userId : undefined,
        orgId: projectContext.orgId,
        projectId,
      }
    )

    if (!result.success) {
      await refundUsage(context, operationId, 'icons')
      return { success: false, error: result.error || 'Icon generation failed' }
    }

    const id = await saveIconRecord(result, { userId: context.userId, orgId: projectContext.orgId, projectId, style,
      prompt: source.type === 'prompt' ? source.prompt : source.type === 'metadata' ? source.appMetadata.title : source.type === 'reference' ? source.prompt : undefined })
    await settleUsage(context, operationId, 'icons', creditWeight)

    // Log audit event
    if (projectContext.type === 'organization' && projectContext.orgId) {
      await logAuditEvent({
        orgId: projectContext.orgId,
        action: AuditAction.ICON_GENERATED,
        userId: context.userId,
        resourceType: 'project',
        resourceId: projectId,
        metadata: {
          sourceType: source.type,
          style,
        },
      })
    }

    return {
      success: true,
      id,
      originalUrl: result.originalUrl,
      ios: result.ios,
      android: result.android,
    }
  } catch (error) {
    await refundUsage(context, operationId, 'icons')
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Icon generation failed',
    }
  }
}

/**
 * Generate multiple style variations of an icon
 */
export async function generateIconVariations(
  params: GenerateIconVariationsParams,
  context: AccountContext
): Promise<GenerateIconVariationsResult> {
  const { projectId, prompt, colors } = params

  // Validate project access
  const projectContext = await getProjectContext(context.userId, projectId)
  if (!projectContext) {
    return { success: false, error: 'Project not found' }
  }

  if (!hasContextPermission(projectContext, 'canCreateProjects')) {
    return { success: false, error: 'Permission denied' }
  }

  const creditWeight = getIconEngine().creditWeight
  const operationId = params.__usageOperationId || crypto.randomUUID()
  const reservation = await reserveUsage(context, {
    operationId,
    usageType: 'icons',
    units: 4 * creditWeight,
    metadata: { tool: 'generate_icon_variations', projectId, model: getIconEngine().model },
  })
  if (!reservation.allowed) {
    if (reservation.requiresUpgrade) {
      return {
        success: false,
        error: 'This feature requires a paid plan. Upgrade to Pro to unlock icon generation.',
        requiresUpgrade: true,
        upgradeUrl: '/billing',
      }
    }
    return {
      success: false,
      error: `Icon limit exceeded. Remaining: ${reservation.remaining}, Required: ${4 * creditWeight}`,
    }
  }
  if (reservation.replayed) return { success: false, error: 'This icon operation was already processed' }

  try {
    const variations = await generateIconVariationsService(
      prompt,
      {
        userId: projectContext.type === 'personal' ? context.userId : undefined,
        orgId: projectContext.orgId,
        projectId,
      },
      colors
    )

    const savedIds = new Map<string, string>()
    for (const variation of variations) {
      if (!variation.icon.success) continue
      try {
        savedIds.set(variation.icon.originalUrl, await saveIconRecord(variation.icon, {
          userId: context.userId, orgId: projectContext.orgId, projectId, style: variation.style, prompt,
        }))
      } catch {
        variation.icon.success = false
        variation.icon.error = 'Could not save icon; this variation was not charged'
      }
    }

    const successCount = variations.filter((v) => v.icon.success).length

    if (successCount > 0) await settleUsage(context, operationId, 'icons', successCount * creditWeight)
    else await refundUsage(context, operationId, 'icons')

    // Log audit event
    if (projectContext.type === 'organization' && projectContext.orgId) {
      await logAuditEvent({
        orgId: projectContext.orgId,
        action: AuditAction.ICON_GENERATED,
        userId: context.userId,
        resourceType: 'project',
        resourceId: projectId,
        metadata: {
          operation: 'variations',
          count: 4,
          successCount,
        },
      })
    }

    return {
      success: successCount > 0,
      variations: variations.map((v) => ({
        id: savedIds.get(v.icon.originalUrl),
        style: v.style,
        success: v.icon.success,
        originalUrl: v.icon.originalUrl,
        ios: v.icon.ios,
        android: v.icon.android,
        error: v.icon.error,
      })),
      stats: {
        total: 4,
        success: successCount,
        failed: 4 - successCount,
      },
    }
  } catch (error) {
    await refundUsage(context, operationId, 'icons')
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Icon variations generation failed',
    }
  }
}

/**
 * Fetch an existing icon from the App Store
 */
export async function fetchIconFromAppStore(
  projectId: string,
  appId: string,
  context: AccountContext
): Promise<FetchAppStoreIconResult> {
  // Validate project access
  const projectContext = await getProjectContext(context.userId, projectId)
  if (!projectContext) {
    return { success: false, error: 'Project not found' }
  }

  if (!hasContextPermission(projectContext, 'canCreateProjects')) {
    return { success: false, error: 'Permission denied' }
  }

  try {
    const appStoreResult = await fetchAppStoreIcon(appId)

    if (!appStoreResult.success || !appStoreResult.iconUrl) {
      return {
        success: false,
        error: appStoreResult.error || 'Failed to fetch App Store icon',
      }
    }

    // Resize to platform sizes
    const resized = await resizeExternalIcon(appStoreResult.iconUrl, {
      userId: projectContext.type === 'personal' ? context.userId : undefined,
      orgId: projectContext.orgId,
      projectId,
    })

    if (!resized.success) {
      return {
        success: false,
        error: resized.error || 'Failed to resize icon',
      }
    }

    return {
      success: true,
      appName: appStoreResult.appName,
      originalUrl: appStoreResult.iconUrl,
      ios: resized.ios,
      android: resized.android,
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch App Store icon',
    }
  }
}

/**
 * Resize an existing icon to iOS and Android sizes
 */
export async function resizeIcon(
  projectId: string,
  imageUrl: string,
  context: AccountContext
): Promise<ResizeIconResult> {
  // Validate project access
  const projectContext = await getProjectContext(context.userId, projectId)
  if (!projectContext) {
    return { success: false, error: 'Project not found' }
  }

  if (!hasContextPermission(projectContext, 'canCreateProjects')) {
    return { success: false, error: 'Permission denied' }
  }

  try {
    const result = await resizeExternalIcon(imageUrl, {
      userId: projectContext.type === 'personal' ? context.userId : undefined,
      orgId: projectContext.orgId,
      projectId,
    })

    if (!result.success) {
      return {
        success: false,
        error: result.error || 'Failed to resize icon',
      }
    }

    return {
      success: true,
      ios: result.ios,
      android: result.android,
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to resize icon',
    }
  }
}
