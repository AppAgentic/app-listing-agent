'use client'

import { useState } from 'react'
import { X, Check, ChevronLeft, ChevronRight } from 'lucide-react'
import { GeneratedScreenshot, ScreenshotVariant } from '../WizardContext'

interface VariantComparisonProps {
  screenshot: GeneratedScreenshot
  onSelectVariant: (variantIndex: number) => void
  onClose: () => void
}

export function VariantComparison({
  screenshot,
  onSelectVariant,
  onClose,
}: VariantComparisonProps) {
  const [selectedIndex, setSelectedIndex] = useState(screenshot.selectedVariantIndex ?? 0)

  const allVariants = [
    { id: 'original', marketingImageUrl: screenshot.marketingImageUrl, styleVariation: 'Original' },
    ...(screenshot.variants || []),
  ]

  const handleConfirm = () => {
    onSelectVariant(selectedIndex)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/80" onClick={onClose} />

      {/* Modal */}
      <div className="relative w-full max-w-5xl max-h-[90vh] mx-4 bg-neutral-900 rounded-2xl border border-white/[0.08] shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-white/[0.08]">
          <div>
            <h3 className="text-lg font-semibold text-white">Compare Variants</h3>
            <p className="text-sm text-neutral-400">Select your preferred style variation</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-white/[0.05] transition-colors"
          >
            <X className="w-5 h-5 text-neutral-400" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* Side-by-side comparison */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {allVariants.map((variant, index) => {
              const isSelected = selectedIndex === index

              return (
                <button
                  key={variant.id}
                  onClick={() => setSelectedIndex(index)}
                  className={`
                    relative group rounded-xl overflow-hidden transition-all
                    ${isSelected
                      ? 'ring-2 ring-purple-500 ring-offset-2 ring-offset-neutral-900'
                      : 'hover:ring-2 hover:ring-white/20 hover:ring-offset-2 hover:ring-offset-neutral-900'
                    }
                  `}
                >
                  <div className="aspect-[9/19.5]">
                    <img
                      src={variant.marketingImageUrl}
                      alt={`Variant ${index}`}
                      className="w-full h-full object-cover"
                    />
                  </div>

                  {/* Overlay */}
                  <div className={`
                    absolute inset-0 flex items-center justify-center transition-opacity
                    ${isSelected ? 'bg-purple-500/20' : 'bg-black/0 group-hover:bg-black/30'}
                  `}>
                    {isSelected && (
                      <div className="w-12 h-12 rounded-full bg-purple-500 flex items-center justify-center">
                        <Check className="w-6 h-6 text-white" />
                      </div>
                    )}
                  </div>

                  {/* Label */}
                  <div className="absolute bottom-0 left-0 right-0 p-3 bg-gradient-to-t from-black/80 to-transparent">
                    <span className="text-sm font-medium text-white">
                      {index === 0 ? 'Original' : `Variant ${index}`}
                    </span>
                    <p className="text-xs text-neutral-400">{variant.styleVariation}</p>
                  </div>
                </button>
              )
            })}
          </div>

          {/* Navigation for mobile */}
          <div className="flex items-center justify-center gap-4 mt-6 lg:hidden">
            <button
              onClick={() => setSelectedIndex(Math.max(0, selectedIndex - 1))}
              disabled={selectedIndex === 0}
              className="p-2 rounded-lg bg-white/[0.05] disabled:opacity-50"
            >
              <ChevronLeft className="w-5 h-5 text-white" />
            </button>
            <span className="text-sm text-neutral-400">
              {selectedIndex + 1} of {allVariants.length}
            </span>
            <button
              onClick={() => setSelectedIndex(Math.min(allVariants.length - 1, selectedIndex + 1))}
              disabled={selectedIndex === allVariants.length - 1}
              className="p-2 rounded-lg bg-white/[0.05] disabled:opacity-50"
            >
              <ChevronRight className="w-5 h-5 text-white" />
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-4 border-t border-white/[0.08]">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-sm font-medium text-neutral-400 hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium
                     bg-gradient-to-r from-purple-500 to-blue-500 text-white
                     hover:opacity-90 transition-all"
          >
            <Check className="w-4 h-4" />
            Select Variant {selectedIndex === 0 ? '(Original)' : selectedIndex}
          </button>
        </div>
      </div>
    </div>
  )
}
