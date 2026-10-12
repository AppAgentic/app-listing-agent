/** Stripe object ids are opaque, but their prefixes and character set are stable. */
export function stripeId(value: unknown, prefix: string): string | null {
  return typeof value === 'string' && new RegExp(`^${prefix}_[A-Za-z0-9_]{6,120}$`).test(value) ? value : null
}

/** Stripe API version pinned for every request and the webhook endpoints (Managed Payments minimum). */
export const STRIPE_API_VERSION = '2025-03-31.basil'
