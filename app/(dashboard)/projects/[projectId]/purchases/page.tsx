'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import {
  ShoppingBag,
  Package,
  Users,
  Loader2,
  AlertCircle,
  Settings,
  ExternalLink,
  RefreshCw,
} from 'lucide-react'
import type { WhopProduct, WhopMembership } from '@/lib/services/whop-project'

type Tab = 'overview' | 'products' | 'customers'

interface WhopOverview {
  company: {
    id: string
    title: string
    member_count: number
    verified: boolean
  }
  productCount: number
  activeMemberCount: number
  products: WhopProduct[]
}

export default function PurchasesPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const [activeTab, setActiveTab] = useState<Tab>('overview')
  const [overview, setOverview] = useState<WhopOverview | null>(null)
  const [memberships, setMemberships] = useState<WhopMembership[]>([])
  const [loading, setLoading] = useState(true)
  const [membershipsLoading, setMembershipsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notConfigured, setNotConfigured] = useState(false)

  const fetchOverview = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const res = await fetch(`/api/whop-project/overview?projectId=${projectId}`)
      if (res.status === 400) {
        const data = await res.json()
        if (data.error?.includes('not configured')) {
          setNotConfigured(true)
          return
        }
      }
      if (!res.ok) throw new Error('Failed to fetch overview')
      const data = await res.json()
      setOverview(data)
      setNotConfigured(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [projectId])

  const fetchMemberships = useCallback(async () => {
    try {
      setMembershipsLoading(true)
      const res = await fetch(`/api/whop-project/memberships?projectId=${projectId}`)
      if (!res.ok) throw new Error('Failed to fetch memberships')
      const data = await res.json()
      setMemberships(data.data || [])
    } catch (err) {
      console.error('Failed to fetch memberships:', err)
    } finally {
      setMembershipsLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    fetchOverview()
  }, [fetchOverview])

  useEffect(() => {
    if (activeTab === 'customers' && memberships.length === 0) {
      fetchMemberships()
    }
  }, [activeTab, memberships.length, fetchMemberships])

  const tabs = [
    { id: 'overview' as Tab, label: 'Overview', icon: ShoppingBag },
    { id: 'products' as Tab, label: 'Products', icon: Package },
    { id: 'customers' as Tab, label: 'Customers', icon: Users },
  ]

  // Not configured state
  if (notConfigured) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <div className="w-16 h-16 rounded-2xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center mb-6">
          <ShoppingBag className="w-8 h-8 text-violet-400" />
        </div>
        <h2 className="text-xl font-semibold text-white mb-2">Connect Whop</h2>
        <p className="text-neutral-400 text-center max-w-md mb-6">
          Add your Whop API key and Company ID in project settings to manage products, checkouts, and customers.
        </p>
        <Link
          href={`/projects/${projectId}/settings`}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-violet-500 hover:bg-violet-600 text-white font-medium transition-colors"
        >
          <Settings className="w-4 h-4" />
          Go to Settings
        </Link>
      </div>
    )
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Purchases</h1>
          <p className="text-sm text-neutral-400 mt-1">Manage your Whop products and customers</p>
        </div>
        <button
          onClick={() => {
            fetchOverview()
            if (activeTab === 'customers') fetchMemberships()
          }}
          className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white/[0.05] hover:bg-white/[0.1] text-neutral-300 text-sm transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
          Refresh
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 rounded-xl bg-white/[0.03] border border-white/[0.08] mb-6 w-fit">
        {tabs.map((tab) => {
          const Icon = tab.icon
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                activeTab === tab.id
                  ? 'bg-white/[0.1] text-white border border-white/[0.15]'
                  : 'text-neutral-400 hover:text-white hover:bg-white/[0.05]'
              }`}
            >
              <Icon className="w-4 h-4" />
              {tab.label}
            </button>
          )
        })}
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 text-neutral-400 animate-spin" />
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="rounded-xl bg-red-500/10 border border-red-500/20 p-4 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm text-red-400 font-medium">Error loading data</p>
            <p className="text-xs text-red-400/70 mt-1">{error}</p>
          </div>
        </div>
      )}

      {/* Overview Tab */}
      {!loading && !error && activeTab === 'overview' && overview && (
        <div className="space-y-6">
          {/* Stats Grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="rounded-2xl bg-white/[0.02] border border-white/[0.08] p-6">
              <p className="text-xs text-neutral-500 uppercase tracking-wider mb-2">Company</p>
              <p className="text-lg font-semibold text-white">{overview.company.title}</p>
              {overview.company.verified && (
                <span className="inline-flex items-center mt-2 px-2 py-0.5 rounded text-[10px] font-medium bg-green-500/10 text-green-400">
                  Verified
                </span>
              )}
            </div>
            <div className="rounded-2xl bg-white/[0.02] border border-white/[0.08] p-6">
              <p className="text-xs text-neutral-500 uppercase tracking-wider mb-2">Products</p>
              <p className="text-3xl font-bold text-white">{overview.productCount}</p>
            </div>
            <div className="rounded-2xl bg-white/[0.02] border border-white/[0.08] p-6">
              <p className="text-xs text-neutral-500 uppercase tracking-wider mb-2">Active Members</p>
              <p className="text-3xl font-bold text-white">{overview.activeMemberCount}</p>
            </div>
          </div>

          {/* Products Preview */}
          {overview.products.length > 0 && (
            <div className="rounded-2xl bg-white/[0.02] border border-white/[0.08] p-6">
              <h3 className="text-sm font-medium text-white mb-4">Products</h3>
              <div className="space-y-3">
                {overview.products.slice(0, 5).map((product) => (
                  <div key={product.id} className="flex items-center justify-between py-2 border-b border-white/[0.05] last:border-0">
                    <div>
                      <p className="text-sm text-white font-medium">{product.title}</p>
                      {product.headline && (
                        <p className="text-xs text-neutral-400 mt-0.5">{product.headline}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-neutral-400">{product.member_count} members</span>
                      <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${
                        product.visibility === 'visible'
                          ? 'bg-green-500/10 text-green-400'
                          : 'bg-neutral-500/10 text-neutral-400'
                      }`}>
                        {product.visibility}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
              {overview.products.length > 5 && (
                <button
                  onClick={() => setActiveTab('products')}
                  className="mt-3 text-xs text-violet-400 hover:text-violet-300 transition-colors"
                >
                  View all {overview.products.length} products
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Products Tab */}
      {!loading && !error && activeTab === 'products' && overview && (
        <div className="space-y-4">
          {overview.products.length === 0 ? (
            <div className="text-center py-12">
              <Package className="w-10 h-10 text-neutral-600 mx-auto mb-3" />
              <p className="text-neutral-400">No products yet</p>
              <p className="text-xs text-neutral-500 mt-1">Create products in your Whop dashboard</p>
            </div>
          ) : (
            overview.products.map((product) => (
              <div key={product.id} className="rounded-2xl bg-white/[0.02] border border-white/[0.08] p-6">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="text-base font-semibold text-white">{product.title}</h3>
                    {product.headline && (
                      <p className="text-sm text-neutral-400 mt-1">{product.headline}</p>
                    )}
                    <div className="flex items-center gap-3 mt-3">
                      <span className="text-xs text-neutral-500">ID: {product.id}</span>
                      <span className="text-xs text-neutral-500">{product.member_count} members</span>
                      <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${
                        product.visibility === 'visible'
                          ? 'bg-green-500/10 text-green-400'
                          : product.visibility === 'hidden'
                            ? 'bg-yellow-500/10 text-yellow-400'
                            : 'bg-neutral-500/10 text-neutral-400'
                      }`}>
                        {product.visibility}
                      </span>
                    </div>
                  </div>
                  {product.route && (
                    <a
                      href={`https://whop.com/${product.route}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-xs text-violet-400 hover:text-violet-300 transition-colors"
                    >
                      <ExternalLink className="w-3 h-3" />
                      View
                    </a>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Customers Tab */}
      {!loading && !error && activeTab === 'customers' && (
        <div className="space-y-4">
          {membershipsLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 text-neutral-400 animate-spin" />
            </div>
          ) : memberships.length === 0 ? (
            <div className="text-center py-12">
              <Users className="w-10 h-10 text-neutral-600 mx-auto mb-3" />
              <p className="text-neutral-400">No memberships yet</p>
              <p className="text-xs text-neutral-500 mt-1">Memberships will appear here after customers purchase</p>
            </div>
          ) : (
            memberships.map((membership) => (
              <div key={membership.id} className="rounded-2xl bg-white/[0.02] border border-white/[0.08] p-5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-white/[0.05] flex items-center justify-center text-sm font-medium text-white">
                      {membership.user?.name?.[0]?.toUpperCase() || membership.user?.username?.[0]?.toUpperCase() || '?'}
                    </div>
                    <div>
                      <p className="text-sm font-medium text-white">
                        {membership.user?.name || membership.user?.username || 'Unknown'}
                      </p>
                      <p className="text-xs text-neutral-400">
                        {membership.product?.title || membership.product?.id}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    {membership.license_key && (
                      <span className="text-xs text-neutral-500 font-mono">{membership.license_key.slice(0, 8)}...</span>
                    )}
                    <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${
                      membership.status === 'active'
                        ? 'bg-green-500/10 text-green-400'
                        : membership.status === 'trialing'
                          ? 'bg-blue-500/10 text-blue-400'
                          : membership.status === 'past_due'
                            ? 'bg-yellow-500/10 text-yellow-400'
                            : membership.status === 'canceled' || membership.status === 'expired'
                              ? 'bg-red-500/10 text-red-400'
                              : 'bg-neutral-500/10 text-neutral-400'
                    }`}>
                      {membership.status}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-4 mt-3 text-xs text-neutral-500">
                  <span>Created: {new Date(membership.created_at).toLocaleDateString()}</span>
                  {membership.renewal_period_end && (
                    <span>Renews: {new Date(membership.renewal_period_end).toLocaleDateString()}</span>
                  )}
                  {membership.cancel_at_period_end && (
                    <span className="text-amber-400">Canceling at period end</span>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}
