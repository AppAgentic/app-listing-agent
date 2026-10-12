import { StripeRest } from './rest'
import { stripeBillingConfig, type StripeBillingConfig } from './config'
import { HOSTED_APP_ORIGIN } from '@/lib/routing/app-url'

let cached: { key: string; client: StripeRest } | null = null

/** Runtime Stripe client for the configured account, or null when billing is not fully configured. */
export function getStripeRuntime(env: Record<string, string | undefined> = process.env): { config: StripeBillingConfig; stripe: StripeRest } | null {
  const config = stripeBillingConfig(env)
  if (!config) return null
  const key = `${config.accountId}:${config.livemode}:${config.secretKey.length}:${config.secretKey.slice(-6)}`
  if (!cached || cached.key !== key) {
    cached = {
      key,
      // A key's account never changes, so a proven match is remembered for 10 minutes (saves ~300ms per call).
      client: new StripeRest(config.secretKey, { expectedAccountId: config.accountId, accountVerificationTtlMs: 10 * 60 * 1000 }),
    }
  }
  return { config, stripe: cached.client }
}

export function publicAppOrigin(fallback: string): string {
  try {
    return process.env.NEXT_PUBLIC_APP_URL ? new URL(process.env.NEXT_PUBLIC_APP_URL).origin : new URL(fallback).origin
  } catch {
    return HOSTED_APP_ORIGIN
  }
}
