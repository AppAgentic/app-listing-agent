'use client'

import { useState, useEffect } from 'react'
import {
  X,
  Info,
  Languages,
  Image as ImageIcon,
  Film,
  FlaskConical,
  BarChart3,
  LayoutTemplate,
  ExternalLink,
} from 'lucide-react'
import CustomPageOverviewTab from './CustomPageOverviewTab'
import CustomPageLocalizationsTab from './CustomPageLocalizationsTab'
import CustomPageScreenshotsTab from './CustomPageScreenshotsTab'
import CustomPageMediaTab from './CustomPageMediaTab'
import CustomPageExperimentsTab from './CustomPageExperimentsTab'
import CustomPageAnalyticsTab from './CustomPageAnalyticsTab'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CPPLocalization {
  locale: string
  promotionalText: string | null
  screenshots: any[]
  appStoreLocalizationId: string | null
}

interface CustomProductPage {
  id: string
  appStoreId: string | null
  name: string
  url: string | null
  state: string | null
  syncStatus: 'synced' | 'local_changes' | 'pending_creation'
  localizations: CPPLocalization[]
}

interface CSLLocalization {
  locale: string
  title: string
  shortDescription: string
  fullDescription: string
  iconUrl: string | null
  iconKey: string | null
  featureGraphicUrl: string | null
  featureGraphicKey: string | null
  videoUrl: string | null
  screenshots: any[]
}

interface CustomStoreListing {
  id: string
  playStoreId: string | null
  name: string
  targetingType: 'COUNTRY' | 'PRE_REGISTRATION' | 'INSTALL_STATE'
  targetingCountries: string[]
  syncStatus: 'synced' | 'local_changes' | 'pending_creation'
  localizations: CSLLocalization[]
}

type CustomPage = CustomProductPage | CustomStoreListing

type TabId = 'overview' | 'localizations' | 'screenshots' | 'media' | 'experiments' | 'analytics'

interface Tab {
  id: TabId
  label: string
  icon: React.ReactNode
}

interface CustomPageDetailPanelProps {
  projectId: string
  page: CustomPage
  storeType: 'ios' | 'android'
  onClose: () => void
  onUpdated: () => void
  onDelete: () => void
  initialTab?: TabId
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SYNC_STATUS_LABELS: Record<string, { label: string; badgeClass: string }> = {
  synced: {
    label: 'Synced',
    badgeClass: 'bg-green-500/20 text-green-400 border-green-500/30',
  },
  local_changes: {
    label: 'Modified',
    badgeClass: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  },
  pending_creation: {
    label: 'New',
    badgeClass: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  },
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function CustomPageDetailPanel({
  projectId,
  page,
  storeType,
  onClose,
  onUpdated,
  onDelete,
  initialTab = 'overview',
}: CustomPageDetailPanelProps) {
  const [activeTab, setActiveTab] = useState<TabId>(initialTab)
  const isIOS = storeType === 'ios'

  // Close on Escape
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onClose])

  // Build visible tabs
  const allTabs: Tab[] = [
    { id: 'overview', label: 'Overview', icon: <Info className="w-4 h-4" /> },
    { id: 'localizations', label: 'Localizations', icon: <Languages className="w-4 h-4" /> },
    { id: 'screenshots', label: 'Screenshots', icon: <ImageIcon className="w-4 h-4" /> },
    { id: 'media', label: 'Media', icon: <Film className="w-4 h-4" /> },
    { id: 'experiments', label: 'Experiments', icon: <FlaskConical className="w-4 h-4" /> },
    { id: 'analytics', label: 'Analytics', icon: <BarChart3 className="w-4 h-4" /> },
  ]

  // iOS doesn't need media tab (no custom icon/feature graphic)
  const visibleTabs = isIOS
    ? allTabs.filter(t => t.id !== 'media')
    : allTabs

  const syncInfo = SYNC_STATUS_LABELS[page.syncStatus]

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[9999] p-4 backdrop-blur-sm">
      {/* Click-outside-to-close */}
      <div className="absolute inset-0" onClick={onClose} />

      {/* Panel */}
      <div className="relative bg-[#1a1a1a] rounded-2xl border border-white/[0.08] w-full max-w-5xl max-h-[85vh] flex flex-col shadow-2xl">
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-white/[0.08] flex-shrink-0">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <div className={`p-2.5 rounded-xl flex-shrink-0 ${isIOS ? 'bg-blue-500/20 text-blue-400' : 'bg-green-500/20 text-green-400'}`}>
                <LayoutTemplate className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <h2 className="text-lg font-semibold text-white truncate">{page.name}</h2>
                <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                  {isIOS ? (
                    <>
                      <span className="text-xs text-neutral-400">Custom Product Page</span>
                      {(page as CustomProductPage).url && (
                        <a
                          href={(page as CustomProductPage).url!}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1"
                          onClick={e => e.stopPropagation()}
                        >
                          <ExternalLink className="w-3 h-3" />
                          View
                        </a>
                      )}
                    </>
                  ) : (
                    <span className="text-xs text-neutral-400">Custom Store Listing</span>
                  )}
                  {syncInfo && (
                    <>
                      <span className="text-xs text-neutral-600">·</span>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${syncInfo.badgeClass}`}>
                        {syncInfo.label}
                      </span>
                    </>
                  )}
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
              <CustomPageOverviewTab
                projectId={projectId}
                page={page}
                storeType={storeType}
                onUpdated={onUpdated}
                onDelete={onDelete}
              />
            </div>
          )}
          {activeTab === 'localizations' && (
            <div className="h-full overflow-y-auto">
              <CustomPageLocalizationsTab
                projectId={projectId}
                page={page}
                storeType={storeType}
                onUpdated={onUpdated}
              />
            </div>
          )}
          {activeTab === 'screenshots' && (
            <div className="h-full overflow-y-auto">
              <CustomPageScreenshotsTab
                projectId={projectId}
                page={page}
                storeType={storeType}
                onUpdated={onUpdated}
              />
            </div>
          )}
          {activeTab === 'media' && !isIOS && (
            <div className="h-full overflow-y-auto">
              <CustomPageMediaTab
                projectId={projectId}
                page={page as CustomStoreListing}
                onUpdated={onUpdated}
              />
            </div>
          )}
          {activeTab === 'experiments' && (
            <div className="h-full overflow-y-auto">
              <CustomPageExperimentsTab
                projectId={projectId}
                pageId={page.id}
                storeType={storeType}
              />
            </div>
          )}
          {activeTab === 'analytics' && (
            <div className="h-full overflow-y-auto">
              <CustomPageAnalyticsTab
                projectId={projectId}
                pageId={page.id}
                storeType={storeType}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
