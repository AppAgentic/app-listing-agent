'use client'

import {
  useState,
  useRef,
  useCallback,
  useEffect,
  PointerEvent as ReactPointerEvent,
} from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { AI_MODELS, getImageCreditWeight } from '@/lib/billing/catalog'
import styles from './icon-edit-modal.module.css'
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
  Zap,
  Palette,
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
import { GeneratedIconData } from '@/lib/hooks/useIconGenerator'

interface ContextImage {
  id: string
  url: string
  label: string
  type: 'upload' | 'icon'
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

interface IconEditModalProps {
  isOpen: boolean
  onClose: () => void
  onSave: () => Promise<void>
  icon: GeneratedIconData
  allIcons?: GeneratedIconData[]
  projectId: string
}

// Suggested edit prompts for quick actions
const SUGGESTED_PROMPTS = [
  {
    label: 'Adjust colors',
    icon: Palette,
    prompt: 'Adjust the color scheme to be more vibrant',
  },
  {
    label: 'Change style',
    icon: Layers,
    prompt: 'Make the design more modern and minimal',
  },
  {
    label: 'Add depth',
    icon: Sparkles,
    prompt: 'Add subtle 3D depth and shadows',
  },
  {
    label: 'Simplify',
    icon: Wand2,
    prompt: 'Simplify the design, remove unnecessary details',
  },
]

const MAX_CONTEXT_IMAGES = 4
// Both supported icon engines currently use the same 1K catalog weight.
const EDIT_CREDITS = getImageCreditWeight(
  'openai',
  AI_MODELS.openAiImagePremium,
  '1K',
)

export function IconEditModal({
  isOpen,
  onClose,
  onSave,
  icon,
  allIcons = [],
  projectId,
}: IconEditModalProps) {
  const [prompt, setPrompt] = useState('')
  const [variationCount, setVariationCount] = useState(2)
  const [contextImages, setContextImages] = useState<ContextImage[]>([])
  const [showAddContext, setShowAddContext] = useState(false)
  const [currentImage, setCurrentImage] = useState(icon.originalUrl)
  const [originalImage] = useState(icon.originalUrl)
  const [editHistory, setEditHistory] = useState<string[]>([])
  const [variations, setVariations] = useState<
    Array<{
      id: string
      imageUrl: string
      iosUrl?: string
      androidUrl?: string
    }>
  >([])
  const [isGenerating, setIsGenerating] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [creditsUsed, setCreditsUsed] = useState(0)
  const [selectedVariation, setSelectedVariation] = useState<string | null>(
    null,
  )
  const [previewImage, setPreviewImage] = useState<{
    url: string
    label: string
  } | null>(null)
  const [iterationCount, setIterationCount] = useState(0)
  const [mounted, setMounted] = useState(false)

  // Annotation state
  const [annotationMode, setAnnotationMode] = useState(false)
  const [annotationTool, setAnnotationTool] =
    useState<AnnotationTool>('freehand')
  const [annotationColor, setAnnotationColor] = useState('#ef4444')
  const [annotations, setAnnotations] = useState<Annotation[]>([])
  const [isDrawing, setIsDrawing] = useState(false)
  const [currentAnnotation, setCurrentAnnotation] = useState<Annotation | null>(
    null,
  )

  const returnFocusRef = useRef<HTMLElement | null>(null)
  useEffect(() => {
    if (isOpen) returnFocusRef.current = document.activeElement as HTMLElement
  }, [isOpen])

  const fileInputRef = useRef<HTMLInputElement>(null)
  const addContextRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        addContextRef.current &&
        !addContextRef.current.contains(e.target as Node)
      ) {
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

    const rect = container.getBoundingClientRect()
    canvas.width = rect.width
    canvas.height = rect.height

    ctx.clearRect(0, 0, canvas.width, canvas.height)

    const allAnnotations = currentAnnotation
      ? [...annotations, currentAnnotation]
      : annotations

    allAnnotations.forEach((annotation) => {
      ctx.strokeStyle = annotation.color
      ctx.lineWidth = 3
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'

      if (annotation.tool === 'freehand' && annotation.points.length > 0) {
        ctx.beginPath()
        ctx.moveTo(annotation.points[0].x, annotation.points[0].y)
        annotation.points.forEach((point) => {
          ctx.lineTo(point.x, point.y)
        })
        ctx.stroke()
      } else if (
        annotation.tool === 'rectangle' &&
        annotation.startPoint &&
        annotation.endPoint
      ) {
        const width = annotation.endPoint.x - annotation.startPoint.x
        const height = annotation.endPoint.y - annotation.startPoint.y
        ctx.strokeRect(
          annotation.startPoint.x,
          annotation.startPoint.y,
          width,
          height,
        )
      } else if (
        annotation.tool === 'circle' &&
        annotation.startPoint &&
        annotation.endPoint
      ) {
        const centerX = (annotation.startPoint.x + annotation.endPoint.x) / 2
        const centerY = (annotation.startPoint.y + annotation.endPoint.y) / 2
        const radiusX =
          Math.abs(annotation.endPoint.x - annotation.startPoint.x) / 2
        const radiusY =
          Math.abs(annotation.endPoint.y - annotation.startPoint.y) / 2
        ctx.beginPath()
        ctx.ellipse(centerX, centerY, radiusX, radiusY, 0, 0, Math.PI * 2)
        ctx.stroke()
      } else if (
        annotation.tool === 'arrow' &&
        annotation.startPoint &&
        annotation.endPoint
      ) {
        ctx.beginPath()
        ctx.moveTo(annotation.startPoint.x, annotation.startPoint.y)
        ctx.lineTo(annotation.endPoint.x, annotation.endPoint.y)
        ctx.stroke()

        const angle = Math.atan2(
          annotation.endPoint.y - annotation.startPoint.y,
          annotation.endPoint.x - annotation.startPoint.x,
        )
        const headLength = 15
        ctx.beginPath()
        ctx.moveTo(annotation.endPoint.x, annotation.endPoint.y)
        ctx.lineTo(
          annotation.endPoint.x - headLength * Math.cos(angle - Math.PI / 6),
          annotation.endPoint.y - headLength * Math.sin(angle - Math.PI / 6),
        )
        ctx.moveTo(annotation.endPoint.x, annotation.endPoint.y)
        ctx.lineTo(
          annotation.endPoint.x - headLength * Math.cos(angle + Math.PI / 6),
          annotation.endPoint.y - headLength * Math.sin(angle + Math.PI / 6),
        )
        ctx.stroke()
      }
    })
  }, [annotations, currentAnnotation, mounted, isOpen])

  // Generate annotated image for API
  const getAnnotatedImageUrl = useCallback(async (): Promise<string | null> => {
    if (annotations.length === 0) return null

    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return null

    const exportCanvas = document.createElement('canvas')
    const ctx = exportCanvas.getContext('2d')
    if (!ctx) return null

    const img = document.createElement('img')
    img.crossOrigin = 'anonymous'

    return new Promise((resolve) => {
      img.onload = () => {
        exportCanvas.width = img.width
        exportCanvas.height = img.height

        ctx.drawImage(img, 0, 0)

        const scaleX = img.width / canvas.width
        const scaleY = img.height / canvas.height

        annotations.forEach((annotation) => {
          ctx.strokeStyle = annotation.color
          ctx.lineWidth = 4 * Math.max(scaleX, scaleY)
          ctx.lineCap = 'round'
          ctx.lineJoin = 'round'

          if (annotation.tool === 'freehand' && annotation.points.length > 0) {
            ctx.beginPath()
            ctx.moveTo(
              annotation.points[0].x * scaleX,
              annotation.points[0].y * scaleY,
            )
            annotation.points.forEach((point) => {
              ctx.lineTo(point.x * scaleX, point.y * scaleY)
            })
            ctx.stroke()
          } else if (
            annotation.tool === 'rectangle' &&
            annotation.startPoint &&
            annotation.endPoint
          ) {
            const x = annotation.startPoint.x * scaleX
            const y = annotation.startPoint.y * scaleY
            const width =
              (annotation.endPoint.x - annotation.startPoint.x) * scaleX
            const height =
              (annotation.endPoint.y - annotation.startPoint.y) * scaleY
            ctx.strokeRect(x, y, width, height)
          } else if (
            annotation.tool === 'circle' &&
            annotation.startPoint &&
            annotation.endPoint
          ) {
            const centerX =
              ((annotation.startPoint.x + annotation.endPoint.x) / 2) * scaleX
            const centerY =
              ((annotation.startPoint.y + annotation.endPoint.y) / 2) * scaleY
            const radiusX =
              (Math.abs(annotation.endPoint.x - annotation.startPoint.x) / 2) *
              scaleX
            const radiusY =
              (Math.abs(annotation.endPoint.y - annotation.startPoint.y) / 2) *
              scaleY
            ctx.beginPath()
            ctx.ellipse(centerX, centerY, radiusX, radiusY, 0, 0, Math.PI * 2)
            ctx.stroke()
          } else if (
            annotation.tool === 'arrow' &&
            annotation.startPoint &&
            annotation.endPoint
          ) {
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
            ctx.lineTo(
              endX - headLength * Math.cos(angle - Math.PI / 6),
              endY - headLength * Math.sin(angle - Math.PI / 6),
            )
            ctx.moveTo(endX, endY)
            ctx.lineTo(
              endX - headLength * Math.cos(angle + Math.PI / 6),
              endY - headLength * Math.sin(angle + Math.PI / 6),
            )
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
      const contextUrls = contextImages.map((img) => img.url)
      const annotatedImage = await getAnnotatedImageUrl()

      let finalPrompt = prompt.trim()
      if (annotatedImage) {
        finalPrompt = `${finalPrompt}\n\nNote: The image has been annotated with colored markings to highlight specific areas. Please pay special attention to the areas marked/highlighted in the annotations and apply the edit instruction to those areas.`
      }

      const response = await fetch('/api/icons/edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          iconId: icon.id,
          prompt: finalPrompt,
          contextImageUrls: contextUrls.length > 0 ? contextUrls : undefined,
          variationCount,
          currentImageUrl:
            annotatedImage ||
            (currentImage !== icon.originalUrl ? currentImage : undefined),
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to generate variations')
      }

      const data = await response.json()
      setVariations(data.variations)
      // Edit generations spend icon credits; let the allowance badge refresh.
      window.dispatchEvent(new Event('icons:usage-changed'))
      setCreditsUsed((prev) => prev + data.creditsUsed)
      if (data.variations.length > 0) {
        setSelectedVariation(data.variations[0].imageUrl)
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to generate variations',
      )
    } finally {
      setIsGenerating(false)
    }
  }, [
    prompt,
    projectId,
    icon.id,
    contextImages,
    variationCount,
    currentImage,
    icon.originalUrl,
    getAnnotatedImageUrl,
  ])

  const handleSelectVariation = useCallback((imageUrl: string) => {
    setSelectedVariation(imageUrl)
  }, [])

  const handleEditAgain = useCallback(
    (imageUrl: string) => {
      setEditHistory((prev) => [...prev, currentImage])
      setCurrentImage(imageUrl)
      setVariations([])
      setSelectedVariation(null)
      setPrompt('')
      setAnnotations([])
      setIterationCount((prev) => prev + 1)
    },
    [currentImage],
  )

  const handleUndoIteration = useCallback(() => {
    if (editHistory.length === 0) return
    const previousImage = editHistory[editHistory.length - 1]
    setEditHistory((prev) => prev.slice(0, -1))
    setCurrentImage(previousImage)
    setVariations([])
    setSelectedVariation(null)
    setAnnotations([])
    setIterationCount((prev) => Math.max(0, prev - 1))
  }, [editHistory])

  const handleSave = useCallback(async () => {
    if (!selectedVariation) return

    setIsSaving(true)
    setError(null)

    try {
      const discardUrls = variations
        .filter((v) => v.imageUrl !== selectedVariation)
        .map((v) => v.imageUrl)

      const selectedVar = variations.find(
        (v) => v.imageUrl === selectedVariation,
      )

      const response = await fetch('/api/icons/edit/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          iconId: icon.id,
          selectedImageUrl: selectedVariation,
          selectedIosUrl: selectedVar?.iosUrl,
          selectedAndroidUrl: selectedVar?.androidUrl,
          discardUrls,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to save icon')
      }

      await onSave()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setIsSaving(false)
    }
  }, [variations, selectedVariation, onSave, onClose, projectId, icon.id])

  const handleReset = useCallback(() => {
    setCurrentImage(originalImage)
    setVariations([])
    setSelectedVariation(null)
    setPrompt('')
    setAnnotations([])
    setEditHistory([])
    setIterationCount(0)
  }, [originalImage])

  const handleFileUpload = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files
      if (!files || files.length === 0) return

      Array.from(files).forEach((file, index) => {
        if (contextImages.length + index >= MAX_CONTEXT_IMAGES) return

        const reader = new FileReader()
        reader.onload = (ev) => {
          const dataUrl = ev.target?.result as string
          setContextImages((prev) => {
            if (prev.length >= MAX_CONTEXT_IMAGES) return prev
            return [
              ...prev,
              {
                id: `upload-${Date.now()}-${index}`,
                url: dataUrl,
                label: file.name.slice(0, 20),
                type: 'upload',
              },
            ]
          })
        }
        reader.readAsDataURL(file)
      })

      setShowAddContext(false)
      e.target.value = ''
    },
    [contextImages.length],
  )

  const handleAddIconContext = useCallback(
    (i: GeneratedIconData) => {
      if (contextImages.length >= MAX_CONTEXT_IMAGES) return
      if (contextImages.some((c) => c.url === i.originalUrl)) return

      setContextImages((prev) => [
        ...prev,
        {
          id: `icon-${i.id}`,
          url: i.originalUrl,
          label: i.style || 'Icon',
          type: 'icon',
        },
      ])
      setShowAddContext(false)
    },
    [contextImages],
  )

  const handleRemoveContext = useCallback((id: string) => {
    setContextImages((prev) => prev.filter((c) => c.id !== id))
  }, [])

  const handleSuggestedPrompt = useCallback((suggestedPrompt: string) => {
    setPrompt(suggestedPrompt)
  }, [])

  // Annotation handlers
  const getCanvasPoint = useCallback(
    (e: ReactPointerEvent<HTMLCanvasElement>): Point => {
      const canvas = canvasRef.current
      if (!canvas) return { x: 0, y: 0 }
      const rect = canvas.getBoundingClientRect()
      return {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      }
    },
    [],
  )

  const handleCanvasMouseDown = useCallback(
    (e: ReactPointerEvent<HTMLCanvasElement>) => {
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
    },
    [annotationMode, annotationTool, annotationColor, getCanvasPoint],
  )

  const handleCanvasMouseMove = useCallback(
    (e: ReactPointerEvent<HTMLCanvasElement>) => {
      if (!isDrawing || !currentAnnotation) return

      const point = getCanvasPoint(e)

      if (currentAnnotation.tool === 'freehand') {
        setCurrentAnnotation((prev) =>
          prev
            ? {
                ...prev,
                points: [...prev.points, point],
              }
            : null,
        )
      } else {
        setCurrentAnnotation((prev) =>
          prev
            ? {
                ...prev,
                endPoint: point,
              }
            : null,
        )
      }
    },
    [isDrawing, currentAnnotation, getCanvasPoint],
  )

  const handleCanvasMouseUp = useCallback(() => {
    if (!isDrawing || !currentAnnotation) return

    setIsDrawing(false)
    setAnnotations((prev) => [...prev, currentAnnotation])
    setCurrentAnnotation(null)
  }, [isDrawing, currentAnnotation])

  const handleUndoAnnotation = useCallback(() => {
    setAnnotations((prev) => prev.slice(0, -1))
  }, [])

  const handleClearAnnotations = useCallback(() => {
    setAnnotations([])
  }, [])

  if (!isOpen) return null
  if (!mounted) return null

  const hasEdits = currentImage !== originalImage
  const isEditingVariant = iterationCount > 0
  const displayImage = currentImage
  const canAddMoreContext = contextImages.length < MAX_CONTEXT_IMAGES
  const availableIcons = allIcons.filter(
    (i) =>
      i.id !== icon.id && !contextImages.some((c) => c.url === i.originalUrl),
  )

  return (
    <Dialog.Root
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className={styles.overlay} />
        <Dialog.Content
          className={styles.panel}
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            returnFocusRef.current?.focus()
          }}
        >
          {/* Header */}
          <div className="px-6 py-4 border-b border-white/[0.06] flex items-center justify-between flex-shrink-0">
            <div className="flex items-center gap-4">
              <div className="p-2.5 rounded-xl bg-violet-500/10 border border-violet-500/20">
                <Wand2 className="w-5 h-5 text-violet-400" />
              </div>
              <div>
                <Dialog.Title className="text-xl font-semibold tracking-tight text-white">
                  Edit icon
                </Dialog.Title>
                <Dialog.Description className="text-sm text-neutral-400">
                  Refine your icon, then compare the result
                  {isEditingVariant && (
                    <span className="ml-2 text-violet-400">
                      Iteration {iterationCount}
                    </span>
                  )}
                  {hasEdits && !isEditingVariant && (
                    <span className="ml-2 text-violet-400">Modified</span>
                  )}
                </Dialog.Description>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {editHistory.length > 0 && (
                <button
                  onClick={handleUndoIteration}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-violet-400 hover:text-violet-300 hover:bg-violet-500/10 transition-colors"
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
                  Reset
                </button>
              )}
              <button
                onClick={onClose}
                aria-label="Close editor"
                className="p-2 rounded-lg hover:bg-white/[0.05] transition-colors"
              >
                <X className="w-5 h-5 text-neutral-400" />
              </button>
            </div>
          </div>

          {/* Main Content */}
          <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
            <div className="flex flex-col lg:flex-row min-h-full">
              {/* Left Panel - Icon Preview */}
              <div className="lg:w-[300px] xl:w-[340px] flex-shrink-0 p-6 border-b lg:border-b-0 lg:border-r border-white/[0.06] bg-neutral-900/30">
                <div className="sticky top-0 space-y-4">
                  {/* Icon container */}
                  <div
                    ref={containerRef}
                    data-annotating={annotationMode}
                    className={`${styles.annotationCanvas} relative rounded-2xl overflow-hidden bg-neutral-800/50 border ${annotationMode ? 'border-violet-500/50' : 'border-white/[0.06]'}`}
                  >
                    <div className="relative aspect-square">
                      <Image
                        src={displayImage}
                        alt="Icon preview"
                        fill
                        className="object-contain"
                        unoptimized
                      />
                      {/* Canvas overlay for annotations */}
                      <canvas
                        ref={canvasRef}
                        className={`absolute inset-0 w-full h-full ${annotationMode ? 'cursor-crosshair touch-none' : 'pointer-events-none'}`}
                        onPointerDown={(event) => {
                          event.currentTarget.setPointerCapture(event.pointerId)
                          handleCanvasMouseDown(event)
                        }}
                        onPointerMove={handleCanvasMouseMove}
                        onPointerUp={handleCanvasMouseUp}
                        onPointerCancel={handleCanvasMouseUp}
                      />
                    </div>

                    {/* Badges */}
                    <div className="absolute top-3 left-3 flex flex-col gap-2 pointer-events-none">
                      {annotationMode && (
                        <span className="px-2.5 py-1 rounded-lg bg-violet-500/90 text-white text-xs font-medium shadow-lg">
                          Annotating
                        </span>
                      )}
                      {isEditingVariant ? (
                        <span className="px-2.5 py-1 rounded-lg bg-violet-500/90 text-white text-xs font-medium shadow-lg">
                          Variant #{iterationCount}
                        </span>
                      ) : (
                        <span className="px-2.5 py-1 rounded-lg bg-neutral-700/90 text-white text-xs font-medium shadow-lg">
                          Original
                        </span>
                      )}
                      {annotations.length > 0 && !annotationMode && (
                        <span className="px-2.5 py-1 rounded-lg bg-violet-500/90 text-white text-xs font-medium shadow-lg">
                          {annotations.length} mark
                          {annotations.length > 1 ? 's' : ''}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Annotation Toolbar */}
                  <div className="space-y-3">
                    <button
                      aria-pressed={annotationMode}
                      onClick={() => setAnnotationMode(!annotationMode)}
                      className={`w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all ${
                        annotationMode
                          ? 'bg-violet-500 text-white'
                          : 'bg-white/[0.03] text-neutral-300 border border-white/[0.08] hover:bg-white/[0.06]'
                      }`}
                    >
                      <Pencil className="w-4 h-4" />
                      {annotationMode ? 'Done annotating' : 'Annotate icon'}
                    </button>

                    {annotationMode && (
                      <div className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.08] space-y-3">
                        <div className="flex items-center gap-1">
                          {[
                            {
                              tool: 'freehand' as AnnotationTool,
                              icon: Pencil,
                              label: 'Draw',
                            },
                            {
                              tool: 'rectangle' as AnnotationTool,
                              icon: Square,
                              label: 'Rectangle',
                            },
                            {
                              tool: 'circle' as AnnotationTool,
                              icon: Circle,
                              label: 'Circle',
                            },
                            {
                              tool: 'arrow' as AnnotationTool,
                              icon: MousePointer2,
                              label: 'Arrow',
                            },
                          ].map(({ tool, icon: Icon, label }) => (
                            <button
                              key={tool}
                              onClick={() => setAnnotationTool(tool)}
                              className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-2 rounded-lg text-xs font-medium transition-colors ${
                                annotationTool === tool
                                  ? 'bg-violet-500/20 text-violet-400 border border-violet-500/30'
                                  : 'text-neutral-400 hover:text-white hover:bg-white/[0.05]'
                              }`}
                              aria-label={label}
                              aria-pressed={annotationTool === tool}
                              title={label}
                            >
                              <Icon className="w-4 h-4" />
                            </button>
                          ))}
                        </div>

                        <div className="flex items-center justify-center gap-2">
                          {ANNOTATION_COLORS.map((color) => (
                            <button
                              key={color.value}
                              onClick={() => setAnnotationColor(color.value)}
                              className={`w-6 h-6 rounded-full transition-transform ${
                                annotationColor === color.value
                                  ? 'ring-2 ring-white ring-offset-2 ring-offset-neutral-900 scale-110'
                                  : 'hover:scale-110'
                              }`}
                              style={{ backgroundColor: color.value }}
                              aria-label={`${color.name} annotation`}
                              aria-pressed={annotationColor === color.value}
                              title={color.name}
                            />
                          ))}
                        </div>

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
                            Clear
                          </button>
                        </div>

                        <p className="text-xs text-neutral-500 text-center">
                          Draw on the icon to highlight areas for the AI to
                          focus on
                        </p>
                      </div>
                    )}
                  </div>

                  <section aria-label="Before and after" className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <figure>
                        <figcaption className="mb-2 text-xs text-neutral-400">
                          Before
                        </figcaption>
                        <div className="relative aspect-square overflow-hidden rounded-xl bg-neutral-800">
                          <Image
                            src={originalImage}
                            alt="Original icon before edits"
                            fill
                            className="object-contain p-2"
                            unoptimized
                          />
                        </div>
                      </figure>
                      <figure aria-busy={isGenerating}>
                        <figcaption className="mb-2 text-xs text-violet-300">
                          After
                        </figcaption>
                        <div className="relative aspect-square overflow-hidden rounded-xl bg-neutral-800 border border-violet-500/30">
                          {isGenerating ? (
                            <div className={styles.skeleton} />
                          ) : (
                            <Image
                              src={selectedVariation || currentImage}
                              alt={
                                selectedVariation || hasEdits
                                  ? 'Edited icon preview'
                                  : 'Unchanged icon preview'
                              }
                              fill
                              className="object-contain p-2"
                              unoptimized
                            />
                          )}
                        </div>
                      </figure>
                    </div>
                    <p
                      role="status"
                      className="text-xs leading-relaxed text-neutral-400"
                    >
                      {isGenerating
                        ? 'Creating your variations…'
                        : selectedVariation
                          ? 'Selected variation. Save when you’re happy with the result.'
                          : hasEdits
                            ? 'Your current refinement. Generate more or use this version.'
                            : 'Your original is shown on both sides until you generate a variation.'}
                    </p>
                  </section>

                  {/* Credit indicator */}
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-neutral-500">
                      <Zap className="w-3.5 h-3.5 inline mr-1 text-violet-400" />
                      {variationCount * EDIT_CREDITS} credits per generation ·{' '}
                      {EDIT_CREDITS} each
                    </span>
                    {creditsUsed > 0 && (
                      <span className="text-violet-400">
                        {creditsUsed} used
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Right Panel - Controls & Variations */}
              <div className="flex-1 min-w-0 p-6 space-y-6">
                {/* Prompt Section */}
                <div className="space-y-3">
                  <label
                    htmlFor="icon-edit-prompt"
                    className="block text-sm font-medium text-white"
                  >
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
                            ? 'bg-violet-500/20 text-violet-300 border border-violet-500/30'
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
                    id="icon-edit-prompt"
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder="Describe the changes you want, e.g., 'Make the colors more vibrant and add a subtle glow effect'"
                    className="w-full h-24 px-4 py-3 rounded-xl bg-white/[0.03] border border-white/[0.08] text-white placeholder-neutral-500 text-sm resize-none focus:outline-none focus:border-violet-500/50 focus:ring-2 focus:ring-violet-500/20 transition-all"
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
                          Add reference images to guide the AI. Use these for
                          style inspiration or design elements you want
                          incorporated.
                        </div>
                      </div>
                    </div>
                    <span className="text-xs text-neutral-500">
                      {contextImages.length}/{MAX_CONTEXT_IMAGES}
                    </span>
                  </div>

                  {/* Context images grid */}
                  <div className="flex flex-wrap gap-3">
                    {contextImages.map((img) => (
                      <div key={img.id} className="relative group">
                        <button
                          onClick={() =>
                            setPreviewImage({ url: img.url, label: img.label })
                          }
                          className="w-16 h-16 rounded-xl overflow-hidden bg-neutral-800 border border-white/[0.1] ring-2 ring-violet-500/30 hover:ring-violet-500/60 transition-all cursor-zoom-in"
                        >
                          <Image
                            src={img.url}
                            alt={img.label}
                            width={64}
                            height={64}
                            className="w-full h-full object-cover"
                            unoptimized
                          />
                          <div className="absolute inset-0 bg-neutral-950/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                            <Eye className="w-4 h-4 text-white" />
                          </div>
                        </button>
                        <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded bg-violet-500/90 text-xs text-white font-medium whitespace-nowrap max-w-[70px] truncate">
                          {img.label}
                        </div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            handleRemoveContext(img.id)
                          }}
                          aria-label={`Remove ${img.label} reference`}
                          className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-violet-500 text-white flex items-center justify-center transition-opacity shadow-lg hover:bg-violet-600 z-10"
                        >
                          <X className="w-3 h-3" />
                        </button>
                        <div className="absolute top-1 left-1 w-4 h-4 rounded bg-neutral-950/60 flex items-center justify-center pointer-events-none">
                          {img.type === 'icon' && (
                            <ImageIcon className="w-2.5 h-2.5 text-violet-400" />
                          )}
                          {img.type === 'upload' && (
                            <Upload className="w-2.5 h-2.5 text-violet-400" />
                          )}
                        </div>
                      </div>
                    ))}

                    {/* Add context button */}
                    {canAddMoreContext && (
                      <div className="relative" ref={addContextRef}>
                        <button
                          onClick={() => setShowAddContext(!showAddContext)}
                          className="w-16 h-16 rounded-xl border-2 border-dashed border-white/[0.15] bg-white/[0.02] flex flex-col items-center justify-center gap-1 hover:border-violet-500/50 hover:bg-violet-500/5 transition-all group"
                        >
                          <PlusCircle className="w-5 h-5 text-neutral-500 group-hover:text-violet-400 transition-colors" />
                          <span className="text-xs text-neutral-500 group-hover:text-violet-400 transition-colors">
                            Add
                          </span>
                        </button>

                        {showAddContext && (
                          <div className="absolute top-full left-0 mt-2 w-64 z-20 rounded-xl bg-neutral-800 border border-white/[0.1] shadow-2xl overflow-hidden">
                            {/* Project icons */}
                            {availableIcons.length > 0 && (
                              <div className="border-b border-white/[0.06]">
                                <p className="px-4 py-2 text-xs text-neutral-500 font-medium">
                                  From this project
                                </p>
                                <div className="max-h-36 overflow-y-auto">
                                  {availableIcons.slice(0, 6).map((i) => (
                                    <div
                                      key={i.id}
                                      className="flex items-center"
                                    >
                                      <button
                                        onClick={() => handleAddIconContext(i)}
                                        className="flex-1 px-4 py-2 flex items-center gap-3 text-sm text-left text-white hover:bg-white/[0.05] transition-colors"
                                      >
                                        <div className="w-10 h-10 rounded-lg overflow-hidden bg-neutral-700 flex-shrink-0 border border-white/[0.1]">
                                          <Image
                                            src={i.originalUrl}
                                            alt=""
                                            width={40}
                                            height={40}
                                            className="w-full h-full object-cover"
                                            unoptimized
                                          />
                                        </div>
                                        <span className="truncate text-neutral-300 capitalize">
                                          {i.style || 'Icon'}
                                        </span>
                                      </button>
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation()
                                          setPreviewImage({
                                            url: i.originalUrl,
                                            label: i.style || 'Icon',
                                          })
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
                              <div className="w-10 h-10 rounded-lg bg-violet-500/10 border border-violet-500/20 flex items-center justify-center flex-shrink-0">
                                <Upload className="w-5 h-5 text-violet-400" />
                              </div>
                              <div>
                                <p className="font-medium">Upload Images</p>
                                <p className="text-xs text-neutral-500">
                                  Add your own reference images
                                </p>
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

                  {contextImages.length === 0 && (
                    <p className="text-xs text-neutral-500 italic">
                      No reference images added. The AI will edit based on your
                      prompt only.
                    </p>
                  )}
                </div>

                {/* Settings Row */}
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-neutral-400">
                      Variations:
                    </span>
                    <div className="flex items-center gap-1 bg-white/[0.03] rounded-lg border border-white/[0.08] p-1">
                      <button
                        aria-label="Fewer variations"
                        onClick={() =>
                          setVariationCount(Math.max(1, variationCount - 1))
                        }
                        disabled={variationCount <= 1}
                        className="p-1.5 rounded-md hover:bg-white/[0.08] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                      >
                        <Minus className="w-3.5 h-3.5 text-white" />
                      </button>
                      <span className="w-8 text-center text-white text-sm font-medium">
                        {variationCount}
                      </span>
                      <button
                        aria-label="More variations"
                        onClick={() =>
                          setVariationCount(Math.min(4, variationCount + 1))
                        }
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
                  disabled={isGenerating || isSaving || !prompt.trim()}
                  className="w-full flex items-center justify-center gap-2.5 px-6 py-3.5 rounded-xl text-sm font-semibold bg-violet-600 hover:bg-violet-500 text-white hover:opacity-90 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-violet-500/20"
                >
                  {isGenerating ? (
                    <>
                      <span
                        className="h-4 w-4 rounded bg-white/20 motion-safe:animate-pulse"
                        aria-hidden="true"
                      />
                      Generating {variationCount} variation
                      {variationCount > 1 ? 's' : ''}...
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4" />
                      Generate variations · {variationCount * EDIT_CREDITS}{' '}
                      credits
                      {contextImages.length > 0 && (
                        <span className="ml-1 px-1.5 py-0.5 rounded bg-white/20 text-xs">
                          +{contextImages.length} ref
                        </span>
                      )}
                    </>
                  )}
                </button>

                {error && (
                  <div
                    role="alert"
                    className="px-4 py-3 rounded-xl bg-violet-500/10 border border-violet-500/20"
                  >
                    <p className="text-sm text-violet-400">{error}</p>
                  </div>
                )}

                {isGenerating && (
                  <div
                    aria-label="Loading variations"
                    className="grid grid-cols-2 gap-4"
                  >
                    {Array.from({ length: variationCount }, (_, index) => (
                      <div
                        key={index}
                        className={`${styles.skeleton} aspect-square rounded-xl`}
                      />
                    ))}
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

                    <div
                      className={`grid gap-4 ${variations.length === 1 ? 'grid-cols-2' : variations.length === 2 ? 'grid-cols-2' : 'grid-cols-2 lg:grid-cols-4'}`}
                    >
                      {variations.map((variation, index) => {
                        const isSelected =
                          selectedVariation === variation.imageUrl
                        return (
                          <div
                            key={variation.id}
                            className={`relative rounded-xl overflow-hidden border-2 transition-all cursor-pointer ${
                              isSelected
                                ? 'border-violet-500 ring-4 ring-violet-500/20'
                                : 'border-white/[0.08] hover:border-white/[0.2]'
                            }`}
                          >
                            <button
                              type="button"
                              aria-label={`Select variation ${index + 1}`}
                              aria-pressed={isSelected}
                              onClick={() =>
                                handleSelectVariation(variation.imageUrl)
                              }
                              className="absolute inset-0 z-10 rounded-xl"
                            />
                            <div className="relative aspect-square bg-neutral-800">
                              <Image
                                src={variation.imageUrl}
                                alt={`Variation ${index + 1}`}
                                fill
                                className="object-contain p-2"
                                unoptimized
                              />
                            </div>

                            {/* Selection indicator */}
                            <div
                              className={`absolute top-2 right-2 w-6 h-6 rounded-full flex items-center justify-center transition-all ${
                                isSelected
                                  ? 'bg-violet-500'
                                  : 'bg-neutral-950/40'
                              }`}
                            >
                              {isSelected ? (
                                <Check className="w-4 h-4 text-white" />
                              ) : (
                                <span className="text-xs text-white font-medium">
                                  {index + 1}
                                </span>
                              )}
                            </div>

                            {/* Edit again button */}
                            <div className="absolute bottom-2 left-2 right-2 z-20 flex gap-1.5">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  handleEditAgain(variation.imageUrl)
                                }}
                                className="flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg bg-violet-500/90 text-white text-xs font-medium hover:bg-violet-500 transition-colors shadow-lg"
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
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t border-white/[0.06] flex flex-wrap gap-3 items-center justify-between flex-shrink-0 bg-neutral-900/50">
            <div className="text-sm text-neutral-500">
              {selectedVariation ? (
                <span className="text-violet-400">
                  Variation selected - Click Save to apply
                </span>
              ) : isEditingVariant && variations.length === 0 ? (
                <span className="text-violet-400">
                  Refining variant #{iterationCount} - Generate more or save
                  current
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
              {isEditingVariant &&
                variations.length === 0 &&
                !selectedVariation && (
                  <button
                    onClick={() => {
                      setSelectedVariation(currentImage)
                    }}
                    className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium border border-violet-500/50 text-violet-400 hover:bg-violet-500/10 transition-colors"
                  >
                    <Check className="w-4 h-4" />
                    Use Current
                  </button>
                )}
              <button
                onClick={handleSave}
                disabled={!selectedVariation || isSaving || isGenerating}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold bg-violet-600 text-white hover:bg-violet-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSaving ? (
                  <>
                    <span
                      className="h-4 w-4 rounded bg-white/20 motion-safe:animate-pulse"
                      aria-hidden="true"
                    />
                    Saving...
                  </>
                ) : (
                  <>
                    <Check className="w-4 h-4" />
                    Save changes
                  </>
                )}
              </button>
            </div>
          </div>
          {/* Reference Image Preview Lightbox */}
          {previewImage && (
            <Dialog.Root
              open
              onOpenChange={(open) => {
                if (!open) setPreviewImage(null)
              }}
            >
              <Dialog.Portal>
                <Dialog.Overlay className="fixed inset-0 z-[110] bg-neutral-950/90" />
                <Dialog.Content
                  aria-describedby={undefined}
                  className={`${styles.preview} fixed inset-0 z-[111] flex items-center justify-center p-8`}
                >
                  <Dialog.Title className="sr-only">
                    {previewImage.label} reference preview
                  </Dialog.Title>
                  <div className="relative max-w-2xl max-h-full flex flex-col items-center">
                    <button
                      onClick={() => setPreviewImage(null)}
                      aria-label="Close reference preview"
                      className="absolute -top-12 right-0 p-2 rounded-lg bg-white/10 hover:bg-white/20 transition-colors"
                    >
                      <X className="w-5 h-5 text-white" />
                    </button>

                    <div className="relative rounded-2xl overflow-hidden bg-neutral-900 border border-white/[0.1] shadow-2xl">
                      <Image
                        src={previewImage.url}
                        alt={previewImage.label}
                        width={512}
                        height={512}
                        className="max-h-[70vh] w-auto object-contain"
                        unoptimized
                        onClick={(e) => e.stopPropagation()}
                      />
                    </div>

                    <div className="mt-4 px-4 py-2 rounded-lg bg-white/10 text-white text-sm font-medium">
                      {previewImage.label}
                    </div>

                    <p className="mt-2 text-neutral-500 text-xs">
                      Press Escape to close
                    </p>
                  </div>
                </Dialog.Content>
              </Dialog.Portal>
            </Dialog.Root>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
