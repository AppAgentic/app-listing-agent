'use client'

import { CheckCircle2, Upload, Palette, Type, Eye, Sparkles } from 'lucide-react'
import { useWizard, WizardStep } from '../WizardContext'

const stepIcons: Record<WizardStep, React.ReactNode> = {
  upload: <Upload className="w-4 h-4" />,
  style: <Palette className="w-4 h-4" />,
  titles: <Type className="w-4 h-4" />,
  preview: <Eye className="w-4 h-4" />,
  generating: <Sparkles className="w-4 h-4" />,
  results: <Sparkles className="w-4 h-4" />,
}

export function StepIndicator() {
  const { steps, currentStepIndex, state } = useWizard()

  // Don't show generating step in indicator
  const visibleSteps = steps.filter(s => s.id !== 'generating')

  // Calculate progress percentage
  const progressPercent = ((currentStepIndex) / (visibleSteps.length)) * 100

  return (
    <div className="relative">
      {/* Progress bar background */}
      <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-white/[0.05]" />

      {/* Animated progress bar */}
      <div
        className="absolute bottom-0 left-0 h-0.5 bg-gradient-to-r from-purple-500 via-blue-500 to-purple-500 transition-all duration-500 ease-out"
        style={{ width: `${progressPercent}%` }}
      />

      {/* Steps container */}
      <div className="flex items-center justify-between px-6 py-4 bg-gradient-to-r from-white/[0.02] to-transparent">
        {visibleSteps.map((step, index) => {
          const actualIndex = steps.findIndex(s => s.id === step.id)
          const isComplete = actualIndex < currentStepIndex
          const isCurrent = actualIndex === currentStepIndex ||
            (state.currentStep === 'generating' && step.id === 'preview')
          const isLast = index === visibleSteps.length - 1

          return (
            <div key={step.id} className="flex items-center flex-1">
              {/* Step circle and label */}
              <div className="flex items-center gap-3">
                {/* Step indicator */}
                <div className={`relative group`}>
                  {/* Glow effect for current step */}
                  {isCurrent && (
                    <div className="absolute inset-0 rounded-full bg-purple-500/30 blur-md animate-pulse" />
                  )}

                  <div className={`relative w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold transition-all duration-300 ${
                    isComplete
                      ? 'bg-gradient-to-br from-green-400 to-green-600 text-white shadow-lg shadow-green-500/25'
                      : isCurrent
                      ? 'bg-gradient-to-br from-purple-500 to-blue-500 text-white shadow-lg shadow-purple-500/25'
                      : 'bg-white/[0.05] text-neutral-500 border border-white/[0.08]'
                  }`}>
                    {isComplete ? (
                      <CheckCircle2 className="w-5 h-5" />
                    ) : (
                      stepIcons[step.id]
                    )}
                  </div>
                </div>

                {/* Step text */}
                <div className="hidden md:flex flex-col">
                  <span className={`text-[10px] uppercase tracking-wider transition-colors ${
                    isComplete ? 'text-green-400' : isCurrent ? 'text-purple-400' : 'text-neutral-600'
                  }`}>
                    Step {index + 1}
                  </span>
                  <span className={`text-sm font-medium transition-colors ${
                    isComplete || isCurrent ? 'text-white' : 'text-neutral-500'
                  }`}>
                    {step.label}
                  </span>
                </div>
              </div>

              {/* Connector line */}
              {!isLast && (
                <div className="flex-1 mx-4 hidden sm:block">
                  <div className={`h-0.5 rounded-full transition-all duration-500 ${
                    isComplete
                      ? 'bg-gradient-to-r from-green-500 to-green-500/50'
                      : 'bg-white/[0.08]'
                  }`} />
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
