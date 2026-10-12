'use client'

import { useState } from 'react'
import {
  Save,
  Trash2,
  Loader2,
  AlertCircle,
  Check,
  MapPin,
  Globe,
  Link as LinkIcon,
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

interface CustomPageOverviewTabProps {
  projectId: string
  page: CustomPage
  storeType: 'ios' | 'android'
  onUpdated: () => void
  onDelete: () => void
}

const TARGETING_LABELS: Record<string, string> = {
  COUNTRY: 'Country Targeting',
  PRE_REGISTRATION: 'Pre-Registration',
  INSTALL_STATE: 'Install State',
}

const CPP_STATE_LABELS: Record<string, { label: string; badgeClass: string }> = {
  PREPARE_FOR_SUBMISSION: { label: 'Prepare for Submission', badgeClass: 'bg-neutral-500/20 text-neutral-400 border-neutral-500/30' },
  WAITING_FOR_REVIEW: { label: 'Waiting for Review', badgeClass: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30' },
  IN_REVIEW: { label: 'In Review', badgeClass: 'bg-blue-500/20 text-blue-400 border-blue-500/30' },
  APPROVED: { label: 'Approved', badgeClass: 'bg-green-500/20 text-green-400 border-green-500/30' },
  REJECTED: { label: 'Rejected', badgeClass: 'bg-red-500/20 text-red-400 border-red-500/30' },
  READY_FOR_DISTRIBUTION: { label: 'Ready', badgeClass: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' },
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function CustomPageOverviewTab({
  projectId,
  page,
  storeType,
  onUpdated,
  onDelete,
}: CustomPageOverviewTabProps) {
  const isIOS = storeType === 'ios'
  const [name, setName] = useState(page.name)
  const [targetingType, setTargetingType] = useState(
    !isIOS ? (page as CustomStoreListing).targetingType : 'COUNTRY'
  )
  const [targetingCountries, setTargetingCountries] = useState(
    !isIOS ? (page as CustomStoreListing).targetingCountries.join(', ') : ''
  )
  const [isSaving, setIsSaving] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  const hasChanges = name !== page.name
    || (!isIOS && targetingType !== (page as CustomStoreListing).targetingType)
    || (!isIOS && targetingCountries !== (page as CustomStoreListing).targetingCountries.join(', '))

  const handleSave = async () => {
    setIsSaving(true)
    setError(null)

    try {
      const endpoint = isIOS
        ? `/api/custom-product-pages/${page.id}`
        : `/api/custom-store-listings/${page.id}`
      const body: any = { projectId, name: name.trim() }

      if (!isIOS) {
        body.targetingType = targetingType
        body.targetingCountries = targetingCountries
          .split(',')
          .map(c => c.trim().toUpperCase())
          .filter(Boolean)
      }

      const res = await fetch(endpoint, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!data.success) throw new Error(data.error || 'Update failed')

      setSuccess('Saved successfully')
      onUpdated()
      setTimeout(() => setSuccess(null), 3000)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setIsSaving(false)
    }
  }

  const handleDelete = async () => {
    setIsDeleting(true)
    setError(null)

    try {
      onDelete()
    } finally {
      setIsDeleting(false)
    }
  }

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

      {/* Name */}
      <div>
        <label className="block text-sm font-medium text-neutral-300 mb-1.5">
          {isIOS ? 'Reference Name' : 'Listing Name'}
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={isIOS ? 64 : undefined}
          className="w-full px-3 py-2 rounded-lg bg-white/[0.05] border border-white/[0.1] text-white placeholder:text-neutral-500 focus:outline-none focus:border-purple-500/50 text-sm"
        />
        {isIOS && (
          <p className="mt-1 text-xs text-neutral-500">{name.length}/64 characters</p>
        )}
      </div>

      {/* iOS: State & URL (read-only) */}
      {isIOS && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {(page as CustomProductPage).state && (
            <div>
              <label className="block text-sm font-medium text-neutral-300 mb-1.5">State</label>
              <div>
                {(() => {
                  const info = CPP_STATE_LABELS[(page as CustomProductPage).state!]
                  return info ? (
                    <span className={`px-3 py-1 rounded-full text-xs font-medium border ${info.badgeClass}`}>
                      {info.label}
                    </span>
                  ) : (
                    <span className="text-sm text-neutral-400">{(page as CustomProductPage).state}</span>
                  )
                })()}
              </div>
            </div>
          )}
          {(page as CustomProductPage).url && (
            <div>
              <label className="block text-sm font-medium text-neutral-300 mb-1.5">URL</label>
              <div className="flex items-center gap-2">
                <LinkIcon className="w-4 h-4 text-neutral-500 flex-shrink-0" />
                <a
                  href={(page as CustomProductPage).url!}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-blue-400 hover:text-blue-300 truncate"
                >
                  {(page as CustomProductPage).url}
                </a>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Android: Targeting */}
      {!isIOS && (
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-neutral-300 mb-1.5">
              Targeting Type
            </label>
            <select
              value={targetingType}
              onChange={(e) => setTargetingType(e.target.value as any)}
              className="w-full px-3 py-2 rounded-lg bg-white/[0.05] border border-white/[0.1] text-white focus:outline-none focus:border-purple-500/50 text-sm"
            >
              <option value="COUNTRY">Country</option>
              <option value="PRE_REGISTRATION">Pre-Registration</option>
              <option value="INSTALL_STATE">Install State</option>
            </select>
          </div>

          {targetingType === 'COUNTRY' && (
            <div>
              <label className="block text-sm font-medium text-neutral-300 mb-1.5">
                Target Countries
              </label>
              <input
                type="text"
                value={targetingCountries}
                onChange={(e) => setTargetingCountries(e.target.value)}
                placeholder="US, GB, DE (comma-separated)"
                className="w-full px-3 py-2 rounded-lg bg-white/[0.05] border border-white/[0.1] text-white placeholder:text-neutral-500 focus:outline-none focus:border-purple-500/50 text-sm"
              />
              <p className="mt-1 text-xs text-neutral-500">
                <MapPin className="w-3 h-3 inline mr-1" />
                Enter ISO country codes separated by commas
              </p>
            </div>
          )}
        </div>
      )}

      {/* Info card */}
      <div className="p-4 rounded-xl bg-white/[0.02] border border-white/[0.06]">
        <h3 className="text-sm font-medium text-neutral-300 mb-2">Details</h3>
        <div className="grid grid-cols-2 gap-3 text-xs">
          <div>
            <span className="text-neutral-500">Localizations</span>
            <p className="text-white mt-0.5">{page.localizations?.length || 0}</p>
          </div>
          <div>
            <span className="text-neutral-500">Sync Status</span>
            <p className="text-white mt-0.5 capitalize">{page.syncStatus.replace('_', ' ')}</p>
          </div>
          {isIOS && (page as CustomProductPage).appStoreId && (
            <div>
              <span className="text-neutral-500">App Store ID</span>
              <p className="text-white mt-0.5 font-mono text-[11px]">{(page as CustomProductPage).appStoreId}</p>
            </div>
          )}
          {!isIOS && (page as CustomStoreListing).playStoreId && (
            <div>
              <span className="text-neutral-500">Play Store ID</span>
              <p className="text-white mt-0.5 font-mono text-[11px]">{(page as CustomStoreListing).playStoreId}</p>
            </div>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between pt-4 border-t border-white/[0.08]">
        <div>
          {!showDeleteConfirm ? (
            <button
              onClick={() => setShowDeleteConfirm(true)}
              className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-red-400 hover:text-red-300 hover:bg-red-500/10 transition-all"
            >
              <Trash2 className="w-4 h-4" />
              Delete
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <button
                onClick={handleDelete}
                disabled={isDeleting}
                className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium bg-red-500/20 text-red-400 hover:bg-red-500/30 border border-red-500/30 transition-all"
              >
                {isDeleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                Confirm Delete
              </button>
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="px-3 py-2 rounded-lg text-sm text-neutral-400 hover:text-white transition-all"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
        <button
          onClick={handleSave}
          disabled={isSaving || !hasChanges}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-gradient-to-r from-purple-500 to-blue-500 text-white hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
        >
          {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Save Changes
        </button>
      </div>
    </div>
  )
}
