'use client'

import { useState, useRef, useEffect } from 'react'
import {
  Upload,
  Image,
  ImagePlus,
  Loader2,
  Check,
  AlertCircle,
  Trash2,
  X,
  Lock,
  Info,
} from 'lucide-react'
import { canEditField, getStateConfig } from '@/lib/iap/state-config'

interface ScreenshotData {
  fileName: string
  mimeType?: string
  fileSize: number
  imageUrl?: string   // Apple CDN URL (from pull, for reference)
  r2Url?: string      // R2 storage URL (primary)
  r2Key?: string      // R2 storage key
  appStoreId?: string
}

interface MediaTabProps {
  projectId: string
  productId: string
  productName: string
  productType: 'iap' | 'subscription'
  productState: string | null  // App Store state
  onUpdated: () => void
}

type ImageType = 'reviewScreenshot' | 'promotionalImage'

// Minimum App Store review screenshot dimensions
// Apple's smallest accepted size is 640x920. Any image at or above these minimums is accepted.
const MIN_SCREENSHOT_WIDTH = 640
const MIN_SCREENSHOT_HEIGHT = 920

const IMAGE_TYPE_CONFIG = {
  reviewScreenshot: {
    title: 'Review Screenshot',
    description: 'Required for App Store review. Minimum 640×920px (portrait) or 920×640px (landscape). PNG or JPEG.',
    maxSize: '5MB',
    icon: Image,
    accept: 'image/png,image/jpeg,image/jpg',
    dimensions: 'screenshot' as const, // Validate against App Store screenshot sizes
  },
  promotionalImage: {
    title: 'Promotional Image',
    description: 'Must be exactly 1024 × 1024 pixels. PNG or JPEG, RGB color space. Used for win-back offers, offer codes, and App Store Promotion.',
    maxSize: '5MB',
    icon: ImagePlus,
    accept: 'image/png,image/jpeg,image/jpg',
    dimensions: { width: 1024, height: 1024 },
  },
}

export default function MediaTab({
  projectId,
  productId,
  productName,
  productType,
  productState,
  onUpdated,
}: MediaTabProps) {
  // Check edit permissions based on state
  const canEditScreenshot = canEditField(productState, 'reviewScreenshot')
  const canEditPromoImage = canEditField(productState, 'promotionalImage')
  const stateConfig = getStateConfig(productState)

  const [isLoadingScreenshot, setIsLoadingScreenshot] = useState(true)
  const [isLoadingPromo, setIsLoadingPromo] = useState(true)

  const [reviewScreenshot, setReviewScreenshot] = useState<ScreenshotData | null>(null)
  const [reviewPreviewUrl, setReviewPreviewUrl] = useState<string | null>(null)

  const [promotionalImage, setPromotionalImage] = useState<ScreenshotData | null>(null)
  const [promoPreviewUrl, setPromoPreviewUrl] = useState<string | null>(null)

  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [uploadingType, setUploadingType] = useState<ImageType | null>(null)
  const [deletingType, setDeletingType] = useState<ImageType | null>(null)

  const reviewInputRef = useRef<HTMLInputElement>(null)
  const promoInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    fetchImages()
  }, [projectId, productId])

  const getEndpoint = (imageType: ImageType) => {
    if (productType === 'subscription') {
      return imageType === 'promotionalImage'
        ? `/api/subscriptions/${productId}/promotional-image`
        : `/api/subscriptions/${productId}/screenshot`
    }
    return imageType === 'promotionalImage'
      ? `/api/iap/${productId}/promotional-image`
      : `/api/iap/${productId}/screenshot`
  }

  // Helper to get the best available preview URL for an image
  const getPreviewUrl = (img: ScreenshotData): string | null => {
    // Prefer R2 URL (our storage)
    if (img.r2Url) return img.r2Url
    // Fall back to Apple CDN URL (from pulled images, for reference only)
    if (img.imageUrl) return img.imageUrl
    return null
  }

  const fetchImages = async () => {
    // Fetch review screenshot
    setIsLoadingScreenshot(true)
    try {
      const response = await fetch(`${getEndpoint('reviewScreenshot')}?projectId=${projectId}`)
      if (response.ok) {
        const data = await response.json()
        if (data.screenshot) {
          setReviewScreenshot(data.screenshot)
          setReviewPreviewUrl(getPreviewUrl(data.screenshot))
        }
      }
    } catch (err) {
      console.warn('No review screenshot found')
    } finally {
      setIsLoadingScreenshot(false)
    }

    // Fetch promotional image
    setIsLoadingPromo(true)
    try {
      const response = await fetch(`${getEndpoint('promotionalImage')}?projectId=${projectId}`)
      if (response.ok) {
        const data = await response.json()
        // Note: API returns 'image' for promotional images, 'screenshot' for review screenshots
        const imageData = data.image || data.screenshot
        if (imageData) {
          setPromotionalImage(imageData)
          setPromoPreviewUrl(getPreviewUrl(imageData))
        }
      }
    } catch (err) {
      console.warn('No promotional image found')
    } finally {
      setIsLoadingPromo(false)
    }
  }

  // Helper to get image dimensions
  const getImageDimensions = (file: File): Promise<{ width: number; height: number }> => {
    return new Promise((resolve, reject) => {
      const img = new window.Image()
      img.onload = () => {
        resolve({ width: img.width, height: img.height })
        URL.revokeObjectURL(img.src)
      }
      img.onerror = () => {
        reject(new Error('Failed to load image'))
        URL.revokeObjectURL(img.src)
      }
      img.src = URL.createObjectURL(file)
    })
  }

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>, imageType: ImageType) => {
    const file = e.target.files?.[0]
    if (!file) return

    const config = IMAGE_TYPE_CONFIG[imageType]

    // Helper to reset the file input
    const resetInput = () => {
      if (imageType === 'reviewScreenshot' && reviewInputRef.current) {
        reviewInputRef.current.value = ''
      } else if (promoInputRef.current) {
        promoInputRef.current.value = ''
      }
    }

    // Validate file type - only PNG and JPEG allowed per Apple requirements
    const allowedTypes = ['image/png', 'image/jpeg', 'image/jpg']
    if (!allowedTypes.includes(file.type)) {
      setError('Only PNG and JPEG images are allowed (Apple requirement)')
      resetInput()
      return
    }

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      setError('Image must be less than 5MB')
      resetInput()
      return
    }

    // Validate dimensions
    if (config.dimensions) {
      try {
        const dimensions = await getImageDimensions(file)

        if (config.dimensions === 'screenshot') {
          // Validate minimum dimensions for App Store review screenshots
          // Portrait: width >= 640, height >= 920. Landscape: width >= 920, height >= 640.
          const meetsPortraitMin = dimensions.width >= MIN_SCREENSHOT_WIDTH && dimensions.height >= MIN_SCREENSHOT_HEIGHT
          const meetsLandscapeMin = dimensions.width >= MIN_SCREENSHOT_HEIGHT && dimensions.height >= MIN_SCREENSHOT_WIDTH
          if (!meetsPortraitMin && !meetsLandscapeMin) {
            setError(`Review screenshot too small. Minimum size is ${MIN_SCREENSHOT_WIDTH}×${MIN_SCREENSHOT_HEIGHT} (portrait) or ${MIN_SCREENSHOT_HEIGHT}×${MIN_SCREENSHOT_WIDTH} (landscape). Your image is ${dimensions.width}×${dimensions.height} pixels.`)
            resetInput()
            return
          }
        } else {
          // Exact dimension match (promotional image)
          if (dimensions.width !== config.dimensions.width || dimensions.height !== config.dimensions.height) {
            setError(`Promotional image must be exactly ${config.dimensions.width} × ${config.dimensions.height} pixels. Your image is ${dimensions.width} × ${dimensions.height} pixels.`)
            resetInput()
            return
          }
        }
      } catch {
        setError('Failed to read image dimensions')
        resetInput()
        return
      }
    }

    setUploadingType(imageType)
    setError(null)

    try {
      // Convert to base64
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => {
          const result = reader.result as string
          const base64Data = result.split(',')[1]
          resolve(base64Data)
        }
        reader.onerror = reject
        reader.readAsDataURL(file)
      })

      // Upload to server
      const response = await fetch(getEndpoint(imageType), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          fileName: file.name,
          imageData: base64,
          mimeType: file.type,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to upload')
      }

      const responseData = await response.json()

      const newScreenshot: ScreenshotData = {
        fileName: file.name,
        mimeType: file.type,
        fileSize: file.size,
        // Include R2 URL from response if available
        r2Url: responseData.screenshot?.r2Url || responseData.image?.r2Url,
      }

      // Update local state - use R2 URL if available, otherwise create object URL for preview
      const previewUrl = newScreenshot.r2Url || URL.createObjectURL(file)
      if (imageType === 'reviewScreenshot') {
        setReviewScreenshot(newScreenshot)
        setReviewPreviewUrl(previewUrl)
      } else {
        setPromotionalImage(newScreenshot)
        setPromoPreviewUrl(previewUrl)
      }

      showSuccess('Image uploaded successfully')
      onUpdated()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to upload')
    } finally {
      setUploadingType(null)
      resetInput()
    }
  }

  const handleDelete = async (imageType: ImageType) => {
    if (!confirm('Delete this image?')) return

    setDeletingType(imageType)
    setError(null)

    try {
      const response = await fetch(`${getEndpoint(imageType)}?projectId=${projectId}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to delete')
      }

      if (imageType === 'reviewScreenshot') {
        setReviewScreenshot(null)
        setReviewPreviewUrl(null)
      } else {
        setPromotionalImage(null)
        setPromoPreviewUrl(null)
      }

      showSuccess('Image deleted')
      onUpdated()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete')
    } finally {
      setDeletingType(null)
    }
  }

  const showSuccess = (message: string) => {
    setSuccess(message)
    setTimeout(() => setSuccess(null), 3000)
  }

  const renderImageSection = (
    imageType: ImageType,
    screenshot: ScreenshotData | null,
    previewUrl: string | null,
    isLoading: boolean,
    inputRef: React.RefObject<HTMLInputElement>,
    canEdit: boolean
  ) => {
    const config = IMAGE_TYPE_CONFIG[imageType]
    const IconComponent = config.icon
    const isUploading = uploadingType === imageType
    const isDeleting = deletingType === imageType

    return (
      <div className="rounded-xl bg-white/[0.02] border border-white/[0.08] overflow-hidden">
        <div className="p-4 border-b border-white/[0.06] flex items-center gap-3">
          <div className="p-2 rounded-lg bg-blue-500/20 text-blue-400">
            <IconComponent className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-medium text-white">{config.title}</h3>
            <p className="text-xs text-neutral-500">{config.description}</p>
          </div>
        </div>

        <div className="p-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 animate-spin text-blue-400" />
            </div>
          ) : screenshot && previewUrl ? (
            <div className="space-y-3">
              <div className="rounded-lg overflow-hidden border border-white/[0.08] bg-black/30">
                <img
                  src={previewUrl}
                  alt={config.title}
                  className="w-full h-auto max-h-48 object-contain"
                />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-neutral-300 truncate max-w-[200px]">{screenshot.fileName}</p>
                  <div className="flex items-center gap-2">
                    <p className="text-xs text-neutral-500">
                      {(screenshot.fileSize / 1024).toFixed(1)} KB
                    </p>
                    {screenshot.appStoreId && (
                      <span className="text-xs px-1.5 py-0.5 rounded bg-green-500/10 text-green-400 border border-green-500/20">
                        Synced
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {canEdit ? (
                    <>
                      <label className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium
                                      bg-white/[0.05] text-neutral-300 hover:bg-white/[0.08] cursor-pointer transition-all">
                        {isUploading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
                        Replace
                        <input
                          type="file"
                          accept={config.accept}
                          onChange={(e) => handleFileSelect(e, imageType)}
                          className="hidden"
                          ref={inputRef}
                          disabled={isUploading}
                        />
                      </label>
                      <button
                        onClick={() => handleDelete(imageType)}
                        disabled={isDeleting}
                        className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium
                                 text-red-400 hover:bg-red-500/10 transition-all disabled:opacity-50"
                      >
                        {isDeleting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                        Delete
                      </button>
                    </>
                  ) : (
                    <span className="text-xs text-neutral-500 flex items-center gap-1">
                      <Lock className="w-3 h-3" />
                      Read-only
                    </span>
                  )}
                </div>
              </div>
            </div>
          ) : canEdit ? (
            <label className="flex flex-col items-center justify-center py-8 rounded-xl border-2 border-dashed border-white/[0.08]
                            bg-white/[0.01] hover:bg-white/[0.03] cursor-pointer transition-all">
              {isUploading ? (
                <Loader2 className="w-6 h-6 animate-spin text-blue-400 mb-2" />
              ) : (
                <Upload className="w-6 h-6 text-neutral-500 mb-2" />
              )}
              <span className="text-sm text-neutral-300 font-medium">
                {isUploading ? 'Uploading...' : 'Click to upload'}
              </span>
              <span className="text-xs text-neutral-500 mt-1">
                {config.dimensions === 'screenshot'
                  ? `PNG or JPEG, min ${MIN_SCREENSHOT_WIDTH}×${MIN_SCREENSHOT_HEIGHT}px`
                  : `PNG or JPEG, ${config.dimensions.width} × ${config.dimensions.height}px`
                }
              </span>
              <input
                type="file"
                accept={config.accept}
                onChange={(e) => handleFileSelect(e, imageType)}
                className="hidden"
                ref={inputRef}
                disabled={isUploading}
              />
            </label>
          ) : (
            <div className="flex flex-col items-center justify-center py-8 rounded-xl border-2 border-dashed border-white/[0.05]
                          bg-white/[0.01]">
              <Lock className="w-6 h-6 text-neutral-600 mb-2" />
              <span className="text-sm text-neutral-500 font-medium">
                No image uploaded
              </span>
              <span className="text-xs text-neutral-600 mt-1">
                Editing is restricted in the current state
              </span>
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto p-5">
      <div className="max-w-2xl mx-auto space-y-4">
        {/* Alerts */}
        {error && (
          <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm flex items-center gap-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            {error}
            <button onClick={() => setError(null)} className="ml-auto"><X className="w-3 h-3" /></button>
          </div>
        )}

        {success && (
          <div className="p-3 rounded-lg bg-green-500/10 border border-green-500/20 text-green-400 text-sm flex items-center gap-2">
            <Check className="w-4 h-4 flex-shrink-0" />
            {success}
          </div>
        )}

        {/* State-based edit restriction warning */}
        {(!canEditScreenshot || !canEditPromoImage) && (
          <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 text-sm flex items-center gap-2">
            <Lock className="w-4 h-4 flex-shrink-0" />
            <div>
              <span className="font-medium">Editing restricted: </span>
              {stateConfig?.label ? (
                <>Product is {stateConfig.label.toLowerCase()}. Media cannot be modified in this state.</>
              ) : (
                <>Media cannot be modified in the current state.</>
              )}
            </div>
          </div>
        )}

        {/* Warning for approved products that changes require re-review */}
        {canEditScreenshot && canEditPromoImage && productState === 'APPROVED' && (
          <div className="p-3 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-400 text-sm flex items-center gap-2">
            <Info className="w-4 h-4 flex-shrink-0" />
            <div>
              <span className="font-medium">Note: </span>
              Changes to media on approved products will require re-review by Apple.
            </div>
          </div>
        )}

        {/* Review Screenshot Section */}
        {renderImageSection(
          'reviewScreenshot',
          reviewScreenshot,
          reviewPreviewUrl,
          isLoadingScreenshot,
          reviewInputRef,
          canEditScreenshot
        )}

        {/* Promotional Image Section */}
        {renderImageSection(
          'promotionalImage',
          promotionalImage,
          promoPreviewUrl,
          isLoadingPromo,
          promoInputRef,
          canEditPromoImage
        )}
      </div>
    </div>
  )
}
