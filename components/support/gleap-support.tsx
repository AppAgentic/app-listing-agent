'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import { supportClient, SUPPORT_EMAIL } from '@/lib/support/gleap-client'

export function GleapSupportProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  useEffect(() => {
    let cancelled = false
    void supportClient.initialize()
    void fetch('/api/auth/session', { cache: 'no-store' })
      .then(async response => response.ok ? response.json() : null)
      .then(user => {
        if (!cancelled) supportClient.identify(user?.userId ? { userId: user.userId, name: user.name, email: user.email } : null)
      })
      .catch(() => { if (!cancelled) supportClient.identify(null) })
    return () => { cancelled = true }
  }, [pathname])
  return children
}

export function SupportButton({ children = 'Contact support', className, subject = 'App Listing Agent support', onOpen }: {
  children?: ReactNode; className?: string; subject?: string; onOpen?: () => void
}) {
  const [busy, setBusy] = useState(false)
  return <a
    href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}`}
    className={className}
    aria-busy={busy}
    onClick={async event => {
      event.preventDefault()
      if (busy) return
      setBusy(true)
      const opened = await supportClient.open()
      setBusy(false)
      if (opened) onOpen?.()
      else window.location.assign(`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}`)
    }}
  >{busy ? 'Opening support…' : children}</a>
}
