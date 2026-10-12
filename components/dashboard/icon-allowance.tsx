'use client'
import { useEffect, useState } from 'react'

/** Omit the allowance when the existing usage endpoint cannot provide it. */
export function IconAllowance() {
  const [remaining, setRemaining] = useState<number | null>(null)
  useEffect(() => {
    let active = true
    const read = async () => {
      try {
        const response = await fetch('/api/usage', { credentials: 'include' })
        if (!response.ok) return
        const { icons } = await response.json()
        if (
          active &&
          icons &&
          Number.isFinite(icons.used) &&
          Number.isFinite(icons.limit)
        ) {
          setRemaining(
            icons.limit === -1
              ? -1
              : Math.max(0, icons.limit - icons.used - (icons.reserved || 0)),
          )
        }
      } catch {
        /* No invented allowance when usage is unavailable. */
      }
    }
    void read()
    window.addEventListener('icons:usage-changed', read)
    return () => {
      active = false
      window.removeEventListener('icons:usage-changed', read)
    }
  }, [])
  if (remaining === null) return null
  return (
    <p className="text-sm text-neutral-400 tabular-nums" aria-live="polite">
      {remaining === -1 ? (
        'Unlimited icon credits'
      ) : (
        <>
          <strong className="font-medium text-neutral-200">{remaining}</strong>{' '}
          {remaining === 1 ? 'icon credit' : 'icon credits'} left this month
        </>
      )}
    </p>
  )
}
