'use client'

import { useState } from 'react'
import type { AppStoreVersionState } from '@/lib/firebase/firestore'
import { AlertCircle, CheckCircle, Clock, Lock, Plus, X } from 'lucide-react'

interface VersionStateBannerProps {
  state: AppStoreVersionState | null
  versionNumber: string | null
  isEditable: boolean
  onCreateVersion: (version: string) => Promise<void>
}

const STATE_CONFIG: Record<AppStoreVersionState, {
  label: string
  description: string
  color: string
  bgColor: string
  borderColor: string
  icon: typeof CheckCircle
}> = {
  PREPARE_FOR_SUBMISSION: {
    label: 'Prepare for Submission',
    description: 'Ready to edit metadata and submit for review',
    color: 'text-green-400',
    bgColor: 'bg-green-500/10',
    borderColor: 'border-green-500/20',
    icon: CheckCircle,
  },
  METADATA_REJECTED: {
    label: 'Metadata Rejected',
    description: 'Metadata was rejected, you can edit and resubmit',
    color: 'text-yellow-400',
    bgColor: 'bg-yellow-500/10',
    borderColor: 'border-yellow-500/20',
    icon: AlertCircle,
  },
  DEVELOPER_REJECTED: {
    label: 'Developer Rejected',
    description: 'You rejected this version, you can edit and resubmit',
    color: 'text-yellow-400',
    bgColor: 'bg-yellow-500/10',
    borderColor: 'border-yellow-500/20',
    icon: AlertCircle,
  },
  READY_FOR_SALE: {
    label: 'Ready for Sale',
    description: 'This version is live. Create a new version to make changes.',
    color: 'text-blue-400',
    bgColor: 'bg-blue-500/10',
    borderColor: 'border-blue-500/20',
    icon: CheckCircle,
  },
  WAITING_FOR_REVIEW: {
    label: 'Waiting for Review',
    description: 'Submitted for review. Metadata is locked.',
    color: 'text-purple-400',
    bgColor: 'bg-purple-500/10',
    borderColor: 'border-purple-500/20',
    icon: Clock,
  },
  IN_REVIEW: {
    label: 'In Review',
    description: 'Currently being reviewed. Metadata is locked.',
    color: 'text-purple-400',
    bgColor: 'bg-purple-500/10',
    borderColor: 'border-purple-500/20',
    icon: Clock,
  },
  PENDING_DEVELOPER_RELEASE: {
    label: 'Pending Developer Release',
    description: 'Approved and waiting for your release. Metadata is locked.',
    color: 'text-green-400',
    bgColor: 'bg-green-500/10',
    borderColor: 'border-green-500/20',
    icon: CheckCircle,
  },
  REJECTED: {
    label: 'Rejected',
    description: 'This version was rejected by Apple.',
    color: 'text-red-400',
    bgColor: 'bg-red-500/10',
    borderColor: 'border-red-500/20',
    icon: AlertCircle,
  },
}

export function VersionStateBanner({
  state,
  versionNumber,
  isEditable,
  onCreateVersion,
}: VersionStateBannerProps) {
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [newVersion, setNewVersion] = useState('')
  const [isCreating, setIsCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!state) {
    return (
      <div className="p-4 rounded-xl bg-neutral-500/10 border border-neutral-500/20">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-neutral-400" />
            <div>
              <div className="text-[14px] font-medium text-white">No Version Data</div>
              <div className="text-[12px] text-neutral-400">
                Pull from App Store Connect to get version info
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  const config = STATE_CONFIG[state]
  const Icon = config.icon

  const handleCreateVersion = async () => {
    if (!newVersion) return

    // Validate version format
    if (!/^\d+\.\d+(\.\d+)?$/.test(newVersion)) {
      setError('Version must be in format X.Y or X.Y.Z')
      return
    }

    setIsCreating(true)
    setError(null)

    try {
      await onCreateVersion(newVersion)
      setShowCreateModal(false)
      setNewVersion('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create version')
    } finally {
      setIsCreating(false)
    }
  }

  return (
    <>
      <div className={`p-4 rounded-xl ${config.bgColor} border ${config.borderColor}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Icon className={`w-5 h-5 ${config.color}`} />
            <div>
              <div className="flex items-center gap-2">
                <span className={`text-[14px] font-medium ${config.color}`}>
                  {config.label}
                </span>
                {versionNumber && (
                  <span className="px-2 py-0.5 rounded-md bg-white/[0.1] text-[11px] text-neutral-300">
                    v{versionNumber}
                  </span>
                )}
              </div>
              <div className="text-[12px] text-neutral-400">{config.description}</div>
            </div>
          </div>

          {!isEditable && (
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5 text-[12px] text-neutral-500">
                <Lock className="w-3.5 h-3.5" />
                Locked
              </div>
              <button
                onClick={() => setShowCreateModal(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg
                         bg-white/[0.05] border border-white/[0.1]
                         text-[12px] font-medium text-white
                         hover:bg-white/[0.1] transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                Create New Version
              </button>
            </div>
          )}

          {isEditable && (
            <div className="flex items-center gap-1.5 text-[12px] text-green-400">
              <CheckCircle className="w-3.5 h-3.5" />
              Editable
            </div>
          )}
        </div>
      </div>

      {/* Create Version Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setShowCreateModal(false)}
          />
          <div className="relative w-full max-w-md p-6 rounded-2xl bg-[#0a0a0a] border border-white/[0.1] shadow-2xl">
            <button
              onClick={() => setShowCreateModal(false)}
              className="absolute top-4 right-4 p-2 rounded-lg hover:bg-white/[0.05] transition-colors"
            >
              <X className="w-4 h-4 text-neutral-400" />
            </button>

            <h3 className="text-lg font-semibold text-white mb-2">
              Create New App Version
            </h3>
            <p className="text-[13px] text-neutral-400 mb-6">
              Create a new editable version to update your app metadata.
            </p>

            <div className="space-y-4">
              <div>
                <label className="block text-[13px] font-medium text-neutral-300 mb-2">
                  Version Number
                </label>
                <input
                  type="text"
                  value={newVersion}
                  onChange={(e) => setNewVersion(e.target.value)}
                  placeholder="1.2.0"
                  className="w-full px-4 py-3 rounded-xl bg-white/[0.03] border border-white/[0.08]
                           text-white placeholder:text-neutral-600 focus:outline-none focus:border-purple-500/50
                           text-[14px]"
                />
                <p className="mt-2 text-[11px] text-neutral-500">
                  Must be higher than current version ({versionNumber || 'none'})
                </p>
              </div>

              {error && (
                <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20">
                  <p className="text-[13px] text-red-400">{error}</p>
                </div>
              )}

              <div className="flex gap-3">
                <button
                  onClick={() => setShowCreateModal(false)}
                  className="flex-1 px-4 py-2.5 rounded-xl text-[13px] font-medium
                           bg-white/[0.05] border border-white/[0.08] text-neutral-400
                           hover:bg-white/[0.08] hover:text-white transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreateVersion}
                  disabled={isCreating || !newVersion}
                  className="flex-1 px-4 py-2.5 rounded-xl text-[13px] font-medium
                           bg-gradient-to-r from-purple-500 to-blue-500 text-white
                           hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                >
                  {isCreating ? 'Creating...' : 'Create Version'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
