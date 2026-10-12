'use client'

import { useState, useEffect } from 'react'
import {
  X,
  Package,
  Info,
  Languages,
  Loader2,
  Check,
  AlertCircle,
  Star,
} from 'lucide-react'
import { LOCALE_NAMES, LOCALE_FLAGS } from '@/lib/constants'
import TranslationPanel from './TranslationPanel'

interface SubscriptionGroup {
  id: string
  appStoreId: string | null
  referenceName: string
  syncStatus: string
  subscriptions: Array<{
    id: string
    name: string
    productId: string
  }>
}

interface GroupLocalization {
  locale: string
  name: string
  customAppName: string | null
}

interface GroupDetailPanelProps {
  projectId: string
  group: SubscriptionGroup
  primaryLocale: string
  enabledLocales: string[]
  onClose: () => void
  onUpdated: () => void
}

type TabId = 'overview' | 'localizations'

const TABS = [
  { id: 'overview' as TabId, label: 'Overview', icon: <Info className="w-4 h-4" /> },
  { id: 'localizations' as TabId, label: 'Localizations', icon: <Languages className="w-4 h-4" /> },
]

export default function GroupDetailPanel({
  projectId,
  group,
  primaryLocale,
  enabledLocales,
  onClose,
  onUpdated,
}: GroupDetailPanelProps) {
  const [activeTab, setActiveTab] = useState<TabId>('localizations')

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[9999] p-4 backdrop-blur-sm">
      <div className="bg-[#1a1a1a] rounded-2xl border border-white/[0.08] w-full max-w-4xl max-h-[85vh] flex flex-col shadow-2xl">
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-white/[0.08] flex-shrink-0">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <div className="p-2.5 rounded-xl flex-shrink-0 bg-blue-500/20 text-blue-400">
                <Package className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <h2 className="text-lg font-semibold text-white truncate">
                  {group.referenceName}
                </h2>
                <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                  <span className="text-xs text-neutral-400">
                    Subscription Group
                  </span>
                  <span className="text-xs text-neutral-600">•</span>
                  <span className="text-xs text-neutral-500">
                    {group.subscriptions.length} subscription{group.subscriptions.length !== 1 ? 's' : ''}
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
            {TABS.map(tab => (
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
        <div className="flex-1 overflow-hidden">
          {activeTab === 'overview' && (
            <div className="h-full overflow-y-auto">
              <GroupOverviewTab
                projectId={projectId}
                group={group}
              />
            </div>
          )}
          {activeTab === 'localizations' && (
            <div className="h-full">
              <GroupLocalizationsTab
                projectId={projectId}
                groupId={group.id}
                primaryLocale={primaryLocale}
                enabledLocales={enabledLocales}
                onUpdated={onUpdated}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// Overview Tab
function GroupOverviewTab({
  projectId,
  group,
}: {
  projectId: string
  group: SubscriptionGroup
}) {
  return (
    <div className="p-6 space-y-6">
      {/* Basic Info */}
      <div className="space-y-4">
        <h3 className="text-sm font-medium text-neutral-400 uppercase tracking-wider">
          Group Information
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="p-4 rounded-xl bg-white/[0.02] border border-white/[0.06]">
            <p className="text-xs text-neutral-500 mb-1">Reference Name</p>
            <p className="text-white font-medium">{group.referenceName}</p>
          </div>

          <div className="p-4 rounded-xl bg-white/[0.02] border border-white/[0.06]">
            <p className="text-xs text-neutral-500 mb-1">App Store ID</p>
            <p className="text-white font-mono text-sm">
              {group.appStoreId || <span className="text-neutral-500">Not synced</span>}
            </p>
          </div>

          <div className="p-4 rounded-xl bg-white/[0.02] border border-white/[0.06]">
            <p className="text-xs text-neutral-500 mb-1">Sync Status</p>
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
              group.syncStatus === 'synced'
                ? 'bg-green-500/20 text-green-400'
                : group.syncStatus === 'local_changes'
                ? 'bg-amber-500/20 text-amber-400'
                : 'bg-blue-500/20 text-blue-400'
            }`}>
              {group.syncStatus === 'synced' ? 'Synced' :
               group.syncStatus === 'local_changes' ? 'Modified' : 'Pending'}
            </span>
          </div>

          <div className="p-4 rounded-xl bg-white/[0.02] border border-white/[0.06]">
            <p className="text-xs text-neutral-500 mb-1">Subscriptions</p>
            <p className="text-white font-medium">
              {group.subscriptions.length} subscription{group.subscriptions.length !== 1 ? 's' : ''}
            </p>
          </div>
        </div>
      </div>

      {/* Subscriptions List */}
      {group.subscriptions.length > 0 && (
        <div className="space-y-4">
          <h3 className="text-sm font-medium text-neutral-400 uppercase tracking-wider">
            Subscriptions in this Group
          </h3>

          <div className="space-y-2">
            {group.subscriptions.map((sub, index) => (
              <div
                key={sub.id}
                className="p-3 rounded-lg bg-white/[0.02] border border-white/[0.06] flex items-center gap-3"
              >
                <div className="w-6 h-6 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center text-xs font-semibold">
                  {index + 1}
                </div>
                <div>
                  <p className="text-sm text-white">{sub.name}</p>
                  <p className="text-xs text-neutral-500 font-mono">{sub.productId}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// Localizations Tab - Now using TranslationPanel
function GroupLocalizationsTab({
  projectId,
  groupId,
  primaryLocale,
  enabledLocales,
  onUpdated,
}: {
  projectId: string
  groupId: string
  primaryLocale: string
  enabledLocales: string[]
  onUpdated: () => void
}) {
  const availableLocales = enabledLocales.length > 0 ? enabledLocales : ['en-US']

  const [isLoading, setIsLoading] = useState(true)
  const [localizations, setLocalizations] = useState<GroupLocalization[]>([])
  const [selectedLocale, setSelectedLocale] = useState<string>(primaryLocale)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  // Edit state
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({
    name: '',
    customAppName: '',
  })
  const [originalValues, setOriginalValues] = useState<Record<string, string>>({
    name: '',
    customAppName: '',
  })
  const [isSaving, setIsSaving] = useState(false)

  // Translation state
  const [isTranslating, setIsTranslating] = useState(false)
  const [translateProgress, setTranslateProgress] = useState<{ current: number; total: number } | null>(null)

  useEffect(() => {
    fetchLocalizations()
  }, [projectId, groupId])

  const fetchLocalizations = async () => {
    setIsLoading(true)
    setError(null)
    try {
      const response = await fetch(`/api/subscriptions/groups/${groupId}/localizations?projectId=${projectId}`)
      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to fetch localizations')
      }
      const data = await response.json()
      setLocalizations(data.localizations || [])

      // Select primary locale or first available
      const locales = data.localizations || []
      const targetLocale = locales.find((l: GroupLocalization) => l.locale === primaryLocale)?.locale ||
                          locales[0]?.locale ||
                          primaryLocale
      handleLocaleSelect(targetLocale, locales)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load localizations')
    } finally {
      setIsLoading(false)
    }
  }

  const handleLocaleSelect = (locale: string, locs?: GroupLocalization[]) => {
    const locsToUse = locs || localizations
    setSelectedLocale(locale)
    const loc = locsToUse.find(l => l.locale === locale)
    const values = {
      name: loc?.name || '',
      customAppName: loc?.customAppName || '',
    }
    setFieldValues(values)
    setOriginalValues(values)
  }

  const handleFieldChange = (field: string, value: string) => {
    setFieldValues(prev => ({
      ...prev,
      [field]: value,
    }))
  }

  const hasChanges = JSON.stringify(fieldValues) !== JSON.stringify(originalValues)

  const handleSave = async () => {
    if (!selectedLocale || !fieldValues.name.trim()) return

    setIsSaving(true)
    setError(null)
    try {
      const response = await fetch(`/api/subscriptions/groups/${groupId}/localizations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          locale: selectedLocale,
          name: fieldValues.name,
          customAppName: fieldValues.customAppName || null,
          pushToStore: false,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to save')
      }

      // Update local state
      setLocalizations(prev => {
        const existing = prev.find(l => l.locale === selectedLocale)
        if (existing) {
          return prev.map(l =>
            l.locale === selectedLocale
              ? { ...l, name: fieldValues.name, customAppName: fieldValues.customAppName || null }
              : l
          )
        }
        return [...prev, {
          locale: selectedLocale,
          name: fieldValues.name,
          customAppName: fieldValues.customAppName || null,
        }]
      })

      setOriginalValues({ ...fieldValues })
      setSuccess('Saved successfully')
      setTimeout(() => setSuccess(null), 2000)
      onUpdated()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setIsSaving(false)
    }
  }

  const handleTranslate = async (targetLocales: string[], force: boolean) => {
    const primaryLoc = localizations.find(l => l.locale === primaryLocale)
    if (!primaryLoc || !primaryLoc.name) {
      setError('Please set the primary locale first')
      return
    }

    setIsTranslating(true)
    setTranslateProgress({ current: 0, total: targetLocales.length })
    setError(null)

    try {
      const response = await fetch('/api/subscriptions/groups/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          groupId,
          targetLocales,
          force,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Translation failed')
      }

      const data = await response.json()
      setTranslateProgress({ current: targetLocales.length, total: targetLocales.length })

      await fetchLocalizations()
      setSuccess(`Translated to ${data.summary.translated} locales${data.summary.fromCache > 0 ? ` (${data.summary.fromCache} cached)` : ''}`)
      setTimeout(() => setSuccess(null), 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Translation failed')
    } finally {
      setIsTranslating(false)
      setTranslateProgress(null)
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-6 h-6 animate-spin text-purple-400" />
      </div>
    )
  }

  // Convert localizations to the format expected by TranslationPanel
  const localizationsForPanel = localizations.map(l => ({
    locale: l.locale,
    name: l.name,
    customAppName: l.customAppName || '',
  }))

  return (
    <div className="h-full">
      <TranslationPanel
        localizations={localizationsForPanel}
        primaryLocale={primaryLocale}
        enabledLocales={availableLocales}
        fields={[
          {
            key: 'name',
            label: 'Display Name',
            maxLength: 30,
            helpText: 'This name appears in the App Store subscription management section',
          },
          {
            key: 'customAppName',
            label: 'Custom App Name',
            maxLength: 30,
            helpText: 'Optional: Override the app name shown with this subscription group',
          },
        ]}
        selectedLocale={selectedLocale}
        onLocaleSelect={locale => handleLocaleSelect(locale)}
        fieldValues={fieldValues}
        onFieldChange={handleFieldChange}
        onSave={handleSave}
        onTranslate={handleTranslate}
        isSaving={isSaving}
        isTranslating={isTranslating}
        hasChanges={hasChanges}
        translateProgress={translateProgress}
        error={error}
        success={success}
      />
    </div>
  )
}
