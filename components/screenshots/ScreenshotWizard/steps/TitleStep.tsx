'use client'

import { useState, useEffect } from 'react'
import { Sparkles, Loader2, RefreshCw, Check, Edit2, Type, Wand2, X, ChevronRight } from 'lucide-react'
import { useWizard, HeadlineSuggestion } from '../WizardContext'

interface TitleStepProps {
  projectId: string
  appMetadata?: {
    name: string
    description: string
    category?: string
  }
}

export function TitleStep({ projectId, appMetadata }: TitleStepProps) {
  const { state, dispatch } = useWizard()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [regeneratingId, setRegeneratingId] = useState<string | null>(null)

  // Fetch headline suggestions on mount
  useEffect(() => {
    if (state.headlineSuggestions.size === 0 && state.rawImages.length > 0) {
      fetchHeadlineSuggestions()
    }
  }, [])

  // Upload a single image to get a server-accessible URL
  const uploadImage = async (file: File): Promise<string> => {
    const formData = new FormData()
    formData.append('file', file)
    formData.append('projectId', projectId)
    formData.append('category', 'headline-analysis')

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

  const fetchHeadlineSuggestions = async () => {
    dispatch({ type: 'SET_LOADING_SUGGESTIONS', isLoading: true })
    dispatch({ type: 'SET_ERROR', error: null })

    try {
      // First, upload all images to get server-accessible URLs
      // This is necessary because blob: URLs can't be fetched server-side
      const screenshots: Array<{ id: string; imageUrl: string; name: string }> = []

      for (const img of state.rawImages) {
        // If it's a blob URL, upload it first
        if (img.url.startsWith('blob:')) {
          const uploadedUrl = await uploadImage(img.file)
          screenshots.push({
            id: img.id,
            imageUrl: uploadedUrl,
            name: img.name,
          })
        } else {
          // Already a server URL
          screenshots.push({
            id: img.id,
            imageUrl: img.url,
            name: img.name,
          })
        }
      }

      const response = await fetch('/api/screenshots/suggest-headlines', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          screenshots,
          appMetadata,
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to get suggestions')
      }

      const data = await response.json()

      const suggestions = new Map<string, HeadlineSuggestion[]>()
      const confirmed = new Map<string, string>()

      for (const [id, suggestionData] of Object.entries(data.suggestions as Record<string, { headlines: string[]; confidence: string }>)) {
        const headlines = suggestionData.headlines.map((text, index) => ({
          text,
          confidence: (index === 0 ? 'high' : index === 1 ? 'medium' : 'low') as 'high' | 'medium' | 'low',
        }))
        suggestions.set(id, headlines)

        if (headlines.length > 0) {
          confirmed.set(id, headlines[0].text)
        }
      }

      dispatch({ type: 'SET_HEADLINE_SUGGESTIONS', suggestions })

      confirmed.forEach((headline, imageId) => {
        dispatch({ type: 'SET_CONFIRMED_HEADLINE', imageId, headline })
      })
    } catch (error) {
      dispatch({
        type: 'SET_ERROR',
        error: error instanceof Error ? error.message : 'Failed to get headline suggestions',
      })
    } finally {
      dispatch({ type: 'SET_LOADING_SUGGESTIONS', isLoading: false })
    }
  }

  const regenerateSingleHeadline = async (imageId: string) => {
    setRegeneratingId(imageId)

    try {
      const image = state.rawImages.find(img => img.id === imageId)
      if (!image) return

      // Upload if it's a blob URL
      let imageUrl = image.url
      if (image.url.startsWith('blob:')) {
        imageUrl = await uploadImage(image.file)
      }

      const response = await fetch('/api/screenshots/suggest-headlines', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          screenshots: [{ id: image.id, imageUrl, name: image.name }],
          appMetadata,
        }),
      })

      if (!response.ok) {
        throw new Error('Failed to regenerate')
      }

      const data = await response.json()
      const suggestionData = data.suggestions[imageId]

      if (suggestionData) {
        const headlines = suggestionData.headlines.map((text: string, index: number) => ({
          text,
          confidence: (index === 0 ? 'high' : index === 1 ? 'medium' : 'low') as 'high' | 'medium' | 'low',
        }))

        const newSuggestions = new Map(state.headlineSuggestions)
        newSuggestions.set(imageId, headlines)
        dispatch({ type: 'SET_HEADLINE_SUGGESTIONS', suggestions: newSuggestions })

        if (headlines.length > 0) {
          dispatch({ type: 'SET_CONFIRMED_HEADLINE', imageId, headline: headlines[0].text })
        }
      }
    } catch (error) {
      // Silently fail for individual regeneration
    } finally {
      setRegeneratingId(null)
    }
  }

  const selectHeadline = (imageId: string, headline: string) => {
    dispatch({ type: 'SET_CONFIRMED_HEADLINE', imageId, headline })
  }

  const startEditing = (imageId: string, currentHeadline: string) => {
    setEditingId(imageId)
    setEditValue(currentHeadline)
  }

  const saveEdit = (imageId: string) => {
    if (editValue.trim()) {
      dispatch({ type: 'SET_CONFIRMED_HEADLINE', imageId, headline: editValue.trim() })
    }
    setEditingId(null)
    setEditValue('')
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditValue('')
  }

  const completedCount = state.confirmedHeadlines.size
  const totalCount = state.rawImages.length
  const progressPercent = totalCount > 0 ? (completedCount / totalCount) * 100 : 0

  if (state.isLoadingSuggestions) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        {/* Animated background glow */}
        <div className="absolute inset-0 flex items-center justify-center overflow-hidden">
          <div className="w-64 h-64 bg-purple-500/10 rounded-full blur-3xl animate-pulse" />
          <div className="absolute w-48 h-48 bg-blue-500/10 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '0.5s' }} />
        </div>

        <div className="relative z-10 flex flex-col items-center">
          <div className="relative mb-6">
            <div className="absolute inset-0 rounded-full bg-gradient-to-r from-purple-500 to-blue-500 blur-xl opacity-40 animate-pulse" />
            <div className="relative w-20 h-20 rounded-full bg-gradient-to-br from-purple-500/20 to-blue-500/20 flex items-center justify-center border border-purple-500/20">
              <Wand2 className="w-10 h-10 text-purple-400 animate-pulse" />
            </div>
          </div>

          <h3 className="text-xl font-bold text-white mb-2">
            Analyzing your screenshots...
          </h3>
          <p className="text-sm text-neutral-400 text-center max-w-sm">
            AI is generating headline suggestions based on your app and screenshots
          </p>

          {/* Loading dots */}
          <div className="flex items-center gap-1.5 mt-6">
            {[0, 1, 2].map(i => (
              <div
                key={i}
                className="w-2 h-2 rounded-full bg-purple-400 animate-bounce"
                style={{ animationDelay: `${i * 0.15}s` }}
              />
            ))}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-purple-500/20 to-blue-500/20 flex items-center justify-center border border-purple-500/20">
            <Type className="w-6 h-6 text-purple-400" />
          </div>
          <div>
            <h3 className="text-xl font-bold text-white mb-1">
              Add Headlines
            </h3>
            <p className="text-sm text-neutral-400">
              Each screenshot needs a marketing headline. Select from AI suggestions or write your own.
            </p>
          </div>
        </div>
        <button
          onClick={fetchHeadlineSuggestions}
          disabled={state.isLoadingSuggestions}
          className="flex items-center gap-2 px-4 py-2 text-sm bg-white/[0.05] hover:bg-white/[0.1] rounded-xl text-white border border-white/[0.08] hover:border-white/[0.15] transition-all"
        >
          <RefreshCw className="w-4 h-4" />
          Regenerate All
        </button>
      </div>

      {/* Progress bar */}
      <div className="flex items-center gap-4 p-4 rounded-xl bg-white/[0.02] border border-white/[0.08]">
        <div className="flex-1">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-neutral-400">Headlines completed</span>
            <span className="text-sm font-semibold text-white">{completedCount}/{totalCount}</span>
          </div>
          <div className="h-2 bg-white/[0.05] rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                progressPercent >= 100
                  ? 'bg-green-500'
                  : 'bg-gradient-to-r from-purple-500 to-blue-500'
              }`}
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>
        {progressPercent >= 100 && (
          <div className="flex items-center gap-2 text-green-400 animate-fade-in">
            <Check className="w-5 h-5" />
            <span className="text-sm font-medium">All done!</span>
          </div>
        )}
      </div>

      {/* Screenshots with headlines */}
      <div className="space-y-4">
        {state.rawImages.map((image, index) => {
          const suggestions = state.headlineSuggestions.get(image.id) || []
          const confirmedHeadline = state.confirmedHeadlines.get(image.id)
          const isEditing = editingId === image.id
          const isRegenerating = regeneratingId === image.id

          return (
            <div
              key={image.id}
              className={`
                p-5 rounded-2xl border transition-all duration-300
                ${confirmedHeadline
                  ? 'bg-gradient-to-br from-green-500/5 to-transparent border-green-500/20'
                  : 'bg-white/[0.02] border-white/[0.08]'
                }
              `}
            >
              <div className="flex gap-5">
                {/* Thumbnail */}
                <div className="relative flex-shrink-0">
                  <div className="w-24 h-40 rounded-xl overflow-hidden border-2 border-white/[0.1]">
                    <img
                      src={image.url}
                      alt={image.name}
                      className="w-full h-full object-cover"
                    />
                  </div>
                  {/* Position badge */}
                  <div className="absolute -top-2 -left-2 w-7 h-7 rounded-full bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center shadow-lg shadow-purple-500/25">
                    <span className="text-xs font-bold text-white">{index + 1}</span>
                  </div>
                  {/* Completed indicator */}
                  {confirmedHeadline && !isEditing && (
                    <div className="absolute -bottom-2 -right-2 w-7 h-7 rounded-full bg-green-500 flex items-center justify-center shadow-lg">
                      <Check className="w-4 h-4 text-white" />
                    </div>
                  )}
                </div>

                {/* Headline section */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-4">
                    <span className="text-sm font-semibold text-white">
                      Screenshot {index + 1}
                    </span>
                    <button
                      onClick={() => regenerateSingleHeadline(image.id)}
                      disabled={isRegenerating}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-white/[0.05] hover:bg-white/[0.1] rounded-lg text-neutral-400 hover:text-white border border-white/[0.08] hover:border-white/[0.15] transition-all"
                    >
                      {isRegenerating ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <RefreshCw className="w-3.5 h-3.5" />
                      )}
                      New Ideas
                    </button>
                  </div>

                  {/* Current headline / Edit mode */}
                  {isEditing ? (
                    <div className="mb-4 animate-fade-in">
                      <div className="relative">
                        <input
                          type="text"
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          placeholder="Enter your headline..."
                          maxLength={100}
                          className="w-full px-4 py-3 bg-white/[0.05] border-2 border-purple-500/50 rounded-xl text-white placeholder-neutral-500 focus:outline-none focus:border-purple-500 transition-colors"
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') saveEdit(image.id)
                            if (e.key === 'Escape') cancelEdit()
                          }}
                        />
                        <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1">
                          <button
                            onClick={cancelEdit}
                            className="p-1.5 hover:bg-white/[0.1] rounded-lg transition-colors"
                          >
                            <X className="w-4 h-4 text-neutral-400" />
                          </button>
                          <button
                            onClick={() => saveEdit(image.id)}
                            className="p-1.5 bg-purple-500 hover:bg-purple-600 rounded-lg transition-colors"
                          >
                            <Check className="w-4 h-4 text-white" />
                          </button>
                        </div>
                      </div>
                      <div className="flex items-center justify-between mt-2 px-1">
                        <span className="text-xs text-neutral-500">
                          Press Enter to save, Escape to cancel
                        </span>
                        <span className={`text-xs ${editValue.length > 80 ? 'text-yellow-400' : 'text-neutral-500'}`}>
                          {editValue.length}/100
                        </span>
                      </div>
                    </div>
                  ) : confirmedHeadline ? (
                    <button
                      onClick={() => startEditing(image.id, confirmedHeadline)}
                      className="group w-full flex items-center gap-3 p-4 mb-4 rounded-xl bg-gradient-to-r from-green-500/10 to-blue-500/5 border border-green-500/30 hover:border-green-500/50 transition-all text-left"
                    >
                      <div className="w-8 h-8 rounded-lg bg-green-500/20 flex items-center justify-center flex-shrink-0">
                        <Check className="w-4 h-4 text-green-400" />
                      </div>
                      <span className="text-sm text-white flex-1 font-medium">{confirmedHeadline}</span>
                      <div className="flex items-center gap-1.5 text-neutral-500 group-hover:text-white transition-colors">
                        <Edit2 className="w-4 h-4" />
                        <span className="text-xs">Edit</span>
                      </div>
                    </button>
                  ) : (
                    <div className="mb-4 p-4 rounded-xl border-2 border-dashed border-white/[0.1] text-center">
                      <span className="text-sm text-neutral-500">Select a headline below or write your own</span>
                    </div>
                  )}

                  {/* Suggestions */}
                  {suggestions.length > 0 && !isEditing && (
                    <div className="space-y-3">
                      <div className="flex items-center gap-2 text-xs text-neutral-500">
                        <Sparkles className="w-3.5 h-3.5 text-purple-400" />
                        <span>AI Suggestions</span>
                        <ChevronRight className="w-3 h-3" />
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {suggestions.map((suggestion, sIndex) => {
                          const isSelected = confirmedHeadline === suggestion.text
                          return (
                            <button
                              key={sIndex}
                              onClick={() => selectHeadline(image.id, suggestion.text)}
                              className={`
                                group relative flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm transition-all duration-200
                                ${isSelected
                                  ? 'bg-gradient-to-r from-purple-500/20 to-blue-500/10 border-2 border-purple-500/50 text-white'
                                  : 'bg-white/[0.03] border border-white/[0.08] text-neutral-300 hover:border-purple-500/30 hover:bg-purple-500/5'
                                }
                              `}
                            >
                              <span className="font-medium">{suggestion.text}</span>
                              <span className={`
                                text-[10px] px-2 py-0.5 rounded-full font-medium uppercase tracking-wider
                                ${suggestion.confidence === 'high'
                                  ? 'bg-green-500/20 text-green-400 border border-green-500/20'
                                  : suggestion.confidence === 'medium'
                                  ? 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/20'
                                  : 'bg-neutral-500/20 text-neutral-400 border border-neutral-500/20'
                                }
                              `}>
                                {suggestion.confidence === 'high' ? '★' : suggestion.confidence === 'medium' ? '◆' : '○'}
                              </span>
                            </button>
                          )
                        })}
                        {/* Custom headline button */}
                        <button
                          onClick={() => startEditing(image.id, confirmedHeadline || '')}
                          className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm bg-white/[0.03] border border-dashed border-white/[0.15] text-neutral-400 hover:border-purple-500/30 hover:text-white transition-all"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                          Write your own
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
