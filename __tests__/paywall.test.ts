import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Timestamp } from 'firebase-admin/firestore'
import type { AccountContext } from '@/lib/org/context'
import { getProductAccess, paymentRequiredPayload } from '@/lib/billing/access'
import { isUnpaidApiPath, isUnpaidPagePath, UNPAID_MCP_TOOLS } from '@/lib/billing/paywall-routes'
import { BILLING_PLANS } from '@/lib/billing/catalog'
import { reviewPeriod, REVIEW_LIMITS } from '@/lib/billing/review-grant'
import { LIVE_STRIPE_ACCOUNT_ID, SANDBOX_STRIPE_ACCOUNT_ID } from '@/lib/stripe/config'

const stripe = (status: string, extra: Record<string, unknown> = {}) => ({
  source: 'stripe', status, plan: status === 'cancelled' || status === 'incomplete' ? 'free' : 'pro', subscriptionId: 'sub_paywall00001',
  livemode: false, providerAccountId: SANDBOX_STRIPE_ACCOUNT_ID, updatedAt: {} as never, ...extra,
})
const personal = (billing?: Record<string, unknown>, userId = 'customer-one'): AccountContext => ({
  type: 'personal', userId,
  user: { email: 'customer@example.com', plan: 'free', planLimits: BILLING_PLANS.free.limits, organizationId: null, apiKey: 'k', createdAt: {} as never, updatedAt: {} as never, ...(billing ? { billing: billing as never } : {}) },
})

beforeEach(() => {
  vi.stubEnv('STRIPE_ACCOUNT_ID', SANDBOX_STRIPE_ACCOUNT_ID)
  vi.stubEnv('STRIPE_LIVEMODE', 'false')
  vi.stubEnv('INTERNAL_INTEGRATION_ALLOWED_USER_IDS', 'comp-solo-one')
})
afterEach(() => vi.unstubAllEnvs())

describe('hard paywall: who gets product access', () => {
  it('blocks accounts with no billing and gives the free tier no allowances', () => {
    expect(getProductAccess(personal())).toMatchObject({ allowed: false, recoverable: false })
    expect(getProductAccess(personal({ status: 'free', source: 'none', plan: 'free' }))).toMatchObject({ allowed: false })
    const free = BILLING_PLANS.free.limits
    expect([free.apps, free.translations, free.screenshots, free.icons, free.publishing]).toEqual([0, 0, 0, 0, 0])
  })

  it('allows trialing, active and payment-retrying (past_due grace) subscriptions', () => {
    for (const status of ['trialing', 'active', 'past_due']) {
      expect(getProductAccess(personal(stripe(status)))).toMatchObject({ allowed: true, reason: 'subscription' })
    }
  })

  it('blocks cancelled-after-period and incomplete subscriptions; incomplete is recoverable', () => {
    expect(getProductAccess(personal(stripe('cancelled')))).toMatchObject({ allowed: false, recoverable: false })
    expect(getProductAccess(personal(stripe('incomplete')))).toMatchObject({ allowed: false, recoverable: true })
    // A sandbox record never unlocks a live deployment.
    vi.stubEnv('STRIPE_ACCOUNT_ID', LIVE_STRIPE_ACCOUNT_ID); vi.stubEnv('STRIPE_LIVEMODE', 'true')
    expect(getProductAccess(personal(stripe('active')))).toMatchObject({ allowed: false })
  })

  it('keeps comp/internal accounts working through the explicit allowlist, not a free-plan loophole', () => {
    const comp = personal({ status: 'free', source: 'none', plan: 'free' }, 'comp-solo-one')
    comp.user.plan = 'starter'
    expect(getProductAccess(comp)).toMatchObject({ allowed: true, reason: 'comp_internal' })
    // The same "plan: starter" without the allowlist gets nothing.
    const lookalike = personal({ status: 'free', source: 'none', plan: 'starter' }, 'someone-else')
    lookalike.user.plan = 'starter'
    expect(getProductAccess(lookalike)).toMatchObject({ allowed: false })
  })

  it('honours a valid, month-bounded reviewer grant only', () => {
    const now = new Date()
    const period = reviewPeriod(now)
    const grant = { source: 'review', id: period.id, accountId: 'customer-one', startsAt: Timestamp.fromDate(period.start), expiresAt: Timestamp.fromDate(period.end), revokedAt: null, limits: { ...REVIEW_LIMITS } }
    expect(getProductAccess(personal({ status: 'free', source: 'none', plan: 'free', reviewGrant: grant }), now)).toMatchObject({ allowed: true, reason: 'review_grant' })
    expect(getProductAccess(personal({ status: 'free', source: 'none', plan: 'free', reviewGrant: { ...grant, revokedAt: Timestamp.now() } }), now)).toMatchObject({ allowed: false })
  })

  it('tells an organization teammate that the owner must pay', () => {
    const teammate: AccountContext = { ...personal(undefined, 'teammate'), type: 'organization', orgId: 'org-one', organization: { ownerId: 'owner', plan: 'free' } as never }
    expect(getProductAccess(teammate)).toMatchObject({ allowed: false, ownerMustPay: true })
    const payload = paymentRequiredPayload({ recoverable: false, ownerMustPay: true })
    expect(payload).toMatchObject({ code: 'payment_required', billingUrl: 'https://applistingagent.com/billing?reason=subscription_required' })
    expect(payload.nextStep).toMatch(/workspace owner/)
  })
})

describe('hard paywall: routes that stay reachable', () => {
  it.each([
    ['/api/auth/session', 'POST'], ['/api/onboarding', 'GET'], ['/api/onboarding/pairing/exchange', 'POST'],
    ['/api/billing/checkout', 'POST'], ['/api/billing/manage', 'POST'], ['/api/billing/reconcile', 'POST'],
    ['/api/subscription', 'GET'], ['/api/usage', 'GET'], ['/api/webhooks/stripe', 'POST'], ['/api/public/events', 'POST'], ['/api/public/listing-audit', 'POST'],
    ['/api/analytics/maintenance', 'POST'], ['/api/health', 'GET'], ['/api/admin-mcp', 'POST'], ['/api/account', 'DELETE'],
    ['/api/oauth/connections', 'GET'], ['/api/org/invite/abc', 'GET'], ['/api/mcp', 'POST'], ['/api/whop-project/webhook', 'POST'],
  ])('%s stays open', (path, method) => {
    expect(isUnpaidApiPath(path, method)).toBe(true)
  })

  it.each(['/api/projects', '/api/screenshots/generate', '/api/translate', '/api/keys', '/api/account/credentials/appstore',
    '/api/metadata/publish', '/api/icons/generate', '/api/org/members', '/api/billingx', '/api/whop-project/products'])('%s requires paid access', path => {
    expect(isUnpaidApiPath(path, 'POST')).toBe(false)
  })

  it('keeps account settings (deletion) open and only onboarding status among MCP tools', () => {
    expect(isUnpaidPagePath('/settings')).toBe(true)
    expect(isUnpaidPagePath('/dashboard')).toBe(false)
    expect([...UNPAID_MCP_TOOLS]).toEqual(['get_onboarding_status'])
  })
})
