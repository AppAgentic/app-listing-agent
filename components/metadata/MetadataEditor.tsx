'use client'

import { useState, useEffect, useCallback } from 'react'
import { MetadataField } from './MetadataField'
import { LocaleSelector } from './LocaleSelector'
import { VersionStateBanner } from './VersionStateBanner'
import { ComplianceChecker } from './ComplianceChecker'
import type { LocalizedMetadata, AppStoreVersionState } from '@/lib/firebase/firestore'
import { Save, RefreshCw, Globe, AlertCircle } from 'lucide-react'

interface MetadataEditorProps {
  projectId: string
  initialMetadata: { [locale: string]: LocalizedMetadata }
  enabledLocales: string[]
  primaryLocale: string
  versionState: AppStoreVersionState | null
  versionNumber: string | null
  syncStatus: 'synced' | 'local_changes' | 'conflict' | 'never_synced'
  onSave: (locales: { [locale: string]: LocalizedMetadata }) => Promise<void>
  onPull: () => Promise<void>
  onCreateVersion: (version: string) => Promise<void>
}

export function MetadataEditor({
  projectId,
  initialMetadata,
  enabledLocales,
  primaryLocale,
  versionState,
  versionNumber,
  syncStatus,
  onSave,
  onPull,
  onCreateVersion,
}: MetadataEditorProps) {
  const [metadata, setMetadata] = useState<{ [locale: string]: LocalizedMetadata }>(initialMetadata)
  const [selectedLocale, setSelectedLocale] = useState(primaryLocale || enabledLocales[0] || 'en-US')
  const [isSaving, setIsSaving] = useState(false)
  const [isPulling, setIsPulling] = useState(false)
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  const [lastSaved, setLastSaved] = useState<Date | null>(null)

  // Track changes
  useEffect(() => {
    const hasChanges = JSON.stringify(metadata) !== JSON.stringify(initialMetadata)
    setHasUnsavedChanges(hasChanges)
  }, [metadata, initialMetadata])

  // Auto-save draft every 30 seconds
  useEffect(() => {
    if (!hasUnsavedChanges) return

    const timer = setTimeout(async () => {
      // Save draft to server
      try {
        await fetch('/api/metadata/draft', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectId,
            locale: selectedLocale,
            data: metadata[selectedLocale],
          }),
        })
      } catch (error) {
        console.error('Failed to save draft:', error)
      }
    }, 30000)

    return () => clearTimeout(timer)
  }, [hasUnsavedChanges, metadata, selectedLocale, projectId])

  const currentMetadata = metadata[selectedLocale] || {
    locale: selectedLocale,
    name: '',
    subtitle: '',
    privacyUrl: null,
    description: '',
    keywords: '',
    whatsNew: '',
    marketingUrl: null,
    supportUrl: null,
    promotionalText: null,
    shortDescription: null,
    fullDescription: null,
    sourceHash: '',
  }

  const updateField = useCallback((field: keyof LocalizedMetadata, value: string | null) => {
    setMetadata(prev => ({
      ...prev,
      [selectedLocale]: {
        ...prev[selectedLocale],
        locale: selectedLocale,
        [field]: value,
      },
    }))
  }, [selectedLocale])

  const handleSave = async () => {
    setIsSaving(true)
    try {
      await onSave(metadata)
      setLastSaved(new Date())
      setHasUnsavedChanges(false)
    } finally {
      setIsSaving(false)
    }
  }

  const handlePull = async () => {
    setIsPulling(true)
    try {
      await onPull()
    } finally {
      setIsPulling(false)
    }
  }

  const isEditable = !versionState || ['PREPARE_FOR_SUBMISSION', 'METADATA_REJECTED', 'DEVELOPER_REJECTED'].includes(versionState)

  return (
    <div className="space-y-6">
      {/* Version State Banner */}
      <VersionStateBanner
        state={versionState}
        versionNumber={versionNumber}
        isEditable={isEditable}
        onCreateVersion={onCreateVersion}
      />

      {/* Header with Actions */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <LocaleSelector
            locales={enabledLocales}
            selectedLocale={selectedLocale}
            onSelect={setSelectedLocale}
            primaryLocale={primaryLocale}
          />
          {hasUnsavedChanges && (
            <span className="flex items-center gap-1.5 text-[12px] text-yellow-400">
              <AlertCircle className="w-3.5 h-3.5" />
              Unsaved changes
            </span>
          )}
          {lastSaved && !hasUnsavedChanges && (
            <span className="text-[12px] text-neutral-500">
              Saved {lastSaved.toLocaleTimeString()}
            </span>
          )}
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handlePull}
            disabled={isPulling}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-[13px] font-medium
                     bg-white/[0.03] border border-white/[0.08] text-neutral-400
                     hover:bg-white/[0.05] hover:text-white hover:border-white/[0.15]
                     disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            <RefreshCw className={`w-4 h-4 ${isPulling ? 'animate-spin' : ''}`} />
            Pull from Store
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving || !hasUnsavedChanges || !isEditable}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-[13px] font-medium
                     bg-gradient-to-r from-purple-500 to-blue-500 text-white
                     hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            <Save className="w-4 h-4" />
            {isSaving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>

      {/* Sync Status */}
      {syncStatus !== 'synced' && syncStatus !== 'never_synced' && (
        <div className={`p-4 rounded-xl border ${
          syncStatus === 'conflict'
            ? 'bg-red-500/10 border-red-500/20 text-red-400'
            : 'bg-yellow-500/10 border-yellow-500/20 text-yellow-400'
        }`}>
          <div className="flex items-center gap-2 text-[13px]">
            <AlertCircle className="w-4 h-4" />
            {syncStatus === 'conflict'
              ? 'Conflict detected: Local changes differ from store. Pull to see differences.'
              : 'Local changes not yet published to store.'}
          </div>
        </div>
      )}

      {/* Compliance Checker */}
      <ComplianceChecker
        metadata={currentMetadata}
        projectId={projectId}
        locale={selectedLocale}
        onFix={(field, value) => {
          updateField(field, value)
          // Scroll to the field after a brief delay to allow the DOM to update
          setTimeout(() => {
            const fieldElement = document.getElementById(`field-${field}`)
            if (fieldElement) {
              fieldElement.scrollIntoView({ behavior: 'smooth', block: 'center' })
              // Add a brief highlight effect
              fieldElement.classList.add('ring-2', 'ring-purple-500/50', 'rounded-xl')
              setTimeout(() => {
                fieldElement.classList.remove('ring-2', 'ring-purple-500/50', 'rounded-xl')
              }, 2000)
            }
          }, 100)
        }}
      />

      {/* Editor Fields */}
      <div className="p-6 rounded-2xl bg-white/[0.02] border border-white/[0.08]">
        <div className="flex items-center gap-2 mb-6">
          <Globe className="w-5 h-5 text-purple-400" />
          <h3 className="text-[15px] font-semibold text-white">
            {selectedLocale} Metadata
          </h3>
        </div>

        <div className="space-y-6">
          {/* App Info Fields */}
          <div className="grid gap-6 md:grid-cols-2">
            <MetadataField
              id="field-name"
              label="App Name"
              field="title"
              value={currentMetadata.name || ''}
              onChange={(v) => updateField('name', v)}
              placeholder="Your app name"
              disabled={!isEditable}
              helperText="Displayed on the App Store"
            />
            <MetadataField
              id="field-subtitle"
              label="Subtitle"
              field="subtitle"
              value={currentMetadata.subtitle || ''}
              onChange={(v) => updateField('subtitle', v)}
              placeholder="Brief description"
              disabled={!isEditable}
              helperText="Appears below the app name"
            />
          </div>

          <MetadataField
            id="field-keywords"
            label="Keywords"
            field="keywords"
            value={currentMetadata.keywords || ''}
            onChange={(v) => updateField('keywords', v)}
            placeholder="keyword1,keyword2,keyword3"
            disabled={!isEditable}
            helperText="Comma-separated, no spaces after commas"
          />

          <MetadataField
            id="field-description"
            label="Description"
            field="description"
            value={currentMetadata.description || ''}
            onChange={(v) => updateField('description', v)}
            multiline
            placeholder="Full app description..."
            disabled={!isEditable}
          />

          <MetadataField
            id="field-whatsNew"
            label="What's New"
            field="whatsNew"
            value={currentMetadata.whatsNew || ''}
            onChange={(v) => updateField('whatsNew', v)}
            multiline
            placeholder="Release notes for this version..."
            disabled={!isEditable}
          />

          <MetadataField
            id="field-promotionalText"
            label="Promotional Text"
            field="promotionalText"
            value={currentMetadata.promotionalText || ''}
            onChange={(v) => updateField('promotionalText', v)}
            multiline
            placeholder="Optional promotional message..."
            disabled={!isEditable}
            helperText="Can be updated without a new app version"
          />

          {/* URLs */}
          <div className="grid gap-6 md:grid-cols-3">
            <div id="field-supportUrl" className="space-y-2 scroll-mt-24">
              <label className="text-[13px] font-medium text-neutral-300">
                Support URL
              </label>
              <input
                type="url"
                value={currentMetadata.supportUrl || ''}
                onChange={(e) => updateField('supportUrl', e.target.value || null)}
                placeholder="https://..."
                disabled={!isEditable}
                className="w-full px-4 py-3 rounded-xl bg-white/[0.03] border border-white/[0.08]
                         text-white placeholder:text-neutral-600 focus:outline-none focus:border-purple-500/50
                         hover:border-white/[0.15] transition-colors text-[14px]
                         disabled:opacity-50 disabled:cursor-not-allowed"
              />
            </div>
            <div id="field-marketingUrl" className="space-y-2 scroll-mt-24">
              <label className="text-[13px] font-medium text-neutral-300">
                Marketing URL
              </label>
              <input
                type="url"
                value={currentMetadata.marketingUrl || ''}
                onChange={(e) => updateField('marketingUrl', e.target.value || null)}
                placeholder="https://..."
                disabled={!isEditable}
                className="w-full px-4 py-3 rounded-xl bg-white/[0.03] border border-white/[0.08]
                         text-white placeholder:text-neutral-600 focus:outline-none focus:border-purple-500/50
                         hover:border-white/[0.15] transition-colors text-[14px]
                         disabled:opacity-50 disabled:cursor-not-allowed"
              />
            </div>
            <div id="field-privacyUrl" className="space-y-2 scroll-mt-24">
              <label className="text-[13px] font-medium text-neutral-300">
                Privacy Policy URL
              </label>
              <input
                type="url"
                value={currentMetadata.privacyUrl || ''}
                onChange={(e) => updateField('privacyUrl', e.target.value || null)}
                placeholder="https://..."
                disabled={!isEditable}
                className="w-full px-4 py-3 rounded-xl bg-white/[0.03] border border-white/[0.08]
                         text-white placeholder:text-neutral-600 focus:outline-none focus:border-purple-500/50
                         hover:border-white/[0.15] transition-colors text-[14px]
                         disabled:opacity-50 disabled:cursor-not-allowed"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
