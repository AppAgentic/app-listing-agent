'use client'

import { FormEvent, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { AlertCircle, Building2, Loader2 } from 'lucide-react'

export default function CreateOrganizationPage() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setLoading(true)
    setError(null)

    try {
      const response = await fetch('/api/org/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Failed to create organization')

      router.push('/team')
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create organization')
      setLoading(false)
    }
  }

  return (
    <div className="mx-auto max-w-xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">Create organization</h1>
        <p className="mt-1 text-neutral-400">Set up the shared workspace for your team.</p>
      </div>

      <form onSubmit={handleSubmit} className="rounded-2xl border border-white/[0.08] bg-black/40 p-6">
        <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.05]">
          <Building2 className="h-6 w-6 text-neutral-300" />
        </div>

        <label htmlFor="organization-name" className="mb-2 block text-sm font-medium text-neutral-300">
          Organization name
        </label>
        <input
          id="organization-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          minLength={2}
          maxLength={100}
          required
          autoFocus
          placeholder="Acme Apps"
          className="w-full rounded-xl border border-white/[0.08] bg-black/40 px-4 py-3 text-white placeholder-neutral-600 focus:border-purple-500/50 focus:outline-none focus:ring-2 focus:ring-purple-500/30"
        />

        {error && (
          <div className="mt-4 flex items-center gap-2 rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-400">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        <div className="mt-6 flex items-center justify-end gap-3">
          <Link href="/team" className="rounded-lg px-4 py-2 text-sm font-medium text-neutral-400 hover:text-white">
            Cancel
          </Link>
          <button
            type="submit"
            disabled={loading || name.trim().length < 2}
            className="inline-flex items-center gap-2 rounded-lg bg-white px-4 py-2 text-sm font-medium text-black hover:bg-neutral-200 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            {loading ? 'Creating…' : 'Create organization'}
          </button>
        </div>
      </form>
    </div>
  )
}
