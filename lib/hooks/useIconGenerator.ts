'use client'

import { useState, useCallback, useEffect } from 'react'
import { IconStyle, AppCategory, normalizeIconStyle } from '@/lib/constants'

export interface GeneratedIconData {
  id: string
  style?: IconStyle
  prompt?: string
  concept?: { subject: string; metaphor?: string; colorIdea?: string }
  originalUrl: string
  ios: string
  android: string
  timestamp: number
}

export interface IconSource {
  type: 'prompt' | 'metadata' | 'reference' | 'appstore'
  prompt?: string
  appMetadata?: {
    title: string
    category?: AppCategory
    subtitle?: string
    keywords?: string
    description?: string
  }
  referenceImageUrl?: string
  appId?: string
}

export interface GenerateIconParams {
  concept?: { subject: string; metaphor: string; colorIdea: string }
  source: IconSource
  style?: IconStyle
  colors?: { primary: string; secondary?: string }
  background?: 'solid' | 'gradient'
}

export interface UseIconGeneratorOptions {
  projectId: string
}

export interface UseIconGeneratorReturn {
  // State
  icons: GeneratedIconData[]
  loading: boolean
  generating: boolean
  generatingVariations: boolean
  uploading: boolean
  fetchingAppStore: boolean
  deleting: boolean
  error: string | null

  // Actions
  generateIcon: (
    params: GenerateIconParams,
  ) => Promise<GeneratedIconData | null>
  generateVariations: (
    prompt: string,
    colors?: { primary: string; secondary?: string },
  ) => Promise<GeneratedIconData[]>
  uploadReference: (
    file: File,
  ) => Promise<{ referenceUrl: string; previewUrl: string } | null>
  fetchFromAppStore: (appId: string) => Promise<GeneratedIconData | null>
  resizeIcon: (
    imageUrl: string,
  ) => Promise<{ ios: string; android: string } | null>
  deleteIcon: (iconId: string) => Promise<boolean>
  downloadIcon: (url: string, filename: string) => void
  clearError: () => void
  clearIcons: () => void
  refreshIcons: () => Promise<void>
}

export function useIconGenerator({
  projectId,
}: UseIconGeneratorOptions): UseIconGeneratorReturn {
  const [icons, setIcons] = useState<GeneratedIconData[]>([])
  const [loading, setLoading] = useState(true)
  const [generationCount, setGenerationCount] = useState(0)
  const generating = generationCount > 0
  const [variationCount, setVariationCount] = useState(0)
  const generatingVariations = variationCount > 0
  const [uploading, setUploading] = useState(false)
  const [fetchingAppStore, setFetchingAppStore] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Load icons on mount
  const loadIcons = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const res = await fetch('/api/icons/list', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, limit: 50 }),
      })

      const data = await res.json()
      if (res.ok && data.success) {
        setIcons(
          (data.icons || []).map((icon: GeneratedIconData) => ({
            ...icon,
            style: icon.style ? normalizeIconStyle(icon.style) : undefined,
          })),
        )
      } else {
        setError(data.error || data.message || 'Failed to load icons')
      }
    } catch (err) {
      setError('Failed to load icons')
      console.error('Failed to load icons:', err)
    } finally {
      setLoading(false)
    }
  }, [projectId])

  // Load icons on mount
  useEffect(() => {
    loadIcons()
  }, [loadIcons])

  const generateIcon = useCallback(
    async (params: GenerateIconParams): Promise<GeneratedIconData | null> => {
      setGenerationCount((count) => count + 1)
      setError(null)

      try {
        const res = await fetch('/api/icons/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectId,
            concept: params.concept,
            source: params.source,
            style: params.style,
            colors: params.colors,
            background: params.background,
          }),
        })

        const data = await res.json()

        if (!res.ok || !data.success) {
          setError(data.error || data.message || 'Failed to generate icon')
          return null
        }

        const iconData: GeneratedIconData = {
          id: data.id || `icon-${Date.now()}`,
          style:
            data.style || params.style
              ? normalizeIconStyle(data.style || params.style!)
              : undefined,
          concept: data.concept || params.concept,
          prompt: params.source.prompt,
          originalUrl: data.originalUrl,
          ios: data.ios,
          android: data.android,
          timestamp: data.timestamp || Date.now(),
        }

        setIcons((prev) => [iconData, ...prev])
        return iconData
      } catch (err) {
        setError('Failed to generate icon')
        return null
      } finally {
        setGenerationCount((count) => Math.max(0, count - 1))
      }
    },
    [projectId],
  )

  const generateVariations = useCallback(
    async (
      prompt: string,
      colors?: { primary: string; secondary?: string },
    ): Promise<GeneratedIconData[]> => {
      setVariationCount((count) => count + 1)
      setError(null)

      try {
        const res = await fetch('/api/icons/generate-variations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectId,
            prompt,
            colors,
          }),
        })

        const data = await res.json()

        if (!res.ok || !data.success) {
          setError(
            data.error || data.message || 'Failed to generate variations',
          )
          return []
        }

        const newIcons: GeneratedIconData[] = data.variations
          .filter((v: { success: boolean }) => v.success)
          .map(
            (v: {
              id: string
              style: IconStyle
              originalUrl: string
              ios: string
              android: string
            }) => ({
              id: v.id,
              style: normalizeIconStyle(v.style),
              prompt,
              originalUrl: v.originalUrl,
              ios: v.ios,
              android: v.android,
              timestamp: Date.now(),
            }),
          )

        if (newIcons.length < data.variations.length) {
          setError(
            `${data.variations.length - newIcons.length} variations failed. Successful icons were saved; only successful results are charged.`,
          )
        }
        setIcons((prev) => [...newIcons, ...prev])
        return newIcons
      } catch (err) {
        setError('Failed to generate variations')
        return []
      } finally {
        setVariationCount((count) => Math.max(0, count - 1))
      }
    },
    [projectId],
  )

  const uploadReference = useCallback(
    async (
      file: File,
    ): Promise<{ referenceUrl: string; previewUrl: string } | null> => {
      setUploading(true)
      setError(null)

      try {
        const formData = new FormData()
        formData.append('file', file)
        formData.append('projectId', projectId)

        const res = await fetch('/api/icons/upload-reference', {
          method: 'POST',
          body: formData,
        })

        const data = await res.json()

        if (!res.ok || !data.success) {
          setError(data.error || data.message || 'Failed to upload reference')
          return null
        }

        return {
          referenceUrl: data.referenceUrl,
          previewUrl: data.previewUrl,
        }
      } catch (err) {
        setError('Failed to upload reference')
        return null
      } finally {
        setUploading(false)
      }
    },
    [projectId],
  )

  const fetchFromAppStore = useCallback(
    async (appId: string): Promise<GeneratedIconData | null> => {
      setFetchingAppStore(true)
      setError(null)

      try {
        const res = await fetch('/api/icons/fetch-appstore', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectId,
            appId,
          }),
        })

        const data = await res.json()

        if (!res.ok || !data.success) {
          setError(
            data.error || data.message || 'Failed to fetch App Store icon',
          )
          return null
        }

        const iconData: GeneratedIconData = {
          id: `icon-appstore-${Date.now()}`,
          originalUrl: data.originalUrl,
          ios: data.ios,
          android: data.android,
          timestamp: Date.now(),
        }

        // Imported references are not persisted generation records.
        return iconData
      } catch (err) {
        setError('Failed to fetch App Store icon')
        return null
      } finally {
        setFetchingAppStore(false)
      }
    },
    [projectId],
  )

  const resizeIcon = useCallback(
    async (
      imageUrl: string,
    ): Promise<{ ios: string; android: string } | null> => {
      setError(null)

      try {
        const res = await fetch('/api/icons/resize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectId,
            imageUrl,
          }),
        })

        const data = await res.json()

        if (!res.ok || !data.success) {
          setError(data.error || data.message || 'Failed to resize icon')
          return null
        }

        return {
          ios: data.ios,
          android: data.android,
        }
      } catch (err) {
        setError('Failed to resize icon')
        return null
      }
    },
    [projectId],
  )

  const deleteIcon = useCallback(
    async (iconId: string): Promise<boolean> => {
      setDeleting(true)
      setError(null)

      try {
        const res = await fetch('/api/icons/delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectId,
            iconId,
          }),
        })

        const data = await res.json()

        if (!res.ok || !data.success) {
          setError(data.error || data.message || 'Failed to delete icon')
          return false
        }

        // Remove from local state
        setIcons((prev) => prev.filter((icon) => icon.id !== iconId))
        return true
      } catch (err) {
        setError('Failed to delete icon')
        return false
      } finally {
        setDeleting(false)
      }
    },
    [projectId],
  )

  const downloadIcon = useCallback((url: string, filename: string) => {
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    link.target = '_blank'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }, [])

  const clearError = useCallback(() => {
    setError(null)
  }, [])

  const clearIcons = useCallback(() => {
    setIcons([])
  }, [])

  return {
    icons,
    loading,
    generating,
    generatingVariations,
    uploading,
    fetchingAppStore,
    deleting,
    error,
    generateIcon,
    generateVariations,
    uploadReference,
    fetchFromAppStore,
    resizeIcon,
    deleteIcon,
    downloadIcon,
    clearError,
    clearIcons,
    refreshIcons: loadIcons,
  }
}
