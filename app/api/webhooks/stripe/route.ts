import { NextResponse } from 'next/server'
import { stripeWebhookDeps } from '@/lib/stripe/service'
import { intakeStripeEvent, processStripeEvent, WebhookRejected } from '@/lib/stripe/webhooks'
import { isSelfHosted } from '@/lib/selfhost/config'
import { selfHostedBillingDisabledResponse } from '@/lib/selfhost/responses'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Raw-body signature verification, durable inbox commit, then a bounded inline processing attempt.
 * A failed attempt stays due for the reconcile sweep; Stripe also retries non-2xx deliveries.
 */
export async function POST(request: Request) {
  if (isSelfHosted()) return selfHostedBillingDisabledResponse()
  const deps = stripeWebhookDeps()
  if (!deps) return NextResponse.json({ error: 'Billing is not configured' }, { status: 503 })
  let intake: { eventId: string; duplicate: boolean }
  try {
    const body = Buffer.from(await request.arrayBuffer())
    intake = await intakeStripeEvent(deps, body, request.headers.get('stripe-signature'))
  } catch (error) {
    if (error instanceof WebhookRejected) {
      console.error(`Stripe webhook rejected: ${error.code}`)
      return NextResponse.json({ error: error.code }, { status: error.status })
    }
    console.error('Stripe webhook intake failed')
    return NextResponse.json({ error: 'Webhook intake failed' }, { status: 500 })
  }
  let processed = 'deferred'
  try {
    processed = await processStripeEvent(deps, intake.eventId)
  } catch {
    processed = 'deferred'
  }
  return NextResponse.json({ received: true, duplicate: intake.duplicate, processed }, { headers: { 'Cache-Control': 'no-store' } })
}
