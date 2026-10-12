'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import {
  BarChart3,
  TrendingUp,
  TrendingDown,
  DollarSign,
  Download,
  Globe,
  Loader2,
  AlertCircle,
  Settings,
  ArrowLeft,
} from 'lucide-react'

interface AnalyticsContentProps {
  projectId: string
  projectName: string
  hasVendorNumber: boolean
}

interface SalesData {
  success: boolean
  period: { start: string; end: string }
  totals: { units: number; proceeds: number; currency: string }
  daily: Array<{ date: string; units: number; proceeds: number }>
  byCountry: Array<{ code: string; name: string; units: number; proceeds: number }>
  byProduct: Array<{ id: string; name: string; units: number; proceeds: number }>
}

type Period = '7d' | '30d' | '90d'

// Simple bar chart component
function BarChart({ data, valueKey, color }: { data: Array<{ date: string; [key: string]: number | string }>; valueKey: string; color: string }) {
  if (!data.length) return <div className="h-48 flex items-center justify-center text-neutral-500">No data available</div>

  const values = data.map(d => d[valueKey] as number)
  const max = Math.max(...values)

  return (
    <div className="h-48 flex items-end gap-1">
      {data.map((item, i) => {
        const height = max > 0 ? ((item[valueKey] as number) / max) * 100 : 0
        const date = new Date(item.date)
        const label = `${date.getMonth() + 1}/${date.getDate()}`

        return (
          <div key={i} className="flex-1 flex flex-col items-center gap-1">
            <div
              className={`w-full rounded-t ${color} transition-all hover:opacity-80`}
              style={{ height: `${height}%`, minHeight: height > 0 ? '4px' : '0' }}
              title={`${label}: ${(item[valueKey] as number).toLocaleString()}`}
            />
            {data.length <= 14 && (
              <span className="text-[10px] text-neutral-500">{label}</span>
            )}
          </div>
        )
      })}
    </div>
  )
}

function formatCurrency(value: number, currency: string = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value)
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-US').format(value)
}

export function AnalyticsContent({ projectId, projectName, hasVendorNumber }: AnalyticsContentProps) {
  const [data, setData] = useState<SalesData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [period, setPeriod] = useState<Period>('30d')

  useEffect(() => {
    async function fetchAnalytics() {
      if (!hasVendorNumber) {
        setLoading(false)
        return
      }

      setLoading(true)
      setError(null)

      try {
        const response = await fetch('/api/stores/analytics/sales', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectId, period }),
        })

        if (!response.ok) {
          const errData = await response.json()
          throw new Error(errData.error || 'Failed to fetch analytics')
        }

        const result = await response.json()
        setData(result)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load analytics')
      } finally {
        setLoading(false)
      }
    }

    fetchAnalytics()
  }, [projectId, period, hasVendorNumber])

  // Not configured state
  if (!hasVendorNumber) {
    return (
      <div className="max-w-4xl">
        <div className="mb-8">
          <Link
            href={`/projects/${projectId}`}
            className="inline-flex items-center gap-2 text-sm text-neutral-400 hover:text-white transition-colors mb-4"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to {projectName}
          </Link>
          <h1 className="text-2xl font-bold text-white">Analytics</h1>
        </div>

        <div className="rounded-2xl bg-white/[0.02] border border-white/[0.08] p-8 text-center">
          <div className="w-16 h-16 rounded-2xl bg-yellow-500/10 border border-yellow-500/20 flex items-center justify-center mx-auto mb-4">
            <AlertCircle className="w-8 h-8 text-yellow-400" />
          </div>
          <h2 className="text-xl font-semibold text-white mb-2">Analytics Not Configured</h2>
          <p className="text-neutral-400 mb-6 max-w-md mx-auto">
            To view analytics, you need to add your App Store Connect vendor number in project settings.
            You can find this in App Store Connect under Payments and Financial Reports.
          </p>
          <Link
            href={`/projects/${projectId}/settings`}
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-purple-500 text-white font-medium hover:bg-purple-600 transition-colors"
          >
            <Settings className="w-4 h-4" />
            Configure Settings
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-6xl">
      {/* Header */}
      <div className="mb-8">
        <Link
          href={`/projects/${projectId}`}
          className="inline-flex items-center gap-2 text-sm text-neutral-400 hover:text-white transition-colors mb-4"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to {projectName}
        </Link>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-green-500/20 to-emerald-500/20 border border-white/[0.08] flex items-center justify-center">
              <BarChart3 className="w-6 h-6 text-green-400" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white">Analytics</h1>
              <p className="text-sm text-neutral-400">
                Sales & downloads from App Store Connect
              </p>
            </div>
          </div>

          {/* Period Selector */}
          <div className="flex gap-2">
            {(['7d', '30d', '90d'] as Period[]).map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  period === p
                    ? 'bg-purple-500/20 text-purple-400 border border-purple-500/30'
                    : 'bg-white/[0.02] text-neutral-400 border border-white/[0.08] hover:bg-white/[0.05]'
                }`}
              >
                {p === '7d' ? '7 Days' : p === '30d' ? '30 Days' : '90 Days'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Loading State */}
      {loading && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-8 h-8 text-purple-400 animate-spin" />
        </div>
      )}

      {/* Error State */}
      {error && !loading && (
        <div className="rounded-2xl bg-red-500/10 border border-red-500/20 p-6">
          <div className="flex items-start gap-4">
            <AlertCircle className="w-6 h-6 text-red-400 flex-shrink-0" />
            <div>
              <h3 className="text-white font-medium mb-1">Error Loading Analytics</h3>
              <p className="text-sm text-neutral-400">{error}</p>
            </div>
          </div>
        </div>
      )}

      {/* Data Display */}
      {data && !loading && !error && (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-2 gap-6 mb-8">
            <div className="rounded-2xl bg-white/[0.02] border border-white/[0.08] p-6">
              <div className="flex items-center gap-2 mb-3">
                <DollarSign className="w-5 h-5 text-green-400" />
                <span className="text-neutral-400">Total Revenue</span>
              </div>
              <div className="text-3xl font-bold text-white">
                {formatCurrency(data.totals.proceeds, data.totals.currency)}
              </div>
              <p className="text-sm text-neutral-500 mt-1">
                {data.period.start} to {data.period.end}
              </p>
            </div>

            <div className="rounded-2xl bg-white/[0.02] border border-white/[0.08] p-6">
              <div className="flex items-center gap-2 mb-3">
                <Download className="w-5 h-5 text-blue-400" />
                <span className="text-neutral-400">Total Downloads</span>
              </div>
              <div className="text-3xl font-bold text-white">
                {formatNumber(data.totals.units)}
              </div>
              <p className="text-sm text-neutral-500 mt-1">
                {data.period.start} to {data.period.end}
              </p>
            </div>
          </div>

          {/* Charts */}
          <div className="grid grid-cols-2 gap-6 mb-8">
            <div className="rounded-2xl bg-white/[0.02] border border-white/[0.08] p-6">
              <h3 className="text-white font-medium mb-4">Revenue Over Time</h3>
              <BarChart data={data.daily} valueKey="proceeds" color="bg-green-500" />
            </div>

            <div className="rounded-2xl bg-white/[0.02] border border-white/[0.08] p-6">
              <h3 className="text-white font-medium mb-4">Downloads Over Time</h3>
              <BarChart data={data.daily} valueKey="units" color="bg-blue-500" />
            </div>
          </div>

          {/* Tables */}
          <div className="grid grid-cols-2 gap-6">
            {/* Top Countries */}
            <div className="rounded-2xl bg-white/[0.02] border border-white/[0.08] p-6">
              <div className="flex items-center gap-2 mb-4">
                <Globe className="w-5 h-5 text-purple-400" />
                <h3 className="text-white font-medium">Top Countries</h3>
              </div>
              {data.byCountry.length === 0 ? (
                <p className="text-neutral-500 text-sm">No country data available</p>
              ) : (
                <div className="space-y-3">
                  {data.byCountry.slice(0, 10).map((country, i) => (
                    <div key={country.code} className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span className="text-neutral-500 w-4">{i + 1}.</span>
                        <span className="text-white">{country.name}</span>
                      </div>
                      <div className="text-right">
                        <div className="text-white font-medium">
                          {formatCurrency(country.proceeds, data.totals.currency)}
                        </div>
                        <div className="text-xs text-neutral-500">
                          {formatNumber(country.units)} units
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Top Products */}
            <div className="rounded-2xl bg-white/[0.02] border border-white/[0.08] p-6">
              <div className="flex items-center gap-2 mb-4">
                <BarChart3 className="w-5 h-5 text-orange-400" />
                <h3 className="text-white font-medium">Products & IAPs</h3>
              </div>
              {data.byProduct.length === 0 ? (
                <p className="text-neutral-500 text-sm">No product data available</p>
              ) : (
                <div className="space-y-3">
                  {data.byProduct.slice(0, 10).map((product, i) => (
                    <div key={product.id} className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span className="text-neutral-500 w-4">{i + 1}.</span>
                        <span className="text-white truncate max-w-[180px]" title={product.name}>
                          {product.name || product.id}
                        </span>
                      </div>
                      <div className="text-right">
                        <div className="text-white font-medium">
                          {formatCurrency(product.proceeds, data.totals.currency)}
                        </div>
                        <div className="text-xs text-neutral-500">
                          {formatNumber(product.units)} units
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
