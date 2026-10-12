'use client'

import { useState } from 'react'
import {
  CheckCircle,
  RefreshCw,
  Grid2X2,
  Trash2,
  Loader2,
  Sparkles,
  PartyPopper,
  Download,
  ExternalLink,
  X
} from 'lucide-react'
import { useWizard, GeneratedScreenshot } from '../WizardContext'
import { VariantComparison } from '../components/VariantComparison'
import { SCREENSHOT_DISPLAY_TYPES } from '@/lib/firebase/firestore'

interface ResultsStepProps {
  projectId: string
  onComplete: () => void
}

export function ResultsStep({ projectId, onComplete }: ResultsStepProps) {
  const { state, dispatch } = useWizard()
  const [comparingScreenshot, setComparingScreenshot] = useState<GeneratedScreenshot | null>(null)
  const [regeneratingId, setRegeneratingId] = useState<string | null>(null)
  const [savingToProject, setSavingToProject] = useState(false)
  const [selectedForAction, setSelectedForAction] = useState<string | null>(null)

  const deviceInfo = SCREENSHOT_DISPLAY_TYPES[state.displayType]
  const aspectRatio = deviceInfo.width / deviceInfo.height

  const handleSelectVariant = (screenshotId: string, variantIndex: number) => {
    dispatch({ type: 'SELECT_VARIANT', screenshotId, variantIndex })
    setComparingScreenshot(null)
  }

  const handleRegenerate = async (screenshotId: string) => {
    setRegeneratingId(screenshotId)

    try {
      const screenshot = state.generatedScreenshots.find(s => s.id === screenshotId)
      if (!screenshot) return

      const response = await fetch('/api/screenshots/regenerate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          displayType: state.displayType,
          screenshotId,
          rawImageUrl: screenshot.rawImageUrl,
          headline: screenshot.headline,
          styleConfig: state.styleConfig,
        }),
      })

      if (!response.ok) {
        throw new Error('Failed to regenerate')
      }

      const data = await response.json()
      dispatch({
        type: 'UPDATE_GENERATED_SCREENSHOT',
        id: screenshotId,
        updates: {
          marketingImageUrl: data.screenshot.marketingImageUrl,
          marketingImageKey: data.screenshot.marketingImageKey,
        },
      })
    } catch (error) {
      dispatch({
        type: 'SET_ERROR',
        error: 'Failed to regenerate screenshot. Please try again.',
      })
    } finally {
      setRegeneratingId(null)
    }
  }

  const handleGenerateVariants = async (screenshotId: string) => {
    setRegeneratingId(screenshotId)

    try {
      const screenshot = state.generatedScreenshots.find(s => s.id === screenshotId)
      if (!screenshot) return

      const response = await fetch('/api/screenshots/generate-variants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          displayType: state.displayType,
          screenshotId,
          rawImageUrl: screenshot.rawImageUrl,
          headline: screenshot.headline,
          variantCount: 3,
        }),
      })

      if (!response.ok) {
        throw new Error('Failed to generate variants')
      }

      const data = await response.json()
      dispatch({
        type: 'UPDATE_GENERATED_SCREENSHOT',
        id: screenshotId,
        updates: {
          variants: data.variants,
        },
      })

      const updatedScreenshot = {
        ...screenshot,
        variants: data.variants,
      }
      setComparingScreenshot(updatedScreenshot)
    } catch (error) {
      dispatch({
        type: 'SET_ERROR',
        error: 'Failed to generate variants. Please try again.',
      })
    } finally {
      setRegeneratingId(null)
    }
  }

  const handleDelete = (screenshotId: string) => {
    dispatch({
      type: 'SET_GENERATED_SCREENSHOTS',
      screenshots: state.generatedScreenshots.filter(s => s.id !== screenshotId),
    })
    setSelectedForAction(null)
  }

  const handleSaveToProject = async () => {
    setSavingToProject(true)
    dispatch({ type: 'SET_ERROR', error: null })

    try {
      onComplete()
    } catch (error) {
      dispatch({
        type: 'SET_ERROR',
        error: 'Failed to save to project. Please try again.',
      })
    } finally {
      setSavingToProject(false)
    }
  }

  const getDisplayedImageUrl = (screenshot: GeneratedScreenshot) => {
    if (screenshot.selectedVariantIndex !== undefined && screenshot.selectedVariantIndex > 0) {
      const variant = screenshot.variants?.[screenshot.selectedVariantIndex - 1]
      return variant?.marketingImageUrl || screenshot.marketingImageUrl
    }
    return screenshot.marketingImageUrl
  }

  return (
    <div className="space-y-8">
      {/* Success header */}
      <div className="relative text-center py-6">
        {/* Animated background glow */}
        <div className="absolute inset-0 flex items-center justify-center overflow-hidden">
          <div className="w-80 h-80 bg-green-500/10 rounded-full blur-3xl animate-pulse" />
          <div className="absolute w-60 h-60 bg-blue-500/10 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '0.5s' }} />
        </div>

        <div className="relative z-10">
          {/* Icon with confetti */}
          <div className="relative inline-flex mb-6">
            <div className="absolute inset-0 rounded-full bg-gradient-to-r from-green-500 to-emerald-500 blur-xl opacity-50 animate-pulse" />
            <div className="relative w-20 h-20 rounded-full bg-gradient-to-br from-green-500 to-emerald-500 flex items-center justify-center shadow-2xl shadow-green-500/30">
              <CheckCircle className="w-10 h-10 text-white" />
            </div>
            {/* Decorative sparkles */}
            <div className="absolute -top-2 -right-2">
              <Sparkles className="w-6 h-6 text-yellow-400 animate-bounce" />
            </div>
            <div className="absolute -bottom-1 -left-3">
              <PartyPopper className="w-5 h-5 text-purple-400" style={{ animationDelay: '0.3s' }} />
            </div>
          </div>

          <h3 className="text-2xl font-bold text-white mb-2">
            Screenshots Generated!
          </h3>
          <p className="text-neutral-400 max-w-md mx-auto">
            <span className="text-green-400 font-semibold">{state.generatedScreenshots.length}</span> marketing screenshots are ready for your app
          </p>
        </div>
      </div>

      {/* Screenshot grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-5">
        {state.generatedScreenshots.map((screenshot, index) => {
          const isRegenerating = regeneratingId === screenshot.id
          const hasVariants = screenshot.variants && screenshot.variants.length > 0
          const isSelected = selectedForAction === screenshot.id

          return (
            <div
              key={screenshot.id}
              className={`
                group relative rounded-2xl overflow-hidden transition-all duration-300
                ${isSelected ? 'ring-2 ring-purple-500 ring-offset-2 ring-offset-[#0a0a0a]' : ''}
              `}
              onClick={() => setSelectedForAction(isSelected ? null : screenshot.id)}
            >
              {/* Image container */}
              <div
                className="relative bg-white/[0.02] border border-white/[0.1] rounded-2xl overflow-hidden"
                style={{ aspectRatio: `${aspectRatio}` }}
              >
                {isRegenerating ? (
                  <div className="w-full h-full flex flex-col items-center justify-center gap-3 bg-black/50">
                    <div className="relative">
                      <div className="absolute inset-0 rounded-full bg-purple-500/30 blur-lg animate-pulse" />
                      <Loader2 className="relative w-10 h-10 animate-spin text-purple-400" />
                    </div>
                    <span className="text-xs text-neutral-400">Processing...</span>
                  </div>
                ) : (
                  <img
                    src={getDisplayedImageUrl(screenshot)}
                    alt={`Screenshot ${index + 1}`}
                    className="w-full h-full object-cover"
                  />
                )}

                {/* Hover overlay with actions */}
                <div className={`
                  absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent
                  transition-opacity flex flex-col justify-end p-4
                  ${isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}
                `}>
                  {/* Action buttons */}
                  <div className="flex items-center justify-center gap-2">
                    <button
                      onClick={(e) => { e.stopPropagation(); handleRegenerate(screenshot.id) }}
                      disabled={isRegenerating}
                      className="p-2.5 bg-white/10 hover:bg-white/20 backdrop-blur-sm rounded-xl transition-all group/btn"
                      title="Regenerate"
                    >
                      <RefreshCw className={`w-4 h-4 text-white ${isRegenerating ? 'animate-spin' : 'group-hover/btn:rotate-180 transition-transform duration-300'}`} />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); hasVariants ? setComparingScreenshot(screenshot) : handleGenerateVariants(screenshot.id) }}
                      disabled={isRegenerating}
                      className="p-2.5 bg-white/10 hover:bg-purple-500/50 backdrop-blur-sm rounded-xl transition-all"
                      title={hasVariants ? 'Compare Variants' : 'Generate Variants'}
                    >
                      <Grid2X2 className="w-4 h-4 text-white" />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDelete(screenshot.id) }}
                      disabled={isRegenerating}
                      className="p-2.5 bg-white/10 hover:bg-red-500/50 backdrop-blur-sm rounded-xl transition-all"
                      title="Delete"
                    >
                      <Trash2 className="w-4 h-4 text-white" />
                    </button>
                  </div>
                </div>
              </div>

              {/* Position badge */}
              <div className="absolute top-3 left-3 w-7 h-7 rounded-full bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center shadow-lg shadow-purple-500/25">
                <span className="text-xs font-bold text-white">{index + 1}</span>
              </div>

              {/* Variant indicator */}
              {hasVariants && (
                <div className="absolute top-3 right-3 px-2.5 py-1 bg-purple-500/90 backdrop-blur-sm rounded-lg flex items-center gap-1.5 shadow-lg">
                  <Grid2X2 className="w-3 h-3 text-white" />
                  <span className="text-[10px] font-bold text-white">
                    {screenshot.variants!.length + 1}
                  </span>
                </div>
              )}

              {/* Selected variant badge */}
              {screenshot.selectedVariantIndex !== undefined && screenshot.selectedVariantIndex > 0 && (
                <div className="absolute bottom-3 right-3 px-2 py-0.5 bg-blue-500/80 backdrop-blur-sm rounded-lg">
                  <span className="text-[10px] font-medium text-white">
                    Variant {screenshot.selectedVariantIndex}
                  </span>
                </div>
              )}

              {/* Headline */}
              <div className="mt-3 px-1">
                <p className="text-xs text-neutral-400 truncate" title={screenshot.headline}>
                  {screenshot.headline}
                </p>
              </div>
            </div>
          )
        })}
      </div>

      {/* Action buttons */}
      <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-6">
        <button
          onClick={handleSaveToProject}
          disabled={savingToProject || state.generatedScreenshots.length === 0}
          className="group relative flex items-center gap-3 px-8 py-4 rounded-2xl text-base font-semibold
                   bg-gradient-to-r from-green-500 to-emerald-500 text-white
                   hover:shadow-xl hover:shadow-green-500/25 hover:scale-[1.02]
                   disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 disabled:hover:shadow-none
                   transition-all duration-300"
        >
          {/* Glow effect */}
          <div className="absolute inset-0 rounded-2xl bg-gradient-to-r from-green-500 to-emerald-500 blur-xl opacity-0 group-hover:opacity-50 transition-opacity" />

          <span className="relative flex items-center gap-3">
            {savingToProject ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <CheckCircle className="w-5 h-5" />
                Save to Project
              </>
            )}
          </span>
        </button>

        {state.generatedScreenshots.length > 0 && (
          <button
            onClick={() => {
              // Download all screenshots
              state.generatedScreenshots.forEach((screenshot, index) => {
                const link = document.createElement('a')
                link.href = getDisplayedImageUrl(screenshot)
                link.download = `screenshot-${index + 1}.png`
                link.click()
              })
            }}
            className="flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-medium
                     bg-white/[0.05] text-white border border-white/[0.08]
                     hover:bg-white/[0.1] hover:border-white/[0.15] transition-all"
          >
            <Download className="w-4 h-4" />
            Download All
          </button>
        )}
      </div>

      {/* Tips section */}
      <div className="p-5 rounded-2xl bg-gradient-to-br from-blue-500/5 to-purple-500/5 border border-blue-500/10">
        <div className="flex items-center gap-3 mb-3">
          <Sparkles className="w-5 h-5 text-blue-400" />
          <h4 className="text-sm font-semibold text-white">Pro tips</h4>
        </div>
        <ul className="grid sm:grid-cols-2 gap-3 text-sm text-neutral-400">
          <li className="flex items-start gap-2">
            <span className="text-blue-400">•</span>
            <span>Click "Generate Variants" to create style alternatives</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-blue-400">•</span>
            <span>Use "Regenerate" if you want a fresh design</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-blue-400">•</span>
            <span>Screenshots are automatically saved to your project</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-blue-400">•</span>
            <span>You can edit or replace screenshots anytime</span>
          </li>
        </ul>
      </div>

      {/* Variant comparison modal */}
      {comparingScreenshot && (
        <VariantComparison
          screenshot={comparingScreenshot}
          onSelectVariant={(variantIndex) => handleSelectVariant(comparingScreenshot.id, variantIndex)}
          onClose={() => setComparingScreenshot(null)}
        />
      )}
    </div>
  )
}
