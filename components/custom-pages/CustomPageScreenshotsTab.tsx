'use client'

import { useState, useRef } from 'react'
import Image from 'next/image'
import {
  Upload,
  Trash2,
  Loader2,
  AlertCircle,
  Check,
  Globe,
  Image as ImageIcon,
} from 'lucide-react'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ScreenshotRef {
  id: string
  position: number
  imageUrl: string
  imageKey: string
  fileName: string
  fileSize: number
  displayType?: string  // iOS
  imageType?: string    // Android
}

interface CPPLocalization {
  locale: string
  promotionalText: string | null
  screenshots: ScreenshotRef[]
  appStoreLocalizationId: string | null
}

interface CSLLocalization {
  locale: string
  title: string
  shortDescription: string
  fullDescription: string
  iconUrl: string | null
  featureGraphicUrl: string | null
  screenshots: ScreenshotRef[]
}

type Localization = CPPLocalization | CSLLocalization

interface CustomPage {
  id: string
  name: string
  syncStatus: string
  localizations: Localization[]
}

interface CustomPageScreenshotsTabProps {
  projectId: string
  page: CustomPage
  storeType: 'ios' | 'android'
  onUpdated: () => void
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function CustomPageScreenshotsTab({
  projectId,
  page,
  storeType,
  onUpdated,
}: CustomPageScreenshotsTabProps) {
  const isIOS = storeType === 'ios'
  const localizations = page.localizations || []

  const [selectedLocale, setSelectedLocale] = useState<string>(
    localizations[0]?.locale || ''
  )
  const [isUploading, setIsUploading] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const currentLoc = localizations.find(l => l.locale === selectedLocale)
  const screenshots = currentLoc?.screenshots || []

  // ---------------------------------------------------------------------------
  // Upload screenshot
  // ---------------------------------------------------------------------------

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setIsUploading(true)
    setError(null)

    try {
      // Upload to R2 first
      const formData = new FormData()
      formData.append('file', file)
      formData.append('projectId', projectId)
      formData.append('category', isIOS ? 'cpp-screenshots' : 'csl-screenshots')

      const uploadRes = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      })
      const uploadData = await uploadRes.json()
      if (!uploadData.success) throw new Error(uploadData.error || 'Upload failed')

      // Save screenshot reference
      const endpoint = isIOS
        ? `/api/custom-product-pages/${page.id}/screenshots`
        : `/api/custom-store-listings/${page.id}/screenshots`

      const body: any = {
        projectId,
        locale: selectedLocale,
        imageUrl: uploadData.url,
        imageKey: uploadData.key,
        fileName: file.name,
        fileSize: file.size,
      }

      if (isIOS) {
        body.displayType = 'APP_IPHONE_67'
      } else {
        body.imageType = 'phone'
      }

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!data.success) throw new Error(data.error || 'Failed to save screenshot')

      setSuccess('Screenshot uploaded')
      onUpdated()
      setTimeout(() => setSuccess(null), 3000)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setIsUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  // ---------------------------------------------------------------------------
  // Delete screenshot
  // ---------------------------------------------------------------------------

  const handleDelete = async (screenshotId: string) => {
    setDeletingId(screenshotId)
    setError(null)

    try {
      const endpoint = isIOS
        ? `/api/custom-product-pages/${page.id}/screenshots`
        : `/api/custom-store-listings/${page.id}/screenshots`

      const res = await fetch(endpoint, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, locale: selectedLocale, screenshotId }),
      })
      const data = await res.json()
      if (!data.success) throw new Error(data.error || 'Failed to delete')

      setSuccess('Screenshot deleted')
      onUpdated()
      setTimeout(() => setSuccess(null), 3000)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setDeletingId(null)
    }
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="p-5 space-y-6">
      {/* Banners */}
      {error && (
        <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 flex items-center gap-2 text-sm">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {error}
        </div>
      )}
      {success && (
        <div className="p-3 rounded-lg bg-green-500/10 border border-green-500/20 text-green-400 flex items-center gap-2 text-sm">
          <Check className="w-4 h-4 flex-shrink-0" />
          {success}
        </div>
      )}

      {/* Locale Selector */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex-1 max-w-xs">
          <label className="block text-sm font-medium text-neutral-300 mb-1.5">
            <Globe className="w-3.5 h-3.5 inline mr-1" />
            Locale
          </label>
          {localizations.length > 0 ? (
            <select
              value={selectedLocale}
              onChange={(e) => setSelectedLocale(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-white/[0.05] border border-white/[0.1] text-white focus:outline-none focus:border-purple-500/50 text-sm"
            >
              {localizations.map(loc => (
                <option key={loc.locale} value={loc.locale}>
                  {loc.locale}
                </option>
              ))}
            </select>
          ) : (
            <p className="text-sm text-neutral-500">Add a localization first</p>
          )}
        </div>

        {/* Upload Button */}
        {selectedLocale && (
          <div className="mt-6">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleUpload}
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-green-500/20 text-green-400 hover:bg-green-500/30 border border-green-500/30 disabled:opacity-50 transition-all"
            >
              {isUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
              Upload
            </button>
          </div>
        )}
      </div>

      {/* Screenshot Grid */}
      {selectedLocale && (
        screenshots.length === 0 ? (
          <div className="text-center py-12">
            <ImageIcon className="w-12 h-12 text-neutral-600 mx-auto mb-4" />
            <h3 className="text-sm font-medium text-white mb-1">No screenshots yet</h3>
            <p className="text-xs text-neutral-400">Upload screenshots for this locale</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {screenshots.map((ss) => (
              <div
                key={ss.id}
                className="group relative rounded-xl overflow-hidden border border-white/[0.08] bg-white/[0.02] hover:border-purple-500/30 transition-all"
              >
                <div className="aspect-[9/16] relative">
                  <Image
                    src={ss.imageUrl}
                    alt={ss.fileName}
                    fill
                    className="object-cover"
                    unoptimized
                  />
                </div>
                {/* Overlay */}
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-all flex items-center justify-center opacity-0 group-hover:opacity-100">
                  <button
                    onClick={() => handleDelete(ss.id)}
                    disabled={deletingId === ss.id}
                    className="p-2.5 rounded-xl bg-red-500/80 text-white hover:bg-red-500 transition-all"
                  >
                    {deletingId === ss.id ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Trash2 className="w-4 h-4" />
                    )}
                  </button>
                </div>
                {/* File name */}
                <div className="p-2">
                  <p className="text-[11px] text-neutral-500 truncate">{ss.fileName}</p>
                </div>
              </div>
            ))}
          </div>
        )
      )}
    </div>
  )
}
