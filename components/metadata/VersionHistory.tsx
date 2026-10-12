'use client'

import { useState } from 'react'
import type { MetadataHistoryEntry, MetadataSource } from '@/lib/firebase/firestore'
import { History, RotateCcw, Download, ChevronDown, ChevronRight, Eye, Tag, Clock, User } from 'lucide-react'

interface VersionHistoryProps {
  history: MetadataHistoryEntry[]
  onRollback: (historyId: string) => Promise<void>
  onPreview?: (entry: MetadataHistoryEntry) => void
}

const SOURCE_LABELS: Record<MetadataSource, { label: string; color: string }> = {
  pull: { label: 'Pulled from Store', color: 'text-blue-400' },
  manual_edit: { label: 'Manual Edit', color: 'text-green-400' },
  ai_translation: { label: 'AI Translation', color: 'text-purple-400' },
  rollback: { label: 'Rollback', color: 'text-yellow-400' },
  publish: { label: 'Published', color: 'text-cyan-400' },
}

function formatDate(timestamp: any): string {
  if (!timestamp) return 'Unknown'
  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp)
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatRelativeTime(timestamp: any): string {
  if (!timestamp) return 'Unknown'
  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMins < 1) return 'Just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`
  return formatDate(timestamp)
}

export function VersionHistory({
  history,
  onRollback,
  onPreview,
}: VersionHistoryProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [rollingBackId, setRollingBackId] = useState<string | null>(null)

  const handleRollback = async (historyId: string) => {
    setRollingBackId(historyId)
    try {
      await onRollback(historyId)
    } finally {
      setRollingBackId(null)
    }
  }

  if (history.length === 0) {
    return (
      <div className="p-8 text-center rounded-2xl bg-white/[0.02] border border-white/[0.08]">
        <History className="w-12 h-12 mx-auto mb-4 text-neutral-600" />
        <h3 className="text-[15px] font-medium text-white mb-2">No Version History</h3>
        <p className="text-[13px] text-neutral-500">
          Changes will be tracked here after you pull or save metadata.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <History className="w-5 h-5 text-purple-400" />
          <h3 className="text-[15px] font-semibold text-white">Version History</h3>
        </div>
        <span className="text-[12px] text-neutral-500">
          {history.length} version{history.length !== 1 ? 's' : ''}
        </span>
      </div>

      <div className="space-y-2">
        {history.map((entry, index) => {
          const isExpanded = expandedId === entry.id
          const isLatest = index === 0
          const sourceConfig = SOURCE_LABELS[entry.source]

          return (
            <div
              key={entry.id}
              className={`rounded-xl border transition-all ${
                isExpanded
                  ? 'bg-white/[0.03] border-white/[0.12]'
                  : 'bg-white/[0.02] border-white/[0.08] hover:border-white/[0.12]'
              }`}
            >
              {/* Header */}
              <button
                onClick={() => setExpandedId(isExpanded ? null : entry.id)}
                className="w-full flex items-center gap-3 p-4 text-left"
              >
                {isExpanded ? (
                  <ChevronDown className="w-4 h-4 text-neutral-400" />
                ) : (
                  <ChevronRight className="w-4 h-4 text-neutral-400" />
                )}

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[13px] font-medium text-white">
                      Version {entry.version}
                    </span>
                    {entry.label && (
                      <span className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-purple-500/20 text-[11px] text-purple-400">
                        <Tag className="w-3 h-3" />
                        {entry.label}
                      </span>
                    )}
                    {isLatest && (
                      <span className="px-2 py-0.5 rounded-md bg-green-500/20 text-[11px] text-green-400">
                        Current
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-[12px] text-neutral-500">
                    <span className={sourceConfig.color}>{sourceConfig.label}</span>
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {formatRelativeTime(entry.createdAt)}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-neutral-500">
                    {entry.changesSummary.localesModified.length} locale
                    {entry.changesSummary.localesModified.length !== 1 ? 's' : ''}
                  </span>
                </div>
              </button>

              {/* Expanded Content */}
              {isExpanded && (
                <div className="px-4 pb-4 pt-0 border-t border-white/[0.08] mt-0">
                  <div className="pt-4 space-y-4">
                    {/* Summary */}
                    <div className="p-3 rounded-lg bg-white/[0.03]">
                      <p className="text-[13px] text-neutral-300">
                        {entry.changesSummary.description}
                      </p>
                      {entry.sourceDetails && (
                        <p className="mt-1 text-[12px] text-neutral-500">
                          {entry.sourceDetails}
                        </p>
                      )}
                    </div>

                    {/* Details */}
                    <div className="grid gap-3 md:grid-cols-2">
                      <div>
                        <div className="text-[11px] font-medium text-neutral-500 uppercase mb-2">
                          Locales Modified
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {entry.changesSummary.localesModified.map(locale => (
                            <span
                              key={locale}
                              className="px-2 py-1 rounded-md bg-white/[0.05] text-[11px] text-neutral-300"
                            >
                              {locale}
                            </span>
                          ))}
                        </div>
                      </div>
                      <div>
                        <div className="text-[11px] font-medium text-neutral-500 uppercase mb-2">
                          Fields Changed
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {entry.changesSummary.fieldsModified.map(field => (
                            <span
                              key={field}
                              className="px-2 py-1 rounded-md bg-white/[0.05] text-[11px] text-neutral-300"
                            >
                              {field}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* Metadata */}
                    <div className="flex items-center gap-4 text-[12px] text-neutral-500">
                      <span className="flex items-center gap-1">
                        <User className="w-3.5 h-3.5" />
                        {entry.createdBy}
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5" />
                        {formatDate(entry.createdAt)}
                      </span>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2 pt-2">
                      {onPreview && (
                        <button
                          onClick={() => onPreview(entry)}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg
                                   bg-white/[0.05] border border-white/[0.08]
                                   text-[12px] font-medium text-neutral-300
                                   hover:bg-white/[0.08] hover:text-white transition-colors"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          Preview
                        </button>
                      )}
                      {!isLatest && (
                        <button
                          onClick={() => handleRollback(entry.id)}
                          disabled={rollingBackId === entry.id}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg
                                   bg-yellow-500/10 border border-yellow-500/20
                                   text-[12px] font-medium text-yellow-400
                                   hover:bg-yellow-500/20 transition-colors
                                   disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <RotateCcw className={`w-3.5 h-3.5 ${rollingBackId === entry.id ? 'animate-spin' : ''}`} />
                          {rollingBackId === entry.id ? 'Rolling back...' : 'Rollback'}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
