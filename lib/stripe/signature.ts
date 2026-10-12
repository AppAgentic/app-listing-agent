import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Stripe-Signature: `t=<unix>,v1=<hmac>,...`. The signed payload is `${t}.${rawBody}` (HMAC-SHA256).
 * Only v1 schemes count. Several secrets are accepted while a rolled secret expires.
 */
export function signStripePayload(rawBody: Buffer | string, secret: string, timestampSeconds: number): string {
  const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody, 'utf8')
  const digest = createHmac('sha256', secret).update(`${timestampSeconds}.`).update(body).digest('hex')
  return `t=${timestampSeconds},v1=${digest}`
}

export class WebhookSignatureError extends Error {
  constructor(readonly reason: 'missing' | 'malformed' | 'stale' | 'mismatch') {
    super(`WEBHOOK_SIGNATURE_${reason.toUpperCase()}`)
  }
}

export function verifyStripeSignature(
  rawBody: Buffer,
  header: string | null,
  secrets: readonly string[],
  nowSeconds: number,
  toleranceSeconds = 300,
): { timestamp: number } {
  if (!header) throw new WebhookSignatureError('missing')
  if (header.length > 4096 || !secrets.length) throw new WebhookSignatureError('malformed')
  let timestamp: number | null = null
  const signatures: string[] = []
  for (const part of header.split(',')) {
    const index = part.indexOf('=')
    if (index < 0) continue
    const key = part.slice(0, index).trim()
    const value = part.slice(index + 1).trim()
    if (key === 't') {
      if (!/^\d{1,12}$/.test(value)) throw new WebhookSignatureError('malformed')
      timestamp = Number(value)
    } else if (key === 'v1') {
      if (!/^[a-f0-9]{64}$/.test(value)) throw new WebhookSignatureError('malformed')
      signatures.push(value)
    }
  }
  if (timestamp === null || !signatures.length) throw new WebhookSignatureError('malformed')
  if (Math.abs(nowSeconds - timestamp) > toleranceSeconds) throw new WebhookSignatureError('stale')
  for (const secret of secrets) {
    const expected = Buffer.from(createHmac('sha256', secret).update(`${timestamp}.`).update(rawBody).digest('hex'), 'utf8')
    for (const signature of signatures) {
      const actual = Buffer.from(signature, 'utf8')
      if (actual.length === expected.length && timingSafeEqual(actual, expected)) return { timestamp }
    }
  }
  throw new WebhookSignatureError('mismatch')
}
