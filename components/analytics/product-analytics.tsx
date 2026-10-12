'use client'

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { trackEvent } from '@/lib/analytics/client'

/** Mounted once in the root layout: one page_view per route change (the path maps to an allow-listed surface). */
export function ProductAnalytics() {
  const pathname = usePathname()

  useEffect(() => {
    if (pathname) trackEvent('page_view', undefined, pathname)
  }, [pathname])

  return null
}
