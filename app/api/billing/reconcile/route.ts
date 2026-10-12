import { timingSafeEqual } from 'crypto'
import { NextResponse } from 'next/server'
import { stripeWebhookDeps } from '@/lib/stripe/service'
import { processDueStripeEvents } from '@/lib/stripe/webhooks'
import { isSelfHosted } from '@/lib/selfhost/config'
import { selfHostedBillingDisabledResponse } from '@/lib/selfhost/responses'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET
  const header = request.headers.get('authorization') ?? ''
  if (!secret || secret.length < 16 || !header.startsWith('Bearer ')) return false
  const expected = Buffer.from(secret)
  const provided = Buffer.from(header.slice('Bearer '.length))
  return provided.length === expected.length && timingSafeEqual(provided, expected)
}

/** Cloud Scheduler hook: retries Stripe webhook events that failed or whose processing lease expired. */
export async function POST(request: Request) {
  if (isSelfHosted()) return selfHostedBillingDisabledResponse()
  if (!authorized(request)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const deps = stripeWebhookDeps()
  if (!deps) return NextResponse.json({ enabled: false }, { headers: { 'Cache-Control': 'no-store' } })
  const results = await processDueStripeEvents(deps, 20)
  const counts = Object.values(results).reduce<Record<string, number>>((all, state) => ({ ...all, [state]: (all[state] || 0) + 1 }), {})
  return NextResponse.json({ enabled: true, counts }, { headers: { 'Cache-Control': 'no-store' } })
}
