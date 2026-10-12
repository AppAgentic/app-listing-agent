'use client'

import { useState } from 'react'
import {
  X,
  Package,
  Coins,
  CreditCard,
  Info,
  Languages,
  DollarSign,
  Image,
  Gift,
} from 'lucide-react'
import OverviewTab from './tabs/OverviewTab'
import LocalizationsTab from './tabs/LocalizationsTab'
import PricingTab from './tabs/PricingTab'
import MediaTab from './tabs/MediaTab'
import OffersTab from './tabs/OffersTab'

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

interface ProductDetailPanelProps {
  projectId: string
  product: Product
  productType: 'iap' | 'subscription'
  subscriptionPeriod?: string
  primaryLocale: string
  enabledLocales: string[]
  appStoreAppId?: string | null  // The app's App Store ID
  onClose: () => void
  onUpdated: () => void
  onDelete: () => void
  initialTab?: 'overview' | 'localizations' | 'pricing' | 'media' | 'offers'
}

const PRODUCT_TYPE_LABELS: Record<string, string> = {
  CONSUMABLE: 'Consumable',
  NON_CONSUMABLE: 'Non-Consumable',
  NON_RENEWING_SUBSCRIPTION: 'Non-Renewing',
  AUTO_RENEWABLE_SUBSCRIPTION: 'Auto-Renewable',
}

const PERIOD_LABELS: Record<string, string> = {
  ONE_WEEK: '1 Week',
  ONE_MONTH: '1 Month',
  TWO_MONTHS: '2 Months',
  THREE_MONTHS: '3 Months',
  SIX_MONTHS: '6 Months',
  ONE_YEAR: '1 Year',
}

type TabId = 'overview' | 'localizations' | 'pricing' | 'media' | 'offers'

interface Tab {
  id: TabId
  label: string
  icon: React.ReactNode
  showForType?: 'iap' | 'subscription' | 'all'
}

const TABS: Tab[] = [
  { id: 'overview', label: 'Overview', icon: <Info className="w-4 h-4" />, showForType: 'all' },
  { id: 'localizations', label: 'Localizations', icon: <Languages className="w-4 h-4" />, showForType: 'all' },
  { id: 'pricing', label: 'Pricing', icon: <DollarSign className="w-4 h-4" />, showForType: 'all' },
  { id: 'media', label: 'Media', icon: <Image className="w-4 h-4" />, showForType: 'all' },
  { id: 'offers', label: 'Offers', icon: <Gift className="w-4 h-4" />, showForType: 'subscription' },
]

export default function ProductDetailPanel({
  projectId,
  product,
  productType,
  subscriptionPeriod,
  primaryLocale,
  enabledLocales,
  appStoreAppId,
  onClose,
  onUpdated,
  onDelete,
  initialTab = 'overview',
}: ProductDetailPanelProps) {
  const [activeTab, setActiveTab] = useState<TabId>(initialTab)

  // Filter tabs based on product type
  const visibleTabs = TABS.filter(tab =>
    tab.showForType === 'all' || tab.showForType === productType
  )

  // Get product icon based on type
  const getProductIcon = () => {
    if (productType === 'subscription') {
      return <CreditCard className="w-5 h-5" />
    }
    const iap = product as InAppPurchase
    if (iap.productType === 'CONSUMABLE') {
      return <Coins className="w-5 h-5" />
    }
    return <Package className="w-5 h-5" />
  }

  // Get product type label
  const getTypeLabel = () => {
    if (productType === 'subscription') {
      return `${PERIOD_LABELS[subscriptionPeriod || ''] || subscriptionPeriod} Subscription`
    }
    const iap = product as InAppPurchase
    return PRODUCT_TYPE_LABELS[iap.productType] || iap.productType
  }

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[9999] p-4 backdrop-blur-sm">
      <div className="bg-[#1a1a1a] rounded-2xl border border-white/[0.08] w-full max-w-5xl max-h-[85vh] flex flex-col shadow-2xl">
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-white/[0.08] flex-shrink-0">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <div className={`p-2.5 rounded-xl flex-shrink-0 ${
                productType === 'subscription'
                  ? 'bg-blue-500/20 text-blue-400'
                  : 'bg-amber-500/20 text-amber-400'
              }`}>
                {getProductIcon()}
              </div>
              <div className="min-w-0">
                <h2 className="text-lg font-semibold text-white truncate">
                  {product.name}
                </h2>
                <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                  <span className="text-xs text-neutral-500 font-mono truncate">
                    {product.productId}
                  </span>
                  <span className="text-xs text-neutral-600">•</span>
                  <span className="text-xs text-neutral-400">
                    {getTypeLabel()}
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
              <OverviewTab
                projectId={projectId}
                product={product}
                productType={productType}
                subscriptionPeriod={subscriptionPeriod}
                appStoreAppId={appStoreAppId}
                onUpdated={onUpdated}
                onDelete={onDelete}
              />
            </div>
          )}
          {activeTab === 'localizations' && (
            <div className="h-full">
              <LocalizationsTab
                projectId={projectId}
                productId={product.id}
                productType={productType}
                productState={product.state}
                primaryLocale={primaryLocale}
                enabledLocales={enabledLocales}
                onUpdated={onUpdated}
              />
            </div>
          )}
          {activeTab === 'pricing' && (
            <div className="h-full overflow-y-auto">
              <PricingTab
                projectId={projectId}
                productId={product.id}
                productType={productType}
                onUpdated={onUpdated}
              />
            </div>
          )}
          {activeTab === 'media' && (
            <div className="h-full overflow-y-auto">
              <MediaTab
                projectId={projectId}
                productId={product.id}
                productName={product.name}
                productType={productType}
                productState={product.state}
                onUpdated={onUpdated}
              />
            </div>
          )}
          {activeTab === 'offers' && productType === 'subscription' && (
            <div className="h-full overflow-y-auto">
              <OffersTab
                projectId={projectId}
                subscriptionId={product.id}
                subscriptionPeriod={subscriptionPeriod || 'ONE_MONTH'}
                onUpdated={onUpdated}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
