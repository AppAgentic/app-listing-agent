'use client'

import { useState, useEffect } from 'react'
import {
  Save,
  Plus,
  Loader2,
  AlertCircle,
  Check,
  Globe,
  Trash2,
} from 'lucide-react'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CPPLocalization {
  locale: string
  promotionalText: string | null
  screenshots: any[]
  appStoreLocalizationId: string | null
}

interface CustomProductPage {
  id: string
  appStoreId: string | null
  name: string
  url: string | null
  state: string | null
  syncStatus: 'synced' | 'local_changes' | 'pending_creation'
  localizations: CPPLocalization[]
}

interface CSLLocalization {
  locale: string
  title: string
  shortDescription: string
  fullDescription: string
  iconUrl: string | null
  featureGraphicUrl: string | null
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

type CustomPage = CustomProductPage | CustomStoreListing

interface CustomPageLocalizationsTabProps {
  projectId: string
  page: CustomPage
  storeType: 'ios' | 'android'
  onUpdated: () => void
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function CustomPageLocalizationsTab({
  projectId,
  page,
  storeType,
  onUpdated,
}: CustomPageLocalizationsTabProps) {
  const isIOS = storeType === 'ios'
  const localizations = page.localizations || []

  const [selectedLocale, setSelectedLocale] = useState<string>(
    localizations[0]?.locale || ''
  )
  const [showAddLocale, setShowAddLocale] = useState(false)
  const [newLocale, setNewLocale] = useState('')
  const [isAdding, setIsAdding] = useState(false)

  // Form state for current locale
  const currentLoc = localizations.find(l => l.locale === selectedLocale)

  // iOS fields
  const [promotionalText, setPromotionalText] = useState('')

  // Android fields
  const [title, setTitle] = useState('')
  const [shortDescription, setShortDescription] = useState('')
  const [fullDescription, setFullDescription] = useState('')

  const [isSaving, setIsSaving] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  // Populate form when locale changes
  useEffect(() => {
    if (!currentLoc) return
    if (isIOS) {
      setPromotionalText((currentLoc as CPPLocalization).promotionalText || '')
    } else {
      const csl = currentLoc as CSLLocalization
      setTitle(csl.title || '')
      setShortDescription(csl.shortDescription || '')
      setFullDescription(csl.fullDescription || '')
    }
  }, [selectedLocale, currentLoc, isIOS])

  // ---------------------------------------------------------------------------
  // Add locale
  // ---------------------------------------------------------------------------

  const handleAddLocale = async () => {
    if (!newLocale.trim()) return
    setIsAdding(true)
    setError(null)

    try {
      const endpoint = isIOS
        ? `/api/custom-product-pages/${page.id}/localizations`
        : `/api/custom-store-listings/${page.id}/localizations`
      const body: any = { projectId, locale: newLocale.trim() }

      if (isIOS) {
        body.promotionalText = ''
      } else {
        body.title = ''
        body.shortDescription = ''
        body.fullDescription = ''
      }

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!data.success) throw new Error(data.error || 'Failed to add locale')

      setSelectedLocale(newLocale.trim())
      setNewLocale('')
      setShowAddLocale(false)
      onUpdated()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setIsAdding(false)
    }
  }

  // ---------------------------------------------------------------------------
  // Save locale
  // ---------------------------------------------------------------------------

  const handleSave = async () => {
    if (!selectedLocale) return
    setIsSaving(true)
    setError(null)

    try {
      const endpoint = isIOS
        ? `/api/custom-product-pages/${page.id}/localizations`
        : `/api/custom-store-listings/${page.id}/localizations`
      const body: any = { projectId, locale: selectedLocale }

      if (isIOS) {
        body.promotionalText = promotionalText
      } else {
        body.title = title
        body.shortDescription = shortDescription
        body.fullDescription = fullDescription
      }

      const res = await fetch(endpoint, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!data.success) throw new Error(data.error || 'Failed to save')

      setSuccess('Saved successfully')
      onUpdated()
      setTimeout(() => setSuccess(null), 3000)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setIsSaving(false)
    }
  }

  // ---------------------------------------------------------------------------
  // Delete locale
  // ---------------------------------------------------------------------------

  const handleDeleteLocale = async () => {
    if (!selectedLocale) return
    setIsDeleting(true)
    setError(null)

    try {
      const endpoint = isIOS
        ? `/api/custom-product-pages/${page.id}/localizations`
        : `/api/custom-store-listings/${page.id}/localizations`

      const res = await fetch(endpoint, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, locale: selectedLocale }),
      })
      const data = await res.json()
      if (!data.success && !res.ok) throw new Error(data.error || 'Failed to delete')

      const remaining = localizations.filter(l => l.locale !== selectedLocale)
      setSelectedLocale(remaining[0]?.locale || '')
      onUpdated()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setIsDeleting(false)
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
      <div className="flex items-center gap-3">
        <div className="flex-1">
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
            <p className="text-sm text-neutral-500">No localizations yet</p>
          )}
        </div>
        <div className="flex items-center gap-2 mt-6">
          <button
            onClick={() => setShowAddLocale(true)}
            className="flex items-center gap-1 px-3 py-2 rounded-lg text-sm font-medium bg-green-500/20 text-green-400 hover:bg-green-500/30 border border-green-500/30 transition-all"
          >
            <Plus className="w-4 h-4" />
            Add
          </button>
          {selectedLocale && localizations.length > 1 && (
            <button
              onClick={handleDeleteLocale}
              disabled={isDeleting}
              className="flex items-center gap-1 px-3 py-2 rounded-lg text-sm font-medium text-red-400 hover:text-red-300 hover:bg-red-500/10 transition-all"
            >
              {isDeleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
            </button>
          )}
        </div>
      </div>

      {/* Add locale input */}
      {showAddLocale && (
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={newLocale}
            onChange={(e) => setNewLocale(e.target.value)}
            placeholder="e.g., en-US, fr-FR, ja"
            className="flex-1 px-3 py-2 rounded-lg bg-white/[0.05] border border-white/[0.1] text-white placeholder:text-neutral-500 focus:outline-none focus:border-purple-500/50 text-sm"
            onKeyDown={(e) => e.key === 'Enter' && handleAddLocale()}
          />
          <button
            onClick={handleAddLocale}
            disabled={isAdding || !newLocale.trim()}
            className="px-3 py-2 rounded-lg text-sm font-medium bg-gradient-to-r from-purple-500 to-blue-500 text-white hover:opacity-90 disabled:opacity-50 transition-all"
          >
            {isAdding ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Add'}
          </button>
          <button
            onClick={() => { setShowAddLocale(false); setNewLocale('') }}
            className="px-3 py-2 rounded-lg text-sm text-neutral-400 hover:text-white transition-all"
          >
            Cancel
          </button>
        </div>
      )}

      {/* Fields */}
      {selectedLocale && currentLoc && (
        <div className="space-y-4">
          {isIOS ? (
            /* iOS: Promotional Text */
            <div>
              <label className="block text-sm font-medium text-neutral-300 mb-1.5">
                Promotional Text
              </label>
              <textarea
                value={promotionalText}
                onChange={(e) => setPromotionalText(e.target.value)}
                maxLength={170}
                rows={3}
                placeholder="Promotional text for this custom product page (170 chars max)"
                className="w-full px-3 py-2 rounded-lg bg-white/[0.05] border border-white/[0.1] text-white placeholder:text-neutral-500 focus:outline-none focus:border-purple-500/50 text-sm resize-none"
              />
              <p className="mt-1 text-xs text-neutral-500">{promotionalText.length}/170 characters</p>
            </div>
          ) : (
            /* Android: Title, Short Desc, Full Desc */
            <>
              <div>
                <label className="block text-sm font-medium text-neutral-300 mb-1.5">
                  Title
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  maxLength={30}
                  placeholder="App title (30 chars max)"
                  className="w-full px-3 py-2 rounded-lg bg-white/[0.05] border border-white/[0.1] text-white placeholder:text-neutral-500 focus:outline-none focus:border-purple-500/50 text-sm"
                />
                <p className="mt-1 text-xs text-neutral-500">{title.length}/30 characters</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-neutral-300 mb-1.5">
                  Short Description
                </label>
                <textarea
                  value={shortDescription}
                  onChange={(e) => setShortDescription(e.target.value)}
                  maxLength={80}
                  rows={2}
                  placeholder="Short description (80 chars max)"
                  className="w-full px-3 py-2 rounded-lg bg-white/[0.05] border border-white/[0.1] text-white placeholder:text-neutral-500 focus:outline-none focus:border-purple-500/50 text-sm resize-none"
                />
                <p className="mt-1 text-xs text-neutral-500">{shortDescription.length}/80 characters</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-neutral-300 mb-1.5">
                  Full Description
                </label>
                <textarea
                  value={fullDescription}
                  onChange={(e) => setFullDescription(e.target.value)}
                  maxLength={4000}
                  rows={8}
                  placeholder="Full description (4000 chars max)"
                  className="w-full px-3 py-2 rounded-lg bg-white/[0.05] border border-white/[0.1] text-white placeholder:text-neutral-500 focus:outline-none focus:border-purple-500/50 text-sm resize-none"
                />
                <p className="mt-1 text-xs text-neutral-500">{fullDescription.length}/4000 characters</p>
              </div>
            </>
          )}

          {/* Save */}
          <div className="flex justify-end pt-4 border-t border-white/[0.08]">
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-gradient-to-r from-purple-500 to-blue-500 text-white hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Save Localization
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
