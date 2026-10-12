import { isOfferedBillingPlan, type PublicBillingPlan } from './catalog'

/** Untrusted URL hints select a review screen; they never grant access or start payment. */
export type PurchaseIntent = {
  plan: PublicBillingPlan | 'enterprise'
  interval: 'monthly' | 'annual'
}
type SearchValues = { get(name: string): string | null }

export function readPurchaseIntent(params: SearchValues): PurchaseIntent | null {
  const plan = params.get('plan')
  const interval = params.get('interval') || 'monthly'
  // A plan this deployment does not offer (Indie before its prices are live) falls back to the default selection.
  if (!(plan === 'enterprise' || isOfferedBillingPlan(plan)) ||
      !['monthly', 'annual'].includes(interval)) return null
  return { plan, interval } as PurchaseIntent
}

export function billingIntentUrl(intent: PurchaseIntent, reason?: string): string {
  const params = new URLSearchParams({ plan: intent.plan, interval: intent.interval })
  if (reason) params.set('reason', reason)
  return `/billing?${params}`
}

/** Pricing CTAs start the trial through onboarding: sign up, create the workspace, then trial checkout. */
export function trialIntentUrl(intent: PurchaseIntent, reason?: string): string {
  const params = new URLSearchParams({ plan: intent.plan, interval: intent.interval })
  if (reason) params.set('reason', reason)
  return `/onboarding?${params}`
}

export function safeLocalReturnTo(value: string | null | undefined): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || /[\\\x00-\x20]/.test(value)) return '/dashboard'
  try {
    const url = new URL(value, 'https://applistingagent.com')
    if (url.origin !== 'https://applistingagent.com') return '/dashboard'
    return `${url.pathname}${url.search}${url.hash}`
  } catch { return '/dashboard' }
}

export function resolveLoginDestination(params: SearchValues): string {
  const invite = params.get('invite')
  if (invite) return `/invite/${encodeURIComponent(invite)}`
  if (params.get('returnTo')) return safeLocalReturnTo(params.get('returnTo'))
  const intent = readPurchaseIntent(params)
  return intent ? billingIntentUrl(intent) : '/dashboard'
}

export function isBillingDestination(destination: string): boolean {
  return destination === '/billing' || destination.startsWith('/billing?')
}

export function isOnboardingDestination(destination: string): boolean {
  return destination === '/onboarding' || destination.startsWith('/onboarding?')
}
