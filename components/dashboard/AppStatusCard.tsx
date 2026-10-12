'use client'

import Link from 'next/link'
import { ArrowRight, FileText, Image, RefreshCw, CheckCircle2, AlertCircle, Clock } from 'lucide-react'
import type { Project, AppStoreVersionState, MetadataSyncStatus } from '@/lib/firebase/firestore'

interface RecentActivity {
  source: string
  description: string
  localesCount: number
  createdAt: { toMillis: () => number } | { _seconds: number }
}

interface AppStatusCardProps {
  project: Project & { id: string; recentActivity: RecentActivity | null }
}

function getVersionStateBadge(state: AppStoreVersionState | null) {
  if (!state) {
    return { label: 'Not Connected', color: 'bg-neutral-500/10 text-neutral-400 border-neutral-500/20' }
  }

  switch (state) {
    case 'PREPARE_FOR_SUBMISSION':
    case 'METADATA_REJECTED':
    case 'DEVELOPER_REJECTED':
      return { label: 'Editable', color: 'bg-green-500/10 text-green-400 border-green-500/20' }
    case 'WAITING_FOR_REVIEW':
    case 'IN_REVIEW':
      return { label: 'In Review', color: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20' }
    case 'PENDING_DEVELOPER_RELEASE':
      return { label: 'Ready to Release', color: 'bg-blue-500/10 text-blue-400 border-blue-500/20' }
    case 'READY_FOR_SALE':
      return { label: 'Live', color: 'bg-purple-500/10 text-purple-400 border-purple-500/20' }
    case 'REJECTED':
      return { label: 'Rejected', color: 'bg-red-500/10 text-red-400 border-red-500/20' }
    default:
      return { label: state, color: 'bg-neutral-500/10 text-neutral-400 border-neutral-500/20' }
  }
}

function getSyncStatusDisplay(status: MetadataSyncStatus) {
  switch (status) {
    case 'synced':
      return { icon: CheckCircle2, label: 'Synced', color: 'text-green-400' }
    case 'local_changes':
      return { icon: Clock, label: 'Changes', color: 'text-yellow-400' }
    case 'conflict':
      return { icon: AlertCircle, label: 'Conflict', color: 'text-red-400' }
    case 'never_synced':
    default:
      return { icon: RefreshCw, label: 'Not Synced', color: 'text-neutral-400' }
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

export function AppStatusCard({ project }: AppStatusCardProps) {
  const versionBadge = getVersionStateBadge(project.appStoreVersionState)
  const syncStatus = getSyncStatusDisplay(project.syncStatus)
  const SyncIcon = syncStatus.icon

  return (
    <Link
      href={`/projects/${project.id}`}
      className="group block rounded-2xl bg-white/[0.02] border border-white/[0.08] p-6 hover:bg-white/[0.04] hover:border-white/[0.15] transition-all"
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-white mb-1 group-hover:text-purple-400 transition-colors truncate">
            {project.name}
          </h3>
          <div className="flex items-center gap-2 flex-wrap">
            {project.appStoreVersionNumber && (
              <span className="text-sm text-neutral-400">v{project.appStoreVersionNumber}</span>
            )}
            <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium border ${versionBadge.color}`}>
              {versionBadge.label}
            </span>
          </div>
        </div>
        <ArrowRight className="w-5 h-5 text-neutral-600 group-hover:text-purple-400 group-hover:translate-x-1 transition-all flex-shrink-0 ml-2" />
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        {/* Metadata */}
        <div className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.05]">
          <div className="flex items-center gap-1.5 mb-1">
            <FileText className="w-3.5 h-3.5 text-purple-400" />
            <span className="text-[11px] font-medium text-neutral-400 uppercase tracking-wide">Metadata</span>
          </div>
          <p className="text-sm font-medium text-white">
            {project.enabledLocales?.length || 1} locales
          </p>
        </div>

        {/* Screenshots */}
        <div className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.05]">
          <div className="flex items-center gap-1.5 mb-1">
            <Image className="w-3.5 h-3.5 text-blue-400" />
            <span className="text-[11px] font-medium text-neutral-400 uppercase tracking-wide">Screenshots</span>
          </div>
          <p className="text-sm font-medium text-white">
            —
          </p>
        </div>

        {/* Sync Status */}
        <div className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.05]">
          <div className="flex items-center gap-1.5 mb-1">
            <SyncIcon className={`w-3.5 h-3.5 ${syncStatus.color}`} />
            <span className="text-[11px] font-medium text-neutral-400 uppercase tracking-wide">Sync</span>
          </div>
          <p className={`text-sm font-medium ${syncStatus.color}`}>
            {syncStatus.label}
          </p>
        </div>
      </div>

      {/* Recent Activity */}
      {project.recentActivity ? (
        <p className="text-xs text-neutral-500">
          {project.recentActivity.description}
          {project.recentActivity.localesCount > 0 && ` • ${project.recentActivity.localesCount} locales`}
          {' • '}
          {getRelativeTime(project.recentActivity.createdAt)}
        </p>
      ) : (
        <p className="text-xs text-neutral-500">No recent activity</p>
      )}
    </Link>
  )
}
