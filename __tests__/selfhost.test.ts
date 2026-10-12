import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AccountContext } from '@/lib/org/context'
import { isSelfHosted, resetSelfHostRefusalLogForTests, selfHostRefusalReason } from '@/lib/selfhost/config'
import { getProductAccess } from '@/lib/billing/access'
import { getEffectivePlan, getEffectivePlanLimits } from '@/lib/billing/entitlements'
import { BILLING_PLANS, SELF_HOSTED_PLAN } from '@/lib/billing/catalog'
import { getOrganizationTeamMemberLimit } from '@/lib/org/team-limits'
import { canUseScopedApiKeys } from '@/lib/billing/feature-access'
import { LIVE_STRIPE_ACCOUNT_ID, SANDBOX_STRIPE_ACCOUNT_ID } from '@/lib/stripe/config'
import { appOrigin, appUrl, HOSTED_APP_ORIGIN } from '@/lib/routing/app-url'

const personal = (userId = 'self-host-user'): AccountContext => ({
  type: 'personal', userId,
  user: {
    email: 'person@example.com', plan: 'free', planLimits: BILLING_PLANS.free.limits, organizationId: null,
    apiKey: 'k', createdAt: {} as never, updatedAt: {} as never,
    billing: { status: 'free', source: 'none', plan: 'free' } as never,
  },
})

beforeEach(() => {
  resetSelfHostRefusalLogForTests()
  vi.stubEnv('STRIPE_ACCOUNT_ID', '')
  vi.stubEnv('STRIPE_LIVEMODE', '')
  vi.stubEnv('SELF_HOSTED', '')
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('self-host mode switch', () => {
  it('is off unless SELF_HOSTED=true', () => {
    expect(isSelfHosted()).toBe(false)
    vi.stubEnv('SELF_HOSTED', '1')
    expect(isSelfHosted()).toBe(false)
    vi.stubEnv('SELF_HOSTED', 'true')
    expect(isSelfHosted()).toBe(true)
  })

  it('allows a sandbox/test Stripe binding on a self-hosted install', () => {
    vi.stubEnv('SELF_HOSTED', 'true')
    vi.stubEnv('STRIPE_ACCOUNT_ID', SANDBOX_STRIPE_ACCOUNT_ID)
    vi.stubEnv('STRIPE_LIVEMODE', 'false')
    expect(isSelfHosted()).toBe(true)
  })
})

describe('production-safety guard: our live deployment can never become free', () => {
  it('refuses self-host mode when STRIPE_LIVEMODE=true, and logs the refusal once', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.stubEnv('SELF_HOSTED', 'true')
    vi.stubEnv('STRIPE_LIVEMODE', 'true')
    expect(selfHostRefusalReason()).toMatch(/STRIPE_LIVEMODE/)
    expect(isSelfHosted()).toBe(false)
    expect(isSelfHosted()).toBe(false)
    expect(log).toHaveBeenCalledTimes(1)
  })

  it('refuses self-host mode when STRIPE_ACCOUNT_ID is our live parent account, even with livemode unset', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.stubEnv('SELF_HOSTED', 'true')
    vi.stubEnv('STRIPE_ACCOUNT_ID', ` ${LIVE_STRIPE_ACCOUNT_ID} `)
    expect(isSelfHosted()).toBe(false)
  })

  it('keeps the hard paywall on the live configuration even with SELF_HOSTED=true', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.stubEnv('SELF_HOSTED', 'true')
    vi.stubEnv('STRIPE_ACCOUNT_ID', LIVE_STRIPE_ACCOUNT_ID)
    vi.stubEnv('STRIPE_LIVEMODE', 'true')
    expect(getProductAccess(personal())).toMatchObject({ allowed: false, reason: null })
    expect(getEffectivePlan(personal())).toBe('free')
    expect(getEffectivePlanLimits(personal()).translations).toBe(0)
  })
})

describe('billing off in self-host mode', () => {
  beforeEach(() => vi.stubEnv('SELF_HOSTED', 'true'))

  it('grants product access with reason self_hosted (proxy 402, page gate and MCP tools/call all use this)', () => {
    expect(getProductAccess(personal())).toEqual({ allowed: true, reason: 'self_hosted', recoverable: false, ownerMustPay: false })
    const teammate: AccountContext = { ...personal('teammate'), type: 'organization', orgId: 'org-one', organization: { ownerId: 'owner', plan: 'free' } as never }
    expect(getProductAccess(teammate)).toMatchObject({ allowed: true, reason: 'self_hosted', ownerMustPay: false })
  })

  it('gives unlimited allowances and a plan with scoped API keys and teams', () => {
    const limits = getEffectivePlanLimits(personal())
    expect(Object.values(limits).every(value => value === -1)).toBe(true)
    expect(getEffectivePlan(personal())).toBe(SELF_HOSTED_PLAN)
    expect(canUseScopedApiKeys(getEffectivePlan(personal()))).toBe(true)
    expect(getOrganizationTeamMemberLimit({ plan: 'free', billing: undefined } as never)).toBe(-1)
  })
})

describe('page gate in self-host mode', () => {
  it('lets every signed-in account into product pages', async () => {
    vi.stubEnv('SELF_HOSTED', 'true')
    vi.resetModules()
    vi.doMock('next/navigation', () => ({ redirect: (url: string) => { throw new Error(`REDIRECT ${url}`) } }))
    vi.doMock('@/lib/org/context', () => ({ getAccountContext: vi.fn().mockResolvedValue(personal()) }))
    const { requireProductAccessForPage } = await import('@/lib/billing/page-gate')
    await expect(requireProductAccessForPage('self-host-user', '/dashboard')).resolves.toBeUndefined()
    vi.doUnmock('next/navigation')
    vi.doUnmock('@/lib/org/context')
  })
})

describe('deployment origin', () => {
  it('falls back to the hosted origin and follows NEXT_PUBLIC_APP_URL when set', () => {
    expect(appOrigin({})).toBe(HOSTED_APP_ORIGIN)
    expect(appOrigin({ NEXT_PUBLIC_APP_URL: 'not a url' })).toBe(HOSTED_APP_ORIGIN)
    expect(appOrigin({ NEXT_PUBLIC_APP_URL: 'https://listings.example.org/some/path' })).toBe('https://listings.example.org')
    expect(appUrl('/api/mcp', { NEXT_PUBLIC_APP_URL: 'http://localhost:3000' })).toBe('http://localhost:3000/api/mcp')
  })
})

describe('billing routes on a self-hosted install', () => {
  it.each([
    ['@/app/api/billing/checkout/route'],
    ['@/app/api/billing/manage/route'],
    ['@/app/api/billing/reconcile/route'],
    ['@/app/api/webhooks/stripe/route'],
  ])('%s answers 404 billing_disabled_self_hosted', async modulePath => {
    vi.stubEnv('SELF_HOSTED', 'true')
    const route = await import(/* @vite-ignore */ modulePath) as { POST: (request: unknown) => Promise<Response> }
    const response = await route.POST(new Request('https://selfhost.example/api', { method: 'POST' }))
    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ code: 'billing_disabled_self_hosted' })
  })
})

describe('self-host guard: hosted Firebase project', () => {
  it('refuses self-host mode against the hosted Firestore project', () => {
    const env = { SELF_HOSTED: 'true', FIREBASE_ADMIN_PROJECT_ID: 'appstorecopilot' }
    expect(selfHostRefusalReason(env)).toMatch(/appstorecopilot/)
    expect(isSelfHosted(env)).toBe(false)
    expect(isSelfHosted({ SELF_HOSTED: 'true', NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'appstorecopilot' })).toBe(false)
    expect(isSelfHosted({ SELF_HOSTED: 'true', FIREBASE_ADMIN_PROJECT_ID: 'my-own-project' })).toBe(true)
  })
})
