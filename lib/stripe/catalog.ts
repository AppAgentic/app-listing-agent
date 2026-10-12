import {
  BILLING_INTERVALS,
  BILLING_PLANS,
  PUBLIC_BILLING_PLANS,
  type BillingInterval,
  type PublicBillingPlan,
} from '@/lib/billing/catalog'

/**
 * The Stripe catalog in code, like SeedViral. Amounts come from BILLING_PLANS (USD, tax exclusive).
 * The provisioning script creates exactly these products/prices; the runtime maps price ids from
 * configuration back to a plan and never trusts checkout metadata for the plan.
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
    }
  })
)

export function stripeCatalogEntry(plan: PublicBillingPlan, interval: BillingInterval): StripeCatalogEntry {
  const entry = STRIPE_CATALOG.find(candidate => candidate.plan === plan && candidate.interval === interval)
  if (!entry) throw new Error(`No Stripe catalog entry for ${plan}:${interval}`)
  return entry
}
