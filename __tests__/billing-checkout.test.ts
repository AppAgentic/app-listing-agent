import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Timestamp } from 'firebase-admin/firestore'
import { CheckoutConflict, prepareSubscriptionCheckout, type CheckoutRequest } from '@/lib/billing/checkout'
import { SANDBOX_STRIPE_ACCOUNT_ID } from '@/lib/stripe/config'
import { createBillingFirestore } from './helpers/billing-firestore'
import { createFakeStripe, sandboxConfig } from './helpers/stripe-fixtures'

function setup(user: Record<string, unknown> = {}) {
  const store = createBillingFirestore()
  const stripe = createFakeStripe()
  store.seed('users/owner-one', { email: 'owner@example.com', plan: 'free', organizationId: null, billing: { status: 'free', source: 'none', plan: 'free' }, ...user })
  const request = (overrides: Partial<CheckoutRequest> = {}): CheckoutRequest => ({
    db: store.db,
    stripe: stripe.client as never,
    config: sandboxConfig(),
    accountRef: store.db.collection('users').doc('owner-one'),
    actorUserId: 'owner-one',
    email: 'owner@example.com',
    plan: 'pro',
    interval: 'monthly',
    origin: 'https://applistingagent.com',
    ...overrides,
  })
  return { store, stripe, request }
}

beforeEach(() => {
  vi.stubEnv('STRIPE_ACCOUNT_ID', SANDBOX_STRIPE_ACCOUNT_ID)
  vi.stubEnv('STRIPE_LIVEMODE', 'false')
})
afterEach(() => vi.unstubAllEnvs())

describe('subscription checkout with the free trial', () => {
  it('creates a bound customer and a 7-day trial checkout for a first subscription', async () => {
    const t = setup()
    const checkout = await prepareSubscriptionCheckout(t.request({ cancelPath: '/onboarding' }))
    expect(checkout).toMatchObject({ trialDays: 7 })
    expect(new URL(checkout.purchaseUrl).hostname).toBe('checkout.stripe.com')
    expect(t.stripe.calls).toContain('createCheckoutSession:price_promonthly0001:trial=7')

    const binding = t.store.read('users/owner-one')!.stripeCustomers.test
    expect(binding).toMatchObject({ livemode: false, accountId: SANDBOX_STRIPE_ACCOUNT_ID })
    expect(t.store.read(`billingCustomers/${binding.id}`)).toMatchObject({ accountPath: 'users/owner-one', userId: 'owner-one', livemode: false })
  })

  it('charges immediately (no trial) once the account has used its trial in this Stripe mode', async () => {
    const t = setup({ billingTrial: { test: { usedAt: Timestamp.now(), subscriptionId: 'sub_oldtrial0001' } } })
    expect((await prepareSubscriptionCheckout(t.request())).trialDays).toBe(0)
    expect(t.stripe.calls).toContain('createCheckoutSession:price_promonthly0001:trial=0')
  })

  it('a live trial does not block a sandbox trial and vice versa', async () => {
    const t = setup({ billingTrial: { live: { usedAt: Timestamp.now(), subscriptionId: 'sub_livetrial001' } } })
    expect((await prepareSubscriptionCheckout(t.request())).trialDays).toBe(7)
  })

  it('reuses the open session for the same selection and expires it when the selection changes', async () => {
    const t = setup()
    const first = await prepareSubscriptionCheckout(t.request())
    const again = await prepareSubscriptionCheckout(t.request())
    expect(again.id).toBe(first.id)
    expect(t.stripe.calls.filter(call => call.startsWith('createCustomer'))).toHaveLength(1)

    const annual = await prepareSubscriptionCheckout(t.request({ plan: 'business', interval: 'annual' }))
    expect(annual.id).not.toBe(first.id)
    expect(t.stripe.calls).toContain(`expireCheckoutSession:${first.id}`)
    expect(t.stripe.calls).toContain('createCheckoutSession:price_businessannual1:trial=7')
    expect(t.stripe.calls.filter(call => call.startsWith('createCustomer'))).toHaveLength(1)
  })

  it('refuses a new checkout when the superseded session already completed', async () => {
    const t = setup()
    const first = await prepareSubscriptionCheckout(t.request())
    t.stripe.sessions.get(first.id)!.status = 'complete'
    await expect(prepareSubscriptionCheckout(t.request({ interval: 'annual' }))).rejects.toMatchObject({ code: 'existing_subscription' })
  })

  it('blocks accounts that already hold a subscription in this mode, including past_due', async () => {
    const t = setup({ billing: { source: 'stripe', status: 'past_due', plan: 'free', subscriptionId: 'sub_existing0001', livemode: false, providerAccountId: SANDBOX_STRIPE_ACCOUNT_ID } })
    await expect(prepareSubscriptionCheckout(t.request())).rejects.toBeInstanceOf(CheckoutConflict)
    expect(t.stripe.calls.some(call => call.startsWith('createCheckoutSession'))).toBe(false)
  })

  it('only lets the organization owner buy for the organization', async () => {
    const t = setup({ organizationId: 'org-one' })
    t.store.seed('organizations/org-one', { ownerId: 'someone-else', plan: 'free' })
    await expect(prepareSubscriptionCheckout(t.request({ accountRef: t.store.db.collection('organizations').doc('org-one') })))
      .rejects.toMatchObject({ code: 'billing_permission_changed' })
  })
})
