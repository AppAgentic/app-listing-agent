'use client'

import { useState, useEffect, useCallback } from 'react'
import { X, Loader2, ArrowLeft, Check, Download } from 'lucide-react'
import type { ScreenshotSet, ScreenshotDisplayType } from '@/lib/firebase/firestore'

const SIZE_TO_DISPLAY_TYPE: Record<string, ScreenshotDisplayType> = {
  '6.9': 'APP_IPHONE_69',
  '6.5': 'APP_IPHONE_65',
  '6.3': 'APP_IPHONE_63',
  '6.1': 'APP_IPHONE_61',
  '5.5': 'APP_IPHONE_55',
  'ipad-13': 'APP_IPAD_PRO_13',
  'ipad-12.9': 'APP_IPAD_PRO_129',
  'ipad-11': 'APP_IPAD_PRO_11',
  'watch-ultra-3': 'APP_WATCH_ULTRA_3',
  'watch-ultra': 'APP_WATCH_ULTRA',
  'watch-10': 'APP_WATCH_SERIES_10',
  'watch-7': 'APP_WATCH_SERIES_7',
  'watch-4': 'APP_WATCH_SERIES_4',
  'watch-3': 'APP_WATCH_SERIES_3',
}

const DISPLAY_TYPE_NAMES: Record<string, string> = {
  'APP_IPHONE_69': '6.9" iPhone',
  'APP_IPHONE_65': '6.5" iPhone',
  'APP_IPHONE_63': '6.3" iPhone',
  'APP_IPHONE_61': '6.1" iPhone',
  'APP_IPHONE_55': '5.5" iPhone',
  'APP_IPAD_PRO_13': '13" iPad Pro',
  'APP_IPAD_PRO_129': '12.9" iPad Pro',
  'APP_IPAD_PRO_11': '11" iPad Pro',
  'APP_WATCH_ULTRA_3': 'Apple Watch Ultra 3',
  'APP_WATCH_ULTRA': 'Apple Watch Ultra',
  'APP_WATCH_SERIES_10': 'Apple Watch Series 10/11',
  'APP_WATCH_SERIES_7': 'Apple Watch Series 7-9',
  'APP_WATCH_SERIES_4': 'Apple Watch Series 4-6 / SE',
  'APP_WATCH_SERIES_3': 'Apple Watch Series 3',
}

interface JobResult {
  index: number
  headline: string
  success: boolean
  originalUrl?: string
  resizedUrls?: Record<string, string>
  error?: string
}

interface ScreenshotJob {
  id: string
  status: string
  toolName: string
  totalScreenshots: number
  completedScreenshots: number
  results: JobResult[]
  stats: { total: number; success: number; failed: number } | null
  createdAt: string | null
  updatedAt: string | null
}

interface ImportMcpScreenshotsModalProps {
  projectId: string
  primaryLocale: string
  existingScreenshotSets: Record<string, ScreenshotSet>
  onImportComplete: () => void
  onClose: () => void
}

function extractR2Key(url: string): string {
  const prefix = 'https://screens.appstorecopilot.com/'
  if (url.startsWith(prefix)) {
    return url.slice(prefix.length)
  }
  return ''
}

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMins / 60)
  const diffDays = Math.floor(diffHours / 24)

  if (diffMins < 1) return 'Just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`
  return date.toLocaleDateString()
}

export function ImportMcpScreenshotsModal({
  projectId,
  primaryLocale,
  existingScreenshotSets,
  onImportComplete,
  onClose,
}: ImportMcpScreenshotsModalProps) {
  const [jobs, setJobs] = useState<ScreenshotJob[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedJob, setSelectedJob] = useState<ScreenshotJob | null>(null)
  const [selectedSizes, setSelectedSizes] = useState<Set<string>>(new Set())
  const [importing, setImporting] = useState(false)

  const loadJobs = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const res = await fetch(`/api/screenshots/jobs?projectId=${projectId}`)
      const data = await res.json()
      if (data.success) {
        setJobs(data.jobs)
      } else {
        setError(data.error || 'Failed to load jobs')
      }
    } catch {
      setError('Failed to load MCP screenshot jobs')
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    loadJobs()
  }, [loadJobs])

  // When a job is selected, auto-select all available sizes
  useEffect(() => {
    if (selectedJob) {
      const sizes = new Set<string>()
      for (const result of selectedJob.results) {
        if (result.success && result.resizedUrls) {
          for (const size of Object.keys(result.resizedUrls)) {
            sizes.add(size)
          }
        }
      }
      // If no resized URLs, offer original
      if (sizes.size === 0) {
        sizes.add('original')
      }
      setSelectedSizes(sizes)
    }
  }, [selectedJob])

  const availableSizes = selectedJob
    ? Array.from(new Set(
        selectedJob.results
          .filter(r => r.success && r.resizedUrls)
          .flatMap(r => Object.keys(r.resizedUrls!))
      ))
    : []

  const handleToggleSize = (size: string) => {
    setSelectedSizes(prev => {
      const next = new Set(prev)
      if (next.has(size)) {
        next.delete(size)
      } else {
        next.add(size)
      }
      return next
    })
  }

  const handleImport = async () => {
    if (!selectedJob || selectedSizes.size === 0) return

    setImporting(true)
    try {
      const successResults = selectedJob.results.filter(r => r.success)
      const screenshotSets: Record<string, any> = {}

      for (const size of selectedSizes) {
        const displayType = SIZE_TO_DISPLAY_TYPE[size]
        if (!displayType) continue

        const screenshots = successResults
          .filter(r => r.resizedUrls?.[size])
          .map((r, i) => ({
            id: `mcp-${selectedJob.id}-${r.index}`,
            position: i,
            rawImageUrl: r.originalUrl || null,
            rawImageKey: r.originalUrl ? extractR2Key(r.originalUrl) : null,
            marketingImageUrl: r.resizedUrls![size],
            marketingImageKey: extractR2Key(r.resizedUrls![size]),
            headline: r.headline || '',
            generatedWith: 'gemini' as const,
            styleSource: null,
          }))

        if (screenshots.length === 0) continue

        screenshotSets[displayType] = {
          id: displayType,
          displayType,
          locale: primaryLocale,
          screenshots,
          styleConfig: null,
        }
      }

      if (Object.keys(screenshotSets).length === 0) {
        setError('No screenshots to import for selected sizes')
        setImporting(false)
        return
      }

      const res = await fetch('/api/screenshots/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          screenshotSets,
          source: 'ai_generation',
          sourceDetails: `Imported from MCP job ${selectedJob.id}`,
          createHistoryEntry: true,
        }),
      })

      const data = await res.json()
      if (data.success) {
        onImportComplete()
      } else {
        setError(data.error || 'Import failed')
      }
    } catch {
      setError('Import failed')
    } finally {
      setImporting(false)
    }
  }

  const successResults = selectedJob?.results.filter(r => r.success) || []

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
      <div className="bg-[#0a0a0a] border border-white/[0.08] rounded-2xl max-w-3xl w-full max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="p-5 border-b border-white/[0.08] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            {selectedJob && (
              <button
                onClick={() => setSelectedJob(null)}
                className="text-neutral-400 hover:text-white transition-colors"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
            )}
            <h2 className="text-lg font-semibold text-white">
              {selectedJob ? 'Import Screenshots' : 'MCP Generated Screenshots'}
            </h2>
          </div>
          <button onClick={onClose} className="text-neutral-400 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5">
          {error && (
            <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
              {error}
            </div>
          )}

          {loading ? (
            <div className="flex flex-col items-center justify-center py-16 text-neutral-500">
              <Loader2 className="w-6 h-6 animate-spin mb-3" />
              <p className="text-sm">Loading MCP jobs...</p>
            </div>
          ) : !selectedJob ? (
            /* View 1: Job List */
            jobs.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <Download className="w-8 h-8 text-neutral-600 mb-3" />
                <p className="text-neutral-500 text-sm mb-1">No MCP-generated screenshots found</p>
                <p className="text-neutral-600 text-xs">
                  Use the MCP tools (generate_screenshot_set or generate_screenshots_from_plan) to generate screenshots first.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {jobs.map(job => {
                  const previews = job.results.filter(r => r.success && r.originalUrl).slice(0, 4)
                  const sizes = Array.from(new Set(
                    job.results
                      .filter(r => r.success && r.resizedUrls)
                      .flatMap(r => Object.keys(r.resizedUrls!))
                  ))

                  return (
                    <button
                      key={job.id}
                      onClick={() => setSelectedJob(job)}
                      className="w-full text-left p-4 rounded-xl bg-white/[0.02] border border-white/[0.08]
                               hover:bg-white/[0.05] hover:border-white/[0.15] transition-all"
                    >
                      <div className="flex items-start justify-between mb-3">
                        <div>
                          <p className="text-sm font-medium text-white">
                            {job.stats?.success || job.totalScreenshots} screenshots
                          </p>
                          <p className="text-xs text-neutral-500 mt-0.5">
                            {job.createdAt ? formatRelativeTime(job.createdAt) : 'Unknown date'}
                            {sizes.length > 0 && (
                              <span className="ml-2">
                                {sizes.map(s => SIZE_TO_DISPLAY_TYPE[s] ? DISPLAY_TYPE_NAMES[SIZE_TO_DISPLAY_TYPE[s]] : s).join(', ')}
                              </span>
                            )}
                          </p>
                        </div>
                        <span className="text-xs text-neutral-600 font-mono">{job.toolName}</span>
                      </div>

                      {/* Thumbnail previews */}
                      {previews.length > 0 && (
                        <div className="flex gap-2">
                          {previews.map((r, i) => (
                            <div
                              key={i}
                              className="w-12 h-24 rounded-md overflow-hidden bg-white/[0.03] border border-white/[0.06]"
                            >
                              <img
                                src={r.originalUrl}
                                alt=""
                                className="w-full h-full object-cover"
                              />
                            </div>
                          ))}
                          {job.stats && job.stats.success > 4 && (
                            <div className="w-12 h-24 rounded-md bg-white/[0.03] border border-white/[0.06] flex items-center justify-center">
                              <span className="text-xs text-neutral-500">+{job.stats.success - 4}</span>
                            </div>
                          )}
                        </div>
                      )}
                    </button>
                  )
                })}
              </div>
            )
          ) : (
            /* View 2: Job Detail + Import */
            <div>
              {/* Size selection */}
              {availableSizes.length > 0 && (
                <div className="mb-5">
                  <p className="text-xs uppercase tracking-wider text-neutral-500 mb-2">Import to device sizes</p>
                  <div className="flex flex-wrap gap-2">
                    {availableSizes.map(size => {
                      const displayType = SIZE_TO_DISPLAY_TYPE[size]
                      const name = displayType ? DISPLAY_TYPE_NAMES[displayType] : size
                      const isSelected = selectedSizes.has(size)
                      const exists = displayType && existingScreenshotSets[displayType]?.screenshots?.length > 0

                      return (
                        <button
                          key={size}
                          onClick={() => handleToggleSize(size)}
                          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                            isSelected
                              ? 'bg-blue-500/15 text-blue-400 border-blue-500/30'
                              : 'bg-white/[0.03] text-neutral-500 border-white/[0.08] hover:border-white/[0.15]'
                          }`}
                        >
                          {isSelected && <Check className="w-3 h-3" />}
                          {name}
                          {exists && <span className="text-amber-400 text-[10px]">(has existing)</span>}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Screenshot grid */}
              <p className="text-xs uppercase tracking-wider text-neutral-500 mb-2">
                {successResults.length} screenshots
              </p>
              <div className="grid grid-cols-4 gap-3">
                {successResults.map(result => (
                  <div key={result.index} className="space-y-1.5">
                    <div
                      className="rounded-lg overflow-hidden bg-white/[0.03] border border-white/[0.06]"
                      style={{ aspectRatio: '9 / 19.5' }}
                    >
                      <img
                        src={result.originalUrl}
                        alt={result.headline}
                        className="w-full h-full object-cover"
                      />
                    </div>
                    <p className="text-[10px] text-neutral-500 line-clamp-2 leading-tight">
                      {result.headline}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        {selectedJob && (
          <div className="p-5 border-t border-white/[0.08] shrink-0">
            <button
              onClick={handleImport}
              disabled={importing || selectedSizes.size === 0}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium
                       bg-blue-500 text-white hover:bg-blue-600
                       disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              {importing ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Download className="w-4 h-4" />
              )}
              {importing
                ? 'Importing...'
                : `Import ${successResults.length} screenshots to ${selectedSizes.size} device ${selectedSizes.size === 1 ? 'size' : 'sizes'}`
              }
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
