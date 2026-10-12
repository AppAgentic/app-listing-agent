import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { billingAnalyticsEmitter } from '@/lib/analytics/billing-facts'
import { MemoryEmissionLedger, type AnalyticsRow } from '@/lib/analytics/ingest'
import { hasExistingSubscription } from '@/lib/billing/account'
import { getBillingPeriod, getEffectivePlan } from '@/lib/billing/entitlements'
import { getProductAccess } from '@/lib/billing/access'
import { LIVE_STRIPE_ACCOUNT_ID, SANDBOX_STRIPE_ACCOUNT_ID, planForPrice } from '@/lib/stripe/config'
import {
  intakeStripeEvent,
  processDueStripeEvents,
  processStripeEvent,
  WebhookRejected,
  type WebhookDeps,
} from '@/lib/stripe/webhooks'
import type { AccountContext } from '@/lib/org/context'
import { createBillingFirestore } from './helpers/billing-firestore'
import { createFakeStripe, sandboxConfig, signedEvent } from './helpers/stripe-fixtures'

const CUSTOMER = 'cus_customer00001'
const PRO_MONTHLY = 'price_promonthly0001'

function setup() {
  const store = createBillingFirestore()
  const stripe = createFakeStripe()
  const config = sandboxConfig()
  const rows: AnalyticsRow[] = []
  const emit = billingAnalyticsEmitter({
    ledger: new MemoryEmissionLedger(),
    insert: async batch => { rows.push(...batch.map(item => item.json)) },
    prices: priceId => planForPrice(config, priceId),
  })
  const deps: WebhookDeps = {
    db: store.db,
    stripe: stripe.client as never,
    config,
    onProcessed: async (event, outcome) => { await emit(event, outcome.userId ?? null) },
  }
  store.seed('users/owner-one', { email: 'owner@example.com', plan: 'free', organizationId: null, billing: { status: 'free', source: 'none', plan: 'free' } })
  store.seed(`billingCustomers/${CUSTOMER}`, { customerId: CUSTOMER, accountPath: 'users/owner-one', userId: 'owner-one', livemode: false, stripeAccountId: SANDBOX_STRIPE_ACCOUNT_ID })
  const deliver = async (type: string, object: Record<string, unknown>, options?: Parameters<typeof signedEvent>[2]) => {
    const { event, body, signature } = signedEvent(type, object, options)
    const intake = await intakeStripeEvent(deps, body, signature)
    const state = await processStripeEvent(deps, intake.eventId)
    return { event, body, signature, intake, state }
  }
  const user = () => store.read('users/owner-one')!
  const context = (): AccountContext => ({ type: 'personal', userId: 'owner-one', user: user() as never })
  const events = (name: string) => rows.filter(row => row.event === name)
  return { store, stripe, config, deps, deliver, user, context, rows, events }
}

beforeEach(() => {
  vi.stubEnv('STRIPE_ACCOUNT_ID', SANDBOX_STRIPE_ACCOUNT_ID)
  vi.stubEnv('STRIPE_LIVEMODE', 'false')
})
afterEach(() => vi.unstubAllEnvs())

describe('Stripe webhook → entitlement', () => {
  it('trial checkout grants the plan while trialing, marks the trial used and records trial_started once', async () => {
    const t = setup()
    const { subscription, sessionId } = t.stripe.subscribe({ customer: CUSTOMER, priceId: PRO_MONTHLY, trialDays: 7, accountPath: 'users/owner-one' })

    expect((await t.deliver('checkout.session.completed', { id: sessionId, object: 'checkout.session', customer: CUSTOMER })).state).toBe('processed')
    await t.deliver('customer.subscription.created', subscription as never)

    const billing = t.user().billing
    expect(billing).toMatchObject({ source: 'stripe', status: 'trialing', plan: 'pro', subscriptionId: subscription.id, livemode: false, providerAccountId: SANDBOX_STRIPE_ACCOUNT_ID, billingInterval: 'monthly' })
    expect(billing.trialEnd.toMillis()).toBe(subscription.trial_end! * 1000)
    expect(t.user().billingTrial.test.subscriptionId).toBe(subscription.id)
    expect(t.user().billingTrial.live).toBeUndefined()
    expect(getEffectivePlan(t.context())).toBe('pro')
    expect(hasExistingSubscription(t.user())).toBe(true)
    expect(t.events('trial_started')).toHaveLength(1)
    expect(JSON.parse(t.events('trial_started')[0].props as string)).toEqual({ plan: 'pro', interval: 'month', trial_days: 7 })
    expect(t.events('purchase')).toHaveLength(0)
  })

  it('replaying an event is acknowledged without re-applying or re-emitting', async () => {
    const t = setup()
    const { subscription } = t.stripe.subscribe({ customer: CUSTOMER, priceId: PRO_MONTHLY, trialDays: 7, accountPath: 'users/owner-one' })
    const first = await t.deliver('customer.subscription.created', subscription as never)

    const replay = await intakeStripeEvent(t.deps, first.body, first.signature)
    expect(replay).toEqual({ eventId: first.event.id, duplicate: true })
    expect(await processStripeEvent(t.deps, first.event.id)).toBe('skipped')
    // A second delivery of the same business fact under a new event id still emits once.
    await t.deliver('customer.subscription.created', subscription as never)
    expect(t.store.paths('billingEvents/')).toHaveLength(2)
    expect(t.events('trial_started')).toHaveLength(1)
  })

  it('trial converts to paid: invoice.paid keeps access and emits one purchase; the $0 trial invoice is not revenue', async () => {
    const t = setup()
    const { subscription } = t.stripe.subscribe({ customer: CUSTOMER, priceId: PRO_MONTHLY, trialDays: 7, accountPath: 'users/owner-one' })
    const zero = t.stripe.invoice({ subscriptionId: subscription.id, customer: CUSTOMER, amount: 0, reason: 'subscription_create' })
    await t.deliver('invoice.paid', { id: zero, object: 'invoice', status: 'paid', amount_paid: 0, currency: 'usd' })

    const live = t.stripe.subscriptions.get(subscription.id)!
    live.status = 'active'; live.trial_start = subscription.trial_start
    live.items.data[0].current_period_start = subscription.trial_end!
    live.items.data[0].current_period_end = subscription.trial_end! + 30 * 86_400
    const paid = t.stripe.invoice({ subscriptionId: subscription.id, customer: CUSTOMER, amount: 24_900 })
    const payload = { id: paid, object: 'invoice', status: 'paid', amount_paid: 24_900, currency: 'usd', billing_reason: 'subscription_cycle', lines: { data: [{ pricing: { price_details: { price: PRO_MONTHLY } } }] } }
    await t.deliver('invoice.paid', payload)
    await t.deliver('invoice.paid', payload)

    expect(t.user().billing).toMatchObject({ status: 'active', plan: 'pro', trialEnd: null })
    expect(getEffectivePlan(t.context())).toBe('pro')
    expect(t.events('purchase')).toHaveLength(1)
    expect(JSON.parse(t.events('purchase')[0].props as string)).toEqual({ kind: 'subscription', plan: 'pro', interval: 'month', billing_reason: 'subscription_cycle', value_minor: 24_900, currency: 'usd' })
    const record = t.store.paths('billingEvents/').map(path => t.store.read(path)!).find(event => event.invoiceId === paid)
    expect(record).toMatchObject({ provider: 'stripe', grossAmountMinor: 24_900, currency: 'USD' })
  })

  it('cancel during the trial keeps access until the trial ends, then removes it', async () => {
    const t = setup()
    const { subscription } = t.stripe.subscribe({ customer: CUSTOMER, priceId: PRO_MONTHLY, trialDays: 7, accountPath: 'users/owner-one' })
    await t.deliver('customer.subscription.created', subscription as never)

    const live = t.stripe.subscriptions.get(subscription.id)!
    live.cancel_at_period_end = true; live.cancel_at = subscription.trial_end
    await t.deliver('customer.subscription.updated', live as never, { previous: { cancel_at_period_end: false } })
    expect(t.user().billing).toMatchObject({ status: 'trialing', cancelAtPeriodEnd: true, plan: 'pro' })
    expect(getEffectivePlan(t.context())).toBe('pro')
    expect(JSON.parse(t.events('subscription_canceled')[0].props as string)).toEqual({ phase: 'requested', during_trial: true })

    live.status = 'canceled'; live.ended_at = subscription.trial_end
    await t.deliver('customer.subscription.deleted', live as never)
    expect(t.user().billing).toMatchObject({ status: 'cancelled', plan: 'free' })
    expect(t.user().plan).toBe('free')
    expect(getEffectivePlan(t.context())).toBe('free')
    expect(hasExistingSubscription(t.user())).toBe(false)
    // The trial stays used after cancellation.
    expect(t.user().billingTrial.test.subscriptionId).toBe(subscription.id)
    expect(t.events('subscription_canceled').map(row => JSON.parse(row.props as string).phase)).toEqual(['requested', 'ended'])
  })

  it('a failed renewal keeps access while Stripe retries (past_due grace), then blocks when unpaid', async () => {
    const t = setup()
    const { subscription } = t.stripe.subscribe({ customer: CUSTOMER, priceId: PRO_MONTHLY, accountPath: 'users/owner-one' })
    await t.deliver('customer.subscription.created', subscription as never)
    expect(getEffectivePlan(t.context())).toBe('pro')

    t.stripe.subscriptions.get(subscription.id)!.status = 'past_due'
    const invoice = t.stripe.invoice({ subscriptionId: subscription.id, customer: CUSTOMER, amount: 24_900, status: 'open' })
    await t.deliver('invoice.payment_failed', { id: invoice, object: 'invoice', status: 'open' })
    expect(t.user().billing).toMatchObject({ status: 'past_due', plan: 'pro', subscriptionId: subscription.id })
    expect(getEffectivePlan(t.context())).toBe('pro')
    expect(getProductAccess(t.context())).toMatchObject({ allowed: true })

    t.stripe.subscriptions.get(subscription.id)!.status = 'unpaid'
    await t.deliver('customer.subscription.updated', t.stripe.subscriptions.get(subscription.id) as never)
    expect(t.user().billing).toMatchObject({ status: 'incomplete', plan: 'free' })
    expect(getProductAccess(t.context())).toMatchObject({ allowed: false, recoverable: true })
    expect(hasExistingSubscription(t.user())).toBe(true)
  })

  it('a full refund cancels the subscription at Stripe and removes access immediately', async () => {
    const t = setup()
    const { subscription } = t.stripe.subscribe({ customer: CUSTOMER, priceId: PRO_MONTHLY, accountPath: 'users/owner-one' })
    await t.deliver('customer.subscription.created', subscription as never)
    t.stripe.invoice({ subscriptionId: subscription.id, customer: CUSTOMER, amount: 24_900, paymentIntent: 'pi_payment000001' })
    const charge = t.stripe.charge({ customer: CUSTOMER, amount: 24_900, refunded: 24_900, paymentIntent: 'pi_payment000001' })

    const result = await t.deliver('charge.refunded', { id: charge, object: 'charge', customer: CUSTOMER, currency: 'usd', amount_refunded: 24_900 })
    expect(result.state).toBe('processed')
    expect(t.stripe.calls).toContain(`cancelSubscription:${subscription.id}:asc-refund-cancel-${charge}`)
    expect(t.user().billing).toMatchObject({ status: 'cancelled', plan: 'free' })
    expect(getEffectivePlan(t.context())).toBe('free')
    expect(t.store.read(`billingEvents/${result.event.id}`)).toMatchObject({ fullRefund: true, refundedAmountMinor: 24_900 })
    expect(t.events('refund')).toHaveLength(1)
  })

  it('a partial refund is recorded without removing access', async () => {
    const t = setup()
    const { subscription } = t.stripe.subscribe({ customer: CUSTOMER, priceId: PRO_MONTHLY, accountPath: 'users/owner-one' })
    await t.deliver('customer.subscription.created', subscription as never)
    t.stripe.invoice({ subscriptionId: subscription.id, customer: CUSTOMER, amount: 24_900, paymentIntent: 'pi_payment000002' })
    const charge = t.stripe.charge({ customer: CUSTOMER, amount: 24_900, refunded: 5_000, paymentIntent: 'pi_payment000002' })
    await t.deliver('charge.refunded', { id: charge, object: 'charge', customer: CUSTOMER, currency: 'usd', amount_refunded: 5_000 })
    expect(t.stripe.calls.some(call => call.startsWith('cancelSubscription'))).toBe(false)
    expect(getEffectivePlan(t.context())).toBe('pro')
  })
})

describe('Stripe webhook safety', () => {
  it('rejects a live event on a sandbox deployment and bad signatures before storing anything', async () => {
    const t = setup()
    const live = signedEvent('customer.subscription.created', { id: 'sub_livesub0001' }, { livemode: true })
    await expect(intakeStripeEvent(t.deps, live.body, live.signature)).rejects.toMatchObject({ status: 400, code: 'WEBHOOK_LIVEMODE_MISMATCH' })
    const forged = signedEvent('customer.subscription.created', { id: 'sub_forged00001' }, { secret: 'whsec_' + 'z'.repeat(24) })
    await expect(intakeStripeEvent(t.deps, forged.body, forged.signature)).rejects.toBeInstanceOf(WebhookRejected)
    expect(t.store.paths('stripeWebhookInbox/')).toHaveLength(0)
  })

  it('never grants a sandbox entitlement on a live deployment', async () => {
    const t = setup()
    const { subscription } = t.stripe.subscribe({ customer: CUSTOMER, priceId: PRO_MONTHLY, accountPath: 'users/owner-one' })
    await t.deliver('customer.subscription.created', subscription as never)
    expect(getEffectivePlan(t.context())).toBe('pro')
    vi.stubEnv('STRIPE_ACCOUNT_ID', LIVE_STRIPE_ACCOUNT_ID)
    vi.stubEnv('STRIPE_LIVEMODE', 'true')
    expect(getEffectivePlan(t.context())).toBe('free')
    expect(hasExistingSubscription(t.user())).toBe(false)
  })

  it('ignores subscriptions for customers not bound to an App Listing Agent account', async () => {
    const t = setup()
    const { subscription } = t.stripe.subscribe({ customer: 'cus_strangers0001', priceId: PRO_MONTHLY, accountPath: 'users/owner-one' })
    expect((await t.deliver('customer.subscription.created', subscription as never)).state).toBe('ignored')
    expect(t.user().billing.source).toBe('none')
  })

  it('an unknown price fails without granting and is retried by the reconcile sweep', async () => {
    const t = setup()
    const { subscription } = t.stripe.subscribe({ customer: CUSTOMER, priceId: 'price_notincatalog01', accountPath: 'users/owner-one' })
    const first = await t.deliver('customer.subscription.created', subscription as never)
    expect(first.state).toBe('failed')
    expect(t.user().billing.source).toBe('none')
    const row = t.store.read(`stripeWebhookInbox/${first.event.id}`)!
    expect(row).toMatchObject({ state: 'failed', lastError: 'SUBSCRIPTION_PRICE_NOT_IN_CATALOG', attempts: 1 })

    t.stripe.subscriptions.get(subscription.id)!.items.data[0].price.id = PRO_MONTHLY
    t.store.seed(`stripeWebhookInbox/${first.event.id}`, { ...row, nextAttemptAt: Date.now() - 1 })
    expect(await processDueStripeEvents(t.deps)).toEqual({ [first.event.id]: 'processed' })
    expect(getEffectivePlan(t.context())).toBe('pro')
  })

  it('does not let a second subscription overwrite an active one on the same account', async () => {
    const t = setup()
    const first = t.stripe.subscribe({ customer: CUSTOMER, priceId: PRO_MONTHLY, accountPath: 'users/owner-one' })
    await t.deliver('customer.subscription.created', first.subscription as never)
    const second = t.stripe.subscribe({ customer: CUSTOMER, priceId: 'price_businessmonthly', accountPath: 'users/owner-one' })
    const result = await t.deliver('customer.subscription.created', second.subscription as never)
    expect(result.state).toBe('processed')
    expect(t.user().billing).toMatchObject({ subscriptionId: first.subscription.id, plan: 'pro' })
    expect(t.store.read(`billingEvents/${result.event.id}`)).toMatchObject({ conflict: true })
  })

  it('keeps the organization in sync for the paying owner', async () => {
    const t = setup()
    t.store.seed('users/owner-one', { ...t.user(), organizationId: 'org-one' })
    t.store.seed('organizations/org-one', { ownerId: 'owner-one', plan: 'free', billing: { status: 'free', source: 'none', plan: 'free' }, whopMembershipId: 'legacy' })
    const { subscription } = t.stripe.subscribe({ customer: CUSTOMER, priceId: 'price_businessannual1', accountPath: 'users/owner-one' })
    await t.deliver('customer.subscription.created', subscription as never)
    const org = t.store.read('organizations/org-one')!
    expect(org.billing).toMatchObject({ source: 'stripe', plan: 'business', billingInterval: 'annual' })
    expect(org.whopMembershipId).toBeUndefined()
    const context: AccountContext = { type: 'organization', userId: 'owner-one', orgId: 'org-one', user: t.user() as never, organization: org as never }
    expect(getEffectivePlan(context)).toBe('business')
  })
})

describe('annual allowances refresh monthly', () => {
  it('splits an annual paid period into monthly windows anchored on the billing day', async () => {
    const t = setup()
    const start = Date.UTC(2026, 0, 31, 12) / 1000
    const { subscription } = t.stripe.subscribe({ customer: CUSTOMER, priceId: 'price_proannual00001', accountPath: 'users/owner-one', start })
    t.stripe.subscriptions.get(subscription.id)!.items.data[0].current_period_end = Date.UTC(2027, 0, 31, 12) / 1000
    await t.deliver('customer.subscription.created', t.stripe.subscriptions.get(subscription.id) as never)

    const period = (iso: string) => getBillingPeriod(t.context(), new Date(iso))
    expect(period('2026-02-10T00:00:00Z').key).toBe('2026-01-31_2026-02-28')
    expect(period('2026-03-01T00:00:00Z').key).toBe('2026-02-28_2026-03-31')
    expect(period('2026-12-31T13:00:00Z').key).toBe('2026-12-31_2027-01-31')
    expect(new Set(['2026-02-10', '2026-03-10', '2026-04-10', '2026-11-10'].map(day => period(`${day}T00:00:00Z`).key)).size).toBe(4)
  })
})
