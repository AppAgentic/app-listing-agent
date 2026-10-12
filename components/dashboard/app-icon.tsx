'use client'

import { useState, useEffect } from 'react'
import { FolderKanban } from 'lucide-react'

interface AppIconProps {
  appStoreAppId: string | null
  name: string
  size?: 'sm' | 'md' | 'lg'
}

const sizeClasses = {
  sm: 'w-10 h-10 rounded-xl',
  md: 'w-14 h-14 rounded-xl',
  lg: 'w-20 h-20 rounded-2xl',
}

const fallbackIconSizes = {
  sm: 'w-5 h-5',
  md: 'w-7 h-7',
  lg: 'w-10 h-10',
}

const textSizes = {
  sm: 'text-lg',
  md: 'text-2xl',
  lg: 'text-3xl',
}

export function AppIcon({ appStoreAppId, name, size = 'md' }: AppIconProps) {
  const [iconUrl, setIconUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!appStoreAppId) return

    async function fetchIcon() {
      setLoading(true)
      try {
        const response = await fetch('/api/stores/apps/icons', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ appIds: [appStoreAppId] }),
        })

        if (response.ok && appStoreAppId) {
          const data = await response.json()
          if (data.icons?.[appStoreAppId]) {
            setIconUrl(data.icons[appStoreAppId])
          }
        }
      } catch (err) {
        console.error('Failed to fetch app icon:', err)
      } finally {
        setLoading(false)
      }
    }

    fetchIcon()
  }, [appStoreAppId])

  if (iconUrl) {
    return (
      <div className={`${sizeClasses[size]} bg-white/10 p-[1px] shadow-lg shadow-purple-500/20 flex-shrink-0`}>
        <img
          src={iconUrl}
          alt={name}
          className={`w-full h-full ${size === 'sm' ? 'rounded-[0.65rem]' : size === 'md' ? 'rounded-[0.65rem]' : 'rounded-[0.9rem]'} object-cover`}
        />
      </div>
    )
  }

  // Fallback: gradient with initial
  return (
    <div className={`${sizeClasses[size]} bg-gradient-to-br from-purple-500/20 to-blue-500/20 border border-white/[0.08] flex items-center justify-center flex-shrink-0 ${loading ? 'animate-pulse' : ''}`}>
      {loading ? null : (
        <span className={`${textSizes[size]} font-bold text-purple-400`}>
          {name.charAt(0).toUpperCase()}
        </span>
      )}
    </div>
  )
}
