'use client'

import { useState, useEffect } from 'react'
import {
  Loader2,
  Trash2,
  AlertCircle,
  Check,
  ExternalLink,
  Copy,
  Users,
  Package,
  CreditCard,
  Coins,
  Globe,
  Ban,
  Clock,
  Upload,
  RefreshCw,
  XCircle,
  Edit3,
  Info,
} from 'lucide-react'
import { getStateConfig, getStateColorClasses, canPushInState } from '@/lib/iap/state-config'

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
  introOffer?: {
    offerMode: 'PAY_AS_YOU_GO' | 'PAY_UP_FRONT' | 'FREE_TRIAL'
    duration: string
    territories: string[]
    startDate: string
    endDate: string
  } | null
}

type Product = InAppPurchase | Subscription

interface OverviewTabProps {
  projectId: string
  product: Product
  productType: 'iap' | 'subscription'
  subscriptionPeriod?: string
  appStoreAppId?: string | null  // The app's App Store ID (not the IAP's)
  onUpdated: () => void
  onDelete: () => void
}

// State icons mapping
const STATE_ICONS: Record<string, React.ReactNode> = {
  check: <Check className="w-3.5 h-3.5" />,
  clock: <Clock className="w-3.5 h-3.5" />,
  alert: <AlertCircle className="w-3.5 h-3.5" />,
  x: <XCircle className="w-3.5 h-3.5" />,
  edit: <Edit3 className="w-3.5 h-3.5" />,
  upload: <Upload className="w-3.5 h-3.5" />,
  process: <RefreshCw className="w-3.5 h-3.5 animate-spin" />,
  ban: <Ban className="w-3.5 h-3.5" />,
}

const SYNC_STATUS_COLORS: Record<string, string> = {
  synced: 'bg-green-500/20 text-green-400 border-green-500/30',
  local_changes: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  pending_creation: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
}

const PRODUCT_TYPE_LABELS: Record<string, string> = {
  CONSUMABLE: 'Consumable',
  NON_CONSUMABLE: 'Non-Consumable',
  NON_RENEWING_SUBSCRIPTION: 'Non-Renewing Subscription',
}

const PERIOD_LABELS: Record<string, string> = {
  ONE_WEEK: 'Weekly',
  ONE_MONTH: 'Monthly',
  TWO_MONTHS: 'Every 2 Months',
  THREE_MONTHS: 'Every 3 Months',
  SIX_MONTHS: 'Every 6 Months',
  ONE_YEAR: 'Yearly',
}

export default function OverviewTab({
  projectId,
  product,
  productType,
  subscriptionPeriod,
  appStoreAppId,
  onUpdated,
  onDelete,
}: OverviewTabProps) {
  const [isDeleting, setIsDeleting] = useState(false)
  const [copied, setCopied] = useState(false)

  // Availability state
  const [availabilityLoading, setAvailabilityLoading] = useState(true)
  const [availabilityStatus, setAvailabilityStatus] = useState<'available' | 'removed'>('available')
  const [isSavingAvailability, setIsSavingAvailability] = useState(false)
  const [availabilityError, setAvailabilityError] = useState<string | null>(null)
  const [availabilitySuccess, setAvailabilitySuccess] = useState(false)

  // Fetch availability on mount
  useEffect(() => {
    fetchAvailability()
  }, [projectId, product.id])

  const fetchAvailability = async () => {
    setAvailabilityLoading(true)
    try {
      const endpoint = productType === 'subscription'
        ? `/api/subscriptions/${product.id}/availability?projectId=${projectId}`
        : `/api/iap/${product.id}/availability?projectId=${projectId}`

      const response = await fetch(endpoint)
      if (response.ok) {
        const data = await response.json()
        setAvailabilityStatus(data.availableForSale === false ? 'removed' : 'available')
      }
    } catch (err) {
      console.warn('Failed to fetch availability')
    } finally {
      setAvailabilityLoading(false)
    }
  }

  const handleSaveAvailability = async (newStatus: 'available' | 'removed') => {
    if (newStatus === availabilityStatus) return

    setIsSavingAvailability(true)
    setAvailabilityError(null)
    setAvailabilitySuccess(false)

    try {
      const endpoint = productType === 'subscription'
        ? `/api/subscriptions/${product.id}/availability`
        : `/api/iap/${product.id}/availability`

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          availableForSale: newStatus === 'available',
          availableInAllTerritories: true,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to update availability')
      }

      setAvailabilityStatus(newStatus)
      setAvailabilitySuccess(true)
      setTimeout(() => setAvailabilitySuccess(false), 2000)
      onUpdated()
    } catch (err) {
      setAvailabilityError(err instanceof Error ? err.message : 'Failed to update')
    } finally {
      setIsSavingAvailability(false)
    }
  }

  const handleCopyProductId = () => {
    navigator.clipboard.writeText(product.productId)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleDelete = async () => {
    if (!confirm(`Are you sure you want to delete "${product.name}"? This action cannot be undone.`)) {
      return
    }

    setIsDeleting(true)
    try {
      const endpoint = productType === 'subscription'
        ? `/api/subscriptions/${product.id}?projectId=${projectId}`
        : `/api/iap/${product.id}?projectId=${projectId}`

      const response = await fetch(endpoint, { method: 'DELETE' })
      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to delete')
      }

      onDelete()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete')
    } finally {
      setIsDeleting(false)
    }
  }

  const renderState = (state: string | null) => {
    if (!state) return <span className="text-neutral-500">Draft (local only)</span>
    const config = getStateConfig(state)
    const colorClass = getStateColorClasses(state)
    const label = config?.label || state.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase())
    const icon = config?.icon ? STATE_ICONS[config.icon] : null
    return (
      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${colorClass}`}>
        {icon}
        {label}
      </span>
    )
  }

  const stateConfig = getStateConfig(product.state)
  const pushStatus = canPushInState(product.state)

  const renderSyncStatus = (status: string) => {
    const colorClass = SYNC_STATUS_COLORS[status] || 'bg-neutral-500/20 text-neutral-400 border-neutral-500/30'
    const label = status === 'synced' ? 'Synced' : status === 'local_changes' ? 'Modified' : 'Pending'
    return (
      <span className={`px-2.5 py-1 rounded-full text-xs font-medium border ${colorClass}`}>
        {label}
      </span>
    )
  }

  const isSubscription = productType === 'subscription'
  const subscription = isSubscription ? (product as Subscription) : null
  const iap = !isSubscription ? (product as InAppPurchase) : null

  return (
    <div className="h-full overflow-y-auto p-5">
      <div className="max-w-2xl mx-auto space-y-6">
        {/* Product Info Card */}
        <div className="rounded-xl bg-white/[0.02] border border-white/[0.08] overflow-hidden">
          <div className="p-4 border-b border-white/[0.06]">
            <h3 className="text-sm font-medium text-white">Product Information</h3>
          </div>
          <div className="p-4 space-y-4">
            {/* Product ID */}
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-xs text-neutral-500 mb-1">Product ID</div>
                <div className="font-mono text-sm text-white">{product.productId}</div>
              </div>
              <button
                onClick={handleCopyProductId}
                className="p-2 rounded-lg text-neutral-400 hover:text-white hover:bg-white/[0.05] transition-all"
              >
                {copied ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
              </button>
            </div>

            {/* Reference Name */}
            <div>
              <div className="text-xs text-neutral-500 mb-1">Reference Name</div>
              <div className="text-sm text-white">{product.name}</div>
            </div>

            {/* Product Type (IAP only) */}
            {iap && (
              <div>
                <div className="text-xs text-neutral-500 mb-1">Product Type</div>
                <div className="flex items-center gap-2">
                  {iap.productType === 'CONSUMABLE' ? (
                    <Coins className="w-4 h-4 text-amber-400" />
                  ) : iap.productType === 'NON_CONSUMABLE' ? (
                    <Package className="w-4 h-4 text-purple-400" />
                  ) : (
                    <CreditCard className="w-4 h-4 text-blue-400" />
                  )}
                  <span className="text-sm text-white">
                    {PRODUCT_TYPE_LABELS[iap.productType] || iap.productType}
                  </span>
                </div>
              </div>
            )}

            {/* Subscription Period (Subscription only) */}
            {subscription && subscriptionPeriod && (
              <div>
                <div className="text-xs text-neutral-500 mb-1">Billing Period</div>
                <div className="text-sm text-white">
                  {PERIOD_LABELS[subscriptionPeriod] || subscriptionPeriod}
                </div>
              </div>
            )}

            {/* Group Level (Subscription only) */}
            {subscription && (
              <div>
                <div className="text-xs text-neutral-500 mb-1">Group Level</div>
                <div className="text-sm text-white">Level {subscription.groupLevel}</div>
                <p className="text-xs text-neutral-500 mt-1">
                  Lower numbers = higher tier (shown first when comparing subscriptions)
                </p>
              </div>
            )}

            {/* Family Sharing */}
            <div className="flex items-center justify-between py-2">
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-neutral-400" />
                <span className="text-sm text-neutral-300">Family Sharing</span>
              </div>
              <span className={`text-sm ${product.familyShareable ? 'text-green-400' : 'text-neutral-500'}`}>
                {product.familyShareable ? 'Enabled' : 'Disabled'}
              </span>
            </div>
          </div>
        </div>

        {/* Status Card */}
        <div className="rounded-xl bg-white/[0.02] border border-white/[0.08] overflow-hidden">
          <div className="p-4 border-b border-white/[0.06]">
            <h3 className="text-sm font-medium text-white">Status</h3>
          </div>
          <div className="p-4 space-y-4">
            {/* App Store State */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-neutral-300">App Store State</span>
                {renderState(product.state)}
              </div>
              {/* State Description */}
              {stateConfig && (
                <p className="text-xs text-neutral-500 bg-white/[0.02] rounded-lg p-2.5 border border-white/[0.05]">
                  {stateConfig.description}
                </p>
              )}
              {!product.state && (
                <p className="text-xs text-neutral-500 bg-white/[0.02] rounded-lg p-2.5 border border-white/[0.05]">
                  This product only exists locally. Push to App Store Connect to create it.
                </p>
              )}
            </div>

            {/* Push Warning */}
            {pushStatus.warning && (
              <div className={`flex items-start gap-2 p-3 rounded-lg border ${
                pushStatus.allowed
                  ? 'bg-amber-500/10 border-amber-500/20 text-amber-400'
                  : 'bg-red-500/10 border-red-500/20 text-red-400'
              }`}>
                <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <div className="text-xs">
                  <span className="font-medium">{pushStatus.allowed ? 'Warning' : 'Cannot Push'}: </span>
                  {pushStatus.warning}
                </div>
              </div>
            )}

            {/* Sync Status */}
            <div className="flex items-center justify-between">
              <span className="text-sm text-neutral-300">Sync Status</span>
              {renderSyncStatus(product.syncStatus)}
            </div>

            {/* App Store ID */}
            {product.appStoreId && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-neutral-300">App Store ID</span>
                <span className="text-xs font-mono text-neutral-400">{product.appStoreId}</span>
              </div>
            )}

            {/* Edit Restrictions Info (when in restrictive state) */}
            {stateConfig && !stateConfig.editableFields.localizations && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-neutral-500/10 border border-neutral-500/20 text-neutral-400">
                <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <div className="text-xs">
                  <span className="font-medium">Limited editing: </span>
                  Some fields cannot be modified in this state. Only pricing and availability changes are allowed.
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Availability Card */}
        <div className="rounded-xl bg-white/[0.02] border border-white/[0.08] overflow-hidden">
          <div className="p-4 border-b border-white/[0.06]">
            <h3 className="text-sm font-medium text-white">Availability</h3>
          </div>
          <div className="p-4 space-y-3">
            {availabilityLoading ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="w-5 h-5 animate-spin text-neutral-400" />
              </div>
            ) : (
              <>
                {/* Available in all territories */}
                <label
                  className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all ${
                    availabilityStatus === 'available'
                      ? 'bg-green-500/10 border-green-500/30'
                      : 'bg-white/[0.02] border-white/[0.08] hover:bg-white/[0.04]'
                  }`}
                >
                  <input
                    type="radio"
                    name="availability"
                    checked={availabilityStatus === 'available'}
                    onChange={() => handleSaveAvailability('available')}
                    disabled={isSavingAvailability}
                    className="w-4 h-4 text-green-500 bg-white/[0.05] border-white/[0.2] focus:ring-green-500/50"
                  />
                  <div className="flex items-center gap-2 flex-1">
                    <Globe className={`w-4 h-4 ${availabilityStatus === 'available' ? 'text-green-400' : 'text-neutral-400'}`} />
                    <span className={`text-sm ${availabilityStatus === 'available' ? 'text-white' : 'text-neutral-300'}`}>
                      All countries or regions selected
                    </span>
                  </div>
                  {isSavingAvailability && availabilityStatus !== 'available' && (
                    <Loader2 className="w-4 h-4 animate-spin text-neutral-400" />
                  )}
                </label>

                {/* Remove from Sale */}
                <label
                  className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all ${
                    availabilityStatus === 'removed'
                      ? 'bg-red-500/10 border-red-500/30'
                      : 'bg-white/[0.02] border-white/[0.08] hover:bg-white/[0.04]'
                  }`}
                >
                  <input
                    type="radio"
                    name="availability"
                    checked={availabilityStatus === 'removed'}
                    onChange={() => handleSaveAvailability('removed')}
                    disabled={isSavingAvailability}
                    className="w-4 h-4 text-red-500 bg-white/[0.05] border-white/[0.2] focus:ring-red-500/50"
                  />
                  <div className="flex items-center gap-2 flex-1">
                    <Ban className={`w-4 h-4 ${availabilityStatus === 'removed' ? 'text-red-400' : 'text-neutral-400'}`} />
                    <span className={`text-sm ${availabilityStatus === 'removed' ? 'text-white' : 'text-neutral-300'}`}>
                      Remove from Sale
                    </span>
                  </div>
                  {isSavingAvailability && availabilityStatus !== 'removed' && (
                    <Loader2 className="w-4 h-4 animate-spin text-neutral-400" />
                  )}
                </label>

                {/* Error/Success feedback */}
                {availabilityError && (
                  <div className="p-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-xs flex items-center gap-2">
                    <AlertCircle className="w-3 h-3" />
                    {availabilityError}
                  </div>
                )}
                {availabilitySuccess && (
                  <div className="p-2 rounded-lg bg-green-500/10 border border-green-500/20 text-green-400 text-xs flex items-center gap-2">
                    <Check className="w-3 h-3" />
                    Availability updated
                  </div>
                )}

                <p className="text-xs text-neutral-500 pt-1">
                  Changes will be applied when you push to the App Store.
                </p>
              </>
            )}
          </div>
        </div>

        {/* App Store Connect Link */}
        {product.appStoreId && appStoreAppId && (
          <a
            href={
              productType === 'subscription'
                ? `https://appstoreconnect.apple.com/apps/${appStoreAppId}/distribution/subscriptions/${product.appStoreId}`
                : `https://appstoreconnect.apple.com/apps/${appStoreAppId}/addons/${product.appStoreId}`
            }
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 p-3 rounded-xl bg-white/[0.02] border border-white/[0.08]
                     text-neutral-400 hover:text-white hover:bg-white/[0.04] transition-all"
          >
            <ExternalLink className="w-4 h-4" />
            <span className="text-sm">View in App Store Connect</span>
          </a>
        )}

        {/* Danger Zone */}
        <div className="rounded-xl bg-red-500/5 border border-red-500/20 overflow-hidden">
          <div className="p-4 border-b border-red-500/20">
            <h3 className="text-sm font-medium text-red-400">Danger Zone</h3>
          </div>
          <div className="p-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-sm text-white mb-1">Delete this product</div>
                <p className="text-xs text-neutral-500">
                  This will remove the product from your local database.
                  {product.appStoreId && ' The product will remain in App Store Connect.'}
                </p>
              </div>
              <button
                onClick={handleDelete}
                disabled={isDeleting}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium
                         bg-red-500/10 text-red-400 hover:bg-red-500/20
                         border border-red-500/30 disabled:opacity-50 transition-all"
              >
                {isDeleting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Trash2 className="w-4 h-4" />
                )}
                Delete
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
