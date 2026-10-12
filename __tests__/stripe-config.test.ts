import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  LIVE_STRIPE_ACCOUNT_ID,
  SANDBOX_STRIPE_ACCOUNT_ID,
  hasPlanPrices,
  isBillingCheckoutEnabled,
  isPlanPurchasable,
  planForPrice,
  priceIdFor,
  stripeBillingConfig,
} from '@/lib/stripe/config'
import { STRIPE_CATALOG, STRIPE_CATALOG_VERSION } from '@/lib/stripe/catalog'
import { BILLING_PLANS } from '@/lib/billing/catalog'
import { sandboxEnv } from './helpers/stripe-fixtures'

const indieIds = { STRIPE_PRICE_INDIE_MONTHLY: 'price_indiemonthly01', STRIPE_PRICE_INDIE_ANNUAL: 'price_indieannual001' }

afterEach(() => vi.unstubAllEnvs())

describe('Stripe catalog in code', () => {
  it('has all eight USD plan prices at the public amounts, annual at 10x', () => {
    expect(STRIPE_CATALOG).toHaveLength(8)
    for (const entry of STRIPE_CATALOG) {
      const plan = BILLING_PLANS[entry.plan]
      expect(entry.unitAmount).toBe((entry.interval === 'monthly' ? plan.monthlyPriceUsd! : plan.annualPriceUsd!) * 100)
      expect(entry.unitAmount).toBe(entry.interval === 'annual' ? plan.monthlyPriceUsd! * 1000 : plan.monthlyPriceUsd! * 100)
      expect(entry.lookupKey).toBe(`asc_${entry.plan}_${entry.interval}_usd_v1`)
    }
    expect(STRIPE_CATALOG.map(entry => entry.unitAmount)).toEqual([4900, 49000, 9900, 99000, 24900, 249000, 59900, 599000])
  })

  it('adds Indie additively: same catalog version, existing live lookup keys and env names untouched', () => {
    expect(STRIPE_CATALOG_VERSION).toBe('asc-stripe-2026-09-v1')
    const existing = STRIPE_CATALOG.filter(entry => entry.plan !== 'indie')
    expect(existing.map(entry => [entry.lookupKey, entry.priceEnv, entry.optional])).toEqual([
      ['asc_starter_monthly_usd_v1', 'STRIPE_PRICE_STARTER_MONTHLY', false],
      ['asc_starter_annual_usd_v1', 'STRIPE_PRICE_STARTER_ANNUAL', false],
      ['asc_pro_monthly_usd_v1', 'STRIPE_PRICE_PRO_MONTHLY', false],
      ['asc_pro_annual_usd_v1', 'STRIPE_PRICE_PRO_ANNUAL', false],
      ['asc_business_monthly_usd_v1', 'STRIPE_PRICE_BUSINESS_MONTHLY', false],
      ['asc_business_annual_usd_v1', 'STRIPE_PRICE_BUSINESS_ANNUAL', false],
    ])
    expect(STRIPE_CATALOG.filter(entry => entry.plan === 'indie')).toEqual([
      expect.objectContaining({ productName: 'App Listing Agent Indie', lookupKey: 'asc_indie_monthly_usd_v1', unitAmount: 4900, recurringInterval: 'month', priceEnv: 'STRIPE_PRICE_INDIE_MONTHLY', optional: true }),
      expect.objectContaining({ productName: 'App Listing Agent Indie', lookupKey: 'asc_indie_annual_usd_v1', unitAmount: 49000, recurringInterval: 'year', priceEnv: 'STRIPE_PRICE_INDIE_ANNUAL', optional: true }),
    ])
  })
})

describe('Indie price ids are optional (production has none yet)', () => {
  it('keeps the rest of billing working when the Indie ids are missing, and makes only Indie unavailable', () => {
    const env = sandboxEnv()
    const config = stripeBillingConfig(env)
    expect(config).not.toBeNull()
    expect(config!.prices).toHaveLength(6)
    expect(config!.prices.some(price => price.plan === 'indie')).toBe(false)
    expect(isBillingCheckoutEnabled(env)).toBe(true)
    expect(hasPlanPrices(config!, 'indie')).toBe(false)
    expect(isPlanPurchasable(config!, 'indie', { NEXT_PUBLIC_BILLING_INDIE_ENABLED: 'true' })).toBe(false)
    expect(isPlanPurchasable(config!, 'starter', {})).toBe(true)
    expect(() => priceIdFor(config!, 'indie', 'monthly')).toThrow(/not configured/)
    expect(priceIdFor(config!, 'starter', 'annual')).toBe('price_starterannual1')
  })

  it('treats *_PENDING, malformed or half-configured Indie ids as "Indie unavailable", not as a broken config', () => {
    for (const indie of [
      { STRIPE_PRICE_INDIE_MONTHLY: 'INDIE_PRICE_PENDING', STRIPE_PRICE_INDIE_ANNUAL: 'INDIE_PRICE_PENDING' },
      { STRIPE_PRICE_INDIE_MONTHLY: '', STRIPE_PRICE_INDIE_ANNUAL: '' },
      { STRIPE_PRICE_INDIE_MONTHLY: indieIds.STRIPE_PRICE_INDIE_MONTHLY },
      { STRIPE_PRICE_INDIE_MONTHLY: indieIds.STRIPE_PRICE_INDIE_MONTHLY, STRIPE_PRICE_INDIE_ANNUAL: 'INDIE_PRICE_PENDING' },
    ]) {
      const env = { ...sandboxEnv(), ...indie }
      const config = stripeBillingConfig(env)
      expect(config).not.toBeNull()
      expect(hasPlanPrices(config!, 'indie')).toBe(false)
      // A lone Indie price never maps to a plan: half a plan is not sellable or entitling.
      expect(planForPrice(config!, indieIds.STRIPE_PRICE_INDIE_MONTHLY)).toBeNull()
      expect(isBillingCheckoutEnabled(env)).toBe(true)
    }
  })

  it('binds Indie once both ids are set, so checkout and webhooks map its prices to the indie plan', () => {
    const config = stripeBillingConfig({ ...sandboxEnv(), ...indieIds })!
    expect(config.prices).toHaveLength(8)
    expect(hasPlanPrices(config, 'indie')).toBe(true)
    expect(planForPrice(config, 'price_indieannual001')).toEqual({ plan: 'indie', interval: 'annual', priceId: 'price_indieannual001' })
    expect(priceIdFor(config, 'indie', 'monthly')).toBe('price_indiemonthly01')
    // Selling it also needs the display flag; entitlements (planForPrice) never do.
    expect(isPlanPurchasable(config, 'indie', {})).toBe(false)
    expect(isPlanPurchasable(config, 'indie', { NEXT_PUBLIC_BILLING_INDIE_ENABLED: 'true' })).toBe(true)
  })

  it('still fails closed when an Indie id duplicates another plan price', () => {
    expect(stripeBillingConfig({ ...sandboxEnv(), ...indieIds, STRIPE_PRICE_INDIE_MONTHLY: 'price_startermonthly' })).toBeNull()
  })
})

describe('Stripe billing config fails closed', () => {
  it('accepts a complete sandbox configuration with a 7-day trial', () => {
    const config = stripeBillingConfig(sandboxEnv())
    expect(config).toMatchObject({ livemode: false, accountId: SANDBOX_STRIPE_ACCOUNT_ID, trialDays: 7 })
    expect(planForPrice(config!, 'price_proannual00001')).toEqual({ plan: 'pro', interval: 'annual', priceId: 'price_proannual00001' })
    expect(isBillingCheckoutEnabled(sandboxEnv())).toBe(true)
  })

  it('rejects any missing price, portal or webhook secret', () => {
    for (const key of ['STRIPE_PRICE_BUSINESS_ANNUAL', 'STRIPE_PORTAL_CONFIGURATION_ID', 'STRIPE_WEBHOOK_SECRET', 'STRIPE_SECRET_KEY']) {
      const env = sandboxEnv(); delete env[key]
      expect(stripeBillingConfig(env)).toBeNull()
    }
    expect(stripeBillingConfig({ ...sandboxEnv(), STRIPE_PRICE_PRO_ANNUAL: 'LIVE_PRICE_PENDING' })).toBeNull()
    expect(stripeBillingConfig({ ...sandboxEnv(), STRIPE_PRICE_PRO_ANNUAL: 'price_promonthly0001' })).toBeNull()
  })

  it('pins live mode to the live account and the key prefix in both directions', () => {
    expect(stripeBillingConfig({ ...sandboxEnv(), STRIPE_LIVEMODE: 'true' })).toBeNull()
    expect(stripeBillingConfig({ ...sandboxEnv(), STRIPE_ACCOUNT_ID: LIVE_STRIPE_ACCOUNT_ID })).toBeNull()
    expect(stripeBillingConfig({ ...sandboxEnv(), STRIPE_SECRET_KEY: 'sk_live_' + 'a'.repeat(24) })).toBeNull()
    const live = stripeBillingConfig({ ...sandboxEnv(), STRIPE_LIVEMODE: 'true', STRIPE_ACCOUNT_ID: LIVE_STRIPE_ACCOUNT_ID, STRIPE_SECRET_KEY: 'rk_live_' + 'a'.repeat(24) })
    expect(live?.livemode).toBe(true)
  })

  it('keeps checkout off unless the flag and the full config are present', () => {
    expect(isBillingCheckoutEnabled({ ...sandboxEnv(), BILLING_CHECKOUT_ENABLED: 'false' })).toBe(false)
    expect(isBillingCheckoutEnabled({ BILLING_CHECKOUT_ENABLED: 'true' })).toBe(false)
  })
})
