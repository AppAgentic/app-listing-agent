'use client'

import { useEffect, useState, useRef } from 'react'
import { createPortal } from 'react-dom'
import { X, Loader2, Sparkles, ArrowLeft, ArrowRight, Rocket } from 'lucide-react'
import { WizardProvider, useWizard, GeneratedScreenshot } from './WizardContext'
import { StepIndicator } from './components/StepIndicator'
import { UploadStep } from './steps/UploadStep'
import { StyleStep } from './steps/StyleStep'
import { TitleStep } from './steps/TitleStep'
import { PreviewStep } from './steps/PreviewStep'
import { ResultsStep } from './steps/ResultsStep'
import type { ScreenshotDisplayType } from '@/lib/firebase/firestore'

interface ScreenshotWizardProps {
  projectId: string
  displayType: ScreenshotDisplayType
  existingScreenshotUrl?: string | null
  appMetadata?: {
    name: string
    description: string
    category?: string
  }
  onComplete: () => void
  onCancel: () => void
}

function WizardContent({
  projectId,
  appMetadata,
  onComplete,
  onCancel,
}: Omit<ScreenshotWizardProps, 'existingScreenshotUrl'>) {
  const { state, dispatch, goToNextStep, goToPrevStep, canProceed, currentStepIndex } = useWizard()
  const generationStartedRef = useRef(false)

  // Trigger generation when entering 'generating' step
  useEffect(() => {
    if (state.currentStep === 'generating' && !generationStartedRef.current) {
      generationStartedRef.current = true
      startGeneration()
    }
  }, [state.currentStep])

  // Reset the generation flag when leaving the generating step
  useEffect(() => {
    if (state.currentStep !== 'generating') {
      generationStartedRef.current = false
    }
  }, [state.currentStep])

  // Upload a single image file to get a server-accessible URL
  const uploadImage = async (file: File): Promise<string> => {
    const formData = new FormData()
    formData.append('file', file)
    formData.append('projectId', projectId)
    formData.append('category', 'raw-wizard')

    const response = await fetch('/api/upload', {
      method: 'POST',
      body: formData,
    })

    if (!response.ok) {
      throw new Error('Failed to upload image')
    }

    const data = await response.json()
    return data.url
  }

  const startGeneration = async () => {
    dispatch({ type: 'SET_GENERATION_PROGRESS', progress: 0, status: 'Preparing your screenshots...' })

    try {
      // First, upload all blob images to get server-accessible URLs
      dispatch({ type: 'SET_GENERATION_PROGRESS', progress: 5, status: 'Uploading images...' })

      const uploadedImages: { url: string; headline: string }[] = []
      const totalImages = state.rawImages.length

      for (let i = 0; i < state.rawImages.length; i++) {
        const img = state.rawImages[i]
        const progress = 5 + Math.round((i / totalImages) * 25) // 5% to 30%
        dispatch({
          type: 'SET_GENERATION_PROGRESS',
          progress,
          status: `Uploading image ${i + 1} of ${totalImages}...`,
        })

        let uploadedUrl: string

        // Check if this image already has a server URL (e.g., from "existing screenshots")
        // Server URLs start with http/https, while local blob URLs start with blob:
        const isExistingServerUrl = img.url.startsWith('http://') || img.url.startsWith('https://')

        if (isExistingServerUrl && img.file.size === 0) {
          // Already uploaded - use existing URL
          console.log(`[Wizard] Using existing server URL for image ${i + 1}`)
          uploadedUrl = img.url
        } else {
          // Upload the file to get a server-accessible URL
          console.log(`[Wizard] Uploading new file for image ${i + 1}: ${img.file.name}, size: ${img.file.size}`)
          uploadedUrl = await uploadImage(img.file)
        }

        uploadedImages.push({
          url: uploadedUrl,
          headline: state.confirmedHeadlines.get(img.id) || '',
        })
      }

      dispatch({ type: 'SET_GENERATION_PROGRESS', progress: 35, status: 'Analyzing screenshots for feature emphasis...' })

      // Build style config for API
      const styleConfig = {
        type: state.styleConfig?.type || 'category',
        category: state.styleConfig?.category,
        referenceImageUrl: state.styleConfig?.referenceImageUrl,
        customColors: state.styleConfig?.customColors,
        appStoreAppId: state.styleConfig?.appStoreAppId,
        appStoreAppName: state.styleConfig?.appStoreAppName,
      }

      const response = await fetch('/api/screenshots/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          displayType: state.displayType,
          rawImages: uploadedImages,
          styleConfig,
          locale: 'en-US',
          appMetadata: appMetadata ? {
            name: appMetadata.name,
            description: appMetadata.description,
          } : undefined,
        }),
      })

      dispatch({ type: 'SET_GENERATION_PROGRESS', progress: 70, status: 'Generating marketing screenshots...' })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || `Generation failed (${response.status})`)
      }

      const data = await response.json()

      dispatch({ type: 'SET_GENERATION_PROGRESS', progress: 90, status: 'Finalizing...' })

      // Transform the response into GeneratedScreenshot format
      const generatedScreenshots: GeneratedScreenshot[] = data.screenshotSet?.screenshots?.map((s: any, index: number) => ({
        id: s.id,
        position: s.position ?? index,
        rawImageUrl: s.rawImageUrl,
        rawImageKey: s.rawImageKey,
        marketingImageUrl: s.marketingImageUrl,
        marketingImageKey: s.marketingImageKey,
        headline: s.headline,
      })) || []

      dispatch({ type: 'SET_GENERATED_SCREENSHOTS', screenshots: generatedScreenshots })
      dispatch({ type: 'SET_GENERATION_PROGRESS', progress: 100, status: 'Complete!' })

      // Move to results step
      setTimeout(() => {
        dispatch({ type: 'SET_STEP', step: 'results' })
      }, 500)

    } catch (error) {
      console.error('Generation error:', error)
      dispatch({
        type: 'SET_ERROR',
        error: error instanceof Error ? error.message : 'Failed to generate screenshots',
      })
      // Go back to preview step on error
      dispatch({ type: 'SET_STEP', step: 'preview' })
    }
  }

  const renderStep = () => {
    switch (state.currentStep) {
      case 'upload':
        return <UploadStep projectId={projectId} />
      case 'style':
        return <StyleStep />
      case 'titles':
        return <TitleStep projectId={projectId} appMetadata={appMetadata} />
      case 'preview':
        return <PreviewStep projectId={projectId} />
      case 'generating':
        return (
          <div className="flex flex-col items-center justify-center py-20">
            {/* Animated background glow */}
            <div className="absolute inset-0 flex items-center justify-center overflow-hidden">
              <div className="w-96 h-96 bg-purple-500/10 rounded-full blur-3xl animate-pulse" />
              <div className="absolute w-64 h-64 bg-blue-500/10 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '0.5s' }} />
            </div>

            {/* Content */}
            <div className="relative z-10 flex flex-col items-center">
              {/* Animated icon */}
              <div className="relative mb-8">
                <div className="absolute inset-0 rounded-full bg-gradient-to-r from-purple-500 to-blue-500 blur-xl opacity-50 animate-pulse" />
                <div className="relative w-24 h-24 rounded-full bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center">
                  <Sparkles className="w-12 h-12 text-white animate-pulse" />
                </div>
              </div>

              <h3 className="text-2xl font-bold text-white mb-2">
                Creating Your Screenshots
              </h3>
              <p className="text-neutral-400 mb-8 text-center max-w-md">
                {state.generationStatus || 'AI is working its magic...'}
              </p>

              {/* Progress bar */}
              <div className="w-80 h-3 bg-white/[0.05] rounded-full overflow-hidden border border-white/[0.08]">
                <div
                  className="h-full bg-gradient-to-r from-purple-500 via-blue-500 to-purple-500 rounded-full transition-all duration-500 ease-out relative overflow-hidden"
                  style={{ width: `${state.generationProgress}%` }}
                >
                  {/* Shimmer effect */}
                  <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent animate-pulse" />
                </div>
              </div>

              <p className="text-sm text-neutral-500 mt-4">
                {Math.round(state.generationProgress)}% complete
              </p>
            </div>
          </div>
        )
      case 'results':
        return <ResultsStep projectId={projectId} onComplete={onComplete} />
      default:
        return null
    }
  }

  const getNextButtonText = () => {
    switch (state.currentStep) {
      case 'upload':
        return 'Choose Style'
      case 'style':
        return 'Add Titles'
      case 'titles':
        return 'Review & Generate'
      case 'preview':
        return 'Generate Screenshots'
      default:
        return 'Continue'
    }
  }

  const showFooter = state.currentStep !== 'generating' && state.currentStep !== 'results'

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      {/* Backdrop with blur */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-md"
        onClick={state.currentStep === 'results' ? onComplete : onCancel}
      />

      {/* Modal */}
      <div className="relative w-full max-w-4xl max-h-[90vh] bg-[#0a0a0a] rounded-3xl border border-white/[0.08] shadow-2xl overflow-hidden flex flex-col animate-fade-up">
        {/* Gradient accent at top */}
        <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-purple-500 to-transparent" />

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-white/[0.08] bg-gradient-to-r from-white/[0.02] to-transparent">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center shadow-lg shadow-purple-500/20">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">
                Screenshot Wizard
              </h2>
              <p className="text-xs text-neutral-500">
                Create stunning App Store screenshots with AI
              </p>
            </div>
          </div>
          <button
            onClick={state.currentStep === 'results' ? onComplete : onCancel}
            className="p-2.5 rounded-xl hover:bg-white/[0.05] border border-white/[0.08] transition-all group"
          >
            <X className="w-5 h-5 text-neutral-400 group-hover:text-white transition-colors" />
          </button>
        </div>

        {/* Step Indicator */}
        {state.currentStep !== 'generating' && state.currentStep !== 'results' && (
          <StepIndicator />
        )}

        {/* Content */}
        <div className="flex-1 overflow-y-auto scrollbar-dark">
          {state.error && (
            <div className="mx-6 mt-6 p-4 rounded-xl bg-red-500/10 border border-red-500/20 flex items-start gap-3 animate-fade-in">
              <div className="w-8 h-8 rounded-lg bg-red-500/20 flex items-center justify-center flex-shrink-0">
                <X className="w-4 h-4 text-red-400" />
              </div>
              <div>
                <p className="text-sm font-medium text-red-400">Something went wrong</p>
                <p className="text-xs text-red-400/70 mt-0.5">{state.error}</p>
              </div>
            </div>
          )}
          <div className="p-6">
            {renderStep()}
          </div>
        </div>

        {/* Footer */}
        {showFooter && (
          <div className="flex items-center justify-between px-6 py-4 border-t border-white/[0.08] bg-gradient-to-r from-white/[0.02] to-transparent">
            <button
              onClick={onCancel}
              className="px-4 py-2.5 rounded-xl text-sm font-medium text-neutral-400 hover:text-white hover:bg-white/[0.05] transition-all"
            >
              Cancel
            </button>

            <div className="flex items-center gap-3">
              {currentStepIndex > 0 && (
                <button
                  onClick={goToPrevStep}
                  disabled={state.isLoading}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium
                           bg-white/[0.05] text-white border border-white/[0.08]
                           hover:bg-white/[0.08] disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                >
                  <ArrowLeft className="w-4 h-4" />
                  Back
                </button>
              )}

              <button
                onClick={goToNextStep}
                disabled={!canProceed() || state.isLoading}
                className="group flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-semibold
                         bg-gradient-to-r from-purple-500 to-blue-500 text-white
                         hover:shadow-lg hover:shadow-purple-500/25 hover:scale-[1.02]
                         disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 disabled:hover:shadow-none
                         transition-all duration-200"
              >
                {state.isLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Processing...
                  </>
                ) : state.currentStep === 'preview' ? (
                  <>
                    <Rocket className="w-4 h-4" />
                    {getNextButtonText()}
                  </>
                ) : (
                  <>
                    {getNextButtonText()}
                    <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </div>

    </div>
  )
}

export function ScreenshotWizard(props: ScreenshotWizardProps) {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    return () => setMounted(false)
  }, [])

  // Use portal to render outside the stacking context of the sidebar
  if (!mounted) return null

  return createPortal(
    <WizardProvider
      existingScreenshotUrl={props.existingScreenshotUrl}
      displayType={props.displayType}
    >
      <WizardContent {...props} />
    </WizardProvider>,
    document.body
  )
}
