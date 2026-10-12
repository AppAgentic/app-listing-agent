'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Link2, Copy, AlertCircle, CheckCircle, Crown, Loader2, Users } from 'lucide-react'

interface InviteMemberFormProps {
  memberLimit: number
  currentCount: number
}

export function InviteMemberForm({ memberLimit, currentCount }: InviteMemberFormProps) {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<'admin' | 'member' | 'viewer'>('member')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [inviteUrl, setInviteUrl] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const atLimit = memberLimit > 0 && currentCount >= memberLimit

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (atLimit) return

    setLoading(true)
    setError(null)
    setInviteUrl(null)
    setCopied(false)

    try {
      const response = await fetch('/api/org/members', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, role })
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to create invite link')
      }

      setInviteUrl(data.inviteUrl)
      setEmail('')
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create invite link')
    } finally {
      setLoading(false)
    }
  }

  if (atLimit) {
    return (
      <div className="text-center py-6 px-4 rounded-xl bg-yellow-500/5 border border-yellow-500/20">
        <AlertCircle className="w-8 h-8 mx-auto mb-3 text-yellow-400" />
        <p className="text-yellow-400 font-medium mb-1">Team limit reached</p>
        <p className="text-neutral-400 text-sm mb-4">
          You&apos;ve reached your team member limit ({memberLimit}).
        </p>
        <a
          href={`/billing?plan=${memberLimit >= 5 ? 'enterprise' : 'business'}&interval=monthly&reason=team_limit`}
          className="inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-purple-500 to-blue-500 text-white rounded-xl font-medium text-sm hover:opacity-90 transition-opacity"
        >
          <Crown className="w-4 h-4" />
          Upgrade Plan
        </a>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="flex gap-4">
        <div className="flex-1">
          <label htmlFor="email" className="block text-sm font-medium text-neutral-400 mb-2">
            Email Address
          </label>
          <input
            type="email"
            id="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="colleague@company.com"
            required
            className="w-full px-4 py-2.5 bg-black/40 border border-white/[0.08] rounded-xl text-white placeholder-neutral-500 focus:outline-none focus:ring-2 focus:ring-purple-500/50 focus:border-purple-500/50 transition-all"
          />
        </div>

        <div className="w-40">
          <label htmlFor="role" className="block text-sm font-medium text-neutral-400 mb-2">
            Role
          </label>
          <select
            id="role"
            value={role}
            onChange={(e) => setRole(e.target.value as typeof role)}
            className="w-full px-4 py-2.5 bg-black/40 border border-white/[0.08] rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-purple-500/50 focus:border-purple-500/50 transition-all"
          >
            <option value="admin">Admin</option>
            <option value="member">Member</option>
            <option value="viewer">Viewer</option>
          </select>
        </div>

        <div className="flex items-end">
          <button
            type="submit"
            disabled={loading || !email}
            className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-purple-500 to-blue-500 text-white rounded-xl font-medium hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Link2 className="w-4 h-4" />
            )}
            {loading ? 'Creating...' : 'Create Invite Link'}
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {error}
        </div>
      )}

      {inviteUrl && (
        <div className="space-y-3 rounded-lg border border-green-500/20 bg-green-500/10 p-3 text-sm text-green-300">
          <div className="flex items-center gap-2">
            <CheckCircle className="w-4 h-4 flex-shrink-0" />
            Invite link created. Copy and share it with the invited teammate; no email was sent.
          </div>
          <div className="flex gap-2">
            <input
              readOnly
              value={inviteUrl}
              aria-label="Invite URL"
              className="min-w-0 flex-1 rounded-lg border border-white/[0.08] bg-black/30 px-3 py-2 text-neutral-300"
              onFocus={(event) => event.currentTarget.select()}
            />
            <button
              type="button"
              onClick={async () => {
                await navigator.clipboard.writeText(inviteUrl)
                setCopied(true)
              }}
              className="inline-flex items-center gap-2 rounded-lg border border-white/[0.1] bg-white/[0.05] px-3 py-2 font-medium text-white hover:bg-white/[0.1]"
            >
              <Copy className="h-4 w-4" />
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 text-sm text-neutral-500">
        <Users className="w-4 h-4" />
        {currentCount} / {memberLimit > 0 ? memberLimit : '∞'} members
      </div>
    </form>
  )
}
