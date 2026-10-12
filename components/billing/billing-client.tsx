'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { BillingPanel, type SelectablePlan } from './billing-panel'
import type {
  ActivationState,
  BillingSubscription,
  BillingUsage,
} from './types'
import { readPurchaseIntent } from '@/lib/billing/intent'
import { normalizeUserPlan } from '@/lib/billing/catalog'
import { readStoredMarketingAttribution } from '@/lib/marketing/attribution'
import type { BillingInterval } from '@/lib/billing/catalog'
import { trackEvent } from '@/lib/analytics/client'
import { standardInterval } from '@/lib/analytics/events'

const CHECKOUT_ENABLED =
  process.env.NEXT_PUBLIC_BILLING_CHECKOUT_ENABLED === 'true'
const POLL_INTERVAL_MS = 2500
const ACTIVATION_WAIT_MS = 60000

/** A redirect is presentation only. Paid access always comes from the subscription API. */
export function isActivationConfirmed(
  sub: BillingSubscription,
  expectedPlan?: string,
  expectedInterval?: BillingInterval,
): boolean {
  return (
    !!sub.subscriptionId &&
    (sub.status === 'active' || sub.status === 'trialing') &&
    sub.plan !== 'free' &&
    (!expectedPlan || sub.plan === expectedPlan) &&
    (!expectedInterval || sub.billingInterval === expectedInterval)
  )
}

async function readJson(url: string, init?: RequestInit) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 12000)
  try {
    const response = await fetch(url, {
      ...init,
      cache: 'no-store',
      signal: controller.signal,
    })
    const data = await response.json()
    if (!response.ok) {
      const error = new Error(
        data.error || 'We couldn’t load billing. Please try again.',
      ) as Error & { status?: number; code?: string }
      error.status = response.status
      error.code = data.code
      throw error
    }
    return data
  } finally {
    clearTimeout(timeout)
  }
}

export function BillingLoading() {
  return (
    <div role="status" aria-label="Loading billing" className="space-y-6">
      <div className="h-12 w-56 animate-pulse rounded-lg bg-neutral-900" />
      <div className="h-32 animate-pulse rounded-xl bg-neutral-900" />
      <div className="grid gap-4 md:grid-cols-3">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-80 animate-pulse rounded-xl bg-neutral-900"
          />
        ))}
      </div>
      <span className="sr-only">Loading your plan and usage…</span>
    </div>
  )
}

export default function BillingClient() {
  const params = useSearchParams()
  const query = params.toString()
  const intent = readPurchaseIntent(params)
  const returning = params.get('checkout') === 'complete'
  const [selectedPlan, setSelectedPlan] = useState<SelectablePlan>(
    intent?.plan || 'pro',
  )
  const [interval, setInterval] = useState<BillingInterval>(
    intent?.interval || 'monthly',
  )
  const [subscription, setSubscription] = useState<BillingSubscription | null>(
    null,
  )
  const [usage, setUsage] = useState<BillingUsage | null>(null)
  const [usageError, setUsageError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [sessionExpired, setSessionExpired] = useState(false)
  const [activation, setActivation] = useState<ActivationState>(
    returning ? 'pending' : 'none',
  )
  const [busy, setBusy] = useState<'checkout' | 'manage' | null>(null)
  const mounted = useRef(true)
  const inFlight = useRef(false)
  const actionInFlight = useRef(false)
  const selectionChanged = useRef(false)
  const deadline = useRef(Date.now() + ACTIVATION_WAIT_MS)
  const returningRef = useRef(returning)
  const expectedPlan = useRef(intent?.plan)
  const expectedInterval = useRef(intent?.interval)
  const signedOut = useRef(false)
  const paywallTracked = useRef(false)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  useEffect(() => {
    const nextIntent = readPurchaseIntent(new URLSearchParams(query))
    if (nextIntent) {
      setSelectedPlan(nextIntent.plan)
      setInterval(nextIntent.interval)
      selectionChanged.current = true
    }
    returningRef.current = returning
    expectedPlan.current = nextIntent?.plan
    expectedInterval.current = nextIntent?.interval
    deadline.current = Date.now() + ACTIVATION_WAIT_MS
    setActivation(returning ? 'pending' : 'none')
  }, [query, returning])

  const refresh = useCallback(async () => {
    if (inFlight.current || signedOut.current) return
    inFlight.current = true
    if (mounted.current) setRefreshing(true)
    try {
      const [subResult, usageResult] = await Promise.allSettled([
        readJson('/api/subscription'),
        readJson('/api/usage'),
      ])
      if (!mounted.current) return
      if (subResult.status === 'rejected') throw subResult.reason
      const sub = {
        ...subResult.value,
        plan: normalizeUserPlan(subResult.value.plan),
      } as BillingSubscription
      setSubscription(sub)
      setError(null)
      if (!paywallTracked.current && sub.plan === 'free' && !returningRef.current) {
        paywallTracked.current = true
        trackEvent('paywall_viewed', { props: { placement: 'billing' } })
      }
      if (!selectionChanged.current) {
        setSelectedPlan(sub.plan === 'free' ? 'pro' : sub.plan)
        if (sub.billingInterval) setInterval(sub.billingInterval)
        selectionChanged.current = true
      }
      if (usageResult.status === 'fulfilled') {
        setUsage(usageResult.value)
        setUsageError(null)
      } else
        setUsageError(
          'We couldn’t refresh your usage. Your subscription is available.',
        )
      if (returningRef.current) {
        setActivation(
          isActivationConfirmed(
            sub,
            expectedPlan.current,
            expectedInterval.current,
          )
            ? 'confirmed'
            : Date.now() >= deadline.current
              ? 'delayed'
              : 'pending',
        )
      }
    } catch (failure) {
      if (!mounted.current) return
      setSubscription(null)
      const status = (failure as { status?: number }).status
      if (status === 401) {
        signedOut.current = true
        setSessionExpired(true)
        setError('Your session has expired. Sign in again to view billing.')
      } else
        setError(
          'We couldn’t refresh your subscription. Please try again before making a billing change.',
        )
      if (returningRef.current && Date.now() >= deadline.current)
        setActivation('delayed')
    } finally {
      inFlight.current = false
      if (mounted.current) {
        setRefreshing(false)
        setLoaded(true)
      }
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (activation !== 'pending') return
    const timer = window.setInterval(() => {
      void refresh()
    }, POLL_INTERVAL_MS)
    const stop = window.setTimeout(
      () => setActivation((state) => (state === 'pending' ? 'delayed' : state)),
      Math.max(0, deadline.current - Date.now()),
    )
    return () => {
      window.clearInterval(timer)
      window.clearTimeout(stop)
    }
  }, [activation, refresh])

  useEffect(() => {
    const onFocus = () => {
      if (document.visibilityState === 'visible') void refresh()
    }
    const onPageShow = (event: PageTransitionEvent) => {
      if (!event.persisted) return
      actionInFlight.current = false
      setBusy(null)
      void refresh()
    }
    window.addEventListener('focus', onFocus)
    window.addEventListener('pageshow', onPageShow)
    document.addEventListener('visibilitychange', onFocus)
    return () => {
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('pageshow', onPageShow)
      document.removeEventListener('visibilitychange', onFocus)
    }
  }, [refresh])

  const startAction = async (action: 'checkout' | 'manage') => {
    if (actionInFlight.current || signedOut.current || !subscription) return
    if (
      action === 'checkout' &&
      (returningRef.current ||
        subscription.hasExistingSubscription ||
        subscription.plan !== 'free' ||
        !CHECKOUT_ENABLED ||
        selectedPlan === 'enterprise')
    )
      return
    actionInFlight.current = true
    setBusy(action)
    setError(null)
    if (action === 'checkout' && selectedPlan !== 'enterprise') {
      const period = standardInterval(interval)
      trackEvent('checkout_started', {
        props: { kind: 'subscription', plan: selectedPlan, ...(period ? { interval: period } : {}) },
      })
    }
    try {
      let attribution
      try {
        attribution = readStoredMarketingAttribution(window.localStorage)
      } catch {
        /* Storage may be disabled. Billing must still work. */
      }
      const result = await readJson(
        action === 'checkout' ? '/api/billing/checkout' : '/api/billing/manage',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          ...(action === 'checkout'
            ? {
                body: JSON.stringify({
                  plan: selectedPlan,
                  interval,
                  attribution,
                }),
              }
            : {}),
        },
      )
      const destination = new URL(
        action === 'checkout' ? result.purchaseUrl : result.manageUrl,
      )
      // Payment and subscription management only ever happen on Stripe-hosted pages.
      const expectedHost =
        action === 'checkout' ? 'checkout.stripe.com' : 'billing.stripe.com'
      if (
        destination.protocol !== 'https:' ||
        destination.hostname !== expectedHost ||
        destination.username ||
        destination.password ||
        destination.port
      )
        throw new Error('Invalid billing destination')
      window.location.assign(destination.href)
    } catch (failure) {
      const issue = failure as { code?: string; status?: number }
      if (issue.code === 'existing_subscription') {
        await refresh()
        setError(
          'You already have a subscription. Use Manage subscription to review it.',
        )
      } else if (issue.code === 'checkout_pending') {
        setError(
          'A checkout is already being prepared. Wait a moment, then try again; we’ll reuse it when available.',
        )
      } else if (issue.status === 401) {
        signedOut.current = true
        setSessionExpired(true)
        setError('Your session has expired. Sign in again before continuing.')
      } else if (issue.status === 403)
        setError(
          'Only the workspace owner can change billing. Ask them to review this plan.',
        )
      else
        setError(
          action === 'checkout'
            ? 'We couldn’t open checkout. Your selection is saved. Please try again, or contact billing support.'
            : 'We couldn’t open subscription management. Please try again, or contact billing support.',
        )
      actionInFlight.current = false
      setBusy(null)
    }
  }

  const saveSelection = (plan: SelectablePlan, frequency: BillingInterval) => {
    selectionChanged.current = true
    const period = standardInterval(frequency)
    trackEvent('plan_selected', { props: { plan, placement: 'billing', ...(period ? { interval: period } : {}) } })
    setSelectedPlan(plan)
    setInterval(frequency)
    const next = new URL(window.location.href)
    next.searchParams.set('plan', plan)
    next.searchParams.set('interval', frequency)
    // Once confirmed, comparing a new plan must not restart payment confirmation.
    if (activation === 'confirmed') next.searchParams.delete('checkout')
    window.history.replaceState(null, '', `${next.pathname}${next.search}`)
  }

  const retry = () => {
    if (signedOut.current) return
    setError(null)
    void refresh()
  }

  if (!loaded) return <BillingLoading />
  if (!subscription || sessionExpired)
    return (
      <section className="mx-auto max-w-xl py-16">
        <h1 className="text-3xl font-semibold text-white">Plans & billing</h1>
        <p role="alert" className="mt-4 leading-7 text-neutral-300">
          {error || 'We couldn’t load your subscription.'}
        </p>
        {sessionExpired ? (
          <a
            className="mt-6 inline-flex rounded-lg bg-violet-600 px-5 py-3 font-semibold text-white"
            href={`/login?returnTo=${encodeURIComponent(`/billing${query ? `?${query}` : ''}`)}`}
          >
            Sign in to continue
          </a>
        ) : (
          <button
            disabled={refreshing}
            onClick={retry}
            className="mt-6 rounded-lg bg-violet-600 px-5 py-3 font-semibold text-white disabled:opacity-50"
          >
            {refreshing ? 'Checking…' : 'Try again'}
          </button>
        )}
      </section>
    )

  return (
    <BillingPanel
      subscription={subscription}
      usage={usage}
      usageError={usageError}
      selectedPlan={selectedPlan}
      interval={interval}
      reason={params.get('reason')}
      activation={activation}
      busy={busy}
      refreshing={refreshing}
      error={error}
      checkoutEnabled={CHECKOUT_ENABLED}
      onPlan={(plan) => saveSelection(plan, interval)}
      onInterval={(value) => saveSelection(selectedPlan, value)}
      onCheckout={() => void startAction('checkout')}
      onManage={() => void startAction('manage')}
      onRefresh={retry}
    />
  )
}
