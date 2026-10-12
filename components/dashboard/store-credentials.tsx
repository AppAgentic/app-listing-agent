'use client'

import { useState } from 'react'
import { Apple, Play, Check, AlertCircle, Loader2, Eye, EyeOff, Trash2, FileKey, FileJson, CheckCircle2, XCircle } from 'lucide-react'

interface StoreCredentialsProps {
  appStoreConnected: boolean
  playStoreConnected: boolean
  onConnectionChange?: () => void // Called when a connection is added/removed
  onContinue?: () => void // Called when user clicks Continue
}

type ValidationStatus = 'idle' | 'validating' | 'valid' | 'invalid'

export function StoreCredentials({ appStoreConnected, playStoreConnected, onConnectionChange, onContinue }: StoreCredentialsProps) {
  // Track local connection state (updates immediately after save, before page reload)
  const [localAppStoreConnected, setLocalAppStoreConnected] = useState(appStoreConnected)
  const [localPlayStoreConnected, setLocalPlayStoreConnected] = useState(playStoreConnected)
  const [showAppStoreForm, setShowAppStoreForm] = useState(false)
  const [showPlayStoreForm, setShowPlayStoreForm] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  // App Store Connect form state
  const [appStoreData, setAppStoreData] = useState({
    keyId: '',
    issuerId: '',
    privateKey: ''
  })
  const [appStoreFileName, setAppStoreFileName] = useState<string | null>(null)
  const [appStoreValidation, setAppStoreValidation] = useState<ValidationStatus>('idle')
  const [appStoreValidationMessage, setAppStoreValidationMessage] = useState<string | null>(null)
  const [showPrivateKey, setShowPrivateKey] = useState(false)
  const [showJsonManual, setShowJsonManual] = useState(false)

  // Play Store form state
  const [playStoreData, setPlayStoreData] = useState({
    serviceAccountJson: ''
  })
  const [playStoreFileName, setPlayStoreFileName] = useState<string | null>(null)
  const [playStoreValidation, setPlayStoreValidation] = useState<ValidationStatus>('idle')
  const [playStoreValidationMessage, setPlayStoreValidationMessage] = useState<string | null>(null)

  // Extract Key ID from .p8 filename (Apple format: AuthKey_XXXXXXXXXX.p8)
  const extractKeyIdFromFilename = (filename: string): string | null => {
    const match = filename.match(/AuthKey_([A-Z0-9]+)\.p8$/i)
    return match ? match[1] : null
  }

  // Handle .p8 file upload
  const handleP8FileUpload = (file: File) => {
    if (file && file.name.endsWith('.p8')) {
      const reader = new FileReader()
      reader.onload = (event) => {
        const content = event.target?.result as string
        const extractedKeyId = extractKeyIdFromFilename(file.name)
        setAppStoreData(prev => ({
          ...prev,
          privateKey: content,
          keyId: extractedKeyId || prev.keyId
        }))
        setAppStoreFileName(file.name)
        setAppStoreValidation('idle')
        setAppStoreValidationMessage(null)
      }
      reader.readAsText(file)
    }
  }

  // Handle .json file upload
  const handleJsonFileUpload = (file: File) => {
    if (file && file.name.endsWith('.json')) {
      const reader = new FileReader()
      reader.onload = (event) => {
        const content = event.target?.result as string
        setPlayStoreData({ serviceAccountJson: content })
        setPlayStoreFileName(file.name)
        setPlayStoreValidation('idle')
        setPlayStoreValidationMessage(null)
      }
      reader.readAsText(file)
    }
  }

  // Validate App Store Connect credentials
  const validateAppStoreCredentials = async () => {
    if (!appStoreData.keyId || !appStoreData.issuerId || !appStoreData.privateKey) {
      setAppStoreValidationMessage('Please fill in all fields first')
      return
    }

    setAppStoreValidation('validating')
    setAppStoreValidationMessage(null)

    try {
      const response = await fetch('/api/account/credentials/appstore/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(appStoreData)
      })

      const data = await response.json()

      if (data.valid) {
        setAppStoreValidation('valid')
        setAppStoreValidationMessage(data.message || 'Valid credentials')
      } else {
        setAppStoreValidation('invalid')
        setAppStoreValidationMessage(data.error || 'Invalid credentials')
      }
    } catch (err) {
      setAppStoreValidation('invalid')
      setAppStoreValidationMessage('Failed to validate credentials')
    }
  }

  // Validate Play Store credentials
  const validatePlayStoreCredentials = async () => {
    if (!playStoreData.serviceAccountJson) {
      setPlayStoreValidationMessage('Please upload a service account JSON file first')
      return
    }

    setPlayStoreValidation('validating')
    setPlayStoreValidationMessage(null)

    try {
      const response = await fetch('/api/account/credentials/playstore/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serviceAccountJson: playStoreData.serviceAccountJson })
      })

      const data = await response.json()

      if (data.valid) {
        setPlayStoreValidation('valid')
        setPlayStoreValidationMessage(data.message || 'Valid credentials')
      } else {
        setPlayStoreValidation('invalid')
        setPlayStoreValidationMessage(data.error || 'Invalid credentials')
      }
    } catch (err) {
      setPlayStoreValidation('invalid')
      setPlayStoreValidationMessage('Failed to validate credentials')
    }
  }

  const handleAppStoreSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)
    setError(null)
    setSuccess(null)

    try {
      const response = await fetch('/api/account/credentials/appstore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(appStoreData)
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to save credentials')
      }

      setSuccess('App Store Connect credentials saved successfully!')
      setShowAppStoreForm(false)
      setAppStoreData({ keyId: '', issuerId: '', privateKey: '' })
      setAppStoreFileName(null)
      setAppStoreValidation('idle')
      setLocalAppStoreConnected(true)
      onConnectionChange?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handlePlayStoreSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)
    setError(null)
    setSuccess(null)

    try {
      const response = await fetch('/api/account/credentials/playstore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serviceAccountJson: playStoreData.serviceAccountJson })
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to save credentials')
      }

      setSuccess('Google Play Console credentials saved successfully!')
      setShowPlayStoreForm(false)
      setPlayStoreData({ serviceAccountJson: '' })
      setPlayStoreFileName(null)
      setPlayStoreValidation('idle')
      setLocalPlayStoreConnected(true)
      onConnectionChange?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleDisconnect = async (store: 'appstore' | 'playstore') => {
    if (!confirm(`Are you sure you want to disconnect ${store === 'appstore' ? 'App Store Connect' : 'Google Play Console'}? This will remove your stored credentials.`)) {
      return
    }

    setIsSubmitting(true)
    setError(null)

    try {
      const response = await fetch(`/api/account/credentials/${store}`, {
        method: 'DELETE'
      })

      if (!response.ok) {
        throw new Error('Failed to disconnect')
      }

      setSuccess(`${store === 'appstore' ? 'App Store Connect' : 'Google Play Console'} disconnected successfully!`)
      if (store === 'appstore') {
        setLocalAppStoreConnected(false)
      } else {
        setLocalPlayStoreConnected(false)
      }
      onConnectionChange?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* Status Messages */}
      {error && (
        <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0" />
          <p className="text-red-400 text-sm">{error}</p>
        </div>
      )}
      {success && (
        <div className="p-4 rounded-xl bg-green-500/10 border border-green-500/20 flex items-center gap-3">
          <Check className="w-5 h-5 text-green-400 flex-shrink-0" />
          <p className="text-green-400 text-sm">{success}</p>
        </div>
      )}

      {/* App Store Connect */}
      <div className="p-4 rounded-xl bg-black/20 border border-white/[0.05]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-500/20 flex items-center justify-center">
              <Apple className="w-5 h-5 text-blue-400" />
            </div>
            <div>
              <h3 className="font-medium text-white">App Store Connect</h3>
              <p className="text-sm text-neutral-500">
                {localAppStoreConnected ? 'Connected' : 'Not connected'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {localAppStoreConnected ? (
              <>
                <span className="px-2.5 py-1 rounded-lg bg-green-500/20 text-green-400 text-xs font-medium">
                  Connected
                </span>
                <button
                  onClick={() => handleDisconnect('appstore')}
                  disabled={isSubmitting}
                  className="p-2 rounded-lg text-red-400 hover:bg-red-500/10 transition-colors"
                  title="Disconnect"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </>
            ) : (
              <button
                onClick={() => setShowAppStoreForm(!showAppStoreForm)}
                className="px-4 py-2 rounded-xl bg-blue-500/20 text-blue-400 border border-blue-500/30 hover:bg-blue-500/30 transition-colors text-sm font-medium"
              >
                {showAppStoreForm ? 'Cancel' : 'Connect'}
              </button>
            )}
          </div>
        </div>

        {/* App Store Connect Form */}
        {showAppStoreForm && !localAppStoreConnected && (
          <form onSubmit={handleAppStoreSubmit} className="mt-4 pt-4 border-t border-white/[0.08] space-y-4">
            <div className="p-3 rounded-lg bg-blue-500/10 border border-blue-500/20">
              <p className="text-sm text-blue-300 mb-2">
                <strong>How to get your credentials:</strong>
              </p>
              <ol className="text-xs text-blue-300/80 space-y-1 list-decimal list-inside">
                <li>Go to <a href="https://appstoreconnect.apple.com/access/integrations/api" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">App Store Connect → Users and Access → Integrations → Keys</a></li>
                <li>Click the "+" button to generate a new API key</li>
                <li>Select "Admin" or "App Manager" access</li>
                <li>Download the .p8 file (only available once!)</li>
                <li>Copy the Key ID and Issuer ID shown on the page</li>
              </ol>
              <a
                href="https://developer.apple.com/documentation/appstoreconnectapi/creating_api_keys_for_app_store_connect_api"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block mt-2 text-xs text-blue-400 hover:underline"
              >
                📄 Apple Documentation →
              </a>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <label className="text-sm font-medium text-neutral-300">Key ID</label>
                <input
                  type="text"
                  value={appStoreData.keyId}
                  onChange={(e) => setAppStoreData({ ...appStoreData, keyId: e.target.value })}
                  placeholder="XXXXXXXXXX"
                  required
                  className="w-full px-4 py-3 rounded-xl bg-white/[0.03] border border-white/[0.08]
                           text-white placeholder:text-neutral-600 focus:outline-none focus:border-blue-500/50
                           hover:border-white/[0.15] transition-colors text-sm"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-neutral-300">Issuer ID</label>
                <input
                  type="text"
                  value={appStoreData.issuerId}
                  onChange={(e) => setAppStoreData({ ...appStoreData, issuerId: e.target.value })}
                  placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                  required
                  className="w-full px-4 py-3 rounded-xl bg-white/[0.03] border border-white/[0.08]
                           text-white placeholder:text-neutral-600 focus:outline-none focus:border-blue-500/50
                           hover:border-white/[0.15] transition-colors text-sm"
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-neutral-300">Private Key (.p8 file)</label>

              {/* File Upload Zone */}
              <div
                className={`relative border-2 border-dashed rounded-xl p-4 transition-colors
                          ${appStoreData.privateKey
                            ? 'border-green-500/30 bg-green-500/5'
                            : 'border-white/[0.1] hover:border-blue-500/30 hover:bg-blue-500/5 cursor-pointer'}`}
                onClick={() => !appStoreData.privateKey && document.getElementById('p8-file-input')?.click()}
                onDragOver={(e) => {
                  e.preventDefault()
                  if (!appStoreData.privateKey) {
                    e.currentTarget.classList.add('border-blue-500/50', 'bg-blue-500/10')
                  }
                }}
                onDragLeave={(e) => {
                  e.preventDefault()
                  e.currentTarget.classList.remove('border-blue-500/50', 'bg-blue-500/10')
                }}
                onDrop={(e) => {
                  e.preventDefault()
                  e.currentTarget.classList.remove('border-blue-500/50', 'bg-blue-500/10')
                  const file = e.dataTransfer.files[0]
                  if (file) handleP8FileUpload(file)
                }}
              >
                <input
                  id="p8-file-input"
                  type="file"
                  accept=".p8"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) handleP8FileUpload(file)
                  }}
                />
                {appStoreData.privateKey ? (
                  <div className="space-y-3">
                    {/* File info row */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-blue-500/20 flex items-center justify-center">
                          <FileKey className="w-5 h-5 text-blue-400" />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-white">
                            {appStoreFileName || 'Private key'}
                          </p>
                          <p className="text-xs text-neutral-500">
                            App Store Connect API Key
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          setAppStoreData({ ...appStoreData, privateKey: '', keyId: '' })
                          setAppStoreFileName(null)
                          setAppStoreValidation('idle')
                          setAppStoreValidationMessage(null)
                        }}
                        className="p-2 rounded-lg text-neutral-400 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>

                    {/* Validation status */}
                    {appStoreValidation !== 'idle' && (
                      <div className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm
                        ${appStoreValidation === 'validating' ? 'bg-blue-500/10 text-blue-400' : ''}
                        ${appStoreValidation === 'valid' ? 'bg-green-500/10 text-green-400' : ''}
                        ${appStoreValidation === 'invalid' ? 'bg-red-500/10 text-red-400' : ''}`}
                      >
                        {appStoreValidation === 'validating' && <Loader2 className="w-4 h-4 animate-spin" />}
                        {appStoreValidation === 'valid' && <CheckCircle2 className="w-4 h-4" />}
                        {appStoreValidation === 'invalid' && <XCircle className="w-4 h-4" />}
                        <span>{appStoreValidationMessage}</span>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="py-2 text-center">
                    <p className="text-sm text-neutral-400">
                      Drop your <span className="text-blue-400 font-medium">.p8</span> file here or click to browse
                    </p>
                    <p className="text-xs text-neutral-500 mt-1">
                      Downloaded from App Store Connect
                    </p>
                  </div>
                )}
              </div>

              {/* Manual Entry Toggle */}
              <button
                type="button"
                onClick={() => setShowPrivateKey(!showPrivateKey)}
                className="text-xs text-neutral-500 hover:text-neutral-300 transition-colors"
              >
                {showPrivateKey ? 'Hide manual entry' : 'Or paste key manually'}
              </button>

              {/* Manual Text Entry (Hidden by default) */}
              {showPrivateKey && (
                <div className="relative">
                  <textarea
                    value={appStoreData.privateKey}
                    onChange={(e) => setAppStoreData({ ...appStoreData, privateKey: e.target.value })}
                    placeholder="-----BEGIN PRIVATE KEY-----
...
-----END PRIVATE KEY-----"
                    rows={4}
                    className="w-full px-4 py-3 rounded-xl bg-white/[0.03] border border-white/[0.08]
                             text-white placeholder:text-neutral-600 focus:outline-none focus:border-blue-500/50
                             hover:border-white/[0.15] transition-colors text-sm font-mono resize-none"
                  />
                </div>
              )}
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={validateAppStoreCredentials}
                disabled={appStoreValidation === 'validating' || !appStoreData.keyId || !appStoreData.issuerId || !appStoreData.privateKey}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-white/[0.05] text-white font-medium text-sm
                         border border-white/[0.1] hover:bg-white/[0.1] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {appStoreValidation === 'validating' ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Validating...
                  </>
                ) : (
                  'Validate'
                )}
              </button>
              <button
                type="submit"
                disabled={isSubmitting || !appStoreData.keyId || !appStoreData.issuerId || !appStoreData.privateKey}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-blue-500 text-white font-medium text-sm
                         hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Saving...
                  </>
                ) : (
                  'Save Credentials'
                )}
              </button>
            </div>
          </form>
        )}
      </div>

      {/* Google Play Console */}
      <div className="p-4 rounded-xl bg-black/20 border border-white/[0.05]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-green-500/20 flex items-center justify-center">
              <Play className="w-5 h-5 text-green-400" />
            </div>
            <div>
              <h3 className="font-medium text-white">Google Play Console</h3>
              <p className="text-sm text-neutral-500">
                {localPlayStoreConnected ? 'Connected' : 'Not connected'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {localPlayStoreConnected ? (
              <>
                <span className="px-2.5 py-1 rounded-lg bg-green-500/20 text-green-400 text-xs font-medium">
                  Connected
                </span>
                <button
                  onClick={() => handleDisconnect('playstore')}
                  disabled={isSubmitting}
                  className="p-2 rounded-lg text-red-400 hover:bg-red-500/10 transition-colors"
                  title="Disconnect"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </>
            ) : (
              <button
                onClick={() => setShowPlayStoreForm(!showPlayStoreForm)}
                className="px-4 py-2 rounded-xl bg-green-500/20 text-green-400 border border-green-500/30 hover:bg-green-500/30 transition-colors text-sm font-medium"
              >
                {showPlayStoreForm ? 'Cancel' : 'Connect'}
              </button>
            )}
          </div>
        </div>

        {/* Play Store Form */}
        {showPlayStoreForm && !localPlayStoreConnected && (
          <form onSubmit={handlePlayStoreSubmit} className="mt-4 pt-4 border-t border-white/[0.08] space-y-4">
            <div className="p-3 rounded-lg bg-green-500/10 border border-green-500/20">
              <p className="text-sm text-green-300 mb-2">
                <strong>How to get your credentials:</strong>
              </p>
              <ol className="text-xs text-green-300/80 space-y-1.5 list-decimal list-inside">
                <li>Enable the <a href="https://console.cloud.google.com/apis/api/androidpublisher.googleapis.com/" target="_blank" rel="noopener noreferrer" className="text-green-400 hover:underline">Google Play Android Developer API</a> in Google Cloud Console</li>
                <li>Go to <a href="https://console.cloud.google.com/iam-admin/serviceaccounts" target="_blank" rel="noopener noreferrer" className="text-green-400 hover:underline">Service Accounts</a> and create a new service account (no roles needed)</li>
                <li>Click the account → <strong>Keys</strong> tab → <strong>Add Key</strong> → <strong>Create new key</strong> → select <strong>JSON</strong> and download it</li>
                <li>In <a href="https://play.google.com/console/users-and-permissions" target="_blank" rel="noopener noreferrer" className="text-green-400 hover:underline">Google Play Console → Users and permissions</a>, click <strong>Invite new users</strong></li>
                <li>Paste the service account email, grant <strong>Admin</strong> permissions, then click <strong>Invite user</strong></li>
              </ol>
              <p className="text-xs text-amber-400/80 mt-2">
                ⚠️ It can take up to 36 hours for new credentials to become active.
              </p>
              <a
                href="https://developers.google.com/android-publisher/getting_started"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block mt-2 text-xs text-green-400 hover:underline"
              >
                Google Documentation →
              </a>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-neutral-300">Service Account JSON</label>

              {/* File Upload Zone */}
              <div
                className={`relative border-2 border-dashed rounded-xl p-4 transition-colors
                          ${playStoreData.serviceAccountJson
                            ? 'border-green-500/30 bg-green-500/5'
                            : 'border-white/[0.1] hover:border-green-500/30 hover:bg-green-500/5 cursor-pointer'}`}
                onClick={() => !playStoreData.serviceAccountJson && document.getElementById('json-file-input')?.click()}
                onDragOver={(e) => {
                  e.preventDefault()
                  if (!playStoreData.serviceAccountJson) {
                    e.currentTarget.classList.add('border-green-500/50', 'bg-green-500/10')
                  }
                }}
                onDragLeave={(e) => {
                  e.preventDefault()
                  e.currentTarget.classList.remove('border-green-500/50', 'bg-green-500/10')
                }}
                onDrop={(e) => {
                  e.preventDefault()
                  e.currentTarget.classList.remove('border-green-500/50', 'bg-green-500/10')
                  const file = e.dataTransfer.files[0]
                  if (file) handleJsonFileUpload(file)
                }}
              >
                <input
                  id="json-file-input"
                  type="file"
                  accept=".json"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) handleJsonFileUpload(file)
                  }}
                />
                {playStoreData.serviceAccountJson ? (
                  <div className="space-y-3">
                    {/* File info row */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-green-500/20 flex items-center justify-center">
                          <FileJson className="w-5 h-5 text-green-400" />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-white">
                            {playStoreFileName || 'Service account'}
                          </p>
                          <p className="text-xs text-neutral-500">
                            Google Play Console Service Account
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          setPlayStoreData({ serviceAccountJson: '' })
                          setPlayStoreFileName(null)
                          setPlayStoreValidation('idle')
                          setPlayStoreValidationMessage(null)
                        }}
                        className="p-2 rounded-lg text-neutral-400 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>

                    {/* Validation status */}
                    {playStoreValidation !== 'idle' && (
                      <div className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm
                        ${playStoreValidation === 'validating' ? 'bg-green-500/10 text-green-400' : ''}
                        ${playStoreValidation === 'valid' ? 'bg-green-500/10 text-green-400' : ''}
                        ${playStoreValidation === 'invalid' ? 'bg-red-500/10 text-red-400' : ''}`}
                      >
                        {playStoreValidation === 'validating' && <Loader2 className="w-4 h-4 animate-spin" />}
                        {playStoreValidation === 'valid' && <CheckCircle2 className="w-4 h-4" />}
                        {playStoreValidation === 'invalid' && <XCircle className="w-4 h-4" />}
                        <span>{playStoreValidationMessage}</span>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="py-2 text-center">
                    <p className="text-sm text-neutral-400">
                      Drop your <span className="text-green-400 font-medium">.json</span> file here or click to browse
                    </p>
                    <p className="text-xs text-neutral-500 mt-1">
                      Service account key from Google Cloud Console
                    </p>
                  </div>
                )}
              </div>

              {/* Manual Entry Toggle */}
              <button
                type="button"
                onClick={() => setShowJsonManual(!showJsonManual)}
                className="text-xs text-neutral-500 hover:text-neutral-300 transition-colors"
              >
                {showJsonManual ? 'Hide manual entry' : 'Or paste JSON manually'}
              </button>

              {/* Manual Text Entry (Hidden by default) */}
              {showJsonManual && (
                <textarea
                  value={playStoreData.serviceAccountJson}
                  onChange={(e) => setPlayStoreData({ serviceAccountJson: e.target.value })}
                  placeholder='{"type": "service_account", "project_id": "...", ...}'
                  rows={6}
                  className="w-full px-4 py-3 rounded-xl bg-white/[0.03] border border-white/[0.08]
                           text-white placeholder:text-neutral-600 focus:outline-none focus:border-green-500/50
                           hover:border-white/[0.15] transition-colors text-sm font-mono resize-none"
                />
              )}
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={validatePlayStoreCredentials}
                disabled={playStoreValidation === 'validating' || !playStoreData.serviceAccountJson}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-white/[0.05] text-white font-medium text-sm
                         border border-white/[0.1] hover:bg-white/[0.1] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {playStoreValidation === 'validating' ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Validating...
                  </>
                ) : (
                  'Validate'
                )}
              </button>
              <button
                type="submit"
                disabled={isSubmitting || !playStoreData.serviceAccountJson}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-green-500 text-white font-medium text-sm
                         hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Saving...
                  </>
                ) : (
                  'Save Credentials'
                )}
              </button>
            </div>
          </form>
        )}
      </div>

      {/* Continue Button - shows when at least one store is connected */}
      {onContinue && (localAppStoreConnected || localPlayStoreConnected) && (
        <div className="pt-2">
          <button
            onClick={onContinue}
            className="w-full px-5 py-3 rounded-xl bg-white text-black font-medium text-sm
                     hover:bg-neutral-200 transition-colors"
          >
            Continue
          </button>
        </div>
      )}
    </div>
  )
}
