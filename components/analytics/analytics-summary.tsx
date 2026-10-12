'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import {
  TrendingUp,
  TrendingDown,
  DollarSign,
  Download,
  BarChart3,
  AlertCircle,
  Settings,
  Loader2,
} from 'lucide-react'

interface AnalyticsSummaryProps {
  projectId: string
}

interface AnalyticsData {
  configured: boolean
  message?: string
  error?: string
  period?: { start: string; end: string }
  revenue?: { total: number; change: number; currency: string }
  downloads?: { total: number; change: number }
  daily?: Array<{ date: string; units: number; proceeds: number }>
  dataAsOf?: string
}

// Simple sparkline component
function Sparkline({ data, color }: { data: number[]; color: string }) {
  if (!data.length) return null

  const max = Math.max(...data)
  const min = Math.min(...data)
  const range = max - min || 1

  const points = data.map((value, i) => {
    const x = (i / (data.length - 1)) * 100
    const y = 100 - ((value - min) / range) * 100
    return `${x},${y}`
  }).join(' ')

  return (
    <svg viewBox="0 0 100 100" className="w-full h-12" preserveAspectRatio="none">
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
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

export function AnalyticsSummary({ projectId }: AnalyticsSummaryProps) {
  const [data, setData] = useState<AnalyticsData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchAnalytics() {
      try {
        const response = await fetch(`/api/stores/analytics/summary?projectId=${projectId}`)
        if (response.ok) {
          const result = await response.json()
          setData(result)
        }
      } catch (err) {
        console.error('Failed to fetch analytics:', err)
        setData({ configured: false, error: 'Failed to load analytics' })
      } finally {
        setLoading(false)
      }
    }

    fetchAnalytics()
  }, [projectId])

  if (loading) {
    return (
      <div className="rounded-2xl bg-white/[0.02] border border-white/[0.08] p-6 mb-8">
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-6 h-6 text-purple-400 animate-spin" />
        </div>
      </div>
    )
  }

  // Not configured - show setup prompt
  if (!data?.configured) {
    return (
      <div className="rounded-2xl bg-white/[0.02] border border-white/[0.08] p-6 mb-8">
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 rounded-xl bg-yellow-500/10 border border-yellow-500/20 flex items-center justify-center flex-shrink-0">
            <AlertCircle className="w-5 h-5 text-yellow-400" />
          </div>
          <div className="flex-1">
            <h3 className="text-white font-medium mb-1">Analytics Not Configured</h3>
            <p className="text-sm text-neutral-400 mb-4">
              {data?.message || 'Add your App Store Connect vendor number in project settings to view analytics.'}
            </p>
            <Link
              href={`/projects/${projectId}/settings`}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-purple-500/10 text-purple-400 border border-purple-500/20 hover:bg-purple-500/20 transition-colors text-sm font-medium"
            >
              <Settings className="w-4 h-4" />
              Configure Settings
            </Link>
          </div>
        </div>
      </div>
    )
  }

  // Error state
  if (data?.error) {
    return (
      <div className="rounded-2xl bg-white/[0.02] border border-white/[0.08] p-6 mb-8">
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center justify-center flex-shrink-0">
            <AlertCircle className="w-5 h-5 text-red-400" />
          </div>
          <div>
            <h3 className="text-white font-medium mb-1">Analytics Error</h3>
            <p className="text-sm text-neutral-400">{data.message || data.error}</p>
          </div>
        </div>
      </div>
    )
  }

  const revenueData = data.daily?.map(d => d.proceeds) || []
  const downloadsData = data.daily?.map(d => d.units) || []

  return (
    <div className="rounded-2xl bg-white/[0.02] border border-white/[0.08] p-6 mb-8">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500/20 to-blue-500/20 border border-white/[0.08] flex items-center justify-center">
            <BarChart3 className="w-5 h-5 text-purple-400" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-white">Analytics</h2>
            <p className="text-xs text-neutral-500">Last 7 days • Data as of {data.dataAsOf}</p>
          </div>
        </div>
        <Link
          href={`/projects/${projectId}/analytics`}
          className="text-sm text-purple-400 hover:text-purple-300 transition-colors"
        >
          View Details →
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-6">
        {/* Revenue Card */}
        <div className="p-4 rounded-xl bg-white/[0.02] border border-white/[0.08]">
          <div className="flex items-center gap-2 mb-2">
            <DollarSign className="w-4 h-4 text-green-400" />
            <span className="text-sm text-neutral-400">Revenue</span>
          </div>
          <div className="flex items-baseline gap-2 mb-2">
            <span className="text-2xl font-bold text-white">
              {formatCurrency(data.revenue?.total || 0, data.revenue?.currency)}
            </span>
            {data.revenue?.change !== undefined && (
              <span className={`flex items-center text-sm font-medium ${
                data.revenue.change >= 0 ? 'text-green-400' : 'text-red-400'
              }`}>
                {data.revenue.change >= 0 ? (
                  <TrendingUp className="w-3 h-3 mr-0.5" />
                ) : (
                  <TrendingDown className="w-3 h-3 mr-0.5" />
                )}
                {Math.abs(data.revenue.change)}%
              </span>
            )}
          </div>
          <div className="mt-2">
            <Sparkline data={revenueData} color="#22c55e" />
          </div>
        </div>

        {/* Downloads Card */}
        <div className="p-4 rounded-xl bg-white/[0.02] border border-white/[0.08]">
          <div className="flex items-center gap-2 mb-2">
            <Download className="w-4 h-4 text-blue-400" />
            <span className="text-sm text-neutral-400">Downloads</span>
          </div>
          <div className="flex items-baseline gap-2 mb-2">
            <span className="text-2xl font-bold text-white">
              {formatNumber(data.downloads?.total || 0)}
            </span>
            {data.downloads?.change !== undefined && (
              <span className={`flex items-center text-sm font-medium ${
                data.downloads.change >= 0 ? 'text-green-400' : 'text-red-400'
              }`}>
                {data.downloads.change >= 0 ? (
                  <TrendingUp className="w-3 h-3 mr-0.5" />
                ) : (
                  <TrendingDown className="w-3 h-3 mr-0.5" />
                )}
                {Math.abs(data.downloads.change)}%
              </span>
            )}
          </div>
          <div className="mt-2">
            <Sparkline data={downloadsData} color="#3b82f6" />
          </div>
        </div>
      </div>
    </div>
  )
}
