'use client'

import { useState, useEffect } from 'react'
import {
  CheckCircle2,
  Circle,
  ChevronRight,
  Apple,
  Play,
  Globe,
  Upload,
  AlertCircle,
  CheckCircle,
  XCircle,
  Loader2,
  Eye
} from 'lucide-react'
import { LOCALE_NAMES, LOCALE_FLAGS } from '@/lib/constants'

interface PublishWizardProps {
  projectId: string
  availableLocales: string[]
  onComplete: () => void
  onCancel: () => void
}

type Step = 'stores' | 'locales' | 'preview' | 'publish' | 'results'

interface StoreSelection {
  appstore: boolean
  playstore: boolean
}

interface PreviewData {
  locale: string
  fields: Record<string, string>
  charCounts: Record<string, number>
}

interface PublishResult {
  locale: string
  success: boolean
  error?: string
}

interface PublishStats {
  total: number
  success: number
  failed: number
}

export function PublishWizard({
  projectId,
  availableLocales,
  onComplete,
  onCancel,
}: PublishWizardProps) {
  const [currentStep, setCurrentStep] = useState<Step>('stores')
  const [stores, setStores] = useState<StoreSelection>({ appstore: true, playstore: false })
  const [selectedLocales, setSelectedLocales] = useState<string[]>([])
  const [previewData, setPreviewData] = useState<PreviewData[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isPublishing, setIsPublishing] = useState(false)
  const [results, setResults] = useState<PublishResult[]>([])
  const [stats, setStats] = useState<PublishStats | null>(null)
  const [error, setError] = useState<string | null>(null)

  const steps: { id: Step; label: string }[] = [
    { id: 'stores', label: 'Select Stores' },
    { id: 'locales', label: 'Select Locales' },
    { id: 'preview', label: 'Preview' },
    { id: 'publish', label: 'Publish' },
    { id: 'results', label: 'Results' },
  ]

  const currentStepIndex = steps.findIndex(s => s.id === currentStep)

  // Toggle all locales
  const toggleAllLocales = () => {
    if (selectedLocales.length === availableLocales.length) {
      setSelectedLocales([])
    } else {
      setSelectedLocales([...availableLocales])
    }
  }

  // Toggle single locale
  const toggleLocale = (locale: string) => {
    if (selectedLocales.includes(locale)) {
      setSelectedLocales(selectedLocales.filter(l => l !== locale))
    } else {
      setSelectedLocales([...selectedLocales, locale])
    }
  }

  // Fetch preview data
  const fetchPreview = async () => {
    setIsLoading(true)
    setError(null)

    try {
      const response = await fetch('/api/metadata/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          store: stores.appstore ? 'appstore' : 'playstore',
          locales: selectedLocales,
          dryRun: true,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to fetch preview')
      }

      const data = await response.json()
      setPreviewData(data.preview || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setIsLoading(false)
    }
  }

  // Execute publish
  const executePublish = async () => {
    setIsPublishing(true)
    setError(null)

    try {
      const response = await fetch('/api/metadata/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          store: stores.appstore ? 'appstore' : 'playstore',
          locales: selectedLocales,
          dryRun: false,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to publish')
      }

      const data = await response.json()
      setResults(data.results || [])
      setStats(data.stats || null)
      setCurrentStep('results')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setIsPublishing(false)
    }
  }

  // Handle step navigation
  const goToNextStep = async () => {
    if (currentStep === 'stores') {
      setCurrentStep('locales')
    } else if (currentStep === 'locales') {
      setCurrentStep('preview')
      await fetchPreview()
    } else if (currentStep === 'preview') {
      setCurrentStep('publish')
    } else if (currentStep === 'publish') {
      await executePublish()
    }
  }

  const goToPrevStep = () => {
    const prevIndex = currentStepIndex - 1
    if (prevIndex >= 0) {
      setCurrentStep(steps[prevIndex].id)
    }
  }

  const canProceed = () => {
    if (currentStep === 'stores') {
      return stores.appstore || stores.playstore
    }
    if (currentStep === 'locales') {
      return selectedLocales.length > 0
    }
    return true
  }

  return (
    <div className="rounded-2xl bg-white/[0.02] border border-white/[0.08] overflow-hidden">
      {/* Step Indicators */}
      <div className="flex items-center justify-between p-4 border-b border-white/[0.08] bg-white/[0.02]">
        {steps.map((step, index) => (
          <div key={step.id} className="flex items-center">
            <div className="flex items-center gap-2">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                index < currentStepIndex
                  ? 'bg-green-500 text-white'
                  : index === currentStepIndex
                  ? 'bg-gradient-to-r from-purple-500 to-blue-500 text-white'
                  : 'bg-white/[0.05] text-neutral-500'
              }`}>
                {index < currentStepIndex ? (
                  <CheckCircle2 className="w-4 h-4" />
                ) : (
                  index + 1
                )}
              </div>
              <span className={`text-sm font-medium hidden md:block ${
                index <= currentStepIndex ? 'text-white' : 'text-neutral-500'
              }`}>
                {step.label}
              </span>
            </div>
            {index < steps.length - 1 && (
              <ChevronRight className="w-5 h-5 mx-2 text-neutral-600" />
            )}
          </div>
        ))}
      </div>

      {/* Content */}
      <div className="p-6">
        {/* Step 1: Select Stores */}
        {currentStep === 'stores' && (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-white mb-4">Select Target Stores</h3>
            <p className="text-sm text-neutral-400 mb-6">
              Choose which stores you want to publish your metadata to.
            </p>

            <div className="grid gap-4 md:grid-cols-2">
              <button
                onClick={() => setStores({ ...stores, appstore: !stores.appstore })}
                className={`p-6 rounded-xl border text-left transition-all ${
                  stores.appstore
                    ? 'border-blue-500/50 bg-blue-500/10'
                    : 'border-white/[0.08] bg-white/[0.02] hover:border-white/[0.15]'
                }`}
              >
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 rounded-xl bg-blue-500/20 flex items-center justify-center">
                    <Apple className="w-5 h-5 text-blue-400" />
                  </div>
                  <div className="font-semibold text-white">App Store Connect</div>
                </div>
                <p className="text-sm text-neutral-400">
                  Publish to Apple's App Store
                </p>
              </button>

              <button
                onClick={() => setStores({ ...stores, playstore: !stores.playstore })}
                className={`p-6 rounded-xl border text-left transition-all ${
                  stores.playstore
                    ? 'border-green-500/50 bg-green-500/10'
                    : 'border-white/[0.08] bg-white/[0.02] hover:border-white/[0.15]'
                }`}
              >
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 rounded-xl bg-green-500/20 flex items-center justify-center">
                    <Play className="w-5 h-5 text-green-400" />
                  </div>
                  <div className="font-semibold text-white">Google Play Console</div>
                </div>
                <p className="text-sm text-neutral-400">
                  Publish to Google Play Store
                </p>
              </button>
            </div>
          </div>
        )}

        {/* Step 2: Select Locales */}
        {currentStep === 'locales' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-lg font-semibold text-white">Select Locales</h3>
                <p className="text-sm text-neutral-400 mt-1">
                  Choose which locales to publish ({selectedLocales.length} selected)
                </p>
              </div>
              <button
                onClick={toggleAllLocales}
                className="text-sm text-purple-400 hover:text-purple-300"
              >
                {selectedLocales.length === availableLocales.length ? 'Deselect All' : 'Select All'}
              </button>
            </div>

            <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3 max-h-[400px] overflow-y-auto">
              {availableLocales.map(locale => (
                <button
                  key={locale}
                  onClick={() => toggleLocale(locale)}
                  className={`flex items-center gap-3 p-3 rounded-xl border text-left transition-all ${
                    selectedLocales.includes(locale)
                      ? 'border-purple-500/50 bg-purple-500/10'
                      : 'border-white/[0.08] bg-white/[0.02] hover:border-white/[0.15]'
                  }`}
                >
                  <span className="text-lg">{LOCALE_FLAGS[locale] || '🌐'}</span>
                  <div>
                    <div className="text-sm font-medium text-white">{locale}</div>
                    <div className="text-xs text-neutral-400">{LOCALE_NAMES[locale] || locale}</div>
                  </div>
                  {selectedLocales.includes(locale) && (
                    <CheckCircle2 className="w-4 h-4 ml-auto text-purple-400" />
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Step 3: Preview */}
        {currentStep === 'preview' && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 mb-4">
              <Eye className="w-5 h-5 text-purple-400" />
              <h3 className="text-lg font-semibold text-white">Preview Changes</h3>
            </div>

            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-6 h-6 animate-spin text-purple-400" />
                <span className="ml-3 text-neutral-400">Loading preview...</span>
              </div>
            ) : error ? (
              <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400">
                {error}
              </div>
            ) : (
              <div className="space-y-4 max-h-[400px] overflow-y-auto">
                {previewData.map(item => (
                  <div
                    key={item.locale}
                    className="p-4 rounded-xl bg-white/[0.02] border border-white/[0.08]"
                  >
                    <div className="flex items-center gap-2 mb-3">
                      <span className="text-lg">{LOCALE_FLAGS[item.locale] || '🌐'}</span>
                      <span className="font-medium text-white">{item.locale}</span>
                      <span className="text-sm text-neutral-500">{LOCALE_NAMES[item.locale]}</span>
                    </div>

                    <div className="grid gap-2 text-sm">
                      {Object.entries(item.fields).map(([key, value]) => (
                        <div key={key} className="flex justify-between">
                          <span className="text-neutral-400 capitalize">{key.replace(/([A-Z])/g, ' $1').trim()}:</span>
                          <span className="text-white truncate max-w-[200px]">{value}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Step 4: Confirm Publish */}
        {currentStep === 'publish' && (
          <div className="space-y-6">
            <div className="text-center py-8">
              <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-green-500/20 to-teal-500/20 border border-white/[0.08] flex items-center justify-center">
                <Upload className="w-8 h-8 text-green-400" />
              </div>
              <h3 className="text-xl font-semibold text-white mb-2">Ready to Publish</h3>
              <p className="text-neutral-400 max-w-md mx-auto">
                You are about to publish metadata for {selectedLocales.length} locale(s) to{' '}
                {stores.appstore && 'App Store Connect'}
                {stores.appstore && stores.playstore && ' and '}
                {stores.playstore && 'Google Play Console'}.
              </p>
            </div>

            <div className="p-4 rounded-xl bg-yellow-500/10 border border-yellow-500/20">
              <div className="flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-yellow-400 flex-shrink-0 mt-0.5" />
                <div className="text-sm text-yellow-400">
                  <strong>Important:</strong> This will overwrite the current metadata in the store.
                  Make sure you have reviewed all changes in the preview step.
                </div>
              </div>
            </div>

            {error && (
              <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400">
                {error}
              </div>
            )}
          </div>
        )}

        {/* Step 5: Results */}
        {currentStep === 'results' && (
          <div className="space-y-6">
            {stats && (
              <div className="text-center py-4">
                <div className={`w-16 h-16 mx-auto mb-4 rounded-2xl flex items-center justify-center ${
                  stats.failed === 0
                    ? 'bg-green-500/20 border border-green-500/30'
                    : 'bg-yellow-500/20 border border-yellow-500/30'
                }`}>
                  {stats.failed === 0 ? (
                    <CheckCircle className="w-8 h-8 text-green-400" />
                  ) : (
                    <AlertCircle className="w-8 h-8 text-yellow-400" />
                  )}
                </div>
                <h3 className="text-xl font-semibold text-white mb-2">
                  {stats.failed === 0 ? 'Publish Complete!' : 'Publish Completed with Errors'}
                </h3>
                <p className="text-neutral-400">
                  {stats.success} of {stats.total} locales published successfully
                </p>
              </div>
            )}

            <div className="space-y-2 max-h-[300px] overflow-y-auto">
              {results.map(result => (
                <div
                  key={result.locale}
                  className={`flex items-center justify-between p-3 rounded-xl border ${
                    result.success
                      ? 'bg-green-500/5 border-green-500/20'
                      : 'bg-red-500/5 border-red-500/20'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span className="text-lg">{LOCALE_FLAGS[result.locale] || '🌐'}</span>
                    <span className="font-medium text-white">{result.locale}</span>
                    <span className="text-sm text-neutral-500">{LOCALE_NAMES[result.locale]}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {result.success ? (
                      <CheckCircle className="w-5 h-5 text-green-400" />
                    ) : (
                      <>
                        <span className="text-sm text-red-400">{result.error}</span>
                        <XCircle className="w-5 h-5 text-red-400" />
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Footer Actions */}
      <div className="flex items-center justify-between p-4 border-t border-white/[0.08] bg-white/[0.02]">
        <button
          onClick={currentStep === 'results' ? onComplete : onCancel}
          className="px-4 py-2 rounded-xl text-sm font-medium text-neutral-400 hover:text-white transition-colors"
        >
          {currentStep === 'results' ? 'Done' : 'Cancel'}
        </button>

        <div className="flex items-center gap-3">
          {currentStep !== 'stores' && currentStep !== 'results' && (
            <button
              onClick={goToPrevStep}
              disabled={isPublishing}
              className="px-4 py-2 rounded-xl text-sm font-medium bg-white/[0.05] text-white
                       hover:bg-white/[0.1] disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              Back
            </button>
          )}

          {currentStep !== 'results' && (
            <button
              onClick={goToNextStep}
              disabled={!canProceed() || isLoading || isPublishing}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium
                       bg-gradient-to-r from-purple-500 to-blue-500 text-white
                       hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              {isPublishing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Publishing...
                </>
              ) : currentStep === 'publish' ? (
                <>
                  <Upload className="w-4 h-4" />
                  Publish Now
                </>
              ) : (
                'Continue'
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
