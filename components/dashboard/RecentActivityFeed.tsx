'use client'

import Link from 'next/link'
import { ArrowUpCircle, ArrowDownCircle, Sparkles, Edit3, RotateCcw } from 'lucide-react'

interface ActivityEntry {
  projectId: string
  projectName: string
  source: string
  description: string
  localesCount: number
  createdAt: { toMillis?: () => number; _seconds?: number }
}

interface RecentActivityFeedProps {
  activities: ActivityEntry[]
}

function getSourceIcon(source: string) {
  switch (source) {
    case 'publish':
      return { icon: ArrowUpCircle, color: 'text-cyan-400' }
    case 'pull':
      return { icon: ArrowDownCircle, color: 'text-blue-400' }
    case 'ai_translation':
      return { icon: Sparkles, color: 'text-purple-400' }
    case 'manual_edit':
      return { icon: Edit3, color: 'text-green-400' }
    case 'rollback':
      return { icon: RotateCcw, color: 'text-yellow-400' }
    default:
      return { icon: Edit3, color: 'text-neutral-400' }
  }
}

function getRelativeTime(timestamp: { toMillis?: () => number; _seconds?: number }): string {
  const ms = timestamp.toMillis ? timestamp.toMillis() : (timestamp._seconds || 0) * 1000
  const diff = Date.now() - ms
  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)

  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes}m ago`
  if (hours < 24) return `${hours}h ago`
  if (days < 7) return `${days}d ago`
  return new Date(ms).toLocaleDateString()
}

export function RecentActivityFeed({ activities }: RecentActivityFeedProps) {
  if (activities.length === 0) {
    return (
      <div className="text-center py-8">
        <p className="text-neutral-500 text-sm">No recent activity</p>
      </div>
    )
  }

  return (
    <div className="space-y-1">
      {activities.map((activity, index) => {
        const { icon: Icon, color } = getSourceIcon(activity.source)
        return (
          <Link
            key={`${activity.projectId}-${index}`}
            href={`/projects/${activity.projectId}`}
            className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-white/[0.03] transition-colors group"
          >
            <Icon className={`w-4 h-4 ${color} flex-shrink-0`} />
            <div className="flex-1 min-w-0">
              <span className="text-sm text-white group-hover:text-purple-400 transition-colors">
                {activity.projectName}
              </span>
              <span className="text-sm text-neutral-500">
                {' → '}
                {activity.description}
                {activity.localesCount > 0 && ` • ${activity.localesCount} locales`}
              </span>
            </div>
            <span className="text-xs text-neutral-600 flex-shrink-0">
              {getRelativeTime(activity.createdAt)}
            </span>
          </Link>
        )
      })}
    </div>
  )
}
