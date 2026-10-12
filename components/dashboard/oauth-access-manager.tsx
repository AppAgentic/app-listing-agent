'use client'

import { useState } from 'react'

type RevokeState = 'idle' | 'confirming' | 'revoking' | 'revoked' | 'error'

export function OAuthAccessManager() {
  const [state, setState] = useState<RevokeState>('idle')

  async function revokeAccess() {
    setState('revoking')
    try {
      const response = await fetch('/api/oauth/connections', { method: 'DELETE' })
      if (!response.ok) throw new Error('Unable to revoke agent access')
      setState('revoked')
    } catch {
      setState('error')
    }
  }

  return (
    <div className="mt-6 border-t border-white/[0.08] pt-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="max-w-xl">
          <p className="text-sm font-medium text-white">OAuth agent access</p>
          <p className="mt-1 text-sm leading-relaxed text-neutral-500">
            Agents can access only the app and authority you approved. Revoke every active OAuth grant at any time.
          </p>
        </div>

        {state === 'confirming' ? (
          <div className="flex shrink-0 items-center gap-2" role="group" aria-label="Confirm OAuth revocation">
            <button
              type="button"
              onClick={() => setState('idle')}
              className="rounded-lg border border-white/[0.1] px-3 py-2 text-sm font-medium text-neutral-300 transition duration-200 hover:bg-white/[0.05] active:scale-[0.98]"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={revokeAccess}
              className="rounded-lg bg-red-500/90 px-3 py-2 text-sm font-medium text-white transition duration-200 hover:bg-red-500 active:scale-[0.98]"
            >
              Confirm revoke
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setState('confirming')}
            disabled={state === 'revoking' || state === 'revoked'}
            className="shrink-0 rounded-lg border border-white/[0.1] px-3 py-2 text-sm font-medium text-neutral-300 transition duration-200 hover:border-red-400/40 hover:bg-red-500/[0.08] hover:text-red-200 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {state === 'revoking' ? 'Revoking access…' : state === 'revoked' ? 'Access revoked' : 'Revoke agent access'}
          </button>
        )}
      </div>

      {state === 'revoked' && (
        <p className="mt-3 text-sm text-emerald-400" role="status">
          Agent access revoked. Existing and refreshed tokens can no longer call App Listing Agent.
        </p>
      )}
      {state === 'error' && (
        <div className="mt-3 flex items-center justify-between gap-4" role="alert">
          <p className="text-sm text-red-300">Agent access could not be revoked. Try again.</p>
          <button
            type="button"
            onClick={() => setState('confirming')}
            className="text-sm font-medium text-neutral-300 underline decoration-neutral-600 underline-offset-4 hover:text-white"
          >
            Retry
          </button>
        </div>
      )}
    </div>
  )
}
