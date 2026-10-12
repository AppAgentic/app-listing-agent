'use client'

import { Globe, Image, Upload } from 'lucide-react'

interface UsageDisplayProps {
  usage: {
    translations: number
    screenshots: number
    uploads: number
  }
  limits: {
    translations: number
    screenshots: number
    uploads: number
  }
}

function UsageBar({
  used = 0,
  limit = 0,
  label,
  icon: Icon
}: {
  used?: number
  limit?: number
  label: string
  icon: React.ComponentType<{ className?: string }>
}) {
  const safeUsed = used ?? 0
  const safeLimit = limit ?? 0
  const percentage = safeLimit > 0 ? Math.min((safeUsed / safeLimit) * 100, 100) : 0
  const isUnlimited = safeLimit === -1

  return (
    <div className="p-4 rounded-xl bg-black/20 border border-white/[0.05]">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Icon className="w-4 h-4 text-neutral-400" />
          <span className="text-sm text-neutral-300">{label}</span>
        </div>
        <span className="text-sm font-medium text-white">
          {safeUsed.toLocaleString()} / {isUnlimited ? '∞' : safeLimit.toLocaleString()}
        </span>
      </div>
      <div className="h-2 bg-white/[0.05] rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${
            percentage >= 90
              ? 'bg-gradient-to-r from-red-500 to-red-400'
              : percentage >= 75
              ? 'bg-gradient-to-r from-yellow-500 to-orange-400'
              : 'bg-gradient-to-r from-purple-500 to-blue-500'
          }`}
          style={{ width: isUnlimited ? '5%' : `${Math.max(percentage, 2)}%` }}
        />
      </div>
      {percentage >= 90 && !isUnlimited && safeLimit > 0 && (
        <p className="text-xs text-red-400 mt-2">Approaching limit</p>
      )}
    </div>
  )
}

export function UsageDisplay({ usage, limits }: UsageDisplayProps) {
  const safeUsage = usage ?? { translations: 0, screenshots: 0, uploads: 0 }
  const safeLimits = limits ?? { translations: 0, screenshots: 0, uploads: 0 }

  return (
    <div className="grid gap-3 md:grid-cols-3">
      <UsageBar
        label="Translations"
        used={safeUsage.translations}
        limit={safeLimits.translations}
        icon={Globe}
      />
      <UsageBar
        label="Screenshots"
        used={safeUsage.screenshots}
        limit={safeLimits.screenshots}
        icon={Image}
      />
      <UsageBar
        label="Uploads"
        used={safeUsage.uploads}
        limit={safeLimits.uploads}
        icon={Upload}
      />
    </div>
  )
}
