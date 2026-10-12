import {
  BILLING_INTERVALS,
  BILLING_PLANS,
  OPTIONAL_BILLING_PLANS,
  PUBLIC_BILLING_PLANS,
  type BillingInterval,
  type PublicBillingPlan,
} from '@/lib/billing/catalog'

/**
 * The Stripe catalog in code. Amounts come from BILLING_PLANS (USD, tax exclusive).
 * The provisioning script creates exactly these products/prices; the runtime maps price ids from
 * configuration back to a plan and never trusts checkout metadata for the plan.
 *
 * Adding a plan is additive: it keeps this catalog version, gets its own product and `asc_<plan>_<interval>_usd_v1`
 * lookup keys, and leaves every existing live price untouched (Indie, 2026-10-12). Bump the version only when an
 * existing price changes, because Stripe prices are immutable and a new version means new price ids for every plan.
 */
export const STRIPE_CATALOG_VERSION = 'asc-stripe-2026-09-v1'
/** Software as a service, business use. Eligible for Managed Payments. */
export const STRIPE_TAX_CODE = 'txcd_10103001'

export interface StripeCatalogEntry {
  key: `${PublicBillingPlan}:${BillingInterval}`
  plan: PublicBillingPlan
  interval: BillingInterval
  productName: string
  lookupKey: string
  unitAmount: number
  currency: 'usd'
  recurringInterval: 'month' | 'year'
  priceEnv: string
  /** True for plans added after launch (OPTIONAL_BILLING_PLANS): missing price ids make only this plan unavailable. */
  optional: boolean
}

export const STRIPE_CATALOG: readonly StripeCatalogEntry[] = PUBLIC_BILLING_PLANS.flatMap(plan =>
  BILLING_INTERVALS.map(interval => {
    const definition = BILLING_PLANS[plan]
    const usd = interval === 'monthly' ? definition.monthlyPriceUsd : definition.annualPriceUsd
    if (usd === null || !Number.isInteger(usd) || usd <= 0) throw new Error(`${plan} ${interval} has no public price`)
    return {
      key: `${plan}:${interval}` as const,
      plan,
      interval,
      productName: `App Listing Agent ${definition.name}`,
      lookupKey: `asc_${plan}_${interval}_usd_v1`,
      unitAmount: usd * 100,
      currency: 'usd' as const,
      recurringInterval: interval === 'monthly' ? 'month' as const : 'year' as const,
      priceEnv: `STRIPE_PRICE_${plan.toUpperCase()}_${interval.toUpperCase()}`,
      optional: OPTIONAL_BILLING_PLANS.includes(plan),
    }
  })
)

export function stripeCatalogEntry(plan: PublicBillingPlan, interval: BillingInterval): StripeCatalogEntry {
  const entry = STRIPE_CATALOG.find(candidate => candidate.plan === plan && candidate.interval === interval)
  if (!entry) throw new Error(`No Stripe catalog entry for ${plan}:${interval}`)
  return entry
}
