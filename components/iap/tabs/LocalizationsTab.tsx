'use client'

import { useState, useEffect } from 'react'
import {
  Loader2,
  AlertCircle,
  X,
  Info,
  Lock,
} from 'lucide-react'
import { IAP_LIMITS } from '@/lib/constants'
import { canEditField, getStateConfig } from '@/lib/iap/state-config'
import TranslationPanel from '../TranslationPanel'

interface Localization {
  locale: string
  displayName: string
  description: string
}

interface LocalizationsTabProps {
  projectId: string
  productId: string
  productType: 'iap' | 'subscription'
  productState: string | null
  primaryLocale: string
  enabledLocales: string[]
  onUpdated: () => void
}

export default function LocalizationsTab({
  projectId,
  productId,
  productType,
  productState,
  primaryLocale,
  enabledLocales,
  onUpdated,
}: LocalizationsTabProps) {
  const availableLocales = enabledLocales.length > 0 ? enabledLocales : ['en-US']

  // Check edit permissions based on state
  const canEdit = canEditField(productState, 'localizations')
  const stateConfig = getStateConfig(productState)

  // Determine API endpoints based on entity type
  const localizationsEndpoint = productType === 'subscription'
    ? `/api/subscriptions/${productId}/localizations`
    : `/api/iap/${productId}/localizations`

  const translateEndpoint = productType === 'subscription'
    ? '/api/subscriptions/translate'
    : '/api/iap/translate'

  const translateIdField = productType === 'subscription' ? 'subscriptionId' : 'iapId'

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

  useEffect(() => {
    fetchLocalizations()
  }, [projectId, productId])

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
    if (!canEdit) return
    setFieldValues(prev => ({
      ...prev,
      [field]: value,
    }))
  }

  const hasChanges = JSON.stringify(fieldValues) !== JSON.stringify(originalValues)

  const handleSave = async () => {
    if (!selectedLocale || !canEdit) return

    setIsSaving(true)
    setError(null)
    try {
      const response = await fetch(localizationsEndpoint, {
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
        throw new Error(data.error || 'Failed to save')
      }

      setSuccess('Saved successfully')
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
      onUpdated()
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
      const response = await fetch(translateEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          [translateIdField]: productId,
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

  // Convert localizations to TranslationPanel format
  const localizationsForPanel = localizations.map(l => ({
    locale: l.locale,
    displayName: l.displayName,
    description: l.description,
  }))

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* State-based edit restriction warning */}
      {!canEdit && (
        <div className="mx-4 mt-4 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 text-sm flex items-center gap-2">
          <Lock className="w-4 h-4 flex-shrink-0" />
          <div>
            <span className="font-medium">Editing restricted: </span>
            {stateConfig?.label ? (
              <>Product is {stateConfig.label.toLowerCase()}. Localizations cannot be modified in this state.</>
            ) : (
              <>Localizations cannot be modified in the current state.</>
            )}
          </div>
        </div>
      )}

      {/* Warning for approved products */}
      {canEdit && productState === 'APPROVED' && (
        <div className="mx-4 mt-4 p-3 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-400 text-sm flex items-center gap-2">
          <Info className="w-4 h-4 flex-shrink-0" />
          <div>
            <span className="font-medium">Note: </span>
            Changes to localizations on approved products will require re-review by Apple.
          </div>
        </div>
      )}

      {/* Translation Panel */}
      <div className="flex-1 min-h-0">
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
          disabled={!canEdit}
        />
      </div>
    </div>
  )
}
