import { beforeEach, describe, expect, it } from 'vitest'
import { StripeProviderError, StripeRest, checkoutSessionParams, clearStripeAccountVerificationCache, formBody } from '@/lib/stripe/rest'

const input = {
  customerId: 'cus_customer0001', priceId: 'price_promonthly0001', clientReferenceId: 'users:uid',
  successUrl: 'https://applistingagent.com/billing?checkout=complete', cancelUrl: 'https://applistingagent.com/onboarding?checkout=canceled',
  metadata: { appstorecopilot_plan: 'pro' }, subscriptionMetadata: { appstorecopilot_plan: 'pro' }, trialDays: 7, idempotencyKey: 'asc-checkout-1',
}

beforeEach(() => clearStripeAccountVerificationCache())

describe('Stripe Checkout parameters', () => {
  it('uses Managed Payments, subscription mode, a required card and the trial', () => {
    const params = checkoutSessionParams(input)
    expect(params).toMatchObject({
      mode: 'subscription',
      managed_payments: { enabled: true },
      subscription_data: { trial_period_days: 7 },
    })
    const encoded = formBody(params).toString()
    expect(encoded).toContain('managed_payments%5Benabled%5D=true')
    expect(encoded).toContain('subscription_data%5Btrial_period_days%5D=7')
    // Parameters Managed Payments rejects are never sent.
    expect(encoded).not.toMatch(/automatic_tax|payment_method_types|payment_method_collection|payment_method_options|tax_id_collection|customer_update|invoice_creation|default_tax_rates/)
  })

  it('omits the trial for an account that already used it', () => {
    expect((checkoutSessionParams({ ...input, trialDays: 0 }).subscription_data as Record<string, unknown>).trial_period_days).toBeUndefined()
  })
})

describe('Stripe REST transport', () => {
  const calls: Array<{ url: string; init: RequestInit }> = []
  const respond = (routes: Record<string, unknown>) => (async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    const path = new URL(url).pathname
    const body = routes[path]
    return new Response(JSON.stringify(body ?? { error: { code: 'resource_missing' } }), { status: body ? 200 : 404 })
  }) as unknown as typeof fetch

  it('proves the account first, pins the API version and sends idempotency keys', async () => {
    calls.length = 0
    const stripe = new StripeRest('sk_test_' + 'a'.repeat(24), {
      expectedAccountId: 'acct_testaccount01',
      fetch: respond({
        '/v1/account': { object: 'account', id: 'acct_testaccount01' },
        '/v1/customers': { object: 'customer', id: 'cus_customer0001', livemode: false, metadata: {} },
      }),
    })
    await stripe.createCustomer({ email: 'a@example.com', metadata: {}, idempotencyKey: 'key-1' })
    expect(calls.map(call => new URL(call.url).pathname)).toEqual(['/v1/account', '/v1/customers'])
    const headers = calls[1].init.headers as Record<string, string>
    expect(headers['Stripe-Version']).toBe('2025-03-31.basil')
    expect(headers['Idempotency-Key']).toBe('key-1')
    expect(calls[1].init.redirect).toBe('error')
  })

  it('refuses to call Stripe with a key for another account', async () => {
    calls.length = 0
    const stripe = new StripeRest('sk_test_' + 'a'.repeat(24), {
      expectedAccountId: 'acct_testaccount01',
      fetch: respond({ '/v1/account': { object: 'account', id: 'acct_otheraccount1' } }),
    })
    await expect(stripe.retrieveSubscription('sub_subscription01')).rejects.toMatchObject({ code: 'STRIPE_ACCOUNT_MISMATCH' })
    expect(calls).toHaveLength(1)
  })

  it('treats 5xx and malformed bodies as uncertain, explicit 4xx as final', async () => {
    const stripe = (status: number, body: string) => new StripeRest('sk_test_' + 'a'.repeat(24), {
      expectedAccountId: 'acct_testaccount01',
      fetch: (async (url: string) => new URL(url).pathname === '/v1/account'
        ? new Response(JSON.stringify({ object: 'account', id: 'acct_testaccount01' }))
        : new Response(body, { status })) as unknown as typeof fetch,
    })
    await expect(stripe(500, '{}').retrieveInvoice('in_invoice00001')).rejects.toMatchObject({ uncertain: true })
    await expect(stripe(200, 'not json').retrieveInvoice('in_invoice00001')).rejects.toMatchObject({ uncertain: true })
    const final = await stripe(400, '{"error":{"code":"parameter_invalid"}}').retrieveInvoice('in_invoice00001').catch(error => error)
    expect(final).toBeInstanceOf(StripeProviderError)
    expect(final).toMatchObject({ code: 'parameter_invalid', uncertain: false })
  })
})
