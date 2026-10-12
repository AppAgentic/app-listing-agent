import { adminDb } from '@/lib/firebase/admin'
import { emitStripeBillingFact } from '@/lib/analytics/runtime'
import { recordConciergeEventForUser } from '@/lib/concierge-server'
import { planForPrice } from './config'
import { getStripeRuntime } from './runtime'
import type { WebhookDeps } from './webhooks'

/** Production webhook dependencies, or null when Stripe billing is not configured (fail closed). */
export function stripeWebhookDeps(): WebhookDeps | null {
  const runtime = getStripeRuntime()
  if (!runtime) return null
  const { config, stripe } = runtime
  return {
    db: adminDb,
    stripe,
    config,
    async onProcessed(event, outcome) {
      const userId = outcome.userId ?? null
      await emitStripeBillingFact(event, userId, priceId => planForPrice(config, priceId))
      const sub = outcome.subscription
      // Concierge conversion signal: once, when a subscription first becomes paid (not on trial start).
      if (userId && sub?.firstRecord && sub.status === 'active' && sub.previousStatus !== 'active') {
        await recordConciergeEventForUser(userId, 'paid', { plan: sub.plan, status: sub.status }).catch(() => undefined)
      }
      if (userId && sub?.firstRecord && sub.status === 'trialing' && sub.previousStatus === null) {
        await recordConciergeEventForUser(userId, 'trial_started', { plan: sub.plan }).catch(() => undefined)
      }
    },
  }
}
