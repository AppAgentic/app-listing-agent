'use client'

import { useState, useEffect, useMemo } from 'react'
import {
  Loader2,
  Plus,
  Trash2,
  Play,
  Pause,
  Gift,
  RotateCcw,
  Clock,
  X,
  ChevronDown,
} from 'lucide-react'

const BILLING_PERIOD_LABELS: Record<string, string> = {
  P1W: 'Weekly',
  P1M: 'Monthly',
  P3M: 'Quarterly',
  P6M: 'Semi-Annual',
  P1Y: 'Annual',
}

const DURATION_OPTIONS = [
  { value: 'P3D', label: '3 days' },
  { value: 'P7D', label: '7 days' },
  { value: 'P1W', label: '1 week' },
  { value: 'P2W', label: '2 weeks' },
  { value: 'P1M', label: '1 month' },
  { value: 'P2M', label: '2 months' },
  { value: 'P3M', label: '3 months' },
  { value: 'P6M', label: '6 months' },
  { value: 'P1Y', label: '1 year' },
]

function formatDuration(duration: string): string {
  const match = DURATION_OPTIONS.find(d => d.value === duration)
  if (match) return match.label
  // Fallback: parse ISO 8601 duration
  const m = duration.match(/^P(\d+)([DWMY])$/)
  if (m) {
    const n = parseInt(m[1])
    const unit = { D: 'day', W: 'week', M: 'month', Y: 'year' }[m[2]] || m[2]
    return `${n} ${unit}${n !== 1 ? 's' : ''}`
  }
  return duration
}

function formatPhaseSummary(phase: OfferPhase): string {
  const dur = formatDuration(phase.duration)
  if (phase.priceType === 'FREE') {
    return `${dur} free trial`
  }
  const pct = phase.discountPercent || 0
  if (phase.recurrenceCount > 1) {
    return `${pct}% off for ${phase.recurrenceCount} × ${dur}`
  }
  return `${pct}% off for ${dur}`
}

function formatOfferSummary(phases: OfferPhase[]): string {
  if (!phases || phases.length === 0) return 'No phases configured'
  return phases.map(formatPhaseSummary).join(' → ')
}

interface OfferPhase {
  recurrenceCount: number
  duration: string
  priceType: 'FREE' | 'DISCOUNTED'
  discountPercent?: number
}

interface Offer {
  id: string // Firestore doc ID
  offerId: string
  basePlanId: string
  state: 'DRAFT' | 'ACTIVE' | 'INACTIVE' | null
  syncStatus: 'synced' | 'local_changes' | 'pending_creation'
  phases: OfferPhase[]
  targeting?: {
    acquisitionRule?: { scope: string }
  }
}

interface BasePlan {
  basePlanId: string
  state: 'DRAFT' | 'ACTIVE' | 'INACTIVE' | null
  type: 'AUTO_RENEWING' | 'PREPAID'
  billingPeriodDuration?: string
  defaultPriceUsd: number | null
}

interface PlayStoreOffersTabProps {
  projectId: string
  subscriptionId: string
  productId: string
  basePlans: BasePlan[]
  onUpdated: () => void
}

export default function PlayStoreOffersTab({
  projectId,
  subscriptionId,
  productId,
  basePlans,
  onUpdated,
}: PlayStoreOffersTabProps) {
  const [offers, setOffers] = useState<Offer[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionLoading, setActionLoading] = useState<string | null>(null) // offerId being acted on
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)

  // Create form state
  const [creatingForPlan, setCreatingForPlan] = useState<string | null>(null)
  const [newOfferId, setNewOfferId] = useState('')
  const [newPriceType, setNewPriceType] = useState<'FREE' | 'DISCOUNTED'>('FREE')
  const [newDuration, setNewDuration] = useState('P3D')
  const [newRecurrenceCount, setNewRecurrenceCount] = useState(1)
  const [newDiscountPercent, setNewDiscountPercent] = useState(50)
  const [isCreating, setIsCreating] = useState(false)

  const offersByPlan = useMemo(() => {
    const map: Record<string, Offer[]> = {}
    for (const bp of basePlans) {
      map[bp.basePlanId] = []
    }
    for (const offer of offers) {
      if (!map[offer.basePlanId]) map[offer.basePlanId] = []
      map[offer.basePlanId].push(offer)
    }
    return map
  }, [offers, basePlans])

  useEffect(() => {
    fetchOffers()
  }, [projectId, subscriptionId])

  const fetchOffers = async () => {
    setIsLoading(true)
    setError(null)
    try {
      const res = await fetch(
        `/api/playstore-iap/${subscriptionId}/offers?projectId=${projectId}`
      )
      if (!res.ok) throw new Error('Failed to load offers')
      const data = await res.json()
      setOffers(data.offers || [])
    } catch (err: any) {
      setError(err.message)
    } finally {
      setIsLoading(false)
    }
  }

  const handleCreate = async (basePlanId: string) => {
    if (!newOfferId.trim()) return
    setIsCreating(true)
    setError(null)
    try {
      const phases: OfferPhase[] = [{
        duration: newDuration,
        recurrenceCount: newRecurrenceCount,
        priceType: newPriceType,
        ...(newPriceType === 'DISCOUNTED' ? { discountPercent: newDiscountPercent } : {}),
      }]

      const res = await fetch(`/api/playstore-iap/${subscriptionId}/offers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          offerId: newOfferId.trim(),
          basePlanId,
          phases,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to create offer')
      }

      // Reset form
      setCreatingForPlan(null)
      setNewOfferId('')
      setNewPriceType('FREE')
      setNewDuration('P3D')
      setNewRecurrenceCount(1)
      setNewDiscountPercent(50)

      await fetchOffers()
      onUpdated()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setIsCreating(false)
    }
  }

  const handleActivate = async (offer: Offer) => {
    setActionLoading(offer.offerId)
    setError(null)
    try {
      const res = await fetch(
        `/api/playstore-iap/${subscriptionId}/offers/${offer.offerId}/activate`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectId, basePlanId: offer.basePlanId }),
        }
      )
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to activate offer')
      }
      await fetchOffers()
      onUpdated()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setActionLoading(null)
    }
  }

  const handleDeactivate = async (offer: Offer) => {
    setActionLoading(offer.offerId)
    setError(null)
    try {
      const res = await fetch(
        `/api/playstore-iap/${subscriptionId}/offers/${offer.offerId}/deactivate`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectId, basePlanId: offer.basePlanId }),
        }
      )
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to deactivate offer')
      }
      await fetchOffers()
      onUpdated()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setActionLoading(null)
    }
  }

  const handleDelete = async (offer: Offer) => {
    setActionLoading(offer.offerId)
    setError(null)
    try {
      const res = await fetch(
        `/api/playstore-iap/${subscriptionId}/offers/${offer.id}?projectId=${projectId}`,
        { method: 'DELETE' }
      )
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to delete offer')
      }
      setDeleteConfirm(null)
      await fetchOffers()
      onUpdated()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setActionLoading(null)
    }
  }

  const renderStateBadge = (state: string | null) => {
    if (!state) return <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-neutral-500/20 text-neutral-400">New</span>
    const colors: Record<string, string> = {
      ACTIVE: 'bg-green-500/20 text-green-400',
      DRAFT: 'bg-neutral-500/20 text-neutral-400',
      INACTIVE: 'bg-red-500/20 text-red-400',
    }
    return (
      <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${colors[state] || colors.DRAFT}`}>
        {state.charAt(0) + state.slice(1).toLowerCase()}
      </span>
    )
  }

  const renderSyncBadge = (syncStatus: string) => {
    const colors: Record<string, string> = {
      synced: 'bg-green-500/20 text-green-400',
      local_changes: 'bg-yellow-500/20 text-yellow-400',
      pending_creation: 'bg-blue-500/20 text-blue-400',
    }
    const labels: Record<string, string> = {
      synced: 'Synced',
      local_changes: 'Modified',
      pending_creation: 'Not pushed',
    }
    return (
      <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${colors[syncStatus] || ''}`}>
        {labels[syncStatus] || syncStatus}
      </span>
    )
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-5 h-5 text-neutral-400 animate-spin" />
      </div>
    )
  }

  return (
    <div className="p-5 space-y-5">
      {error && (
        <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-400">
          {error}
        </div>
      )}

      {basePlans.length === 0 && (
        <div className="text-center py-8 text-sm text-neutral-500">
          No base plans configured. Add a base plan first before creating offers.
        </div>
      )}

      {basePlans.map((bp) => {
        const planOffers = offersByPlan[bp.basePlanId] || []
        return (
          <div key={bp.basePlanId} className="space-y-3">
            {/* Base plan header */}
            <div className="flex items-center gap-3">
              <div className="w-6 h-6 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center flex-shrink-0">
                {bp.type === 'PREPAID' ? (
                  <Clock className="w-3 h-3" />
                ) : (
                  <RotateCcw className="w-3 h-3" />
                )}
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium text-white text-sm">{bp.basePlanId}</span>
                <span className="text-xs text-neutral-500">
                  {bp.billingPeriodDuration
                    ? BILLING_PERIOD_LABELS[bp.billingPeriodDuration] || bp.billingPeriodDuration
                    : 'No period'}
                </span>
                {renderStateBadge(bp.state)}
              </div>
            </div>

            {/* Offers list */}
            {planOffers.length > 0 ? (
              <div className="space-y-2 ml-9">
                {planOffers.map((offer) => (
                  <div
                    key={offer.id}
                    className="p-3 rounded-lg bg-white/[0.02] border border-white/[0.06]"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Gift className="w-3.5 h-3.5 text-purple-400 flex-shrink-0" />
                          <span className="text-sm font-medium text-white">{offer.offerId}</span>
                          {renderStateBadge(offer.state)}
                          {renderSyncBadge(offer.syncStatus)}
                        </div>
                        <p className="text-xs text-neutral-400 mt-1 ml-5">
                          {formatOfferSummary(offer.phases)}
                        </p>
                        {offer.targeting?.acquisitionRule?.scope && (
                          <p className="text-[10px] text-neutral-500 mt-0.5 ml-5">
                            Target: {offer.targeting.acquisitionRule.scope.replace('_', ' ').toLowerCase()}
                          </p>
                        )}
                      </div>

                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        {/* Activate / Deactivate */}
                        {offer.state === 'ACTIVE' ? (
                          <button
                            onClick={() => handleDeactivate(offer)}
                            disabled={actionLoading === offer.offerId}
                            title="Deactivate"
                            className="p-1.5 rounded-lg bg-yellow-500/10 text-yellow-400
                                     hover:bg-yellow-500/20 transition-all disabled:opacity-50"
                          >
                            {actionLoading === offer.offerId ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Pause className="w-3.5 h-3.5" />
                            )}
                          </button>
                        ) : offer.syncStatus === 'synced' || offer.state === 'INACTIVE' ? (
                          <button
                            onClick={() => handleActivate(offer)}
                            disabled={actionLoading === offer.offerId}
                            title="Activate"
                            className="p-1.5 rounded-lg bg-green-500/10 text-green-400
                                     hover:bg-green-500/20 transition-all disabled:opacity-50"
                          >
                            {actionLoading === offer.offerId ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Play className="w-3.5 h-3.5" />
                            )}
                          </button>
                        ) : null}

                        {/* Delete */}
                        {deleteConfirm === offer.offerId ? (
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => handleDelete(offer)}
                              disabled={actionLoading === offer.offerId}
                              className="px-2 py-1 rounded text-[10px] bg-red-500/20 text-red-400 hover:bg-red-500/30"
                            >
                              {actionLoading === offer.offerId ? 'Deleting...' : 'Confirm'}
                            </button>
                            <button
                              onClick={() => setDeleteConfirm(null)}
                              className="p-1 rounded text-neutral-500 hover:text-white"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setDeleteConfirm(offer.offerId)}
                            title="Delete offer"
                            className="p-1.5 rounded-lg text-neutral-500 hover:text-red-400
                                     hover:bg-red-500/10 transition-all"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="ml-9 text-xs text-neutral-500 py-1">
                No offers for this base plan
              </div>
            )}

            {/* Add offer button / form */}
            {creatingForPlan === bp.basePlanId ? (
              <div className="ml-9 p-4 rounded-lg bg-white/[0.03] border border-white/[0.08] space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-white">New Offer</span>
                  <button
                    onClick={() => setCreatingForPlan(null)}
                    className="p-1 rounded text-neutral-500 hover:text-white"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {/* Offer ID */}
                <div>
                  <label className="text-xs text-neutral-500 block mb-1">Offer ID</label>
                  <input
                    type="text"
                    value={newOfferId}
                    onChange={(e) => setNewOfferId(e.target.value.replace(/[^a-z0-9-]/g, ''))}
                    placeholder="free-trial-3d"
                    className="w-full px-3 py-2 bg-white/[0.05] border border-white/[0.1] rounded-lg
                             text-sm text-white placeholder-neutral-600
                             focus:outline-none focus:border-blue-500/50"
                  />
                </div>

                {/* Price Type */}
                <div>
                  <label className="text-xs text-neutral-500 block mb-1">Type</label>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setNewPriceType('FREE')}
                      className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                        newPriceType === 'FREE'
                          ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                          : 'bg-white/[0.05] text-neutral-400 border border-white/[0.1] hover:border-white/[0.2]'
                      }`}
                    >
                      Free Trial
                    </button>
                    <button
                      onClick={() => setNewPriceType('DISCOUNTED')}
                      className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                        newPriceType === 'DISCOUNTED'
                          ? 'bg-purple-500/20 text-purple-400 border border-purple-500/30'
                          : 'bg-white/[0.05] text-neutral-400 border border-white/[0.1] hover:border-white/[0.2]'
                      }`}
                    >
                      Discounted
                    </button>
                  </div>
                </div>

                {/* Duration */}
                <div>
                  <label className="text-xs text-neutral-500 block mb-1">Duration</label>
                  <div className="relative">
                    <select
                      value={newDuration}
                      onChange={(e) => setNewDuration(e.target.value)}
                      className="w-full px-3 py-2 bg-white/[0.05] border border-white/[0.1] rounded-lg
                               text-sm text-white appearance-none
                               focus:outline-none focus:border-blue-500/50"
                    >
                      {DURATION_OPTIONS.map(opt => (
                        <option key={opt.value} value={opt.value} className="bg-[#1a1a1a]">
                          {opt.label}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-500 pointer-events-none" />
                  </div>
                </div>

                {/* Recurrence Count */}
                <div>
                  <label className="text-xs text-neutral-500 block mb-1">
                    Billing periods
                    <span className="text-neutral-600 ml-1">(how many times this phase repeats)</span>
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={52}
                    value={newRecurrenceCount}
                    onChange={(e) => setNewRecurrenceCount(Math.max(1, parseInt(e.target.value) || 1))}
                    className="w-full px-3 py-2 bg-white/[0.05] border border-white/[0.1] rounded-lg
                             text-sm text-white
                             focus:outline-none focus:border-blue-500/50"
                  />
                </div>

                {/* Discount Percent (only for DISCOUNTED) */}
                {newPriceType === 'DISCOUNTED' && (
                  <div>
                    <label className="text-xs text-neutral-500 block mb-1">Discount %</label>
                    <input
                      type="number"
                      min={1}
                      max={99}
                      value={newDiscountPercent}
                      onChange={(e) => setNewDiscountPercent(Math.max(1, Math.min(99, parseInt(e.target.value) || 50)))}
                      className="w-full px-3 py-2 bg-white/[0.05] border border-white/[0.1] rounded-lg
                               text-sm text-white
                               focus:outline-none focus:border-blue-500/50"
                    />
                  </div>
                )}

                {/* Preview */}
                <div className="p-2 rounded bg-white/[0.02] border border-white/[0.04]">
                  <span className="text-xs text-neutral-500">Preview: </span>
                  <span className="text-xs text-white">
                    {formatPhaseSummary({
                      duration: newDuration,
                      recurrenceCount: newRecurrenceCount,
                      priceType: newPriceType,
                      ...(newPriceType === 'DISCOUNTED' ? { discountPercent: newDiscountPercent } : {}),
                    })}
                  </span>
                </div>

                {/* Create button */}
                <button
                  onClick={() => handleCreate(bp.basePlanId)}
                  disabled={isCreating || !newOfferId.trim()}
                  className="w-full px-4 py-2.5 rounded-lg bg-blue-500 hover:bg-blue-600
                           text-white text-sm font-medium transition-all
                           disabled:opacity-50 disabled:cursor-not-allowed
                           flex items-center justify-center gap-2"
                >
                  {isCreating ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Creating...
                    </>
                  ) : (
                    'Create Offer'
                  )}
                </button>
              </div>
            ) : (
              <button
                onClick={() => {
                  setCreatingForPlan(bp.basePlanId)
                  setNewOfferId('')
                  setNewPriceType('FREE')
                  setNewDuration('P3D')
                  setNewRecurrenceCount(1)
                  setNewDiscountPercent(50)
                }}
                className="ml-9 flex items-center gap-1.5 text-xs text-neutral-400 hover:text-blue-400 transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                Add Offer
              </button>
            )}

            {/* Separator between base plans */}
            <div className="border-b border-white/[0.04]" />
          </div>
        )
      })}

      {/* Info note */}
      <div className="text-[11px] text-neutral-600 pt-2">
        Offers created here are saved locally. Push your subscription to publish them to Google Play, then activate to make them live.
      </div>
    </div>
  )
}
