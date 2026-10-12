import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import type { AccountContext } from '@/lib/org/context'
import { getBillingPeriod, getEffectivePlan } from '@/lib/billing/entitlements'
import { BILLING_PLANS, OVERAGE_RATES, PLAN_ORDER, PUBLIC_BILLING_PLANS, isOfferedBillingPlan, offeredBillingPlans } from '@/lib/billing/catalog'
import { SANDBOX_STRIPE_ACCOUNT_ID } from '@/lib/stripe/config'

function context(overrides: Record<string, unknown> = {}): AccountContext {
  return {
    type: 'personal',
    userId: 'customer-one',
    user: {
      email: 'customer@example.com',
      plan: 'business',
      planLimits: {
        translations: 3000,
        screenshots: 750,
        icons: 200,
        publishing: -1,
        apps: -1,
        teamMembers: 5,
      },
      organizationId: null,
      apiKey: 'test-key',
      createdAt: {} as never,
      updatedAt: {} as never,
      ...overrides,
    },
  }
}

afterEach(() => vi.unstubAllEnvs())

describe('server-owned entitlements', () => {
  it('keeps the public paid-media catalog aligned and AI usage bounded', () => {
    expect(BILLING_PLANS.starter).toMatchObject({
      name: 'Solo',
      monthlyPriceUsd: 99,
      annualPriceUsd: 990,
    })
    expect(BILLING_PLANS.pro).toMatchObject({
      name: 'Pro',
      monthlyPriceUsd: 249,
      annualPriceUsd: 2490,
    })
    expect(BILLING_PLANS.business).toMatchObject({
      name: 'Studio',
      monthlyPriceUsd: 599,
      annualPriceUsd: 5990,
    })
    expect(BILLING_PLANS.enterprise.limits.icons).toBeGreaterThan(0)
  })

  it('defines Indie as the cheapest paid plan: $49/mo, $490/yr, 1 app, small allowances, unlimited publishing', () => {
    expect(BILLING_PLANS.indie).toEqual({
      id: 'indie',
      name: 'Indie',
      monthlyPriceUsd: 49,
      annualPriceUsd: 490,
      public: true,
      limits: { translations: 50, screenshots: 10, icons: 3, publishing: -1, apps: 1, teamMembers: 1 },
    })
    expect(OVERAGE_RATES.indie).toBeNull()
    expect(PUBLIC_BILLING_PLANS).toEqual(['indie', 'starter', 'pro', 'business'])
    expect(Object.keys(BILLING_PLANS)).toEqual(['free', 'indie', 'starter', 'pro', 'business', 'enterprise'])
    expect(PLAN_ORDER).toEqual(['free', 'indie', 'starter', 'pro', 'business', 'enterprise'])
    // Ordering by price, cheapest paid tier first.
    const paid = PLAN_ORDER.filter(plan => plan !== 'free' && plan !== 'enterprise').map(plan => BILLING_PLANS[plan].monthlyPriceUsd!)
    expect(paid).toEqual([...paid].sort((a, b) => a - b))
  })

  it('offers Indie only when NEXT_PUBLIC_BILLING_INDIE_ENABLED is true', () => {
    expect(offeredBillingPlans(false)).toEqual(['starter', 'pro', 'business'])
    expect(offeredBillingPlans(true)).toEqual(['indie', 'starter', 'pro', 'business'])
    expect(offeredBillingPlans()).toEqual(['starter', 'pro', 'business'])
    vi.stubEnv('NEXT_PUBLIC_BILLING_INDIE_ENABLED', 'true')
    expect(offeredBillingPlans()).toEqual(['indie', 'starter', 'pro', 'business'])
    expect(isOfferedBillingPlan('indie')).toBe(true)
    vi.stubEnv('NEXT_PUBLIC_BILLING_INDIE_ENABLED', '1')
    expect(isOfferedBillingPlan('indie')).toBe(false)
    expect(isOfferedBillingPlan('enterprise')).toBe(false)
  })

  it('ignores a legacy self-assigned plan without verified billing', () => {
    expect(getEffectivePlan(context())).toBe('free')
  })

  it('accepts an active, trialing or past_due (grace) Stripe entitlement for this account and mode, and rejects everything else', () => {
    vi.stubEnv('STRIPE_ACCOUNT_ID', SANDBOX_STRIPE_ACCOUNT_ID)
    vi.stubEnv('STRIPE_LIVEMODE', 'false')
    const billing = {
      status: 'active' as const,
      source: 'stripe' as const,
      plan: 'pro' as const,
      subscriptionId: 'sub_subscription1',
      livemode: false,
      providerAccountId: SANDBOX_STRIPE_ACCOUNT_ID,
      updatedAt: {} as never,
    }
    expect(getEffectivePlan(context({ billing }))).toBe('pro')
    expect(getEffectivePlan(context({ billing: { ...billing, status: 'trialing' } }))).toBe('pro')
    expect(getEffectivePlan(context({ billing: { ...billing, status: 'past_due', plan: 'business' } }))).toBe('business')
    expect(getEffectivePlan(context({ billing: { ...billing, status: 'incomplete', plan: 'business' } }))).toBe('free')
    expect(getEffectivePlan(context({ billing: { ...billing, livemode: true } }))).toBe('free')
    expect(getEffectivePlan(context({ billing: { ...billing, providerAccountId: 'acct_otheraccount1' } }))).toBe('free')
    expect(getEffectivePlan(context({ billing: { ...billing, subscriptionId: null } }))).toBe('free')
    expect(getEffectivePlan(context({ billing: { ...billing, source: 'whop', membershipId: 'mem_legacy' } as never }))).toBe('free')
    vi.stubEnv('STRIPE_ACCOUNT_ID', '')
    expect(getEffectivePlan(context({ billing }))).toBe('free')
  })

  it('uses monthly windows inside the provider billing period', () => {
    vi.stubEnv('STRIPE_ACCOUNT_ID', SANDBOX_STRIPE_ACCOUNT_ID)
    vi.stubEnv('STRIPE_LIVEMODE', 'false')
    const billing = {
      status: 'active' as const,
      source: 'stripe' as const,
      plan: 'pro' as const,
      subscriptionId: 'sub_subscription1',
      livemode: false,
      providerAccountId: SANDBOX_STRIPE_ACCOUNT_ID,
      updatedAt: {} as never,
    }
    const monthly = getBillingPeriod(context({
      billing: { ...billing, currentPeriodStart: '2026-07-05T00:00:00.000Z' as never, currentPeriodEnd: '2026-08-05T00:00:00.000Z' as never },
    }), new Date('2026-07-11T12:00:00.000Z'))
    expect(monthly.key).toBe('2026-07-05_2026-08-05')

    const annual = context({
      billing: { ...billing, billingInterval: 'annual', currentPeriodStart: '2026-07-05T00:00:00.000Z' as never, currentPeriodEnd: '2027-07-05T00:00:00.000Z' as never },
    })
    expect(getBillingPeriod(annual, new Date('2026-07-11T12:00:00.000Z')).key).toBe('2026-07-05_2026-08-05')
    expect(getBillingPeriod(annual, new Date('2026-09-20T12:00:00.000Z')).key).toBe('2026-09-05_2026-10-05')
    expect(getBillingPeriod(annual, new Date('2027-07-01T12:00:00.000Z')).key).toBe('2027-06-05_2027-07-05')
  })

  it('keeps the explicit internal allowlist bypass scoped by user ID', () => {
    vi.stubEnv('INTERNAL_INTEGRATION_ALLOWED_USER_IDS', 'customer-one')
    expect(getEffectivePlan(context())).toBe('business')
  })

  it('locks billing fields and direct project creation in Firestore rules', () => {
    const rules = readFileSync(resolve(process.cwd(), 'firestore.rules'), 'utf8')
    for (const field of ['plan', 'planLimits', 'billing', 'stripeCustomers', 'billingTrial']) {
      expect(rules).toContain(`'${field}'`)
    }
    expect(rules).toContain('allow create: if false; // Project API enforces plan limits atomically.')
  })
})
