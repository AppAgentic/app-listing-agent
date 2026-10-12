'use client'

import { useState, useEffect } from 'react'
import { Loader2, Save, Trash2, Clock, RotateCcw } from 'lucide-react'
import { PLAYSTORE_IAP_LIMITS } from '@/lib/constants'
import { getPlayStoreStateConfig, getPlayStoreStateColorClasses } from '@/lib/iap/playstore-state-config'

const BILLING_PERIOD_LABELS: Record<string, string> = {
  P1W: '1 Week',
  P1M: '1 Month',
  P3M: '3 Months',
  P6M: '6 Months',
  P1Y: '1 Year',
}

function formatPrice(usd: number): string {
  return `$${usd.toFixed(2)}`
}

interface BasePlan {
  basePlanId: string
  state: string | null
  type: 'AUTO_RENEWING' | 'PREPAID'
  billingPeriodDuration?: string
  defaultPriceUsd: number | null
}

interface PlayStoreOverviewTabProps {
  projectId: string
  item: any
  itemType: 'product' | 'subscription'
  onUpdated: () => void
  onDelete: () => void
}

export default function PlayStoreOverviewTab({
  projectId,
  item,
  itemType,
  onUpdated,
  onDelete,
}: PlayStoreOverviewTabProps) {
  const [editTitle, setEditTitle] = useState(item.title || '')
  const [editDescription, setEditDescription] = useState(item.description || '')
  const [isSaving, setIsSaving] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  useEffect(() => {
    setEditTitle(item.title || '')
    setEditDescription(item.description || '')
  }, [item.id])

  const itemId = itemType === 'product' ? item.sku || item.id : item.productId || item.id
  const status = itemType === 'product' ? item.status : null
  const stateConfig = getPlayStoreStateConfig(status)

  const handleSave = async () => {
    setIsSaving(true)
    setError(null)
    try {
      const response = await fetch(`/api/playstore-iap/${item.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          title: editTitle,
          description: editDescription,
        }),
      })
      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to save')
      }
      setSuccess('Saved successfully')
      setTimeout(() => setSuccess(null), 2000)
      onUpdated()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setIsSaving(false)
    }
  }

  const handleDelete = async () => {
    setIsDeleting(true)
    setError(null)
    try {
      const response = await fetch(`/api/playstore-iap/${item.id}?projectId=${projectId}`, {
        method: 'DELETE',
      })
      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to delete')
      }
      onDelete()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete')
      setIsDeleting(false)
    }
  }

  const renderStateBadge = (state: string | null) => {
    if (!state) return null
    const colorClasses = getPlayStoreStateColorClasses(state)
    const config = getPlayStoreStateConfig(state)
    return (
      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${colorClasses}`}>
        {config?.label || state}
      </span>
    )
  }

  const renderSyncBadge = (syncStatus: string) => {
    const syncColors: Record<string, string> = {
      synced: 'bg-green-500/20 text-green-400 border-green-500/30',
      local_changes: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
      pending_creation: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
    }
    const syncLabels: Record<string, string> = {
      synced: 'Synced',
      local_changes: 'Local Changes',
      pending_creation: 'Not Pushed',
    }
    return (
      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${syncColors[syncStatus] || syncColors.synced}`}>
        {syncLabels[syncStatus] || syncStatus}
      </span>
    )
  }

  return (
    <div className="p-5 space-y-5">
      {error && (
        <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
          {error}
        </div>
      )}
      {success && (
        <div className="p-3 rounded-lg bg-green-500/10 border border-green-500/20 text-green-400 text-sm">
          {success}
        </div>
      )}

      {/* State + Sync */}
      <div className="flex items-center gap-2 flex-wrap">
        {renderStateBadge(status)}
        {renderSyncBadge(item.syncStatus)}
        <span className="text-xs text-neutral-500 ml-1">
          {itemType === 'product' ? 'One-Time Product' : 'Subscription'}
        </span>
      </div>

      {/* Editable title */}
      <div>
        <label className="block text-sm font-medium text-neutral-300 mb-1">
          Title
          <span className="text-neutral-600 text-xs ml-2">
            {editTitle.length}/{PLAYSTORE_IAP_LIMITS.title}
          </span>
        </label>
        <input
          type="text"
          value={editTitle}
          onChange={(e) => {
            if (e.target.value.length <= PLAYSTORE_IAP_LIMITS.title) setEditTitle(e.target.value)
          }}
          className="w-full px-3 py-2 rounded-lg bg-white/[0.03] border border-white/[0.08]
                   text-white placeholder:text-neutral-600 focus:outline-none
                   focus:border-purple-500/50 text-sm"
          placeholder="Product title"
        />
      </div>

      {/* Editable description */}
      <div>
        <label className="block text-sm font-medium text-neutral-300 mb-1">
          Description
          <span className="text-neutral-600 text-xs ml-2">
            {editDescription.length}/{PLAYSTORE_IAP_LIMITS.description}
          </span>
        </label>
        <textarea
          value={editDescription}
          onChange={(e) => {
            if (e.target.value.length <= PLAYSTORE_IAP_LIMITS.description) setEditDescription(e.target.value)
          }}
          rows={3}
          className="w-full px-3 py-2 rounded-lg bg-white/[0.03] border border-white/[0.08]
                   text-white placeholder:text-neutral-600 focus:outline-none
                   focus:border-purple-500/50 text-sm resize-none"
          placeholder="Short description"
        />
      </div>

      {/* SKU / Product ID */}
      <div>
        <label className="block text-xs font-medium text-neutral-500 mb-1">
          {itemType === 'product' ? 'SKU' : 'Product ID'}
        </label>
        <div className="px-3 py-2 rounded-lg bg-white/[0.02] border border-white/[0.06] text-sm text-neutral-300 font-mono">
          {itemId}
        </div>
      </div>

      {/* Base plans summary for subscriptions */}
      {itemType === 'subscription' && item.basePlans?.length > 0 && (
        <div>
          <label className="block text-xs font-medium text-neutral-500 mb-2">
            Base Plans
          </label>
          <div className="space-y-2">
            {item.basePlans.map((bp: BasePlan) => (
              <div
                key={bp.basePlanId}
                className="flex items-center justify-between p-2.5 rounded-lg bg-white/[0.02] border border-white/[0.06]"
              >
                <div className="flex items-center gap-2">
                  {bp.type === 'PREPAID' ? (
                    <Clock className="w-3.5 h-3.5 text-neutral-500" />
                  ) : (
                    <RotateCcw className="w-3.5 h-3.5 text-neutral-500" />
                  )}
                  <span className="text-sm text-white">{bp.basePlanId}</span>
                  <span className="text-xs text-neutral-500">
                    {bp.billingPeriodDuration
                      ? BILLING_PERIOD_LABELS[bp.billingPeriodDuration] || bp.billingPeriodDuration
                      : ''}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {bp.defaultPriceUsd != null && (
                    <span className="text-xs text-green-400 font-medium">
                      {formatPrice(bp.defaultPriceUsd)}
                    </span>
                  )}
                  {renderStateBadge(bp.state)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Save button */}
      <button
        onClick={handleSave}
        disabled={isSaving}
        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium
                 bg-gradient-to-r from-purple-500 to-blue-500 text-white
                 hover:opacity-90 disabled:opacity-50 transition-all"
      >
        {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
        Save Changes
      </button>

      {/* Delete */}
      <div className="pt-3 border-t border-white/[0.06]">
        {showDeleteConfirm ? (
          <div className="space-y-2">
            <p className="text-sm text-red-400">Are you sure? This cannot be undone.</p>
            <div className="flex gap-2">
              <button
                onClick={handleDelete}
                disabled={isDeleting}
                className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30 transition-all disabled:opacity-50"
              >
                {isDeleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                Delete
              </button>
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="flex-1 px-3 py-2 rounded-lg text-sm font-medium text-neutral-400 bg-white/[0.05] hover:bg-white/[0.08] transition-all"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setShowDeleteConfirm(true)}
            className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm text-red-400/70 hover:text-red-400 hover:bg-red-500/10 transition-all"
          >
            <Trash2 className="w-4 h-4" />
            Delete Product
          </button>
        )}
      </div>
    </div>
  )
}
