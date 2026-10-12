import type { AccountContext } from '@/lib/org/context'
import type { MeteredUsageType } from '@/lib/billing/catalog'
import {
  normalizeOperationId,
  readUsage,
  reserveUsage,
  settleUsage,
  refundUsage,
  withUsageReservation,
  UsageLimitError,
} from '@/lib/billing/ledger'
import type { UsageReservationResult } from '@/lib/billing/ledger'

export type UsageType = MeteredUsageType | 'uploads'

export interface UsageLimitResult {
  allowed: boolean
  remaining: number
  limit: number
  requiresUpgrade: boolean
  isOverage: false
  overageAmount: 0
  estimatedOverageCost: 0
  reason?: 'upgrade_required' | 'limit_reached'
}

function meteredType(usageType: UsageType): MeteredUsageType {
  return usageType === 'uploads' ? 'publishing' : usageType
}

/** Read-only quota check. Reservations are performed by reserveUsage. */
export async function checkUsageLimit(
  context: AccountContext,
  usageType: UsageType,
  amount = 1
): Promise<UsageLimitResult> {
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new Error('Usage amount must be a positive safe integer')
  }
  const usage = await readUsage(context, meteredType(usageType))
  const allowed = usage.limit === -1 || amount <= usage.remaining
  return {
    allowed,
    remaining: usage.remaining,
    limit: usage.limit,
    requiresUpgrade: !allowed && usage.plan === 'free',
    isOverage: false,
    overageAmount: 0,
    estimatedOverageCost: 0,
    ...(!allowed
      ? { reason: usage.plan === 'free' ? 'upgrade_required' as const : 'limit_reached' as const }
      : {}),
  }
}

export function createPaywallResponse(usageType: UsageType, result: UsageLimitResult) {
  const status = result.requiresUpgrade ? 402 : 403
  return Response.json({
    error: result.requiresUpgrade ? 'upgrade_required' : 'limit_reached',
    message: result.requiresUpgrade
      ? `Upgrade to continue using ${usageType}.`
      : `You've reached your ${usageType} allowance for this billing period.`,
    feature: usageType,
    used: result.limit === -1 ? 0 : result.limit - result.remaining,
    limit: result.limit,
    upgradeUrl: '/billing',
  }, { status })
}

export function createReservationErrorResponse(result: UsageReservationResult) {
  return createPaywallResponse(result.usageType, {
    allowed: false,
    remaining: result.remaining,
    limit: result.limit,
    requiresUpgrade: result.requiresUpgrade,
    isOverage: false,
    overageAmount: 0,
    estimatedOverageCost: 0,
    reason: result.reason,
  })
}

/**
 * Compatibility helper for non-provider counters. AI/provider paths should use
 * reserveUsage -> settleUsage/refundUsage with a stable operation ID.
 */
export async function incrementUsage(
  context: AccountContext,
  usageType: UsageType,
  operationId: string,
  amount = 1
): Promise<{ isOverage: false; overageAmount: 0; estimatedOverageCost: 0 }> {
  const type = meteredType(usageType)
  const reservation = await reserveUsage(context, {
    operationId,
    usageType: type,
    units: amount,
    metadata: { source: 'legacy-increment' },
  })
  if (!reservation.allowed) throw new UsageLimitError(reservation)
  if (!reservation.replayed) {
    await settleUsage(context, operationId, type, amount)
  }
  return { isOverage: false, overageAmount: 0, estimatedOverageCost: 0 }
}

export interface UsageDetails {
  used: number
  reserved: number
  limit: number
  overage: 0
  overageCost: 0
}

export interface CurrentUsageResult {
  translations: UsageDetails
  screenshots: UsageDetails
  icons: UsageDetails
  uploads: UsageDetails
  apps: UsageDetails
  totalOverageCost: 0
  month: string
  periodKey: string
}

export async function getCurrentUsage(context: AccountContext): Promise<CurrentUsageResult> {
  const [translations, screenshots, icons, publishing, apps] = await Promise.all([
    readUsage(context, 'translations'),
    readUsage(context, 'screenshots'),
    readUsage(context, 'icons'),
    readUsage(context, 'publishing'),
    readUsage(context, 'apps'),
  ])
  const details = (value: Awaited<ReturnType<typeof readUsage>>): UsageDetails => ({
    used: value.used,
    reserved: value.reserved,
    limit: value.limit,
    overage: 0,
    overageCost: 0,
  })
  return {
    translations: details(translations),
    screenshots: details(screenshots),
    icons: details(icons),
    uploads: details(publishing),
    apps: details(apps),
    totalOverageCost: 0,
    month: translations.periodKey,
    periodKey: translations.periodKey,
  }
}

export async function checkMultipleUsageLimits(
  context: AccountContext,
  requirements: Partial<Record<UsageType, number>>
): Promise<{
  allowed: boolean
  details: Record<UsageType, { allowed: boolean; remaining: number; limit: number }>
}> {
  const usageTypes: UsageType[] = ['translations', 'screenshots', 'icons', 'uploads', 'apps', 'publishing']
  const details = {} as Record<UsageType, { allowed: boolean; remaining: number; limit: number }>
  for (const usageType of usageTypes) {
    const amount = requirements[usageType] || 0
    if (amount === 0) {
      details[usageType] = { allowed: true, remaining: -1, limit: -1 }
      continue
    }
    const result = await checkUsageLimit(context, usageType, amount)
    details[usageType] = {
      allowed: result.allowed,
      remaining: result.remaining,
      limit: result.limit,
    }
  }
  return {
    allowed: Object.values(details).every(detail => detail.allowed),
    details,
  }
}

export {
  normalizeOperationId,
  readUsage,
  reserveUsage,
  settleUsage,
  refundUsage,
  withUsageReservation,
  UsageLimitError,
}
