'use client'

import { useState, useRef } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import {
  ArrowLeft,
  Apple,
  Key,
  Upload,
  CheckCircle2,
  AlertCircle,
  Loader2,
  FileKey,
  Info
} from 'lucide-react'

export default function AppStoreCredentialsPage() {
  const params = useParams()
  const router = useRouter()
  const projectId = params.projectId as string
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const [formData, setFormData] = useState({
    keyId: '',
    issuerId: '',
    privateKey: '',
  })

  const [fileName, setFileName] = useState<string | null>(null)

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (!file.name.endsWith('.p8')) {
      setError('Please upload a .p8 file')
      return
    }

    setFileName(file.name)

    const reader = new FileReader()
    reader.onload = (event) => {
      const content = event.target?.result as string
      setFormData({ ...formData, privateKey: content })
      setError(null)
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
      const response = await fetch('/api/credentials/appstore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          keyId: formData.keyId,
          issuerId: formData.issuerId,
          privateKey: formData.privateKey,
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
          <div className="w-14 h-14 rounded-xl bg-blue-500/20 border border-blue-500/30 flex items-center justify-center">
            <Apple className="w-7 h-7 text-blue-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">App Store Connect API</h1>
            <p className="text-neutral-400 mt-1">Configure your API key for App Store Connect</p>
          </div>
        </div>

        {/* Info Box */}
        <div className="p-4 rounded-xl bg-blue-500/10 border border-blue-500/20 mb-6">
          <div className="flex items-start gap-3">
            <Info className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-blue-300">
              <p className="mb-2">
                You'll need an App Store Connect API key to upload metadata. Here's how to get one:
              </p>
              <ol className="list-decimal list-inside space-y-1 text-blue-400/80">
                <li>Go to <a href="https://appstoreconnect.apple.com/access/api" target="_blank" rel="noopener noreferrer" className="underline hover:text-blue-300">App Store Connect → Users and Access → Keys</a></li>
                <li>Click the + button to generate a new key</li>
                <li>Select "Admin" or "App Manager" role</li>
                <li>Download the .p8 file (you can only download it once!)</li>
                <li>Note the Key ID and Issuer ID from the page</li>
              </ol>
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="p-6 rounded-2xl bg-white/[0.02] border border-white/[0.08] space-y-6">
            <h2 className="text-lg font-semibold text-white flex items-center gap-2">
              <Key className="w-5 h-5 text-purple-400" />
              API Credentials
            </h2>

            <div className="grid gap-6 md:grid-cols-2">
              <div className="space-y-2">
                <label className="text-sm font-medium text-neutral-300">
                  Key ID <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={formData.keyId}
                  onChange={(e) => setFormData({ ...formData, keyId: e.target.value })}
                  placeholder="ABC123XYZ"
                  required
                  className="w-full px-4 py-3 rounded-xl bg-white/[0.03] border border-white/[0.08]
                           text-white placeholder:text-neutral-600 focus:outline-none focus:border-purple-500/50
                           hover:border-white/[0.15] transition-colors font-mono"
                />
                <p className="text-xs text-neutral-500">Found in the Keys section header</p>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-neutral-300">
                  Issuer ID <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={formData.issuerId}
                  onChange={(e) => setFormData({ ...formData, issuerId: e.target.value })}
                  placeholder="69a6de7b-630e-47e3-e053-5b8c7c11a4d1"
                  required
                  className="w-full px-4 py-3 rounded-xl bg-white/[0.03] border border-white/[0.08]
                           text-white placeholder:text-neutral-600 focus:outline-none focus:border-purple-500/50
                           hover:border-white/[0.15] transition-colors font-mono text-sm"
                />
                <p className="text-xs text-neutral-500">UUID shown at the top of the Keys page</p>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-neutral-300">
                Private Key (.p8 file) <span className="text-red-400">*</span>
              </label>

              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileUpload}
                accept=".p8"
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
                    <FileKey className="w-8 h-8 text-green-400" />
                    <div>
                      <p className="font-medium text-white">{fileName}</p>
                      <p className="text-sm text-green-400">File loaded successfully</p>
                    </div>
                  </>
                ) : (
                  <>
                    <Upload className="w-8 h-8 text-neutral-500" />
                    <div>
                      <p className="font-medium text-white">Click to upload .p8 file</p>
                      <p className="text-sm text-neutral-500">or drag and drop</p>
                    </div>
                  </>
                )}
              </div>

              <p className="text-xs text-neutral-500">
                Your private key is encrypted before storage and never exposed to the client
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
              disabled={isSubmitting || !formData.keyId || !formData.issuerId || !formData.privateKey}
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
