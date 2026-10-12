'use client'

import Script from 'next/script'
import { useLayoutEffect } from 'react'

/** Our hosted cloud's public Clarity project id (it ships in page source anyway). */
export const HOSTED_CLARITY_ID = 'ypx4pf5qq4'

/**
 * Which Clarity project to load, or '' for none:
 * - NEXT_PUBLIC_CLARITY_ID set to an id: that project (also on a self-hosted install that opts in).
 * - NEXT_PUBLIC_CLARITY_ID set to '' or 'off': Clarity disabled.
 * - unset: our hosted project, except on self-hosted builds (NEXT_PUBLIC_SELF_HOSTED=true), which never
 *   send recordings to our Clarity project.
 * Both variables are inlined at build time.
 */
export function resolveClarityId(configured: string | undefined, selfHosted: string | undefined): string {
  if (configured !== undefined) {
    const id = configured.trim()
    return id && id.toLowerCase() !== 'off' ? id : ''
  }
  return selfHosted?.trim().toLowerCase() === 'true' ? '' : HOSTED_CLARITY_ID
}

export const CLARITY_ID = resolveClarityId(process.env.NEXT_PUBLIC_CLARITY_ID, process.env.NEXT_PUBLIC_SELF_HOSTED)
const enabled = process.env.NODE_ENV === 'production' && Boolean(CLARITY_ID)

type ClarityFn = ((...args: unknown[]) => void) & { q?: unknown[] }

/**
 * Microsoft Clarity session recordings and heatmaps, mounted once in the root layout next to ProductAnalytics.
 * Production builds only. No consent gate, matching first-party analytics (product decision, 2026-09-17): no consent signal
 * is sent, so Clarity runs cookieless for EEA/UK/CH visitors. Signed-in app content is masked with
 * data-clarity-mask on the (apps) / (dashboard) layouts and agent task pages.
 */
export function MicrosoftClarity() {
  // Queue stub from the official snippet, installed before next/script injects the tag, so early calls are kept.
  useLayoutEffect(() => {
    if (!enabled) return
    const w = window as unknown as Window & { clarity?: ClarityFn }
    // Push the `arguments` object itself, exactly as the official snippet does.
    w.clarity = w.clarity || function () {
      // eslint-disable-next-line prefer-rest-params
      (w.clarity!.q = w.clarity!.q || []).push(arguments)
    }
  }, [])

  if (!enabled) return null
  return <Script id="ms-clarity" src={`https://www.clarity.ms/tag/${encodeURIComponent(CLARITY_ID)}`} strategy="afterInteractive" />
}
