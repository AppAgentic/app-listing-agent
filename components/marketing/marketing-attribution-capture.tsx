'use client'

import { useEffect } from 'react'
import { resolveMarketingAttribution } from '@/lib/marketing/attribution'

export function MarketingAttributionCapture() {
  useEffect(() => {
    resolveMarketingAttribution(
      new URLSearchParams(window.location.search),
      {
        landingPath: window.location.pathname,
        referrer: document.referrer,
        capturedAt: new Date().toISOString(),
      },
      window.localStorage,
    )
  }, [])

  return null
}
