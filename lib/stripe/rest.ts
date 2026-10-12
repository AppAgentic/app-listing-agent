import { createHash } from 'node:crypto'
import { STRIPE_API_VERSION, stripeId } from './ids'

/**
 * Direct Stripe REST transport (no SDK), following SeedViral's `stripe-rest.ts`:
 * pinned API version, form-encoded bodies, an Idempotency-Key on every create, no redirects,
 * bounded responses, no logging of bodies or headers, and the key's account proven against the
 * expected account before any other call. `fetch` is injectable so tests never reach the network.
 */

export class StripeProviderError extends Error {
  constructor(readonly code: string, readonly status: number | null, readonly uncertain: boolean) {
    super(code)
  }
}

export interface StripeCustomer { id: string; object: 'customer'; livemode: boolean; metadata: Record<string, string>; deleted?: boolean }
export interface StripeCheckoutSession {
  id: string; object: 'checkout.session'; livemode: boolean; url: string | null
  status: 'open' | 'complete' | 'expired' | null; mode: string; customer: string | null
  subscription: string | null; client_reference_id: string | null; expires_at: number
  metadata: Record<string, string>; payment_status: string
}
export interface StripeSubscriptionItem { id: string; price: { id: string }; current_period_start: number; current_period_end: number }
export interface StripeSubscription {
  id: string; object: 'subscription'; livemode: boolean; customer: string
  status: 'incomplete' | 'incomplete_expired' | 'trialing' | 'active' | 'past_due' | 'canceled' | 'unpaid' | 'paused'
  cancel_at_period_end: boolean; cancel_at: number | null; canceled_at: number | null; ended_at: number | null
  trial_start: number | null; trial_end: number | null; created: number
  metadata: Record<string, string>; items: { data: StripeSubscriptionItem[] }
}
export interface StripeInvoice {
  id: string; object: 'invoice'; livemode: boolean; status: string | null; customer: string | null
  amount_paid: number; currency: string; billing_reason: string | null
  parent: { type?: string; subscription_details?: { subscription?: string | null; metadata?: Record<string, string> | null } | null } | null
}
export interface StripeCharge {
  id: string; object: 'charge'; livemode: boolean; customer: string | null; payment_intent: string | null
  amount: number; amount_refunded: number; refunded: boolean; currency: string
}
export interface StripeInvoicePayment { id: string; object: 'invoice_payment'; invoice: string; status: string }
export interface StripeList<T> { object: 'list'; data: T[]; has_more: boolean }
export interface StripePortalSession { id: string; object: 'billing_portal.session'; url: string; livemode: boolean; customer: string }

type Json = Record<string, unknown>
const record = (value: unknown): Json => (value && typeof value === 'object' && !Array.isArray(value) ? value as Json : {})

function invalid(): never { throw new StripeProviderError('PROVIDER_RESPONSE_INVALID', null, true) }
function object<T>(value: unknown, type: string, prefix: string): T {
  const body = record(value)
  if (body.object !== type || !stripeId(body.id, prefix) || typeof body.livemode !== 'boolean') invalid()
  return body as T
}
const validators = {
  customer: (value: unknown) => object<StripeCustomer>(value, 'customer', 'cus'),
  session: (value: unknown) => {
    const session = object<StripeCheckoutSession>(value, 'checkout.session', 'cs')
    if (session.url !== null && session.url !== undefined && typeof session.url !== 'string') invalid()
    return session
  },
  subscription: (value: unknown) => {
    const subscription = object<StripeSubscription>(value, 'subscription', 'sub')
    if (!stripeId(subscription.customer, 'cus') || !Array.isArray(record(subscription.items).data)) invalid()
    return subscription
  },
  invoice: (value: unknown) => object<StripeInvoice>(value, 'invoice', 'in'),
  charge: (value: unknown) => {
    const body = record(value)
    if (body.object !== 'charge' || !(stripeId(body.id, 'ch') || stripeId(body.id, 'py')) || typeof body.livemode !== 'boolean') invalid()
    return body as unknown as StripeCharge
  },
  portal: (value: unknown) => {
    const body = record(value)
    if (body.object !== 'billing_portal.session' || typeof body.url !== 'string') invalid()
    return body as unknown as StripePortalSession
  },
}
function list<T>(value: unknown, item: (value: unknown) => T): StripeList<T> {
  const body = record(value)
  if (body.object !== 'list' || !Array.isArray(body.data)) invalid()
  return { object: 'list', data: (body.data as unknown[]).map(item), has_more: body.has_more === true }
}

function encode(prefix: string, value: unknown, into: URLSearchParams) {
  if (value === undefined || value === null) return
  if (Array.isArray(value)) value.forEach((item, index) => encode(`${prefix}[${index}]`, item, into))
  else if (typeof value === 'object') {
    for (const [key, item] of Object.entries(value as Json)) encode(prefix ? `${prefix}[${key}]` : key, item, into)
  } else into.append(prefix, String(value))
}
export function formBody(params: Json): URLSearchParams {
  const body = new URLSearchParams()
  encode('', params, body)
  return body
}
const pathId = (value: string, prefix: string) => {
  const valid = stripeId(value, prefix)
  if (!valid) throw new StripeProviderError('INVALID_PROVIDER_ID', null, false)
  return encodeURIComponent(valid)
}

export interface CheckoutSessionInput {
  customerId: string
  priceId: string
  clientReferenceId: string
  successUrl: string
  cancelUrl: string
  metadata: Record<string, string>
  subscriptionMetadata: Record<string, string>
  trialDays: number
  idempotencyKey: string
}

/**
 * Exact Checkout Session parameters. Managed Payments rejects automatic_tax, tax_id_collection,
 * payment_method_collection / types / options / configuration, customer_update and invoice settings
 * (dashboard "Remove from code" list, verified 17 Sep 2026), so none are sent. Subscription Checkout
 * collects a payment method by default, including for a free trial.
 */
export function checkoutSessionParams(input: CheckoutSessionInput): Json {
  if (input.clientReferenceId.length > 200) throw new StripeProviderError('INVALID_CLIENT_REFERENCE', null, false)
  return {
    mode: 'subscription',
    line_items: [{ price: input.priceId, quantity: 1 }],
    managed_payments: { enabled: true },
    customer: input.customerId,
    client_reference_id: input.clientReferenceId,
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    metadata: input.metadata,
    subscription_data: {
      metadata: input.subscriptionMetadata,
      ...(input.trialDays > 0 ? { trial_period_days: input.trialDays } : {}),
    },
  }
}

const verifiedAccounts = new Map<string, number>()
export function clearStripeAccountVerificationCache(): void { verifiedAccounts.clear() }

export class StripeRest {
  readonly livemode: boolean
  #key: string
  #fetch: typeof fetch
  #timeoutMs: number
  #expectedAccountId: string
  #verificationTtlMs: number
  #verificationKey: string
  #verification: Promise<void> | null = null

  constructor(apiKey: string, options: { expectedAccountId: string; fetch?: typeof fetch; timeoutMs?: number; accountVerificationTtlMs?: number }) {
    if (!/^(sk|rk)_(test|live)_[A-Za-z0-9]{16,}$/.test(apiKey) || !stripeId(options.expectedAccountId, 'acct')) {
      throw new StripeProviderError('BILLING_CONFIGURATION_MISSING', null, false)
    }
    this.#key = apiKey
    this.livemode = apiKey.includes('_live_')
    this.#fetch = options.fetch ?? fetch
    this.#timeoutMs = options.timeoutMs ?? 20_000
    this.#expectedAccountId = options.expectedAccountId
    this.#verificationTtlMs = options.accountVerificationTtlMs ?? 0
    this.#verificationKey = createHash('sha256').update(apiKey).update(':').update(options.expectedAccountId).digest('hex')
  }

  async #verifyAccount(): Promise<void> {
    const verifiedAt = this.#verificationTtlMs > 0 ? verifiedAccounts.get(this.#verificationKey) : undefined
    if (verifiedAt !== undefined && Date.now() - verifiedAt < this.#verificationTtlMs) return
    if (this.#verification) return this.#verification
    const verification = (async () => {
      try {
        await this.#transport('GET', '/v1/account', value => {
          const account = record(value)
          if (account.object !== 'account' || !stripeId(account.id, 'acct')) throw new StripeProviderError('STRIPE_ACCOUNT_UNVERIFIED', null, false)
          if (account.id !== this.#expectedAccountId) throw new StripeProviderError('STRIPE_ACCOUNT_MISMATCH', null, false)
        })
        if (this.#verificationTtlMs > 0) verifiedAccounts.set(this.#verificationKey, Date.now())
      } catch (error) {
        verifiedAccounts.delete(this.#verificationKey)
        if (error instanceof StripeProviderError && error.code === 'STRIPE_ACCOUNT_MISMATCH') throw error
        throw new StripeProviderError('STRIPE_ACCOUNT_UNVERIFIED', error instanceof StripeProviderError ? error.status : null, false)
      }
    })()
    this.#verification = verification
    try { await verification } finally { if (this.#verification === verification) this.#verification = null }
  }

  async #request<T>(method: 'GET' | 'POST' | 'DELETE', path: string, validator: (value: unknown) => T, params?: Json, idempotencyKey?: string): Promise<T> {
    await this.#verifyAccount()
    return this.#transport(method, path, validator, params, idempotencyKey)
  }

  async #transport<T>(method: 'GET' | 'POST' | 'DELETE', path: string, validator: (value: unknown) => T, params?: Json, idempotencyKey?: string): Promise<T> {
    if (!path.startsWith('/v1/')) throw new StripeProviderError('INVALID_PROVIDER_PATH', null, false)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.#timeoutMs)
    const headers: Record<string, string> = { Authorization: `Bearer ${this.#key}`, 'Stripe-Version': STRIPE_API_VERSION }
    let url = `https://api.stripe.com${path}`
    let body: string | undefined
    if (params && method === 'GET') url += `?${formBody(params)}`
    else if (params) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded'
      body = formBody(params).toString()
    }
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey
    try {
      let response: Response
      try {
        response = await this.#fetch(url, { method, headers, body, redirect: 'error', signal: controller.signal })
      } catch {
        throw new StripeProviderError('PROVIDER_UNREACHABLE', null, true)
      }
      let text: string
      try {
        text = await response.text()
      } catch {
        throw new StripeProviderError('PROVIDER_RESPONSE_READ_FAILED', response.status, true)
      }
      if (text.length > 2 * 1024 * 1024) throw new StripeProviderError('PROVIDER_RESPONSE_TOO_LARGE', response.status, true)
      let parsed: unknown
      try { parsed = JSON.parse(text) } catch { throw new StripeProviderError('PROVIDER_RESPONSE_INVALID', response.status, true) }
      if (!response.ok) {
        const error = record(record(parsed).error)
        const code = typeof error.code === 'string' ? error.code : typeof error.type === 'string' ? error.type : `HTTP_${response.status}`
        const uncertain = response.status >= 500 || [408, 409, 429].includes(response.status)
        throw new StripeProviderError(code.replace(/[^a-z0-9_]/gi, '_').slice(0, 64), response.status, uncertain)
      }
      try {
        return validator(parsed)
      } catch (error) {
        if (error instanceof StripeProviderError) throw new StripeProviderError(error.code, response.status, error.uncertain)
        throw new StripeProviderError('PROVIDER_RESPONSE_INVALID', response.status, true)
      }
    } finally {
      clearTimeout(timer)
    }
  }

  createCustomer(input: { email: string; metadata: Record<string, string>; idempotencyKey: string }) {
    return this.#request('POST', '/v1/customers', validators.customer, { email: input.email, metadata: input.metadata }, input.idempotencyKey)
  }
  retrieveCustomer(customerId: string) {
    return this.#request('GET', `/v1/customers/${pathId(customerId, 'cus')}`, validators.customer)
  }
  createCheckoutSession(input: CheckoutSessionInput) {
    pathId(input.priceId, 'price'); pathId(input.customerId, 'cus')
    return this.#request('POST', '/v1/checkout/sessions', validators.session, checkoutSessionParams(input), input.idempotencyKey)
  }
  retrieveCheckoutSession(sessionId: string) {
    return this.#request('GET', `/v1/checkout/sessions/${pathId(sessionId, 'cs')}`, validators.session)
  }
  expireCheckoutSession(sessionId: string, idempotencyKey: string) {
    return this.#request('POST', `/v1/checkout/sessions/${pathId(sessionId, 'cs')}/expire`, validators.session, {}, idempotencyKey)
  }
  retrieveSubscription(subscriptionId: string) {
    return this.#request('GET', `/v1/subscriptions/${pathId(subscriptionId, 'sub')}`, validators.subscription)
  }
  cancelSubscription(subscriptionId: string, idempotencyKey: string) {
    return this.#request('DELETE', `/v1/subscriptions/${pathId(subscriptionId, 'sub')}`, validators.subscription, undefined, idempotencyKey)
  }
  retrieveInvoice(invoiceId: string) {
    return this.#request('GET', `/v1/invoices/${pathId(invoiceId, 'in')}`, validators.invoice)
  }
  retrieveCharge(chargeId: string) {
    const id = stripeId(chargeId, 'ch') ?? stripeId(chargeId, 'py')
    if (!id) throw new StripeProviderError('INVALID_PROVIDER_ID', null, false)
    return this.#request('GET', `/v1/charges/${encodeURIComponent(id)}`, validators.charge)
  }
  listInvoicePaymentsForPaymentIntent(paymentIntentId: string) {
    pathId(paymentIntentId, 'pi')
    return this.#request('GET', '/v1/invoice_payments', value => list(value, item => {
      const body = record(item)
      if (body.object !== 'invoice_payment' || typeof body.invoice !== 'string') invalid()
      return body as unknown as StripeInvoicePayment
    }), { payment: { type: 'payment_intent', payment_intent: paymentIntentId }, limit: 10 })
  }
  createPortalSession(input: { customerId: string; configurationId: string; returnUrl: string; idempotencyKey: string }) {
    pathId(input.customerId, 'cus'); pathId(input.configurationId, 'bpc')
    return this.#request('POST', '/v1/billing_portal/sessions', validators.portal, {
      customer: input.customerId,
      configuration: input.configurationId,
      return_url: input.returnUrl,
    }, input.idempotencyKey)
  }
}
