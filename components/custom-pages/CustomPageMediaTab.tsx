'use client'

import { useState, useRef } from 'react'
import Image from 'next/image'
import {
  Upload,
  Loader2,
  AlertCircle,
  Check,
  Globe,
  Image as ImageIcon,
  Film,
  Trash2,
} from 'lucide-react'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CSLLocalization {
  locale: string
  title: string
  shortDescription: string
  fullDescription: string
  iconUrl: string | null
  iconKey: string | null
  featureGraphicUrl: string | null
  featureGraphicKey: string | null
  videoUrl: string | null
  screenshots: any[]
}

interface CustomStoreListing {
  id: string
  playStoreId: string | null
  name: string
  targetingType: 'COUNTRY' | 'PRE_REGISTRATION' | 'INSTALL_STATE'
  targetingCountries: string[]
  syncStatus: 'synced' | 'local_changes' | 'pending_creation'
  localizations: CSLLocalization[]
}

interface CustomPageMediaTabProps {
  projectId: string
  page: CustomStoreListing
  onUpdated: () => void
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function CustomPageMediaTab({
  projectId,
  page,
  onUpdated,
}: CustomPageMediaTabProps) {
  const localizations = page.localizations || []

  const [selectedLocale, setSelectedLocale] = useState<string>(
    localizations[0]?.locale || ''
  )
  const [isUploadingIcon, setIsUploadingIcon] = useState(false)
  const [isUploadingGraphic, setIsUploadingGraphic] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const iconInputRef = useRef<HTMLInputElement>(null)
  const graphicInputRef = useRef<HTMLInputElement>(null)

  const currentLoc = localizations.find(l => l.locale === selectedLocale) as CSLLocalization | undefined

  // ---------------------------------------------------------------------------
  // Upload helpers
  // ---------------------------------------------------------------------------

  const handleUploadMedia = async (
    file: File,
    type: 'icon' | 'feature-graphic',
    setLoading: (v: boolean) => void,
  ) => {
    setLoading(true)
    setError(null)

    try {
      // Upload to R2
      const formData = new FormData()
      formData.append('file', file)
      formData.append('projectId', projectId)
      formData.append('category', type === 'icon' ? 'csl-icons' : 'csl-feature-graphics')

      const uploadRes = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      })
      const uploadData = await uploadRes.json()
      if (!uploadData.success) throw new Error(uploadData.error || 'Upload failed')

      // Save to localization
      const endpoint = `/api/custom-store-listings/${page.id}/localizations`
      const body: any = {
        projectId,
        locale: selectedLocale,
      }

      if (type === 'icon') {
        body.iconUrl = uploadData.url
        body.iconKey = uploadData.key
      } else {
        body.featureGraphicUrl = uploadData.url
        body.featureGraphicKey = uploadData.key
      }

      const res = await fetch(endpoint, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!data.success) throw new Error(data.error || 'Failed to save')

      setSuccess(`${type === 'icon' ? 'Icon' : 'Feature graphic'} uploaded`)
      onUpdated()
      setTimeout(() => setSuccess(null), 3000)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
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
      <div>
        <label className="block text-sm font-medium text-neutral-300 mb-1.5">
          <Globe className="w-3.5 h-3.5 inline mr-1" />
          Locale
        </label>
        {localizations.length > 0 ? (
          <select
            value={selectedLocale}
            onChange={(e) => setSelectedLocale(e.target.value)}
            className="w-full max-w-xs px-3 py-2 rounded-lg bg-white/[0.05] border border-white/[0.1] text-white focus:outline-none focus:border-purple-500/50 text-sm"
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

      {selectedLocale && currentLoc && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          {/* Icon */}
          <div>
            <h3 className="text-sm font-medium text-neutral-300 mb-3">Custom Icon</h3>
            <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4">
              {currentLoc.iconUrl ? (
                <div className="flex flex-col items-center gap-3">
                  <div className="relative w-24 h-24 rounded-2xl overflow-hidden">
                    <Image
                      src={currentLoc.iconUrl}
                      alt="Icon"
                      fill
                      className="object-cover"
                      unoptimized
                    />
                  </div>
                  <input
                    ref={iconInputRef}
                    type="file"
                    accept="image/*"
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      if (file) handleUploadMedia(file, 'icon', setIsUploadingIcon)
                      if (iconInputRef.current) iconInputRef.current.value = ''
                    }}
                    className="hidden"
                  />
                  <button
                    onClick={() => iconInputRef.current?.click()}
                    disabled={isUploadingIcon}
                    className="text-xs text-purple-400 hover:text-purple-300 transition-colors"
                  >
                    {isUploadingIcon ? 'Uploading...' : 'Replace'}
                  </button>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-3 py-4">
                  <ImageIcon className="w-10 h-10 text-neutral-600" />
                  <p className="text-xs text-neutral-500">512x512 PNG</p>
                  <input
                    ref={iconInputRef}
                    type="file"
                    accept="image/*"
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      if (file) handleUploadMedia(file, 'icon', setIsUploadingIcon)
                      if (iconInputRef.current) iconInputRef.current.value = ''
                    }}
                    className="hidden"
                  />
                  <button
                    onClick={() => iconInputRef.current?.click()}
                    disabled={isUploadingIcon}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-green-500/20 text-green-400 hover:bg-green-500/30 border border-green-500/30 transition-all"
                  >
                    {isUploadingIcon ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                    Upload Icon
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Feature Graphic */}
          <div>
            <h3 className="text-sm font-medium text-neutral-300 mb-3">Feature Graphic</h3>
            <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4">
              {currentLoc.featureGraphicUrl ? (
                <div className="flex flex-col items-center gap-3">
                  <div className="relative w-full aspect-[2/1] rounded-xl overflow-hidden">
                    <Image
                      src={currentLoc.featureGraphicUrl}
                      alt="Feature Graphic"
                      fill
                      className="object-cover"
                      unoptimized
                    />
                  </div>
                  <input
                    ref={graphicInputRef}
                    type="file"
                    accept="image/*"
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      if (file) handleUploadMedia(file, 'feature-graphic', setIsUploadingGraphic)
                      if (graphicInputRef.current) graphicInputRef.current.value = ''
                    }}
                    className="hidden"
                  />
                  <button
                    onClick={() => graphicInputRef.current?.click()}
                    disabled={isUploadingGraphic}
                    className="text-xs text-purple-400 hover:text-purple-300 transition-colors"
                  >
                    {isUploadingGraphic ? 'Uploading...' : 'Replace'}
                  </button>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-3 py-4">
                  <Film className="w-10 h-10 text-neutral-600" />
                  <p className="text-xs text-neutral-500">1024x500 PNG/JPG</p>
                  <input
                    ref={graphicInputRef}
                    type="file"
                    accept="image/*"
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      if (file) handleUploadMedia(file, 'feature-graphic', setIsUploadingGraphic)
                      if (graphicInputRef.current) graphicInputRef.current.value = ''
                    }}
                    className="hidden"
                  />
                  <button
                    onClick={() => graphicInputRef.current?.click()}
                    disabled={isUploadingGraphic}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-green-500/20 text-green-400 hover:bg-green-500/30 border border-green-500/30 transition-all"
                  >
                    {isUploadingGraphic ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                    Upload Graphic
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Video URL (read-only display for now) */}
      {selectedLocale && currentLoc?.videoUrl && (
        <div>
          <h3 className="text-sm font-medium text-neutral-300 mb-1.5">Video URL</h3>
          <div className="px-3 py-2 rounded-lg bg-white/[0.03] border border-white/[0.06] text-sm text-neutral-400">
            {currentLoc.videoUrl}
          </div>
        </div>
      )}
    </div>
  )
}
