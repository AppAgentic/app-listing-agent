'use client'

import { useState, useEffect } from 'react'
import {
  X,
  Languages,
  Loader2,
  Check,
  AlertCircle,
  Globe,
} from 'lucide-react'
import { APPSTORE_LOCALES, LOCALE_NAMES, LOCALE_FLAGS, IAP_LIMITS } from '@/lib/constants'
import TranslationPanel from './TranslationPanel'

interface Localization {
  locale: string
  displayName: string
  description: string
}

interface LocalizationEditorProps {
  projectId: string
  iapId: string
  productName: string
  primaryLocale?: string
  enabledLocales?: string[]
  onClose: () => void
  onSaved: () => void
}

export default function LocalizationEditor({
  projectId,
  iapId,
  productName,
  primaryLocale = 'en-US',
  enabledLocales = [],
  onClose,
  onSaved,
}: LocalizationEditorProps) {
  const [isLoading, setIsLoading] = useState(true)
  const [localizations, setLocalizations] = useState<Localization[]>([])
  const [selectedLocale, setSelectedLocale] = useState<string>(primaryLocale)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  // Edit state
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({
    displayName: '',
    description: '',
  })
  const [originalValues, setOriginalValues] = useState<Record<string, string>>({
    displayName: '',
    description: '',
  })
  const [isSaving, setIsSaving] = useState(false)

  // Translation state
  const [isTranslating, setIsTranslating] = useState(false)
  const [translateProgress, setTranslateProgress] = useState<{ current: number; total: number } | null>(null)

  // Available locales - use enabled locales or fall back to all App Store locales
  const availableLocales: string[] = enabledLocales.length > 0 ? enabledLocales : [...APPSTORE_LOCALES]

  useEffect(() => {
    fetchLocalizations()
  }, [projectId, iapId])

  const fetchLocalizations = async () => {
    setIsLoading(true)
    setError(null)
    try {
      const response = await fetch(`/api/iap/${iapId}/localizations?projectId=${projectId}`)
      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to fetch localizations')
      }
      const data = await response.json()
      setLocalizations(data.localizations || [])

      // Select primary locale or first available
      const locales = data.localizations || []
      const targetLocale = locales.find((l: Localization) => l.locale === primaryLocale)?.locale ||
                          locales[0]?.locale ||
                          primaryLocale
      handleLocaleSelect(targetLocale, locales)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load localizations')
    } finally {
      setIsLoading(false)
    }
  }

  const handleLocaleSelect = (locale: string, locs?: Localization[]) => {
    const locsToUse = locs || localizations
    setSelectedLocale(locale)
    const loc = locsToUse.find(l => l.locale === locale)
    const values = {
      displayName: loc?.displayName || '',
      description: loc?.description || '',
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
    if (!selectedLocale) return

    setIsSaving(true)
    setError(null)
    try {
      const response = await fetch(`/api/iap/${iapId}/localizations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          locale: selectedLocale,
          displayName: fieldValues.displayName,
          description: fieldValues.description,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to save localization')
      }

      setSuccess('Localization saved')
      setTimeout(() => setSuccess(null), 2000)

      // Update local state
      setLocalizations(prev => {
        const existing = prev.find(l => l.locale === selectedLocale)
        if (existing) {
          return prev.map(l => l.locale === selectedLocale
            ? { ...l, displayName: fieldValues.displayName, description: fieldValues.description }
            : l
          )
        }
        return [...prev, {
          locale: selectedLocale,
          displayName: fieldValues.displayName,
          description: fieldValues.description,
        }]
      })
      setOriginalValues({ ...fieldValues })
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setIsSaving(false)
    }
  }

  const handleTranslate = async (targetLocales: string[], force: boolean) => {
    const primaryLoc = localizations.find(l => l.locale === primaryLocale)
    if (!primaryLoc || (!primaryLoc.displayName && !primaryLoc.description)) {
      setError('Please set the primary locale first')
      return
    }

    setIsTranslating(true)
    setTranslateProgress({ current: 0, total: targetLocales.length })
    setError(null)

    try {
      const response = await fetch('/api/iap/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          iapId,
          targetLocales,
          force,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to translate')
      }

      const data = await response.json()
      const results = data.translations || []
      setTranslateProgress({ current: targetLocales.length, total: targetLocales.length })

      setSuccess(`Translated to ${results.length} locales${data.summary?.fromCache > 0 ? ` (${data.summary.fromCache} cached)` : ''}`)
      setTimeout(() => setSuccess(null), 3000)

      // Refresh localizations
      await fetchLocalizations()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Translation failed')
    } finally {
      setIsTranslating(false)
      setTranslateProgress(null)
    }
  }

  // Convert localizations to TranslationPanel format
  const localizationsForPanel = localizations.map(l => ({
    locale: l.locale,
    displayName: l.displayName,
    description: l.description,
  }))

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[9999] p-4 backdrop-blur-sm">
      <div className="bg-[#1a1a1a] rounded-2xl border border-white/[0.08] w-full max-w-4xl max-h-[85vh] flex flex-col shadow-2xl">
        {/* Header */}
        <div className="p-4 border-b border-white/[0.08] flex items-center justify-between flex-shrink-0">
          <div>
            <h2 className="text-lg font-semibold text-white flex items-center gap-2">
              <Languages className="w-5 h-5 text-purple-400" />
              Localizations
            </h2>
            <p className="text-sm text-neutral-400 mt-0.5">{productName}</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-neutral-400 hover:text-white hover:bg-white/[0.05] transition-all"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        {isLoading ? (
          <div className="flex-1 flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-purple-400" />
          </div>
        ) : (
          <div className="flex-1 overflow-hidden">
            <TranslationPanel
              localizations={localizationsForPanel}
              primaryLocale={primaryLocale}
              enabledLocales={availableLocales}
              fields={[
                {
                  key: 'displayName',
                  label: 'Display Name',
                  maxLength: IAP_LIMITS.displayName,
                  helpText: 'Customer-facing product name shown in the App Store and purchase dialogs',
                },
                {
                  key: 'description',
                  label: 'Description',
                  maxLength: IAP_LIMITS.description,
                  multiline: true,
                  helpText: 'Brief description shown below the display name in purchase sheets',
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
        )}

        {/* Footer */}
        <div className="p-4 border-t border-white/[0.08] flex justify-between items-center flex-shrink-0">
          <div className="flex items-center gap-2 text-sm text-neutral-400">
            <Globe className="w-4 h-4" />
            {localizations.length} of {availableLocales.length} locales
          </div>
          <button
            onClick={() => {
              onSaved()
              onClose()
            }}
            className="px-4 py-2 rounded-lg text-sm font-medium text-neutral-400 hover:text-white transition-all"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
