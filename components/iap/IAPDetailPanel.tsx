'use client'

import { useState, useEffect } from 'react'
import {
  X,
  Languages,
  Loader2,
  Check,
  AlertCircle,
  Sparkles,
  Globe,
  DollarSign,
  Star,
  RefreshCw,
  ChevronRight,
  Save,
  Trash2,
} from 'lucide-react'
import { LOCALE_NAMES, LOCALE_FLAGS, IAP_LIMITS } from '@/lib/constants'

interface Localization {
  locale: string
  displayName: string
  description: string
}

interface IAPDetailPanelProps {
  projectId: string
  iapId: string
  productName: string
  productType: string
  primaryLocale?: string
  enabledLocales?: string[]  // Project's enabled locales (matches metadata section)
  entityType?: 'iap' | 'subscription'  // Type of entity to determine API endpoints
  onClose: () => void
  onUpdated: () => void
}

export default function IAPDetailPanel({
  projectId,
  iapId,
  productName,
  productType,
  primaryLocale = 'en-US',
  enabledLocales = ['en-US'],
  entityType = 'iap',
  onClose,
  onUpdated,
}: IAPDetailPanelProps) {
  // Use the project's enabled locales for language list
  const availableLocales = enabledLocales.length > 0 ? enabledLocales : ['en-US']
  // Determine API endpoints based on entity type
  const localizationsEndpoint = entityType === 'subscription'
    ? `/api/subscriptions/${iapId}/localizations`
    : `/api/iap/${iapId}/localizations`

  const translateEndpoint = entityType === 'subscription'
    ? '/api/subscriptions/translate'
    : '/api/iap/translate'

  const translateIdField = entityType === 'subscription' ? 'subscriptionId' : 'iapId'
  const [isLoading, setIsLoading] = useState(true)
  const [localizations, setLocalizations] = useState<Localization[]>([])
  const [selectedLocale, setSelectedLocale] = useState<string>(primaryLocale)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  // Edit state
  const [editDisplayName, setEditDisplayName] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [hasChanges, setHasChanges] = useState(false)

  // Translation state
  const [isTranslating, setIsTranslating] = useState(false)
  const [translatingLocales, setTranslatingLocales] = useState<Set<string>>(new Set())

  useEffect(() => {
    fetchLocalizations()
  }, [projectId, iapId])

  useEffect(() => {
    // Check for unsaved changes
    const currentLoc = localizations.find(l => l.locale === selectedLocale)
    if (currentLoc) {
      setHasChanges(
        editDisplayName !== currentLoc.displayName ||
        editDescription !== currentLoc.description
      )
    } else {
      setHasChanges(editDisplayName.length > 0 || editDescription.length > 0)
    }
  }, [editDisplayName, editDescription, localizations, selectedLocale])

  const fetchLocalizations = async () => {
    setIsLoading(true)
    setError(null)
    try {
      const response = await fetch(`${localizationsEndpoint}?projectId=${projectId}`)
      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to fetch localizations')
      }
      const data = await response.json()
      setLocalizations(data.localizations || [])

      // Select primary locale or first available
      const locales = data.localizations || []
      if (locales.length > 0) {
        const primary = locales.find((l: Localization) => l.locale === primaryLocale)
        const firstLoc = primary || locales[0]
        setSelectedLocale(firstLoc.locale)
        setEditDisplayName(firstLoc.displayName || '')
        setEditDescription(firstLoc.description || '')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load localizations')
    } finally {
      setIsLoading(false)
    }
  }

  const handleLocaleSelect = (locale: string) => {
    // Auto-save if there are changes
    if (hasChanges) {
      handleSave()
    }

    setSelectedLocale(locale)
    const loc = localizations.find(l => l.locale === locale)
    if (loc) {
      setEditDisplayName(loc.displayName || '')
      setEditDescription(loc.description || '')
    } else {
      setEditDisplayName('')
      setEditDescription('')
    }
  }

  const handleSave = async () => {
    if (!selectedLocale || (!editDisplayName.trim() && !editDescription.trim())) return

    setIsSaving(true)
    setError(null)
    try {
      const response = await fetch(localizationsEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          locale: selectedLocale,
          displayName: editDisplayName,
          description: editDescription,
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
          return prev.map(l => l.locale === selectedLocale
            ? { ...l, displayName: editDisplayName, description: editDescription }
            : l
          )
        }
        return [...prev, { locale: selectedLocale, displayName: editDisplayName, description: editDescription }]
      })

      setHasChanges(false)
      showSuccess('Saved')
      onUpdated()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setIsSaving(false)
    }
  }

  const handleTranslateLocale = async (targetLocale: string) => {
    setTranslatingLocales(prev => new Set(prev).add(targetLocale))
    setError(null)

    try {
      const response = await fetch(translateEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          [translateIdField]: iapId,
          targetLocales: [targetLocale],
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Translation failed')
      }

      const data = await response.json()
      const result = data.translations?.[0]

      if (result) {
        // Update local state with translation
        setLocalizations(prev => {
          const existing = prev.find(l => l.locale === targetLocale)
          if (existing) {
            return prev.map(l => l.locale === targetLocale
              ? { ...l, displayName: result.displayName, description: result.description }
              : l
            )
          }
          return [...prev, { locale: targetLocale, displayName: result.displayName, description: result.description }]
        })

        // If this is the selected locale, update the form
        if (targetLocale === selectedLocale) {
          setEditDisplayName(result.displayName)
          setEditDescription(result.description)
        }

        showSuccess(`Translated to ${LOCALE_NAMES[targetLocale] || targetLocale}`)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Translation failed')
    } finally {
      setTranslatingLocales(prev => {
        const next = new Set(prev)
        next.delete(targetLocale)
        return next
      })
    }
  }

  const handleTranslateAll = async () => {
    setIsTranslating(true)
    setError(null)

    // Get all locales that don't have translations yet
    const existingLocales = new Set(localizations.map(l => l.locale))
    const targetLocales = availableLocales.filter(l => !existingLocales.has(l) && l !== primaryLocale)

    if (targetLocales.length === 0) {
      showSuccess('All locales already translated')
      setIsTranslating(false)
      return
    }

    try {
      const response = await fetch(translateEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          [translateIdField]: iapId,
          targetLocales,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Translation failed')
      }

      const data = await response.json()

      // Update local state with all translations
      const newLocalizations = data.translations?.map((t: any) => ({
        locale: t.locale,
        displayName: t.displayName,
        description: t.description,
      })) || []

      setLocalizations(prev => {
        const map = new Map(prev.map(l => [l.locale, l]))
        newLocalizations.forEach((l: Localization) => map.set(l.locale, l))
        return Array.from(map.values())
      })

      showSuccess(`Translated to ${data.summary.translated} locales (${data.summary.fromCache} from cache)`)
      onUpdated()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Translation failed')
    } finally {
      setIsTranslating(false)
    }
  }

  const showSuccess = (message: string) => {
    setSuccess(message)
    setTimeout(() => setSuccess(null), 2000)
  }

  const isPrimary = selectedLocale === primaryLocale
  const existingLocales = new Set(localizations.map(l => l.locale))
  const missingLocales = availableLocales.filter(l => !existingLocales.has(l))
  const currentLocIsTranslating = translatingLocales.has(selectedLocale)

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[9999] p-4 backdrop-blur-sm">
      <div className="bg-[#1a1a1a] rounded-2xl border border-white/[0.08] w-full max-w-5xl max-h-[85vh] flex flex-col shadow-2xl">
        {/* Header */}
        <div className="p-4 border-b border-white/[0.08] flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-purple-500/20 text-purple-400">
              <Languages className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-white">{productName}</h2>
              <p className="text-xs text-neutral-500">{productType} &bull; {localizations.length} of {availableLocales.length} locales</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isPrimary && missingLocales.length > 0 && (
              <button
                onClick={handleTranslateAll}
                disabled={isTranslating}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium
                         bg-gradient-to-r from-purple-500 to-pink-500 text-white
                         hover:opacity-90 disabled:opacity-50 transition-all"
              >
                {isTranslating ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Sparkles className="w-4 h-4" />
                )}
                Translate All ({missingLocales.length})
              </button>
            )}
            <button
              onClick={onClose}
              className="p-2 rounded-lg text-neutral-400 hover:text-white hover:bg-white/[0.05] transition-all"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Alerts */}
        {error && (
          <div className="mx-4 mt-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm flex items-center gap-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            {error}
            <button onClick={() => setError(null)} className="ml-auto"><X className="w-3 h-3" /></button>
          </div>
        )}

        {success && (
          <div className="mx-4 mt-4 p-3 rounded-lg bg-green-500/10 border border-green-500/20 text-green-400 text-sm flex items-center gap-2">
            <Check className="w-4 h-4 flex-shrink-0" />
            {success}
          </div>
        )}

        {isLoading ? (
          <div className="flex-1 flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-purple-400" />
          </div>
        ) : (
          <div className="flex-1 flex overflow-hidden">
            {/* Left: Locale list */}
            <div className="w-56 border-r border-white/[0.08] flex flex-col bg-white/[0.01]">
              <div className="p-3 border-b border-white/[0.08]">
                <span className="text-xs text-neutral-500 font-medium uppercase tracking-wider">Languages</span>
                <p className="text-[10px] text-neutral-600 mt-1">Based on your metadata settings</p>
              </div>
              <div className="flex-1 overflow-y-auto">
                {/* Existing locales */}
                {localizations
                  .sort((a, b) => {
                    if (a.locale === primaryLocale) return -1
                    if (b.locale === primaryLocale) return 1
                    return (LOCALE_NAMES[a.locale] || a.locale).localeCompare(LOCALE_NAMES[b.locale] || b.locale)
                  })
                  .map(loc => {
                    const isSelected = loc.locale === selectedLocale
                    const isTranslatingThis = translatingLocales.has(loc.locale)
                    const isPrimaryLoc = loc.locale === primaryLocale

                    return (
                      <button
                        key={loc.locale}
                        onClick={() => handleLocaleSelect(loc.locale)}
                        className={`w-full flex items-center gap-2 px-3 py-2.5 text-left transition-all border-l-2 ${
                          isSelected
                            ? 'bg-purple-500/10 border-l-purple-500'
                            : isTranslatingThis
                            ? 'bg-blue-500/10 border-l-blue-500 animate-pulse'
                            : 'border-l-transparent hover:bg-white/[0.03]'
                        }`}
                      >
                        <span className="text-lg">{LOCALE_FLAGS[loc.locale] || '🌐'}</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className={`text-sm truncate ${isSelected ? 'text-white' : 'text-neutral-300'}`}>
                              {LOCALE_NAMES[loc.locale] || loc.locale}
                            </span>
                            {isPrimaryLoc && <Star className="w-3 h-3 text-amber-400 flex-shrink-0" />}
                          </div>
                          {isTranslatingThis && (
                            <span className="text-[10px] text-blue-400">Translating...</span>
                          )}
                        </div>
                        {isTranslatingThis && (
                          <Loader2 className="w-3 h-3 animate-spin text-blue-400 flex-shrink-0" />
                        )}
                      </button>
                    )
                  })}

                {/* Missing locales */}
                {missingLocales.length > 0 && (
                  <>
                    <div className="px-3 py-2 border-t border-white/[0.06]">
                      <span className="text-[10px] text-neutral-500 uppercase tracking-wider">Untranslated</span>
                    </div>
                    {missingLocales.slice(0, 10).map(locale => {
                      const isTranslatingThis = translatingLocales.has(locale)
                      return (
                        <div
                          key={locale}
                          className={`w-full flex items-center gap-2 px-3 py-2 text-left ${
                            isTranslatingThis ? 'bg-blue-500/5 animate-pulse' : ''
                          }`}
                        >
                          <span className="text-lg opacity-40">{LOCALE_FLAGS[locale] || '🌐'}</span>
                          <span className="text-sm text-neutral-500 truncate flex-1">
                            {LOCALE_NAMES[locale] || locale}
                          </span>
                          {isTranslatingThis ? (
                            <Loader2 className="w-3 h-3 animate-spin text-blue-400" />
                          ) : (
                            <button
                              onClick={() => handleTranslateLocale(locale)}
                              className="p-1 rounded text-neutral-600 hover:text-purple-400 hover:bg-purple-500/10 transition-all"
                              title="Translate"
                            >
                              <Sparkles className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      )
                    })}
                    {missingLocales.length > 10 && (
                      <div className="px-3 py-2 text-[10px] text-neutral-500">
                        +{missingLocales.length - 10} more
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>

            {/* Right: Editor */}
            <div className="flex-1 p-5 overflow-y-auto">
              <div className="max-w-xl">
                {/* Locale header */}
                <div className="flex items-center gap-3 mb-6">
                  <span className="text-2xl">{LOCALE_FLAGS[selectedLocale] || '🌐'}</span>
                  <div>
                    <h3 className="text-lg font-medium text-white">
                      {LOCALE_NAMES[selectedLocale] || selectedLocale}
                    </h3>
                    <p className="text-xs text-neutral-500">{selectedLocale}</p>
                  </div>
                  {isPrimary && (
                    <span className="px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 text-xs font-medium border border-amber-500/20">
                      Primary
                    </span>
                  )}
                  {!isPrimary && !existingLocales.has(selectedLocale) && (
                    <button
                      onClick={() => handleTranslateLocale(selectedLocale)}
                      disabled={currentLocIsTranslating}
                      className="ml-auto flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium
                               bg-gradient-to-r from-blue-500 to-cyan-500 text-white
                               hover:opacity-90 disabled:opacity-50 transition-all"
                    >
                      {currentLocIsTranslating ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Sparkles className="w-4 h-4" />
                      )}
                      Translate
                    </button>
                  )}
                </div>

                {/* Fields */}
                <div className="space-y-5">
                  <div>
                    <label className="flex items-center justify-between text-sm font-medium text-neutral-300 mb-2">
                      <span>Display Name</span>
                      <span className="text-neutral-500 font-normal">
                        {editDisplayName.length}/{IAP_LIMITS.displayName}
                      </span>
                    </label>
                    <input
                      type="text"
                      value={editDisplayName}
                      onChange={e => setEditDisplayName(e.target.value.slice(0, IAP_LIMITS.displayName))}
                      placeholder="Customer-facing name"
                      className="w-full px-4 py-3 rounded-xl bg-white/[0.03] border border-white/[0.08] text-white
                               placeholder:text-neutral-600 focus:outline-none focus:border-purple-500/50 transition-colors"
                    />
                    <p className="text-xs text-neutral-500 mt-1.5">
                      Shown to customers in the App Store and purchase dialogs.
                    </p>
                  </div>

                  <div>
                    <label className="flex items-center justify-between text-sm font-medium text-neutral-300 mb-2">
                      <span>Description</span>
                      <span className="text-neutral-500 font-normal">
                        {editDescription.length}/{IAP_LIMITS.description}
                      </span>
                    </label>
                    <textarea
                      value={editDescription}
                      onChange={e => setEditDescription(e.target.value.slice(0, IAP_LIMITS.description))}
                      placeholder="Brief description of what the purchase includes"
                      rows={2}
                      className="w-full px-4 py-3 rounded-xl bg-white/[0.03] border border-white/[0.08] text-white
                               placeholder:text-neutral-600 focus:outline-none focus:border-purple-500/50 resize-none transition-colors"
                    />
                    <p className="text-xs text-neutral-500 mt-1.5">
                      Appears below the display name in purchase sheets.
                    </p>
                  </div>
                </div>

                {/* Save button */}
                {hasChanges && (
                  <div className="mt-6 flex justify-end">
                    <button
                      onClick={handleSave}
                      disabled={isSaving}
                      className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium
                               bg-gradient-to-r from-purple-500 to-blue-500 text-white
                               hover:opacity-90 disabled:opacity-50 transition-all"
                    >
                      {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                      Save Changes
                    </button>
                  </div>
                )}

                {/* Re-translate option for existing translations */}
                {!isPrimary && existingLocales.has(selectedLocale) && (
                  <div className="mt-6 pt-6 border-t border-white/[0.08]">
                    <button
                      onClick={() => handleTranslateLocale(selectedLocale)}
                      disabled={currentLocIsTranslating}
                      className="flex items-center gap-2 text-sm text-neutral-400 hover:text-purple-400 transition-colors"
                    >
                      {currentLocIsTranslating ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <RefreshCw className="w-4 h-4" />
                      )}
                      Re-translate from primary
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
