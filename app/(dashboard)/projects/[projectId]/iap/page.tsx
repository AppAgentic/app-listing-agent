'use client'

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
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
  Edit3,
  Languages,
  CloudUpload,
  Settings,
  ExternalLink,
  CheckCircle2,
  XCircle,
} from 'lucide-react'
import Link from 'next/link'
import ProductDetailPanel from '@/components/iap/ProductDetailPanel'
import GroupDetailPanel from '@/components/iap/GroupDetailPanel'
import PlayStoreIAPPage from './PlayStoreIAPPage'
import { useInternalIntegrations } from '@/components/dashboard/internal-integrations-context'

interface InAppPurchase {
  id: string
  appStoreId: string | null
  productId: string
  name: string
  productType: 'CONSUMABLE' | 'NON_CONSUMABLE' | 'NON_RENEWING_SUBSCRIPTION'
  state: string | null
  syncStatus: 'synced' | 'local_changes' | 'pending_creation'
  familyShareable: boolean
  reviewNote: string | null
  // Pricing info (loaded separately)
  price?: number | null
}

interface Subscription {
  id: string
  appStoreId: string | null
  productId: string
  name: string
  groupId: string
  groupLevel: number
  subscriptionPeriod: string
  familyShareable: boolean
  state: string | null
  syncStatus: string
  // Intro offer info (fetched separately)
  introOffer?: {
    offerMode: 'PAY_AS_YOU_GO' | 'PAY_UP_FRONT' | 'FREE_TRIAL'
    duration: string
    territories: string[]
    startDate: string
    endDate: string
  } | null
  // Pricing info (loaded separately)
  price?: number | null
}

interface SubscriptionGroup {
  id: string
  appStoreId: string | null
  referenceName: string
  syncStatus: string
  subscriptions: Subscription[]
}

interface OrphanedProduct {
  id: string
  type: 'iap' | 'subscription'
  productId: string
  name: string
  appStoreId: string
  groupId?: string
}

type ProductType = 'CONSUMABLE' | 'NON_CONSUMABLE' | 'NON_RENEWING_SUBSCRIPTION' | 'AUTO_RENEWABLE_SUBSCRIPTION'

const PRODUCT_TYPE_LABELS: Record<ProductType, string> = {
  CONSUMABLE: 'Consumable',
  NON_CONSUMABLE: 'Non-Consumable',
  NON_RENEWING_SUBSCRIPTION: 'Non-Renewing',
  AUTO_RENEWABLE_SUBSCRIPTION: 'Auto-Renewable',
}

const PRODUCT_TYPE_ICONS: Record<ProductType, React.ReactNode> = {
  CONSUMABLE: <Coins className="w-4 h-4" />,
  NON_CONSUMABLE: <Package className="w-4 h-4" />,
  NON_RENEWING_SUBSCRIPTION: <CreditCard className="w-4 h-4" />,
  AUTO_RENEWABLE_SUBSCRIPTION: <CreditCard className="w-4 h-4" />,
}

const STATE_COLORS: Record<string, string> = {
  APPROVED: 'bg-green-500/20 text-green-400 border-green-500/30',
  READY_TO_SUBMIT: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  WAITING_FOR_REVIEW: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  IN_REVIEW: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  REJECTED: 'bg-red-500/20 text-red-400 border-red-500/30',
  MISSING_METADATA: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
}

const SYNC_STATUS_COLORS: Record<string, string> = {
  synced: 'bg-green-500/20 text-green-400 border-green-500/30',
  local_changes: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  pending_creation: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
}

const PERIOD_LABELS: Record<string, string> = {
  ONE_WEEK: '1 Week',
  ONE_MONTH: '1 Month',
  TWO_MONTHS: '2 Months',
  THREE_MONTHS: '3 Months',
  SIX_MONTHS: '6 Months',
  ONE_YEAR: '1 Year',
}

// Duration labels for intro offers (includes more granular options)
const DURATION_LABELS: Record<string, string> = {
  THREE_DAYS: '3 Days',
  ONE_WEEK: '1 Week',
  TWO_WEEKS: '2 Weeks',
  ONE_MONTH: '1 Month',
  TWO_MONTHS: '2 Months',
  THREE_MONTHS: '3 Months',
  SIX_MONTHS: '6 Months',
  ONE_YEAR: '1 Year',
}

export default function IAPPage() {
  const internalIntegrationsEnabled = useInternalIntegrations()
  const params = useParams()
  const projectId = params.projectId as string

  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const [iaps, setIaps] = useState<InAppPurchase[]>([])
  const [subscriptionGroups, setSubscriptionGroups] = useState<SubscriptionGroup[]>([])
  const [enabledLocales, setEnabledLocales] = useState<string[]>(['en-US'])
  const [primaryLocale, setPrimaryLocale] = useState<string>('en-US')
  const [appStoreAppId, setAppStoreAppId] = useState<string | null>(null)

  const [isPulling, setIsPulling] = useState(false)
  const [isPushing, setIsPushing] = useState(false)
  const [showPushModal, setShowPushModal] = useState(false)
  const [pushResults, setPushResults] = useState<{
    status: 'pending' | 'pushing' | 'complete'
    created: string[]
    updated: string[]
    skipped: string[]
    errors: { id: string; error: string }[]
    // Real-time progress tracking
    itemProgress?: Record<string, { step: string; detail?: string; progress?: { current: number; total: number } }>
    currentItem?: string
  } | null>(null)

  // Pull progress modal state
  const [showPullModal, setShowPullModal] = useState(false)
  const [pullResults, setPullResults] = useState<{
    status: 'pending' | 'pulling' | 'complete'
    summary?: { iaps: number; subscriptions: number; groups: number }
    error?: string
  } | null>(null)
  const [filter, setFilter] = useState<'all' | 'iaps' | 'subscriptions'>('all')
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())

  const [showCreateModal, setShowCreateModal] = useState(false)
  const [createType, setCreateType] = useState<'iap' | 'subscription'>('iap')

  // Group editing state
  const [editingGroup, setEditingGroup] = useState<SubscriptionGroup | null>(null)

  // Orphaned products state
  const [orphanedProducts, setOrphanedProducts] = useState<{
    id: string
    type: 'iap' | 'subscription'
    productId: string
    name: string
    appStoreId: string
    groupId?: string
  }[]>([])
  const [showOrphanModal, setShowOrphanModal] = useState(false)
  const [isDeletingOrphans, setIsDeletingOrphans] = useState(false)

  // Unified product detail panel state
  const [selectedProduct, setSelectedProduct] = useState<{
    product: InAppPurchase | Subscription
    type: 'iap' | 'subscription'
    initialTab?: 'overview' | 'localizations' | 'pricing' | 'media' | 'offers'
  } | null>(null)

  // RevenueCat state
  const [revenueCatStatus, setRevenueCatStatus] = useState<{
    configured: boolean
    connected: boolean
    apps: { id: string; name: string; type: string; bundle_id?: string; package_name?: string }[]
    products: { id: string; store_identifier: string; type: string }[]
    error?: string
  } | null>(null)
  const [isLoadingRevenueCat, setIsLoadingRevenueCat] = useState(false)
  const [isSyncingToRevenueCat, setIsSyncingToRevenueCat] = useState(false)
  const [showRevenueCatSetup, setShowRevenueCatSetup] = useState(false)
  const [isCreatingApp, setIsCreatingApp] = useState(false)
  const [isLoadingSetup, setIsLoadingSetup] = useState(false)
  const [bundleId, setBundleId] = useState('')
  const [projectInfo, setProjectInfo] = useState<{
    name: string
    storeType: 'ios' | 'android'
    appStoreAppId: string | null
    playStorePackage: string | null
  } | null>(null)

  // Fetch data
  useEffect(() => {
    fetchData()
  }, [projectId])

  const fetchData = async (showLoading = true) => {
    if (showLoading) setIsLoading(true)
    setError(null)
    try {
      // Fetch IAP data and project data in parallel
      const [iapResponse, projectResponse] = await Promise.all([
        fetch(`/api/iap?projectId=${projectId}`),
        fetch(`/api/projects/${projectId}`),
      ])

      if (!iapResponse.ok) {
        throw new Error('Failed to fetch IAP data')
      }
      const data = await iapResponse.json()

      // Fetch intro offers for all subscriptions
      const groups = data.subscriptionGroups || []
      const allSubscriptions: Subscription[] = groups.flatMap((g: SubscriptionGroup) => g.subscriptions || [])

      // Fetch intro offers in parallel (batch of 5 at a time to avoid overwhelming)
      const introOfferPromises = allSubscriptions.map(async (sub: Subscription) => {
        try {
          const res = await fetch(`/api/subscriptions/${sub.id}/intro-offer?projectId=${projectId}`)
          if (res.ok) {
            const offerData = await res.json()
            return { subId: sub.id, introOffer: offerData.introOffer }
          }
        } catch {
          // Ignore errors for individual intro offer fetches
        }
        return { subId: sub.id, introOffer: null }
      })

      const introOfferResults = await Promise.all(introOfferPromises)
      const introOfferMap = new Map(introOfferResults.map(r => [r.subId, r.introOffer]))

      // Fetch pricing for subscriptions in parallel
      const subPricingPromises = allSubscriptions.map(async (sub: Subscription) => {
        try {
          const res = await fetch(`/api/subscriptions/${sub.id}/pricing?projectId=${projectId}`)
          if (res.ok) {
            const pricingData = await res.json()
            return { subId: sub.id, price: pricingData.pricing?.basePrice ?? null }
          }
        } catch {
          // Ignore errors for individual pricing fetches
        }
        return { subId: sub.id, price: null }
      })

      const subPricingResults = await Promise.all(subPricingPromises)
      const subPricingMap = new Map(subPricingResults.map(r => [r.subId, r.price]))

      // Merge intro offers and pricing into subscription groups
      const groupsWithOffers = groups.map((group: SubscriptionGroup) => ({
        ...group,
        subscriptions: (group.subscriptions || []).map((sub: Subscription) => ({
          ...sub,
          introOffer: introOfferMap.get(sub.id) || null,
          price: subPricingMap.get(sub.id) ?? null,
        })),
      }))

      setSubscriptionGroups(groupsWithOffers)

      // Fetch pricing for IAPs in parallel
      const iapList = data.iaps || []
      const iapPricingPromises = iapList.map(async (iap: InAppPurchase) => {
        try {
          const res = await fetch(`/api/iap/${iap.id}/pricing?projectId=${projectId}`)
          if (res.ok) {
            const pricingData = await res.json()
            return { iapId: iap.id, price: pricingData.pricing?.basePrice ?? null }
          }
        } catch {
          // Ignore errors for individual pricing fetches
        }
        return { iapId: iap.id, price: null }
      })

      const iapPricingResults = await Promise.all(iapPricingPromises)
      const iapPricingMap = new Map(iapPricingResults.map(r => [r.iapId, r.price]))

      // Merge pricing into IAPs
      const iapsWithPricing = iapList.map((iap: InAppPurchase) => ({
        ...iap,
        price: iapPricingMap.get(iap.id) ?? null,
      }))
      setIaps(iapsWithPricing)

      // Auto-expand groups with subscriptions
      const groupIds = new Set<string>(groups.map((g: SubscriptionGroup) => g.id))
      setExpandedGroups(groupIds)

      // Get project's enabled locales and App Store App ID
      if (projectResponse.ok) {
        const projectData = await projectResponse.json()
        if (projectData.project?.enabledLocales?.length > 0) {
          setEnabledLocales(projectData.project.enabledLocales)
        }
        if (projectData.project?.primaryLocale) {
          setPrimaryLocale(projectData.project.primaryLocale)
        }
        if (projectData.project?.appStoreAppId) {
          setAppStoreAppId(projectData.project.appStoreAppId)
        }

        // Store project info for RevenueCat setup
        setProjectInfo({
          name: projectData.project?.name || 'My App',
          storeType: projectData.project?.storeType || 'ios',
          appStoreAppId: projectData.project?.appStoreAppId || null,
          playStorePackage: projectData.project?.playStorePackage || null,
        })

        // For Android, prefill package name immediately
        if (projectData.project?.storeType === 'android' && projectData.project?.playStorePackage) {
          setBundleId(projectData.project.playStorePackage)
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data')
    } finally {
      setIsLoading(false)
    }
  }

  // Fetch RevenueCat status
  const fetchRevenueCatStatus = async () => {
    if (!internalIntegrationsEnabled) {
      setRevenueCatStatus(null)
      return
    }

    setIsLoadingRevenueCat(true)
    try {
      const response = await fetch(`/api/revenuecat/status?projectId=${projectId}`)
      if (response.ok) {
        const data = await response.json()
        setRevenueCatStatus(data)
      }
    } catch (err) {
      console.error('Failed to fetch RevenueCat status:', err)
    } finally {
      setIsLoadingRevenueCat(false)
    }
  }

  // Create RevenueCat app
  const handleCreateRevenueCatApp = async () => {
    if (!bundleId) {
      setError(projectInfo?.storeType === 'android' ? 'Package name is required' : 'Bundle ID is required')
      return
    }

    setIsCreatingApp(true)
    setError(null)

    try {
      const isAndroid = projectInfo?.storeType === 'android'
      const baseName = projectInfo?.name || 'My App'
      const appName = `${baseName} (${isAndroid ? 'Android' : 'iOS'})`

      const response = await fetch('/api/revenuecat/apps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          name: appName,
          type: isAndroid ? 'play_store' : 'app_store',
          ...(isAndroid ? { packageName: bundleId } : { bundleId }),
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to create app')
      }

      setSuccess('RevenueCat app created successfully')
      setShowRevenueCatSetup(false)
      setBundleId('')
      fetchRevenueCatStatus()
      setTimeout(() => setSuccess(null), 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create app')
    } finally {
      setIsCreatingApp(false)
    }
  }

  // Sync products to RevenueCat
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

  // Fetch RevenueCat status on mount
  useEffect(() => {
    if (internalIntegrationsEnabled) {
      fetchRevenueCatStatus()
    } else {
      setRevenueCatStatus(null)
    }
  }, [projectId, internalIntegrationsEnabled])

  // Open RevenueCat setup modal with prefilled data
  const openRevenueCatSetup = async () => {
    // For iOS, fetch the bundle ID from App Store Connect
    if (projectInfo?.storeType === 'ios' && projectInfo.appStoreAppId && !bundleId) {
      setIsLoadingSetup(true)
      try {
        const response = await fetch('/api/stores/apps')
        if (response.ok) {
          const data = await response.json()
          const matchingApp = data.appstore?.apps?.find(
            (app: { id: string; bundleId: string }) => app.id === projectInfo.appStoreAppId
          )
          if (matchingApp?.bundleId) {
            setBundleId(matchingApp.bundleId)
          }
        }
      } catch (err) {
        console.error('Failed to fetch bundle ID:', err)
      } finally {
        setIsLoadingSetup(false)
      }
    }
    setShowRevenueCatSetup(true)
  }

  const handlePull = async () => {
    // Show modal with pending state
    setShowPullModal(true)
    setPullResults({ status: 'pending' })

    // Brief delay to show pending state
    await new Promise(resolve => setTimeout(resolve, 300))

    // Update to pulling state
    setPullResults({ status: 'pulling' })
    setIsPulling(true)
    setError(null)

    try {
      const response = await fetch('/api/iap/pull', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId }),
      })
      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to pull from App Store')
      }
      const data = await response.json()

      // Update modal with results
      setPullResults({
        status: 'complete',
        summary: data.summary,
      })

      // Check for orphaned products
      if (data.orphanedProducts && data.orphanedProducts.length > 0) {
        setOrphanedProducts(data.orphanedProducts)
      }

      fetchData()
    } catch (err) {
      setPullResults({
        status: 'complete',
        error: err instanceof Error ? err.message : 'Failed to pull',
      })
    } finally {
      setIsPulling(false)
    }
  }

  const closePullModal = () => {
    // If there are orphans, show the orphan modal after closing pull modal
    if (orphanedProducts.length > 0) {
      setShowPullModal(false)
      setPullResults(null)
      setShowOrphanModal(true)
    } else {
      setShowPullModal(false)
      setPullResults(null)
    }
  }

  const handleDeleteOrphans = async (orphansToDelete: typeof orphanedProducts) => {
    setIsDeletingOrphans(true)
    try {
      const response = await fetch('/api/iap/delete-orphans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          orphans: orphansToDelete.map(o => ({
            id: o.id,
            type: o.type,
            groupId: o.groupId,
          })),
        }),
      })
      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to delete orphaned products')
      }
      const data = await response.json()
      setSuccess(`Deleted ${data.deletedCount} orphaned product${data.deletedCount !== 1 ? 's' : ''}`)
      setTimeout(() => setSuccess(null), 5000)
      setShowOrphanModal(false)
      setOrphanedProducts([])
      fetchData()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete orphans')
    } finally {
      setIsDeletingOrphans(false)
    }
  }

  const handlePush = async () => {
    // Get all pending item IDs for tracking
    const allPendingIds = [
      ...pendingIAPs.map(i => i.productId),
      ...pendingSubscriptions.map(s => s.productId),
    ]

    // Get document IDs for subscriptions (needed by API)
    const pendingSubscriptionDocIds = subscriptionGroups.flatMap(g =>
      g.subscriptions.filter(s => s.syncStatus !== 'synced').map(s => s.id)
    )

    // Show modal with pending state
    setShowPushModal(true)
    setPushResults({
      status: 'pending',
      created: [],
      updated: [],
      skipped: [],
      errors: [],
      itemProgress: {},
    })

    setIsPushing(true)
    setError(null)

    try {
      // Use streaming endpoint for real-time progress
      const response = await fetch('/api/iap/push/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          pushAll: true,
          subscriptionIds: pendingSubscriptionDocIds,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to push to App Store')
      }

      // Process SSE stream
      const reader = response.body?.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      if (!reader) throw new Error('No response body')

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const event = JSON.parse(line.slice(6))

              switch (event.type) {
                case 'start':
                  setPushResults(prev => prev ? {
                    ...prev,
                    status: 'pushing',
                    itemProgress: {},
                  } : null)
                  break

                case 'item_start':
                  setPushResults(prev => prev ? {
                    ...prev,
                    currentItem: event.itemId,
                    itemProgress: {
                      ...prev.itemProgress,
                      [event.itemId]: { step: event.step },
                    },
                  } : null)
                  break

                case 'item_progress':
                  setPushResults(prev => prev ? {
                    ...prev,
                    itemProgress: {
                      ...prev.itemProgress,
                      [event.itemId]: {
                        step: event.step,
                        detail: event.detail,
                        progress: event.progress,
                      },
                    },
                  } : null)
                  break

                case 'item_complete':
                  setPushResults(prev => {
                    if (!prev) return null
                    const newState = { ...prev }
                    if (event.result === 'created') {
                      newState.created = [...prev.created, event.itemId]
                    } else if (event.result === 'updated') {
                      newState.updated = [...prev.updated, event.itemId]
                    } else if (event.result === 'error' && event.error) {
                      newState.errors = [...prev.errors, { id: event.itemId, error: event.error }]
                    }
                    // Clear current item progress display
                    if (newState.itemProgress) {
                      delete newState.itemProgress[event.itemId]
                    }
                    return newState
                  })
                  break

                case 'complete':
                  // Calculate skipped items
                  const processedIds = new Set([
                    ...event.created,
                    ...event.updated,
                    ...event.errors.map((e: { id: string }) => e.id),
                  ])
                  const skipped = allPendingIds.filter(id => !processedIds.has(id))

                  setPushResults({
                    status: 'complete',
                    created: event.created,
                    updated: event.updated,
                    skipped,
                    errors: event.errors,
                    itemProgress: {},
                    currentItem: undefined,
                  })
                  break
              }
            } catch (parseError) {
              console.error('Failed to parse SSE event:', parseError)
            }
          }
        }
      }
    } catch (err) {
      setPushResults({
        status: 'complete',
        created: [],
        updated: [],
        skipped: allPendingIds,
        errors: [{ id: 'global', error: err instanceof Error ? err.message : 'Failed to push' }],
        itemProgress: {},
      })
    } finally {
      setIsPushing(false)
    }
  }

  const closePushModal = () => {
    setShowPushModal(false)
    setPushResults(null)
    // Refresh data after closing the modal
    fetchData()
  }

  const toggleGroup = (groupId: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev)
      if (next.has(groupId)) {
        next.delete(groupId)
      } else {
        next.add(groupId)
      }
      return next
    })
  }

  const renderSyncStatus = (status: string) => {
    const colorClass = SYNC_STATUS_COLORS[status] || 'bg-neutral-500/20 text-neutral-400 border-neutral-500/30'
    const label = status === 'synced' ? 'Synced' : status === 'local_changes' ? 'Modified' : 'Pending'
    return (
      <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${colorClass}`}>
        {label}
      </span>
    )
  }

  const renderState = (state: string | null) => {
    if (!state) return null
    const colorClass = STATE_COLORS[state] || 'bg-neutral-500/20 text-neutral-400 border-neutral-500/30'
    const label = state.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase())
    return (
      <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${colorClass}`}>
        {label}
      </span>
    )
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-6 h-6 animate-spin text-purple-400" />
      </div>
    )
  }

  // Render Play Store IAP page for Android projects
  if ((projectInfo as any)?.storeType === 'android') {
    return <PlayStoreIAPPage projectId={projectId} />
  }

  const filteredIAPs = filter === 'subscriptions' ? [] : iaps
  const filteredGroups = filter === 'iaps' ? [] : subscriptionGroups

  // Get items that have pending changes
  const pendingIAPs = iaps.filter(i => i.syncStatus !== 'synced')
  const pendingSubscriptions = subscriptionGroups.flatMap(g =>
    g.subscriptions.filter(s => s.syncStatus !== 'synced')
  )
  const hasPendingChanges = pendingIAPs.length > 0 || pendingSubscriptions.length > 0

  return (
    <div className="space-y-6">
      {/* Header - Responsive */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-white flex items-center gap-2 sm:gap-3">
            <Package className="w-6 h-6 sm:w-7 sm:h-7 text-purple-400" />
            In-App Purchases
          </h1>
          <p className="text-neutral-400 text-sm mt-1 hidden sm:block">
            Manage your app's IAPs and subscriptions
          </p>
        </div>
        {/* Action buttons - stack on mobile */}
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={handlePull}
            disabled={isPulling}
            className="flex items-center gap-2 px-3 sm:px-4 py-2 rounded-lg text-sm font-medium
                     bg-white/[0.05] text-neutral-300 hover:bg-white/[0.08] hover:text-white
                     disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            {isPulling ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            <span className="hidden xs:inline">Pull</span>
            <span className="hidden sm:inline"> from Store</span>
          </button>
          <button
            onClick={handlePush}
            disabled={isPushing}
            className="flex items-center gap-2 px-3 sm:px-4 py-2 rounded-lg text-sm font-medium
                     bg-gradient-to-r from-purple-500 to-blue-500 text-white
                     hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            {isPushing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            <span className="hidden xs:inline">Push</span>
            <span className="hidden sm:inline"> to Store</span>
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

      {/* MCP Integration Note - Collapsible on mobile */}
      <div className="hidden sm:block p-4 rounded-xl bg-gradient-to-br from-purple-500/10 to-blue-500/10 border border-purple-500/20">
        <div className="flex items-start gap-3">
          <Sparkles className="w-5 h-5 text-purple-400 mt-0.5 flex-shrink-0" />
          <div>
            <h3 className="text-sm font-medium text-white mb-1">
              AI-Powered IAP Management
            </h3>
            <p className="text-sm text-neutral-400 leading-relaxed">
              Use <span className="text-purple-400">Claude Code</span>, <span className="text-purple-400">Cursor</span>, or any MCP-compatible IDE with tools like{' '}
              <code className="px-1.5 py-0.5 rounded bg-white/[0.1] text-purple-300 text-xs font-mono">create_iap_product</code>,{' '}
              <code className="px-1.5 py-0.5 rounded bg-white/[0.1] text-purple-300 text-xs font-mono">translate_iap_product</code>, and{' '}
              <code className="px-1.5 py-0.5 rounded bg-white/[0.1] text-purple-300 text-xs font-mono">set_iap_pricing</code>{' '}
              to automate IAP creation, translation, and regional pricing.
            </p>
          </div>
        </div>
      </div>

      {/* RevenueCat Integration */}
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
                  disabled={isSyncingToRevenueCat || (iaps.length === 0 && subscriptionGroups.flatMap(g => g.subscriptions).length === 0)}
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
                  onClick={openRevenueCatSetup}
                  disabled={isLoadingSetup}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium
                           bg-orange-500/20 text-orange-400 hover:bg-orange-500/30 disabled:opacity-50 transition-all"
                >
                  {isLoadingSetup ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Plus className="w-3.5 h-3.5" />
                  )}
                  {isLoadingSetup ? 'Loading...' : 'Create App'}
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
                {projectInfo?.name && (
                  <span className="text-white font-medium">{projectInfo.name}</span>
                )}
                {projectInfo?.name && ' • '}
                {projectInfo?.storeType === 'android' ? 'Google Play Store' : 'Apple App Store'}
              </p>
            </div>
            <div className="p-6 space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-neutral-300">
                  {projectInfo?.storeType === 'android' ? 'Package Name' : 'Bundle ID'}
                </label>
                <input
                  type="text"
                  value={bundleId}
                  onChange={(e) => setBundleId(e.target.value)}
                  placeholder={projectInfo?.storeType === 'android' ? 'com.example.myapp' : 'com.example.myapp'}
                  className="w-full px-4 py-3 rounded-xl text-sm text-white
                           bg-black/40 border border-white/[0.08]
                           placeholder:text-neutral-600
                           focus:border-orange-500/50 focus:ring-1 focus:ring-orange-500/20
                           focus:outline-none transition-all"
                />
                <p className="text-xs text-neutral-500">
                  {projectInfo?.storeType === 'android'
                    ? 'Your Android app\'s package name from build.gradle'
                    : 'Your iOS app\'s bundle identifier from Xcode'}
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
                disabled={!bundleId || isCreatingApp}
                className="flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-medium
                         bg-gradient-to-r from-orange-500 to-amber-500 text-white
                         hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                {isCreatingApp ? (
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

      {/* Alerts */}
      {error && (
        <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 flex items-center gap-2">
          <AlertCircle className="w-4 h-4" />
          {error}
        </div>
      )}

      {success && (
        <div className="p-4 rounded-xl bg-green-500/10 border border-green-500/20 text-green-400 flex items-center gap-2">
          <Check className="w-4 h-4" />
          {success}
        </div>
      )}

      {/* Filter tabs - Responsive */}
      <div className="flex gap-1.5 sm:gap-2 border-b border-white/[0.08] pb-4 overflow-x-auto scrollbar-none">
        {(['all', 'iaps', 'subscriptions'] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 sm:px-4 py-2 rounded-lg text-xs sm:text-sm font-medium transition-all whitespace-nowrap flex-shrink-0 ${
              filter === f
                ? 'bg-purple-500/20 text-purple-400 border border-purple-500/30'
                : 'text-neutral-400 hover:text-white hover:bg-white/[0.05]'
            }`}
          >
            {f === 'all' ? 'All' : f === 'iaps' ? 'Purchases' : 'Subscriptions'}
            <span className="hidden sm:inline">{f === 'all' ? ' Products' : f === 'iaps' ? '' : ''}</span>
          </button>
        ))}
      </div>

      {/* Empty state */}
      {filteredIAPs.length === 0 && filteredGroups.length === 0 && (
        <div className="text-center py-12">
          <Package className="w-12 h-12 text-neutral-600 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-white mb-2">No products yet</h3>
          <p className="text-neutral-400 mb-4">
            Pull from App Store Connect or create new products
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

      {/* IAPs List */}
      {filteredIAPs.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            <Coins className="w-5 h-5 text-amber-400" />
            One-Time Purchases
          </h2>
          <div className="space-y-2">
            {filteredIAPs.map(iap => (
              <div
                key={iap.id}
                onClick={() => setSelectedProduct({ product: iap, type: 'iap' })}
                className="group p-4 rounded-xl bg-white/[0.02] border border-white/[0.08]
                         hover:border-purple-500/30 hover:bg-white/[0.04]
                         transition-all cursor-pointer"
              >
                <div className="flex items-center justify-between gap-4">
                  {/* Left: Icon + Info */}
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div className="p-2.5 rounded-xl bg-amber-500/20 text-amber-400 flex-shrink-0">
                      {PRODUCT_TYPE_ICONS[iap.productType]}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-white">{iap.name}</span>
                        {/* Price display */}
                        {iap.price != null ? (
                          <span className="text-sm font-medium text-green-400">
                            ${iap.price.toFixed(2)}
                          </span>
                        ) : (
                          <span className="text-xs text-neutral-600 italic">
                            No price
                          </span>
                        )}
                        <span className="text-xs text-neutral-500">{PRODUCT_TYPE_LABELS[iap.productType]}</span>
                        {iap.familyShareable && (
                          <span className="text-xs text-purple-400">• Family</span>
                        )}
                      </div>
                      {/* Product ID on its own line */}
                      <div className="mt-1">
                        <span className="text-xs text-neutral-500 font-mono">
                          {iap.productId}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Right: Status */}
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {/* Status - Combined badge */}
                    <div className="hidden xs:flex items-center gap-1.5">
                      {renderState(iap.state)}
                      {renderSyncStatus(iap.syncStatus)}
                    </div>
                    {/* Mobile: Single status indicator */}
                    <div className="xs:hidden">
                      {iap.syncStatus !== 'synced' ? (
                        renderSyncStatus(iap.syncStatus)
                      ) : (
                        renderState(iap.state)
                      )}
                    </div>

                    {/* Arrow indicator */}
                    <ChevronRight className="w-5 h-5 text-neutral-500 group-hover:text-white transition-colors" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Subscription Groups */}
      {filteredGroups.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            <CreditCard className="w-5 h-5 text-blue-400" />
            Subscription Groups
          </h2>
          <div className="space-y-3">
            {filteredGroups.map(group => (
              <div
                key={group.id}
                className="rounded-xl bg-white/[0.02] border border-white/[0.08] overflow-hidden"
              >
                <div className="w-full p-4 flex items-center justify-between">
                  <div className="flex items-center gap-3 flex-1">
                    <button
                      onClick={() => toggleGroup(group.id)}
                      className="p-1 rounded hover:bg-white/[0.05] transition-all"
                    >
                      {expandedGroups.has(group.id) ? (
                        <ChevronDown className="w-5 h-5 text-neutral-400" />
                      ) : (
                        <ChevronRight className="w-5 h-5 text-neutral-400" />
                      )}
                    </button>
                    <button
                      onClick={() => setEditingGroup(group)}
                      className="flex items-center gap-3 flex-1 hover:opacity-80 transition-all text-left"
                    >
                      <div className="p-2 rounded-lg bg-blue-500/20 text-blue-400">
                        <Package className="w-4 h-4" />
                      </div>
                      <div className="flex-1">
                        <span className="font-medium text-white">{group.referenceName}</span>
                        <span className="text-xs text-neutral-500 ml-2">
                          {group.subscriptions.length} subscription{group.subscriptions.length !== 1 ? 's' : ''}
                        </span>
                      </div>
                    </button>
                  </div>
                  <button
                    onClick={() => setEditingGroup(group)}
                    className="flex items-center gap-2 hover:opacity-80 transition-all group/edit"
                  >
                    {renderSyncStatus(group.syncStatus)}
                    <ChevronRight className="w-5 h-5 text-neutral-500 group-hover/edit:text-neutral-300 transition-colors" />
                  </button>
                </div>

                {expandedGroups.has(group.id) && group.subscriptions.length > 0 && (
                  <div className="border-t border-white/[0.06] px-4 pb-4">
                    <div className="space-y-2 mt-3 sm:ml-10">
                      {group.subscriptions.map((sub) => (
                        <div
                          key={sub.id}
                          onClick={() => setSelectedProduct({ product: sub, type: 'subscription' })}
                          className="group p-3 rounded-lg bg-white/[0.02] border border-white/[0.06]
                                   hover:border-blue-500/30 hover:bg-white/[0.04]
                                   transition-all cursor-pointer"
                        >
                          <div className="flex items-center justify-between gap-3">
                            {/* Left: Level + Info */}
                            <div className="flex items-center gap-3 min-w-0 flex-1">
                              <div className="w-7 h-7 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center text-xs font-semibold flex-shrink-0">
                                {sub.groupLevel}
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="font-medium text-white">{sub.name}</span>
                                  {/* Price display */}
                                  {sub.price != null ? (
                                    <span className="text-sm font-medium text-green-400">
                                      ${sub.price.toFixed(2)}
                                    </span>
                                  ) : (
                                    <span className="text-xs text-neutral-600 italic">
                                      No price
                                    </span>
                                  )}
                                  <span className="text-xs text-neutral-500">
                                    {PERIOD_LABELS[sub.subscriptionPeriod] || sub.subscriptionPeriod}
                                  </span>
                                  {sub.familyShareable && (
                                    <span className="text-xs text-purple-400">• Family</span>
                                  )}
                                  {sub.introOffer && (
                                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                                      sub.introOffer.offerMode === 'FREE_TRIAL'
                                        ? 'bg-green-500/20 text-green-400'
                                        : sub.introOffer.offerMode === 'PAY_UP_FRONT'
                                        ? 'bg-blue-500/20 text-blue-400'
                                        : 'bg-purple-500/20 text-purple-400'
                                    }`}>
                                      {sub.introOffer.offerMode === 'FREE_TRIAL' ? 'Free Trial' :
                                       sub.introOffer.offerMode === 'PAY_UP_FRONT' ? 'Pay Up Front' : 'Pay As You Go'}
                                      {' · '}
                                      {DURATION_LABELS[sub.introOffer.duration] || sub.introOffer.duration}
                                    </span>
                                  )}
                                </div>
                                {/* Product ID on its own line */}
                                <div className="mt-1">
                                  <span className="text-xs text-neutral-500 font-mono">
                                    {sub.productId}
                                  </span>
                                </div>
                              </div>
                            </div>

                            {/* Right: Status */}
                            <div className="flex items-center gap-2 flex-shrink-0">
                              {/* Desktop: Both badges */}
                              <div className="hidden sm:flex items-center gap-1.5">
                                {renderState(sub.state)}
                                {renderSyncStatus(sub.syncStatus)}
                              </div>
                              {/* Mobile: Priority badge only */}
                              <div className="sm:hidden">
                                {sub.syncStatus !== 'synced' ? (
                                  renderSyncStatus(sub.syncStatus)
                                ) : (
                                  renderState(sub.state)
                                )}
                              </div>

                              {/* Arrow indicator */}
                              <ChevronRight className="w-5 h-5 text-neutral-500 group-hover:text-white transition-colors" />
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Create Modal */}
      {showCreateModal && (
        <CreateProductModal
          projectId={projectId}
          existingGroups={subscriptionGroups}
          onClose={() => setShowCreateModal(false)}
          onCreated={() => {
            setShowCreateModal(false)
            fetchData()
            setSuccess('Product created successfully')
            setTimeout(() => setSuccess(null), 3000)
          }}
        />
      )}

      {/* Unified Product Detail Panel */}
      {selectedProduct && (
        <ProductDetailPanel
          projectId={projectId}
          product={selectedProduct.product}
          productType={selectedProduct.type}
          subscriptionPeriod={selectedProduct.type === 'subscription' ? (selectedProduct.product as Subscription).subscriptionPeriod : undefined}
          primaryLocale={primaryLocale}
          enabledLocales={enabledLocales}
          appStoreAppId={appStoreAppId}
          onClose={() => setSelectedProduct(null)}
          onUpdated={() => fetchData(false)}
          onDelete={() => {
            setSelectedProduct(null)
            fetchData()
          }}
          initialTab={selectedProduct.initialTab}
        />
      )}

      {/* Pull Progress Modal */}
      {showPullModal && pullResults && (
        <PullProgressModal
          status={pullResults.status}
          summary={pullResults.summary}
          error={pullResults.error}
          hasOrphans={orphanedProducts.length > 0}
          onClose={closePullModal}
        />
      )}

      {/* Push Progress Modal */}
      {showPushModal && pushResults && (
        <PushProgressModal
          status={pushResults.status}
          pendingItems={[
            ...pendingIAPs.map(i => ({ id: i.productId, name: i.name, type: 'iap' as const })),
            ...pendingSubscriptions.map(s => ({ id: s.productId, name: s.name, type: 'subscription' as const })),
          ]}
          created={pushResults.created}
          updated={pushResults.updated}
          skipped={pushResults.skipped}
          errors={pushResults.errors}
          itemProgress={pushResults.itemProgress}
          currentItem={pushResults.currentItem}
          onClose={closePushModal}
        />
      )}

      {/* Group Detail Panel */}
      {editingGroup && (
        <GroupDetailPanel
          projectId={projectId}
          group={editingGroup}
          primaryLocale={primaryLocale}
          enabledLocales={enabledLocales}
          onClose={() => setEditingGroup(null)}
          onUpdated={() => fetchData(false)}
        />
      )}

      {/* Orphaned Products Warning Modal */}
      {showOrphanModal && orphanedProducts.length > 0 && (
        <OrphanedProductsModal
          orphans={orphanedProducts}
          isDeleting={isDeletingOrphans}
          onDelete={handleDeleteOrphans}
          onClose={() => {
            setShowOrphanModal(false)
            setOrphanedProducts([])
          }}
        />
      )}
    </div>
  )
}

// Create Product Modal
function CreateProductModal({
  projectId,
  existingGroups,
  onClose,
  onCreated,
}: {
  projectId: string
  existingGroups: SubscriptionGroup[]
  onClose: () => void
  onCreated: () => void
}) {
  const [type, setType] = useState<'iap' | 'subscription'>('iap')
  const [isCreating, setIsCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // IAP fields
  const [productId, setProductId] = useState('')
  const [name, setName] = useState('')
  const [productType, setProductType] = useState<'CONSUMABLE' | 'NON_CONSUMABLE' | 'NON_RENEWING_SUBSCRIPTION'>('NON_CONSUMABLE')
  const [familyShareable, setFamilyShareable] = useState(false)
  const [displayName, setDisplayName] = useState('')
  const [description, setDescription] = useState('')

  // Subscription fields
  const [groupId, setGroupId] = useState('')
  const [newGroupName, setNewGroupName] = useState('')
  const [subscriptionPeriod, setSubscriptionPeriod] = useState<string>('ONE_MONTH')

  // Pricing fields
  const [showPricing, setShowPricing] = useState(true)
  const [basePricePointId, setBasePricePointId] = useState<string>('')
  const [pricingStrategy, setPricingStrategy] = useState<string>('equalized')

  const PRICE_POINTS = [
    { id: 'p1', value: 0.99, label: '$0.99' },
    { id: 'p2', value: 1.99, label: '$1.99' },
    { id: 'p3', value: 2.99, label: '$2.99' },
    { id: 'p4', value: 3.99, label: '$3.99' },
    { id: 'p5', value: 4.99, label: '$4.99' },
    { id: 'p6', value: 5.99, label: '$5.99' },
    { id: 'p7', value: 6.99, label: '$6.99' },
    { id: 'p8', value: 7.99, label: '$7.99' },
    { id: 'p9', value: 9.99, label: '$9.99' },
    { id: 'p10', value: 11.99, label: '$11.99' },
    { id: 'p11', value: 14.99, label: '$14.99' },
    { id: 'p12', value: 19.99, label: '$19.99' },
    { id: 'p13', value: 29.99, label: '$29.99' },
    { id: 'p14', value: 49.99, label: '$49.99' },
    { id: 'p15', value: 99.99, label: '$99.99' },
  ]

  const STRATEGIES = [
    { id: 'equalized', name: 'Apple Equalized', description: 'Automatic FX-based pricing' },
    { id: 'ppp_standard', name: 'PPP Standard', description: '~31% avg discount for emerging markets' },
    { id: 'aggressive_growth', name: 'Aggressive Growth', description: '~53% avg discount to maximize downloads' },
  ]

  const handleCreate = async () => {
    if (!productId.trim() || !name.trim()) {
      setError('Product ID and name are required')
      return
    }

    if (type === 'subscription' && !groupId && !newGroupName.trim()) {
      setError('Please select an existing group or enter a new group name')
      return
    }

    if (!basePricePointId) {
      setError('Please select a base price for this product')
      setShowPricing(true)
      return
    }

    setIsCreating(true)
    setError(null)

    try {
      const endpoint = type === 'iap' ? '/api/iap/create' : '/api/subscriptions/create'
      const body = type === 'iap'
        ? {
            projectId,
            productId,
            name,
            productType,
            familyShareable,
            localizations: displayName || description ? [{
              locale: 'en-US',
              displayName: displayName || name,
              description: description || '',
            }] : undefined,
          }
        : {
            projectId,
            productId,
            name,
            groupId: groupId || undefined,
            newGroupName: newGroupName || undefined,
            // Auto-calculate level: new groups start at 1, existing groups add at next level
            groupLevel: groupId
              ? (existingGroups.find((g: SubscriptionGroup) => g.id === groupId)?.subscriptions.length || 0) + 1
              : 1,
            subscriptionPeriod,
            familyShareable,
            localizations: displayName || description ? [{
              locale: 'en-US',
              displayName: displayName || name,
              description: description || '',
            }] : undefined,
          }

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to create product')
      }

      const createData = await response.json()
      const createdId = type === 'iap' ? createData.iap?.id : createData.subscription?.id

      // Save pricing if configured
      if (basePricePointId && createdId) {
        const pricingEndpoint = type === 'iap'
          ? `/api/iap/${createdId}/pricing`
          : `/api/subscriptions/${createdId}/pricing`

        const pricingResponse = await fetch(pricingEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectId,
            basePricePointId,
            baseTerritory: 'USA',
            strategyId: pricingStrategy,
          }),
        })

        if (!pricingResponse.ok) {
          console.warn('Failed to save pricing config, but product was created')
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
        <div className="p-6 border-b border-white/[0.08] flex-shrink-0">
          <h2 className="text-xl font-semibold text-white">Create New Product</h2>
          <p className="text-neutral-400 text-sm mt-1">Add a new IAP or subscription</p>
        </div>

        <div className="p-6 space-y-4 overflow-y-auto flex-1 scrollbar-dark">
          {/* Type selector */}
          <div className="flex gap-2">
            <button
              onClick={() => setType('iap')}
              className={`flex-1 p-3 rounded-lg border text-sm font-medium transition-all ${
                type === 'iap'
                  ? 'bg-purple-500/20 border-purple-500/30 text-purple-400'
                  : 'bg-white/[0.02] border-white/[0.08] text-neutral-400 hover:text-white'
              }`}
            >
              <Coins className="w-5 h-5 mx-auto mb-1" />
              One-Time Purchase
            </button>
            <button
              onClick={() => setType('subscription')}
              className={`flex-1 p-3 rounded-lg border text-sm font-medium transition-all ${
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

          {/* Common fields */}
          <div>
            <label className="block text-sm font-medium text-neutral-300 mb-1">Product ID</label>
            <input
              type="text"
              value={productId}
              onChange={e => setProductId(e.target.value)}
              placeholder="com.yourapp.product"
              className="w-full px-3 py-2 rounded-lg bg-white/[0.03] border border-white/[0.08] text-white placeholder:text-neutral-600 focus:outline-none focus:border-purple-500/50"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-neutral-300 mb-1">Reference Name</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Internal name"
              className="w-full px-3 py-2 rounded-lg bg-white/[0.03] border border-white/[0.08] text-white placeholder:text-neutral-600 focus:outline-none focus:border-purple-500/50"
            />
          </div>

          {/* IAP-specific fields */}
          {type === 'iap' && (
            <div>
              <label className="block text-sm font-medium text-neutral-300 mb-1">Product Type</label>
              <select
                value={productType}
                onChange={e => setProductType(e.target.value as any)}
                className="w-full px-3 py-2 rounded-lg bg-white/[0.03] border border-white/[0.08] text-white focus:outline-none focus:border-purple-500/50"
              >
                <option value="CONSUMABLE">Consumable</option>
                <option value="NON_CONSUMABLE">Non-Consumable</option>
                <option value="NON_RENEWING_SUBSCRIPTION">Non-Renewing Subscription</option>
              </select>
            </div>
          )}

          {/* Subscription-specific fields */}
          {type === 'subscription' && (
            <>
              <div>
                <label className="block text-sm font-medium text-neutral-300 mb-2">Subscription Group</label>

                {/* Existing groups */}
                {existingGroups.length > 0 && (
                  <div className="space-y-2 mb-3">
                    {existingGroups.map(group => (
                      <button
                        key={group.id}
                        type="button"
                        onClick={() => {
                          setGroupId(group.id)
                          setNewGroupName('')
                        }}
                        className={`w-full p-3 rounded-lg border text-left transition-all ${
                          groupId === group.id
                            ? 'bg-blue-500/20 border-blue-500/50 text-blue-400'
                            : 'bg-white/[0.02] border-white/[0.08] text-neutral-300 hover:bg-white/[0.04] hover:border-white/[0.12]'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Package className="w-4 h-4" />
                            <span className="font-medium">{group.referenceName}</span>
                          </div>
                          <span className="text-xs text-neutral-500">
                            {group.subscriptions.length} subscription{group.subscriptions.length !== 1 ? 's' : ''}
                          </span>
                        </div>
                        {groupId === group.id && (
                          <div className="text-xs text-blue-400/70 mt-1">
                            Will be added as level {group.subscriptions.length + 1}
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                )}

                {/* Create new group option */}
                <div
                  className={`p-3 rounded-lg border transition-all ${
                    !groupId && newGroupName
                      ? 'bg-green-500/10 border-green-500/30'
                      : 'bg-white/[0.02] border-white/[0.08]'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <Plus className="w-4 h-4 text-neutral-400" />
                    <span className="text-sm text-neutral-400">Create new group</span>
                  </div>
                  <input
                    type="text"
                    value={newGroupName}
                    onChange={e => {
                      setNewGroupName(e.target.value)
                      if (e.target.value) setGroupId('')
                    }}
                    placeholder="Enter group name..."
                    className="w-full px-3 py-2 rounded-lg bg-white/[0.03] border border-white/[0.08] text-white placeholder:text-neutral-600 focus:outline-none focus:border-green-500/50 text-sm"
                  />
                </div>

                {!groupId && !newGroupName && existingGroups.length > 0 && (
                  <p className="text-xs text-neutral-500 mt-2">
                    Select an existing group above or create a new one
                  </p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-neutral-300 mb-1">Billing Period</label>
                <select
                  value={subscriptionPeriod}
                  onChange={e => setSubscriptionPeriod(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-white/[0.03] border border-white/[0.08] text-white focus:outline-none focus:border-purple-500/50"
                >
                  <option value="ONE_WEEK">Weekly</option>
                  <option value="ONE_MONTH">Monthly</option>
                  <option value="TWO_MONTHS">Every 2 Months</option>
                  <option value="THREE_MONTHS">Every 3 Months</option>
                  <option value="SIX_MONTHS">Every 6 Months</option>
                  <option value="ONE_YEAR">Yearly</option>
                </select>
              </div>
            </>
          )}

          {/* Localization fields */}
          <div className="border-t border-white/[0.08] pt-4 mt-4">
            <h3 className="text-sm font-medium text-neutral-300 mb-3">Localization (en-US)</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-neutral-500 mb-1">Display Name (30 chars)</label>
                <input
                  type="text"
                  value={displayName}
                  onChange={e => setDisplayName(e.target.value.slice(0, 30))}
                  placeholder="Customer-facing name"
                  className="w-full px-3 py-2 rounded-lg bg-white/[0.03] border border-white/[0.08] text-white placeholder:text-neutral-600 focus:outline-none focus:border-purple-500/50 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-neutral-500 mb-1">Description (45 chars)</label>
                <input
                  type="text"
                  value={description}
                  onChange={e => setDescription(e.target.value.slice(0, 45))}
                  placeholder="Short description"
                  className="w-full px-3 py-2 rounded-lg bg-white/[0.03] border border-white/[0.08] text-white placeholder:text-neutral-600 focus:outline-none focus:border-purple-500/50 text-sm"
                />
              </div>
            </div>
          </div>

          {/* Pricing section */}
          <div className="border-t border-white/[0.08] pt-4 mt-4">
            <button
              type="button"
              onClick={() => setShowPricing(!showPricing)}
              className="flex items-center justify-between w-full text-left"
            >
              <div className="flex items-center gap-2">
                <DollarSign className="w-4 h-4 text-green-400" />
                <span className="text-sm font-medium text-neutral-300">Pricing</span>
                <span className="text-red-400 text-xs">*</span>
                {basePricePointId ? (
                  <span className="text-xs text-green-400">
                    {PRICE_POINTS.find(p => p.id === basePricePointId)?.label}
                  </span>
                ) : (
                  <span className="text-xs text-neutral-500">Required</span>
                )}
              </div>
              {showPricing ? (
                <ChevronDown className="w-4 h-4 text-neutral-400" />
              ) : (
                <ChevronRight className="w-4 h-4 text-neutral-400" />
              )}
            </button>

            {showPricing && (
              <div className="mt-3 space-y-4">
                {/* Base Price Grid */}
                <div>
                  <label className="block text-xs text-neutral-500 mb-2">Base Price (USD)</label>
                  <div className="grid grid-cols-5 gap-1.5">
                    {PRICE_POINTS.map(point => (
                      <button
                        key={point.id}
                        type="button"
                        onClick={() => setBasePricePointId(point.id)}
                        className={`py-2 px-1 rounded-lg text-xs font-medium transition-all ${
                          basePricePointId === point.id
                            ? 'bg-green-500/20 text-green-400 border border-green-500/50'
                            : 'bg-white/[0.03] text-neutral-400 border border-white/[0.08] hover:bg-white/[0.06] hover:text-white'
                        }`}
                      >
                        {point.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Pricing Strategy */}
                <div>
                  <label className="block text-xs text-neutral-500 mb-2">Regional Pricing Strategy</label>
                  <div className="space-y-2">
                    {STRATEGIES.map(strategy => (
                      <button
                        key={strategy.id}
                        type="button"
                        onClick={() => setPricingStrategy(strategy.id)}
                        className={`w-full p-3 rounded-lg border text-left transition-all ${
                          pricingStrategy === strategy.id
                            ? 'bg-blue-500/20 border-blue-500/50'
                            : 'bg-white/[0.02] border-white/[0.08] hover:bg-white/[0.04]'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className={`text-sm font-medium ${
                            pricingStrategy === strategy.id ? 'text-blue-400' : 'text-neutral-300'
                          }`}>
                            {strategy.name}
                          </span>
                          {pricingStrategy === strategy.id && (
                            <Check className="w-4 h-4 text-blue-400" />
                          )}
                        </div>
                        <p className="text-xs text-neutral-500 mt-0.5">{strategy.description}</p>
                      </button>
                    ))}
                  </div>
                </div>

                {!basePricePointId && (
                  <p className="text-xs text-amber-500">
                    Please select a base price to continue. Pricing is required for all products.
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Family sharing */}
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={familyShareable}
              onChange={e => setFamilyShareable(e.target.checked)}
              className="w-4 h-4 rounded border-white/[0.2] bg-white/[0.03] text-purple-500 focus:ring-purple-500/50"
            />
            <span className="text-sm text-neutral-300">Enable Family Sharing</span>
          </label>
        </div>

        <div className="p-6 border-t border-white/[0.08] flex justify-end gap-3 flex-shrink-0 bg-[#1a1a1a]">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm font-medium text-neutral-400 hover:text-white transition-all"
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={isCreating}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium
                     bg-gradient-to-r from-purple-500 to-blue-500 text-white
                     hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            {isCreating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            Create Product
          </button>
        </div>
      </div>
    </div>
  )
}

// Pull Progress Modal
function PullProgressModal({
  status,
  summary,
  error,
  hasOrphans,
  onClose,
}: {
  status: 'pending' | 'pulling' | 'complete'
  summary?: { iaps: number; subscriptions: number; groups: number }
  error?: string
  hasOrphans: boolean
  onClose: () => void
}) {
  const isComplete = status === 'complete'
  const hasError = !!error
  const totalItems = summary ? summary.iaps + summary.subscriptions : 0

  // Get title based on status
  const getTitle = () => {
    if (status === 'pending') return 'Preparing to Pull'
    if (status === 'pulling') return 'Pulling from App Store Connect'
    if (hasError) return 'Pull Failed'
    return 'Pull Successful'
  }

  // Get subtitle based on status
  const getSubtitle = () => {
    if (status !== 'complete') return 'Fetching products from App Store Connect...'
    if (hasError) return error
    if (!summary) return 'No products found'
    const parts: string[] = []
    if (summary.iaps > 0) parts.push(`${summary.iaps} IAP${summary.iaps !== 1 ? 's' : ''}`)
    if (summary.subscriptions > 0) parts.push(`${summary.subscriptions} subscription${summary.subscriptions !== 1 ? 's' : ''}`)
    if (summary.groups > 0) parts.push(`${summary.groups} group${summary.groups !== 1 ? 's' : ''}`)
    return parts.length > 0 ? `Synced ${parts.join(', ')}` : 'No products found'
  }

  // Get icon based on status
  const getIcon = () => {
    if (!isComplete) {
      return (
        <div className="p-2 rounded-full bg-purple-500/20">
          <Loader2 className="w-5 h-5 text-purple-400 animate-spin" />
        </div>
      )
    }
    if (hasError) {
      return (
        <div className="p-2 rounded-full bg-red-500/20">
          <AlertCircle className="w-5 h-5 text-red-400" />
        </div>
      )
    }
    return (
      <div className="p-2 rounded-full bg-green-500/20">
        <Check className="w-5 h-5 text-green-400" />
      </div>
    )
  }

  // Get progress bar color
  const getProgressColor = () => {
    if (!isComplete) return 'bg-gradient-to-r from-purple-500 to-blue-500'
    if (hasError) return 'bg-gradient-to-r from-red-500 to-red-400'
    return 'bg-gradient-to-r from-green-500 to-emerald-400'
  }

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[9999] p-4 backdrop-blur-sm">
      <div className="bg-[#1a1a1a] rounded-2xl border border-white/[0.08] w-full max-w-md overflow-hidden">
        {/* Header */}
        <div className="p-6 border-b border-white/[0.08]">
          <div className="flex items-center gap-3">
            {getIcon()}
            <div>
              <h2 className="text-lg font-semibold text-white">{getTitle()}</h2>
              <p className={`text-sm ${hasError ? 'text-red-400' : 'text-neutral-400'}`}>
                {getSubtitle()}
              </p>
            </div>
          </div>
        </div>

        {/* Progress bar */}
        {status !== 'pending' && (
          <div className="px-6 py-3 border-b border-white/[0.06]">
            <div className="h-2 rounded-full bg-white/[0.05] overflow-hidden">
              <div
                className={`h-full transition-all duration-500 ease-out ${getProgressColor()}`}
                style={{ width: isComplete ? '100%' : '50%' }}
              />
            </div>
          </div>
        )}

        {/* Summary content */}
        {isComplete && !hasError && summary && (
          <div className="p-4">
            <div className="space-y-2">
              {summary.iaps > 0 && (
                <div className="flex items-center justify-between p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
                  <div className="flex items-center gap-2">
                    <Coins className="w-4 h-4 text-amber-400" />
                    <span className="text-sm text-white">In-App Purchases</span>
                  </div>
                  <span className="text-sm font-medium text-amber-400">{summary.iaps}</span>
                </div>
              )}
              {summary.subscriptions > 0 && (
                <div className="flex items-center justify-between p-3 rounded-lg bg-blue-500/10 border border-blue-500/20">
                  <div className="flex items-center gap-2">
                    <CreditCard className="w-4 h-4 text-blue-400" />
                    <span className="text-sm text-white">Subscriptions</span>
                  </div>
                  <span className="text-sm font-medium text-blue-400">{summary.subscriptions}</span>
                </div>
              )}
              {summary.groups > 0 && (
                <div className="flex items-center justify-between p-3 rounded-lg bg-purple-500/10 border border-purple-500/20">
                  <div className="flex items-center gap-2">
                    <Package className="w-4 h-4 text-purple-400" />
                    <span className="text-sm text-white">Subscription Groups</span>
                  </div>
                  <span className="text-sm font-medium text-purple-400">{summary.groups}</span>
                </div>
              )}
              {totalItems === 0 && (
                <div className="p-3 rounded-lg bg-neutral-500/10 border border-neutral-500/20 text-center">
                  <p className="text-sm text-neutral-400">No products found in App Store Connect</p>
                </div>
              )}
            </div>

            {/* Orphans warning */}
            {hasOrphans && (
              <div className="mt-4 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-amber-400">Products removed from App Store</p>
                    <p className="text-xs text-neutral-400 mt-1">
                      Some previously synced products no longer exist in App Store Connect. You'll be prompted to review them next.
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Error content */}
        {isComplete && hasError && (
          <div className="p-4">
            <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
                <p className="text-sm text-red-400">{error}</p>
              </div>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="p-4 border-t border-white/[0.08] bg-[#1a1a1a]">
          {isComplete ? (
            <button
              onClick={onClose}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium
                       bg-white/[0.05] text-white hover:bg-white/[0.08] transition-all"
            >
              {hasOrphans ? 'Continue' : 'Done'}
            </button>
          ) : (
            <div className="flex items-center justify-center gap-2 text-sm text-neutral-400">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Fetching from App Store Connect...</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// Push Progress Modal
function PushProgressModal({
  status,
  pendingItems,
  created,
  updated,
  skipped,
  errors,
  itemProgress,
  currentItem,
  onClose,
}: {
  status: 'pending' | 'pushing' | 'complete'
  pendingItems: { id: string; name: string; type: 'iap' | 'subscription' }[]
  created: string[]
  updated: string[]
  skipped: string[]
  errors: { id: string; error: string }[]
  itemProgress?: Record<string, { step: string; detail?: string; progress?: { current: number; total: number } }>
  currentItem?: string
  onClose: () => void
}) {
  const totalItems = pendingItems.length
  const successCount = created.length + updated.length
  const hasErrors = errors.filter(e => e.id !== 'global').length > 0
  const hasGlobalError = errors.some(e => e.id === 'global')
  const allSkipped = skipped.length === totalItems && !hasGlobalError
  const isComplete = status === 'complete'

  // Determine overall status
  const getOverallStatus = () => {
    if (!isComplete) return 'pushing'
    if (hasGlobalError) return 'error'
    if (successCount === 0 && allSkipped) return 'skipped'
    if (hasErrors) return 'partial'
    return 'success'
  }
  const overallStatus = getOverallStatus()

  // Calculate overall progress percentage
  const getOverallProgress = () => {
    if (status === 'pending') return 0
    if (status === 'complete') return 100
    const completedCount = created.length + updated.length + errors.filter(e => e.id !== 'global').length
    return Math.round((completedCount / Math.max(totalItems, 1)) * 100)
  }

  const getItemStatus = (itemId: string): 'pending' | 'pushing' | 'created' | 'updated' | 'skipped' | 'error' => {
    // Check for errors first (including pricing/screenshot/intro offer errors) - these take precedence
    if (errors.find(e => e.id === itemId || e.id === `${itemId} (pricing)` || e.id === `${itemId} (screenshot)` || e.id === `${itemId} (intro offer)`)) return 'error'
    if (created.includes(itemId)) return 'created'
    if (updated.includes(itemId)) return 'updated'
    if (skipped.includes(itemId)) return 'skipped'
    // Check if this item has active progress
    if (itemProgress && itemProgress[itemId]) return 'pushing'
    if (status === 'pushing' && currentItem === itemId) return 'pushing'
    return 'pending'
  }

  const getItemError = (itemId: string): string | null => {
    // Check for direct error match
    const directError = errors.find(e => e.id === itemId)
    if (directError) return directError.error

    // Check for pricing error (ID format: "productId (pricing)")
    const pricingError = errors.find(e => e.id === `${itemId} (pricing)`)
    if (pricingError) return `Pricing: ${pricingError.error}`

    // Check for screenshot error
    const screenshotError = errors.find(e => e.id === `${itemId} (screenshot)`)
    if (screenshotError) return `Screenshot: ${screenshotError.error}`

    // Check for intro offer error
    const introOfferError = errors.find(e => e.id === `${itemId} (intro offer)`)
    if (introOfferError) return `Intro Offer: ${introOfferError.error}`

    return null
  }

  // Get current step for an item
  const getItemStep = (itemId: string): { step: string; progress?: { current: number; total: number } } | null => {
    if (!itemProgress || !itemProgress[itemId]) return null
    return itemProgress[itemId]
  }

  // Get title based on status
  const getTitle = () => {
    if (status === 'pending') return 'Preparing to Push'
    if (status === 'pushing') return 'Pushing to App Store Connect'
    switch (overallStatus) {
      case 'success': return 'Push Successful'
      case 'partial': return 'Push Completed with Errors'
      case 'skipped': return 'Nothing to Push'
      case 'error': return 'Push Failed'
      default: return 'Push Complete'
    }
  }

  // Get subtitle based on status
  const getSubtitle = () => {
    if (status !== 'complete') {
      const completedCount = created.length + updated.length
      if (completedCount > 0) {
        return `${completedCount} of ${totalItems} complete`
      }
      // Find the current active item and show its step
      if (itemProgress) {
        const activeItemId = Object.keys(itemProgress)[0]
        if (activeItemId) {
          const progress = itemProgress[activeItemId]
          const item = pendingItems.find(i => i.id === activeItemId)
          if (item && progress) {
            return progress.step
          }
        }
      }
      return `Processing ${totalItems} item${totalItems !== 1 ? 's' : ''}...`
    }
    if (hasGlobalError) {
      return errors.find(e => e.id === 'global')?.error || 'An error occurred'
    }
    if (allSkipped) {
      return 'Products were skipped - they may need localizations or pricing configured first'
    }
    const parts: string[] = []
    if (created.length > 0) parts.push(`${created.length} created`)
    if (updated.length > 0) parts.push(`${updated.length} updated`)
    if (errors.filter(e => e.id !== 'global').length > 0) {
      parts.push(`${errors.filter(e => e.id !== 'global').length} failed`)
    }
    if (skipped.length > 0) parts.push(`${skipped.length} skipped`)
    return parts.join(', ') || 'No changes made'
  }

  // Get icon based on status
  const getIcon = () => {
    if (!isComplete) {
      return (
        <div className="p-2 rounded-full bg-purple-500/20">
          <Loader2 className="w-5 h-5 text-purple-400 animate-spin" />
        </div>
      )
    }
    switch (overallStatus) {
      case 'success':
        return (
          <div className="p-2 rounded-full bg-green-500/20">
            <Check className="w-5 h-5 text-green-400" />
          </div>
        )
      case 'partial':
        return (
          <div className="p-2 rounded-full bg-amber-500/20">
            <AlertCircle className="w-5 h-5 text-amber-400" />
          </div>
        )
      case 'skipped':
        return (
          <div className="p-2 rounded-full bg-neutral-500/20">
            <Package className="w-5 h-5 text-neutral-400" />
          </div>
        )
      case 'error':
        return (
          <div className="p-2 rounded-full bg-red-500/20">
            <AlertCircle className="w-5 h-5 text-red-400" />
          </div>
        )
      default:
        return (
          <div className="p-2 rounded-full bg-green-500/20">
            <Check className="w-5 h-5 text-green-400" />
          </div>
        )
    }
  }

  // Get progress bar color
  const getProgressColor = () => {
    if (!isComplete) return 'bg-gradient-to-r from-purple-500 to-blue-500'
    switch (overallStatus) {
      case 'success': return 'bg-gradient-to-r from-green-500 to-emerald-400'
      case 'partial': return 'bg-gradient-to-r from-amber-500 to-amber-400'
      case 'skipped': return 'bg-gradient-to-r from-neutral-500 to-neutral-400'
      case 'error': return 'bg-gradient-to-r from-red-500 to-red-400'
      default: return 'bg-gradient-to-r from-green-500 to-emerald-400'
    }
  }

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[9999] p-4 backdrop-blur-sm">
      <div className="bg-[#1a1a1a] rounded-2xl border border-white/[0.08] w-full max-w-md overflow-hidden">
        {/* Header */}
        <div className="p-6 border-b border-white/[0.08]">
          <div className="flex items-center gap-3">
            {getIcon()}
            <div>
              <h2 className="text-lg font-semibold text-white">{getTitle()}</h2>
              <p className={`text-sm ${overallStatus === 'error' ? 'text-red-400' : overallStatus === 'skipped' ? 'text-neutral-400' : 'text-neutral-400'}`}>
                {getSubtitle()}
              </p>
            </div>
          </div>
        </div>

        {/* Progress bar */}
        {status !== 'pending' && (
          <div className="px-6 py-3 border-b border-white/[0.06]">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs text-neutral-500">
                {isComplete ? 'Complete' : `${created.length + updated.length} of ${totalItems}`}
              </span>
              <span className="text-xs text-neutral-500">{getOverallProgress()}%</span>
            </div>
            <div className="h-2 rounded-full bg-white/[0.05] overflow-hidden">
              <div
                className={`h-full transition-all duration-300 ease-out ${getProgressColor()}`}
                style={{ width: `${getOverallProgress()}%` }}
              />
            </div>
          </div>
        )}

        {/* Items list */}
        <div className="p-4 max-h-[300px] overflow-y-auto">
          <div className="space-y-2">
            {pendingItems.map(item => {
              const itemStatus = getItemStatus(item.id)
              const itemError = getItemError(item.id)
              const itemStep = getItemStep(item.id)

              return (
                <div
                  key={item.id}
                  className={`p-3 rounded-lg border transition-all ${
                    itemStatus === 'created' ? 'bg-green-500/10 border-green-500/20' :
                    itemStatus === 'updated' ? 'bg-blue-500/10 border-blue-500/20' :
                    itemStatus === 'error' ? 'bg-red-500/10 border-red-500/20' :
                    itemStatus === 'skipped' ? 'bg-neutral-500/10 border-neutral-500/20' :
                    itemStatus === 'pushing' ? 'bg-purple-500/10 border-purple-500/20' :
                    'bg-white/[0.02] border-white/[0.06]'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 min-w-0">
                      {item.type === 'subscription' ? (
                        <CreditCard className="w-4 h-4 text-blue-400 flex-shrink-0" />
                      ) : (
                        <Coins className="w-4 h-4 text-amber-400 flex-shrink-0" />
                      )}
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-white truncate">{item.name}</p>
                        <p className="text-xs text-neutral-500 font-mono truncate">{item.id}</p>
                      </div>
                    </div>
                    <div className="flex-shrink-0 ml-2">
                      {itemStatus === 'created' && (
                        <span className="flex items-center gap-1 text-xs text-green-400">
                          <Check className="w-3 h-3" />
                          Created
                        </span>
                      )}
                      {itemStatus === 'updated' && (
                        <span className="flex items-center gap-1 text-xs text-blue-400">
                          <Check className="w-3 h-3" />
                          Updated
                        </span>
                      )}
                      {itemStatus === 'skipped' && (
                        <span className="flex items-center gap-1 text-xs text-neutral-400">
                          Skipped
                        </span>
                      )}
                      {itemStatus === 'error' && (
                        <span className="flex items-center gap-1 text-xs text-red-400">
                          <AlertCircle className="w-3 h-3" />
                          Failed
                        </span>
                      )}
                      {itemStatus === 'pushing' && (
                        <Loader2 className="w-4 h-4 text-purple-400 animate-spin" />
                      )}
                      {itemStatus === 'pending' && (
                        <span className="text-xs text-neutral-500">Pending</span>
                      )}
                    </div>
                  </div>
                  {/* Show current step for pushing items */}
                  {itemStatus === 'pushing' && itemStep && (
                    <div className="mt-2">
                      <p className="text-xs text-purple-300 mb-1">{itemStep.step}</p>
                      {itemStep.progress && (
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-1.5 rounded-full bg-white/[0.05] overflow-hidden">
                            <div
                              className="h-full bg-gradient-to-r from-purple-500 to-blue-400 transition-all duration-300"
                              style={{ width: `${Math.round((itemStep.progress.current / itemStep.progress.total) * 100)}%` }}
                            />
                          </div>
                          <span className="text-xs text-neutral-500 tabular-nums">
                            {itemStep.progress.current}/{itemStep.progress.total}
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                  {itemError && (
                    <p className="mt-2 text-xs text-red-400 bg-red-500/10 p-2 rounded">
                      {itemError}
                    </p>
                  )}
                </div>
              )
            })}

            {/* Global error (if any) */}
            {errors.find(e => e.id === 'global') && (
              <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20">
                <div className="flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
                  <p className="text-sm text-red-400">{errors.find(e => e.id === 'global')?.error}</p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-white/[0.08] bg-[#1a1a1a]">
          {isComplete ? (
            <button
              onClick={onClose}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium
                       bg-white/[0.05] text-white hover:bg-white/[0.08] transition-all"
            >
              Done
            </button>
          ) : (
            <div className="flex items-center justify-center gap-2 text-sm text-neutral-400">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Pushing changes to App Store Connect...</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// Orphaned Products Warning Modal
function OrphanedProductsModal({
  orphans,
  isDeleting,
  onDelete,
  onClose,
}: {
  orphans: OrphanedProduct[]
  isDeleting: boolean
  onDelete: (orphans: OrphanedProduct[]) => void
  onClose: () => void
}) {
  const [selectedOrphans, setSelectedOrphans] = useState<Set<string>>(new Set(orphans.map(o => o.id)))

  const toggleOrphan = (id: string) => {
    setSelectedOrphans(prev => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const toggleAll = () => {
    if (selectedOrphans.size === orphans.length) {
      setSelectedOrphans(new Set())
    } else {
      setSelectedOrphans(new Set(orphans.map(o => o.id)))
    }
  }

  const handleDelete = () => {
    const orphansToDelete = orphans.filter(o => selectedOrphans.has(o.id))
    onDelete(orphansToDelete)
  }

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[9999] p-4 backdrop-blur-sm">
      <div className="bg-[#1a1a1a] rounded-2xl border border-white/[0.08] w-full max-w-lg max-h-[85vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-6 border-b border-white/[0.08] flex-shrink-0">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-full bg-amber-500/20 flex-shrink-0">
              <AlertTriangle className="w-5 h-5 text-amber-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-white">Products Removed from App Store</h2>
              <p className="text-sm text-neutral-400 mt-1">
                The following products were previously synced but no longer exist in App Store Connect.
                They may have been deleted directly in the App Store.
              </p>
            </div>
          </div>
        </div>

        {/* Select all checkbox */}
        <div className="px-6 py-3 border-b border-white/[0.06] flex items-center justify-between">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={selectedOrphans.size === orphans.length}
              onChange={toggleAll}
              className="w-4 h-4 rounded border-white/[0.2] bg-white/[0.03] text-amber-500 focus:ring-amber-500/50"
            />
            <span className="text-sm text-neutral-300">Select all ({orphans.length})</span>
          </label>
          {selectedOrphans.size > 0 && (
            <span className="text-xs text-neutral-500">
              {selectedOrphans.size} selected
            </span>
          )}
        </div>

        {/* Orphans list */}
        <div className="flex-1 overflow-y-auto p-4">
          <div className="space-y-2">
            {orphans.map(orphan => (
              <label
                key={orphan.id}
                className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
                  selectedOrphans.has(orphan.id)
                    ? 'bg-amber-500/10 border-amber-500/30'
                    : 'bg-white/[0.02] border-white/[0.06] hover:bg-white/[0.04]'
                }`}
              >
                <input
                  type="checkbox"
                  checked={selectedOrphans.has(orphan.id)}
                  onChange={() => toggleOrphan(orphan.id)}
                  className="w-4 h-4 rounded border-white/[0.2] bg-white/[0.03] text-amber-500 focus:ring-amber-500/50 flex-shrink-0"
                />
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  {orphan.type === 'subscription' ? (
                    <CreditCard className="w-4 h-4 text-blue-400 flex-shrink-0" />
                  ) : (
                    <Coins className="w-4 h-4 text-amber-400 flex-shrink-0" />
                  )}
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-white truncate">{orphan.name}</p>
                    <p className="text-xs text-neutral-500 font-mono truncate">{orphan.productId}</p>
                  </div>
                </div>
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium flex-shrink-0 ${
                  orphan.type === 'subscription'
                    ? 'bg-blue-500/20 text-blue-400'
                    : 'bg-amber-500/20 text-amber-400'
                }`}>
                  {orphan.type === 'subscription' ? 'Subscription' : 'IAP'}
                </span>
              </label>
            ))}
          </div>
        </div>

        {/* Warning note */}
        <div className="px-6 py-3 border-t border-white/[0.06] bg-red-500/5">
          <p className="text-xs text-red-400 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>
              Deleting these products will remove them from App Listing Agent permanently.
              This cannot be undone. If the products still exist in App Store Connect,
              you can pull them again later.
            </span>
          </p>
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-white/[0.08] flex justify-between gap-3 flex-shrink-0 bg-[#1a1a1a]">
          <button
            onClick={onClose}
            disabled={isDeleting}
            className="px-4 py-2 rounded-lg text-sm font-medium text-neutral-400 hover:text-white transition-all"
          >
            Keep All
          </button>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              disabled={isDeleting}
              className="px-4 py-2 rounded-lg text-sm font-medium bg-white/[0.05] text-neutral-300 hover:bg-white/[0.08] transition-all"
            >
              Cancel
            </button>
            <button
              onClick={handleDelete}
              disabled={isDeleting || selectedOrphans.size === 0}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium
                       bg-red-500/20 text-red-400 border border-red-500/30
                       hover:bg-red-500/30 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              {isDeleting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Trash2 className="w-4 h-4" />
              )}
              Delete Selected ({selectedOrphans.size})
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
