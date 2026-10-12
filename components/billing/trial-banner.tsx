'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { BILLING_PLANS, normalizeUserPlan } from '@/lib/billing/catalog'

interface TrialState { plan: string; trialEndsAt: string; cancelAtPeriodEnd: boolean; pastDue?: boolean }
const CACHE_KEY = 'asc.trial-banner.v1'
const CACHE_MS = 5 * 60 * 1000

/**
 * In-app trial reminder. Stripe/Onelink only sends its own "trial ending" email for trials longer than
 * 7 days, so the workspace shows when the trial ends and that the card is charged then.
 */
export function TrialBanner() {
  const [trial, setTrial] = useState<TrialState | null>(null)

  useEffect(() => {
    let cancelled = false
    try {
      const cached = JSON.parse(window.sessionStorage.getItem(CACHE_KEY) || 'null')
      if (cached && Date.now() - cached.at < CACHE_MS) {
        setTrial(cached.trial)
        return
      }
    } catch { /* storage unavailable */ }
    fetch('/api/subscription', { cache: 'no-store' })
      .then(response => (response.ok ? response.json() : null))
      .then(data => {
        if (cancelled) return
        const next = data?.status === 'trialing' && typeof data.trialEndsAt === 'string'
          ? { plan: data.plan, trialEndsAt: data.trialEndsAt, cancelAtPeriodEnd: data.cancelAtPeriodEnd === true }
          : data?.status === 'past_due'
            ? { plan: data.plan, trialEndsAt: '', cancelAtPeriodEnd: false, pastDue: true }
            : null
        setTrial(next)
        try { window.sessionStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), trial: next })) } catch { /* ignore */ }
      })
      .catch(() => undefined)
    return () => { cancelled = true }
  }, [])

  if (trial?.pastDue) {
    return (
      <div role="alert" className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-800 bg-amber-950/30 px-4 py-3 text-sm text-amber-100">
        <p>Your last payment failed. Access continues while we retry; update your payment method to keep your workspace.</p>
        <Link href="/billing?reason=payment_failed" className="font-semibold text-amber-200 underline underline-offset-4">Fix payment</Link>
      </div>
    )
  }
  if (!trial || Number.isNaN(Date.parse(trial.trialEndsAt))) return null
  const ends = new Date(trial.trialEndsAt)
  const days = Math.max(0, Math.ceil((ends.getTime() - Date.now()) / 86_400_000))
  const date = ends.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const name = BILLING_PLANS[normalizeUserPlan(trial.plan)].name

  return (
    <div role="status" className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-violet-800 bg-violet-950/30 px-4 py-3 text-sm text-neutral-200">
      <p>
        {trial.cancelAtPeriodEnd
          ? `Your ${name} trial ends ${date} and won’t renew. You won’t be charged.`
          : `Your ${name} free trial ends ${days <= 1 ? 'within a day' : `in ${days} days`} (${date}). Your card is charged then unless you cancel.`}
      </p>
      <Link href="/billing" className="font-semibold text-violet-300 underline underline-offset-4 hover:text-violet-200">
        Manage billing
      </Link>
    </div>
  )
}
