'use client'

import { readStoredMarketingAttribution } from '@/lib/marketing/attribution'
import {
  CLIENT_EVENTS,
  SESSION_IDLE_MS,
  SESSION_STORAGE_KEY,
  UUID_PATTERN,
  VISITOR_STORAGE_KEY,
  analyticsSource,
  surfaceForPath,
  type AnalyticsDevice,
  type AnalyticsProps,
} from './events'

/**
 * Browser side of first-party product analytics. App Listing Agent tracks from the first page load with no
 * consent gate (product decision, 2026-09-17): a random visitor id (localStorage) and session id (sessionStorage,
 * rotated after 30 minutes idle) are created on first use. Only allow-listed events and catalog ids are sent.
 */

export interface TrackFields { step?: number; props?: AnalyticsProps }

const uuid = () => crypto.randomUUID()

function device(): AnalyticsDevice {
  const width = window.innerWidth
  const coarse = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches
  return width < 768 ? 'mobile' : coarse && width < 1200 ? 'tablet' : 'desktop'
}

function identities(now: number) {
  let visitor = localStorage.getItem(VISITOR_STORAGE_KEY)
  if (!visitor || !UUID_PATTERN.test(visitor)) {
    visitor = uuid()
    localStorage.setItem(VISITOR_STORAGE_KEY, visitor)
  }
  let session: { id: string; last: number; source: string | null } | null = null
  try { session = JSON.parse(sessionStorage.getItem(SESSION_STORAGE_KEY) ?? 'null') } catch { session = null }
  if (!session || typeof session.id !== 'string' || !UUID_PATTERN.test(session.id) || !(now - session.last < SESSION_IDLE_MS)) {
    session = { id: uuid(), last: now, source: null }
  }
  return { visitor, session }
}

/** Sends one analytics event. Never throws and never affects the page. */
export function trackEvent(event: string, fields?: TrackFields, pathname?: string): void {
  if (typeof window === 'undefined' || !Object.hasOwn(CLIENT_EVENTS, event)) return
  try {
    const surface = surfaceForPath(pathname ?? window.location.pathname)
    if (event === 'page_view' && !surface) return
    const now = Date.now()
    const { visitor, session } = identities(now)
    session.source ??= analyticsSource(readStoredMarketingAttribution(window.localStorage))
    session.last = now
    sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session))
    const body = JSON.stringify({
      v: 1,
      event,
      surface,
      ...(fields?.step ? { step: fields.step } : {}),
      props: fields?.props ?? {},
      visitor_id: visitor,
      session_id: session.id,
      source: session.source,
      device: device(),
    })
    // same-origin credentials send the __session cookie, which the server verifies for user_id.
    void fetch('/api/public/events', {
      method: 'POST',
      credentials: 'same-origin',
      keepalive: true,
      headers: { 'Content-Type': 'application/json' },
      body,
    }).catch(() => {})
    // Name-only mirror to Microsoft Clarity (components/analytics/microsoft-clarity.tsx) for filtering recordings.
    if (event !== 'page_view') (window as { clarity?: (...args: unknown[]) => void }).clarity?.('event', event)
  } catch {
    // Storage or network unavailable: analytics never affects the product.
  }
}

/**
 * Maps an existing concierge CTA `source` (TrackedFunnelLink) onto first-party analytics events:
 * self-service sign-up CTAs, guided booking CTAs and pricing plan choices.
 */
export function trackFunnelCta(source: string, href: unknown): void {
  const cta = /^(nav|hero|final_cta|audit)(?:_(self_service|guided))?$/.exec(source)
  if (cta) {
    trackEvent(cta[2] === 'self_service' ? 'signup_cta_clicked' : 'booking_cta_clicked', { props: { placement: cta[1] } })
    return
  }
  const pricing = /^pricing_(starter|pro|business|enterprise)_(self_service|assisted|guided)$/.exec(source)
  if (!pricing) return
  if (pricing[2] !== 'self_service') {
    trackEvent('booking_cta_clicked', { props: { placement: 'pricing' } })
    return
  }
  const interval = typeof href === 'string' ? /[?&]interval=(monthly|annual)\b/.exec(href)?.[1] : undefined
  trackEvent('plan_selected', {
    props: { plan: pricing[1], placement: 'pricing', ...(interval ? { interval: interval === 'annual' ? 'year' : 'month' } : {}) },
  })
}

/** Drops this browser's random analytics ids (after account deletion, so later visits are not linked). */
export function forgetAnalyticsIdentity(): void {
  try {
    localStorage.removeItem(VISITOR_STORAGE_KEY)
    sessionStorage.removeItem(SESSION_STORAGE_KEY)
  } catch {
    // Storage unavailable.
  }
}
