'use client'

import { useState, useEffect } from 'react'
import { Smartphone, Tablet, Watch, Upload, Lightbulb, Loader2, FolderOpen, Check, Image as ImageIcon } from 'lucide-react'
import { useWizard, RawImageData } from '../WizardContext'
import { DragDropUploader } from '../components/DragDropUploader'
import { SCREENSHOT_DISPLAY_TYPES } from '@/lib/firebase/firestore'

const DEVICE_ICONS: Record<string, React.ReactNode> = {
  'APP_IPHONE_69': <Smartphone className="w-5 h-5" />,
  'APP_IPHONE_65': <Smartphone className="w-5 h-5" />,
  'APP_IPHONE_63': <Smartphone className="w-5 h-5" />,
  'APP_IPHONE_61': <Smartphone className="w-5 h-5" />,
  'APP_IPHONE_55': <Smartphone className="w-5 h-5" />,
  'APP_IPAD_PRO_13': <Tablet className="w-5 h-5" />,
  'APP_IPAD_PRO_129': <Tablet className="w-5 h-5" />,
  'APP_IPAD_PRO_11': <Tablet className="w-5 h-5" />,
  'APP_WATCH_ULTRA_3': <Watch className="w-5 h-5" />,
  'APP_WATCH_ULTRA': <Watch className="w-5 h-5" />,
  'APP_WATCH_SERIES_10': <Watch className="w-5 h-5" />,
  'APP_WATCH_SERIES_7': <Watch className="w-5 h-5" />,
  'APP_WATCH_SERIES_4': <Watch className="w-5 h-5" />,
  'APP_WATCH_SERIES_3': <Watch className="w-5 h-5" />,
}

interface ExistingScreenshot {
  key: string
  url: string
  filename: string
  uploadedAt: string
}

interface UploadStepProps {
  projectId: string
}

export function UploadStep({ projectId }: UploadStepProps) {
  const { state, dispatch } = useWizard()
  const [existingScreenshots, setExistingScreenshots] = useState<ExistingScreenshot[]>([])
  const [isLoadingExisting, setIsLoadingExisting] = useState(false)
  const [showExisting, setShowExisting] = useState(false)
  const [selectedExisting, setSelectedExisting] = useState<Set<string>>(new Set())

  // Fetch existing screenshots when the panel is opened
  const fetchExistingScreenshots = async () => {
    if (existingScreenshots.length > 0) return // Already loaded

    setIsLoadingExisting(true)
    try {
      const response = await fetch(`/api/screenshots/list?projectId=${projectId}&category=raw`)
      if (response.ok) {
        const data = await response.json()
        setExistingScreenshots(data.screenshots || [])
      }
    } catch (error) {
      console.error('Failed to load existing screenshots:', error)
    } finally {
      setIsLoadingExisting(false)
    }
  }

  // Toggle existing screenshots panel
  const toggleExistingPanel = () => {
    if (!showExisting) {
      fetchExistingScreenshots()
    }
    setShowExisting(!showExisting)
  }

  // Toggle selection of an existing screenshot
  const toggleExistingSelection = (key: string) => {
    const newSelected = new Set(selectedExisting)
    if (newSelected.has(key)) {
      newSelected.delete(key)
    } else {
      newSelected.add(key)
    }
    setSelectedExisting(newSelected)
  }

  // Add selected existing screenshots to the wizard
  const addSelectedExisting = async () => {
    const selectedScreenshots = existingScreenshots.filter(s => selectedExisting.has(s.key))

    // Convert to RawImageData format
    // For existing screenshots, we create a "fake" file object since they're already uploaded
    const newImages: RawImageData[] = selectedScreenshots.map((screenshot, index) => ({
      id: `existing-${Date.now()}-${index}`,
      file: new File([], screenshot.filename), // Placeholder file
      url: screenshot.url, // Already a server URL
      name: screenshot.filename,
    }))

    dispatch({ type: 'ADD_RAW_IMAGES', images: newImages })
    setSelectedExisting(new Set())
    setShowExisting(false)
  }

  const handleImagesAdded = (images: RawImageData[]) => {
    dispatch({ type: 'ADD_RAW_IMAGES', images })
  }

  const handleImageRemoved = (imageId: string) => {
    dispatch({ type: 'REMOVE_RAW_IMAGE', imageId })
  }

  const handleImagesReordered = (images: RawImageData[]) => {
    dispatch({ type: 'REORDER_RAW_IMAGES', images })
  }

  const deviceInfo = SCREENSHOT_DISPLAY_TYPES[state.displayType]

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-start gap-4">
        <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-purple-500/20 to-blue-500/20 flex items-center justify-center border border-purple-500/20">
          <Upload className="w-6 h-6 text-purple-400" />
        </div>
        <div>
          <h3 className="text-xl font-bold text-white mb-1">
            Upload Your Screenshots
          </h3>
          <p className="text-sm text-neutral-400">
            Upload raw app screenshots that will be transformed into stunning marketing images.
          </p>
        </div>
      </div>

      {/* Device Type Info (read-only) */}
      <div className="flex items-center gap-4 p-4 rounded-xl bg-purple-500/10 border border-purple-500/20">
        <div className="w-10 h-10 rounded-lg bg-purple-500/20 flex items-center justify-center text-purple-400">
          {DEVICE_ICONS[state.displayType]}
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-white">{deviceInfo.name}</span>
            {deviceInfo.requirement === 'required' && (
              <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-blue-500/10 text-blue-400 border border-blue-500/20">
                Required
              </span>
            )}
          </div>
          <span className="text-xs text-neutral-400">{deviceInfo.width} × {deviceInfo.height}</span>
        </div>
      </div>

      {/* Use Existing Screenshots Button */}
      <div className="flex items-center gap-3">
        <button
          onClick={toggleExistingPanel}
          className={`
            flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all
            ${showExisting
              ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
              : 'bg-white/[0.05] text-neutral-300 border border-white/[0.08] hover:bg-white/[0.08] hover:border-white/[0.15]'
            }
          `}
        >
          <FolderOpen className="w-4 h-4" />
          Use Existing Screenshots
        </button>
        {existingScreenshots.length > 0 && !showExisting && (
          <span className="text-xs text-neutral-500">
            {existingScreenshots.length} available
          </span>
        )}
      </div>

      {/* Existing Screenshots Panel */}
      {showExisting && (
        <div className="p-5 rounded-2xl bg-white/[0.02] border border-white/[0.08] animate-fade-in">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-purple-500/20 flex items-center justify-center">
                <ImageIcon className="w-4 h-4 text-purple-400" />
              </div>
              <div>
                <h4 className="text-sm font-semibold text-white">Previously Uploaded</h4>
                <p className="text-xs text-neutral-500">Select screenshots to reuse</p>
              </div>
            </div>
            {selectedExisting.size > 0 && (
              <button
                onClick={addSelectedExisting}
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium bg-purple-500 hover:bg-purple-600 text-white transition-all"
              >
                <Check className="w-4 h-4" />
                Add {selectedExisting.size} Selected
              </button>
            )}
          </div>

          {isLoadingExisting ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 text-purple-400 animate-spin" />
            </div>
          ) : existingScreenshots.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="w-12 h-12 rounded-full bg-white/[0.05] flex items-center justify-center mb-3">
                <ImageIcon className="w-6 h-6 text-neutral-500" />
              </div>
              <p className="text-sm text-neutral-400">No existing screenshots found</p>
              <p className="text-xs text-neutral-500 mt-1">Upload new screenshots below</p>
            </div>
          ) : (
            <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 gap-3 max-h-64 overflow-y-auto scrollbar-dark">
              {existingScreenshots.map((screenshot) => {
                const isSelected = selectedExisting.has(screenshot.key)
                const isAlreadyAdded = state.rawImages.some(img => img.url === screenshot.url)

                return (
                  <button
                    key={screenshot.key}
                    onClick={() => !isAlreadyAdded && toggleExistingSelection(screenshot.key)}
                    disabled={isAlreadyAdded}
                    className={`
                      relative aspect-[9/19.5] rounded-xl overflow-hidden border-2 transition-all
                      ${isAlreadyAdded
                        ? 'opacity-40 cursor-not-allowed border-neutral-600'
                        : isSelected
                          ? 'border-purple-500 ring-2 ring-purple-500/30'
                          : 'border-white/[0.1] hover:border-white/[0.3]'
                      }
                    `}
                  >
                    <img
                      src={screenshot.url}
                      alt={screenshot.filename}
                      className="w-full h-full object-cover"
                    />
                    {isSelected && (
                      <div className="absolute inset-0 bg-purple-500/20 flex items-center justify-center">
                        <div className="w-8 h-8 rounded-full bg-purple-500 flex items-center justify-center">
                          <Check className="w-5 h-5 text-white" />
                        </div>
                      </div>
                    )}
                    {isAlreadyAdded && (
                      <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                        <span className="text-[10px] font-medium text-white bg-black/50 px-2 py-1 rounded">
                          Added
                        </span>
                      </div>
                    )}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Upload Area */}
      <DragDropUploader
        images={state.rawImages}
        displayType={state.displayType}
        onImagesAdded={handleImagesAdded}
        onImageRemoved={handleImageRemoved}
        onImagesReordered={handleImagesReordered}
      />

      {/* Tips */}
      <div className="p-5 rounded-2xl bg-gradient-to-br from-blue-500/5 to-purple-500/5 border border-blue-500/10">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-8 h-8 rounded-lg bg-blue-500/20 flex items-center justify-center">
            <Lightbulb className="w-4 h-4 text-blue-400" />
          </div>
          <h4 className="text-sm font-semibold text-white">Tips for best results</h4>
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          {[
            'Use high-quality screenshots without any overlays',
            'Screenshots should show your app\'s key features',
            'Portrait orientation works best for iPhone',
            'The order here will be the order in the App Store',
          ].map((tip, index) => (
            <div key={index} className="flex items-start gap-2.5">
              <div className="w-5 h-5 rounded-full bg-white/[0.05] flex items-center justify-center flex-shrink-0 mt-0.5">
                <span className="text-[10px] font-bold text-neutral-400">{index + 1}</span>
              </div>
              <p className="text-sm text-neutral-400">{tip}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
