'use client'

import { useState, useRef } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import {
  ArrowLeft,
  Play,
  Key,
  Upload,
  CheckCircle2,
  AlertCircle,
  Loader2,
  FileJson,
  Info
} from 'lucide-react'

export default function PlayStoreCredentialsPage() {
  const params = useParams()
  const router = useRouter()
  const projectId = params.projectId as string
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const [serviceAccount, setServiceAccount] = useState<string>('')
  const [fileName, setFileName] = useState<string | null>(null)
  const [accountEmail, setAccountEmail] = useState<string | null>(null)

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (!file.name.endsWith('.json')) {
      setError('Please upload a .json file')
      return
    }

    setFileName(file.name)

    const reader = new FileReader()
    reader.onload = (event) => {
      const content = event.target?.result as string
      try {
        const parsed = JSON.parse(content)
        if (!parsed.client_email || !parsed.private_key) {
          setError('Invalid service account file. Missing required fields.')
          return
        }
        setServiceAccount(content)
        setAccountEmail(parsed.client_email)
        setError(null)
      } catch {
        setError('Invalid JSON file')
      }
    }
    reader.onerror = () => {
      setError('Failed to read file')
    }
    reader.readAsText(file)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)
    setError(null)

    try {
      const response = await fetch('/api/credentials/playstore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          serviceAccount,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to save credentials')
      }

      setSuccess(true)
      setTimeout(() => {
        router.push(`/projects/${projectId}/settings`)
      }, 2000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setIsSubmitting(false)
    }
  }

  if (success) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px]">
        <div className="w-16 h-16 rounded-2xl bg-green-500/20 border border-green-500/30 flex items-center justify-center mb-4">
          <CheckCircle2 className="w-8 h-8 text-green-400" />
        </div>
        <h2 className="text-xl font-semibold text-white mb-2">Credentials Saved</h2>
        <p className="text-neutral-400">Redirecting to settings...</p>
      </div>
    )
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <Link
          href={`/projects/${projectId}/settings`}
          className="inline-flex items-center gap-2 text-sm text-neutral-400 hover:text-white transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Settings
        </Link>
      </div>

      <div className="max-w-2xl">
        <div className="flex items-center gap-4 mb-8">
          <div className="w-14 h-14 rounded-xl bg-green-500/20 border border-green-500/30 flex items-center justify-center">
            <Play className="w-7 h-7 text-green-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">Google Play Console API</h1>
            <p className="text-neutral-400 mt-1">Configure your service account for Google Play</p>
          </div>
        </div>

        {/* Info Box */}
        <div className="p-4 rounded-xl bg-green-500/10 border border-green-500/20 mb-6">
          <div className="flex items-start gap-3">
            <Info className="w-5 h-5 text-green-400 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-green-300">
              <p className="mb-2">
                You'll need a Google Cloud service account with access to your Play Console. Here's how:
              </p>
              <ol className="list-decimal list-inside space-y-1.5 text-green-400/80">
                <li>Enable the <a href="https://console.cloud.google.com/apis/api/androidpublisher.googleapis.com/" target="_blank" rel="noopener noreferrer" className="underline hover:text-green-300">Google Play Android Developer API</a> in Google Cloud Console</li>
                <li>Go to <a href="https://console.cloud.google.com/iam-admin/serviceaccounts" target="_blank" rel="noopener noreferrer" className="underline hover:text-green-300">Service Accounts</a> and create a new service account (no roles needed)</li>
                <li>Click the account → <strong>Keys</strong> tab → <strong>Add Key</strong> → <strong>Create new key</strong> → select <strong>JSON</strong> and download it</li>
                <li>In <a href="https://play.google.com/console/users-and-permissions" target="_blank" rel="noopener noreferrer" className="underline hover:text-green-300">Google Play Console → Users and permissions</a>, click <strong>Invite new users</strong></li>
                <li>Paste the service account email, grant <strong>Admin</strong> permissions, then click <strong>Invite user</strong></li>
              </ol>
              <p className="text-xs text-amber-400/80 mt-2">
                ⚠️ It can take up to 36 hours for new credentials to become active.
              </p>
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="p-6 rounded-2xl bg-white/[0.02] border border-white/[0.08] space-y-6">
            <h2 className="text-lg font-semibold text-white flex items-center gap-2">
              <Key className="w-5 h-5 text-purple-400" />
              Service Account
            </h2>

            <div className="space-y-2">
              <label className="text-sm font-medium text-neutral-300">
                Service Account JSON <span className="text-red-400">*</span>
              </label>

              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileUpload}
                accept=".json"
                className="hidden"
              />

              <div
                onClick={() => fileInputRef.current?.click()}
                className={`flex items-center justify-center gap-3 p-8 rounded-xl border-2 border-dashed cursor-pointer transition-all ${
                  fileName
                    ? 'border-green-500/30 bg-green-500/5'
                    : 'border-white/[0.08] bg-white/[0.02] hover:border-purple-500/30 hover:bg-purple-500/5'
                }`}
              >
                {fileName ? (
                  <>
                    <FileJson className="w-8 h-8 text-green-400" />
                    <div>
                      <p className="font-medium text-white">{fileName}</p>
                      {accountEmail && (
                        <p className="text-sm text-green-400 font-mono">{accountEmail}</p>
                      )}
                    </div>
                  </>
                ) : (
                  <>
                    <Upload className="w-8 h-8 text-neutral-500" />
                    <div>
                      <p className="font-medium text-white">Click to upload service account JSON</p>
                      <p className="text-sm text-neutral-500">or drag and drop</p>
                    </div>
                  </>
                )}
              </div>

              <p className="text-xs text-neutral-500">
                Your service account credentials are encrypted before storage
              </p>
            </div>
          </div>

          {/* Security Note */}
          <div className="p-4 rounded-xl bg-purple-500/10 border border-purple-500/20">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-lg bg-purple-500/20 flex items-center justify-center flex-shrink-0">
                <Key className="w-4 h-4 text-purple-400" />
              </div>
              <div className="text-sm">
                <p className="font-medium text-purple-300 mb-1">Secure Storage</p>
                <p className="text-purple-400/80">
                  Your credentials are encrypted using AES-256-GCM with keys managed by Google Cloud KMS.
                  They are never stored in plaintext and cannot be retrieved once saved.
                </p>
              </div>
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 flex items-center gap-2">
              <AlertCircle className="w-4 h-4" />
              {error}
            </div>
          )}

          {/* Submit */}
          <div className="flex items-center justify-end gap-4">
            <Link
              href={`/projects/${projectId}/settings`}
              className="px-5 py-2.5 rounded-xl text-sm font-medium text-neutral-400 hover:text-white transition-colors"
            >
              Cancel
            </Link>
            <button
              type="submit"
              disabled={isSubmitting || !serviceAccount}
              className="flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-medium
                       bg-gradient-to-r from-purple-500 to-blue-500 text-white
                       hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
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
      </div>
    </div>
  )
}
