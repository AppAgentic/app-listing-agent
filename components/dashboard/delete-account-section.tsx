'use client'

import { useState } from 'react'
import { AlertTriangle, Loader2, Trash2 } from 'lucide-react'
import { forgetAnalyticsIdentity } from '@/lib/analytics/client'

export function DeleteAccountSection({ email }: { email: string }) {
  const [expanded, setExpanded] = useState(false)
  const [confirmation, setConfirmation] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function deleteAccount() {
    setLoading(true)
    setError('')
    try {
      const response = await fetch('/api/account', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmation }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.message || 'Account deletion failed.')
      forgetAnalyticsIdentity()
      window.location.assign('/login?deleted=true')
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Account deletion failed.')
      setLoading(false)
    }
  }

  return (
    <div className="rounded-2xl border border-red-500/20 bg-red-500/[0.04] p-6">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-red-500/20 bg-red-500/10">
          <Trash2 className="h-5 w-5 text-red-400" />
        </div>
        <div className="flex-1">
          <h2 className="text-lg font-semibold text-white">Delete account</h2>
          <p className="mt-1 text-sm leading-6 text-neutral-400">
            Permanently removes your projects, credentials, API keys, and account data. Active subscriptions must be cancelled first.
          </p>

          {!expanded ? (
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="mt-4 rounded-lg border border-red-500/30 px-4 py-2 text-sm font-medium text-red-300 transition-colors hover:bg-red-500/10"
            >
              Delete my account
            </button>
          ) : (
            <div className="mt-5 max-w-xl rounded-xl border border-red-500/20 bg-black/30 p-4">
              <div className="flex gap-2 text-sm text-red-200">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <p>This cannot be undone. If you own a team, transfer ownership before continuing.</p>
              </div>
              <label htmlFor="delete-confirmation" className="mt-4 block text-sm text-neutral-300">
                Type <span className="font-medium text-white">{email}</span> to confirm
              </label>
              <input
                id="delete-confirmation"
                type="email"
                value={confirmation}
                onChange={event => setConfirmation(event.target.value)}
                autoComplete="off"
                className="mt-2 w-full rounded-lg border border-white/10 bg-black px-3 py-2 text-white outline-none transition-colors focus:border-red-500/50"
              />
              {error && <p role="alert" className="mt-3 text-sm text-red-400">{error}</p>}
              <div className="mt-4 flex gap-3">
                <button
                  type="button"
                  onClick={deleteAccount}
                  disabled={loading || confirmation.trim().toLowerCase() !== email.trim().toLowerCase()}
                  className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                  Permanently delete
                </button>
                <button
                  type="button"
                  onClick={() => { setExpanded(false); setConfirmation(''); setError('') }}
                  disabled={loading}
                  className="px-3 py-2 text-sm text-neutral-400 hover:text-white"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
