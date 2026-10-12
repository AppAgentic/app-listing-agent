import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LIVE_STRIPE_ACCOUNT_ID, SANDBOX_STRIPE_ACCOUNT_ID } from '@/lib/stripe/config'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getAccountContext: vi.fn(),
  authenticateRequest: vi.fn(),
  accountGet: vi.fn(),
}))

vi.mock('@/lib/auth/session', () => ({ getSession: mocks.getSession }))
vi.mock('@/lib/org/context', () => ({ getAccountContext: mocks.getAccountContext }))
vi.mock('@/lib/api/auth', () => ({
  authenticateRequest: mocks.authenticateRequest,
  unauthorizedResponse: (message: string) => Response.json({ error: message }, { status: 401 }),
}))
vi.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: vi.fn(() => ({
      doc: vi.fn(() => ({ get: mocks.accountGet })),
    })),
  },
}))

import { GET } from '@/app/api/subscription/route'

const paidUser = {
  plan: 'pro',
  stripeCustomers: { test: { id: 'cus_customer00001', livemode: false, accountId: SANDBOX_STRIPE_ACCOUNT_ID } },
  billing: {
    source: 'stripe',
    status: 'active',
    plan: 'pro',
    subscriptionId: 'sub_subscription1',
    livemode: false,
    providerAccountId: SANDBOX_STRIPE_ACCOUNT_ID,
    currentPeriodEnd: { toDate: () => new Date('2026-09-01T00:00:00.000Z') },
  },
}

afterEach(() => vi.unstubAllEnvs())

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('STRIPE_ACCOUNT_ID', SANDBOX_STRIPE_ACCOUNT_ID)
  vi.stubEnv('STRIPE_LIVEMODE', 'false')
  mocks.accountGet.mockResolvedValue({ data: () => paidUser })
})

describe('GET /api/subscription', () => {
  it('reads billing for a dashboard session without requiring a bearer header', async () => {
    mocks.getSession.mockResolvedValue({ userId: 'user-1' })
    mocks.getAccountContext.mockResolvedValue({ type: 'personal', userId: 'user-1', user: paidUser })

    const response = await GET(new Request('https://applistingagent.com/api/subscription') as never)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      plan: 'pro',
      status: 'active',
      renewsAt: '2026-09-01T00:00:00.000Z',
      subscriptionId: 'sub_subscription1',
      canOpenPortal: true,
      trialEligible: false,
    })
    expect(mocks.authenticateRequest).not.toHaveBeenCalled()
  })

  it('retains bearer authentication for API clients', async () => {
    const context = { type: 'personal', userId: 'user-1', user: paidUser }
    mocks.getSession.mockResolvedValue(null)
    mocks.authenticateRequest.mockResolvedValue({ authenticated: true, context })

    const response = await GET(new Request('https://applistingagent.com/api/subscription', {
      headers: { Authorization: 'Bearer asc_live_example' },
    }) as never)

    expect(response.status).toBe(200)
    expect(mocks.authenticateRequest).toHaveBeenCalledOnce()
  })

  it('rejects requests with neither authentication mechanism', async () => {
    mocks.getSession.mockResolvedValue(null)
    mocks.authenticateRequest.mockResolvedValue({ authenticated: false })

    const response = await GET(new Request('https://applistingagent.com/api/subscription') as never)

    expect(response.status).toBe(401)
  })
  it('reports annual cancellation and suppresses management for non-owner teammates', async () => {
    const organization = {
      ...paidUser, ownerId: 'owner-one',
      billing: { ...paidUser.billing, billingInterval: 'annual', cancelAtPeriodEnd: true },
    }
    mocks.getSession.mockResolvedValue({ userId: 'teammate' })
    mocks.getAccountContext.mockResolvedValue({ type: 'organization', userId: 'teammate', orgId: 'org-one', organization, user: {} })
    mocks.accountGet.mockResolvedValue({ data: () => organization })
    const response = await GET(new Request('https://applistingagent.com/api/subscription') as never)
    expect(await response.json()).toMatchObject({
      billingInterval: 'annual', cancelAtPeriodEnd: true, canManageBilling: false,
      hasExistingSubscription: true, canOpenPortal: false,
    })
  })

  it('shows the trial end date while trialing and hides records from another Stripe mode', async () => {
    const trialing = { ...paidUser, billing: { ...paidUser.billing, status: 'trialing', trialEnd: { toDate: () => new Date('2026-09-24T00:00:00.000Z') } } }
    mocks.getSession.mockResolvedValue({ userId: 'user-1' })
    mocks.getAccountContext.mockResolvedValue({ type: 'personal', userId: 'user-1', user: trialing })
    mocks.accountGet.mockResolvedValue({ data: () => trialing })
    expect(await (await GET(new Request('https://applistingagent.com/api/subscription') as never)).json()).toMatchObject({
      plan: 'pro', status: 'trialing', trialEndsAt: '2026-09-24T00:00:00.000Z',
    })

    vi.stubEnv('STRIPE_ACCOUNT_ID', LIVE_STRIPE_ACCOUNT_ID)
    vi.stubEnv('STRIPE_LIVEMODE', 'true')
    expect(await (await GET(new Request('https://applistingagent.com/api/subscription') as never)).json()).toMatchObject({
      plan: 'free', status: 'free', subscriptionId: null, hasExistingSubscription: false, trialEndsAt: null,
    })
  })

})
