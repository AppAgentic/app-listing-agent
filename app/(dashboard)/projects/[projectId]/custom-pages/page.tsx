'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'next/navigation'
import {
  LayoutTemplate,
  RefreshCw,
  Upload,
  Plus,
  Loader2,
  Check,
  AlertCircle,
  ChevronRight,
  X,
  Globe,
  MapPin,
  ExternalLink,
} from 'lucide-react'
import CustomPageDetailPanel from '@/components/custom-pages/CustomPageDetailPanel'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CPPLocalization {
  locale: string
  promotionalText: string | null
  screenshots: any[]
  appStoreLocalizationId: string | null
}

interface CustomProductPage {
  id: string
  appStoreId: string | null
  name: string
  url: string | null
  state: string | null
  syncStatus: 'synced' | 'local_changes' | 'pending_creation'
  localizations: CPPLocalization[]
}

interface CSLLocalization {
  locale: string
  title: string
  shortDescription: string
  fullDescription: string
  iconUrl: string | null
  iconKey: string | null
  featureGraphicUrl: string | null
  featureGraphicKey: string | null
  videoUrl: string | null
  screenshots: any[]
}

interface CustomStoreListing {
  id: string
  playStoreId: string | null
  name: string
  targetingType: 'COUNTRY' | 'PRE_REGISTRATION' | 'INSTALL_STATE'
  targetingCountries: string[]
  syncStatus: 'synced' | 'local_changes' | 'pending_creation'
  localizations: CSLLocalization[]
}

type CustomPage = CustomProductPage | CustomStoreListing

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SYNC_STATUS_LABELS: Record<string, { label: string; badgeClass: string }> = {
  synced: {
    label: 'Synced',
    badgeClass: 'bg-green-500/20 text-green-400 border-green-500/30',
  },
  local_changes: {
    label: 'Modified',
    badgeClass: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  },
  pending_creation: {
    label: 'New',
    badgeClass: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  },
}

const CPP_STATE_LABELS: Record<string, { label: string; badgeClass: string }> = {
  PREPARE_FOR_SUBMISSION: {
    label: 'Prepare for Submission',
    badgeClass: 'bg-neutral-500/20 text-neutral-400 border-neutral-500/30',
  },
  WAITING_FOR_REVIEW: {
    label: 'Waiting for Review',
    badgeClass: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  },
  IN_REVIEW: {
    label: 'In Review',
    badgeClass: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  },
  APPROVED: {
    label: 'Approved',
    badgeClass: 'bg-green-500/20 text-green-400 border-green-500/30',
  },
  REJECTED: {
    label: 'Rejected',
    badgeClass: 'bg-red-500/20 text-red-400 border-red-500/30',
  },
  READY_FOR_DISTRIBUTION: {
    label: 'Ready',
    badgeClass: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  },
}

const TARGETING_LABELS: Record<string, string> = {
  COUNTRY: 'Country',
  PRE_REGISTRATION: 'Pre-Registration',
  INSTALL_STATE: 'Install State',
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function CustomPagesPage() {
  const params = useParams()
  const projectId = params.projectId as string

  // Project info
  const [storeType, setStoreType] = useState<'ios' | 'android' | null>(null)
  const [projectName, setProjectName] = useState('')

  // Data
  const [pages, setPages] = useState<CustomPage[]>([])

  // UI state
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [isPulling, setIsPulling] = useState(false)
  const [isPushing, setIsPushing] = useState(false)

  // Modals
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showPullModal, setShowPullModal] = useState(false)
  const [showPushModal, setShowPushModal] = useState(false)
  const [pullResults, setPullResults] = useState<{ created: string[]; updated: string[]; errors: any[] } | null>(null)
  const [pushResults, setPushResults] = useState<{ created: string[]; updated: string[]; errors: any[] } | null>(null)

  // Detail panel
  const [selectedPage, setSelectedPage] = useState<CustomPage | null>(null)

  // Create form
  const [createName, setCreateName] = useState('')
  const [createTargetingType, setCreateTargetingType] = useState<'COUNTRY' | 'PRE_REGISTRATION' | 'INSTALL_STATE'>('COUNTRY')
  const [createTargetingCountries, setCreateTargetingCountries] = useState('')
  const [isCreating, setIsCreating] = useState(false)

  const isIOS = storeType === 'ios'

  // ---------------------------------------------------------------------------
  // Data fetching
  // ---------------------------------------------------------------------------

  const fetchData = useCallback(async (showLoading = true) => {
    if (showLoading) setIsLoading(true)
    setError(null)

    try {
      // Fetch project info
      const projectRes = await fetch(`/api/projects/${projectId}`)
      const projectData = await projectRes.json()
      const type = projectData.project?.storeType || 'ios'
      setStoreType(type)
      setProjectName(projectData.project?.name || 'My App')

      // Fetch pages/listings
      const endpoint = type === 'ios'
        ? `/api/custom-product-pages?projectId=${projectId}`
        : `/api/custom-store-listings?projectId=${projectId}`
      const res = await fetch(endpoint)
      const data = await res.json()

      setPages(type === 'ios' ? data.pages || [] : data.listings || [])
    } catch (err: any) {
      setError(err.message || 'Failed to load data')
    } finally {
      setIsLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  // ---------------------------------------------------------------------------
  // Pull from store
  // ---------------------------------------------------------------------------

  const handlePull = async () => {
    setIsPulling(true)
    setPullResults(null)
    setShowPullModal(true)
    setError(null)

    try {
      const endpoint = isIOS
        ? '/api/custom-product-pages/pull'
        : '/api/custom-store-listings/pull'
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId }),
      })
      const data = await res.json()

      if (!data.success) throw new Error(data.error || 'Pull failed')
      setPullResults({ created: data.created, updated: data.updated, errors: data.errors })
      await fetchData(false)
    } catch (err: any) {
      setPullResults({ created: [], updated: [], errors: [{ error: err.message }] })
    } finally {
      setIsPulling(false)
    }
  }

  // ---------------------------------------------------------------------------
  // Push to store
  // ---------------------------------------------------------------------------

  const handlePush = async () => {
    setIsPushing(true)
    setPushResults(null)
    setShowPushModal(true)
    setError(null)

    try {
      const endpoint = isIOS
        ? '/api/custom-product-pages/push'
        : '/api/custom-store-listings/push'
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, pushAll: true }),
      })
      const data = await res.json()

      setPushResults({
        created: data.created || [],
        updated: data.updated || [],
        errors: data.errors || (data.error ? [{ error: data.error }] : []),
      })
      await fetchData(false)
      if (!data.success) return
    } catch (err: any) {
      setPushResults({ created: [], updated: [], errors: [{ error: err.message }] })
    } finally {
      setIsPushing(false)
    }
  }

  // ---------------------------------------------------------------------------
  // Create
  // ---------------------------------------------------------------------------

  const handleCreate = async () => {
    if (!createName.trim()) return
    setIsCreating(true)
    setError(null)

    try {
      const endpoint = isIOS
        ? '/api/custom-product-pages'
        : '/api/custom-store-listings'
      const body: any = { projectId, name: createName.trim() }

      if (!isIOS) {
        body.targetingType = createTargetingType
        if (createTargetingType === 'COUNTRY' && createTargetingCountries.trim()) {
          body.targetingCountries = createTargetingCountries.split(',').map(c => c.trim().toUpperCase()).filter(Boolean)
        }
      }

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!data.success) throw new Error(data.error || 'Create failed')

      setSuccess(`Created "${createName.trim()}" successfully`)
      setShowCreateModal(false)
      setCreateName('')
      setCreateTargetingCountries('')
      await fetchData(false)
      setTimeout(() => setSuccess(null), 3000)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setIsCreating(false)
    }
  }

  // ---------------------------------------------------------------------------
  // Delete
  // ---------------------------------------------------------------------------

  const handleDelete = async (page: CustomPage) => {
    try {
      const endpoint = isIOS
        ? `/api/custom-product-pages/${page.id}`
        : `/api/custom-store-listings/${page.id}`
      const res = await fetch(endpoint, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId }),
      })
      const data = await res.json()
      if (!data.success) throw new Error(data.error || 'Delete failed')

      setSelectedPage(null)
      setSuccess('Deleted successfully')
      await fetchData(false)
      setTimeout(() => setSuccess(null), 3000)
    } catch (err: any) {
      setError(err.message)
    }
  }

  // ---------------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------------

  const renderSyncBadge = (status: string) => {
    const info = SYNC_STATUS_LABELS[status]
    if (!info) return null
    return (
      <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${info.badgeClass}`}>
        {info.label}
      </span>
    )
  }

  const renderStateBadge = (state: string | null) => {
    if (!state) return null
    const info = CPP_STATE_LABELS[state]
    if (!info) return null
    return (
      <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${info.badgeClass}`}>
        {info.label}
      </span>
    )
  }

  const getPageSubtitle = (page: CustomPage) => {
    if (isIOS) {
      const cpp = page as CustomProductPage
      const locCount = cpp.localizations?.length || 0
      return `${locCount} locale${locCount !== 1 ? 's' : ''}`
    } else {
      const csl = page as CustomStoreListing
      const parts: string[] = []
      parts.push(TARGETING_LABELS[csl.targetingType] || csl.targetingType)
      if (csl.targetingCountries?.length) {
        parts.push(`${csl.targetingCountries.length} countries`)
      }
      const locCount = csl.localizations?.length || 0
      parts.push(`${locCount} locale${locCount !== 1 ? 's' : ''}`)
      return parts.join(' · ')
    }
  }

  // ---------------------------------------------------------------------------
  // Loading state
  // ---------------------------------------------------------------------------

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-6 h-6 animate-spin text-purple-400" />
      </div>
    )
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const title = isIOS ? 'Custom Product Pages' : 'Custom Store Listings'

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">{title}</h1>
          <p className="text-sm text-neutral-400 mt-1">
            {isIOS
              ? 'Create targeted App Store page variants with custom screenshots and promotional text'
              : 'Create targeted store listing variants with custom content for different audiences'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Pull */}
          <button
            onClick={handlePull}
            disabled={isPulling}
            className="flex items-center gap-2 px-3 sm:px-4 py-2 rounded-lg text-sm font-medium bg-white/[0.05] text-neutral-300 hover:bg-white/[0.08] hover:text-white disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            {isPulling ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            <span className="hidden sm:inline">Pull from Store</span>
            <span className="sm:hidden">Pull</span>
          </button>
          {/* Push */}
          <button
            onClick={handlePush}
            disabled={isPushing || pages.every(p => p.syncStatus === 'synced')}
            className="flex items-center gap-2 px-3 sm:px-4 py-2 rounded-lg text-sm font-medium bg-gradient-to-r from-purple-500 to-blue-500 text-white hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            {isPushing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            Push to Store
          </button>
          {/* Create */}
          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-2 px-3 sm:px-4 py-2 rounded-lg text-sm font-medium bg-green-500/20 text-green-400 hover:bg-green-500/30 border border-green-500/30 transition-all"
          >
            <Plus className="w-4 h-4" />
            New
          </button>
        </div>
      </div>

      {/* Banners */}
      {error && (
        <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {error}
        </div>
      )}
      {success && (
        <div className="p-4 rounded-xl bg-green-500/10 border border-green-500/20 text-green-400 flex items-center gap-2">
          <Check className="w-4 h-4 flex-shrink-0" />
          {success}
        </div>
      )}

      {/* Page List */}
      {pages.length === 0 ? (
        <div className="text-center py-12">
          <LayoutTemplate className="w-12 h-12 text-neutral-600 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-white mb-2">No {isIOS ? 'custom product pages' : 'custom store listings'} yet</h3>
          <p className="text-neutral-400 mb-4">
            Pull from {isIOS ? 'App Store Connect' : 'Google Play Console'} or create new ones
          </p>
          <div className="flex items-center justify-center gap-3">
            <button
              onClick={handlePull}
              disabled={isPulling}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-white/[0.05] text-neutral-300 hover:bg-white/[0.08] hover:text-white disabled:opacity-50 transition-all"
            >
              <RefreshCw className="w-4 h-4" />
              Pull from Store
            </button>
            <button
              onClick={() => setShowCreateModal(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-green-500/20 text-green-400 hover:bg-green-500/30 border border-green-500/30 transition-all"
            >
              <Plus className="w-4 h-4" />
              Create New
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {pages.map((page) => (
            <div
              key={page.id}
              onClick={() => setSelectedPage(page)}
              className="group p-4 rounded-xl bg-white/[0.02] border border-white/[0.08] hover:border-purple-500/30 hover:bg-white/[0.04] transition-all cursor-pointer"
            >
              <div className="flex items-center justify-between gap-4">
                {/* Left: icon + name + metadata */}
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div className={`p-2.5 rounded-xl flex-shrink-0 ${isIOS ? 'bg-blue-500/20 text-blue-400' : 'bg-green-500/20 text-green-400'}`}>
                    <LayoutTemplate className="w-5 h-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-white">{page.name}</span>
                      {isIOS && (page as CustomProductPage).url && (
                        <ExternalLink className="w-3 h-3 text-neutral-500" />
                      )}
                    </div>
                    <div className="mt-1 text-xs text-neutral-500">
                      {getPageSubtitle(page)}
                    </div>
                  </div>
                </div>
                {/* Right: badges + chevron */}
                <div className="flex items-center gap-2 flex-shrink-0">
                  <div className="hidden sm:flex items-center gap-1.5">
                    {isIOS && renderStateBadge((page as CustomProductPage).state)}
                    {renderSyncBadge(page.syncStatus)}
                  </div>
                  <div className="sm:hidden">
                    {page.syncStatus !== 'synced'
                      ? renderSyncBadge(page.syncStatus)
                      : isIOS && renderStateBadge((page as CustomProductPage).state)
                    }
                  </div>
                  <ChevronRight className="w-5 h-5 text-neutral-500 group-hover:text-white transition-colors" />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Detail Panel */}
      {selectedPage && (
        <CustomPageDetailPanel
          projectId={projectId}
          page={selectedPage}
          storeType={storeType!}
          onClose={() => setSelectedPage(null)}
          onUpdated={() => fetchData(false)}
          onDelete={() => handleDelete(selectedPage)}
        />
      )}

      {/* Create Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[9999] p-4 backdrop-blur-sm">
          <div className="absolute inset-0" onClick={() => setShowCreateModal(false)} />
          <div className="relative bg-[#1a1a1a] rounded-2xl border border-white/[0.08] w-full max-w-md shadow-2xl">
            <div className="p-5 border-b border-white/[0.08] flex items-center justify-between">
              <h2 className="text-lg font-semibold text-white">
                New {isIOS ? 'Custom Product Page' : 'Custom Store Listing'}
              </h2>
              <button onClick={() => setShowCreateModal(false)} className="p-2 rounded-lg text-neutral-400 hover:text-white hover:bg-white/[0.05] transition-all">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              {/* Name */}
              <div>
                <label className="block text-sm font-medium text-neutral-300 mb-1.5">
                  {isIOS ? 'Reference Name' : 'Listing Name'}
                </label>
                <input
                  type="text"
                  value={createName}
                  onChange={(e) => setCreateName(e.target.value)}
                  maxLength={isIOS ? 64 : undefined}
                  placeholder={isIOS ? 'e.g., Holiday Campaign' : 'e.g., US Holiday Promo'}
                  className="w-full px-3 py-2 rounded-lg bg-white/[0.05] border border-white/[0.1] text-white placeholder:text-neutral-500 focus:outline-none focus:border-purple-500/50 text-sm"
                />
                {isIOS && (
                  <p className="mt-1 text-xs text-neutral-500">{createName.length}/64 characters</p>
                )}
              </div>

              {/* Android: Targeting */}
              {!isIOS && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-neutral-300 mb-1.5">
                      Targeting Type
                    </label>
                    <select
                      value={createTargetingType}
                      onChange={(e) => setCreateTargetingType(e.target.value as any)}
                      className="w-full px-3 py-2 rounded-lg bg-white/[0.05] border border-white/[0.1] text-white focus:outline-none focus:border-purple-500/50 text-sm"
                    >
                      <option value="COUNTRY">Country</option>
                      <option value="PRE_REGISTRATION">Pre-Registration</option>
                      <option value="INSTALL_STATE">Install State</option>
                    </select>
                  </div>

                  {createTargetingType === 'COUNTRY' && (
                    <div>
                      <label className="block text-sm font-medium text-neutral-300 mb-1.5">
                        Target Countries
                      </label>
                      <input
                        type="text"
                        value={createTargetingCountries}
                        onChange={(e) => setCreateTargetingCountries(e.target.value)}
                        placeholder="US, GB, DE (comma-separated country codes)"
                        className="w-full px-3 py-2 rounded-lg bg-white/[0.05] border border-white/[0.1] text-white placeholder:text-neutral-500 focus:outline-none focus:border-purple-500/50 text-sm"
                      />
                    </div>
                  )}
                </>
              )}

              <button
                onClick={handleCreate}
                disabled={isCreating || !createName.trim()}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium bg-gradient-to-r from-purple-500 to-blue-500 text-white hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                {isCreating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Pull Modal */}
      {showPullModal && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[9999] p-4 backdrop-blur-sm">
          <div className="absolute inset-0" onClick={() => !isPulling && setShowPullModal(false)} />
          <div className="relative bg-[#1a1a1a] rounded-2xl border border-white/[0.08] w-full max-w-md shadow-2xl">
            <div className="p-5 border-b border-white/[0.08] flex items-center justify-between">
              <h2 className="text-lg font-semibold text-white">Pull from Store</h2>
              {!isPulling && (
                <button onClick={() => setShowPullModal(false)} className="p-2 rounded-lg text-neutral-400 hover:text-white hover:bg-white/[0.05] transition-all">
                  <X className="w-5 h-5" />
                </button>
              )}
            </div>
            <div className="p-5">
              {isPulling ? (
                <div className="flex flex-col items-center gap-3 py-6">
                  <Loader2 className="w-8 h-8 animate-spin text-purple-400" />
                  <p className="text-sm text-neutral-300">
                    Pulling {isIOS ? 'custom product pages' : 'custom store listings'}...
                  </p>
                </div>
              ) : pullResults ? (
                <div className="space-y-3">
                  {pullResults.created.length > 0 && (
                    <div className="p-3 rounded-lg bg-green-500/10 border border-green-500/20">
                      <p className="text-sm font-medium text-green-400 mb-1">Created ({pullResults.created.length})</p>
                      {pullResults.created.map((name, i) => (
                        <p key={i} className="text-xs text-green-300/70">{name}</p>
                      ))}
                    </div>
                  )}
                  {pullResults.updated.length > 0 && (
                    <div className="p-3 rounded-lg bg-blue-500/10 border border-blue-500/20">
                      <p className="text-sm font-medium text-blue-400 mb-1">Updated ({pullResults.updated.length})</p>
                      {pullResults.updated.map((name, i) => (
                        <p key={i} className="text-xs text-blue-300/70">{name}</p>
                      ))}
                    </div>
                  )}
                  {pullResults.errors.length > 0 && (
                    <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20">
                      <p className="text-sm font-medium text-red-400 mb-1">Errors ({pullResults.errors.length})</p>
                      {pullResults.errors.map((err, i) => (
                        <p key={i} className="text-xs text-red-300/70">{err.error || err.message}</p>
                      ))}
                    </div>
                  )}
                  {pullResults.created.length === 0 && pullResults.updated.length === 0 && pullResults.errors.length === 0 && (
                    <p className="text-sm text-neutral-400 text-center py-4">
                      No {isIOS ? 'custom product pages' : 'custom store listings'} found in store
                    </p>
                  )}
                  <button
                    onClick={() => setShowPullModal(false)}
                    className="w-full px-4 py-2 rounded-lg text-sm font-medium bg-white/[0.05] text-neutral-300 hover:bg-white/[0.08] hover:text-white transition-all"
                  >
                    Done
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      )}

      {/* Push Modal */}
      {showPushModal && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[9999] p-4 backdrop-blur-sm">
          <div className="absolute inset-0" onClick={() => !isPushing && setShowPushModal(false)} />
          <div className="relative bg-[#1a1a1a] rounded-2xl border border-white/[0.08] w-full max-w-md shadow-2xl">
            <div className="p-5 border-b border-white/[0.08] flex items-center justify-between">
              <h2 className="text-lg font-semibold text-white">Push to Store</h2>
              {!isPushing && (
                <button onClick={() => setShowPushModal(false)} className="p-2 rounded-lg text-neutral-400 hover:text-white hover:bg-white/[0.05] transition-all">
                  <X className="w-5 h-5" />
                </button>
              )}
            </div>
            <div className="p-5">
              {isPushing ? (
                <div className="flex flex-col items-center gap-3 py-6">
                  <Loader2 className="w-8 h-8 animate-spin text-purple-400" />
                  <p className="text-sm text-neutral-300">
                    Pushing {isIOS ? 'custom product pages' : 'custom store listings'}...
                  </p>
                </div>
              ) : pushResults ? (
                <div className="space-y-3">
                  {pushResults.created.length > 0 && (
                    <div className="p-3 rounded-lg bg-green-500/10 border border-green-500/20">
                      <p className="text-sm font-medium text-green-400 mb-1">Created ({pushResults.created.length})</p>
                      {pushResults.created.map((name, i) => (
                        <p key={i} className="text-xs text-green-300/70">{name}</p>
                      ))}
                    </div>
                  )}
                  {pushResults.updated.length > 0 && (
                    <div className="p-3 rounded-lg bg-blue-500/10 border border-blue-500/20">
                      <p className="text-sm font-medium text-blue-400 mb-1">Updated ({pushResults.updated.length})</p>
                      {pushResults.updated.map((name, i) => (
                        <p key={i} className="text-xs text-blue-300/70">{name}</p>
                      ))}
                    </div>
                  )}
                  {pushResults.errors.length > 0 && (
                    <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20">
                      <p className="text-sm font-medium text-red-400 mb-1">Errors ({pushResults.errors.length})</p>
                      {pushResults.errors.map((err, i) => (
                        <p key={i} className="text-xs text-red-300/70">{err.name ? `${err.name}: ` : ''}{err.error || err.message}</p>
                      ))}
                    </div>
                  )}
                  {pushResults.created.length === 0 && pushResults.updated.length === 0 && pushResults.errors.length === 0 && (
                    <p className="text-sm text-neutral-400 text-center py-4">
                      No changes to push
                    </p>
                  )}
                  <button
                    onClick={() => setShowPushModal(false)}
                    className="w-full px-4 py-2 rounded-lg text-sm font-medium bg-white/[0.05] text-neutral-300 hover:bg-white/[0.08] hover:text-white transition-all"
                  >
                    Done
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
