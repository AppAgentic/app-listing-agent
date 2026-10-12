import { SANDBOX_STRIPE_ACCOUNT_ID, stripeBillingConfig, type StripeBillingConfig } from '@/lib/stripe/config'
import type { StripeCharge, StripeCheckoutSession, StripeInvoice, StripeSubscription } from '@/lib/stripe/rest'
import { signStripePayload } from '@/lib/stripe/signature'

export const sandboxEnv = (): Record<string, string> => ({
  STRIPE_SECRET_KEY: 'sk_test_' + 'a'.repeat(24),
  STRIPE_WEBHOOK_SECRET: 'whsec_' + 'b'.repeat(24),
  STRIPE_ACCOUNT_ID: SANDBOX_STRIPE_ACCOUNT_ID,
  STRIPE_LIVEMODE: 'false',
  STRIPE_PORTAL_CONFIGURATION_ID: 'bpc_testportal01',
  STRIPE_PRICE_STARTER_MONTHLY: 'price_startermonthly',
  STRIPE_PRICE_STARTER_ANNUAL: 'price_starterannual1',
  STRIPE_PRICE_PRO_MONTHLY: 'price_promonthly0001',
  STRIPE_PRICE_PRO_ANNUAL: 'price_proannual00001',
  STRIPE_PRICE_BUSINESS_MONTHLY: 'price_businessmonthly',
  STRIPE_PRICE_BUSINESS_ANNUAL: 'price_businessannual1',
  BILLING_CHECKOUT_ENABLED: 'true',
})

export const sandboxConfig = (): StripeBillingConfig => stripeBillingConfig(sandboxEnv())!

/** Minimal in-memory Stripe account: objects by id, plus the calls the code made. */
export function createFakeStripe() {
  const subscriptions = new Map<string, StripeSubscription>()
  const sessions = new Map<string, StripeCheckoutSession>()
  const invoices = new Map<string, StripeInvoice>()
  const charges = new Map<string, StripeCharge>()
  const invoicePayments = new Map<string, string>()
  const calls: string[] = []
  let sequence = 0
  const next = (prefix: string) => `${prefix}_${String(++sequence).padStart(10, '0')}`
  const missing = () => Object.assign(new Error('resource_missing'), { code: 'resource_missing', status: 404, uncertain: false })

  const client = {
    async createCustomer(input: { email: string; metadata: Record<string, string>; idempotencyKey: string }) {
      calls.push(`createCustomer:${input.idempotencyKey}`)
      return { id: `cus_${input.idempotencyKey.slice(-12)}`, object: 'customer' as const, livemode: false, metadata: input.metadata }
    },
    async createCheckoutSession(input: { customerId: string; priceId: string; trialDays: number; subscriptionMetadata: Record<string, string>; idempotencyKey: string }) {
      calls.push(`createCheckoutSession:${input.priceId}:trial=${input.trialDays}`)
      const id = next('cs_test')
      const session: StripeCheckoutSession = {
        id, object: 'checkout.session', livemode: false, url: `https://checkout.stripe.com/c/pay/${id}`, status: 'open',
        mode: 'subscription', customer: input.customerId, subscription: null, client_reference_id: null,
        expires_at: Math.floor(Date.now() / 1000) + 24 * 3600, metadata: {}, payment_status: 'unpaid',
      }
      sessions.set(id, session)
      return session
    },
    async retrieveCheckoutSession(id: string) { calls.push(`retrieveCheckoutSession:${id}`); const s = sessions.get(id); if (!s) throw missing(); return s },
    async expireCheckoutSession(id: string) { calls.push(`expireCheckoutSession:${id}`); const s = sessions.get(id)!; s.status = 'expired'; return s },
    async retrieveSubscription(id: string) { calls.push(`retrieveSubscription:${id}`); const s = subscriptions.get(id); if (!s) throw missing(); return structuredClone(s) },
    async cancelSubscription(id: string, key: string) {
      calls.push(`cancelSubscription:${id}:${key}`)
      const s = subscriptions.get(id)!; s.status = 'canceled'; s.canceled_at = s.ended_at = Math.floor(Date.now() / 1000); return structuredClone(s)
    },
    async retrieveInvoice(id: string) { calls.push(`retrieveInvoice:${id}`); const i = invoices.get(id); if (!i) throw missing(); return i },
    async retrieveCharge(id: string) { calls.push(`retrieveCharge:${id}`); const c = charges.get(id); if (!c) throw missing(); return c },
    async listInvoicePaymentsForPaymentIntent(pi: string) {
      const invoice = invoicePayments.get(pi)
      return { object: 'list' as const, has_more: false, data: invoice ? [{ id: 'inpay_000001', object: 'invoice_payment' as const, invoice, status: 'paid' }] : [] }
    },
  }

  const now = () => Math.floor(Date.now() / 1000)
  return {
    client,
    calls,
    subscriptions,
    sessions,
    invoices,
    charges,
    /** A subscription as Checkout would create it. */
    subscribe(input: { customer: string; priceId: string; trialDays?: number; accountPath: string; start?: number }) {
      const start = input.start ?? now()
      const trialEnd = input.trialDays ? start + input.trialDays * 86_400 : null
      const id = next('sub')
      const subscription: StripeSubscription = {
        id, object: 'subscription', livemode: false, customer: input.customer,
        status: trialEnd ? 'trialing' : 'active', cancel_at_period_end: false, cancel_at: null, canceled_at: null, ended_at: null,
        trial_start: trialEnd ? start : null, trial_end: trialEnd, created: start,
        metadata: { appstorecopilot_account_path: input.accountPath },
        items: { data: [{ id: next('si'), price: { id: input.priceId }, current_period_start: start, current_period_end: trialEnd ?? start + 30 * 86_400 }] },
      }
      subscriptions.set(id, subscription)
      const session = next('cs_test')
      sessions.set(session, {
        id: session, object: 'checkout.session', livemode: false, url: null, status: 'complete', mode: 'subscription',
        customer: input.customer, subscription: id, client_reference_id: null, expires_at: start + 3600, metadata: {}, payment_status: trialEnd ? 'no_payment_required' : 'paid',
      })
      return { subscription, sessionId: session }
    },
    invoice(input: { subscriptionId: string; customer: string; amount: number; status?: string; reason?: string; paymentIntent?: string; priceId?: string }) {
      const id = next('in')
      invoices.set(id, {
        id, object: 'invoice', livemode: false, status: input.status ?? 'paid', customer: input.customer,
        amount_paid: input.status && input.status !== 'paid' ? 0 : input.amount, currency: 'usd', billing_reason: input.reason ?? 'subscription_cycle',
        parent: { type: 'subscription_details', subscription_details: { subscription: input.subscriptionId, metadata: {} } },
      })
      if (input.paymentIntent) invoicePayments.set(input.paymentIntent, id)
      return id
    },
    charge(input: { customer: string; amount: number; refunded: number; paymentIntent: string }) {
      const id = next('ch')
      charges.set(id, { id, object: 'charge', livemode: false, customer: input.customer, payment_intent: input.paymentIntent, amount: input.amount, amount_refunded: input.refunded, refunded: input.refunded >= input.amount, currency: 'usd' })
      return id
    },
  }
}

let eventSequence = 0
export function signedEvent(type: string, object: Record<string, unknown>, options: { livemode?: boolean; previous?: Record<string, unknown>; secret?: string; created?: number } = {}) {
  const created = options.created ?? Math.floor(Date.now() / 1000)
  const event = {
    id: `evt_${String(++eventSequence).padStart(12, '0')}`,
    object: 'event', type, livemode: options.livemode ?? false, created, api_version: '2025-03-31.basil',
    data: { object, ...(options.previous ? { previous_attributes: options.previous } : {}) },
  }
  const body = Buffer.from(JSON.stringify(event))
  return { event, body, signature: signStripePayload(body, options.secret ?? 'whsec_' + 'b'.repeat(24), Math.floor(Date.now() / 1000)) }
}
