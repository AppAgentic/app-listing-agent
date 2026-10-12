import crypto from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { verifyProjectWebhookSignature } from '@/lib/whop/project-webhook-security'

describe('project Whop webhook security', () => {
  const payload = JSON.stringify({ action: 'payment.completed' })
  const secret = 'test-secret'

  it('fails closed when no signing secret is configured', () => {
    expect(verifyProjectWebhookSignature(payload, null, null)).toEqual({
      ok: false,
      status: 503,
      error: 'Webhook signing secret is not configured',
    })
  })

  it('rejects missing and malformed signatures', () => {
    expect(verifyProjectWebhookSignature(payload, null, secret).ok).toBe(false)
    expect(verifyProjectWebhookSignature(payload, 'short', secret).ok).toBe(false)
  })

  it('accepts the exact HMAC-SHA256 signature', () => {
    const signature = crypto.createHmac('sha256', secret).update(payload).digest('hex')
    expect(verifyProjectWebhookSignature(payload, signature, secret)).toEqual({ ok: true })
  })
})
