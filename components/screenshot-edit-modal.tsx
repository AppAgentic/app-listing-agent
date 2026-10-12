'use client'

import { useState, useRef, useCallback, useEffect, MouseEvent as ReactMouseEvent } from 'react'
import { createPortal } from 'react-dom'
import Image from 'next/image'
import {
  X,
  Sparkles,
  Loader2,
  Check,
  RefreshCw,
  Upload,
  ImageIcon,
  Minus,
  Plus,
  Wand2,
  RotateCcw,
  Eye,
  ArrowRight,
  Zap,
  Palette,
  Type,
  Move,
  Layers,
  PlusCircle,
  Trash2,
  Info,
  Pencil,
  Circle,
  Square,
  Eraser,
  Undo2,
  MousePointer2,
} from 'lucide-react'

interface Screenshot {
  id: string
  marketingImageUrl: string
  rawImageUrl?: string | null
  headline?: string
}

interface ContextImage {
  id: string
  url: string
  label: string
  type: 'default' | 'screenshot' | 'upload'
}

type AnnotationTool = 'select' | 'freehand' | 'rectangle' | 'circle' | 'arrow'

interface Point {
  x: number
  y: number
}

interface Annotation {
  id: string
  tool: AnnotationTool
  color: string
  points: Point[]
  // For shapes
  startPoint?: Point
  endPoint?: Point
}

const ANNOTATION_COLORS = [
  { name: 'Red', value: '#ef4444' },
  { name: 'Orange', value: '#f97316' },
  { name: 'Yellow', value: '#eab308' },
  { name: 'Green', value: '#22c55e' },
  { name: 'Blue', value: '#3b82f6' },
  { name: 'Purple', value: '#a855f7' },
]

interface ScreenshotEditModalProps {
  isOpen: boolean
  onClose: () => void
  onSave: () => Promise<void>
  screenshot: Screenshot
  deviceType: string
  locale: string
  isTranslated: boolean
  primaryImageUrl?: string
  sourceLocale?: string // Primary language locale (e.g., "en-US") for translation context
  allScreenshots?: Screenshot[]
  projectId: string
  initialPrompt?: string // Pre-fill the prompt field
}

// Suggested edit prompts for quick actions
const SUGGESTED_PROMPTS = [
  { label: 'Fix text fitting', icon: Type, prompt: 'Adjust the headline and subtitle text to fit better within the screenshot. Fix any text overflow, truncation, or insufficient margins. Ensure proper spacing and readability.' },
  { label: 'Adjust colors', icon: Palette, prompt: 'Adjust the color scheme to be more vibrant' },
  { label: 'Move text', icon: Move, prompt: 'Move the headline text higher on the image' },
  { label: 'Change style', icon: Layers, prompt: 'Make the background gradient more subtle' },
]

const MAX_CONTEXT_IMAGES = 4

export function ScreenshotEditModal({
  isOpen,
  onClose,
  onSave,
  screenshot,
  deviceType,
  locale,
  isTranslated,
  primaryImageUrl,
  sourceLocale,
  allScreenshots = [],
  projectId,
  initialPrompt,
}: ScreenshotEditModalProps) {
  const [prompt, setPrompt] = useState(initialPrompt || '')
  const [variationCount, setVariationCount] = useState(2)
  const [contextImages, setContextImages] = useState<ContextImage[]>(() => {
    // Initialize with default context if available
    if (isTranslated && primaryImageUrl) {
      return [{ id: 'default', url: primaryImageUrl, label: 'Primary language', type: 'default' }]
    }
    if (!isTranslated && screenshot.rawImageUrl) {
      return [{ id: 'default', url: screenshot.rawImageUrl, label: 'Original raw', type: 'default' }]
    }
    return []
  })
  const [showAddContext, setShowAddContext] = useState(false)
  const [currentImage, setCurrentImage] = useState(screenshot.marketingImageUrl)
  const [originalImage] = useState(screenshot.marketingImageUrl) // Track the true original
  const [editHistory, setEditHistory] = useState<string[]>([]) // Track edit history for undo
  const [variations, setVariations] = useState<Array<{ id: string; imageUrl: string }>>([])
  const [isGenerating, setIsGenerating] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [creditsUsed, setCreditsUsed] = useState(0)
  const [selectedVariation, setSelectedVariation] = useState<string | null>(null)
  const [previewImage, setPreviewImage] = useState<{ url: string; label: string } | null>(null)
  const [iterationCount, setIterationCount] = useState(0) // Track how many times we've iterated
  const [mounted, setMounted] = useState(false) // For portal SSR safety

  // Annotation state
  const [annotationMode, setAnnotationMode] = useState(false)
  const [annotationTool, setAnnotationTool] = useState<AnnotationTool>('freehand')
  const [annotationColor, setAnnotationColor] = useState('#ef4444')
  const [annotations, setAnnotations] = useState<Annotation[]>([])
  const [isDrawing, setIsDrawing] = useState(false)
  const [currentAnnotation, setCurrentAnnotation] = useState<Annotation | null>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const addContextRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Set mounted for portal SSR safety
  useEffect(() => {
    setMounted(true)
  }, [])

  // Update prompt when initialPrompt changes (e.g., modal reopened with preset)
  useEffect(() => {
    if (initialPrompt) {
      setPrompt(initialPrompt)
    }
  }, [initialPrompt])

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (addContextRef.current && !addContextRef.current.contains(e.target as Node)) {
        setShowAddContext(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Render annotations on canvas
  useEffect(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Match canvas size to container
    const rect = container.getBoundingClientRect()
    canvas.width = rect.width
    canvas.height = rect.height

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    // Draw all annotations
    const allAnnotations = currentAnnotation ? [...annotations, currentAnnotation] : annotations

    allAnnotations.forEach(annotation => {
      ctx.strokeStyle = annotation.color
      ctx.lineWidth = 3
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'

      if (annotation.tool === 'freehand' && annotation.points.length > 0) {
        ctx.beginPath()
        ctx.moveTo(annotation.points[0].x, annotation.points[0].y)
        annotation.points.forEach(point => {
          ctx.lineTo(point.x, point.y)
        })
        ctx.stroke()
      } else if (annotation.tool === 'rectangle' && annotation.startPoint && annotation.endPoint) {
        const width = annotation.endPoint.x - annotation.startPoint.x
        const height = annotation.endPoint.y - annotation.startPoint.y
        ctx.strokeRect(annotation.startPoint.x, annotation.startPoint.y, width, height)
      } else if (annotation.tool === 'circle' && annotation.startPoint && annotation.endPoint) {
        const centerX = (annotation.startPoint.x + annotation.endPoint.x) / 2
        const centerY = (annotation.startPoint.y + annotation.endPoint.y) / 2
        const radiusX = Math.abs(annotation.endPoint.x - annotation.startPoint.x) / 2
        const radiusY = Math.abs(annotation.endPoint.y - annotation.startPoint.y) / 2
        ctx.beginPath()
        ctx.ellipse(centerX, centerY, radiusX, radiusY, 0, 0, Math.PI * 2)
        ctx.stroke()
      } else if (annotation.tool === 'arrow' && annotation.startPoint && annotation.endPoint) {
        // Draw line
        ctx.beginPath()
        ctx.moveTo(annotation.startPoint.x, annotation.startPoint.y)
        ctx.lineTo(annotation.endPoint.x, annotation.endPoint.y)
        ctx.stroke()

        // Draw arrowhead
        const angle = Math.atan2(
          annotation.endPoint.y - annotation.startPoint.y,
          annotation.endPoint.x - annotation.startPoint.x
        )
        const headLength = 15
        ctx.beginPath()
        ctx.moveTo(annotation.endPoint.x, annotation.endPoint.y)
        ctx.lineTo(
          annotation.endPoint.x - headLength * Math.cos(angle - Math.PI / 6),
          annotation.endPoint.y - headLength * Math.sin(angle - Math.PI / 6)
        )
        ctx.moveTo(annotation.endPoint.x, annotation.endPoint.y)
        ctx.lineTo(
          annotation.endPoint.x - headLength * Math.cos(angle + Math.PI / 6),
          annotation.endPoint.y - headLength * Math.sin(angle + Math.PI / 6)
        )
        ctx.stroke()
      }
    })
  }, [annotations, currentAnnotation])

  // Generate annotated image for API - must be defined before handleGenerate
  const getAnnotatedImageUrl = useCallback(async (): Promise<string | null> => {
    if (annotations.length === 0) return null

    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return null

    // Create a new canvas with the image + annotations
    const exportCanvas = document.createElement('canvas')
    const ctx = exportCanvas.getContext('2d')
    if (!ctx) return null

    // Load the current image
    const img = document.createElement('img')
    img.crossOrigin = 'anonymous'

    return new Promise((resolve) => {
      img.onload = () => {
        exportCanvas.width = img.width
        exportCanvas.height = img.height

        // Draw image
        ctx.drawImage(img, 0, 0)

        // Scale factor for annotations
        const scaleX = img.width / canvas.width
        const scaleY = img.height / canvas.height

        // Draw annotations scaled to image size
        annotations.forEach(annotation => {
          ctx.strokeStyle = annotation.color
          ctx.lineWidth = 4 * Math.max(scaleX, scaleY)
          ctx.lineCap = 'round'
          ctx.lineJoin = 'round'

          if (annotation.tool === 'freehand' && annotation.points.length > 0) {
            ctx.beginPath()
            ctx.moveTo(annotation.points[0].x * scaleX, annotation.points[0].y * scaleY)
            annotation.points.forEach(point => {
              ctx.lineTo(point.x * scaleX, point.y * scaleY)
            })
            ctx.stroke()
          } else if (annotation.tool === 'rectangle' && annotation.startPoint && annotation.endPoint) {
            const x = annotation.startPoint.x * scaleX
            const y = annotation.startPoint.y * scaleY
            const width = (annotation.endPoint.x - annotation.startPoint.x) * scaleX
            const height = (annotation.endPoint.y - annotation.startPoint.y) * scaleY
            ctx.strokeRect(x, y, width, height)
          } else if (annotation.tool === 'circle' && annotation.startPoint && annotation.endPoint) {
            const centerX = ((annotation.startPoint.x + annotation.endPoint.x) / 2) * scaleX
            const centerY = ((annotation.startPoint.y + annotation.endPoint.y) / 2) * scaleY
            const radiusX = (Math.abs(annotation.endPoint.x - annotation.startPoint.x) / 2) * scaleX
            const radiusY = (Math.abs(annotation.endPoint.y - annotation.startPoint.y) / 2) * scaleY
            ctx.beginPath()
            ctx.ellipse(centerX, centerY, radiusX, radiusY, 0, 0, Math.PI * 2)
            ctx.stroke()
          } else if (annotation.tool === 'arrow' && annotation.startPoint && annotation.endPoint) {
            const startX = annotation.startPoint.x * scaleX
            const startY = annotation.startPoint.y * scaleY
            const endX = annotation.endPoint.x * scaleX
            const endY = annotation.endPoint.y * scaleY

            ctx.beginPath()
            ctx.moveTo(startX, startY)
            ctx.lineTo(endX, endY)
            ctx.stroke()

            const angle = Math.atan2(endY - startY, endX - startX)
            const headLength = 20 * Math.max(scaleX, scaleY)
            ctx.beginPath()
            ctx.moveTo(endX, endY)
            ctx.lineTo(endX - headLength * Math.cos(angle - Math.PI / 6), endY - headLength * Math.sin(angle - Math.PI / 6))
            ctx.moveTo(endX, endY)
            ctx.lineTo(endX - headLength * Math.cos(angle + Math.PI / 6), endY - headLength * Math.sin(angle + Math.PI / 6))
            ctx.stroke()
          }
        })

        resolve(exportCanvas.toDataURL('image/png'))
      }
      img.onerror = () => resolve(null)
      img.src = currentImage
    })
  }, [annotations, currentImage])

  const handleGenerate = useCallback(async () => {
    if (!prompt.trim()) {
      setError('Please enter an edit instruction')
      return
    }

    setIsGenerating(true)
    setError(null)
    setSelectedVariation(null)

    try {
      // Combine all context image URLs
      const contextUrls = contextImages.map(img => img.url)

      // Get annotated image if there are annotations
      const annotatedImage = await getAnnotatedImageUrl()

      // Build the prompt - add annotation hint if we have annotations
      let finalPrompt = prompt.trim()
      if (annotatedImage) {
        finalPrompt = `${finalPrompt}\n\nNote: The image has been annotated with colored markings to highlight specific areas. Please pay special attention to the areas marked/highlighted in the annotations and apply the edit instruction to those areas.`
      }

      // Check if the primary language image is the first in context (for translation context)
      const hasPrimaryAsFirstContext = isTranslated && primaryImageUrl && contextUrls.length > 0 && contextUrls[0] === primaryImageUrl

      const response = await fetch('/api/screenshots/edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          displayType: deviceType,
          screenshotId: screenshot.id,
          locale: isTranslated ? locale : undefined,
          sourceLocale: isTranslated ? (sourceLocale || 'en-US') : undefined, // Primary language for translation context
          prompt: finalPrompt,
          contextImageUrls: contextUrls.length > 0 ? contextUrls : undefined, // All reference images
          variationCount,
          isPrimaryReference: hasPrimaryAsFirstContext, // Whether first context is the primary language version
          // Use annotated image if available, otherwise use current image if modified
          currentImageUrl: annotatedImage || (currentImage !== screenshot.marketingImageUrl ? currentImage : undefined),
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to generate variations')
      }

      const data = await response.json()
      setVariations(data.variations)
      setCreditsUsed(prev => prev + data.creditsUsed)
      if (data.variations.length > 0) {
        setSelectedVariation(data.variations[0].imageUrl)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate variations')
    } finally {
      setIsGenerating(false)
    }
  }, [prompt, projectId, deviceType, screenshot.id, isTranslated, locale, contextImages, variationCount, currentImage, screenshot.marketingImageUrl, getAnnotatedImageUrl])

  const handleSelectVariation = useCallback((imageUrl: string) => {
    setSelectedVariation(imageUrl)
  }, [])

  const handleEditAgain = useCallback((imageUrl: string) => {
    // Save current image to history before switching
    setEditHistory(prev => [...prev, currentImage])
    setCurrentImage(imageUrl)
    setVariations([])
    setSelectedVariation(null)
    setPrompt('')
    setAnnotations([]) // Clear annotations when switching base
    setIterationCount(prev => prev + 1)
  }, [currentImage])

  const handleUndoIteration = useCallback(() => {
    if (editHistory.length === 0) return
    const previousImage = editHistory[editHistory.length - 1]
    setEditHistory(prev => prev.slice(0, -1))
    setCurrentImage(previousImage)
    setVariations([])
    setSelectedVariation(null)
    setAnnotations([])
    setIterationCount(prev => Math.max(0, prev - 1))
  }, [editHistory])

  const handleSave = useCallback(async () => {
    if (!selectedVariation) return

    setIsSaving(true)
    setError(null)

    try {
      const discardUrls = variations
        .filter(v => v.imageUrl !== selectedVariation)
        .map(v => v.imageUrl)

      const response = await fetch('/api/screenshots/edit/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          displayType: deviceType,
          screenshotId: screenshot.id,
          locale: isTranslated ? locale : undefined,
          selectedImageUrl: selectedVariation,
          discardUrls,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to save screenshot')
      }

      await onSave()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setIsSaving(false)
    }
  }, [variations, selectedVariation, onSave, onClose, projectId, deviceType, screenshot.id, isTranslated, locale])

  const handleReset = useCallback(() => {
    setCurrentImage(originalImage)
    setVariations([])
    setSelectedVariation(null)
    setPrompt('')
    setAnnotations([])
    setEditHistory([])
    setIterationCount(0)
  }, [originalImage])

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return

    Array.from(files).forEach((file, index) => {
      if (contextImages.length + index >= MAX_CONTEXT_IMAGES) return

      const reader = new FileReader()
      reader.onload = (ev) => {
        const dataUrl = ev.target?.result as string
        setContextImages(prev => {
          if (prev.length >= MAX_CONTEXT_IMAGES) return prev
          return [...prev, {
            id: `upload-${Date.now()}-${index}`,
            url: dataUrl,
            label: file.name.slice(0, 20),
            type: 'upload'
          }]
        })
      }
      reader.readAsDataURL(file)
    })

    setShowAddContext(false)
    // Reset input
    e.target.value = ''
  }, [contextImages.length])

  const handleAddScreenshotContext = useCallback((s: Screenshot) => {
    if (contextImages.length >= MAX_CONTEXT_IMAGES) return

    // Check if already added
    if (contextImages.some(c => c.url === s.marketingImageUrl)) return

    setContextImages(prev => [...prev, {
      id: `screenshot-${s.id}`,
      url: s.marketingImageUrl,
      label: s.headline || 'Screenshot',
      type: 'screenshot'
    }])
    setShowAddContext(false)
  }, [contextImages])

  const handleAddDefaultContext = useCallback(() => {
    if (contextImages.length >= MAX_CONTEXT_IMAGES) return

    const defaultUrl = isTranslated ? primaryImageUrl : screenshot.rawImageUrl
    if (!defaultUrl) return

    // Check if already added
    if (contextImages.some(c => c.id === 'default')) return

    setContextImages(prev => [...prev, {
      id: 'default',
      url: defaultUrl,
      label: isTranslated ? 'Primary language' : 'Original raw',
      type: 'default'
    }])
    setShowAddContext(false)
  }, [contextImages, isTranslated, primaryImageUrl, screenshot.rawImageUrl])

  const handleRemoveContext = useCallback((id: string) => {
    setContextImages(prev => prev.filter(c => c.id !== id))
  }, [])

  const handleSuggestedPrompt = useCallback((suggestedPrompt: string) => {
    setPrompt(suggestedPrompt)
  }, [])

  // Annotation handlers
  const getCanvasPoint = useCallback((e: ReactMouseEvent<HTMLCanvasElement>): Point => {
    const canvas = canvasRef.current
    if (!canvas) return { x: 0, y: 0 }
    const rect = canvas.getBoundingClientRect()
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    }
  }, [])

  const handleCanvasMouseDown = useCallback((e: ReactMouseEvent<HTMLCanvasElement>) => {
    if (!annotationMode || annotationTool === 'select') return

    const point = getCanvasPoint(e)
    setIsDrawing(true)

    const newAnnotation: Annotation = {
      id: `annotation-${Date.now()}`,
      tool: annotationTool,
      color: annotationColor,
      points: annotationTool === 'freehand' ? [point] : [],
      startPoint: annotationTool !== 'freehand' ? point : undefined,
      endPoint: annotationTool !== 'freehand' ? point : undefined,
    }
    setCurrentAnnotation(newAnnotation)
  }, [annotationMode, annotationTool, annotationColor, getCanvasPoint])

  const handleCanvasMouseMove = useCallback((e: ReactMouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing || !currentAnnotation) return

    const point = getCanvasPoint(e)

    if (currentAnnotation.tool === 'freehand') {
      setCurrentAnnotation(prev => prev ? {
        ...prev,
        points: [...prev.points, point]
      } : null)
    } else {
      setCurrentAnnotation(prev => prev ? {
        ...prev,
        endPoint: point
      } : null)
    }
  }, [isDrawing, currentAnnotation, getCanvasPoint])

  const handleCanvasMouseUp = useCallback(() => {
    if (!isDrawing || !currentAnnotation) return

    setIsDrawing(false)
    setAnnotations(prev => [...prev, currentAnnotation])
    setCurrentAnnotation(null)
  }, [isDrawing, currentAnnotation])

  const handleUndoAnnotation = useCallback(() => {
    setAnnotations(prev => prev.slice(0, -1))
  }, [])

  const handleClearAnnotations = useCallback(() => {
    setAnnotations([])
  }, [])

  if (!isOpen) return null
  if (!mounted) return null // SSR safety for portal

  const hasEdits = currentImage !== originalImage
  const isEditingVariant = iterationCount > 0
  // Always show the current/original image in the main preview, not the selected variation
  const displayImage = currentImage
  const canAddMoreContext = contextImages.length < MAX_CONTEXT_IMAGES
  const hasDefaultAvailable = (isTranslated && primaryImageUrl) || (!isTranslated && screenshot.rawImageUrl)
  const defaultAlreadyAdded = contextImages.some(c => c.id === 'default')
  const availableScreenshots = allScreenshots.filter(s =>
    s.id !== screenshot.id && !contextImages.some(c => c.url === s.marketingImageUrl)
  )

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose} />

      <div className="relative w-full max-w-6xl max-h-[90vh] overflow-hidden rounded-2xl bg-[#0c0c0c] border border-white/[0.08] shadow-2xl flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-white/[0.06] flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-4">
            <div className="p-2.5 rounded-xl bg-gradient-to-br from-purple-500/20 to-pink-500/20 border border-purple-500/20">
              <Wand2 className="w-5 h-5 text-purple-400" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-white">AI Screenshot Editor</h3>
              <p className="text-sm text-neutral-500">
                {isTranslated ? `Editing ${locale} translation` : 'Editing primary screenshot'}
                {isEditingVariant && (
                  <span className="ml-2 text-amber-400">• Iteration {iterationCount}</span>
                )}
                {hasEdits && !isEditingVariant && <span className="ml-2 text-purple-400">• Modified</span>}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* Undo iteration button */}
            {editHistory.length > 0 && (
              <button
                onClick={handleUndoIteration}
                className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-amber-400 hover:text-amber-300 hover:bg-amber-500/10 transition-colors"
                title="Go back to previous iteration"
              >
                <Undo2 className="w-4 h-4" />
                Undo
              </button>
            )}
            {hasEdits && (
              <button
                onClick={handleReset}
                className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-neutral-400 hover:text-white hover:bg-white/[0.05] transition-colors"
              >
                <RotateCcw className="w-4 h-4" />
                Reset All
              </button>
            )}
            <button
              onClick={onClose}
              className="p-2 rounded-lg hover:bg-white/[0.05] transition-colors"
            >
              <X className="w-5 h-5 text-neutral-400" />
            </button>
          </div>
        </div>

        {/* Main Content */}
        <div className="flex-1 overflow-y-auto">
          <div className="flex flex-col lg:flex-row min-h-full">
            {/* Left Panel - Image Preview */}
            <div className="lg:w-[320px] xl:w-[380px] flex-shrink-0 p-6 border-b lg:border-b-0 lg:border-r border-white/[0.06] bg-neutral-900/30">
              <div className="sticky top-0 space-y-4">
                {/* Image container */}
                <div
                  ref={containerRef}
                  className={`relative rounded-2xl overflow-hidden bg-neutral-800/50 border ${annotationMode ? 'border-orange-500/50' : 'border-white/[0.06]'}`}
                >
                  <div className="aspect-[9/19.5]">
                    <Image
                      src={displayImage}
                      alt="Screenshot preview"
                      fill
                      className="object-contain"
                      unoptimized
                    />
                    {/* Canvas overlay for annotations */}
                    <canvas
                      ref={canvasRef}
                      className={`absolute inset-0 w-full h-full ${annotationMode ? 'cursor-crosshair' : 'pointer-events-none'}`}
                      onMouseDown={handleCanvasMouseDown}
                      onMouseMove={handleCanvasMouseMove}
                      onMouseUp={handleCanvasMouseUp}
                      onMouseLeave={handleCanvasMouseUp}
                    />
                  </div>

                  {/* Badges */}
                  <div className="absolute top-3 left-3 flex flex-col gap-2 pointer-events-none">
                    {annotationMode && (
                      <span className="px-2.5 py-1 rounded-lg bg-orange-500/90 text-white text-xs font-medium shadow-lg">
                        Annotating
                      </span>
                    )}
                    {isEditingVariant ? (
                      <span className="px-2.5 py-1 rounded-lg bg-amber-500/90 text-white text-xs font-medium shadow-lg">
                        Variant #{iterationCount}
                      </span>
                    ) : (
                      <span className="px-2.5 py-1 rounded-lg bg-neutral-700/90 text-white text-xs font-medium shadow-lg">
                        Original
                      </span>
                    )}
                    {annotations.length > 0 && !annotationMode && (
                      <span className="px-2.5 py-1 rounded-lg bg-orange-500/90 text-white text-xs font-medium shadow-lg">
                        {annotations.length} mark{annotations.length > 1 ? 's' : ''}
                      </span>
                    )}
                  </div>

                </div>

                {/* Annotation Toolbar */}
                <div className="space-y-3">
                  {/* Annotate toggle button */}
                  <button
                    onClick={() => setAnnotationMode(!annotationMode)}
                    className={`w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all ${
                      annotationMode
                        ? 'bg-orange-500 text-white'
                        : 'bg-white/[0.03] text-neutral-300 border border-white/[0.08] hover:bg-white/[0.06]'
                    }`}
                  >
                    <Pencil className="w-4 h-4" />
                    {annotationMode ? 'Done Annotating' : 'Annotate Image'}
                  </button>

                  {/* Annotation tools - shown when in annotation mode */}
                  {annotationMode && (
                    <div className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.08] space-y-3">
                      {/* Tools */}
                      <div className="flex items-center gap-1">
                        {[
                          { tool: 'freehand' as AnnotationTool, icon: Pencil, label: 'Draw' },
                          { tool: 'rectangle' as AnnotationTool, icon: Square, label: 'Rectangle' },
                          { tool: 'circle' as AnnotationTool, icon: Circle, label: 'Circle' },
                          { tool: 'arrow' as AnnotationTool, icon: MousePointer2, label: 'Arrow' },
                        ].map(({ tool, icon: Icon, label }) => (
                          <button
                            key={tool}
                            onClick={() => setAnnotationTool(tool)}
                            className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-2 rounded-lg text-xs font-medium transition-colors ${
                              annotationTool === tool
                                ? 'bg-orange-500/20 text-orange-400 border border-orange-500/30'
                                : 'text-neutral-400 hover:text-white hover:bg-white/[0.05]'
                            }`}
                            title={label}
                          >
                            <Icon className="w-4 h-4" />
                          </button>
                        ))}
                      </div>

                      {/* Colors */}
                      <div className="flex items-center justify-center gap-2">
                        {ANNOTATION_COLORS.map(color => (
                          <button
                            key={color.value}
                            onClick={() => setAnnotationColor(color.value)}
                            className={`w-6 h-6 rounded-full transition-transform ${
                              annotationColor === color.value ? 'ring-2 ring-white ring-offset-2 ring-offset-neutral-900 scale-110' : 'hover:scale-110'
                            }`}
                            style={{ backgroundColor: color.value }}
                            title={color.name}
                          />
                        ))}
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-2">
                        <button
                          onClick={handleUndoAnnotation}
                          disabled={annotations.length === 0}
                          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-neutral-400 hover:text-white hover:bg-white/[0.05] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        >
                          <Undo2 className="w-3.5 h-3.5" />
                          Undo
                        </button>
                        <button
                          onClick={handleClearAnnotations}
                          disabled={annotations.length === 0}
                          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-neutral-400 hover:text-white hover:bg-white/[0.05] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        >
                          <Eraser className="w-3.5 h-3.5" />
                          Clear All
                        </button>
                      </div>

                      <p className="text-[10px] text-neutral-500 text-center">
                        Draw on the image to highlight areas for the AI to focus on
                      </p>
                    </div>
                  )}
                </div>

                {/* Selected variation preview */}
                {selectedVariation && !annotationMode && (
                  <div className="space-y-2">
                    <p className="text-xs text-neutral-400 font-medium">Selected Variation</p>
                    <div className="rounded-xl overflow-hidden bg-neutral-800/50 border border-purple-500/30">
                      <div className="aspect-[9/19.5] relative">
                        <Image
                          src={selectedVariation}
                          alt="Selected variation"
                          fill
                          className="object-contain"
                          unoptimized
                        />
                        <span className="absolute bottom-2 left-2 px-2 py-0.5 rounded bg-purple-500/80 text-[10px] text-white">Selected</span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Credit indicator */}
                <div className="flex items-center justify-between text-xs">
                  <span className="text-neutral-500">
                    <Zap className="w-3.5 h-3.5 inline mr-1 text-amber-400" />
                    {variationCount} credit{variationCount > 1 ? 's' : ''} per generation
                  </span>
                  {creditsUsed > 0 && (
                    <span className="text-purple-400">{creditsUsed} used</span>
                  )}
                </div>
              </div>
            </div>

            {/* Right Panel - Controls & Variations */}
            <div className="flex-1 p-6 space-y-6">
              {/* Prompt Section */}
              <div className="space-y-3">
                <label className="block text-sm font-medium text-white">
                  What would you like to change?
                </label>

                {/* Suggested prompts */}
                <div className="flex flex-wrap gap-2">
                  {SUGGESTED_PROMPTS.map((suggestion) => (
                    <button
                      key={suggestion.label}
                      onClick={() => handleSuggestedPrompt(suggestion.prompt)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                        prompt === suggestion.prompt
                          ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                          : 'bg-white/[0.03] text-neutral-400 border border-white/[0.06] hover:bg-white/[0.06] hover:text-white'
                      }`}
                    >
                      <suggestion.icon className="w-3.5 h-3.5" />
                      {suggestion.label}
                    </button>
                  ))}
                </div>

                {/* Prompt textarea */}
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="Describe the changes you want, e.g., 'Make the gradient more purple and move the headline higher'"
                  className="w-full h-28 px-4 py-3 rounded-xl bg-white/[0.03] border border-white/[0.08] text-white placeholder-neutral-500 text-sm resize-none focus:outline-none focus:border-purple-500/50 focus:ring-2 focus:ring-purple-500/20 transition-all"
                />
              </div>

              {/* Context/Reference Images Section */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <label className="text-sm font-medium text-white">
                      Reference Images
                    </label>
                    <div className="group relative">
                      <Info className="w-3.5 h-3.5 text-neutral-500 cursor-help" />
                      <div className="absolute bottom-full left-0 mb-2 w-64 p-3 rounded-lg bg-neutral-800 border border-white/[0.1] text-xs text-neutral-300 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all shadow-xl z-10">
                        Add reference images to guide the AI. Use these for style inspiration, design elements, or any visual context you want incorporated.
                      </div>
                    </div>
                  </div>
                  <span className="text-xs text-neutral-500">{contextImages.length}/{MAX_CONTEXT_IMAGES}</span>
                </div>

                {/* Context images grid */}
                <div className="flex flex-wrap gap-3">
                  {contextImages.map((img) => (
                    <div
                      key={img.id}
                      className="relative group"
                    >
                      <button
                        onClick={() => setPreviewImage({ url: img.url, label: img.label })}
                        className="w-20 h-20 rounded-xl overflow-hidden bg-neutral-800 border border-white/[0.1] ring-2 ring-purple-500/30 hover:ring-purple-500/60 transition-all cursor-zoom-in"
                      >
                        <Image
                          src={img.url}
                          alt={img.label}
                          width={80}
                          height={80}
                          className="w-full h-full object-cover"
                          unoptimized
                        />
                        {/* Zoom hint on hover */}
                        <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                          <Eye className="w-4 h-4 text-white" />
                        </div>
                      </button>
                      {/* Label */}
                      <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded bg-purple-500/90 text-[10px] text-white font-medium whitespace-nowrap max-w-[90px] truncate">
                        {img.label}
                      </div>
                      {/* Remove button */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          handleRemoveContext(img.id)
                        }}
                        className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-red-500 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-lg hover:bg-red-600 z-10"
                      >
                        <X className="w-3 h-3" />
                      </button>
                      {/* Type indicator */}
                      <div className="absolute top-1 left-1 w-4 h-4 rounded bg-black/60 flex items-center justify-center pointer-events-none">
                        {img.type === 'default' && <Sparkles className="w-2.5 h-2.5 text-amber-400" />}
                        {img.type === 'screenshot' && <ImageIcon className="w-2.5 h-2.5 text-blue-400" />}
                        {img.type === 'upload' && <Upload className="w-2.5 h-2.5 text-green-400" />}
                      </div>
                    </div>
                  ))}

                  {/* Add context button */}
                  {canAddMoreContext && (
                    <div className="relative" ref={addContextRef}>
                      <button
                        onClick={() => setShowAddContext(!showAddContext)}
                        className="w-20 h-20 rounded-xl border-2 border-dashed border-white/[0.15] bg-white/[0.02] flex flex-col items-center justify-center gap-1 hover:border-purple-500/50 hover:bg-purple-500/5 transition-all group"
                      >
                        <PlusCircle className="w-5 h-5 text-neutral-500 group-hover:text-purple-400 transition-colors" />
                        <span className="text-[10px] text-neutral-500 group-hover:text-purple-400 transition-colors">Add</span>
                      </button>

                      {/* Add context dropdown */}
                      {showAddContext && (
                        <div className="absolute top-full left-0 mt-2 w-72 z-20 rounded-xl bg-neutral-800 border border-white/[0.1] shadow-2xl overflow-hidden">
                          {/* Default option */}
                          {hasDefaultAvailable && !defaultAlreadyAdded && (
                            <div className="flex items-center border-b border-white/[0.06]">
                              <button
                                onClick={handleAddDefaultContext}
                                className="flex-1 px-4 py-3 flex items-center gap-3 text-sm text-left text-white hover:bg-white/[0.05] transition-colors"
                              >
                                <div className="w-10 h-10 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center flex-shrink-0">
                                  <Sparkles className="w-5 h-5 text-amber-400" />
                                </div>
                                <div>
                                  <p className="font-medium">{isTranslated ? 'Primary Language Image' : 'Original Raw Screenshot'}</p>
                                  <p className="text-xs text-neutral-500">Default reference for consistency</p>
                                </div>
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  const url = isTranslated ? primaryImageUrl : screenshot.rawImageUrl
                                  if (url) setPreviewImage({ url, label: isTranslated ? 'Primary Language' : 'Original Raw' })
                                }}
                                className="px-3 py-3 text-neutral-400 hover:text-white hover:bg-white/[0.05] transition-colors"
                                title="Preview"
                              >
                                <Eye className="w-4 h-4" />
                              </button>
                            </div>
                          )}

                          {/* Project screenshots */}
                          {availableScreenshots.length > 0 && (
                            <div className="border-b border-white/[0.06]">
                              <p className="px-4 py-2 text-xs text-neutral-500 font-medium">From this project</p>
                              <div className="max-h-36 overflow-y-auto">
                                {availableScreenshots.slice(0, 6).map((s) => (
                                  <div key={s.id} className="flex items-center">
                                    <button
                                      onClick={() => handleAddScreenshotContext(s)}
                                      className="flex-1 px-4 py-2 flex items-center gap-3 text-sm text-left text-white hover:bg-white/[0.05] transition-colors"
                                    >
                                      <div className="w-8 h-14 rounded-lg overflow-hidden bg-neutral-700 flex-shrink-0 border border-white/[0.1]">
                                        <Image
                                          src={s.marketingImageUrl}
                                          alt=""
                                          width={32}
                                          height={56}
                                          className="w-full h-full object-cover"
                                          unoptimized
                                        />
                                      </div>
                                      <span className="truncate text-neutral-300">{s.headline || 'Screenshot'}</span>
                                    </button>
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        setPreviewImage({ url: s.marketingImageUrl, label: s.headline || 'Screenshot' })
                                      }}
                                      className="px-3 py-2 text-neutral-400 hover:text-white hover:bg-white/[0.05] transition-colors"
                                      title="Preview"
                                    >
                                      <Eye className="w-4 h-4" />
                                    </button>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Upload option */}
                          <button
                            onClick={() => fileInputRef.current?.click()}
                            className="w-full px-4 py-3 flex items-center gap-3 text-sm text-left text-white hover:bg-white/[0.05] transition-colors"
                          >
                            <div className="w-10 h-10 rounded-lg bg-green-500/10 border border-green-500/20 flex items-center justify-center flex-shrink-0">
                              <Upload className="w-5 h-5 text-green-400" />
                            </div>
                            <div>
                              <p className="font-medium">Upload Images</p>
                              <p className="text-xs text-neutral-500">Add your own reference images</p>
                            </div>
                          </button>
                          <input
                            ref={fileInputRef}
                            type="file"
                            accept="image/*"
                            multiple
                            onChange={handleFileUpload}
                            className="hidden"
                          />
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Empty state for context */}
                {contextImages.length === 0 && (
                  <p className="text-xs text-neutral-500 italic">
                    No reference images added. The AI will edit based on your prompt only.
                  </p>
                )}
              </div>

              {/* Settings Row */}
              <div className="flex items-center gap-4">
                {/* Variation count */}
                <div className="flex items-center gap-3">
                  <span className="text-sm text-neutral-400">Variations:</span>
                  <div className="flex items-center gap-1 bg-white/[0.03] rounded-lg border border-white/[0.08] p-1">
                    <button
                      onClick={() => setVariationCount(Math.max(1, variationCount - 1))}
                      disabled={variationCount <= 1}
                      className="p-1.5 rounded-md hover:bg-white/[0.08] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    >
                      <Minus className="w-3.5 h-3.5 text-white" />
                    </button>
                    <span className="w-8 text-center text-white text-sm font-medium">{variationCount}</span>
                    <button
                      onClick={() => setVariationCount(Math.min(4, variationCount + 1))}
                      disabled={variationCount >= 4}
                      className="p-1.5 rounded-md hover:bg-white/[0.08] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    >
                      <Plus className="w-3.5 h-3.5 text-white" />
                    </button>
                  </div>
                </div>
              </div>

              {/* Generate Button */}
              <button
                onClick={handleGenerate}
                disabled={isGenerating || !prompt.trim()}
                className="w-full flex items-center justify-center gap-2.5 px-6 py-3.5 rounded-xl text-sm font-semibold bg-gradient-to-r from-purple-500 to-pink-500 text-white hover:opacity-90 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-purple-500/20"
              >
                {isGenerating ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Generating {variationCount} variation{variationCount > 1 ? 's' : ''}...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
                    Generate Variations
                    {contextImages.length > 0 && (
                      <span className="ml-1 px-1.5 py-0.5 rounded bg-white/20 text-[10px]">
                        +{contextImages.length} ref
                      </span>
                    )}
                  </>
                )}
              </button>

              {error && (
                <div className="px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/20">
                  <p className="text-sm text-red-400">{error}</p>
                </div>
              )}

              {/* Variations Grid */}
              {variations.length > 0 && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-medium text-white">
                      Choose a variation
                    </h4>
                    <button
                      onClick={() => {
                        setVariations([])
                        setSelectedVariation(null)
                      }}
                      className="text-xs text-neutral-500 hover:text-neutral-300 transition-colors flex items-center gap-1"
                    >
                      <Trash2 className="w-3 h-3" />
                      Clear all
                    </button>
                  </div>

                  <div className={`grid gap-4 ${variations.length === 1 ? 'grid-cols-1 max-w-xs' : variations.length === 2 ? 'grid-cols-2' : 'grid-cols-2 lg:grid-cols-4'}`}>
                    {variations.map((variation, index) => {
                      const isSelected = selectedVariation === variation.imageUrl
                      return (
                        <div
                          key={variation.id}
                          onClick={() => handleSelectVariation(variation.imageUrl)}
                          className={`relative rounded-xl overflow-hidden border-2 transition-all cursor-pointer ${
                            isSelected
                              ? 'border-purple-500 ring-4 ring-purple-500/20'
                              : 'border-white/[0.08] hover:border-white/[0.2]'
                          }`}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault()
                              handleSelectVariation(variation.imageUrl)
                            }
                          }}
                        >
                          <div className="aspect-[9/19.5] bg-neutral-800">
                            <Image
                              src={variation.imageUrl}
                              alt={`Variation ${index + 1}`}
                              fill
                              className="object-contain"
                              unoptimized
                            />
                          </div>

                          {/* Selection indicator */}
                          <div className={`absolute top-2 right-2 w-6 h-6 rounded-full flex items-center justify-center transition-all ${
                            isSelected ? 'bg-purple-500' : 'bg-black/40'
                          }`}>
                            {isSelected ? (
                              <Check className="w-4 h-4 text-white" />
                            ) : (
                              <span className="text-xs text-white font-medium">{index + 1}</span>
                            )}
                          </div>

                          {/* Edit again button - always visible for better discoverability */}
                          <div className="absolute bottom-2 left-2 right-2 flex gap-1.5">
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                handleEditAgain(variation.imageUrl)
                              }}
                              className="flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg bg-amber-500/90 text-white text-xs font-medium hover:bg-amber-500 transition-colors shadow-lg"
                            >
                              <RefreshCw className="w-3 h-3" />
                              Refine
                            </button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Empty state */}
              {variations.length === 0 && !isGenerating && (
                <div className="rounded-2xl border border-dashed border-white/[0.1] bg-white/[0.02] p-8 text-center">
                  <div className={`w-12 h-12 rounded-xl ${isEditingVariant ? 'bg-amber-500/10 border-amber-500/20' : 'bg-purple-500/10 border-purple-500/20'} border flex items-center justify-center mx-auto mb-4`}>
                    {isEditingVariant ? (
                      <RefreshCw className="w-6 h-6 text-amber-400" />
                    ) : (
                      <Wand2 className="w-6 h-6 text-purple-400" />
                    )}
                  </div>
                  <h4 className="text-white font-medium mb-2">
                    {isEditingVariant ? `Refining Variant #${iterationCount}` : 'Ready to edit'}
                  </h4>
                  <p className="text-sm text-neutral-500 max-w-sm mx-auto">
                    {isEditingVariant
                      ? 'Continue refining this variant with additional changes, or save when satisfied'
                      : "Describe the changes you want and we'll generate variations for you to choose from"
                    }
                  </p>
                  {isEditingVariant && editHistory.length > 0 && (
                    <button
                      onClick={handleUndoIteration}
                      className="mt-4 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-amber-400 border border-amber-500/30 hover:bg-amber-500/10 transition-colors"
                    >
                      <Undo2 className="w-3 h-3" />
                      Go back to previous version
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-white/[0.06] flex items-center justify-between flex-shrink-0 bg-neutral-900/50">
          <div className="text-sm text-neutral-500">
            {selectedVariation ? (
              <span className="text-purple-400">Variation selected • Click Save to apply</span>
            ) : isEditingVariant && variations.length === 0 ? (
              <span className="text-amber-400">
                Refining variant #{iterationCount} • Generate more or save current
              </span>
            ) : variations.length > 0 ? (
              'Click a variation to select, or click Refine to keep editing'
            ) : (
              'Enter a prompt to get started'
            )}
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="px-5 py-2.5 rounded-xl text-sm font-medium text-neutral-300 hover:text-white hover:bg-white/[0.05] transition-colors"
            >
              Cancel
            </button>
            {/* Show "Save Current" when editing a variant without new variations */}
            {isEditingVariant && variations.length === 0 && !selectedVariation && (
              <button
                onClick={() => {
                  setSelectedVariation(currentImage)
                }}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium border border-amber-500/50 text-amber-400 hover:bg-amber-500/10 transition-colors"
              >
                <Check className="w-4 h-4" />
                Use Current Variant
              </button>
            )}
            <button
              onClick={handleSave}
              disabled={!selectedVariation || isSaving}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold bg-green-500 text-white hover:bg-green-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSaving ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Check className="w-4 h-4" />
                  Save Changes
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Reference Image Preview Lightbox */}
      {previewImage && (
        <div
          className="fixed inset-0 z-[110] flex items-center justify-center p-8"
          onClick={() => setPreviewImage(null)}
        >
          <div className="absolute inset-0 bg-black/90" />
          <div className="relative max-w-4xl max-h-full flex flex-col items-center">
            {/* Close button */}
            <button
              onClick={() => setPreviewImage(null)}
              className="absolute -top-12 right-0 p-2 rounded-lg bg-white/10 hover:bg-white/20 transition-colors"
            >
              <X className="w-5 h-5 text-white" />
            </button>

            {/* Image */}
            <div className="relative rounded-2xl overflow-hidden bg-neutral-900 border border-white/[0.1] shadow-2xl">
              <Image
                src={previewImage.url}
                alt={previewImage.label}
                width={800}
                height={1200}
                className="max-h-[80vh] w-auto object-contain"
                unoptimized
                onClick={(e) => e.stopPropagation()}
              />
            </div>

            {/* Label */}
            <div className="mt-4 px-4 py-2 rounded-lg bg-white/10 text-white text-sm font-medium">
              {previewImage.label}
            </div>

            {/* Hint */}
            <p className="mt-2 text-neutral-500 text-xs">Click anywhere to close</p>
          </div>
        </div>
      )}
    </div>,
    document.body
  )
}
