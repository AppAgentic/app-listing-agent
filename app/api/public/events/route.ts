import { adminAuth } from '@/lib/firebase/admin'
import { AnalyticsRateLimiter, analyticsConfig, handleAnalyticsRequest } from '@/lib/analytics/ingest'
import { AnonymousDailyCap, BotDropCounter } from '@/lib/analytics/guardrails'
import { runtimeInsert } from '@/lib/analytics/runtime'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Per-instance, in memory: App Hosting maxInstances 10 bounds the fleet-wide totals.
const limiter = new AnalyticsRateLimiter()
const dailyCap = new AnonymousDailyCap()
const botDrops = new BotDropCounter()

/** First-party product analytics ingest (browser events only). See lib/analytics/ingest.ts and guardrails.ts. */
export async function POST(request: Request) {
  const config = analyticsConfig()
  return handleAnalyticsRequest(request, {
    env: process.env,
    now: Date.now,
    limiter,
    dailyCap,
    botDrops,
    insert: config ? runtimeInsert(config) : null,
    // Signature and expiry are verified locally; revocation is not checked for analytics attribution.
    verifySession: async cookie => (await adminAuth.verifySessionCookie(cookie, false)).uid,
  })
}
