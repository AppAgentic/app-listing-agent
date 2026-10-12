'use client'

import { SupportButton } from '@/components/support/gleap-support'

import {
  ArrowRight,
  Check,
  ExternalLink,
  Loader2,
  RefreshCw,
} from 'lucide-react'
import {
  BILLING_PLANS,
  PUBLIC_BILLING_PLANS,
  TRIAL_PERIOD_DAYS,
  isPublicBillingPlan,
  offeredBillingPlans,
  type BillingInterval,
  type PublicBillingPlan,
  type UserPlan,
} from '@/lib/billing/catalog'
import { canUseScopedApiKeys } from '@/lib/billing/feature-access'
import type {
  ActivationState,
  BillingSubscription,
  BillingUsage,
} from './types'

export type SelectablePlan = Exclude<UserPlan, 'free'>
/**
 * Self-serve plans shown on the billing page: the ones this deployment offers (Indie only once its Stripe prices are
 * live), plus the workspace's current plan if it is no longer offered so it still reads as "Your current plan".
 */
function visiblePlans(currentPlan: UserPlan): PublicBillingPlan[] {
  const offered = offeredBillingPlans()
  return PUBLIC_BILLING_PLANS.filter(plan => offered.includes(plan) || plan === currentPlan)
}
const planDescriptions: Record<SelectablePlan, string> = {
  indie: 'For your first app.',
  starter: 'For an independent app builder.',
  pro: 'For growing apps and automated workflows.',
  business: 'For a team managing an app portfolio.',
  enterprise: 'Custom scale, limits, and onboarding.',
}
const focus =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 focus-visible:ring-offset-4 focus-visible:ring-offset-neutral-950'
const button = `inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${focus}`
const primary = `${button} bg-violet-600 text-white hover:bg-violet-500`
const secondary = `${button} border border-neutral-700 bg-neutral-900 text-neutral-100 hover:bg-neutral-800`
const number = (value: number) =>
  value === -1 ? 'Unlimited' : value.toLocaleString('en-US')
const money = (value: number) =>
  value.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  })

export interface BillingPanelProps {
  subscription: BillingSubscription
  usage: BillingUsage | null
  usageError?: string | null
  selectedPlan: SelectablePlan
  interval: BillingInterval
  reason?: string | null
  activation: ActivationState
  busy: 'checkout' | 'manage' | null
  refreshing: boolean
  error: string | null
  checkoutEnabled: boolean
  onPlan: (plan: SelectablePlan) => void
  onInterval: (interval: BillingInterval) => void
  onCheckout: () => void
  onManage: () => void
  onRefresh: () => void
}

export function BillingPanel(props: BillingPanelProps) {
  const {
    subscription: sub,
    usage,
    selectedPlan,
    interval,
    activation,
    busy,
  } = props
  const current = BILLING_PLANS[sub.plan] || BILLING_PLANS.free
  const selected = BILLING_PLANS[selectedPlan]
  const isExisting = sub.hasExistingSubscription || sub.plan !== 'free'
  const requiresRecovery =
    sub.status === 'past_due' || sub.status === 'incomplete' || sub.status === 'unresolved'
  const awaitingActivation =
    activation === 'pending' || activation === 'delayed'
  const isAssisted = selectedPlan === 'enterprise'
  const trialDays = sub.trialDays || TRIAL_PERIOD_DAYS
  const offersTrial = !isExisting && sub.trialEligible === true
  const formatDate = (value: string | null | undefined) =>
    value && !Number.isNaN(Date.parse(value))
      ? new Date(value).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        })
      : null
  const trialEnds = sub.status === 'trialing' ? formatDate(sub.trialEndsAt) : null
  const total =
    interval === 'annual' ? selected.annualPriceUsd : selected.monthlyPriceUsd
  const date = formatDate(sub.renewsAt)
  const currentPrice =
    isPublicBillingPlan(sub.plan)
      ? sub.billingInterval === 'annual'
        ? `${money(current.annualPriceUsd!)} per year`
        : `${money(current.monthlyPriceUsd!)} per month`
      : null
  const currentSelection =
    selectedPlan === sub.plan &&
    (!sub.billingInterval || interval === sub.billingInterval)
  const reasonCopy =
    props.reason === 'subscription_required'
      ? sub.canManageBilling
        ? 'App Listing Agent needs an active plan for your agent, stores and dashboard. Start with a free trial.'
        : 'This workspace needs an active plan. Ask the workspace owner to start or renew the subscription.'
      : props.reason === 'payment_failed'
        ? 'Update your payment method in the billing portal to restore access.'
        : props.reason === 'api_keys'
      ? 'Connect your agent with scoped API keys on Pro or Studio.'
      : props.reason === 'team' || props.reason === 'team_limit'
        ? 'Collaborate with up to five people on Studio, or discuss a larger team with us.'
        : props.reason === 'usage'
          ? 'Choose more room for the work you’re doing. Your existing projects stay with you.'
          : null
  const planCards = visiblePlans(sub.plan)
  const manageLabel = requiresRecovery
    ? 'Update payment method'
    : 'Manage subscription'

  return (
    <div className="mx-auto max-w-6xl space-y-8 pb-32 text-neutral-100 md:pb-12">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-neutral-800 pb-6">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-violet-300">
            Your workspace
          </p>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            Plans & billing
          </h1>
          <p className="mt-3 max-w-xl text-sm leading-6 text-neutral-400">
            Make room for your next launch. Clear allowances, with no automatic
            usage charges.
          </p>
        </div>
        <SupportButton
          subject="Billing help"
          className={`${secondary} shrink-0`}
        >
          Get billing help
        </SupportButton>
      </header>

      {activation !== 'none' && (
        <section
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className={`rounded-xl border p-5 ${activation === 'confirmed' ? 'border-emerald-800 bg-emerald-950/30' : 'border-violet-800 bg-violet-950/30'}`}
        >
          <div className="flex items-start gap-3">
            {activation === 'pending' ? (
              <Loader2
                aria-hidden="true"
                className="mt-0.5 h-5 w-5 shrink-0 animate-spin text-violet-300"
              />
            ) : activation === 'confirmed' ? (
              <Check
                aria-hidden="true"
                className="mt-0.5 h-5 w-5 shrink-0 text-emerald-300"
              />
            ) : null}
            <div>
              <h2 className="font-semibold">
                {activation === 'confirmed'
                  ? sub.status === 'trialing'
                    ? `Your ${current.name} trial has started`
                    : `${current.name} is ready to use`
                  : activation === 'pending'
                    ? 'Confirming your subscription'
                    : 'Your subscription is taking longer to confirm'}
              </h2>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-neutral-300">
                {activation === 'confirmed'
                  ? 'Your plan and allowances have updated. Continue where you left off.'
                  : activation === 'pending'
                    ? 'We’re checking for payment confirmation. You can keep this page open; your plan will update automatically.'
                    : 'We haven’t confirmed paid access yet. Check again or contact billing support before starting another checkout.'}
              </p>
              {activation === 'confirmed' ? (
                <a className={`${primary} mt-4`} href="/dashboard">
                  Continue to workspace{' '}
                  <ArrowRight aria-hidden="true" className="h-4 w-4" />
                </a>
              ) : activation === 'delayed' ? (
                <button
                  className={`${secondary} mt-4`}
                  disabled={props.refreshing}
                  onClick={props.onRefresh}
                >
                  Check payment status
                </button>
              ) : null}
            </div>
          </div>
        </section>
      )}

      {props.error && (
        <div
          role="alert"
          className="rounded-xl border border-red-900 bg-red-950/30 p-4 text-sm leading-6 text-red-200"
        >
          {props.error}
        </div>
      )}

      <section
        aria-labelledby="current-plan-heading"
        className="flex flex-wrap items-center justify-between gap-5 rounded-xl border border-neutral-800 bg-neutral-900/50 p-5 sm:p-6"
      >
        <div>
          <h2 id="current-plan-heading" className="text-sm text-neutral-400">
            Current plan
          </h2>
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <p className="text-2xl font-semibold tracking-tight">
              {current.name}
            </p>
            <span
              className={`rounded-md px-2 py-1 text-xs font-medium ${requiresRecovery ? 'bg-amber-950 text-amber-200' : 'bg-neutral-800 text-neutral-300'}`}
            >
              {requiresRecovery
                ? 'Payment needs attention'
                : sub.cancelAtPeriodEnd
                  ? 'Cancels at period end'
                  : sub.status === 'trialing'
                    ? trialEnds
                      ? `Free trial · ends ${trialEnds}`
                      : 'Free trial'
                    : sub.plan === 'free'
                      ? 'No active plan'
                      : sub.status === 'active'
                        ? 'Active'
                        : sub.status === 'cancelled'
                          ? 'Subscription ended'
                          : 'Subscription status unavailable'}
            </span>
          </div>
          <p className="mt-2 text-sm leading-6 text-neutral-400">
            {requiresRecovery
              ? sub.status === 'past_due'
                ? 'Your last payment failed. Access continues while Stripe retries; update your payment method to keep it.'
                : 'Update your payment method to restore access to your workspace.'
              : sub.cancelAtPeriodEnd
                ? sub.status === 'trialing'
                  ? `Your trial continues${trialEnds ? ` until ${trialEnds}` : ''}. You won’t be charged.`
                  : `Paid access continues${date ? ` until ${date}` : ' until the end of your billing period'}.`
                : sub.status === 'trialing'
                  ? `Your card will be charged${currentPrice ? ` ${currentPrice}` : ''}${trialEnds ? ` on ${trialEnds}` : ' when the trial ends'} unless you cancel before then.`
                  : sub.plan === 'free'
                  ? 'App Listing Agent needs an active plan. Start with a free trial on any plan.'
                  : `${sub.billingInterval === 'annual' ? 'Billed annually' : sub.billingInterval === 'monthly' ? 'Billed monthly' : 'Your current subscription'}${date ? ` · Renews ${date}` : ''}`}
          </p>
        </div>
        {isExisting && sub.canManageBilling && sub.canOpenPortal !== false && (
          <button
            className={requiresRecovery ? primary : secondary}
            disabled={busy !== null}
            onClick={props.onManage}
          >
            {busy === 'manage' ? (
              <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
            ) : (
              <ExternalLink aria-hidden="true" className="h-4 w-4" />
            )}
            {busy === 'manage' ? 'Opening billing…' : manageLabel}
          </button>
        )}
        {!sub.canManageBilling && (
          <p className="max-w-xs text-sm leading-6 text-neutral-400">
            Only the workspace owner can change billing. Ask them to review the
            plan with you.
          </p>
        )}
      </section>

      <section aria-labelledby="plans-heading" className="space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-5">
          <div>
            <h2
              id="plans-heading"
              className="text-xl font-semibold tracking-tight"
            >
              {isExisting ? 'Compare your next plan' : 'Choose your plan'}
            </h2>
            <p className="mt-2 max-w-xl text-sm leading-6 text-neutral-400">
              {reasonCopy ||
                'Every plan includes store tools, screenshots, translations, and app icons.'}
            </p>
          </div>
          <fieldset className="shrink-0">
            <legend className="sr-only">Billing frequency</legend>
            <div className="inline-flex rounded-lg border border-neutral-700 bg-neutral-950 p-1">
              {(['monthly', 'annual'] as const).map((value) => (
                <label
                  key={value}
                  className={`relative flex min-h-10 cursor-pointer items-center gap-2 rounded-md px-3 text-sm transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-violet-400 ${interval === value ? 'bg-neutral-100 font-semibold text-neutral-950' : 'text-neutral-300 hover:bg-neutral-800'}`}
                >
                  <input
                    type="radio"
                    disabled={busy !== null || awaitingActivation}
                    name="billing-frequency"
                    className="sr-only"
                    checked={interval === value}
                    onChange={() => props.onInterval(value)}
                  />
                  {value === 'monthly' ? 'Monthly' : 'Annual'}
                  {value === 'annual' && (
                    <span
                      className={
                        interval === 'annual'
                          ? 'text-xs text-violet-800'
                          : 'text-xs text-violet-300'
                      }
                    >
                      2 months free
                    </span>
                  )}
                </label>
              ))}
            </div>
          </fieldset>
        </div>

        <fieldset>
          <legend className="sr-only">Available plans</legend>
          <div className={`grid gap-3 ${planCards.length > 3 ? 'md:grid-cols-2 xl:grid-cols-4' : 'md:grid-cols-3'}`}>
            {planCards.map((id) => {
              const plan = BILLING_PLANS[id]
              const price =
                interval === 'annual'
                  ? plan.annualPriceUsd! / 12
                  : plan.monthlyPriceUsd!
              return (
                <label
                  key={id}
                  className={`relative flex cursor-pointer flex-col rounded-xl border p-5 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-violet-400 ${selectedPlan === id ? 'border-violet-500 bg-violet-950/20' : 'border-neutral-800 bg-neutral-950 hover:border-neutral-600'}`}
                >
                  <input
                    type="radio"
                    disabled={busy !== null || awaitingActivation}
                    name="billing-plan"
                    value={id}
                    className="sr-only"
                    checked={selectedPlan === id}
                    onChange={() => props.onPlan(id)}
                  />
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="font-semibold">{plan.name}</h3>
                    <span
                      aria-hidden="true"
                      className={`flex h-5 w-5 items-center justify-center rounded-full border ${selectedPlan === id ? 'border-violet-500 bg-violet-600' : 'border-neutral-600'}`}
                    >
                      {selectedPlan === id && <Check className="h-3.5 w-3.5" />}
                    </span>
                  </div>
                  <p className="mt-4 tabular-nums">
                    <span className="text-3xl font-semibold tracking-tight">
                      {money(price)}
                    </span>
                    <span className="text-sm text-neutral-400"> / month</span>
                  </p>
                  <p className="mt-1 min-h-5 text-xs leading-5 text-neutral-400">
                    {interval === 'annual'
                      ? `${money(plan.annualPriceUsd!)} billed annually`
                      : `${money(plan.monthlyPriceUsd!)} billed monthly`}
                  </p>
                  <p className="mb-5 mt-4 min-h-10 text-sm leading-5 text-neutral-400">
                    {planDescriptions[id]}
                  </p>
                  <ul className="space-y-2.5 border-t border-neutral-800 pt-5 text-sm text-neutral-300">
                    <li>
                      <strong className="font-medium text-white">
                        {number(plan.limits.apps)}
                      </strong>{' '}
                      {plan.limits.apps === 1 ? 'app' : 'apps'}
                    </li>
                    <li>
                      {number(plan.limits.translations)} translations / month
                    </li>
                    <li>
                      {number(plan.limits.screenshots)} screenshot credits /
                      month
                    </li>
                    <li>{number(plan.limits.icons)} icon credits / month</li>
                    <li>
                      {number(plan.limits.teamMembers)}{' '}
                      {plan.limits.teamMembers === 1
                        ? 'workspace member'
                        : 'workspace members'}
                    </li>
                    <li>
                      {canUseScopedApiKeys(id)
                        ? 'Scoped API keys for your agent'
                        : 'Scoped API keys on Pro and above'}
                    </li>
                  </ul>
                  <p className="mt-5 text-xs font-medium text-violet-300">
                    {id === sub.plan
                      ? 'Your current plan'
                      : selectedPlan === id
                          ? 'Selected'
                          : `Select ${plan.name}`}
                  </p>
                </label>
              )
            })}
          </div>
        </fieldset>

        <label
          className={`flex cursor-pointer flex-wrap items-center justify-between gap-3 rounded-xl border p-5 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-violet-400 ${selectedPlan === 'enterprise' ? 'border-violet-500 bg-violet-950/20' : 'border-neutral-800 bg-neutral-950'}`}
        >
          <input
            className="sr-only"
            type="radio"
            disabled={busy !== null || awaitingActivation}
            name="billing-plan"
            checked={selectedPlan === 'enterprise'}
            onChange={() => props.onPlan('enterprise')}
          />
          <span>
            <span className="font-semibold">Enterprise</span>
            <span className="ml-3 text-sm text-neutral-400">
              {planDescriptions.enterprise}
            </span>
          </span>
          <span className="text-sm font-medium text-violet-300">
            {selectedPlan === 'enterprise'
              ? 'Selected'
              : 'Discuss a custom plan'}{' '}
            <span aria-hidden="true">→</span>
          </span>
        </label>

        <div
          id="billing-selection"
          tabIndex={-1}
          className="scroll-mt-6 rounded-xl border border-neutral-700 bg-neutral-900 p-5 sm:p-6"
        >
          <div className="flex flex-wrap items-center justify-between gap-5">
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-neutral-400">
                {isExisting ? 'Subscription changes' : 'Your selection'}
              </p>
              <h3 className="mt-2 text-lg font-semibold">
                {selected.name}
                {selectedPlan !== 'enterprise' &&
                  ` · ${interval === 'annual' ? 'Annual' : 'Monthly'}`}
              </h3>
              <p className="mt-1 text-sm text-neutral-300">
                {isExisting && !isAssisted
                  ? 'Review available changes and the final charge in your existing subscription.'
                  : total !== null && offersTrial
                    ? `Free for ${trialDays} days, then ${money(total)} USD ${interval === 'annual' ? 'per year' : 'per month'}. Cancel before the trial ends and you won’t be charged.`
                    : total !== null
                      ? `${money(total)} USD ${interval === 'annual' ? 'per year' : 'per month'}. Renews automatically until cancelled.`
                    : 'A plan tailored to your team. We’ll agree the price and limits with you.'}
              </p>
            </div>
            {awaitingActivation ? (
              <p className="max-w-xs text-sm leading-6 text-violet-200">
                Confirm the payment status above before starting another
                checkout.
              </p>
            ) : !sub.canManageBilling ? (
              <p className="max-w-xs text-sm text-neutral-400">
                Ask your workspace owner to change this plan.
              </p>
            ) : isExisting && (!isAssisted || requiresRecovery) ? (
              <button
                className={primary}
                disabled={busy !== null}
                onClick={props.onManage}
              >
                {busy === 'manage'
                  ? 'Opening billing…'
                  : requiresRecovery
                    ? 'Recover subscription'
                    : currentSelection
                      ? 'Manage subscription'
                      : 'Change plan in billing portal'}
                <ExternalLink aria-hidden="true" className="h-4 w-4" />
              </button>
            ) : isAssisted ? (
              <a
                className={primary}
                href={`mailto:support@applistingagent.com?subject=${encodeURIComponent(`App Listing Agent ${selected.name} ${interval}`)}`}
              >
                Contact sales{' '}
                <ArrowRight aria-hidden="true" className="h-4 w-4" />
              </a>
            ) : (
              <button
                className={primary}
                disabled={!props.checkoutEnabled || busy !== null}
                onClick={props.onCheckout}
              >
                {busy === 'checkout' ? (
                  <Loader2
                    aria-hidden="true"
                    className="h-4 w-4 animate-spin"
                  />
                ) : null}
                {busy === 'checkout'
                  ? 'Opening secure checkout…'
                  : !props.checkoutEnabled
                    ? 'Checkout temporarily unavailable'
                    : offersTrial
                      ? `Start ${trialDays}-day free trial`
                      : 'Continue to secure checkout'}
                {busy !== 'checkout' && (
                  <ArrowRight aria-hidden="true" className="h-4 w-4" />
                )}
              </button>
            )}
          </div>
          <p className="mt-4 border-t border-neutral-800 pt-4 text-xs leading-5 text-neutral-400">
            {isExisting
              ? 'Update your card, switch plans, view invoices, or cancel in the Stripe billing portal. Need something else? '
              : isAssisted
                ? 'We’ll help you arrange this plan before you pay. '
                : offersTrial
                  ? 'Secure checkout by Stripe. A card is required to start the trial. Your order is sold through Onelink, our merchant of record, and any applicable taxes appear before you confirm. '
                  : 'Secure checkout by Stripe. Your order is sold through Onelink, our merchant of record, and any applicable taxes appear before you pay. '}
            <SupportButton
              className={`text-neutral-200 underline underline-offset-4 ${focus}`}
              subject="Subscription help"
            >
              Contact support
            </SupportButton>
            <span aria-hidden="true"> · </span>
            <a
              className={`underline underline-offset-4 ${focus}`}
              href="/terms"
            >
              Terms
            </a>
            <span aria-hidden="true"> · </span>
            <a
              className={`underline underline-offset-4 ${focus}`}
              href="/privacy"
            >
              Privacy
            </a>
          </p>
        </div>
      </section>

      {!awaitingActivation &&
        activation !== 'confirmed' &&
        sub.canManageBilling && (
          <div className="fixed inset-x-0 bottom-0 z-30 m-0 border-t border-neutral-700 bg-neutral-950 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:hidden">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold">
                  {selected.name} ·{' '}
                  {selectedPlan === 'enterprise'
                    ? 'Custom'
                    : interval === 'annual'
                      ? 'Annual'
                      : 'Monthly'}
                </p>
                <p className="mt-1 text-xs text-neutral-400">
                  {isExisting
                    ? 'Review your existing subscription'
                    : total === null
                      ? 'Price agreed with your team'
                      : offersTrial
                        ? `${trialDays} days free, then ${money(total)} / ${interval === 'annual' ? 'year' : 'month'}`
                        : `${money(total)} USD / ${interval === 'annual' ? 'year' : 'month'}`}
                </p>
              </div>
              <a href="#billing-selection" className={`${primary} shrink-0`}>
                Review plan{' '}
                <ArrowRight aria-hidden="true" className="h-4 w-4" />
              </a>
            </div>
          </div>
        )}

      <section
        aria-labelledby="usage-heading"
        className="border-t border-neutral-800 pt-8"
      >
        <div className="mb-5 flex items-center justify-between gap-3">
          <div>
            <h2
              id="usage-heading"
              className="text-xl font-semibold tracking-tight"
            >
              Your usage
            </h2>
            <p className="mt-2 text-sm text-neutral-400">
              Credits refresh every month on your billing date, including on
              annual plans.
            </p>
          </div>
          <button
            onClick={props.onRefresh}
            disabled={props.refreshing}
            className={secondary}
          >
            <RefreshCw
              aria-hidden="true"
              className={`h-4 w-4 ${props.refreshing ? 'animate-spin' : ''}`}
            />
            {props.refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
        {props.usageError ? (
          <p role="status" className="text-sm text-amber-200">
            {props.usageError} Use Refresh to try again.
          </p>
        ) : usage ? (
          <div className="divide-y divide-neutral-800">
            {(
              [
                ['apps', 'Connected apps'],
                ['translations', 'Translations'],
                ['screenshots', 'Screenshot credits'],
                ['icons', 'Icon credits'],
                ['uploads', 'Store uploads'],
              ] as const
            ).map(([key, label]) => {
              const item = usage[key]
              if (!item) return null
              const committed = item.used + (item.reserved || 0)
              const percent =
                item.limit > 0
                  ? Math.min(100, (committed / item.limit) * 100)
                  : 0
              const atLimit = item.limit !== -1 && committed >= item.limit
              return (
                <div
                  key={key}
                  className="grid items-center gap-3 py-4 sm:grid-cols-[1fr_1fr] sm:gap-8"
                >
                  <div className="flex items-center justify-between gap-4">
                    <p className="text-sm text-neutral-300">{label}</p>
                    <p className="text-sm tabular-nums text-neutral-100">
                      {number(item.used)}{' '}
                      <span className="text-neutral-400">
                        / {number(item.limit)}
                      </span>
                    </p>
                  </div>
                  <div>
                    {item.limit === -1 ? (
                      <p className="text-xs text-neutral-400">
                        Included with your plan
                      </p>
                    ) : (
                      <>
                        <div
                          role="progressbar"
                          aria-label={`${label} allowance used`}
                          aria-valuenow={Math.round(percent)}
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-valuetext={`${committed} of ${item.limit}, including ${item.reserved || 0} reserved`}
                          className="h-1.5 overflow-hidden rounded-full bg-neutral-800"
                        >
                          <div
                            className={`h-full rounded-full ${atLimit ? 'bg-amber-400' : 'bg-violet-400'}`}
                            style={{ width: `${percent}%` }}
                          />
                        </div>
                        <p
                          className={`mt-2 text-xs ${atLimit ? 'text-amber-200' : 'text-neutral-400'}`}
                        >
                          {item.reserved
                            ? `${number(item.reserved)} reserved for work in progress · `
                            : ''}
                          {atLimit
                            ? 'Allowance reached'
                            : `${number(Math.max(0, item.limit - committed))} remaining`}
                        </p>
                      </>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <p className="text-sm text-neutral-400">
            Usage is unavailable right now.
          </p>
        )}
      </section>
    </div>
  )
}
