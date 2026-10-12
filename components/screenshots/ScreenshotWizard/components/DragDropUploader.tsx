'use client'

import { useState, useRef, useCallback } from 'react'
import { Upload, X, GripVertical, AlertCircle, Image, Check, FileImage } from 'lucide-react'
import { RawImageData } from '../WizardContext'
import { SCREENSHOT_DISPLAY_TYPES, ScreenshotDisplayType } from '@/lib/firebase/firestore'

interface DragDropUploaderProps {
  images: RawImageData[]
  displayType: ScreenshotDisplayType
  onImagesAdded: (images: RawImageData[]) => void
  onImageRemoved: (imageId: string) => void
  onImagesReordered: (images: RawImageData[]) => void
  maxImages?: number
}

export function DragDropUploader({
  images,
  displayType,
  onImagesAdded,
  onImageRemoved,
  onImagesReordered,
  maxImages = 10,
}: DragDropUploaderProps) {
  const [isDragging, setIsDragging] = useState(false)
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [recentlyAdded, setRecentlyAdded] = useState<Set<string>>(new Set())
  const fileInputRef = useRef<HTMLInputElement>(null)

  const deviceInfo = SCREENSHOT_DISPLAY_TYPES[displayType]
  const aspectRatio = deviceInfo.width / deviceInfo.height

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
  }, [])

  const processFiles = useCallback((files: FileList) => {
    setError(null)
    const validTypes = ['image/png', 'image/jpeg', 'image/webp']
    const maxSize = 10 * 1024 * 1024  // 10MB

    const newImages: RawImageData[] = []

    Array.from(files).forEach(file => {
      if (!validTypes.includes(file.type)) {
        setError('Only PNG, JPEG, and WebP files are allowed')
        return
      }
      if (file.size > maxSize) {
        setError('Files must be under 10MB')
        return
      }
      if (images.length + newImages.length >= maxImages) {
        setError(`Maximum ${maxImages} images allowed`)
        return
      }

      const id = `img-${Date.now()}-${Math.random().toString(36).substring(7)}`
      newImages.push({
        id,
        file,
        url: URL.createObjectURL(file),
        name: file.name,
      })
    })

    if (newImages.length > 0) {
      onImagesAdded(newImages)
      // Highlight newly added images
      const newIds = new Set(newImages.map(img => img.id))
      setRecentlyAdded(newIds)
      setTimeout(() => setRecentlyAdded(new Set()), 2000)
    }
  }, [images.length, maxImages, onImagesAdded])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)

    if (e.dataTransfer.files.length > 0) {
      processFiles(e.dataTransfer.files)
    }
  }, [processFiles])

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      processFiles(e.target.files)
    }
    // Reset input so same file can be selected again
    e.target.value = ''
  }, [processFiles])

  const handleReorderDragStart = (e: React.DragEvent, index: number) => {
    setDraggedIndex(index)
    e.dataTransfer.effectAllowed = 'move'
  }

  const handleReorderDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault()
    setDragOverIndex(index)
    if (draggedIndex === null || draggedIndex === index) return

    const newImages = [...images]
    const draggedImage = newImages[draggedIndex]
    newImages.splice(draggedIndex, 1)
    newImages.splice(index, 0, draggedImage)
    onImagesReordered(newImages)
    setDraggedIndex(index)
  }

  const handleReorderDragEnd = () => {
    setDraggedIndex(null)
    setDragOverIndex(null)
  }

  const progressPercent = (images.length / maxImages) * 100

  return (
    <div className="space-y-5">
      {/* Drop zone */}
      <div
        onClick={() => fileInputRef.current?.click()}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`
          relative rounded-2xl overflow-hidden cursor-pointer
          transition-all duration-300 group
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
            : 'border-white/[0.1] group-hover:border-white/[0.2]'
          }
        `} />

        {/* Content */}
        <div className="relative p-10 text-center">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            multiple
            onChange={handleFileSelect}
            className="hidden"
          />

          <div className={`
            w-16 h-16 mx-auto mb-4 rounded-2xl flex items-center justify-center
            transition-all duration-300
            ${isDragging
              ? 'bg-purple-500/20 scale-110'
              : 'bg-white/[0.03] group-hover:bg-white/[0.05]'
            }
          `}>
            <Upload className={`w-8 h-8 transition-colors ${isDragging ? 'text-purple-400' : 'text-neutral-500'}`} />
          </div>

          <p className="text-base font-semibold text-white mb-1">
            {isDragging ? 'Drop your screenshots here' : 'Drag & drop screenshots'}
          </p>
          <p className="text-sm text-neutral-500 mb-3">
            or click to browse from your computer
          </p>

          <div className="flex items-center justify-center gap-4 text-xs text-neutral-600">
            <span className="flex items-center gap-1.5">
              <FileImage className="w-3.5 h-3.5" />
              PNG, JPEG, WebP
            </span>
            <span className="w-1 h-1 rounded-full bg-neutral-700" />
            <span>{deviceInfo.width} x {deviceInfo.height}px</span>
            <span className="w-1 h-1 rounded-full bg-neutral-700" />
            <span>Max 10MB</span>
          </div>
        </div>
      </div>

      {/* Error message */}
      {error && (
        <div className="flex items-center gap-3 p-4 rounded-xl bg-red-500/10 border border-red-500/20 animate-fade-in">
          <div className="w-8 h-8 rounded-lg bg-red-500/20 flex items-center justify-center flex-shrink-0">
            <AlertCircle className="w-4 h-4 text-red-400" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium text-red-400">{error}</p>
          </div>
          <button
            onClick={() => setError(null)}
            className="text-red-400/60 hover:text-red-400 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Image grid */}
      {images.length > 0 && (
        <div className="space-y-4">
          {/* Progress bar */}
          <div className="flex items-center gap-3">
            <div className="flex-1 h-2 bg-white/[0.05] rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  progressPercent >= 100
                    ? 'bg-green-500'
                    : 'bg-gradient-to-r from-purple-500 to-blue-500'
                }`}
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            <span className="text-xs font-medium text-neutral-400 tabular-nums">
              {images.length}/{maxImages}
            </span>
          </div>

          {/* Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {images.map((image, index) => {
              const isRecentlyAdded = recentlyAdded.has(image.id)
              const isDragTarget = dragOverIndex === index && draggedIndex !== index

              return (
                <div
                  key={image.id}
                  draggable
                  onDragStart={(e) => handleReorderDragStart(e, index)}
                  onDragOver={(e) => handleReorderDragOver(e, index)}
                  onDragEnd={handleReorderDragEnd}
                  className={`
                    relative group rounded-xl overflow-hidden
                    transition-all duration-300 cursor-grab active:cursor-grabbing
                    ${draggedIndex === index ? 'opacity-50 scale-95 rotate-2' : ''}
                    ${isDragTarget ? 'ring-2 ring-purple-500 scale-105' : ''}
                    ${isRecentlyAdded ? 'ring-2 ring-green-500 animate-pulse' : ''}
                  `}
                  style={{ aspectRatio: `${aspectRatio}` }}
                >
                  {/* Image */}
                  <img
                    src={image.url}
                    alt={image.name}
                    className="w-full h-full object-cover"
                  />

                  {/* Gradient overlay */}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />

                  {/* Top controls */}
                  <div className="absolute top-0 inset-x-0 p-2 flex items-center justify-between opacity-0 group-hover:opacity-100 transition-opacity">
                    <div className="p-1.5 bg-black/50 backdrop-blur-sm rounded-lg">
                      <GripVertical className="w-4 h-4 text-white/80" />
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        onImageRemoved(image.id)
                      }}
                      className="p-1.5 bg-red-500/80 rounded-lg hover:bg-red-500 transition-colors"
                    >
                      <X className="w-4 h-4 text-white" />
                    </button>
                  </div>

                  {/* Position badge */}
                  <div className="absolute bottom-2 left-2 flex items-center gap-1 px-2 py-1 bg-black/60 backdrop-blur-sm rounded-lg">
                    <span className="text-xs font-bold text-white">{index + 1}</span>
                  </div>

                  {/* Recently added indicator */}
                  {isRecentlyAdded && (
                    <div className="absolute top-2 right-2 p-1.5 bg-green-500 rounded-lg animate-bounce">
                      <Check className="w-3 h-3 text-white" />
                    </div>
                  )}
                </div>
              )
            })}

            {/* Add more placeholder */}
            {images.length < maxImages && (
              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-white/[0.1] hover:border-purple-500/50 hover:bg-purple-500/5 transition-all group"
                style={{ aspectRatio: `${aspectRatio}` }}
              >
                <div className="w-10 h-10 rounded-xl bg-white/[0.03] group-hover:bg-purple-500/10 flex items-center justify-center transition-colors">
                  <Image className="w-5 h-5 text-neutral-500 group-hover:text-purple-400 transition-colors" />
                </div>
                <span className="text-xs text-neutral-500 group-hover:text-purple-400 transition-colors">
                  Add more
                </span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Empty state hint */}
      {images.length === 0 && (
        <div className="text-center">
          <p className="text-xs text-neutral-600">
            Start by uploading your app screenshots - we'll transform them into stunning marketing images
          </p>
        </div>
      )}
    </div>
  )
}
