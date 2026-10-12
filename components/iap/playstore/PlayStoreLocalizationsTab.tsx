'use client'

import { useState, useEffect } from 'react'
import { Loader2 } from 'lucide-react'
import { PLAYSTORE_IAP_LIMITS } from '@/lib/constants'
import TranslationPanel from '../TranslationPanel'

interface Localization {
  locale: string
  title: string
  description: string
}

interface PlayStoreLocalizationsTabProps {
  projectId: string
  itemId: string
  itemType: 'product' | 'subscription'
  defaultLanguage: string
  enabledLocales: string[]
  onUpdated: () => void
}

export default function PlayStoreLocalizationsTab({
  projectId,
  itemId,
  itemType,
  defaultLanguage,
  enabledLocales,
  onUpdated,
}: PlayStoreLocalizationsTabProps) {
  const primaryLocale = defaultLanguage || 'en-US'
  const availableLocales = enabledLocales.length > 0 ? enabledLocales : [primaryLocale]

  const [isLoading, setIsLoading] = useState(true)
  const [localizations, setLocalizations] = useState<Localization[]>([])
  const [selectedLocale, setSelectedLocale] = useState<string>(primaryLocale)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const [fieldValues, setFieldValues] = useState<Record<string, string>>({
    title: '',
    description: '',
  })
  const [originalValues, setOriginalValues] = useState<Record<string, string>>({
    title: '',
    description: '',
  })
  const [isSaving, setIsSaving] = useState(false)
  const [isTranslating, setIsTranslating] = useState(false)
  const [translateProgress, setTranslateProgress] = useState<{ current: number; total: number } | null>(null)

  useEffect(() => {
    fetchLocalizations()
  }, [projectId, itemId])

  const fetchLocalizations = async () => {
    setIsLoading(true)
    setError(null)
    try {
      const response = await fetch(`/api/playstore-iap/${itemId}/localizations?projectId=${projectId}`)
      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to fetch localizations')
      }
      const data = await response.json()
      setLocalizations(data.localizations || [])

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
      title: loc?.title || '',
      description: loc?.description || '',
    }
    setFieldValues(values)
    setOriginalValues(values)
  }

  const handleFieldChange = (field: string, value: string) => {
    setFieldValues(prev => ({ ...prev, [field]: value }))
  }

  const hasChanges = JSON.stringify(fieldValues) !== JSON.stringify(originalValues)

  const handleSave = async () => {
    if (!selectedLocale) return
    setIsSaving(true)
    setError(null)
    try {
      const response = await fetch(`/api/playstore-iap/${itemId}/localizations`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          locale: selectedLocale,
          title: fieldValues.title,
          description: fieldValues.description,
        }),
      })
      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to save')
      }
      setSuccess('Saved successfully')
      setTimeout(() => setSuccess(null), 2000)

      setLocalizations(prev => {
        const existing = prev.find(l => l.locale === selectedLocale)
        if (existing) {
          return prev.map(l => l.locale === selectedLocale
            ? { ...l, title: fieldValues.title, description: fieldValues.description }
            : l
          )
        }
        return [...prev, { locale: selectedLocale, title: fieldValues.title, description: fieldValues.description }]
      })
      setOriginalValues({ ...fieldValues })
      onUpdated()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setIsSaving(false)
    }
  }

  const handleTranslate = async (targetLocales: string[], force: boolean) => {
    const primaryLoc = localizations.find(l => l.locale === primaryLocale)
    if (!primaryLoc || (!primaryLoc.title && !primaryLoc.description)) {
      setError('Please set the primary locale content first')
      return
    }

    setIsTranslating(true)
    setTranslateProgress({ current: 0, total: targetLocales.length })
    setError(null)

    try {
      const response = await fetch('/api/playstore-iap/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          itemId,
          itemType,
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
      setSuccess(`Translated to ${data.summary?.translated || targetLocales.length} locales${data.summary?.fromCache > 0 ? ` (${data.summary.fromCache} cached)` : ''}`)
      setTimeout(() => setSuccess(null), 3000)
      onUpdated()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Translation failed')
    } finally {
      setIsTranslating(false)
      setTranslateProgress(null)
    }
  }

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-purple-400" />
      </div>
    )
  }

  const localizationsForPanel = localizations.map(l => ({
    locale: l.locale,
    title: l.title,
    description: l.description,
  }))

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex-1 min-h-0">
        <TranslationPanel
          localizations={localizationsForPanel}
          primaryLocale={primaryLocale}
          enabledLocales={availableLocales}
          fields={[
            {
              key: 'title',
              label: 'Title',
              maxLength: PLAYSTORE_IAP_LIMITS.title,
              helpText: 'Product name shown on Google Play (max 55 characters)',
            },
            {
              key: 'description',
              label: 'Description',
              maxLength: PLAYSTORE_IAP_LIMITS.description,
              multiline: true,
              helpText: 'Short description shown below the title (max 80 characters)',
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
    </div>
  )
}
