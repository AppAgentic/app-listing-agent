'use client'

import { useState, useEffect } from 'react'
import { Loader2, DollarSign, Globe, Clock, RotateCcw } from 'lucide-react'

const BILLING_PERIOD_LABELS: Record<string, string> = {
  P1W: 'Weekly',
  P1M: 'Monthly',
  P3M: 'Quarterly',
  P6M: 'Semi-Annual',
  P1Y: 'Annual',
}

function formatPrice(price: number): string {
  return `$${price.toFixed(2)}`
}

interface BasePlan {
  basePlanId: string
  state: string | null
  type: 'AUTO_RENEWING' | 'PREPAID'
  billingPeriodDuration?: string
  defaultPriceUsd: number | null
}

interface PricingData {
  basePriceUsd: number | null
  regionalPrices?: { country: string; currency: string; price: number }[]
}

interface PlayStorePricingTabProps {
  projectId: string
  itemId: string
  itemType: 'product' | 'subscription'
  basePlans?: BasePlan[]
  onUpdated: () => void
}

export default function PlayStorePricingTab({
  projectId,
  itemId,
  itemType,
  basePlans,
  onUpdated,
}: PlayStorePricingTabProps) {
  const [pricing, setPricing] = useState<PricingData | null>(null)
  const [editBasePriceUsd, setEditBasePriceUsd] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [isLoadingRegional, setIsLoadingRegional] = useState(false)
  const [regionalPreview, setRegionalPreview] = useState<any[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  useEffect(() => {
    fetchPricing()
  }, [projectId, itemId])

  const fetchPricing = async () => {
    setIsLoading(true)
    try {
      const res = await fetch(`/api/playstore-iap/${itemId}/pricing?projectId=${projectId}`)
      if (res.ok) {
        const data = await res.json()
        const p = data.pricing || null
        setPricing(p)
        if (p?.basePriceUsd != null) {
          setEditBasePriceUsd(String(p.basePriceUsd))
        }
      }
    } catch {
      // silent
    } finally {
      setIsLoading(false)
    }
  }

  const handleSavePricing = async () => {
    const price = parseFloat(editBasePriceUsd)
    if (isNaN(price) || price < 0) {
      setError('Enter a valid price')
      return
    }
    setIsSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/playstore-iap/${itemId}/pricing`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, basePriceUsd: price }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to save pricing')
      }
      setPricing((prev) => (prev ? { ...prev, basePriceUsd: price } : { basePriceUsd: price }))
      setSuccess('Pricing saved')
      setTimeout(() => setSuccess(null), 2000)
      onUpdated()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save pricing')
    } finally {
      setIsSaving(false)
    }
  }

  const handlePreviewRegional = async () => {
    if (!pricing?.basePriceUsd) return
    setIsLoadingRegional(true)
    setError(null)
    try {
      const res = await fetch('/api/playstore-iap/pricing/convert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, basePriceUsd: pricing.basePriceUsd }),
      })
      if (!res.ok) throw new Error('Failed to load regional prices')
      const data = await res.json()
      setRegionalPreview(data.prices || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load regional prices')
    } finally {
      setIsLoadingRegional(false)
    }
  }

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-purple-400" />
      </div>
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

      <h3 className="text-sm font-medium text-white flex items-center gap-2">
        <DollarSign className="w-4 h-4 text-green-400" />
        Pricing
      </h3>

      {/* Base price input */}
      <div>
        <label className="block text-sm font-medium text-neutral-300 mb-1">
          Base Price (USD)
        </label>
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500 text-sm">
              $
            </span>
            <input
              type="number"
              step="0.01"
              min="0"
              value={editBasePriceUsd}
              onChange={(e) => setEditBasePriceUsd(e.target.value)}
              className="w-full pl-7 pr-3 py-2 rounded-lg bg-white/[0.03] border border-white/[0.08]
                       text-white placeholder:text-neutral-600 focus:outline-none
                       focus:border-purple-500/50 text-sm"
              placeholder="0.00"
            />
          </div>
          <button
            onClick={handleSavePricing}
            disabled={isSaving}
            className="px-4 py-2 rounded-lg text-sm font-medium
                     bg-green-500/20 text-green-400 hover:bg-green-500/30
                     disabled:opacity-50 transition-all"
          >
            {isSaving ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              'Save'
            )}
          </button>
        </div>
        {pricing?.basePriceUsd != null && (
          <p className="text-xs text-neutral-500 mt-1">
            Current: {formatPrice(pricing.basePriceUsd)}
          </p>
        )}
      </div>

      {/* Subscription per-base-plan pricing */}
      {itemType === 'subscription' && basePlans && basePlans.length > 0 && (
        <div>
          <label className="block text-xs font-medium text-neutral-500 mb-2">
            Per Base Plan
          </label>
          <div className="space-y-2">
            {basePlans.map((bp) => (
              <div
                key={bp.basePlanId}
                className="flex items-center justify-between p-2.5 rounded-lg bg-white/[0.02] border border-white/[0.06]"
              >
                <div className="flex items-center gap-2 text-sm">
                  {bp.type === 'PREPAID' ? (
                    <Clock className="w-3.5 h-3.5 text-neutral-500" />
                  ) : (
                    <RotateCcw className="w-3.5 h-3.5 text-neutral-500" />
                  )}
                  <span className="text-white">{bp.basePlanId}</span>
                  <span className="text-neutral-500 text-xs">
                    {bp.billingPeriodDuration
                      ? BILLING_PERIOD_LABELS[bp.billingPeriodDuration] || bp.billingPeriodDuration
                      : ''}
                  </span>
                </div>
                <span className="text-sm font-medium text-green-400">
                  {bp.defaultPriceUsd != null
                    ? formatPrice(bp.defaultPriceUsd)
                    : '--'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Regional preview */}
      <div>
        <button
          onClick={handlePreviewRegional}
          disabled={isLoadingRegional || !pricing?.basePriceUsd}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium
                   bg-white/[0.05] text-neutral-300 hover:bg-white/[0.08]
                   disabled:opacity-50 transition-all w-full justify-center"
        >
          {isLoadingRegional ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Globe className="w-4 h-4" />
          )}
          Preview Regional Prices
        </button>

        {regionalPreview && regionalPreview.length > 0 && (
          <div className="mt-3 max-h-64 overflow-y-auto rounded-lg border border-white/[0.06]">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/[0.06]">
                  <th className="text-left px-3 py-2 text-xs text-neutral-500 font-medium">
                    Country
                  </th>
                  <th className="text-left px-3 py-2 text-xs text-neutral-500 font-medium">
                    Currency
                  </th>
                  <th className="text-right px-3 py-2 text-xs text-neutral-500 font-medium">
                    Price
                  </th>
                </tr>
              </thead>
              <tbody>
                {regionalPreview.map((rp: any, i: number) => (
                  <tr
                    key={i}
                    className="border-b border-white/[0.04] last:border-0"
                  >
                    <td className="px-3 py-2 text-white">{rp.country}</td>
                    <td className="px-3 py-2 text-neutral-400">{rp.currency}</td>
                    <td className="px-3 py-2 text-right text-green-400">
                      {rp.price}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
