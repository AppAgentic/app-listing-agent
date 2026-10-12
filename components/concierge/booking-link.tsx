'use client'

import Link from 'next/link'
import { useEffect, useState, type ComponentProps } from 'react'
import {
  appendMarketingParams,
  attributionToSearchParams,
  resolveMarketingAttribution,
} from '@/lib/marketing/attribution'
import { trackFunnelCta } from '@/lib/analytics/client'

type BookingLinkProps = ComponentProps<typeof Link> & { source: string }

export function createConciergeSessionId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID()
  }

  const bytes = new Uint8Array(16)
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(bytes)
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256)
    }
  }

  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function conciergeSessionId(): string {
  const key = 'asc_concierge_session'
  const existing = window.localStorage.getItem(key)
  if (existing) return existing
  const value = createConciergeSessionId()
  window.localStorage.setItem(key, value)
  return value
}

export function trackConciergeEvent(
  name: string,
  source: string,
  metadata?: Record<string, string>,
  lead?: { leadId: string; trackingToken: string },
) {
  if (typeof window === 'undefined') return
  const payload = JSON.stringify({ name, source, sessionId: conciergeSessionId(), metadata, ...lead })
  if (navigator.sendBeacon) {
    navigator.sendBeacon('/api/concierge/events', new Blob([payload], { type: 'application/json' }))
    return
  }
  void fetch('/api/concierge/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: payload,
    keepalive: true,
  })
}

export function TrackedFunnelLink({ source, onClick, ...props }: BookingLinkProps) {
  const [href, setHref] = useState(props.href)

  useEffect(() => {
    const currentParams = new URLSearchParams(window.location.search)
    const attribution = resolveMarketingAttribution(
      currentParams,
      {
        landingPath: window.location.pathname,
        referrer: document.referrer,
        capturedAt: new Date().toISOString(),
      },
      window.localStorage,
    )
    setHref(typeof props.href === 'string'
      ? appendMarketingParams(props.href, attributionToSearchParams(attribution))
      : props.href)
  }, [props.href])

  return (
    <Link
      {...props}
      href={href}
      onClick={(event) => {
        trackConciergeEvent('cta_clicked', source)
        trackFunnelCta(source, href)
        onClick?.(event)
      }}
    />
  )
}

export const BookingLink = TrackedFunnelLink
