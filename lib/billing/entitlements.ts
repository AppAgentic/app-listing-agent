import type { Timestamp } from 'firebase-admin/firestore'
import { hasInternalIntegrationAccess } from '@/lib/features/internal-integrations'
import type { AccountContext } from '@/lib/org/context'
import type { BillingEntitlement, Organization, User } from '@/lib/firebase/firestore'
import { validReviewGrant } from './review-grant'
import { expectedStripeBinding } from '@/lib/stripe/config'
import { isSelfHosted } from '@/lib/selfhost/config'
import {
  PLAN_LIMITS,
  SELF_HOSTED_PLAN,
  SELF_HOSTED_PLAN_LIMITS,
  normalizeUserPlan,
  type PlanLimits,
  type UserPlan,
} from './catalog'

type AccountRecord = Pick<User, 'plan' | 'billing'> | Pick<Organization, 'plan' | 'billing'>

function toDate(value: Timestamp | Date | string | null | undefined): Date | null {
  if (!value) return null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  if (typeof value === 'string') {
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? null : parsed
  }
  if (typeof (value as Timestamp).toDate === 'function') {
    return (value as Timestamp).toDate()
  }
  return null
}

/**
 * Paid access comes only from a Stripe subscription recorded by the verified webhook, for the Stripe
 * account and mode this deployment is bound to. A sandbox record in the production database, a record
 * from another Stripe account, or any legacy provider record never grants access. Trialing counts as
 * active, and past_due keeps access while Stripe retries the payment (SeedViral grace behaviour).
 */
export function isVerifiedPaidEntitlement(
  billing: BillingEntitlement | undefined,
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (!billing) return false
  const binding = expectedStripeBinding(env)
  return Boolean(
    binding &&
    billing.source === 'stripe' &&
    (billing.status === 'active' || billing.status === 'trialing' || billing.status === 'past_due') &&
    typeof billing.subscriptionId === 'string' && billing.subscriptionId.startsWith('sub_') &&
    billing.livemode === binding.livemode &&
    billing.providerAccountId === binding.accountId &&
    billing.plan !== 'free'
  )
}

export function getEffectivePlan(context: AccountContext): UserPlan {
  const account: AccountRecord = context.type === 'organization' && context.organization
    ? context.organization
    : context.user

  if (isSelfHosted()) return SELF_HOSTED_PLAN

  if (hasInternalIntegrationAccess(context)) {
    return normalizeUserPlan(account.billing?.plan || account.plan)
  }

  if (isVerifiedPaidEntitlement(account.billing)) {
    return normalizeUserPlan(account.billing?.plan)
  }

  return 'free'
}

export function getEffectivePlanLimits(context: AccountContext, now = new Date()): PlanLimits {
  // Self-hosted installs have no billing, so no allowance is ever metered down.
  if (isSelfHosted()) return { ...SELF_HOSTED_PLAN_LIMITS }
  const plan = getEffectivePlan(context)
  const limits = PLAN_LIMITS[plan]
  // Only personal free accounts receive sponsored quota. Paid entitlements,
  // app/team limits, publishing and internal feature access remain unchanged.
  const grant = context.type === 'personal' && !context.user.organizationId && plan === 'free'
    ? validReviewGrant(context.user.billing?.reviewGrant, context.userId, now)
    : null
  // A review grant is sponsored reviewer access: its capped media quotas plus one app to review.
  return grant ? { ...limits, ...grant.limits, apps: Math.max(limits.apps, 1) } : limits
}

export interface BillingPeriod {
  key: string
  startsAt: Date
  endsAt: Date
}

function calendarMonthPeriod(now: Date): BillingPeriod {
  const startsAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const endsAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
  return {
    key: `${startsAt.getUTCFullYear()}-${String(startsAt.getUTCMonth() + 1).padStart(2, '0')}`,
    startsAt,
    endsAt,
  }
}

function addUtcMonths(date: Date, months: number): Date {
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1,
    date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds(), date.getUTCMilliseconds()))
  // Clamp to the last day of the target month (a subscription started on the 31st renews on the 30th, 28th...).
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate()
  target.setUTCDate(Math.min(date.getUTCDate(), lastDay))
  return target
}

/**
 * Usage window for allowances. Allowances are monthly on every paid plan, including annual plans (as
 * the pricing copy promises): a paid subscription's period is split into monthly windows anchored on the
 * subscription period start, so an annual subscriber gets a fresh allowance every month on their billing
 * day. Free accounts use the calendar month.
 */
export function getBillingPeriod(context: AccountContext, now = new Date()): BillingPeriod {
  const account: AccountRecord = context.type === 'organization' && context.organization
    ? context.organization
    : context.user
  const billing = account.billing

  if (isVerifiedPaidEntitlement(billing)) {
    const periodStart = toDate(billing?.currentPeriodStart)
    const periodEnd = toDate(billing?.currentPeriodEnd)
    if (periodStart && periodEnd && periodStart < periodEnd && now >= periodStart && now < periodEnd) {
      let startsAt = periodStart
      let endsAt = addUtcMonths(periodStart, 1)
      for (let month = 1; endsAt <= now && month <= 24; month += 1) {
        startsAt = endsAt
        endsAt = addUtcMonths(periodStart, month + 1)
      }
      if (endsAt > periodEnd) endsAt = periodEnd
      const format = (date: Date) => date.toISOString().slice(0, 10)
      return {
        key: `${format(startsAt)}_${format(endsAt)}`,
        startsAt,
        endsAt,
      }
    }
  }

  return calendarMonthPeriod(now)
}
