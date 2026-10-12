'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { RequireProject } from '@/components/dashboard/require-project'
import {
  FolderKanban,
  CheckCircle2,
  AlertTriangle,
  Activity,
  Globe,
  Image as ImageIcon,
  FileText,
  ArrowRight,
  RefreshCw,
  ExternalLink
} from 'lucide-react'

interface ProjectActivity {
  id: string
  source: string
  description: string
  localesCount: number
  createdAt: string
}

interface ProjectOverviewData {
  project: {
    id: string
    name: string
    appStoreAppId: string | null
    playStorePackage: string | null
    primaryLocale: string
    syncStatus: string
    lastPulledAt: string | null
    lastPublishedAt: string | null
  }
  stats: {
    localesCount: number
    activityThisWeek: number
  }
  recentActivity: ProjectActivity[]
}

function getSourceLabel(source: string): string {
  switch (source) {
    case 'pull':
      return 'Pulled from App Store'
    case 'publish':
      return 'Published to App Store'
    case 'ai_translation':
      return 'AI translated'
    case 'manual_edit':
      return 'Manually edited'
    case 'rollback':
      return 'Rolled back'
    default:
      return 'Updated'
  }
}

function formatTimeAgo(dateString: string): string {
  const date = new Date(dateString)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMins < 1) return 'Just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`
  return date.toLocaleDateString()
}

export default function OverviewPage() {
  return (
    <RequireProject>
      {(selectedProject) => (
        <ProjectOverview projectId={selectedProject.id} projectName={selectedProject.name} />
      )}
    </RequireProject>
  )
}

// Demo data for testing UI without a real project
const DEMO_OVERVIEW_DATA: ProjectOverviewData = {
  project: {
    id: 'demo-project',
    name: 'My Awesome App',
    appStoreAppId: '1234567890',
    playStorePackage: 'com.example.myawesomeapp',
    primaryLocale: 'en-US',
    syncStatus: 'synced',
    lastPulledAt: new Date().toISOString(),
    lastPublishedAt: null,
  },
  stats: {
    localesCount: 1,
    activityThisWeek: 0,
  },
  recentActivity: [],
}

function ProjectOverview({ projectId, projectName }: { projectId: string; projectName: string }) {
  const [data, setData] = useState<ProjectOverviewData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function fetchOverview() {
      setLoading(true)
      setError(null)

      // Handle demo project with mock data
      if (projectId === 'demo-project') {
        setData(DEMO_OVERVIEW_DATA)
        setLoading(false)
        return
      }

      try {
        const response = await fetch(`/api/projects/${projectId}/overview`)
        if (!response.ok) {
          throw new Error('Failed to fetch project overview')
        }
        const result = await response.json()
        setData(result)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'An error occurred')
      } finally {
        setLoading(false)
      }
    }

    fetchOverview()
  }, [projectId])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-2 border-white border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="text-center py-16 rounded-2xl bg-black/40 backdrop-blur-xl border border-white/[0.08]">
        <div className="w-16 h-16 mx-auto mb-6 rounded-2xl bg-red-500/20 border border-red-500/20 flex items-center justify-center">
          <AlertTriangle className="w-8 h-8 text-red-400" />
        </div>
        <h3 className="text-xl font-semibold text-white mb-2">Failed to load overview</h3>
        <p className="text-neutral-400 mb-6 max-w-sm mx-auto">{error}</p>
        <button
          onClick={() => window.location.reload()}
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-white/[0.05] text-white rounded-xl font-medium hover:bg-white/[0.1] transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
          Retry
        </button>
      </div>
    )
  }

  const syncStatus = data?.project.syncStatus || 'synced'
  const needsAttention = syncStatus === 'local_changes' || syncStatus === 'conflict'

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white">{projectName}</h1>
          <p className="text-neutral-400 mt-1">Project overview and recent activity</p>
        </div>
        <Link
          href={`/projects/${projectId}`}
          className="flex items-center gap-2 px-4 py-2.5 bg-white/[0.05] text-white rounded-xl font-medium hover:bg-white/[0.1] transition-colors"
        >
          View Details
          <ExternalLink className="w-4 h-4" />
        </Link>
      </div>

      {/* Status Banner */}
      {needsAttention && (
        <div className="mb-6 p-4 rounded-xl bg-yellow-500/10 border border-yellow-500/20">
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-yellow-400" />
            <div>
              <p className="font-medium text-yellow-400">
                {syncStatus === 'conflict' ? 'Sync Conflict Detected' : 'Unpublished Changes'}
              </p>
              <p className="text-sm text-yellow-400/70">
                {syncStatus === 'conflict'
                  ? 'Remote changes conflict with your local edits. Review and resolve.'
                  : 'You have local changes that haven\'t been published yet.'}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Quick Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <div className="p-4 rounded-2xl bg-black/40 backdrop-blur-xl border border-white/[0.08]">
          <div className="flex items-center gap-2 mb-2">
            <Globe className="w-4 h-4 text-neutral-400" />
            <span className="text-xs font-medium text-neutral-400 uppercase tracking-wide">Locales</span>
          </div>
          <p className="text-2xl font-bold text-white">{data?.stats.localesCount || 1}</p>
        </div>
        <div className="p-4 rounded-2xl bg-black/40 backdrop-blur-xl border border-white/[0.08]">
          <div className="flex items-center gap-2 mb-2">
            <Activity className="w-4 h-4 text-neutral-400" />
            <span className="text-xs font-medium text-neutral-400 uppercase tracking-wide">This Week</span>
          </div>
          <p className="text-2xl font-bold text-white">{data?.stats.activityThisWeek || 0}</p>
        </div>
        <div className="p-4 rounded-2xl bg-black/40 backdrop-blur-xl border border-white/[0.08]">
          <div className="flex items-center gap-2 mb-2">
            {needsAttention ? (
              <AlertTriangle className="w-4 h-4 text-yellow-400" />
            ) : (
              <CheckCircle2 className="w-4 h-4 text-green-400" />
            )}
            <span className="text-xs font-medium text-neutral-400 uppercase tracking-wide">Status</span>
          </div>
          <p className="text-lg font-bold text-white capitalize">
            {syncStatus === 'local_changes' ? 'Pending' : syncStatus === 'conflict' ? 'Conflict' : 'Synced'}
          </p>
        </div>
        <div className="p-4 rounded-2xl bg-black/40 backdrop-blur-xl border border-white/[0.08]">
          <div className="flex items-center gap-2 mb-2">
            <FolderKanban className="w-4 h-4 text-neutral-400" />
            <span className="text-xs font-medium text-neutral-400 uppercase tracking-wide">Primary</span>
          </div>
          <p className="text-lg font-bold text-white">{data?.project.primaryLocale || 'en-US'}</p>
        </div>
      </div>

      {/* Quick Actions */}
      <section className="mb-8">
        <h2 className="text-lg font-semibold text-white mb-4">Quick Actions</h2>
        <div className="grid gap-4 md:grid-cols-3">
          <Link
            href={`/projects/${projectId}/metadata`}
            className="group flex items-center gap-4 p-4 rounded-xl bg-black/40 backdrop-blur-xl border border-white/[0.08] hover:bg-white/[0.04] hover:border-white/[0.15] transition-all"
          >
            <div className="w-10 h-10 rounded-lg bg-white/[0.05] flex items-center justify-center">
              <FileText className="w-5 h-5 text-neutral-400" />
            </div>
            <div className="flex-1">
              <h3 className="font-medium text-white">Edit Metadata</h3>
              <p className="text-xs text-neutral-500">Manage listings & translations</p>
            </div>
            <ArrowRight className="w-4 h-4 text-neutral-600 group-hover:text-white group-hover:translate-x-1 transition-all" />
          </Link>

          <Link
            href={`/screenshots/generate?projectId=${projectId}`}
            className="group flex items-center gap-4 p-4 rounded-xl bg-black/40 backdrop-blur-xl border border-white/[0.08] hover:bg-white/[0.04] hover:border-white/[0.15] transition-all"
          >
            <div className="w-10 h-10 rounded-lg bg-white/[0.05] flex items-center justify-center">
              <ImageIcon className="w-5 h-5 text-neutral-400" />
            </div>
            <div className="flex-1">
              <h3 className="font-medium text-white">Generate Screenshots</h3>
              <p className="text-xs text-neutral-500">Create App Store marketing images</p>
            </div>
            <ArrowRight className="w-4 h-4 text-neutral-600 group-hover:text-white group-hover:translate-x-1 transition-all" />
          </Link>

          <Link
            href="/icons"
            className="group flex items-center gap-4 p-4 rounded-xl bg-black/40 backdrop-blur-xl border border-white/[0.08] hover:bg-white/[0.04] hover:border-white/[0.15] transition-all"
          >
            <div className="w-10 h-10 rounded-lg bg-white/[0.05] flex items-center justify-center">
              <FolderKanban className="w-5 h-5 text-neutral-400" />
            </div>
            <div className="flex-1">
              <h3 className="font-medium text-white">Generate Icons</h3>
              <p className="text-xs text-neutral-500">AI-powered app icon creation</p>
            </div>
            <ArrowRight className="w-4 h-4 text-neutral-600 group-hover:text-white group-hover:translate-x-1 transition-all" />
          </Link>
        </div>
      </section>

      {/* Recent Activity */}
      <section>
        <h2 className="text-lg font-semibold text-white mb-4">Recent Activity</h2>
        <div className="rounded-2xl bg-black/40 backdrop-blur-xl border border-white/[0.08]">
          {!data?.recentActivity || data.recentActivity.length === 0 ? (
            <div className="text-center py-10">
              <div className="w-12 h-12 mx-auto mb-4 rounded-xl bg-white/[0.03] border border-white/[0.08] flex items-center justify-center">
                <Activity className="w-6 h-6 text-neutral-500" />
              </div>
              <h3 className="font-semibold text-white mb-1">No activity yet</h3>
              <p className="text-sm text-neutral-400">Activity will appear here as you make changes.</p>
            </div>
          ) : (
            <div className="divide-y divide-white/[0.05]">
              {data.recentActivity.map((activity) => (
                <div key={activity.id} className="flex items-center gap-4 p-4">
                  <div className="w-8 h-8 rounded-lg bg-white/[0.05] flex items-center justify-center">
                    <Activity className="w-4 h-4 text-neutral-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-white truncate">
                      {activity.description || getSourceLabel(activity.source)}
                    </p>
                    <p className="text-xs text-neutral-500">
                      {activity.localesCount} locale{activity.localesCount !== 1 ? 's' : ''}
                    </p>
                  </div>
                  <span className="text-xs text-neutral-500 whitespace-nowrap">
                    {formatTimeAgo(activity.createdAt)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
