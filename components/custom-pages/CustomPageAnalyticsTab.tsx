'use client'

import { useState } from 'react'
import {
  Loader2,
  AlertCircle,
  BarChart3,
  TrendingUp,
  Eye,
  Download,
  Percent,
} from 'lucide-react'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CustomPageAnalyticsTabProps {
  projectId: string
  pageId: string
  storeType: 'ios' | 'android'
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function CustomPageAnalyticsTab({
  projectId,
  pageId,
  storeType,
}: CustomPageAnalyticsTabProps) {
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Analytics data placeholder — populated via MCP tools
  // The MCP tool `get_custom_page_analytics` stores data in Firestore subcollections
  // A future API route can expose this data for the UI

  return (
    <div className="p-5 space-y-6">
      {error && (
        <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 flex items-center gap-2 text-sm">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {error}
        </div>
      )}

      {/* Metrics Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="p-4 rounded-xl bg-white/[0.03] border border-white/[0.06]">
          <div className="flex items-center gap-2 mb-2">
            <Eye className="w-4 h-4 text-blue-400" />
            <span className="text-xs font-medium text-neutral-400">Impressions</span>
          </div>
          <p className="text-2xl font-semibold text-white">—</p>
          <p className="text-[10px] text-neutral-500 mt-1">Pull analytics via MCP tool</p>
        </div>
        <div className="p-4 rounded-xl bg-white/[0.03] border border-white/[0.06]">
          <div className="flex items-center gap-2 mb-2">
            <Download className="w-4 h-4 text-green-400" />
            <span className="text-xs font-medium text-neutral-400">Installs</span>
          </div>
          <p className="text-2xl font-semibold text-white">—</p>
          <p className="text-[10px] text-neutral-500 mt-1">Pull analytics via MCP tool</p>
        </div>
        <div className="p-4 rounded-xl bg-white/[0.03] border border-white/[0.06]">
          <div className="flex items-center gap-2 mb-2">
            <Percent className="w-4 h-4 text-purple-400" />
            <span className="text-xs font-medium text-neutral-400">Conversion Rate</span>
          </div>
          <p className="text-2xl font-semibold text-white">—</p>
          <p className="text-[10px] text-neutral-500 mt-1">Pull analytics via MCP tool</p>
        </div>
      </div>

      {/* Info */}
      <div className="text-center py-6">
        <BarChart3 className="w-10 h-10 text-neutral-600 mx-auto mb-3" />
        <h3 className="text-sm font-medium text-white mb-1">Analytics</h3>
        <p className="text-xs text-neutral-400 max-w-md mx-auto">
          Performance data for this {storeType === 'ios' ? 'custom product page' : 'custom store listing'} can be
          pulled using the MCP tools <code className="text-purple-400">get_custom_page_analytics</code> and{' '}
          <code className="text-purple-400">compare_custom_pages</code>. Data is stored in Firestore
          and will appear here once available.
        </p>
      </div>
    </div>
  )
}
