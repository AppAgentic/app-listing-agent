import { suggestHeadlines as generateHeadlines, AppMetadata } from '@/lib/services/headline-generator'
import { AppCategory, APP_CATEGORIES } from '@/lib/constants'
import { AccountContext, getProjectContext, hasContextPermission } from '@/lib/org/context'
import crypto from 'crypto'
import { refundUsage, reserveUsage, settleUsage } from '@/lib/api/usage'
import { AI_MODELS } from '@/lib/billing/catalog'

export interface SuggestHeadlinesParams {
  __usageOperationId?: string
  projectId: string
  screenshotUrl: string
  appMetadata: AppMetadata
  appCategory?: AppCategory
  numberOfSuggestions?: number
}

export interface SuggestHeadlinesResult {
  success: boolean
  headlines?: string[]
  confidence?: 'high' | 'medium' | 'low'
  screenshotDescription?: string
  error?: string
  requiresUpgrade?: boolean
  upgradeUrl?: string
}

export async function suggestHeadlines(
  params: SuggestHeadlinesParams,
  context: AccountContext
): Promise<SuggestHeadlinesResult> {
  const { projectId, screenshotUrl, appMetadata, appCategory, numberOfSuggestions } = params

  // Validate project access
  const projectContext = await getProjectContext(context.userId, projectId)
  if (!projectContext) {
    return { success: false, error: 'Project not found' }
  }

  if (!hasContextPermission(projectContext, 'canCreateProjects')) {
    return { success: false, error: 'Permission denied' }
  }

  // Validate category if provided
  if (appCategory && !APP_CATEGORIES.includes(appCategory)) {
    return { success: false, error: `Invalid category: ${appCategory}` }
  }

  const operationId = params.__usageOperationId || crypto.randomUUID()
  const reservation = await reserveUsage(context, {
    operationId,
    usageType: 'translations',
    units: 1,
    metadata: { tool: 'suggest_headlines', projectId, model: AI_MODELS.textQuality },
  })
  if (!reservation.allowed) {
    if (reservation.requiresUpgrade) {
      return {
        success: false,
        error: 'This feature requires a paid plan. Upgrade to Pro to unlock headline suggestions.',
        requiresUpgrade: true,
        upgradeUrl: '/billing'
      }
    }
    return { success: false, error: `Translation limit exceeded. Remaining: ${reservation.remaining}` }
  }
  if (reservation.replayed) return { success: false, error: 'This headline operation was already processed' }

  try {
    const result = await generateHeadlines({
      screenshotUrl,
      appMetadata,
      appCategory,
      numberOfSuggestions: numberOfSuggestions || 3
    })

    await settleUsage(context, operationId, 'translations', 1)

    return {
      success: true,
      headlines: result.headlines,
      confidence: result.confidence,
      screenshotDescription: result.screenshotDescription
    }
  } catch (error) {
    await refundUsage(context, operationId, 'translations')
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to generate headlines'
    }
  }
}
