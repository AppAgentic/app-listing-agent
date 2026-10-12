import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { SANDBOX_STRIPE_ACCOUNT_ID } from '@/lib/stripe/config'

const mocks = vi.hoisted(() => ({ session: vi.fn(), account: vi.fn(), prepare: vi.fn(), analytics: vi.fn(), enabled: vi.fn(), runtime: vi.fn() }))
vi.mock('@/lib/auth/session', () => ({ getSession: mocks.session }))
vi.mock('@/lib/billing/account', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/billing/account')>(), getBillingAccount: mocks.account }))
vi.mock('@/lib/billing/checkout', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/billing/checkout')>(), prepareSubscriptionCheckout: mocks.prepare }))
vi.mock('@/lib/stripe/config', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/stripe/config')>(), isBillingCheckoutEnabled: mocks.enabled }))
vi.mock('@/lib/stripe/runtime', () => ({ getStripeRuntime: mocks.runtime, publicAppOrigin: () => 'https://applistingagent.com' }))
vi.mock('@/lib/concierge-server', () => ({ recordConciergeEventForUser: mocks.analytics }))
import { POST } from '@/app/api/billing/checkout/route'
import { CheckoutConflict } from '@/lib/billing/checkout'

const request = (body: Record<string, unknown> = { plan: 'pro', interval: 'annual' }) =>
  ({ json: async () => body, nextUrl: new URL('https://applistingagent.com/api/billing/checkout') }) as NextRequest

beforeEach(() => {
  vi.clearAllMocks()
  vi.unstubAllEnvs()
  vi.stubEnv('STRIPE_ACCOUNT_ID', SANDBOX_STRIPE_ACCOUNT_ID)
  vi.stubEnv('STRIPE_LIVEMODE', 'false')
  mocks.enabled.mockReturnValue(true)
  mocks.runtime.mockReturnValue({ config: { livemode: false }, stripe: {} })
  mocks.session.mockResolvedValue({ userId: 'one', email: 'test@example.com', plan: 'free' })
  mocks.account.mockResolvedValue({ data: {}, user: {}, canManage: true, ref: { path: 'users/one' } })
  mocks.prepare.mockResolvedValue({ id: 'cs_test_one', purchaseUrl: 'https://checkout.stripe.com/c/pay/cs_test_one', trialDays: 7, expiresAt: Date.now() + 86_400_000 })
  mocks.analytics.mockResolvedValue(undefined)
})

describe('checkout authorization and recovery', () => {
  it('is unavailable (503) when Stripe billing is not fully configured', async () => {
    mocks.enabled.mockReturnValue(false)
    expect((await POST(request())).status).toBe(503)
    expect(mocks.prepare).not.toHaveBeenCalled()
  })
  it('blocks a free-effective past-due customer from buying again', async () => {
    mocks.account.mockResolvedValue({ data: { billing: { status: 'past_due', source: 'stripe', subscriptionId: 'sub_pastdue0001', livemode: false, providerAccountId: SANDBOX_STRIPE_ACCOUNT_ID } }, user: {}, canManage: true })
    const response = await POST(request())
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: 'existing_subscription' })
    expect(mocks.prepare).not.toHaveBeenCalled()
  })
  it('only permits workspace owners to purchase', async () => {
    mocks.account.mockResolvedValue({ data: {}, user: {}, canManage: false })
    expect((await POST(request())).status).toBe(403)
    expect(mocks.prepare).not.toHaveBeenCalled()
  })
  it('makes Studio annual self-serve and returns the trial checkout', async () => {
    const response = await POST(request({ plan: 'business', interval: 'annual', placement: 'onboarding' }))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ id: 'cs_test_one', purchaseUrl: 'https://checkout.stripe.com/c/pay/cs_test_one', trialDays: 7 })
    expect(mocks.prepare).toHaveBeenCalledWith(expect.objectContaining({ plan: 'business', interval: 'annual', cancelPath: '/onboarding', origin: 'https://applistingagent.com' }))
  })
  it('maps checkout conflicts to 409/403 without provider details', async () => {
    mocks.prepare.mockRejectedValue(new CheckoutConflict('checkout_pending'))
    expect((await POST(request())).status).toBe(409)
    mocks.prepare.mockRejectedValue(new CheckoutConflict('billing_permission_changed'))
    expect((await POST(request())).status).toBe(403)
    mocks.prepare.mockRejectedValue(new Error('sk_test_secret leaked?'))
    const failure = await POST(request())
    expect(failure.status).toBe(503)
    expect(JSON.stringify(await failure.json())).not.toContain('sk_test')
  })
  it('still returns the checkout when attribution recording fails', async () => {
    mocks.analytics.mockRejectedValue(new Error('analytics unavailable'))
    const response = await POST(request())
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ id: 'cs_test_one' })
  })
})
