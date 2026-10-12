'use client'

import { useState, useEffect } from 'react'
import {
  X,
  Package,
  CreditCard,
  Info,
  Languages,
  DollarSign,
  Gift,
} from 'lucide-react'
import PlayStoreOverviewTab from './playstore/PlayStoreOverviewTab'
import PlayStoreLocalizationsTab from './playstore/PlayStoreLocalizationsTab'
import PlayStorePricingTab from './playstore/PlayStorePricingTab'
import PlayStoreOffersTab from './playstore/PlayStoreOffersTab'

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

type PlayStoreItem = PlayStoreProduct | PlayStoreSubscription

interface PlayStoreProductDetailPanelProps {
  projectId: string
  item: PlayStoreItem
  itemType: 'product' | 'subscription'
  enabledLocales: string[]
  onClose: () => void
  onUpdated: () => void
  onDelete: () => void
  initialTab?: TabId
}

type TabId = 'overview' | 'localizations' | 'pricing' | 'offers'

interface Tab {
  id: TabId
  label: string
  icon: React.ReactNode
}

const ALL_TABS: Tab[] = [
  { id: 'overview', label: 'Overview', icon: <Info className="w-4 h-4" /> },
  { id: 'localizations', label: 'Localizations', icon: <Languages className="w-4 h-4" /> },
  { id: 'pricing', label: 'Pricing', icon: <DollarSign className="w-4 h-4" /> },
  { id: 'offers', label: 'Offers', icon: <Gift className="w-4 h-4" /> },
]

export default function PlayStoreProductDetailPanel({
  projectId,
  item,
  itemType,
  enabledLocales,
  onClose,
  onUpdated,
  onDelete,
  initialTab = 'overview',
}: PlayStoreProductDetailPanelProps) {
  const [activeTab, setActiveTab] = useState<TabId>(initialTab)

  // Close on Escape
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onClose])

  const getProductIcon = () => {
    if (itemType === 'subscription') {
      return <CreditCard className="w-5 h-5" />
    }
    return <Package className="w-5 h-5" />
  }

  const getTitle = () => {
    if (itemType === 'product') {
      const p = item as PlayStoreProduct
      return p.title || p.sku
    }
    const s = item as PlayStoreSubscription
    return s.title || s.productId
  }

  const getIdentifier = () => {
    if (itemType === 'product') {
      return (item as PlayStoreProduct).sku
    }
    return (item as PlayStoreSubscription).productId
  }

  const defaultLanguage = item.defaultLanguage || 'en-US'

  // Only show Offers tab for subscriptions
  const visibleTabs = itemType === 'subscription'
    ? ALL_TABS
    : ALL_TABS.filter(t => t.id !== 'offers')

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[9999] p-4 backdrop-blur-sm">
      <div
        className="absolute inset-0"
        onClick={onClose}
      />
      <div className="relative bg-[#1a1a1a] rounded-2xl border border-white/[0.08] w-full max-w-5xl max-h-[85vh] flex flex-col shadow-2xl">
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-white/[0.08] flex-shrink-0">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <div className={`p-2.5 rounded-xl flex-shrink-0 ${
                itemType === 'subscription'
                  ? 'bg-blue-500/20 text-blue-400'
                  : 'bg-amber-500/20 text-amber-400'
              }`}>
                {getProductIcon()}
              </div>
              <div className="min-w-0">
                <h2 className="text-lg font-semibold text-white truncate">
                  {getTitle()}
                </h2>
                <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                  <span className="text-xs text-neutral-500 font-mono truncate">
                    {getIdentifier()}
                  </span>
                  <span className="text-xs text-neutral-600">•</span>
                  <span className="text-xs text-neutral-400">
                    {itemType === 'product' ? 'One-Time Product' : 'Subscription'}
                  </span>
                </div>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 rounded-lg text-neutral-400 hover:text-white hover:bg-white/[0.05] transition-all flex-shrink-0"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 mt-4 overflow-x-auto scrollbar-none -mx-1 px-1">
            {visibleTabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all whitespace-nowrap ${
                  activeTab === tab.id
                    ? 'bg-white/[0.1] text-white'
                    : 'text-neutral-400 hover:text-white hover:bg-white/[0.05]'
                }`}
              >
                {tab.icon}
                <span className="hidden sm:inline">{tab.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Tab Content */}
        <div className="flex-1 min-h-0 overflow-hidden">
          {activeTab === 'overview' && (
            <div className="h-full overflow-y-auto">
              <PlayStoreOverviewTab
                projectId={projectId}
                item={item}
                itemType={itemType}
                onUpdated={onUpdated}
                onDelete={onDelete}
              />
            </div>
          )}
          {activeTab === 'localizations' && (
            <div className="h-full">
              <PlayStoreLocalizationsTab
                projectId={projectId}
                itemId={item.id}
                itemType={itemType}
                defaultLanguage={defaultLanguage}
                enabledLocales={enabledLocales}
                onUpdated={onUpdated}
              />
            </div>
          )}
          {activeTab === 'pricing' && (
            <div className="h-full overflow-y-auto">
              <PlayStorePricingTab
                projectId={projectId}
                itemId={item.id}
                itemType={itemType}
                basePlans={itemType === 'subscription' ? (item as PlayStoreSubscription).basePlans : undefined}
                onUpdated={onUpdated}
              />
            </div>
          )}
          {activeTab === 'offers' && itemType === 'subscription' && (
            <div className="h-full overflow-y-auto">
              <PlayStoreOffersTab
                projectId={projectId}
                subscriptionId={item.id}
                productId={(item as PlayStoreSubscription).productId}
                basePlans={(item as PlayStoreSubscription).basePlans}
                onUpdated={onUpdated}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
