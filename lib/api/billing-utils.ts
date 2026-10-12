import { BILLING_PLANS, PLAN_LIMITS, type UserPlan } from '@/lib/billing/catalog'
import { AccountContext, getPlanLimits, getAccountPlan } from '@/lib/org/context'
import { checkUsageLimit } from '@/lib/api/usage'

export interface BillingInfo {
  currentUsage: number
  monthlyLimit: number
  willExceedLimit: boolean
  withinPlanCount: number
  overageCount: number
  estimatedOverageCost: number
  plan: string
}

export interface UpgradeSuggestion {
  plan: string
  monthlyCost: number
  savings: number
  wouldCoverJob: boolean
}

const PLAN_ORDER: UserPlan[] = ['free', 'starter', 'pro', 'business', 'enterprise']

/**
 * Calculate billing info for a translation operation
 */
export async function calculateBillingInfo(
  authContext: AccountContext,
  operationType: 'translations' | 'screenshots' | 'icons',
  taskCount: number
): Promise<BillingInfo> {
  const usageCheck = await checkUsageLimit(authContext, operationType, taskCount)
  const plan = getAccountPlan(authContext)
  const limits = getPlanLimits(authContext)

  const limit = limits[operationType]
  const currentUsage = limit - usageCheck.remaining
  const afterJobUsage = currentUsage + taskCount
  const willExceedLimit = limit !== -1 && afterJobUsage > limit
  const withinPlanCount = willExceedLimit ? Math.max(0, limit - currentUsage) : taskCount
  const overageCount = willExceedLimit ? afterJobUsage - limit : 0
  const estimatedOverageCost = 0

  return {
    currentUsage,
    monthlyLimit: limit,
    willExceedLimit,
    withinPlanCount,
    overageCount,
    estimatedOverageCost,
    plan,
  }
}

/**
 * Calculate potential savings from upgrading to a higher plan
 */
export function getUpgradeSuggestions(
  currentPlan: string,
  operationType: 'translations' | 'screenshots' | 'icons',
  currentUsage: number,
  newTasks: number
): UpgradeSuggestion[] {
  const suggestions: UpgradeSuggestion[] = []
  const totalNeeded = currentUsage + newTasks

  const currentPlanIndex = PLAN_ORDER.indexOf(currentPlan as UserPlan)
  if (currentPlanIndex === -1) return suggestions

  // Calculate current overage cost
  const normalizedCurrentPlan = currentPlan as UserPlan
  const currentDefinition = BILLING_PLANS[normalizedCurrentPlan]
  if (!currentDefinition) return suggestions

  // Check each higher plan
  for (let i = currentPlanIndex + 1; i < PLAN_ORDER.length; i++) {
    const upgradePlan = PLAN_ORDER[i]
    const upgradeLimit = PLAN_LIMITS[upgradePlan][operationType]
    const wouldCoverJob = upgradeLimit === -1 || totalNeeded <= upgradeLimit
    const currentPrice = currentDefinition.monthlyPriceUsd || 0
    const upgradeMonthlyCost = Math.max(0, (BILLING_PLANS[upgradePlan].monthlyPriceUsd || 0) - currentPrice)

    if (wouldCoverJob) {
      suggestions.push({
        plan: upgradePlan,
        monthlyCost: upgradeMonthlyCost,
        savings: 0,
        wouldCoverJob,
      })
    }
  }

  return suggestions
}

/**
 * Format billing info for API response
 */
export function formatBillingResponse(billing: BillingInfo, upgradeSuggestions?: UpgradeSuggestion[]) {
  return {
    billing,
    ...(upgradeSuggestions && upgradeSuggestions.length > 0 ? { upgradeSuggestions } : {}),
  }
}
