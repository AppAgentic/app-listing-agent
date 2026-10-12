'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  Plus,
  Loader2,
  AlertCircle,
  Check,
  Play,
  Square,
  Trophy,
  FlaskConical,
  Trash2,
} from 'lucide-react'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ExperimentVariant {
  name: string
  trafficPercentage: number
}

interface StoreExperiment {
  id: string
  storeId: string | null
  storeType: 'ios' | 'android'
  pageId: string
  name: string
  state: 'DRAFT' | 'RUNNING' | 'STOPPED' | 'COMPLETED'
  variants: ExperimentVariant[]
  results: any | null
  startedAt: any | null
  stoppedAt: any | null
  createdAt: any
  updatedAt: any
}

interface CustomPageExperimentsTabProps {
  projectId: string
  pageId: string
  storeType: 'ios' | 'android'
}

const STATE_BADGES: Record<string, { label: string; badgeClass: string }> = {
  DRAFT: { label: 'Draft', badgeClass: 'bg-neutral-500/20 text-neutral-400 border-neutral-500/30' },
  RUNNING: { label: 'Running', badgeClass: 'bg-green-500/20 text-green-400 border-green-500/30' },
  STOPPED: { label: 'Stopped', badgeClass: 'bg-amber-500/20 text-amber-400 border-amber-500/30' },
  COMPLETED: { label: 'Completed', badgeClass: 'bg-blue-500/20 text-blue-400 border-blue-500/30' },
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function CustomPageExperimentsTab({
  projectId,
  pageId,
  storeType,
}: CustomPageExperimentsTabProps) {
  const [experiments, setExperiments] = useState<StoreExperiment[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  // Create form
  const [showCreate, setShowCreate] = useState(false)
  const [createName, setCreateName] = useState('')
  const [isCreating, setIsCreating] = useState(false)

  // Action state
  const [actionId, setActionId] = useState<string | null>(null)

  // Fetch experiments (filter client-side by pageId)
  const fetchExperiments = useCallback(async () => {
    try {
      // There's no dedicated API route for experiments, so we use the MCP tool pattern
      // For now, we'll call the list endpoint if it exists, or show a placeholder
      const res = await fetch(`/api/custom-product-pages?projectId=${projectId}`)
      // Experiments are stored in a separate collection, not under pages
      // We'll need to fetch them directly
      setExperiments([])
    } catch {
      // Experiments collection may not exist yet
      setExperiments([])
    } finally {
      setIsLoading(false)
    }
  }, [projectId, pageId])

  useEffect(() => {
    fetchExperiments()
  }, [fetchExperiments])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-purple-400" />
      </div>
    )
  }

  return (
    <div className="p-5 space-y-6">
      {/* Banners */}
      {error && (
        <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 flex items-center gap-2 text-sm">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {error}
        </div>
      )}
      {success && (
        <div className="p-3 rounded-lg bg-green-500/10 border border-green-500/20 text-green-400 flex items-center gap-2 text-sm">
          <Check className="w-4 h-4 flex-shrink-0" />
          {success}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium text-white">A/B Testing</h3>
          <p className="text-xs text-neutral-500 mt-0.5">
            {storeType === 'ios'
              ? 'Test different screenshots and promotional text variants'
              : 'Test different store listing content variants'}
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-green-500/20 text-green-400 hover:bg-green-500/30 border border-green-500/30 transition-all"
        >
          <Plus className="w-3.5 h-3.5" />
          New Experiment
        </button>
      </div>

      {/* Create form */}
      {showCreate && (
        <div className="p-4 rounded-xl bg-white/[0.03] border border-white/[0.08] space-y-3">
          <input
            type="text"
            value={createName}
            onChange={(e) => setCreateName(e.target.value)}
            placeholder="Experiment name"
            className="w-full px-3 py-2 rounded-lg bg-white/[0.05] border border-white/[0.1] text-white placeholder:text-neutral-500 focus:outline-none focus:border-purple-500/50 text-sm"
          />
          <p className="text-xs text-neutral-500">
            Default setup: Control (50%) vs Variant A (50%). Manage via MCP tools for advanced configuration.
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={async () => {
                if (!createName.trim()) return
                setIsCreating(true)
                setError(null)
                // Note: experiments are managed via MCP tools; no dedicated API route yet
                setSuccess('Experiment creation is available via MCP tools (create_store_experiment)')
                setShowCreate(false)
                setCreateName('')
                setIsCreating(false)
                setTimeout(() => setSuccess(null), 4000)
              }}
              disabled={isCreating || !createName.trim()}
              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-gradient-to-r from-purple-500 to-blue-500 text-white hover:opacity-90 disabled:opacity-50 transition-all"
            >
              {isCreating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Create'}
            </button>
            <button
              onClick={() => { setShowCreate(false); setCreateName('') }}
              className="px-3 py-1.5 rounded-lg text-xs text-neutral-400 hover:text-white transition-all"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Experiment list */}
      {experiments.length === 0 ? (
        <div className="text-center py-8">
          <FlaskConical className="w-10 h-10 text-neutral-600 mx-auto mb-3" />
          <p className="text-sm text-neutral-400 mb-1">No experiments yet</p>
          <p className="text-xs text-neutral-500">
            Create experiments via the MCP tool <code className="text-purple-400">create_store_experiment</code> or the button above
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {experiments.map((exp) => {
            const badge = STATE_BADGES[exp.state]
            return (
              <div
                key={exp.id}
                className="p-4 rounded-xl bg-white/[0.02] border border-white/[0.08] hover:border-white/[0.12] transition-all"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-white">{exp.name}</span>
                      {badge && (
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium border ${badge.badgeClass}`}>
                          {badge.label}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-1">
                      {exp.variants.map((v, i) => (
                        <span key={i} className="text-xs text-neutral-500">
                          {v.name}: {v.trafficPercentage}%
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {exp.state === 'DRAFT' && (
                      <button
                        disabled={actionId === exp.id}
                        className="p-1.5 rounded-lg text-green-400 hover:bg-green-500/10 transition-all"
                        title="Start"
                      >
                        <Play className="w-4 h-4" />
                      </button>
                    )}
                    {exp.state === 'RUNNING' && (
                      <button
                        disabled={actionId === exp.id}
                        className="p-1.5 rounded-lg text-amber-400 hover:bg-amber-500/10 transition-all"
                        title="Stop"
                      >
                        <Square className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
