import crypto from 'node:crypto'

export type ProjectWebhookVerification =
  | { ok: true }
  | { ok: false; status: 401 | 503; error: string }

export function verifyProjectWebhookSignature(
  payload: string,
  signature: string | null,
  secret: string | null,
): ProjectWebhookVerification {
  if (!secret) {
    return { ok: false, status: 503, error: 'Webhook signing secret is not configured' }
  }
  if (!signature) {
    return { ok: false, status: 401, error: 'Missing signature' }
  }

  const expected = Buffer.from(
    crypto.createHmac('sha256', secret).update(payload).digest('hex'),
  )
  const provided = Buffer.from(signature)
  if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) {
    return { ok: false, status: 401, error: 'Invalid signature' }
  }
  return { ok: true }
}
