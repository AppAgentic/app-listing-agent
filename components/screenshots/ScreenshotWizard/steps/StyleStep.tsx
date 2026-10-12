'use client'

import { useState, useRef, useEffect } from 'react'
import { Copy, Grid3X3, Upload, Check, Palette, AlertCircle, Sparkles, Image as ImageIcon, X, Store, Search, Loader2, Link, Bookmark, Trash2, Plus } from 'lucide-react'
import { useWizard, StyleConfig, AppCategory, APP_CATEGORIES } from '../WizardContext'

interface AppStoreScreenshot {
  url: string
  type: 'iphone' | 'ipad' | 'appletv'
}

interface AppStoreApp {
  id: number
  name: string
  iconUrl: string
  developer: string
  category: string
}

interface SavedStyle {
  id: string
  name: string
  imageUrl: string
  thumbnailUrl: string
  source: 'upload' | 'appstore' | 'url'
  appStoreAppId?: string
  appStoreAppName?: string
  createdAt: number
}

export function StyleStep() {
  const { state, dispatch } = useWizard()
  const [uploadedReference, setUploadedReference] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Saved styles state
  const [savedStyles, setSavedStyles] = useState<SavedStyle[]>([])
  const [isLoadingSavedStyles, setIsLoadingSavedStyles] = useState(false)
  const [isSavingStyle, setIsSavingStyle] = useState(false)
  const [saveStyleName, setSaveStyleName] = useState('')
  const [showSaveDialog, setShowSaveDialog] = useState(false)
  const [deletingStyleId, setDeletingStyleId] = useState<string | null>(null)
  const [selectedSavedStyle, setSelectedSavedStyle] = useState<SavedStyle | null>(null)

  // Reference URL state
  const [referenceUrlInput, setReferenceUrlInput] = useState('')
  const [referenceUrlError, setReferenceUrlError] = useState<string | null>(null)
  const [isLoadingUrl, setIsLoadingUrl] = useState(false)

  // App Store state
  const [appStoreUrl, setAppStoreUrl] = useState('')
  const [appStoreLoading, setAppStoreLoading] = useState(false)
  const [appStoreError, setAppStoreError] = useState<string | null>(null)
  const [appStoreApp, setAppStoreApp] = useState<AppStoreApp | null>(null)
  const [appStoreScreenshots, setAppStoreScreenshots] = useState<AppStoreScreenshot[]>([])
  const [selectedScreenshotUrl, setSelectedScreenshotUrl] = useState<string | null>(null)

  const hasExistingScreenshots = !!state.existingScreenshotUrl

  // Load saved styles on mount
  useEffect(() => {
    loadSavedStyles()
  }, [])

  const loadSavedStyles = async () => {
    setIsLoadingSavedStyles(true)
    try {
      const response = await fetch('/api/screenshots/styles')
      if (response.ok) {
        const data = await response.json()
        setSavedStyles(data.styles || [])
      }
    } catch (error) {
      console.error('Failed to load saved styles:', error)
    } finally {
      setIsLoadingSavedStyles(false)
    }
  }

  const saveCurrentStyle = async () => {
    if (!saveStyleName.trim() || !selectedScreenshotUrl || !appStoreApp) return

    setIsSavingStyle(true)
    try {
      const response = await fetch('/api/screenshots/styles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: saveStyleName.trim(),
          source: 'appstore',
          imageUrl: selectedScreenshotUrl,
          appStoreAppId: String(appStoreApp.id),
          appStoreAppName: appStoreApp.name,
        }),
      })

      if (response.ok) {
        const data = await response.json()
        setSavedStyles(prev => [data.style, ...prev])
        setShowSaveDialog(false)
        setSaveStyleName('')
      }
    } catch (error) {
      console.error('Failed to save style:', error)
    } finally {
      setIsSavingStyle(false)
    }
  }

  const deleteSavedStyle = async (styleId: string) => {
    setDeletingStyleId(styleId)
    try {
      const response = await fetch(`/api/screenshots/styles?styleId=${styleId}`, {
        method: 'DELETE',
      })

      if (response.ok) {
        setSavedStyles(prev => prev.filter(s => s.id !== styleId))
      }
    } catch (error) {
      console.error('Failed to delete style:', error)
    } finally {
      setDeletingStyleId(null)
    }
  }

  const selectSavedStyle = (style: SavedStyle) => {
    setSelectedScreenshotUrl(style.imageUrl)
    setSelectedSavedStyle(style)
    // Clear App Store search state when using saved style
    setAppStoreApp(null)
    setAppStoreScreenshots([])
    setAppStoreUrl('')
    dispatch({
      type: 'SET_STYLE_CONFIG',
      config: {
        type: 'appstore',
        referenceImageUrl: style.imageUrl,
        appStoreAppId: style.appStoreAppId,
        appStoreAppName: style.appStoreAppName || style.name,
      },
    })
  }

  const styleOptions: { id: StyleConfig['type']; label: string; description: string; icon: React.ReactNode; recommended?: boolean }[] = [
    ...(hasExistingScreenshots ? [{
      id: 'match-existing' as const,
      label: 'Match Existing Style',
      description: 'Use your existing screenshots as style reference for consistency',
      icon: <Copy className="w-5 h-5" />,
      recommended: true,
    }] : []),
    {
      id: 'category',
      label: 'Category Template',
      description: 'Choose from pre-designed styles based on app categories',
      icon: <Grid3X3 className="w-5 h-5" />,
      recommended: !hasExistingScreenshots,
    },
    {
      id: 'appstore',
      label: 'App Store Inspiration',
      description: 'Use a screenshot from any App Store app as style reference',
      icon: <Store className="w-5 h-5" />,
    },
    {
      id: 'reference',
      label: 'Custom Reference',
      description: 'Upload your own style reference image',
      icon: <Upload className="w-5 h-5" />,
    },
  ]

  const handleStyleTypeSelect = (type: StyleConfig['type']) => {
    if (type === 'match-existing' && state.existingScreenshotUrl) {
      dispatch({
        type: 'SET_STYLE_CONFIG',
        config: {
          type: 'match-existing',
          referenceImageUrl: state.existingScreenshotUrl,
        },
      })
    } else if (type === 'category') {
      // Default to first category
      const defaultCategory = Object.keys(APP_CATEGORIES)[0] as AppCategory
      dispatch({
        type: 'SET_STYLE_CONFIG',
        config: {
          type: 'category',
          category: defaultCategory,
          customColors: APP_CATEGORIES[defaultCategory].colors,
        },
      })
    } else if (type === 'appstore') {
      // If we have a selected screenshot, use it
      if (selectedScreenshotUrl && appStoreApp) {
        dispatch({
          type: 'SET_STYLE_CONFIG',
          config: {
            type: 'appstore',
            referenceImageUrl: selectedScreenshotUrl,
            appStoreAppId: String(appStoreApp.id),
            appStoreAppName: appStoreApp.name,
          },
        })
      } else {
        dispatch({
          type: 'SET_STYLE_CONFIG',
          config: {
            type: 'appstore',
          },
        })
      }
    } else if (type === 'reference') {
      if (uploadedReference) {
        dispatch({
          type: 'SET_STYLE_CONFIG',
          config: {
            type: 'reference',
            referenceImageUrl: uploadedReference,
          },
        })
      } else {
        dispatch({
          type: 'SET_STYLE_CONFIG',
          config: {
            type: 'reference',
          },
        })
      }
    }
  }

  const fetchAppStoreScreenshots = async () => {
    if (!appStoreUrl.trim()) return

    setAppStoreLoading(true)
    setAppStoreError(null)

    try {
      const response = await fetch('/api/itunes/screenshots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appIdOrUrl: appStoreUrl }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch app')
      }

      setAppStoreApp(data.app)
      setAppStoreScreenshots(data.screenshots)
      setSelectedScreenshotUrl(null)
    } catch (error) {
      setAppStoreError(error instanceof Error ? error.message : 'Failed to fetch app')
    } finally {
      setAppStoreLoading(false)
    }
  }

  const handleSelectAppStoreScreenshot = (url: string) => {
    setSelectedScreenshotUrl(url)
    setSelectedSavedStyle(null) // Clear saved style selection
    if (appStoreApp) {
      dispatch({
        type: 'SET_STYLE_CONFIG',
        config: {
          type: 'appstore',
          referenceImageUrl: url,
          appStoreAppId: String(appStoreApp.id),
          appStoreAppName: appStoreApp.name,
        },
      })
    }
  }

  const clearAppStoreSelection = () => {
    setAppStoreUrl('')
    setAppStoreApp(null)
    setAppStoreScreenshots([])
    setSelectedScreenshotUrl(null)
    dispatch({
      type: 'SET_STYLE_CONFIG',
      config: { type: 'appstore' },
    })
  }

  const handleCategorySelect = (category: AppCategory) => {
    dispatch({
      type: 'SET_STYLE_CONFIG',
      config: {
        type: 'category',
        category,
        customColors: APP_CATEGORIES[category].colors,
      },
    })
  }

  const handleReferenceUpload = (file: File) => {
    const url = URL.createObjectURL(file)
    setUploadedReference(url)
    dispatch({
      type: 'SET_STYLE_CONFIG',
      config: {
        type: 'reference',
        referenceImageUrl: url,
      },
    })
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handleReferenceUpload(file)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files?.[0]
    if (file && file.type.startsWith('image/')) {
      handleReferenceUpload(file)
    }
  }

  const clearReference = () => {
    setUploadedReference(null)
    setReferenceUrlInput('')
    setReferenceUrlError(null)
    dispatch({
      type: 'SET_STYLE_CONFIG',
      config: { type: 'reference' },
    })
  }

  const handleReferenceUrlSubmit = async () => {
    const url = referenceUrlInput.trim()
    if (!url) return

    // Basic URL validation
    try {
      new URL(url)
    } catch {
      setReferenceUrlError('Please enter a valid URL')
      return
    }

    // Check if it looks like an image URL or known image host
    const isLikelyImage = /\.(jpg|jpeg|png|webp|gif|bmp)(\?.*)?$/i.test(url) ||
      url.includes('mzstatic.com') || // Apple CDN
      url.includes('imgur.com') ||
      url.includes('cloudinary.com') ||
      url.includes('unsplash.com') ||
      url.includes('pexels.com') ||
      url.includes('githubusercontent.com') ||
      url.includes('googleusercontent.com') ||
      url.startsWith('data:image/')

    setIsLoadingUrl(true)
    setReferenceUrlError(null)

    try {
      // Try to load the image WITHOUT crossOrigin to avoid CORS issues
      // Many CDNs (like Apple's mzstatic.com) don't send CORS headers
      const img = new Image()

      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve()
        img.onerror = () => reject(new Error('Failed to load image'))
        // Set a timeout in case the image hangs
        const timeout = setTimeout(() => reject(new Error('Timeout')), 10000)
        img.onload = () => { clearTimeout(timeout); resolve() }
        img.onerror = () => { clearTimeout(timeout); reject(new Error('Failed to load')) }
        img.src = url
      })

      // Image loaded successfully
      setUploadedReference(url)
      dispatch({
        type: 'SET_STYLE_CONFIG',
        config: {
          type: 'reference',
          referenceImageUrl: url,
        },
      })
    } catch {
      // If loading failed but it looks like an image URL, accept it anyway
      // The server-side fetch will handle it
      if (isLikelyImage) {
        setUploadedReference(url)
        dispatch({
          type: 'SET_STYLE_CONFIG',
          config: {
            type: 'reference',
            referenceImageUrl: url,
          },
        })
      } else {
        setReferenceUrlError('Could not load image. Make sure the URL points to a valid image.')
      }
    } finally {
      setIsLoadingUrl(false)
    }
  }

  const selectedType = state.styleConfig?.type
  const selectedCategory = state.styleConfig?.category as AppCategory | undefined

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-start gap-4">
        <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-purple-500/20 to-blue-500/20 flex items-center justify-center border border-purple-500/20">
          <Palette className="w-6 h-6 text-purple-400" />
        </div>
        <div>
          <h3 className="text-xl font-bold text-white mb-1">
            Choose a Style
          </h3>
          <p className="text-sm text-neutral-400">
            Select how your marketing screenshots should look. The AI will apply this style consistently across all screenshots.
          </p>
        </div>
      </div>

      {/* Style Type Selection */}
      <div className="grid gap-4 md:grid-cols-3">
        {styleOptions.map(option => {
          const isSelected = selectedType === option.id
          return (
            <button
              key={option.id}
              onClick={() => handleStyleTypeSelect(option.id)}
              className={`
                relative group flex flex-col items-start p-6 rounded-2xl border text-left transition-all duration-300
                ${isSelected
                  ? 'border-purple-500/50 bg-purple-500/10 shadow-lg shadow-purple-500/10'
                  : 'border-white/[0.08] bg-white/[0.02] hover:border-white/[0.15] hover:bg-white/[0.04]'
                }
              `}
            >
              {/* Recommended badge */}
              {option.recommended && (
                <div className="absolute -top-2.5 left-4 px-2.5 py-0.5 bg-gradient-to-r from-purple-500 to-blue-500 rounded-full text-[10px] font-bold text-white uppercase tracking-wider">
                  Recommended
                </div>
              )}

              {/* Glow effect for selected */}
              {isSelected && (
                <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-purple-500/10 to-blue-500/5 pointer-events-none" />
              )}

              <div className="relative flex items-center justify-between w-full mb-4">
                <div className={`
                  w-12 h-12 rounded-xl flex items-center justify-center transition-all duration-300
                  ${isSelected
                    ? 'bg-gradient-to-br from-purple-500 to-blue-500 text-white shadow-lg shadow-purple-500/25'
                    : 'bg-white/[0.05] text-neutral-400 group-hover:bg-white/[0.08] group-hover:text-neutral-300'
                  }
                `}>
                  {option.icon}
                </div>
                {isSelected && (
                  <div className="w-6 h-6 rounded-full bg-green-500 flex items-center justify-center">
                    <Check className="w-3.5 h-3.5 text-white" />
                  </div>
                )}
              </div>
              <div className="relative">
                <div className={`font-semibold mb-1.5 transition-colors ${isSelected ? 'text-white' : 'text-neutral-200'}`}>
                  {option.label}
                </div>
                <p className="text-sm text-neutral-400 leading-relaxed">{option.description}</p>
              </div>
            </button>
          )
        })}
      </div>

      {/* Match Existing Preview */}
      {selectedType === 'match-existing' && state.existingScreenshotUrl && (
        <div className="p-5 rounded-2xl bg-gradient-to-br from-purple-500/5 to-blue-500/5 border border-purple-500/20 animate-fade-in">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-8 h-8 rounded-lg bg-purple-500/20 flex items-center justify-center">
              <Copy className="w-4 h-4 text-purple-400" />
            </div>
            <span className="text-sm font-semibold text-white">Style Reference</span>
          </div>
          <div className="flex gap-5">
            <div className="relative group">
              <div className="absolute inset-0 rounded-xl bg-gradient-to-r from-purple-500/40 to-blue-500/40 blur-xl opacity-50 group-hover:opacity-70 transition-opacity" />
              <div className="relative w-28 h-48 rounded-xl overflow-hidden border-2 border-purple-500/30">
                <img
                  src={state.existingScreenshotUrl}
                  alt="Existing screenshot"
                  className="w-full h-full object-cover"
                />
              </div>
            </div>
            <div className="flex-1 pt-2">
              <p className="text-sm text-neutral-300 mb-4">
                New screenshots will be styled to match your existing ones:
              </p>
              <div className="grid grid-cols-2 gap-2">
                {['Color palette', 'Typography', 'Decorations', 'Layout'].map(item => (
                  <div key={item} className="flex items-center gap-2 text-xs text-neutral-400">
                    <div className="w-1.5 h-1.5 rounded-full bg-purple-400" />
                    {item}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Category Selection */}
      {selectedType === 'category' && (
        <div className="space-y-5 animate-fade-in">
          <div className="flex items-center gap-2">
            <Grid3X3 className="w-4 h-4 text-purple-400" />
            <label className="text-sm font-semibold text-white">
              Select App Category
            </label>
          </div>

          {/* Category Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
            {(Object.entries(APP_CATEGORIES) as [AppCategory, typeof APP_CATEGORIES[AppCategory]][]).map(([category, info]) => {
              const isSelected = selectedCategory === category
              return (
                <button
                  key={category}
                  onClick={() => handleCategorySelect(category)}
                  className={`
                    group relative flex flex-col items-center p-4 rounded-xl border text-center transition-all duration-300
                    ${isSelected
                      ? 'border-purple-500/50 bg-purple-500/10 scale-105 shadow-lg shadow-purple-500/10'
                      : 'border-white/[0.08] bg-white/[0.02] hover:border-white/[0.15] hover:scale-[1.02]'
                    }
                  `}
                >
                  {/* Gradient preview circle */}
                  <div className="relative mb-3">
                    {isSelected && (
                      <div
                        className="absolute inset-0 rounded-full blur-lg opacity-60"
                        style={{
                          background: `linear-gradient(135deg, ${info.colors.primary}, ${info.colors.secondary})`,
                        }}
                      />
                    )}
                    <div
                      className={`relative w-12 h-12 rounded-full transition-transform ${isSelected ? 'scale-110' : 'group-hover:scale-105'}`}
                      style={{
                        background: `linear-gradient(135deg, ${info.colors.primary}, ${info.colors.secondary})`,
                      }}
                    />
                    {isSelected && (
                      <div className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-green-500 flex items-center justify-center border-2 border-[#0a0a0a]">
                        <Check className="w-3 h-3 text-white" />
                      </div>
                    )}
                  </div>

                  <span className={`text-sm font-medium transition-colors ${isSelected ? 'text-white' : 'text-neutral-300'}`}>
                    {info.label}
                  </span>
                  <span className="text-[10px] text-neutral-500 mt-0.5 line-clamp-1">
                    {info.description}
                  </span>
                </button>
              )
            })}
          </div>

          {/* Selected category preview */}
          {selectedCategory && (
            <div className="p-5 rounded-2xl bg-gradient-to-br from-white/[0.02] to-transparent border border-white/[0.08] animate-fade-in">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-8 h-8 rounded-lg bg-purple-500/20 flex items-center justify-center">
                  <Sparkles className="w-4 h-4 text-purple-400" />
                </div>
                <span className="text-sm font-semibold text-white">Style Preview</span>
              </div>
              <div className="flex items-center gap-6">
                {/* Mockup preview */}
                <div className="relative group">
                  <div
                    className="absolute inset-0 rounded-xl blur-2xl opacity-30"
                    style={{
                      background: `linear-gradient(135deg, ${APP_CATEGORIES[selectedCategory].colors.primary}, ${APP_CATEGORIES[selectedCategory].colors.secondary})`,
                    }}
                  />
                  <div
                    className="relative w-36 h-56 rounded-xl flex items-center justify-center overflow-hidden"
                    style={{
                      background: `linear-gradient(135deg, ${APP_CATEGORIES[selectedCategory].colors.primary}15, ${APP_CATEGORIES[selectedCategory].colors.secondary}15)`,
                      border: `1px solid ${APP_CATEGORIES[selectedCategory].colors.primary}30`,
                    }}
                  >
                    {/* Phone frame mockup */}
                    <div className="absolute inset-3 rounded-lg bg-black/20 border border-white/10 flex flex-col items-center justify-center gap-3">
                      <div
                        className="w-8 h-8 rounded-lg"
                        style={{
                          background: `linear-gradient(135deg, ${APP_CATEGORIES[selectedCategory].colors.primary}, ${APP_CATEGORIES[selectedCategory].colors.secondary})`,
                        }}
                      />
                      <div className="w-16 h-2 rounded-full bg-white/20" />
                      <div className="w-12 h-1.5 rounded-full bg-white/10" />
                    </div>
                    {/* Decorative elements */}
                    <div
                      className="absolute -top-4 -right-4 w-16 h-16 rounded-full blur-xl opacity-40"
                      style={{ backgroundColor: APP_CATEGORIES[selectedCategory].colors.primary }}
                    />
                    <div
                      className="absolute -bottom-4 -left-4 w-20 h-20 rounded-full blur-xl opacity-30"
                      style={{ backgroundColor: APP_CATEGORIES[selectedCategory].colors.secondary }}
                    />
                  </div>
                </div>

                {/* Style info */}
                <div className="flex-1 space-y-4">
                  <div>
                    <h4 className="text-sm font-medium text-white mb-1">{APP_CATEGORIES[selectedCategory].label}</h4>
                    <p className="text-sm text-neutral-400">
                      {APP_CATEGORIES[selectedCategory].style}
                    </p>
                  </div>
                  <div>
                    <span className="text-xs text-neutral-500 block mb-2">Color Palette</span>
                    <div className="flex items-center gap-2">
                      <div
                        className="w-10 h-10 rounded-lg shadow-lg"
                        style={{ backgroundColor: APP_CATEGORIES[selectedCategory].colors.primary }}
                      />
                      <div
                        className="w-10 h-10 rounded-lg shadow-lg"
                        style={{ backgroundColor: APP_CATEGORIES[selectedCategory].colors.secondary }}
                      />
                      <div
                        className="flex-1 h-10 rounded-lg"
                        style={{
                          background: `linear-gradient(90deg, ${APP_CATEGORIES[selectedCategory].colors.primary}, ${APP_CATEGORIES[selectedCategory].colors.secondary})`,
                        }}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* App Store Inspiration */}
      {selectedType === 'appstore' && (
        <div className="space-y-5 animate-fade-in">
          {/* Saved Styles Section */}
          {savedStyles.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Bookmark className="w-4 h-4 text-purple-400" />
                <label className="text-sm font-semibold text-white">
                  Your Saved Styles
                </label>
                <span className="text-xs text-neutral-500">({savedStyles.length})</span>
              </div>

              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3">
                {savedStyles.map((style) => {
                  const isSelected = selectedScreenshotUrl === style.imageUrl
                  const isDeleting = deletingStyleId === style.id
                  return (
                    <div
                      key={style.id}
                      className="relative group"
                    >
                      <button
                        onClick={() => selectSavedStyle(style)}
                        disabled={isDeleting}
                        className={`
                          relative w-full aspect-[9/19.5] rounded-xl overflow-hidden border-2 transition-all duration-300
                          ${isDeleting ? 'opacity-50' : ''}
                          ${isSelected
                            ? 'border-purple-500 ring-2 ring-purple-500/30 scale-105'
                            : 'border-white/[0.1] hover:border-white/[0.2] hover:scale-[1.02]'
                          }
                        `}
                      >
                        <img
                          src={style.thumbnailUrl}
                          alt={style.name}
                          className="w-full h-full object-cover"
                        />
                        {/* Overlay on hover */}
                        <div className={`
                          absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent
                          transition-opacity duration-200
                          ${isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}
                        `}>
                          <div className="absolute bottom-2 left-2 right-2">
                            <p className="text-[10px] font-medium text-white truncate">{style.name}</p>
                            {style.appStoreAppName && (
                              <p className="text-[9px] text-neutral-400 truncate">{style.appStoreAppName}</p>
                            )}
                          </div>
                        </div>
                        {/* Selected indicator */}
                        {isSelected && (
                          <div className="absolute top-2 right-2 w-6 h-6 rounded-full bg-purple-500 flex items-center justify-center">
                            <Check className="w-3.5 h-3.5 text-white" />
                          </div>
                        )}
                      </button>
                      {/* Delete button on hover */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          deleteSavedStyle(style.id)
                        }}
                        disabled={isDeleting}
                        className="absolute top-1 right-1 p-1.5 bg-red-500/80 hover:bg-red-500 rounded-lg opacity-0 group-hover:opacity-100 transition-all z-10"
                      >
                        {isDeleting ? (
                          <Loader2 className="w-3 h-3 text-white animate-spin" />
                        ) : (
                          <Trash2 className="w-3 h-3 text-white" />
                        )}
                      </button>
                    </div>
                  )
                })}
              </div>

              {/* Divider */}
              <div className="flex items-center gap-4 pt-2">
                <div className="flex-1 h-px bg-white/[0.08]" />
                <span className="text-xs text-neutral-500">or search for new</span>
                <div className="flex-1 h-px bg-white/[0.08]" />
              </div>
            </div>
          )}

          <div className="flex items-center gap-2">
            <Store className="w-4 h-4 text-purple-400" />
            <label className="text-sm font-semibold text-white">
              Find App Store Inspiration
            </label>
          </div>

          {/* Search input */}
          <div className="flex gap-3">
            <div className="flex-1 relative">
              <input
                type="text"
                value={appStoreUrl}
                onChange={(e) => setAppStoreUrl(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && fetchAppStoreScreenshots()}
                placeholder="Enter App Store URL or app ID (e.g., 123456789)"
                className="w-full px-4 py-3 bg-white/[0.03] border border-white/[0.1] rounded-xl text-white placeholder:text-neutral-500 focus:outline-none focus:border-purple-500/50 focus:ring-2 focus:ring-purple-500/20 transition-all"
              />
            </div>
            <button
              onClick={fetchAppStoreScreenshots}
              disabled={appStoreLoading || !appStoreUrl.trim()}
              className="px-5 py-3 bg-gradient-to-r from-purple-500 to-blue-500 hover:from-purple-600 hover:to-blue-600 disabled:from-neutral-700 disabled:to-neutral-700 disabled:cursor-not-allowed rounded-xl text-white font-medium flex items-center gap-2 transition-all"
            >
              {appStoreLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Search className="w-4 h-4" />
              )}
              Search
            </button>
          </div>

          {/* Error message */}
          {appStoreError && (
            <div className="flex items-center gap-3 p-4 rounded-xl bg-red-500/10 border border-red-500/20">
              <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
              <p className="text-sm text-red-400">{appStoreError}</p>
            </div>
          )}

          {/* App info and screenshots */}
          {appStoreApp && (
            <div className="space-y-4">
              {/* App header */}
              <div className="flex items-center gap-4 p-4 rounded-xl bg-white/[0.02] border border-white/[0.08]">
                <img
                  src={appStoreApp.iconUrl}
                  alt={appStoreApp.name}
                  className="w-14 h-14 rounded-xl"
                />
                <div className="flex-1 min-w-0">
                  <h4 className="text-sm font-semibold text-white truncate">{appStoreApp.name}</h4>
                  <p className="text-xs text-neutral-400 truncate">{appStoreApp.developer}</p>
                  <p className="text-xs text-purple-400">{appStoreApp.category}</p>
                </div>
                <button
                  onClick={clearAppStoreSelection}
                  className="p-2 hover:bg-white/[0.05] rounded-lg transition-colors"
                >
                  <X className="w-4 h-4 text-neutral-400" />
                </button>
              </div>

              {/* No screenshots message */}
              {appStoreScreenshots.length === 0 && (
                <div className="flex items-center gap-3 p-4 rounded-xl bg-orange-500/10 border border-orange-500/20">
                  <AlertCircle className="w-4 h-4 text-orange-400 flex-shrink-0" />
                  <div>
                    <p className="text-sm text-orange-400">No screenshots available for this app</p>
                    <p className="text-xs text-orange-400/70 mt-0.5">
                      The iTunes API doesn&apos;t provide screenshots for some apps. Try a different app.
                    </p>
                  </div>
                </div>
              )}

              {/* Screenshot grid */}
              {appStoreScreenshots.length > 0 && (
                <div className="space-y-3">
                  <p className="text-xs text-neutral-400">
                    Select a screenshot to use as style reference ({appStoreScreenshots.length} available)
                  </p>
                  <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3">
                    {appStoreScreenshots.map((screenshot, index) => {
                      const isSelected = selectedScreenshotUrl === screenshot.url
                      return (
                        <button
                          key={index}
                          onClick={() => handleSelectAppStoreScreenshot(screenshot.url)}
                          className={`
                            relative group aspect-[9/19.5] rounded-xl overflow-hidden border-2 transition-all duration-300
                            ${isSelected
                              ? 'border-purple-500 ring-2 ring-purple-500/30 scale-105'
                              : 'border-white/[0.1] hover:border-white/[0.2] hover:scale-[1.02]'
                            }
                          `}
                        >
                          <img
                            src={screenshot.url}
                            alt={`Screenshot ${index + 1}`}
                            className="w-full h-full object-cover"
                          />
                          {/* Overlay on hover */}
                          <div className={`
                            absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent
                            transition-opacity duration-200
                            ${isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}
                          `} />
                          {/* Selected indicator */}
                          {isSelected && (
                            <div className="absolute top-2 right-2 w-6 h-6 rounded-full bg-purple-500 flex items-center justify-center">
                              <Check className="w-3.5 h-3.5 text-white" />
                            </div>
                          )}
                          {/* Device type badge */}
                          <div className="absolute bottom-2 left-2">
                            <span className={`
                              px-1.5 py-0.5 text-[9px] font-medium rounded uppercase
                              ${screenshot.type === 'iphone' ? 'bg-blue-500/80 text-white' : ''}
                              ${screenshot.type === 'ipad' ? 'bg-purple-500/80 text-white' : ''}
                              ${screenshot.type === 'appletv' ? 'bg-neutral-500/80 text-white' : ''}
                            `}>
                              {screenshot.type}
                            </span>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Selected preview */}
              {selectedScreenshotUrl && (
                <div className="p-5 rounded-2xl bg-gradient-to-br from-purple-500/5 to-blue-500/5 border border-purple-500/20">
                  <div className="flex gap-5">
                    <div className="relative group">
                      <div className="absolute inset-0 rounded-xl bg-gradient-to-r from-purple-500/40 to-blue-500/40 blur-xl opacity-50" />
                      <div className="relative w-28 h-48 rounded-xl overflow-hidden border-2 border-purple-500/30">
                        <img
                          src={selectedScreenshotUrl}
                          alt="Selected reference"
                          className="w-full h-full object-cover"
                        />
                      </div>
                    </div>
                    <div className="flex-1 pt-2">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 rounded-full bg-green-500 flex items-center justify-center">
                            <Check className="w-3.5 h-3.5 text-white" />
                          </div>
                          <span className="text-sm font-medium text-green-400">Reference selected</span>
                        </div>
                        {/* Save Style Button */}
                        {appStoreApp && !showSaveDialog && (
                          <button
                            onClick={() => {
                              setSaveStyleName(appStoreApp.name)
                              setShowSaveDialog(true)
                            }}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.1] hover:border-white/[0.2] rounded-lg text-neutral-300 hover:text-white transition-all"
                          >
                            <Bookmark className="w-3.5 h-3.5" />
                            Save Style
                          </button>
                        )}
                      </div>

                      {/* Save Dialog */}
                      {showSaveDialog && (
                        <div className="mb-4 p-3 rounded-xl bg-white/[0.03] border border-white/[0.1] animate-fade-in">
                          <div className="flex items-center gap-2 mb-2">
                            <Bookmark className="w-4 h-4 text-purple-400" />
                            <span className="text-xs font-medium text-white">Save this style for later</span>
                          </div>
                          <div className="flex gap-2">
                            <input
                              type="text"
                              value={saveStyleName}
                              onChange={(e) => setSaveStyleName(e.target.value)}
                              placeholder="Style name"
                              className="flex-1 px-3 py-2 text-sm bg-white/[0.05] border border-white/[0.1] rounded-lg text-white placeholder:text-neutral-500 focus:outline-none focus:border-purple-500/50"
                            />
                            <button
                              onClick={saveCurrentStyle}
                              disabled={isSavingStyle || !saveStyleName.trim()}
                              className="px-3 py-2 text-xs font-medium bg-purple-500 hover:bg-purple-600 disabled:bg-neutral-700 disabled:cursor-not-allowed rounded-lg text-white transition-all flex items-center gap-1.5"
                            >
                              {isSavingStyle ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <Plus className="w-3.5 h-3.5" />
                              )}
                              Save
                            </button>
                            <button
                              onClick={() => {
                                setShowSaveDialog(false)
                                setSaveStyleName('')
                              }}
                              className="p-2 hover:bg-white/[0.05] rounded-lg text-neutral-400 hover:text-white transition-colors"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      )}

                      <p className="text-sm text-neutral-300 mb-3">
                        Your screenshots will be styled to match this reference from <span className="text-white font-medium">{appStoreApp.name}</span>.
                      </p>
                      <div className="grid grid-cols-2 gap-2">
                        {['Color palette', 'Typography', 'Layout', 'Visual style'].map(item => (
                          <div key={item} className="flex items-center gap-2 text-xs text-neutral-400">
                            <div className="w-1.5 h-1.5 rounded-full bg-purple-400" />
                            {item}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Selected saved style preview */}
          {selectedSavedStyle && !appStoreApp && (
            <div className="p-5 rounded-2xl bg-gradient-to-br from-purple-500/5 to-blue-500/5 border border-purple-500/20 animate-fade-in">
              <div className="flex gap-5">
                <div className="relative group">
                  <div className="absolute inset-0 rounded-xl bg-gradient-to-r from-purple-500/40 to-blue-500/40 blur-xl opacity-50" />
                  <div className="relative w-28 h-48 rounded-xl overflow-hidden border-2 border-purple-500/30">
                    <img
                      src={selectedSavedStyle.thumbnailUrl}
                      alt={selectedSavedStyle.name}
                      className="w-full h-full object-cover"
                    />
                  </div>
                </div>
                <div className="flex-1 pt-2">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-6 h-6 rounded-full bg-green-500 flex items-center justify-center">
                      <Check className="w-3.5 h-3.5 text-white" />
                    </div>
                    <span className="text-sm font-medium text-green-400">Saved style selected</span>
                  </div>
                  <p className="text-sm text-neutral-300 mb-3">
                    Using saved style <span className="text-white font-medium">{selectedSavedStyle.name}</span>
                    {selectedSavedStyle.appStoreAppName && (
                      <span className="text-neutral-400"> from {selectedSavedStyle.appStoreAppName}</span>
                    )}
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    {['Color palette', 'Typography', 'Layout', 'Visual style'].map(item => (
                      <div key={item} className="flex items-center gap-2 text-xs text-neutral-400">
                        <div className="w-1.5 h-1.5 rounded-full bg-purple-400" />
                        {item}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Help text when no app selected */}
          {!appStoreApp && !appStoreLoading && !selectedSavedStyle && (
            <div className="flex items-center gap-3 p-4 rounded-xl bg-blue-500/10 border border-blue-500/20">
              <div className="w-8 h-8 rounded-lg bg-blue-500/20 flex items-center justify-center flex-shrink-0">
                <Store className="w-4 h-4 text-blue-400" />
              </div>
              <div>
                <p className="text-sm text-blue-300">
                  Enter an App Store URL or app ID to browse screenshots
                </p>
                <p className="text-xs text-blue-400/70 mt-0.5">
                  Example: https://apps.apple.com/app/spotify-music/id324684580
                </p>
              </div>
            </div>
          )}

          {selectedType === 'appstore' && !selectedScreenshotUrl && !selectedSavedStyle && appStoreApp && appStoreScreenshots.length > 0 && (
            <div className="flex items-center gap-3 p-4 rounded-xl bg-yellow-500/10 border border-yellow-500/20 animate-fade-in">
              <div className="w-8 h-8 rounded-lg bg-yellow-500/20 flex items-center justify-center flex-shrink-0">
                <AlertCircle className="w-4 h-4 text-yellow-400" />
              </div>
              <p className="text-sm text-yellow-400">
                Please select a screenshot from above to continue
              </p>
            </div>
          )}
        </div>
      )}

      {/* Reference Image Upload */}
      {selectedType === 'reference' && (
        <div className="space-y-4 animate-fade-in">
          <div className="flex items-center gap-2">
            <ImageIcon className="w-4 h-4 text-purple-400" />
            <label className="text-sm font-semibold text-white">
              Add Style Reference
            </label>
          </div>

          {/* URL Input */}
          {!uploadedReference && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-xs text-neutral-400">
                <Link className="w-3.5 h-3.5" />
                <span>Paste an image URL</span>
              </div>
              <div className="flex gap-3">
                <div className="flex-1 relative">
                  <input
                    type="text"
                    value={referenceUrlInput}
                    onChange={(e) => {
                      setReferenceUrlInput(e.target.value)
                      setReferenceUrlError(null)
                    }}
                    onKeyDown={(e) => e.key === 'Enter' && handleReferenceUrlSubmit()}
                    placeholder="https://example.com/screenshot.png"
                    className="w-full px-4 py-3 bg-white/[0.03] border border-white/[0.1] rounded-xl text-white placeholder:text-neutral-500 focus:outline-none focus:border-purple-500/50 focus:ring-2 focus:ring-purple-500/20 transition-all"
                  />
                </div>
                <button
                  onClick={handleReferenceUrlSubmit}
                  disabled={isLoadingUrl || !referenceUrlInput.trim()}
                  className="px-5 py-3 bg-gradient-to-r from-purple-500 to-blue-500 hover:from-purple-600 hover:to-blue-600 disabled:from-neutral-700 disabled:to-neutral-700 disabled:cursor-not-allowed rounded-xl text-white font-medium flex items-center gap-2 transition-all"
                >
                  {isLoadingUrl ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Check className="w-4 h-4" />
                  )}
                  Load
                </button>
              </div>
              {referenceUrlError && (
                <div className="flex items-center gap-2 text-sm text-red-400">
                  <AlertCircle className="w-4 h-4" />
                  {referenceUrlError}
                </div>
              )}

              {/* Divider */}
              <div className="flex items-center gap-4 py-2">
                <div className="flex-1 h-px bg-white/[0.1]" />
                <span className="text-xs text-neutral-500">or upload a file</span>
                <div className="flex-1 h-px bg-white/[0.1]" />
              </div>
            </div>
          )}

          {uploadedReference ? (
            <div className="p-5 rounded-2xl bg-gradient-to-br from-green-500/5 to-blue-500/5 border border-green-500/20">
              <div className="flex gap-5">
                <div className="relative group">
                  <div className="absolute inset-0 rounded-xl bg-gradient-to-r from-green-500/30 to-blue-500/30 blur-xl opacity-50" />
                  <div className="relative w-28 h-48 rounded-xl overflow-hidden border-2 border-green-500/30">
                    <img
                      src={uploadedReference}
                      alt="Reference"
                      className="w-full h-full object-cover"
                    />
                    <button
                      onClick={clearReference}
                      className="absolute top-2 right-2 p-1.5 bg-red-500/80 hover:bg-red-500 rounded-lg transition-colors"
                    >
                      <X className="w-3.5 h-3.5 text-white" />
                    </button>
                  </div>
                </div>
                <div className="flex-1 pt-2">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-6 h-6 rounded-full bg-green-500 flex items-center justify-center">
                      <Check className="w-3.5 h-3.5 text-white" />
                    </div>
                    <span className="text-sm font-medium text-green-400">Reference uploaded</span>
                  </div>
                  <p className="text-sm text-neutral-400 mb-4">
                    Your screenshots will be styled to match this reference image.
                  </p>
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="px-4 py-2 text-sm bg-white/[0.05] hover:bg-white/[0.1] rounded-lg text-white border border-white/[0.1] hover:border-white/[0.2] transition-all"
                  >
                    Change Reference
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`
                relative rounded-2xl overflow-hidden cursor-pointer transition-all duration-300
                ${isDragging
                  ? 'ring-2 ring-purple-500 ring-offset-2 ring-offset-[#0a0a0a]'
                  : ''
                }
              `}
            >
              {/* Background gradient */}
              <div className={`
                absolute inset-0 transition-opacity duration-300
                ${isDragging ? 'opacity-100' : 'opacity-0 group-hover:opacity-50'}
              `}>
                <div className="absolute inset-0 bg-gradient-to-br from-purple-500/20 via-transparent to-blue-500/20" />
              </div>

              {/* Border */}
              <div className={`
                absolute inset-0 rounded-2xl border-2 border-dashed transition-colors duration-300
                ${isDragging
                  ? 'border-purple-500'
                  : 'border-white/[0.15] hover:border-white/[0.25]'
                }
              `} />

              <div className="relative p-10 text-center">
                <div className={`
                  w-16 h-16 mx-auto mb-4 rounded-2xl flex items-center justify-center transition-all duration-300
                  ${isDragging
                    ? 'bg-purple-500/20 scale-110'
                    : 'bg-white/[0.03]'
                  }
                `}>
                  <Upload className={`w-8 h-8 transition-colors ${isDragging ? 'text-purple-400' : 'text-neutral-500'}`} />
                </div>
                <p className="text-base font-semibold text-white mb-1">
                  {isDragging ? 'Drop your image here' : 'Drag & drop a style reference'}
                </p>
                <p className="text-sm text-neutral-500">
                  or click to browse from your computer
                </p>
              </div>
            </div>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={handleFileChange}
            className="hidden"
          />

          {selectedType === 'reference' && !uploadedReference && (
            <div className="flex items-center gap-3 p-4 rounded-xl bg-yellow-500/10 border border-yellow-500/20 animate-fade-in">
              <div className="w-8 h-8 rounded-lg bg-yellow-500/20 flex items-center justify-center flex-shrink-0">
                <AlertCircle className="w-4 h-4 text-yellow-400" />
              </div>
              <p className="text-sm text-yellow-400">
                Please upload a reference image to continue
              </p>
            </div>
          )}
        </div>
      )}

    </div>
  )
}
