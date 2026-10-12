import { describe, expect, it } from 'vitest'
import { signStripePayload, verifyStripeSignature, WebhookSignatureError } from '@/lib/stripe/signature'

const reason = (fn: () => unknown) => {
  try { fn() } catch (error) { return error instanceof WebhookSignatureError ? error.reason : 'other' }
  return 'none'
}

describe('Stripe webhook signatures', () => {
  const body = Buffer.from('{"id":"evt_test","type":"invoice.paid"}')
  const header = signStripePayload(body, 'whsec_a', 1_000_000)

  it('verifies raw bytes within tolerance and accepts a rolled secret list', () => {
    expect(verifyStripeSignature(body, header, ['whsec_a'], 1_000_100)).toEqual({ timestamp: 1_000_000 })
    expect(verifyStripeSignature(body, header, ['whsec_new', 'whsec_a'], 1_000_100)).toEqual({ timestamp: 1_000_000 })
  })

  it('rejects changed bytes, wrong secrets, stale, missing and malformed headers', () => {
    expect(reason(() => verifyStripeSignature(Buffer.from(`${body} `), header, ['whsec_a'], 1_000_100))).toBe('mismatch')
    expect(reason(() => verifyStripeSignature(body, header, ['whsec_b'], 1_000_100))).toBe('mismatch')
    expect(reason(() => verifyStripeSignature(body, header, ['whsec_a'], 1_000_400))).toBe('stale')
    expect(reason(() => verifyStripeSignature(body, null, ['whsec_a'], 1_000_100))).toBe('missing')
    expect(reason(() => verifyStripeSignature(body, 't=abc,v1=zz', ['whsec_a'], 1_000_100))).toBe('malformed')
    expect(reason(() => verifyStripeSignature(body, `t=1000000,v0=${'a'.repeat(64)}`, ['whsec_a'], 1_000_100))).toBe('malformed')
    expect(reason(() => verifyStripeSignature(body, header, [], 1_000_100))).toBe('malformed')
  })
})
