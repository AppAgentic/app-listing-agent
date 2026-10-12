import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { LIVE_STRIPE_ACCOUNT_ID, SANDBOX_STRIPE_ACCOUNT_ID } from '@/lib/stripe/config'

const mocks = vi.hoisted(() => ({ session: vi.fn(), account: vi.fn(), portal: vi.fn(), index: vi.fn(), runtime: vi.fn() }))
vi.mock('@/lib/auth/session', () => ({ getSession: mocks.session }))
vi.mock('@/lib/billing/account', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/billing/account')>(), getBillingAccount: mocks.account }))
vi.mock('@/lib/stripe/runtime', () => ({ getStripeRuntime: mocks.runtime, publicAppOrigin: () => 'https://applistingagent.com' }))
vi.mock('@/lib/firebase/admin', () => ({ adminDb: { collection: () => ({ doc: () => ({ get: mocks.index }) }) } }))
import { POST } from '@/app/api/billing/manage/route'

const request = () => ({ nextUrl: new URL('https://applistingagent.com/api/billing/manage') }) as NextRequest
const customer = { stripeCustomers: { test: { id: 'cus_customer00001', livemode: false, accountId: SANDBOX_STRIPE_ACCOUNT_ID } } }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.session.mockResolvedValue({ userId: 'owner' })
  mocks.account.mockResolvedValue({ canManage: true, data: customer, user: customer, ref: { path: 'users/owner' } })
  mocks.index.mockResolvedValue({ data: () => ({ accountPath: 'users/owner' }) })
  mocks.portal.mockResolvedValue({ url: 'https://billing.stripe.com/p/session/test_one' })
  mocks.runtime.mockReturnValue({
    config: { livemode: false, accountId: SANDBOX_STRIPE_ACCOUNT_ID, portalConfigurationId: 'bpc_testportal01' },
    stripe: { createPortalSession: mocks.portal },
  })
})

describe('billing portal access', () => {
  it('requires a signed-in account', async () => {
    mocks.session.mockResolvedValue(null)
    expect((await POST(request())).status).toBe(401)
    expect(mocks.portal).not.toHaveBeenCalled()
  })
  it('never exposes the owner portal to a teammate', async () => {
    mocks.account.mockResolvedValue({ canManage: false })
    expect((await POST(request())).status).toBe(403)
    expect(mocks.portal).not.toHaveBeenCalled()
  })
  it('opens the explicitly configured Stripe portal for the owner’s own customer', async () => {
    expect(await (await POST(request())).json()).toEqual({ manageUrl: 'https://billing.stripe.com/p/session/test_one' })
    expect(mocks.portal).toHaveBeenCalledWith(expect.objectContaining({
      customerId: 'cus_customer00001', configurationId: 'bpc_testportal01', returnUrl: 'https://applistingagent.com/billing',
    }))
  })
  it('refuses a customer whose binding points at another account', async () => {
    mocks.index.mockResolvedValue({ data: () => ({ accountPath: 'users/someone-else' }) })
    expect((await POST(request())).status).toBe(404)
    expect(mocks.portal).not.toHaveBeenCalled()
  })
  it('refuses a customer from another Stripe mode', async () => {
    const live = { stripeCustomers: { live: { id: 'cus_livecustomer1', livemode: true, accountId: LIVE_STRIPE_ACCOUNT_ID } } }
    mocks.account.mockResolvedValue({ canManage: true, data: live, user: live, ref: { path: 'users/owner' } })
    expect((await POST(request())).status).toBe(404)
  })
  it('returns a recoverable error without disclosing provider internals', async () => {
    mocks.portal.mockRejectedValue(new Error('private provider metadata'))
    const response = await POST(request())
    expect(response.status).toBe(503)
    expect(JSON.stringify(await response.json())).not.toContain('private provider metadata')
  })
  it('rejects a portal URL that is not Stripe-hosted', async () => {
    mocks.portal.mockResolvedValue({ url: 'https://evil.example/portal' })
    expect((await POST(request())).status).toBe(503)
  })
})
