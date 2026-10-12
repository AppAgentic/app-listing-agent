'use client'

import { useEffect, useRef, useState } from 'react'
import { ArrowRight, Check, CreditCard, Loader2, Sparkles } from 'lucide-react'
import {
  BILLING_PLANS,
  offeredBillingPlans,
  type BillingInterval,
  type PublicBillingPlan,
} from '@/lib/billing/catalog'
import { trackEvent } from '@/lib/analytics/client'
import { standardInterval } from '@/lib/analytics/events'
import { readStoredMarketingAttribution } from '@/lib/marketing/attribution'

const PLAN_NOTES: Record<PublicBillingPlan, string> = {
  indie: 'For your first app',
  starter: 'For an independent app builder',
  pro: 'For growing apps and automated workflows',
  business: 'For a team managing an app portfolio',
}

const money = (value: number) =>
  value.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 })

export interface TrialStepProps {
  trialDays: number
  initialPlan?: PublicBillingPlan
  initialInterval?: BillingInterval
  canceled?: boolean
}

/**
 * Onboarding paywall (hard paywall, no free plan): choose a plan and start the free trial in Stripe Checkout
 * (card required). An account that already used its trial sees the same step as a paid checkout.
 */
export function TrialStep({ trialDays, initialPlan, initialInterval, canceled }: TrialStepProps) {
  const [plan, setPlan] = useState<PublicBillingPlan>(
    initialPlan && offeredBillingPlans().includes(initialPlan) ? initialPlan : 'pro'
  )
  const [interval, setInterval] = useState<BillingInterval>(initialInterval ?? 'monthly')
  const [busy, setBusy] = useState<'checkout' | null>(null)
  const hasTrial = trialDays > 0
  const [error, setError] = useState('')
  const viewed = useRef(false)

  useEffect(() => {
    if (viewed.current) return
    viewed.current = true
    trackEvent('paywall_viewed', { props: { placement: 'onboarding' } })
  }, [])

  // Returning from the Stripe back button restores the page from the bfcache.
  useEffect(() => {
    const onPageShow = (event: PageTransitionEvent) => { if (event.persisted) setBusy(null) }
    window.addEventListener('pageshow', onPageShow)
    return () => window.removeEventListener('pageshow', onPageShow)
  }, [])

  const select = (nextPlan: PublicBillingPlan, nextInterval: BillingInterval) => {
    setPlan(nextPlan)
    setInterval(nextInterval)
    const period = standardInterval(nextInterval)
    trackEvent('plan_selected', { props: { plan: nextPlan, placement: 'onboarding', ...(period ? { interval: period } : {}) } })
  }

  const definition = BILLING_PLANS[plan]
  const price = interval === 'annual' ? definition.annualPriceUsd! : definition.monthlyPriceUsd!
  const trialEnd = new Date(Date.now() + trialDays * 86_400_000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

  const startTrial = async () => {
    if (busy) return
    setBusy('checkout')
    setError('')
    const period = standardInterval(interval)
    trackEvent('checkout_started', { props: { kind: 'subscription', plan, ...(period ? { interval: period } : {}) } })
    try {
      let attribution
      try { attribution = readStoredMarketingAttribution(window.localStorage) } catch { /* storage disabled */ }
      const response = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan, interval, attribution, placement: 'onboarding' }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        if (data.code === 'existing_subscription') {
          window.location.assign('/billing')
          return
        }
        throw new Error(data.error || 'We couldn’t open checkout. Please try again.')
      }
      const destination = new URL(data.purchaseUrl)
      if (destination.protocol !== 'https:' || destination.hostname !== 'checkout.stripe.com' ||
          destination.username || destination.password || destination.port) {
        throw new Error('We couldn’t open checkout. Please try again.')
      }
      window.location.assign(destination.href)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'We couldn’t open checkout. Please try again.')
      setBusy(null)
    }
  }

  return (
    <div data-testid="onboarding-trial-step">
      <div className="w-12 h-12 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center mx-auto mb-6">
        <Sparkles className="w-6 h-6 text-purple-400" />
      </div>
      <h1 className="text-2xl font-bold text-white text-center mb-2">{hasTrial ? `Start your ${trialDays}-day free trial` : 'Choose your plan'}</h1>
      <p className="text-neutral-400 text-center mb-6">
        {hasTrial
          ? `App Listing Agent needs a plan to connect your agent and stores. Full access for ${trialDays} days; cancel before ${trialEnd} and you won’t be charged.`
          : 'App Listing Agent needs an active plan to connect your agent and stores. Your free trial has already been used.'}
      </p>

      {canceled && (
        <div role="status" className="mb-5 p-3 rounded-xl border border-white/10 bg-white/[0.03] text-sm text-neutral-300">
          Checkout was closed and nothing was charged. Pick a plan to continue.
        </div>
      )}

      <div className="flex justify-center mb-5">
        <div className="inline-flex rounded-lg border border-white/10 bg-black p-1" role="radiogroup" aria-label="Billing frequency">
          {(['monthly', 'annual'] as const).map(value => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={interval === value}
              disabled={busy !== null}
              onClick={() => select(plan, value)}
              className={`min-h-10 rounded-md px-4 text-sm transition-colors ${interval === value ? 'bg-white text-black font-semibold' : 'text-neutral-300 hover:bg-white/10'}`}
            >
              {value === 'monthly' ? 'Monthly' : 'Annual · 2 months free'}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-3" role="radiogroup" aria-label="Plan">
        {offeredBillingPlans().map(id => {
          const option = BILLING_PLANS[id]
          const monthly = interval === 'annual' ? option.annualPriceUsd! / 12 : option.monthlyPriceUsd!
          const selected = plan === id
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={busy !== null}
              onClick={() => select(id, interval)}
              className={`w-full text-left rounded-xl border p-4 transition-colors ${selected ? 'border-purple-400 bg-purple-500/10' : 'border-white/10 bg-white/[0.02] hover:border-white/25'}`}
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-semibold text-white">{option.name}{id === 'pro' && <span className="ml-2 text-[10px] uppercase tracking-widest text-purple-300">Most popular</span>}</p>
                  <p className="text-xs text-neutral-400 mt-0.5">{PLAN_NOTES[id]}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-white font-semibold tabular-nums">{money(monthly)}<span className="text-xs text-neutral-400 font-normal"> /mo</span></p>
                  <p className="text-[11px] text-neutral-500">{option.limits.apps === -1 ? 'Unlimited' : option.limits.apps} {option.limits.apps === 1 ? 'app' : 'apps'} · {option.limits.screenshots} screenshots/mo</p>
                </div>
                <span aria-hidden="true" className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${selected ? 'border-purple-400 bg-purple-500' : 'border-neutral-600'}`}>
                  {selected && <Check className="h-3.5 w-3.5 text-white" />}
                </span>
              </div>
            </button>
          )
        })}
      </div>

      <button
        type="button"
        onClick={() => void startTrial()}
        disabled={busy !== null}
        className="mt-6 w-full flex items-center justify-center gap-2 px-4 py-3 bg-purple-600 text-white rounded-xl font-medium hover:bg-purple-700 disabled:opacity-60"
      >
        {busy === 'checkout' ? <Loader2 className="w-4 h-4 animate-spin" /> : <CreditCard className="w-4 h-4" />}
        {busy === 'checkout' ? 'Opening secure checkout…' : hasTrial ? `Start ${trialDays}-day free trial` : 'Continue to secure checkout'}
        {busy !== 'checkout' && <ArrowRight className="w-4 h-4" />}
      </button>
      <p className="mt-3 text-center text-xs leading-5 text-neutral-500">
        {hasTrial ? `Free for ${trialDays} days, then ` : ''}{money(price)} {interval === 'annual' ? 'per year' : 'per month'} plus any applicable tax.
        {hasTrial ? ' Card required.' : ''} Secure checkout by Stripe; sold through Onelink, our merchant of record.
      </p>

      {error && <div role="alert" className="mt-5 p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm">{error}</div>}
    </div>
  )
}
