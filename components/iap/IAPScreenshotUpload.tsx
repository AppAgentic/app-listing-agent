'use client'

import { useState, useRef, useEffect } from 'react'
import {
  X,
  Upload,
  Image,
  Loader2,
  Check,
  AlertCircle,
  Trash2,
} from 'lucide-react'

interface ScreenshotData {
  fileName: string
  mimeType?: string
  fileSize: number
  imageData?: string // Base64 data (for locally uploaded)
  imageUrl?: string  // URL (for pulled from App Store)
  appStoreId?: string // Present if pulled from App Store
}

type ImageType = 'reviewScreenshot' | 'promotionalImage'

interface IAPScreenshotUploadProps {
  projectId: string
  iapId: string
  productName: string
  entityType?: 'iap' | 'subscription'
  imageType?: ImageType  // 'reviewScreenshot' (default) or 'promotionalImage' (subscriptions only)
  onClose: () => void
  onUpdated: () => void
}

const IMAGE_TYPE_CONFIG = {
  reviewScreenshot: {
    title: 'Review Screenshot',
    description: 'The review screenshot is required for In-App Purchase review. It should show the purchase in context within your app.',
    maxSize: '5MB',
  },
  promotionalImage: {
    title: 'Promotional Image',
    description: 'Add a 1024 x 1024 pixel image that best represents this subscription. It will be used for win-back offers, offer code redemptions, and App Store Promotion.',
    maxSize: '5MB',
  },
}

export default function IAPScreenshotUpload({
  projectId,
  iapId,
  productName,
  entityType = 'iap',
  imageType = 'reviewScreenshot',
  onClose,
  onUpdated,
}: IAPScreenshotUploadProps) {
  const [isLoading, setIsLoading] = useState(true)
  const [screenshot, setScreenshot] = useState<ScreenshotData | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)

  const fileInputRef = useRef<HTMLInputElement>(null)

  const config = IMAGE_TYPE_CONFIG[imageType]

  // Determine the API endpoint based on entity type and image type
  const getEndpoint = () => {
    if (entityType === 'subscription') {
      return imageType === 'promotionalImage'
        ? `/api/subscriptions/${iapId}/promotional-image`
        : `/api/subscriptions/${iapId}/screenshot`
    }
    // IAP endpoints
    return imageType === 'promotionalImage'
      ? `/api/iap/${iapId}/promotional-image`
      : `/api/iap/${iapId}/screenshot`
  }

  const screenshotEndpoint = getEndpoint()

  useEffect(() => {
    fetchScreenshot()
  }, [projectId, iapId])

  const fetchScreenshot = async () => {
    setIsLoading(true)
    setError(null)
    try {
      const response = await fetch(`${screenshotEndpoint}?projectId=${projectId}`)
      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to fetch screenshot')
      }
      const data = await response.json()
      if (data.screenshot) {
        setScreenshot(data.screenshot)
        // Create preview URL from base64 data or use imageUrl from App Store
        if (data.screenshot.imageData) {
          setPreviewUrl(`data:${data.screenshot.mimeType};base64,${data.screenshot.imageData}`)
        } else if (data.screenshot.imageUrl) {
          setPreviewUrl(data.screenshot.imageUrl)
        }
      }
    } catch (err) {
      // Don't show error for 404 (no screenshot yet)
      console.warn('No screenshot found')
    } finally {
      setIsLoading(false)
    }
  }

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    // Validate file type
    if (!file.type.startsWith('image/')) {
      setError('Please select an image file (PNG, JPG, etc.)')
      return
    }

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      setError('Screenshot must be less than 5MB')
      return
    }

    setIsUploading(true)
    setError(null)

    try {
      // Convert to base64
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => {
          const result = reader.result as string
          // Remove data URL prefix
          const base64Data = result.split(',')[1]
          resolve(base64Data)
        }
        reader.onerror = reject
        reader.readAsDataURL(file)
      })

      // Upload to server
      const response = await fetch(screenshotEndpoint, {
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
        throw new Error(data.error || 'Failed to upload screenshot')
      }

      // Update local state
      setScreenshot({
        fileName: file.name,
        mimeType: file.type,
        fileSize: file.size,
      })
      setPreviewUrl(URL.createObjectURL(file))

      setSuccess('Screenshot uploaded successfully')
      setTimeout(() => setSuccess(null), 3000)
      onUpdated()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to upload')
    } finally {
      setIsUploading(false)
      // Reset input
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }

  const handleDelete = async () => {
    if (!confirm('Delete this screenshot?')) return

    setIsDeleting(true)
    setError(null)

    try {
      const response = await fetch(`${screenshotEndpoint}?projectId=${projectId}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to delete screenshot')
      }

      setScreenshot(null)
      setPreviewUrl(null)
      setSuccess('Screenshot deleted')
      setTimeout(() => setSuccess(null), 3000)
      onUpdated()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete')
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[9999] p-4 backdrop-blur-sm">
      <div className="bg-[#1a1a1a] rounded-2xl border border-white/[0.08] w-full max-w-md shadow-2xl">
        {/* Header */}
        <div className="p-4 border-b border-white/[0.08] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-blue-500/20 text-blue-400">
              <Image className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-white">{config.title}</h2>
              <p className="text-xs text-neutral-500">{productName}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-neutral-400 hover:text-white hover:bg-white/[0.05] transition-all"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          {/* Alerts */}
          {error && (
            <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm flex items-center gap-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              {error}
              <button onClick={() => setError(null)} className="ml-auto">
                <X className="w-3 h-3" />
              </button>
            </div>
          )}

          {success && (
            <div className="mb-4 p-3 rounded-lg bg-green-500/10 border border-green-500/20 text-green-400 text-sm flex items-center gap-2">
              <Check className="w-4 h-4 flex-shrink-0" />
              {success}
            </div>
          )}

          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-blue-400" />
            </div>
          ) : screenshot && previewUrl ? (
            // Show current screenshot
            <div className="space-y-4">
              <div className="rounded-xl overflow-hidden border border-white/[0.08] bg-black/30">
                <img
                  src={previewUrl}
                  alt="Review Screenshot"
                  className="w-full h-auto max-h-64 object-contain"
                />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-neutral-300">{screenshot.fileName}</p>
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
                  <label className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium
                                  bg-white/[0.05] text-neutral-300 hover:bg-white/[0.08] cursor-pointer transition-all">
                    <Upload className="w-4 h-4" />
                    Replace
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleFileSelect}
                      className="hidden"
                      ref={fileInputRef}
                      disabled={isUploading}
                    />
                  </label>
                  <button
                    onClick={handleDelete}
                    disabled={isDeleting}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium
                             text-red-400 hover:bg-red-500/10 transition-all disabled:opacity-50"
                  >
                    {isDeleting ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Trash2 className="w-4 h-4" />
                    )}
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ) : (
            // Upload area
            <div>
              <label className="flex flex-col items-center justify-center py-12 rounded-xl border-2 border-dashed border-white/[0.08]
                              bg-white/[0.02] hover:bg-white/[0.04] cursor-pointer transition-all">
                {isUploading ? (
                  <Loader2 className="w-8 h-8 animate-spin text-blue-400 mb-3" />
                ) : (
                  <Upload className="w-8 h-8 text-neutral-500 mb-3" />
                )}
                <span className="text-sm text-neutral-300 font-medium">
                  {isUploading ? 'Uploading...' : `Click to upload ${imageType === 'promotionalImage' ? 'image' : 'screenshot'}`}
                </span>
                <span className="text-xs text-neutral-500 mt-1">
                  PNG or JPG, max {config.maxSize}
                </span>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleFileSelect}
                  className="hidden"
                  ref={fileInputRef}
                  disabled={isUploading}
                />
              </label>
              <p className="mt-4 text-xs text-neutral-500 text-center">
                {config.description}
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-white/[0.08] flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm font-medium text-neutral-300 hover:bg-white/[0.05] transition-all"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
