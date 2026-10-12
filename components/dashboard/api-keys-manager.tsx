'use client'

import { useState } from 'react'
import { Key, Plus, Copy, Check, Trash2, Clock, Shield, AlertTriangle, X, Loader2 } from 'lucide-react'
import { useApiKeys } from '@/lib/hooks/useApiKeys'

interface ApiKeysManagerProps {
  plan: string
}

const SCOPE_OPTIONS = [
  { value: 'all', label: 'All launch tools', description: 'Access every tool available to your account' },
  { value: 'read', label: 'Read', description: 'Read project data and metadata' },
  { value: 'write', label: 'Write', description: 'Modify project data and metadata' },
  { value: 'translate', label: 'Translate', description: 'Use AI translation features' },
  { value: 'screenshots', label: 'Screenshots', description: 'Generate screenshots' },
  { value: 'publish', label: 'Publish', description: 'Publish to app stores' },
]

export function ApiKeysManager({ plan }: ApiKeysManagerProps) {
  const {
    keys,
    loading,
    error,
    creating,
    revokingId,
    createKey,
    revokeKey,
    clearError,
    isFreePlan,
    keyLimit,
    canCreateKey,
  } = useApiKeys({ plan })

  // Modal state
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [newKey, setNewKey] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  // Form state
  const [keyName, setKeyName] = useState('')
  const [selectedScopes, setSelectedScopes] = useState<string[]>(['all'])
  const [expiresInDays, setExpiresInDays] = useState<number | null>(null)

  const handleCreateKey = async () => {
    const key = await createKey({
      name: keyName,
      scopes: selectedScopes,
      expiresInDays: expiresInDays || undefined,
    })

    if (key) {
      setNewKey(key)
      setKeyName('')
      setSelectedScopes(['all'])
      setExpiresInDays(null)
    }
  }

  const handleCopy = async (text: string) => {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  }

  const handleCloseModal = () => {
    setNewKey(null)
    setShowCreateModal(false)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 text-purple-400 animate-spin" />
      </div>
    )
  }

  if (error === 'upgrade_required' || isFreePlan) {
    return (
      <div className="text-center py-8">
        <div className="w-12 h-12 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center mx-auto mb-4">
          <Key className="w-6 h-6 text-purple-400" />
        </div>
        <h3 className="text-lg font-semibold text-white mb-2">API Keys Require Pro Plan</h3>
        <p className="text-neutral-400 mb-6 max-w-md mx-auto">
          Upgrade to Pro or higher to connect an AI agent or create keys for automated workflows.
        </p>
        <a
          href="/billing?plan=pro&interval=monthly&reason=api_keys"
          className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-r from-purple-500 to-blue-500 text-white font-medium hover:opacity-90 transition-opacity"
        >
          Upgrade to Pro
        </a>
      </div>
    )
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="text-sm text-neutral-400">
          {keys.length} / {keyLimit} keys used
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          disabled={!canCreateKey}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-purple-500/10 text-purple-400 border border-purple-500/20 hover:bg-purple-500/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
        >
          <Plus className="w-4 h-4" />
          Create Key
        </button>
      </div>

      {/* Keys List */}
      {keys.length === 0 ? (
        <div className="text-center py-12 border border-dashed border-white/[0.08] rounded-xl">
          <Key className="w-10 h-10 text-neutral-600 mx-auto mb-3" />
          <p className="text-neutral-400 mb-1">No API keys yet</p>
          <p className="text-neutral-500 text-sm">Create your first scoped key for an AI agent or workflow</p>
        </div>
      ) : (
        <div className="space-y-3">
          {keys.map((key) => (
            <div
              key={key.id}
              className="p-4 rounded-xl bg-black/20 border border-white/[0.08] hover:border-white/[0.12] transition-colors"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 mb-2">
                    <span className="font-medium text-white">{key.name}</span>
                    <code className="text-xs px-2 py-0.5 rounded bg-white/[0.05] text-neutral-400 font-mono">
                      {key.keyPrefix}
                    </code>
                  </div>
                  <div className="flex flex-wrap items-center gap-3 text-xs text-neutral-500">
                    <span className="flex items-center gap-1">
                      <Shield className="w-3 h-3" />
                      {key.scopes.join(', ')}
                    </span>
                    <span>Created {formatDate(key.createdAt)}</span>
                    {key.lastUsedAt && <span>Last used {formatDate(key.lastUsedAt)}</span>}
                    {key.expiresAt && (
                      <span className="flex items-center gap-1 text-yellow-500">
                        <Clock className="w-3 h-3" />
                        Expires {formatDate(key.expiresAt)}
                      </span>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => revokeKey(key.id)}
                  disabled={revokingId === key.id}
                  className="p-2 rounded-lg text-red-400/60 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                  title="Revoke key"
                >
                  {revokingId === key.id ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Trash2 className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => {
              if (!newKey) setShowCreateModal(false)
            }}
          />
          <div className="relative w-full max-w-lg bg-neutral-900 border border-white/[0.08] rounded-2xl overflow-hidden">
            {newKey ? (
              /* Success state - show new key */
              <div className="p-6">
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-10 h-10 rounded-xl bg-green-500/10 border border-green-500/20 flex items-center justify-center">
                    <Check className="w-5 h-5 text-green-400" />
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-white">API Key Created</h3>
                    <p className="text-sm text-neutral-400">
                      Copy it now - you won&apos;t see it again!
                    </p>
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-black/40 border border-white/[0.08] mb-6">
                  <div className="flex items-center gap-3 mb-2">
                    <AlertTriangle className="w-4 h-4 text-yellow-500" />
                    <span className="text-sm text-yellow-500 font-medium">Save this key securely</span>
                  </div>
                  <code className="block text-sm text-neutral-300 font-mono break-all bg-black/40 p-3 rounded-lg">
                    {newKey}
                  </code>
                </div>

                <div className="flex gap-3">
                  <button
                    onClick={() => handleCopy(newKey)}
                    className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl transition-colors font-medium ${
                      copied
                        ? 'bg-green-500/10 text-green-400 border border-green-500/20'
                        : 'bg-purple-500/10 text-purple-400 border border-purple-500/20 hover:bg-purple-500/20'
                    }`}
                  >
                    {copied ? (
                      <>
                        <Check className="w-4 h-4" />
                        Copied!
                      </>
                    ) : (
                      <>
                        <Copy className="w-4 h-4" />
                        Copy Key
                      </>
                    )}
                  </button>
                  <button
                    onClick={handleCloseModal}
                    className="px-4 py-3 rounded-xl border border-white/[0.08] text-neutral-400 hover:text-white hover:bg-white/[0.05] transition-colors"
                  >
                    Done
                  </button>
                </div>
              </div>
            ) : (
              /* Create form */
              <div>
                <div className="flex items-center justify-between p-6 border-b border-white/[0.08]">
                  <h3 className="text-lg font-semibold text-white">Create API Key</h3>
                  <button
                    onClick={() => setShowCreateModal(false)}
                    className="p-2 rounded-lg text-neutral-400 hover:text-white hover:bg-white/[0.05] transition-colors"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <div className="p-6 space-y-6">
                  {/* Name */}
                  <div>
                    <label className="block text-sm font-medium text-white mb-2">Name</label>
                    <input
                      type="text"
                      value={keyName}
                      onChange={(e) => setKeyName(e.target.value)}
                      placeholder="e.g., Codex, Claude Code, GitHub Actions"
                      className="w-full px-4 py-3 rounded-xl bg-black/40 border border-white/[0.08] text-white placeholder:text-neutral-500 focus:outline-none focus:border-purple-500/50"
                      maxLength={50}
                    />
                  </div>

                  {/* Scopes */}
                  <div>
                    <label className="block text-sm font-medium text-white mb-2">Permissions</label>
                    <div className="grid grid-cols-2 gap-2">
                      {SCOPE_OPTIONS.map((scope) => (
                        <button
                          key={scope.value}
                          onClick={() => {
                            if (scope.value === 'all') {
                              setSelectedScopes(['all'])
                            } else {
                              setSelectedScopes((prev) => {
                                const withoutAll = prev.filter((s) => s !== 'all')
                                return prev.includes(scope.value)
                                  ? withoutAll.filter((s) => s !== scope.value)
                                  : [...withoutAll, scope.value]
                              })
                            }
                          }}
                          className={`p-3 rounded-xl border text-left transition-colors ${
                            selectedScopes.includes(scope.value)
                              ? 'bg-purple-500/10 border-purple-500/30 text-purple-400'
                              : 'border-white/[0.08] text-neutral-400 hover:border-white/[0.15]'
                          }`}
                        >
                          <div className="font-medium text-sm">{scope.label}</div>
                          <div className="text-xs opacity-60 mt-0.5">{scope.description}</div>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Expiration */}
                  <div>
                    <label className="block text-sm font-medium text-white mb-2">
                      Expiration (optional)
                    </label>
                    <select
                      value={expiresInDays || ''}
                      onChange={(e) => setExpiresInDays(e.target.value ? Number(e.target.value) : null)}
                      className="w-full px-4 py-3 rounded-xl bg-black/40 border border-white/[0.08] text-white focus:outline-none focus:border-purple-500/50"
                    >
                      <option value="">Never expires</option>
                      <option value="30">30 days</option>
                      <option value="90">90 days</option>
                      <option value="180">6 months</option>
                      <option value="365">1 year</option>
                    </select>
                  </div>
                </div>

                <div className="flex gap-3 p-6 border-t border-white/[0.08]">
                  <button
                    onClick={() => setShowCreateModal(false)}
                    className="flex-1 px-4 py-3 rounded-xl border border-white/[0.08] text-neutral-400 hover:text-white hover:bg-white/[0.05] transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleCreateKey}
                    disabled={!keyName.trim() || creating}
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-gradient-to-r from-purple-500 to-blue-500 text-white font-medium hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {creating ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Creating...
                      </>
                    ) : (
                      <>
                        <Plus className="w-4 h-4" />
                        Create Key
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Error Toast */}
      {error && error !== 'upgrade_required' && (
        <div className="fixed bottom-4 right-4 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 flex items-center gap-3">
          <AlertTriangle className="w-5 h-5" />
          <span>{error}</span>
          <button onClick={clearError} className="p-1 rounded-lg hover:bg-red-500/10">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  )
}
