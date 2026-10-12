'use client'

import { useState, useEffect } from 'react'
import { Eye, Grid2X2, Loader2, Smartphone, Palette, Type, Images, Sparkles, Check, Zap, ChevronRight } from 'lucide-react'
import { useWizard, APP_CATEGORIES, AppCategory } from '../WizardContext'
import { CreditBreakdown } from '../components/CreditBreakdown'
import { SCREENSHOT_DISPLAY_TYPES } from '@/lib/firebase/firestore'

interface PreviewStepProps {
  projectId: string
}

export function PreviewStep({ projectId }: PreviewStepProps) {
  const { state, dispatch } = useWizard()
  const [isLoadingCredits, setIsLoadingCredits] = useState(true)

  const deviceInfo = SCREENSHOT_DISPLAY_TYPES[state.displayType]
  const aspectRatio = deviceInfo.width / deviceInfo.height

  // Fetch credit estimate on mount
  useEffect(() => {
    fetchCreditEstimate()
  }, [state.generateVariants, state.variantCount])

  const fetchCreditEstimate = async () => {
    setIsLoadingCredits(true)

    try {
      const response = await fetch('/api/screenshots/check-credits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          operations: {
            screenshotGeneration: state.rawImages.length,
            variantGeneration: state.generateVariants ? state.rawImages.length * state.variantCount : 0,
            headlineSuggestions: 0,
          },
        }),
      })

      if (!response.ok) {
        throw new Error('Failed to check credits')
      }

      const data = await response.json()
      dispatch({ type: 'SET_CREDITS', credits: data.credits })
    } catch (error) {
      dispatch({
        type: 'SET_CREDITS',
        credits: {
          screenshotGeneration: state.rawImages.length,
          variantGeneration: state.generateVariants ? state.rawImages.length * state.variantCount : 0,
          headlineSuggestions: 0,
          total: state.rawImages.length + (state.generateVariants ? state.rawImages.length * state.variantCount : 0),
          remaining: 100,
          limit: 100,
          allowed: true,
          wouldExceedLimit: false,
          isOverage: false,
        },
      })
    } finally {
      setIsLoadingCredits(false)
    }
  }

  const handleGenerateVariantsToggle = (enabled: boolean) => {
    dispatch({ type: 'SET_GENERATE_VARIANTS', enabled })
  }

  const handleVariantCountChange = (count: 2 | 3 | 4) => {
    dispatch({ type: 'SET_VARIANT_COUNT', count })
  }

  const getStyleDescription = () => {
    if (!state.styleConfig) return 'Not configured'

    switch (state.styleConfig.type) {
      case 'match-existing':
        return 'Matching existing screenshots'
      case 'category':
        const category = state.styleConfig.category as AppCategory
        return category ? APP_CATEGORIES[category]?.label || 'Category template' : 'Category template'
      case 'reference':
        return 'Custom reference image'
      default:
        return 'Not configured'
    }
  }

  const getStyleColors = () => {
    if (!state.styleConfig || state.styleConfig.type !== 'category') return null
    const category = state.styleConfig.category as AppCategory
    return category ? APP_CATEGORIES[category]?.colors : null
  }

  const styleColors = getStyleColors()

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start gap-4">
        <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-purple-500/20 to-blue-500/20 flex items-center justify-center border border-purple-500/20">
          <Eye className="w-6 h-6 text-purple-400" />
        </div>
        <div>
          <h3 className="text-xl font-bold text-white mb-1">
            Review & Generate
          </h3>
          <p className="text-sm text-neutral-400">
            Review your settings before generating marketing screenshots.
          </p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Left column: Summary & Preview */}
        <div className="space-y-5">
          {/* Summary card */}
          <div className="p-5 rounded-2xl bg-gradient-to-br from-white/[0.03] to-transparent border border-white/[0.08]">
            <div className="flex items-center gap-3 mb-5">
              <div className="w-8 h-8 rounded-lg bg-purple-500/20 flex items-center justify-center">
                <Sparkles className="w-4 h-4 text-purple-400" />
              </div>
              <h4 className="text-sm font-semibold text-white">Generation Summary</h4>
            </div>

            <div className="space-y-4">
              {/* Screenshots count */}
              <div className="flex items-center gap-4 p-3 rounded-xl bg-white/[0.02]">
                <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
                  <Images className="w-5 h-5 text-blue-400" />
                </div>
                <div className="flex-1">
                  <span className="text-xs text-neutral-500 block">Screenshots</span>
                  <span className="text-sm font-semibold text-white">{state.rawImages.length} images</span>
                </div>
                <div className="text-xs text-neutral-500 px-2.5 py-1 rounded-lg bg-white/[0.05]">
                  {state.rawImages.length} credit{state.rawImages.length !== 1 ? 's' : ''}
                </div>
              </div>

              {/* Device type */}
              <div className="flex items-center gap-4 p-3 rounded-xl bg-white/[0.02]">
                <div className="w-10 h-10 rounded-lg bg-green-500/10 flex items-center justify-center">
                  <Smartphone className="w-5 h-5 text-green-400" />
                </div>
                <div className="flex-1">
                  <span className="text-xs text-neutral-500 block">Device</span>
                  <span className="text-sm font-semibold text-white">{deviceInfo.name}</span>
                </div>
                <span className="text-xs text-neutral-500">
                  {deviceInfo.width} × {deviceInfo.height}
                </span>
              </div>

              {/* Style */}
              <div className="flex items-center gap-4 p-3 rounded-xl bg-white/[0.02]">
                <div className="w-10 h-10 rounded-lg bg-purple-500/10 flex items-center justify-center">
                  <Palette className="w-5 h-5 text-purple-400" />
                </div>
                <div className="flex-1">
                  <span className="text-xs text-neutral-500 block">Style</span>
                  <span className="text-sm font-semibold text-white">{getStyleDescription()}</span>
                </div>
                {styleColors && (
                  <div className="flex items-center gap-1">
                    <div
                      className="w-5 h-5 rounded"
                      style={{ backgroundColor: styleColors.primary }}
                    />
                    <div
                      className="w-5 h-5 rounded"
                      style={{ backgroundColor: styleColors.secondary }}
                    />
                  </div>
                )}
              </div>

              {/* Headlines */}
              <div className="flex items-center gap-4 p-3 rounded-xl bg-white/[0.02]">
                <div className="w-10 h-10 rounded-lg bg-yellow-500/10 flex items-center justify-center">
                  <Type className="w-5 h-5 text-yellow-400" />
                </div>
                <div className="flex-1">
                  <span className="text-xs text-neutral-500 block">Headlines</span>
                  <span className="text-sm font-semibold text-white">
                    {state.confirmedHeadlines.size}/{state.rawImages.length} configured
                  </span>
                </div>
                {state.confirmedHeadlines.size === state.rawImages.length && (
                  <div className="w-6 h-6 rounded-full bg-green-500 flex items-center justify-center">
                    <Check className="w-3.5 h-3.5 text-white" />
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Preview grid */}
          <div>
            <div className="flex items-center gap-2 mb-4">
              <Images className="w-4 h-4 text-purple-400" />
              <h4 className="text-sm font-semibold text-white">Screenshots to Generate</h4>
            </div>
            <div className="grid grid-cols-4 gap-3">
              {state.rawImages.slice(0, 8).map((image, index) => {
                const headline = state.confirmedHeadlines.get(image.id)
                return (
                  <div key={image.id} className="group relative">
                    <div
                      className="rounded-xl overflow-hidden border border-white/[0.1] bg-white/[0.02] transition-transform group-hover:scale-105"
                      style={{ aspectRatio: `${aspectRatio}` }}
                    >
                      <img
                        src={image.url}
                        alt={`Screenshot ${index + 1}`}
                        className="w-full h-full object-cover"
                      />
                      {/* Headline overlay on hover */}
                      <div className="absolute inset-0 bg-black/70 opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-2">
                        <p className="text-[10px] text-white line-clamp-2">
                          {headline || 'No headline'}
                        </p>
                      </div>
                    </div>
                    {/* Position badge */}
                    <div className="absolute -top-1.5 -left-1.5 w-5 h-5 rounded-full bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center text-[10px] font-bold text-white shadow-lg">
                      {index + 1}
                    </div>
                  </div>
                )
              })}
              {state.rawImages.length > 8 && (
                <div
                  className="rounded-xl border border-white/[0.1] bg-white/[0.02] flex items-center justify-center"
                  style={{ aspectRatio: `${aspectRatio}` }}
                >
                  <span className="text-sm font-semibold text-neutral-400">
                    +{state.rawImages.length - 8}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right column: Options & Credits */}
        <div className="space-y-5">
          {/* Variant generation option */}
          <div className="p-5 rounded-2xl bg-gradient-to-br from-white/[0.03] to-transparent border border-white/[0.08]">
            <div className="flex items-center gap-3 mb-5">
              <div className="w-8 h-8 rounded-lg bg-purple-500/20 flex items-center justify-center">
                <Grid2X2 className="w-4 h-4 text-purple-400" />
              </div>
              <h4 className="text-sm font-semibold text-white">Variant Generation</h4>
              <span className="text-[10px] px-2 py-0.5 bg-blue-500/20 text-blue-400 rounded-full font-medium">Optional</span>
            </div>

            <label className="flex items-center gap-4 p-4 rounded-xl bg-white/[0.02] border border-white/[0.05] cursor-pointer group hover:border-purple-500/30 transition-colors">
              <div className="relative">
                <input
                  type="checkbox"
                  checked={state.generateVariants}
                  onChange={(e) => handleGenerateVariantsToggle(e.target.checked)}
                  className="sr-only"
                />
                <div className={`w-12 h-7 rounded-full transition-colors ${
                  state.generateVariants ? 'bg-purple-500' : 'bg-white/[0.1]'
                }`}>
                  <div className={`w-5 h-5 rounded-full bg-white absolute top-1 transition-transform shadow-lg ${
                    state.generateVariants ? 'translate-x-6' : 'translate-x-1'
                  }`} />
                </div>
              </div>
              <div className="flex-1">
                <span className="text-sm font-semibold text-white block">Generate variants</span>
                <p className="text-xs text-neutral-500">Create multiple style variations for each screenshot</p>
              </div>
            </label>

            {state.generateVariants && (
              <div className="mt-4 animate-fade-in">
                <label className="text-xs text-neutral-500 mb-3 block">
                  Variants per screenshot
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {([2, 3, 4] as const).map(count => (
                    <button
                      key={count}
                      onClick={() => handleVariantCountChange(count)}
                      className={`
                        relative py-3 px-4 rounded-xl text-sm font-semibold transition-all
                        ${state.variantCount === count
                          ? 'bg-gradient-to-br from-purple-500/20 to-blue-500/10 border-2 border-purple-500/50 text-white'
                          : 'bg-white/[0.03] border border-white/[0.08] text-neutral-400 hover:text-white hover:border-white/[0.15]'
                        }
                      `}
                    >
                      {count}
                      {state.variantCount === count && (
                        <div className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-purple-500 flex items-center justify-center">
                          <Check className="w-2.5 h-2.5 text-white" />
                        </div>
                      )}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-2 mt-3 text-xs text-neutral-500">
                  <Zap className="w-3.5 h-3.5 text-yellow-400" />
                  <span>Total: <strong className="text-white">{state.rawImages.length * state.variantCount}</strong> variant images</span>
                </div>
              </div>
            )}
          </div>

          {/* Credit breakdown */}
          <CreditBreakdown
            credits={state.credits}
            isLoading={isLoadingCredits}
          />

          {/* What happens next */}
          <div className="p-5 rounded-2xl bg-gradient-to-br from-blue-500/5 to-purple-500/5 border border-blue-500/10">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-8 h-8 rounded-lg bg-blue-500/20 flex items-center justify-center">
                <Sparkles className="w-4 h-4 text-blue-400" />
              </div>
              <h4 className="text-sm font-semibold text-white">What happens next</h4>
            </div>
            <div className="space-y-2.5">
              {[
                'AI will generate marketing screenshots with your chosen style',
                'Each screenshot will have your headlines overlaid',
                state.generateVariants ? "You'll be able to compare and select your favorite variants" : null,
                'Review and save to your project',
              ].filter(Boolean).map((step, index) => (
                <div key={index} className="flex items-start gap-3">
                  <div className="w-5 h-5 rounded-full bg-white/[0.05] flex items-center justify-center flex-shrink-0 mt-0.5">
                    <span className="text-[10px] font-bold text-neutral-400">{index + 1}</span>
                  </div>
                  <p className="text-sm text-neutral-400">{step}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
