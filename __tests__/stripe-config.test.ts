import { describe, expect, it } from 'vitest'
import { LIVE_STRIPE_ACCOUNT_ID, SANDBOX_STRIPE_ACCOUNT_ID, isBillingCheckoutEnabled, planForPrice, stripeBillingConfig } from '@/lib/stripe/config'
import { STRIPE_CATALOG } from '@/lib/stripe/catalog'
import { BILLING_PLANS } from '@/lib/billing/catalog'
import { sandboxEnv } from './helpers/stripe-fixtures'

describe('Stripe catalog in code', () => {
  it('has all six USD plan prices at the public amounts, annual at 10x', () => {
    expect(STRIPE_CATALOG).toHaveLength(6)
    for (const entry of STRIPE_CATALOG) {
      const plan = BILLING_PLANS[entry.plan]
      expect(entry.unitAmount).toBe((entry.interval === 'monthly' ? plan.monthlyPriceUsd! : plan.annualPriceUsd!) * 100)
      expect(entry.lookupKey).toBe(`asc_${entry.plan}_${entry.interval}_usd_v1`)
    }
    expect(STRIPE_CATALOG.map(entry => entry.unitAmount)).toEqual([9900, 99000, 24900, 249000, 59900, 599000])
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
