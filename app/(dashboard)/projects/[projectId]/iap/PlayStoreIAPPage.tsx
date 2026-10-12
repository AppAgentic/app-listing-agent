'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import {
  Package,
  Coins,
  CreditCard,
  RefreshCw,
  Upload,
  Plus,
  Loader2,
  Check,
  AlertCircle,
  ChevronDown,
  ChevronRight,
  DollarSign,
  Sparkles,
  Trash2,
  AlertTriangle,
  X,
  Clock,
  Play,
  Pause,
  CheckCircle2,
  XCircle,
  RotateCcw,
  CloudUpload,
  Settings,
  Gift,
} from 'lucide-react'
import PlayStoreProductDetailPanel from '@/components/iap/PlayStoreProductDetailPanel'
import { useInternalIntegrations } from '@/components/dashboard/internal-integrations-context'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PlayStoreProduct {
  id: string
  sku: string
  productType: 'ONE_TIME'
  status: 'DRAFT' | 'ACTIVE' | 'INACTIVE' | null
  syncStatus: 'synced' | 'local_changes' | 'pending_creation'
  defaultLanguage: string
  defaultPriceUsd: number | null
  title?: string
  description?: string
}

interface PlayStoreBasePlan {
  basePlanId: string
  state: 'DRAFT' | 'ACTIVE' | 'INACTIVE' | null
  type: 'AUTO_RENEWING' | 'PREPAID'
  billingPeriodDuration?: string
  gracePeriodDuration?: string
  defaultPriceUsd: number | null
}

interface PlayStoreSubscription {
  id: string
  productId: string
  syncStatus: 'synced' | 'local_changes' | 'pending_creation'
  defaultLanguage: string
  basePlans: PlayStoreBasePlan[]
  title?: string
  description?: string
}

interface PlayStoreIAPPageProps {
  projectId: string
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BILLING_PERIOD_LABELS: Record<string, string> = {
  P1W: 'Weekly',
  P1M: 'Monthly',
  P3M: 'Quarterly',
  P6M: 'Semi-Annual',
  P1Y: 'Annual',
}

const BILLING_PERIOD_OPTIONS = [
  { value: 'P1W', label: 'Weekly' },
  { value: 'P1M', label: 'Monthly' },
  { value: 'P3M', label: 'Quarterly' },
  { value: 'P6M', label: 'Semi-Annual' },
  { value: 'P1Y', label: 'Annual' },
]

const STATE_COLORS: Record<string, string> = {
  DRAFT: 'bg-neutral-500/20 text-neutral-400 border-neutral-500/30',
  ACTIVE: 'bg-green-500/20 text-green-400 border-green-500/30',
  INACTIVE: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
}

const SYNC_STATUS_LABELS: Record<string, { label: string; color: string; badgeClass: string }> = {
  synced: {
    label: 'Synced',
    color: 'text-green-400',
    badgeClass: 'bg-green-500/20 text-green-400 border-green-500/30',
  },
  local_changes: {
    label: 'Modified',
    color: 'text-yellow-400',
    badgeClass: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  },
  pending_creation: {
    label: 'New',
    color: 'text-blue-400',
    badgeClass: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  },
}

const TITLE_MAX = 55
const DESC_MAX = 80

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderStateBadge(state: string | null) {
  if (!state) return null
  const colorClass = STATE_COLORS[state] || 'bg-neutral-500/20 text-neutral-400 border-neutral-500/30'
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${colorClass}`}>
      {state.charAt(0) + state.slice(1).toLowerCase()}
    </span>
  )
}

function renderSyncBadge(status: string) {
  const cfg = SYNC_STATUS_LABELS[status]
  if (!cfg) return null
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${cfg.badgeClass}`}>
      {cfg.label}
    </span>
  )
}

function formatPrice(price: number | null | undefined) {
  if (price == null) return null
  return `$${price.toFixed(2)}`
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export default function PlayStoreIAPPage({ projectId }: PlayStoreIAPPageProps) {
  const internalIntegrationsEnabled = useInternalIntegrations()
  // Data state
  const [products, setProducts] = useState<PlayStoreProduct[]>([])
  const [subscriptions, setSubscriptions] = useState<PlayStoreSubscription[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  // Filter
  const [filter, setFilter] = useState<'all' | 'products' | 'subscriptions'>('all')

  // Selection
  const [selectedItem, setSelectedItem] = useState<{ id: string; type: 'product' | 'subscription'; initialTab?: string } | null>(null)

  // Create
  const [showCreateModal, setShowCreateModal] = useState(false)

  // Pull / Push
  const [isPulling, setIsPulling] = useState(false)
  const [isPushing, setIsPushing] = useState(false)
  const [pullResults, setPullResults] = useState<{
    status: 'pending' | 'pulling' | 'complete'
    summary?: { products: number; subscriptions: number }
    orphans?: { id: string; type: string; identifier: string }[]
    error?: string
  } | null>(null)
  const [showPullModal, setShowPullModal] = useState(false)
  const [pushProgress, setPushProgress] = useState<{
    status: 'starting' | 'pushing' | 'complete'
    items: { id: string; name: string; result?: string; error?: string; step?: string }[]
    created: string[]
    updated: string[]
    errors: { id: string; error: string }[]
  } | null>(null)
  const [showPushModal, setShowPushModal] = useState(false)

  // Orphan cleanup
  const [isDeletingOrphans, setIsDeletingOrphans] = useState(false)

  // RevenueCat state
  const [revenueCatStatus, setRevenueCatStatus] = useState<{
    configured: boolean
    connected: boolean
    apps: { id: string; name: string; type: string; bundle_id?: string; package_name?: string }[]
    products: { id: string; store_identifier: string; type: string }[]
    error?: string
  } | null>(null)
  const [isSyncingToRevenueCat, setIsSyncingToRevenueCat] = useState(false)
  const [showRevenueCatSetup, setShowRevenueCatSetup] = useState(false)
  const [isCreatingRCApp, setIsCreatingRCApp] = useState(false)
  const [rcPackageName, setRcPackageName] = useState('')
  const [projectName, setProjectName] = useState('')

  // Expanded subscriptions (for base plan accordion)
  const [expandedSubs, setExpandedSubs] = useState<Set<string>>(new Set())

  // Offer counts per subscription → basePlanId → count
  const [offersBySubscription, setOffersBySubscription] = useState<Record<string, any[]>>({})

  // Enabled locales for Play Store
  const [enabledLocales, setEnabledLocales] = useState<string[]>(['en-US'])

  // -----------------------------------------------------------------------
  // Data fetching
  // -----------------------------------------------------------------------

  const fetchData = useCallback(
    async (showLoading = true) => {
      if (showLoading) setIsLoading(true)
      setError(null)
      try {
        const res = await fetch(`/api/playstore-iap?projectId=${projectId}`)
        if (!res.ok) throw new Error('Failed to fetch Play Store IAP data')
        const data = await res.json()
        setProducts(data.products || [])
        setSubscriptions(data.subscriptions || [])

        // Auto-expand subs
        const ids = new Set<string>((data.subscriptions || []).map((s: PlayStoreSubscription) => s.id))
        setExpandedSubs(ids)

        // Fetch offers for each subscription (in parallel)
        const subs = data.subscriptions || []
        if (subs.length > 0) {
          const offerResults: Record<string, any[]> = {}
          await Promise.all(subs.map(async (s: PlayStoreSubscription) => {
            try {
              const offersRes = await fetch(`/api/playstore-iap/${s.id}/offers?projectId=${projectId}`)
              if (offersRes.ok) {
                const offersData = await offersRes.json()
                offerResults[s.id] = offersData.offers || []
              }
            } catch { /* ignore */ }
          }))
          setOffersBySubscription(offerResults)
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load data')
      } finally {
        setIsLoading(false)
      }
    },
    [projectId],
  )

  useEffect(() => {
    fetchData()
  }, [fetchData])

  // -----------------------------------------------------------------------
  // RevenueCat
  // -----------------------------------------------------------------------

  const fetchRevenueCatStatus = useCallback(async () => {
    if (!internalIntegrationsEnabled) {
      setRevenueCatStatus(null)
      return
    }

    try {
      const response = await fetch(`/api/revenuecat/status?projectId=${projectId}`)
      if (response.ok) {
        const data = await response.json()
        setRevenueCatStatus(data)
      }
    } catch (err) {
      console.error('Failed to fetch RevenueCat status:', err)
    }
  }, [projectId, internalIntegrationsEnabled])

  // Fetch project info + RevenueCat status on mount
  useEffect(() => {
    const fetchProjectInfo = async () => {
      try {
        const res = await fetch(`/api/metadata?projectId=${projectId}`)
        if (res.ok) {
          const data = await res.json()
          setProjectName(data.project?.name || '')
          setRcPackageName(data.project?.playStorePackage || '')
          if (data.project?.enabledLocales?.length) {
            setEnabledLocales(data.project.enabledLocales)
          }
        }
      } catch {}
    }
    fetchProjectInfo()
    if (internalIntegrationsEnabled) {
      fetchRevenueCatStatus()
    } else {
      setRevenueCatStatus(null)
    }
  }, [projectId, fetchRevenueCatStatus, internalIntegrationsEnabled])

  const handleCreateRevenueCatApp = async () => {
    if (!rcPackageName) {
      setError('Package name is required')
      return
    }
    setIsCreatingRCApp(true)
    setError(null)
    try {
      const appName = `${projectName || 'My App'} (Android)`
      const response = await fetch('/api/revenuecat/apps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          name: appName,
          type: 'play_store',
          packageName: rcPackageName,
        }),
      })
      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to create app')
      }
      setSuccess('RevenueCat app created successfully')
      setShowRevenueCatSetup(false)
      fetchRevenueCatStatus()
      setTimeout(() => setSuccess(null), 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create app')
    } finally {
      setIsCreatingRCApp(false)
    }
  }

  const handleSyncToRevenueCat = async () => {
    if (!revenueCatStatus?.apps?.length) {
      setError('No RevenueCat app configured. Create one first.')
      return
    }
    setIsSyncingToRevenueCat(true)
    setError(null)
    try {
      const response = await fetch('/api/revenuecat/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          appId: revenueCatStatus.apps[0].id,
        }),
      })
      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to sync')
      }
      const data = await response.json()
      setSuccess(`Synced ${data.summary.created} products to RevenueCat (${data.summary.skipped} already existed)`)
      fetchRevenueCatStatus()
      setTimeout(() => setSuccess(null), 5000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to sync')
    } finally {
      setIsSyncingToRevenueCat(false)
    }
  }

  // -----------------------------------------------------------------------
  // Detail panel helpers
  // -----------------------------------------------------------------------

  const findSelectedItem = () => {
    if (!selectedItem) return null
    if (selectedItem.type === 'product') {
      return products.find((p) => p.id === selectedItem.id) ?? null
    }
    return subscriptions.find((s) => s.id === selectedItem.id) ?? null
  }

  // -----------------------------------------------------------------------
  // Pull
  // -----------------------------------------------------------------------

  const handlePull = async () => {
    setShowPullModal(true)
    setPullResults({ status: 'pending' })
    await new Promise((r) => setTimeout(r, 300))
    setPullResults({ status: 'pulling' })
    setIsPulling(true)
    setError(null)

    try {
      const res = await fetch('/api/playstore-iap/pull', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to pull from Play Store')
      }
      const data = await res.json()
      setPullResults({
        status: 'complete',
        summary: data.summary,
        orphans: data.orphanedProducts,
      })
      await fetchData(false)
    } catch (err) {
      setPullResults({
        status: 'complete',
        error: err instanceof Error ? err.message : 'Failed to pull',
      })
    } finally {
      setIsPulling(false)
    }
  }

  // -----------------------------------------------------------------------
  // Push (SSE)
  // -----------------------------------------------------------------------

  const handlePush = async (force = false) => {
    setShowPushModal(true)
    setIsPushing(true)
    setPushProgress({ status: 'starting', items: [], created: [], updated: [], errors: [] })

    try {
      const response = await fetch('/api/playstore-iap/push/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, pushAll: true, force }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to push to Play Store')
      }

      const reader = response.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        const chunks = buffer.split('\n\n')
        buffer = chunks.pop() || ''

        for (const chunk of chunks) {
          if (!chunk.trim()) continue
          try {
            // Parse SSE format: "event: <name>\ndata: <json>"
            const lines = chunk.split('\n')
            let eventType = ''
            let dataStr = ''
            for (const line of lines) {
              if (line.startsWith('event: ')) eventType = line.slice(7).trim()
              if (line.startsWith('data: ')) dataStr = line.slice(6)
            }
            if (!dataStr) continue
            const data = JSON.parse(dataStr)
            // Backend uses productId, normalize to itemId
            const itemId = data.productId || data.itemId || ''

            switch (eventType) {
              case 'start':
                setPushProgress((prev) =>
                  prev ? { ...prev, status: 'pushing', items: (data.items || []).map((id: string) => ({ id, name: id, step: 'Waiting...' })) } : null,
                )
                break

              case 'item_start':
                setPushProgress((prev) => {
                  if (!prev) return null
                  const exists = prev.items.find((i) => i.id === itemId)
                  if (exists) {
                    return {
                      ...prev,
                      items: prev.items.map((i) =>
                        i.id === itemId ? { ...i, step: data.step } : i,
                      ),
                    }
                  }
                  return {
                    ...prev,
                    items: [
                      ...prev.items,
                      { id: itemId, name: itemId, step: data.step },
                    ],
                  }
                })
                break

              case 'item_progress':
                setPushProgress((prev) => {
                  if (!prev) return null
                  return {
                    ...prev,
                    items: prev.items.map((i) =>
                      i.id === itemId
                        ? { ...i, step: data.step || data.detail }
                        : i,
                    ),
                  }
                })
                break

              case 'item_complete':
                setPushProgress((prev) => {
                  if (!prev) return null
                  const updated = { ...prev }
                  const result = data.status || data.result
                  if (result === 'created') {
                    updated.created = [...prev.created, itemId]
                  } else if (result === 'updated') {
                    updated.updated = [...prev.updated, itemId]
                  } else if (result === 'error' && data.error) {
                    updated.errors = [
                      ...prev.errors,
                      { id: itemId, error: data.error },
                    ]
                  }
                  updated.items = prev.items.map((i) =>
                    i.id === itemId
                      ? { ...i, result, error: data.error }
                      : i,
                  )
                  return updated
                })
                break

              case 'complete':
                setPushProgress((prev) => {
                  if (!prev) return null
                  return {
                    ...prev,
                    status: 'complete',
                    created: data.created || prev.created,
                    updated: data.updated || prev.updated,
                    errors: data.errors || prev.errors,
                  }
                })
                break
            }
          } catch {
            // parse error, skip
          }
        }
      }
    } catch (err) {
      setPushProgress({
        status: 'complete',
        items: [],
        created: [],
        updated: [],
        errors: [
          { id: 'global', error: err instanceof Error ? err.message : 'Push failed' },
        ],
      })
    } finally {
      await fetchData(false)
      setIsPushing(false)
    }
  }

  // -----------------------------------------------------------------------
  // Orphan deletion
  // -----------------------------------------------------------------------

  const handleDeleteOrphans = async (orphans: { id: string; type: string; identifier: string }[]) => {
    setIsDeletingOrphans(true)
    try {
      const res = await fetch('/api/playstore-iap/delete-orphans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          orphans: orphans.map((o) => ({ id: o.id, type: o.type })),
        }),
      })
      if (!res.ok) throw new Error('Failed to delete orphans')
      const data = await res.json()
      setSuccess(`Deleted ${data.deletedCount || orphans.length} orphaned product${orphans.length !== 1 ? 's' : ''}`)
      setTimeout(() => setSuccess(null), 4000)
      // Remove orphans from pull results
      setPullResults((prev) => (prev ? { ...prev, orphans: [] } : null))
      await fetchData(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete orphans')
    } finally {
      setIsDeletingOrphans(false)
    }
  }

  // Base plan activate / deactivate
  const handleBasePlanToggle = async (subId: string, basePlanId: string, activate: boolean) => {
    try {
      const action = activate ? 'activate' : 'deactivate'
      const res = await fetch(`/api/playstore-iap/${subId}/base-plans/${basePlanId}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId }),
      })
      if (!res.ok) throw new Error(`Failed to ${action} base plan`)
      setSuccess(`Base plan ${activate ? 'activated' : 'deactivated'}`)
      setTimeout(() => setSuccess(null), 3000)
      await fetchData(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed')
    }
  }

  // -----------------------------------------------------------------------
  // Filtered lists
  // -----------------------------------------------------------------------

  const filteredProducts = filter === 'subscriptions' ? [] : products
  const filteredSubscriptions = filter === 'products' ? [] : subscriptions

  const pendingProducts = products.filter((p) => p.syncStatus !== 'synced')
  const pendingSubscriptions = subscriptions.filter((s) => s.syncStatus !== 'synced')
  const hasPendingChanges = pendingProducts.length > 0 || pendingSubscriptions.length > 0

  const toggleSub = (subId: string) => {
    setExpandedSubs((prev) => {
      const next = new Set(prev)
      if (next.has(subId)) next.delete(subId)
      else next.add(subId)
      return next
    })
  }

  // -----------------------------------------------------------------------
  // Loading screen
  // -----------------------------------------------------------------------

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-6 h-6 animate-spin text-purple-400" />
      </div>
    )
  }

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  return (
    <div className="space-y-6">
      {/* ---------------------------------------------------------------- */}
      {/* Header */}
      {/* ---------------------------------------------------------------- */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-white flex items-center gap-2 sm:gap-3">
            <Package className="w-6 h-6 sm:w-7 sm:h-7 text-purple-400" />
            Play Store Products
          </h1>
          <p className="text-neutral-400 text-sm mt-1 hidden sm:block">
            Manage your Google Play in-app products and subscriptions
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={handlePull}
            disabled={isPulling}
            className="flex items-center gap-2 px-3 sm:px-4 py-2 rounded-lg text-sm font-medium
                     bg-white/[0.05] text-neutral-300 hover:bg-white/[0.08] hover:text-white
                     disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            {isPulling ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4" />
            )}
            <span className="hidden xs:inline">Pull</span>
            <span className="hidden sm:inline"> from Store</span>
          </button>
          <button
            onClick={() => handlePush(false)}
            disabled={isPushing}
            className="flex items-center gap-2 px-3 sm:px-4 py-2 rounded-lg text-sm font-medium
                     bg-gradient-to-r from-purple-500 to-blue-500 text-white
                     hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            {isPushing ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Upload className="w-4 h-4" />
            )}
            <span className="hidden xs:inline">Push</span>
            <span className="hidden sm:inline"> to Store</span>
          </button>
          <button
            onClick={() => handlePush(true)}
            disabled={isPushing}
            title="Force push all products regardless of sync status"
            className="flex items-center gap-2 px-3 sm:px-4 py-2 rounded-lg text-sm font-medium
                     bg-white/[0.05] text-amber-400 border border-amber-500/20
                     hover:bg-amber-500/10 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            <Upload className="w-4 h-4" />
            <span className="hidden sm:inline">Force Push</span>
          </button>
          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-2 px-3 sm:px-4 py-2 rounded-lg text-sm font-medium
                     bg-green-500/20 text-green-400 hover:bg-green-500/30 border border-green-500/30 transition-all"
          >
            <Plus className="w-4 h-4" />
            <span className="hidden xs:inline">New</span>
          </button>
        </div>
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* AI note */}
      {/* ---------------------------------------------------------------- */}
      <div className="hidden sm:block p-4 rounded-xl bg-gradient-to-br from-purple-500/10 to-blue-500/10 border border-purple-500/20">
        <div className="flex items-start gap-3">
          <Sparkles className="w-5 h-5 text-purple-400 mt-0.5 flex-shrink-0" />
          <div>
            <h3 className="text-sm font-medium text-white mb-1">
              AI-Powered Play Store Management
            </h3>
            <p className="text-sm text-neutral-400 leading-relaxed">
              Use <span className="text-purple-400">Claude Code</span>,{' '}
              <span className="text-purple-400">Cursor</span>, or any MCP-compatible IDE with tools
              like{' '}
              <code className="px-1.5 py-0.5 rounded bg-white/[0.1] text-purple-300 text-xs font-mono">
                create_playstore_product
              </code>
              ,{' '}
              <code className="px-1.5 py-0.5 rounded bg-white/[0.1] text-purple-300 text-xs font-mono">
                translate_playstore_listing
              </code>
              , and{' '}
              <code className="px-1.5 py-0.5 rounded bg-white/[0.1] text-purple-300 text-xs font-mono">
                set_playstore_pricing
              </code>{' '}
              to automate product creation, translation, and pricing.
            </p>
          </div>
        </div>
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* Alerts */}
      {/* ---------------------------------------------------------------- */}
      {error && (
        <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span className="text-sm">{error}</span>
          <button onClick={() => setError(null)} className="ml-auto">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {success && (
        <div className="p-4 rounded-xl bg-green-500/10 border border-green-500/20 text-green-400 flex items-center gap-2">
          <Check className="w-4 h-4 flex-shrink-0" />
          <span className="text-sm">{success}</span>
        </div>
      )}

      {/* ---------------------------------------------------------------- */}
      {/* Pending changes banner */}
      {/* ---------------------------------------------------------------- */}
      {hasPendingChanges && (
        <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-amber-400 text-sm">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            <span>
              {pendingProducts.length + pendingSubscriptions.length} item
              {pendingProducts.length + pendingSubscriptions.length !== 1 ? 's' : ''} with unpushed
              changes
            </span>
          </div>
          <button
            onClick={() => handlePush(false)}
            disabled={isPushing}
            className="px-3 py-1.5 rounded-lg text-xs font-medium bg-amber-500/20 text-amber-400
                     hover:bg-amber-500/30 disabled:opacity-50 transition-all flex-shrink-0"
          >
            Push Now
          </button>
        </div>
      )}

      {/* ---------------------------------------------------------------- */}
      {/* RevenueCat Integration */}
      {/* ---------------------------------------------------------------- */}
      {revenueCatStatus && (
        <div className="p-4 rounded-xl bg-gradient-to-br from-orange-500/10 to-amber-500/10 border border-orange-500/20">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-orange-500/20">
                <DollarSign className="w-5 h-5 text-orange-400" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-medium text-white">RevenueCat</h3>
                  {revenueCatStatus.connected ? (
                    <span className="flex items-center gap-1 text-xs text-green-400">
                      <CheckCircle2 className="w-3 h-3" />
                      Connected
                    </span>
                  ) : revenueCatStatus.configured ? (
                    <span className="flex items-center gap-1 text-xs text-red-400">
                      <XCircle className="w-3 h-3" />
                      Error
                    </span>
                  ) : (
                    <span className="text-xs text-neutral-500">Not configured</span>
                  )}
                </div>
                {revenueCatStatus.connected && revenueCatStatus.apps.length > 0 && (
                  <p className="text-xs text-neutral-400 mt-0.5">
                    {revenueCatStatus.apps.length} app{revenueCatStatus.apps.length !== 1 ? 's' : ''} • {revenueCatStatus.products.length} product{revenueCatStatus.products.length !== 1 ? 's' : ''}
                  </p>
                )}
                {revenueCatStatus.connected && revenueCatStatus.apps.length === 0 && (
                  <p className="text-xs text-amber-400 mt-0.5">
                    No app configured in RevenueCat
                  </p>
                )}
                {!revenueCatStatus.configured && (
                  <p className="text-xs text-neutral-500 mt-0.5">
                    Add credentials in Settings to enable sync
                  </p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {revenueCatStatus.connected && revenueCatStatus.apps.length > 0 && (
                <button
                  onClick={handleSyncToRevenueCat}
                  disabled={isSyncingToRevenueCat || (products.length === 0 && subscriptions.length === 0)}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium
                           bg-orange-500/20 text-orange-400 hover:bg-orange-500/30
                           disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                >
                  {isSyncingToRevenueCat ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <CloudUpload className="w-3.5 h-3.5" />
                  )}
                  Sync Products
                </button>
              )}
              {revenueCatStatus.connected && revenueCatStatus.apps.length === 0 && (
                <button
                  onClick={() => setShowRevenueCatSetup(true)}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium
                           bg-orange-500/20 text-orange-400 hover:bg-orange-500/30 transition-all"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Create App
                </button>
              )}
              {!revenueCatStatus.configured && (
                <Link
                  href={`/projects/${projectId}/settings`}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium
                           bg-white/[0.05] text-neutral-300 hover:bg-white/[0.1] transition-all"
                >
                  <Settings className="w-3.5 h-3.5" />
                  Configure
                </Link>
              )}
            </div>
          </div>
        </div>
      )}

      {/* RevenueCat App Setup Modal */}
      {showRevenueCatSetup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            onClick={() => setShowRevenueCatSetup(false)}
          />
          <div className="relative w-full max-w-md mx-4 rounded-2xl bg-neutral-900 border border-white/[0.1] shadow-2xl">
            <div className="p-6 border-b border-white/[0.08]">
              <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                <DollarSign className="w-5 h-5 text-orange-400" />
                Create RevenueCat App
              </h3>
              <p className="text-sm text-neutral-400 mt-1">
                {projectName && (
                  <span className="text-white font-medium">{projectName}</span>
                )}
                {projectName && ' • '}
                Google Play Store
              </p>
            </div>
            <div className="p-6 space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-neutral-300">
                  Package Name
                </label>
                <input
                  type="text"
                  value={rcPackageName}
                  onChange={(e) => setRcPackageName(e.target.value)}
                  placeholder="com.example.myapp"
                  className="w-full px-4 py-3 rounded-xl text-sm text-white
                           bg-black/40 border border-white/[0.08]
                           placeholder:text-neutral-600
                           focus:border-orange-500/50 focus:ring-1 focus:ring-orange-500/20
                           focus:outline-none transition-all"
                />
                <p className="text-xs text-neutral-500">
                  Your Android app&apos;s package name from build.gradle
                </p>
              </div>
            </div>
            <div className="p-6 border-t border-white/[0.08] flex justify-end gap-3">
              <button
                onClick={() => setShowRevenueCatSetup(false)}
                className="px-4 py-2 rounded-xl text-sm font-medium text-neutral-400 hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateRevenueCatApp}
                disabled={!rcPackageName || isCreatingRCApp}
                className="flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-medium
                         bg-gradient-to-r from-orange-500 to-amber-500 text-white
                         hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                {isCreatingRCApp ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Creating...
                  </>
                ) : (
                  <>
                    <Plus className="w-4 h-4" />
                    Create App
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---------------------------------------------------------------- */}
      {/* Filter tabs */}
      {/* ---------------------------------------------------------------- */}
      <div className="flex gap-1.5 sm:gap-2 border-b border-white/[0.08] pb-4 overflow-x-auto scrollbar-none">
        {(['all', 'products', 'subscriptions'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 sm:px-4 py-2 rounded-lg text-xs sm:text-sm font-medium transition-all whitespace-nowrap flex-shrink-0 ${
              filter === f
                ? 'bg-purple-500/20 text-purple-400 border border-purple-500/30'
                : 'text-neutral-400 hover:text-white hover:bg-white/[0.05]'
            }`}
          >
            {f === 'all' ? 'All' : f === 'products' ? 'Products' : 'Subscriptions'}
            <span className="ml-1.5 text-xs opacity-60">
              {f === 'all'
                ? products.length + subscriptions.length
                : f === 'products'
                  ? products.length
                  : subscriptions.length}
            </span>
          </button>
        ))}
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* Empty state */}
      {/* ---------------------------------------------------------------- */}
      {filteredProducts.length === 0 && filteredSubscriptions.length === 0 && (
        <div className="text-center py-16">
          <div className="w-20 h-20 rounded-2xl bg-neutral-800/50 border border-white/[0.06] flex items-center justify-center mx-auto mb-6">
            <Package className="w-10 h-10 text-neutral-600" />
          </div>
          <h3 className="text-lg font-medium text-white mb-2">No products yet</h3>
          <p className="text-neutral-400 mb-6 max-w-sm mx-auto">
            Pull existing products from Google Play Console or create new ones here.
          </p>
          <div className="flex items-center justify-center gap-3">
            <button
              onClick={handlePull}
              disabled={isPulling}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium
                       bg-white/[0.05] text-neutral-300 hover:bg-white/[0.08] transition-all"
            >
              <RefreshCw className="w-4 h-4" />
              Pull from Store
            </button>
            <button
              onClick={() => setShowCreateModal(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium
                       bg-purple-500/20 text-purple-400 hover:bg-purple-500/30 border border-purple-500/30 transition-all"
            >
              <Plus className="w-4 h-4" />
              Create Product
            </button>
          </div>
        </div>
      )}

      {/* ================================================================ */}
      {/* PRODUCT LIST — One-time products */}
      {/* ================================================================ */}
      {filteredProducts.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            <Coins className="w-5 h-5 text-amber-400" />
            One-Time Products
          </h2>
          <div className="space-y-2">
            {filteredProducts.map((prod) => (
              <div
                key={prod.id}
                onClick={() => setSelectedItem({ id: prod.id, type: 'product' })}
                className={`group p-4 rounded-xl border transition-all cursor-pointer ${
                  selectedItem?.id === prod.id
                    ? 'bg-purple-500/10 border-purple-500/30'
                    : 'bg-white/[0.02] border-white/[0.08] hover:border-purple-500/30 hover:bg-white/[0.04]'
                }`}
              >
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div className="p-2.5 rounded-xl bg-amber-500/20 text-amber-400 flex-shrink-0">
                      <Coins className="w-4 h-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-white">
                          {prod.title || prod.sku}
                        </span>
                        {prod.defaultPriceUsd != null ? (
                          <span className="text-sm font-medium text-green-400">
                            {formatPrice(prod.defaultPriceUsd)}
                          </span>
                        ) : (
                          <span className="text-xs text-neutral-600 italic">No price</span>
                        )}
                        <span className="text-xs text-neutral-500">One-Time</span>
                      </div>
                      <div className="mt-1">
                        <span className="text-xs text-neutral-500 font-mono">{prod.sku}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 flex-shrink-0">
                    <div className="hidden xs:flex items-center gap-1.5">
                      {renderStateBadge(prod.status)}
                      {renderSyncBadge(prod.syncStatus)}
                    </div>
                    <div className="xs:hidden">
                      {prod.syncStatus !== 'synced'
                        ? renderSyncBadge(prod.syncStatus)
                        : renderStateBadge(prod.status)}
                    </div>
                    <ChevronRight className="w-5 h-5 text-neutral-500 group-hover:text-white transition-colors" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ================================================================ */}
      {/* SUBSCRIPTION LIST */}
      {/* ================================================================ */}
      {filteredSubscriptions.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            <CreditCard className="w-5 h-5 text-blue-400" />
            Subscriptions
          </h2>
          <div className="space-y-3">
            {filteredSubscriptions.map((sub) => (
              <div
                key={sub.id}
                className={`rounded-xl border overflow-hidden transition-all ${
                  selectedItem?.id === sub.id
                    ? 'bg-blue-500/5 border-blue-500/30'
                    : 'bg-white/[0.02] border-white/[0.08]'
                }`}
              >
                {/* Subscription header row */}
                <div className="w-full p-4 flex items-center justify-between">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <button
                      onClick={() => toggleSub(sub.id)}
                      className="p-1 rounded hover:bg-white/[0.05] transition-all flex-shrink-0"
                    >
                      {expandedSubs.has(sub.id) ? (
                        <ChevronDown className="w-5 h-5 text-neutral-400" />
                      ) : (
                        <ChevronRight className="w-5 h-5 text-neutral-400" />
                      )}
                    </button>
                    <button
                      onClick={() => setSelectedItem({ id: sub.id, type: 'subscription' })}
                      className="flex items-center gap-3 flex-1 min-w-0 hover:opacity-80 transition-all text-left"
                    >
                      <div className="p-2 rounded-lg bg-blue-500/20 text-blue-400 flex-shrink-0">
                        <CreditCard className="w-4 h-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-white">
                            {sub.title || sub.productId}
                          </span>
                          <span className="text-xs text-neutral-500">
                            {sub.basePlans.length} base plan
                            {sub.basePlans.length !== 1 ? 's' : ''}
                          </span>
                        </div>
                        <div className="mt-1">
                          <span className="text-xs text-neutral-500 font-mono">
                            {sub.productId}
                          </span>
                        </div>
                      </div>
                    </button>
                  </div>

                  <div className="flex items-center gap-2 flex-shrink-0">
                    {renderSyncBadge(sub.syncStatus)}
                    <ChevronRight
                      onClick={() => setSelectedItem({ id: sub.id, type: 'subscription' })}
                      className="w-5 h-5 text-neutral-500 hover:text-white transition-colors cursor-pointer"
                    />
                  </div>
                </div>

                {/* Expanded base plans */}
                {expandedSubs.has(sub.id) && sub.basePlans.length > 0 && (
                  <div className="border-t border-white/[0.06] px-4 pb-4">
                    <div className="space-y-2 mt-3 sm:ml-10">
                      {sub.basePlans.map((bp) => (
                        <div
                          key={bp.basePlanId}
                          className="p-3 rounded-lg bg-white/[0.02] border border-white/[0.06]
                                   hover:border-blue-500/20 transition-all cursor-pointer"
                          onClick={() => setSelectedItem({ id: sub.id, type: 'subscription', initialTab: 'offers' })}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="flex items-center gap-3 min-w-0 flex-1">
                              <div className="w-7 h-7 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center flex-shrink-0">
                                {bp.type === 'PREPAID' ? (
                                  <Clock className="w-3.5 h-3.5" />
                                ) : (
                                  <RotateCcw className="w-3.5 h-3.5" />
                                )}
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="font-medium text-white text-sm">
                                    {bp.basePlanId}
                                  </span>
                                  {bp.defaultPriceUsd != null ? (
                                    <span className="text-sm font-medium text-green-400">
                                      {formatPrice(bp.defaultPriceUsd)}
                                    </span>
                                  ) : (
                                    <span className="text-xs text-neutral-600 italic">
                                      No price
                                    </span>
                                  )}
                                </div>
                                <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                                  <span className="text-xs text-neutral-500">
                                    {bp.billingPeriodDuration
                                      ? BILLING_PERIOD_LABELS[bp.billingPeriodDuration] ||
                                        bp.billingPeriodDuration
                                      : 'No period'}
                                  </span>
                                  <span className="text-xs text-neutral-600">
                                    {bp.type === 'PREPAID' ? 'Prepaid' : 'Auto-renewing'}
                                  </span>
                                  {(() => {
                                    const bpOffers = (offersBySubscription[sub.id] || []).filter((o: any) => o.basePlanId === bp.basePlanId)
                                    if (bpOffers.length === 0) return null
                                    const hasFreeTrial = bpOffers.some((o: any) => o.phases?.some((p: any) => p.priceType === 'FREE'))
                                    const activeCount = bpOffers.filter((o: any) => o.state === 'ACTIVE').length
                                    const label = hasFreeTrial && bpOffers.length === 1
                                      ? 'Free trial'
                                      : `${bpOffers.length} offer${bpOffers.length !== 1 ? 's' : ''}`
                                    return (
                                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-purple-500/10 text-purple-400 text-[10px]">
                                        <Gift className="w-2.5 h-2.5" />
                                        {label}
                                        {activeCount > 0 && (
                                          <span className="w-1.5 h-1.5 rounded-full bg-green-400" title={`${activeCount} active`} />
                                        )}
                                      </span>
                                    )
                                  })()}
                                </div>
                              </div>
                            </div>

                            <div className="flex items-center gap-2 flex-shrink-0">
                              {renderStateBadge(bp.state)}
                              {/* Activate / Deactivate toggle */}
                              {bp.state === 'ACTIVE' ? (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    handleBasePlanToggle(sub.id, bp.basePlanId, false)
                                  }}
                                  title="Deactivate"
                                  className="p-1.5 rounded-lg bg-yellow-500/10 text-yellow-400
                                           hover:bg-yellow-500/20 transition-all"
                                >
                                  <Pause className="w-3.5 h-3.5" />
                                </button>
                              ) : bp.state === 'DRAFT' || bp.state === 'INACTIVE' ? (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    handleBasePlanToggle(sub.id, bp.basePlanId, true)
                                  }}
                                  title="Activate"
                                  className="p-1.5 rounded-lg bg-green-500/10 text-green-400
                                           hover:bg-green-500/20 transition-all"
                                >
                                  <Play className="w-3.5 h-3.5" />
                                </button>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Empty base plans */}
                {expandedSubs.has(sub.id) && sub.basePlans.length === 0 && (
                  <div className="border-t border-white/[0.06] px-4 py-6 text-center">
                    <p className="text-sm text-neutral-500">
                      No base plans yet. Add one in the create modal or push to Play Store.
                    </p>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ================================================================ */}
      {/* DETAIL MODAL */}
      {/* ================================================================ */}
      {selectedItem && findSelectedItem() && (
        <PlayStoreProductDetailPanel
          projectId={projectId}
          item={findSelectedItem()!}
          itemType={selectedItem.type}
          enabledLocales={enabledLocales}
          onClose={() => setSelectedItem(null)}
          onUpdated={() => fetchData(false)}
          onDelete={() => { setSelectedItem(null); fetchData(false) }}
          initialTab={selectedItem.initialTab as any}
        />
      )}

      {/* ================================================================ */}
      {/* CREATE MODAL */}
      {/* ================================================================ */}
      {showCreateModal && (
        <CreateProductModal
          projectId={projectId}
          onClose={() => setShowCreateModal(false)}
          onCreated={() => {
            setShowCreateModal(false)
            fetchData()
            setSuccess('Product created successfully')
            setTimeout(() => setSuccess(null), 3000)
          }}
        />
      )}

      {/* ================================================================ */}
      {/* PULL PROGRESS MODAL */}
      {/* ================================================================ */}
      {showPullModal && pullResults && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            onClick={() => {
              if (pullResults.status === 'complete') {
                setShowPullModal(false)
                setPullResults(null)
              }
            }}
          />
          <div className="relative w-full max-w-md mx-4 rounded-2xl bg-neutral-900 border border-white/[0.1] shadow-2xl">
            <div className="p-6">
              {pullResults.status === 'pending' && (
                <div className="text-center py-4">
                  <Loader2 className="w-8 h-8 animate-spin text-purple-400 mx-auto mb-3" />
                  <p className="text-sm text-neutral-400">Preparing to sync...</p>
                </div>
              )}

              {pullResults.status === 'pulling' && (
                <div className="text-center py-4">
                  <Loader2 className="w-8 h-8 animate-spin text-purple-400 mx-auto mb-3" />
                  <p className="text-sm text-white font-medium">Pulling from Play Store...</p>
                  <p className="text-xs text-neutral-500 mt-1">
                    Fetching products and subscriptions
                  </p>
                </div>
              )}

              {pullResults.status === 'complete' && (
                <div className="space-y-4">
                  {pullResults.error ? (
                    <div className="text-center py-4">
                      <div className="w-12 h-12 rounded-full bg-red-500/20 flex items-center justify-center mx-auto mb-3">
                        <XCircle className="w-6 h-6 text-red-400" />
                      </div>
                      <p className="text-sm text-red-400">{pullResults.error}</p>
                    </div>
                  ) : (
                    <>
                      <div className="text-center">
                        <div className="w-12 h-12 rounded-full bg-green-500/20 flex items-center justify-center mx-auto mb-3">
                          <CheckCircle2 className="w-6 h-6 text-green-400" />
                        </div>
                        <p className="text-sm font-medium text-white">Sync Complete</p>
                      </div>

                      {pullResults.summary && (
                        <div className="grid grid-cols-2 gap-3">
                          <div className="p-3 rounded-lg bg-white/[0.03] border border-white/[0.06] text-center">
                            <p className="text-xl font-bold text-white">
                              {pullResults.summary.products}
                            </p>
                            <p className="text-xs text-neutral-500">Products</p>
                          </div>
                          <div className="p-3 rounded-lg bg-white/[0.03] border border-white/[0.06] text-center">
                            <p className="text-xl font-bold text-white">
                              {pullResults.summary.subscriptions}
                            </p>
                            <p className="text-xs text-neutral-500">Subscriptions</p>
                          </div>
                        </div>
                      )}

                      {/* Orphan detection */}
                      {pullResults.orphans && pullResults.orphans.length > 0 && (
                        <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
                          <div className="flex items-center gap-2 mb-2">
                            <AlertTriangle className="w-4 h-4 text-amber-400" />
                            <span className="text-sm font-medium text-amber-400">
                              {pullResults.orphans.length} Orphaned Product
                              {pullResults.orphans.length !== 1 ? 's' : ''}
                            </span>
                          </div>
                          <p className="text-xs text-neutral-400 mb-3">
                            These local products no longer exist in Play Store.
                          </p>
                          <div className="space-y-1 mb-3">
                            {pullResults.orphans.map((o) => (
                              <div
                                key={o.id}
                                className="text-xs text-neutral-300 font-mono truncate"
                              >
                                {o.identifier}
                              </div>
                            ))}
                          </div>
                          <button
                            onClick={() => handleDeleteOrphans(pullResults.orphans!)}
                            disabled={isDeletingOrphans}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium
                                     bg-red-500/20 text-red-400 hover:bg-red-500/30
                                     disabled:opacity-50 transition-all"
                          >
                            {isDeletingOrphans ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              <Trash2 className="w-3 h-3" />
                            )}
                            Delete Orphans
                          </button>
                        </div>
                      )}
                    </>
                  )}

                  <button
                    onClick={() => {
                      setShowPullModal(false)
                      setPullResults(null)
                    }}
                    className="w-full px-4 py-2 rounded-xl text-sm font-medium text-neutral-400
                             hover:text-white hover:bg-white/[0.05] transition-all"
                  >
                    Close
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ================================================================ */}
      {/* PUSH PROGRESS MODAL */}
      {/* ================================================================ */}
      {showPushModal && pushProgress && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            onClick={() => {
              if (pushProgress.status === 'complete') {
                setShowPushModal(false)
                setPushProgress(null)
              }
            }}
          />
          <div className="relative w-full max-w-md mx-4 rounded-2xl bg-neutral-900 border border-white/[0.1] shadow-2xl">
            <div className="p-6">
              {pushProgress.status === 'starting' && (
                <div className="text-center py-4">
                  <Loader2 className="w-8 h-8 animate-spin text-purple-400 mx-auto mb-3" />
                  <p className="text-sm text-neutral-400">Preparing to push...</p>
                </div>
              )}

              {pushProgress.status === 'pushing' && (
                <div className="space-y-4">
                  <div className="text-center">
                    <Loader2 className="w-8 h-8 animate-spin text-purple-400 mx-auto mb-3" />
                    <p className="text-sm font-medium text-white">Pushing to Play Store...</p>
                  </div>

                  {/* Live progress items */}
                  {pushProgress.items.length > 0 && (
                    <div className="space-y-2 max-h-48 overflow-y-auto">
                      {pushProgress.items.map((item) => (
                        <div
                          key={item.id}
                          className="flex items-center justify-between p-2 rounded-lg bg-white/[0.02] border border-white/[0.06]"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="text-xs text-white truncate font-mono">{item.id}</p>
                            {item.step && (
                              <p className="text-[10px] text-neutral-500">{item.step}</p>
                            )}
                          </div>
                          <div className="flex-shrink-0 ml-2">
                            {item.result === 'created' && (
                              <CheckCircle2 className="w-4 h-4 text-green-400" />
                            )}
                            {item.result === 'updated' && (
                              <CheckCircle2 className="w-4 h-4 text-blue-400" />
                            )}
                            {item.result === 'error' && (
                              <XCircle className="w-4 h-4 text-red-400" />
                            )}
                            {!item.result && (
                              <Loader2 className="w-4 h-4 animate-spin text-neutral-500" />
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {pushProgress.status === 'complete' && (
                <div className="space-y-4">
                  <div className="text-center">
                    {pushProgress.errors.length === 0 ? (
                      <div className="w-12 h-12 rounded-full bg-green-500/20 flex items-center justify-center mx-auto mb-3">
                        <CheckCircle2 className="w-6 h-6 text-green-400" />
                      </div>
                    ) : (
                      <div className="w-12 h-12 rounded-full bg-amber-500/20 flex items-center justify-center mx-auto mb-3">
                        <AlertTriangle className="w-6 h-6 text-amber-400" />
                      </div>
                    )}
                    <p className="text-sm font-medium text-white">Push Complete</p>
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    <div className="p-2.5 rounded-lg bg-green-500/10 border border-green-500/20 text-center">
                      <p className="text-lg font-bold text-green-400">
                        {pushProgress.created.length}
                      </p>
                      <p className="text-[10px] text-neutral-500">Created</p>
                    </div>
                    <div className="p-2.5 rounded-lg bg-blue-500/10 border border-blue-500/20 text-center">
                      <p className="text-lg font-bold text-blue-400">
                        {pushProgress.updated.length}
                      </p>
                      <p className="text-[10px] text-neutral-500">Updated</p>
                    </div>
                    <div className="p-2.5 rounded-lg bg-red-500/10 border border-red-500/20 text-center">
                      <p className="text-lg font-bold text-red-400">
                        {pushProgress.errors.length}
                      </p>
                      <p className="text-[10px] text-neutral-500">Errors</p>
                    </div>
                  </div>

                  {/* Error details */}
                  {pushProgress.errors.length > 0 && (
                    <div className="space-y-1.5">
                      {pushProgress.errors.map((e, i) => (
                        <div
                          key={i}
                          className="p-2 rounded-lg bg-red-500/10 border border-red-500/20 text-xs"
                        >
                          <span className="text-red-400 font-mono">{e.id}</span>
                          <span className="text-neutral-500 ml-1">- {e.error}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  <button
                    onClick={() => {
                      setShowPushModal(false)
                      setPushProgress(null)
                    }}
                    className="w-full px-4 py-2 rounded-xl text-sm font-medium text-neutral-400
                             hover:text-white hover:bg-white/[0.05] transition-all"
                  >
                    Close
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ===========================================================================
// CREATE PRODUCT MODAL
// ===========================================================================

function CreateProductModal({
  projectId,
  onClose,
  onCreated,
}: {
  projectId: string
  onClose: () => void
  onCreated: () => void
}) {
  const [type, setType] = useState<'product' | 'subscription'>('product')
  const [isCreating, setIsCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Product fields
  const [sku, setSku] = useState('')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [defaultPriceUsd, setDefaultPriceUsd] = useState('')

  // Subscription fields
  const [productId, setProductId] = useState('')
  const [subTitle, setSubTitle] = useState('')
  const [subDescription, setSubDescription] = useState('')
  const [basePlans, setBasePlans] = useState<
    { basePlanId: string; type: 'AUTO_RENEWING' | 'PREPAID'; billingPeriodDuration: string; defaultPriceUsd: string }[]
  >([{ basePlanId: '', type: 'AUTO_RENEWING', billingPeriodDuration: 'P1M', defaultPriceUsd: '' }])

  const addBasePlan = () => {
    setBasePlans((prev) => [
      ...prev,
      { basePlanId: '', type: 'AUTO_RENEWING', billingPeriodDuration: 'P1M', defaultPriceUsd: '' },
    ])
  }

  const removeBasePlan = (idx: number) => {
    setBasePlans((prev) => prev.filter((_, i) => i !== idx))
  }

  const updateBasePlan = (idx: number, field: string, value: string) => {
    setBasePlans((prev) =>
      prev.map((bp, i) => (i === idx ? { ...bp, [field]: value } : bp)),
    )
  }

  const handleCreate = async () => {
    if (type === 'product') {
      if (!sku.trim() || !title.trim()) {
        setError('SKU and title are required')
        return
      }
    } else {
      if (!productId.trim() || !subTitle.trim()) {
        setError('Product ID and title are required')
        return
      }
      if (basePlans.some((bp) => !bp.basePlanId.trim())) {
        setError('All base plans need an ID')
        return
      }
    }

    setIsCreating(true)
    setError(null)

    try {
      if (type === 'product') {
        const res = await fetch('/api/playstore-iap/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectId,
            sku: sku.trim(),
            title: title.trim(),
            description: description.trim(),
            defaultPriceUsd: defaultPriceUsd ? parseFloat(defaultPriceUsd) : undefined,
          }),
        })
        if (!res.ok) {
          const data = await res.json()
          throw new Error(data.error || 'Failed to create product')
        }
      } else {
        const res = await fetch('/api/playstore-iap/create-subscription', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectId,
            productId: productId.trim(),
            title: subTitle.trim(),
            description: subDescription.trim(),
            basePlans: basePlans.map((bp) => ({
              basePlanId: bp.basePlanId.trim(),
              type: bp.type,
              billingPeriodDuration: bp.billingPeriodDuration,
              defaultPriceUsd: bp.defaultPriceUsd ? parseFloat(bp.defaultPriceUsd) : undefined,
            })),
          }),
        })
        if (!res.ok) {
          const data = await res.json()
          throw new Error(data.error || 'Failed to create subscription')
        }
      }

      onCreated()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create')
    } finally {
      setIsCreating(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[9999] p-4 backdrop-blur-sm">
      <div className="bg-[#1a1a1a] rounded-2xl border border-white/[0.08] w-full max-w-lg max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-6 border-b border-white/[0.08] flex-shrink-0">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold text-white">Create New Product</h2>
              <p className="text-neutral-400 text-sm mt-1">
                Add a Play Store product or subscription
              </p>
            </div>
            <button
              onClick={onClose}
              className="p-2 rounded-lg text-neutral-400 hover:bg-white/[0.05] transition-all"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="p-6 space-y-4 overflow-y-auto flex-1 scrollbar-dark">
          {/* Type selector */}
          <div className="flex gap-2">
            <button
              onClick={() => setType('product')}
              className={`flex-1 p-3 rounded-lg border text-sm font-medium transition-all text-center ${
                type === 'product'
                  ? 'bg-purple-500/20 border-purple-500/30 text-purple-400'
                  : 'bg-white/[0.02] border-white/[0.08] text-neutral-400 hover:text-white'
              }`}
            >
              <Coins className="w-5 h-5 mx-auto mb-1" />
              One-Time Product
            </button>
            <button
              onClick={() => setType('subscription')}
              className={`flex-1 p-3 rounded-lg border text-sm font-medium transition-all text-center ${
                type === 'subscription'
                  ? 'bg-blue-500/20 border-blue-500/30 text-blue-400'
                  : 'bg-white/[0.02] border-white/[0.08] text-neutral-400 hover:text-white'
              }`}
            >
              <CreditCard className="w-5 h-5 mx-auto mb-1" />
              Subscription
            </button>
          </div>

          {error && (
            <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
              {error}
            </div>
          )}

          {/* ---- One-time product fields ---- */}
          {type === 'product' && (
            <>
              <div>
                <label className="block text-sm font-medium text-neutral-300 mb-1">SKU</label>
                <input
                  type="text"
                  value={sku}
                  onChange={(e) => setSku(e.target.value)}
                  placeholder="premium_upgrade"
                  className="w-full px-3 py-2 rounded-lg bg-white/[0.03] border border-white/[0.08]
                           text-white placeholder:text-neutral-600 focus:outline-none focus:border-purple-500/50 text-sm"
                />
                <p className="text-xs text-neutral-600 mt-1">Unique product identifier</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-neutral-300 mb-1">
                  Title
                  <span className="text-neutral-600 text-xs ml-2">
                    {title.length}/{TITLE_MAX}
                  </span>
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => {
                    if (e.target.value.length <= TITLE_MAX) setTitle(e.target.value)
                  }}
                  placeholder="Premium Upgrade"
                  className="w-full px-3 py-2 rounded-lg bg-white/[0.03] border border-white/[0.08]
                           text-white placeholder:text-neutral-600 focus:outline-none focus:border-purple-500/50 text-sm"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-neutral-300 mb-1">
                  Description
                  <span className="text-neutral-600 text-xs ml-2">
                    {description.length}/{DESC_MAX}
                  </span>
                </label>
                <textarea
                  value={description}
                  onChange={(e) => {
                    if (e.target.value.length <= DESC_MAX) setDescription(e.target.value)
                  }}
                  rows={2}
                  placeholder="Unlock all premium features"
                  className="w-full px-3 py-2 rounded-lg bg-white/[0.03] border border-white/[0.08]
                           text-white placeholder:text-neutral-600 focus:outline-none focus:border-purple-500/50 text-sm resize-none"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-neutral-300 mb-1">
                  Default Price (USD)
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500 text-sm">
                    $
                  </span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={defaultPriceUsd}
                    onChange={(e) => setDefaultPriceUsd(e.target.value)}
                    placeholder="9.99"
                    className="w-full pl-7 pr-3 py-2 rounded-lg bg-white/[0.03] border border-white/[0.08]
                             text-white placeholder:text-neutral-600 focus:outline-none focus:border-purple-500/50 text-sm"
                  />
                </div>
              </div>
            </>
          )}

          {/* ---- Subscription fields ---- */}
          {type === 'subscription' && (
            <>
              <div>
                <label className="block text-sm font-medium text-neutral-300 mb-1">
                  Product ID
                </label>
                <input
                  type="text"
                  value={productId}
                  onChange={(e) => setProductId(e.target.value)}
                  placeholder="premium_subscription"
                  className="w-full px-3 py-2 rounded-lg bg-white/[0.03] border border-white/[0.08]
                           text-white placeholder:text-neutral-600 focus:outline-none focus:border-purple-500/50 text-sm"
                />
                <p className="text-xs text-neutral-600 mt-1">Unique subscription identifier</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-neutral-300 mb-1">
                  Title
                  <span className="text-neutral-600 text-xs ml-2">
                    {subTitle.length}/{TITLE_MAX}
                  </span>
                </label>
                <input
                  type="text"
                  value={subTitle}
                  onChange={(e) => {
                    if (e.target.value.length <= TITLE_MAX) setSubTitle(e.target.value)
                  }}
                  placeholder="Premium Plan"
                  className="w-full px-3 py-2 rounded-lg bg-white/[0.03] border border-white/[0.08]
                           text-white placeholder:text-neutral-600 focus:outline-none focus:border-purple-500/50 text-sm"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-neutral-300 mb-1">
                  Description
                  <span className="text-neutral-600 text-xs ml-2">
                    {subDescription.length}/{DESC_MAX}
                  </span>
                </label>
                <textarea
                  value={subDescription}
                  onChange={(e) => {
                    if (e.target.value.length <= DESC_MAX) setSubDescription(e.target.value)
                  }}
                  rows={2}
                  placeholder="Access all premium features"
                  className="w-full px-3 py-2 rounded-lg bg-white/[0.03] border border-white/[0.08]
                           text-white placeholder:text-neutral-600 focus:outline-none focus:border-purple-500/50 text-sm resize-none"
                />
              </div>

              {/* Base plans */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-sm font-medium text-neutral-300">Base Plans</label>
                  <button
                    onClick={addBasePlan}
                    className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium
                             text-purple-400 hover:bg-purple-500/10 transition-all"
                  >
                    <Plus className="w-3 h-3" />
                    Add
                  </button>
                </div>

                <div className="space-y-3">
                  {basePlans.map((bp, idx) => (
                    <div
                      key={idx}
                      className="p-3 rounded-lg bg-white/[0.02] border border-white/[0.06] space-y-2"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-neutral-400">
                          Base Plan {idx + 1}
                        </span>
                        {basePlans.length > 1 && (
                          <button
                            onClick={() => removeBasePlan(idx)}
                            className="p-1 text-neutral-600 hover:text-red-400 transition-colors"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        )}
                      </div>

                      <div>
                        <input
                          type="text"
                          value={bp.basePlanId}
                          onChange={(e) => updateBasePlan(idx, 'basePlanId', e.target.value)}
                          placeholder="monthly-plan"
                          className="w-full px-2.5 py-1.5 rounded-lg bg-black/30 border border-white/[0.08]
                                   text-white text-sm placeholder:text-neutral-600 focus:outline-none focus:border-purple-500/50"
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <select
                          value={bp.type}
                          onChange={(e) => updateBasePlan(idx, 'type', e.target.value)}
                          className="px-2.5 py-1.5 rounded-lg bg-black/30 border border-white/[0.08]
                                   text-white text-sm focus:outline-none focus:border-purple-500/50"
                        >
                          <option value="AUTO_RENEWING">Auto-renewing</option>
                          <option value="PREPAID">Prepaid</option>
                        </select>
                        <select
                          value={bp.billingPeriodDuration}
                          onChange={(e) =>
                            updateBasePlan(idx, 'billingPeriodDuration', e.target.value)
                          }
                          className="px-2.5 py-1.5 rounded-lg bg-black/30 border border-white/[0.08]
                                   text-white text-sm focus:outline-none focus:border-purple-500/50"
                        >
                          {BILLING_PERIOD_OPTIONS.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="relative">
                        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-500 text-sm">
                          $
                        </span>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={bp.defaultPriceUsd}
                          onChange={(e) => updateBasePlan(idx, 'defaultPriceUsd', e.target.value)}
                          placeholder="9.99"
                          className="w-full pl-6 pr-2.5 py-1.5 rounded-lg bg-black/30 border border-white/[0.08]
                                   text-white text-sm placeholder:text-neutral-600 focus:outline-none focus:border-purple-500/50"
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-white/[0.08] flex justify-end gap-3 flex-shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-sm font-medium text-neutral-400 hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={isCreating}
            className="flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-medium
                     bg-gradient-to-r from-purple-500 to-blue-500 text-white
                     hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            {isCreating ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Creating...
              </>
            ) : (
              <>
                <Plus className="w-4 h-4" />
                Create {type === 'product' ? 'Product' : 'Subscription'}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
