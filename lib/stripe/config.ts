import type { BillingInterval, PublicBillingPlan } from '@/lib/billing/catalog'
import { STRIPE_CATALOG } from './catalog'
import { stripeId } from './ids'

/**
 * The only Stripe account allowed to run in live mode: the App Listing Agent parent account created
 * 17 Sep 2026 (the hosted service's own account). The sandbox account can never run live, and this one never runs test.
 */
export const LIVE_STRIPE_ACCOUNT_ID = 'acct_1UGdY4BdG5NfqUxO'
export const SANDBOX_STRIPE_ACCOUNT_ID = 'acct_1UGdYABuWxLE4cGY'

export interface StripePriceBinding {
  plan: PublicBillingPlan
  interval: BillingInterval
  priceId: string
}

export interface StripeBillingConfig {
  livemode: boolean
  accountId: string
  portalConfigurationId: string
  secretKey: string
  webhookSecrets: string[]
  prices: StripePriceBinding[]
  trialDays: number
}

const secretLike = (value: string | undefined, pattern: RegExp): value is string =>
  typeof value === 'string' && pattern.test(value) && !/\s/.test(value)

/** Non-secret binding every paid entitlement must match. Readable without the API key. */
export function expectedStripeBinding(env: Record<string, string | undefined> = process.env): { livemode: boolean; accountId: string } | null {
  const accountId = stripeId(env.STRIPE_ACCOUNT_ID, 'acct')
  if (!accountId) return null
  const livemode = env.STRIPE_LIVEMODE === 'true'
  if (livemode !== (accountId === LIVE_STRIPE_ACCOUNT_ID)) return null
  return { livemode, accountId }
}

/** Fails closed: any missing or inconsistent value disables Stripe billing entirely. */
export function stripeBillingConfig(env: Record<string, string | undefined> = process.env): StripeBillingConfig | null {
  const binding = expectedStripeBinding(env)
  if (!binding) return null
  const secretKey = env.STRIPE_SECRET_KEY
  if (!secretLike(secretKey, /^(sk|rk)_(live|test)_[A-Za-z0-9]{16,}$/)) return null
  if (binding.livemode !== secretKey.includes('_live_')) return null
  const webhook = env.STRIPE_WEBHOOK_SECRET
  if (!secretLike(webhook, /^whsec_[A-Za-z0-9]{16,}$/)) return null
  const previous = env.STRIPE_WEBHOOK_SECRET_PREVIOUS
  const portalConfigurationId = stripeId(env.STRIPE_PORTAL_CONFIGURATION_ID, 'bpc')
  if (!portalConfigurationId) return null

  const prices: StripePriceBinding[] = []
  for (const entry of STRIPE_CATALOG) {
    const priceId = stripeId(env[entry.priceEnv], 'price')
    if (!priceId) return null
    prices.push({ plan: entry.plan, interval: entry.interval, priceId })
  }
  if (new Set(prices.map(price => price.priceId)).size !== prices.length) return null

  const trialDays = env.BILLING_TRIAL_DAYS === undefined ? 7 : Number(env.BILLING_TRIAL_DAYS)
  if (!Number.isInteger(trialDays) || trialDays < 0 || trialDays > 30) return null

  return {
    livemode: binding.livemode,
    accountId: binding.accountId,
    portalConfigurationId,
    secretKey,
    webhookSecrets: [webhook, ...(secretLike(previous, /^whsec_[A-Za-z0-9]{16,}$/) ? [previous] : [])],
    prices,
    trialDays,
  }
}

export function priceIdFor(config: StripeBillingConfig, plan: PublicBillingPlan, interval: BillingInterval): string {
  const binding = config.prices.find(price => price.plan === plan && price.interval === interval)
  if (!binding) throw new Error(`Stripe price for ${plan}:${interval} is not configured`)
  return binding.priceId
}

export function planForPrice(config: Pick<StripeBillingConfig, 'prices'>, priceId: unknown): StripePriceBinding | null {
  return config.prices.find(price => price.priceId === priceId) ?? null
}

export function isBillingCheckoutEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.BILLING_CHECKOUT_ENABLED === 'true' && stripeBillingConfig(env) !== null
}
