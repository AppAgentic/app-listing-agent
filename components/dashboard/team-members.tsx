'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Crown, Shield, User, Eye, Mail, X, Loader2, Copy } from 'lucide-react'

interface Member {
  userId: string
  email: string
  displayName: string
  role: 'owner' | 'admin' | 'member' | 'viewer'
  joinedAt: { toDate(): Date }
}

interface Invite {
  id: string
  email: string
  role: string
  status: string
  expiresAt: { toDate(): Date }
}

interface TeamMembersListProps {
  members: Member[]
  invites: Invite[]
  currentUserId: string
  canManage: boolean
}

const roleConfig = {
  owner: {
    color: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
    icon: Crown
  },
  admin: {
    color: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
    icon: Shield
  },
  member: {
    color: 'bg-green-500/10 text-green-400 border-green-500/20',
    icon: User
  },
  viewer: {
    color: 'bg-neutral-500/10 text-neutral-400 border-neutral-500/20',
    icon: Eye
  }
}

export function TeamMembersList({
  members,
  invites,
  currentUserId,
  canManage
}: TeamMembersListProps) {
  const router = useRouter()
  const [loading, setLoading] = useState<string | null>(null)

  const handleRemove = async (userId: string) => {
    if (!confirm('Are you sure you want to remove this member?')) return

    setLoading(userId)
    try {
      const response = await fetch(`/api/org/members?userId=${userId}`, {
        method: 'DELETE'
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to remove member')
      }

      router.refresh()
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to remove member')
    } finally {
      setLoading(null)
    }
  }

  const handleRevokeInvite = async (inviteId: string) => {
    setLoading(inviteId)
    try {
      const response = await fetch(`/api/org/invite/${inviteId}`, {
        method: 'DELETE'
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to revoke invite')
      }

      router.refresh()
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to revoke invite')
    } finally {
      setLoading(null)
    }
  }

  return (
    <div className="space-y-2">
      {/* Active Members */}
      {members.map((member) => {
        const config = roleConfig[member.role]
        const Icon = config.icon
        return (
          <div
            key={member.userId}
            className="flex items-center justify-between p-4 rounded-xl bg-black/20 border border-white/[0.05] hover:border-white/[0.1] transition-colors"
          >
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center text-white text-sm font-bold">
                {member.displayName?.charAt(0).toUpperCase() || member.email.charAt(0).toUpperCase()}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-medium text-white">
                    {member.displayName || member.email}
                  </span>
                  {member.userId === currentUserId && (
                    <span className="px-2 py-0.5 rounded-md bg-white/[0.05] text-xs text-neutral-400">
                      you
                    </span>
                  )}
                </div>
                <div className="text-sm text-neutral-500">{member.email}</div>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <span className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-lg border capitalize ${config.color}`}>
                <Icon className="w-3 h-3" />
                {member.role}
              </span>
              {canManage && member.role !== 'owner' && member.userId !== currentUserId && (
                <button
                  onClick={() => handleRemove(member.userId)}
                  disabled={loading === member.userId}
                  className="flex items-center gap-1 px-3 py-1.5 text-sm text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-lg transition-colors disabled:opacity-50"
                >
                  {loading === member.userId ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <X className="w-3 h-3" />
                  )}
                  Remove
                </button>
              )}
            </div>
          </div>
        )
      })}

      {/* Pending Invites */}
      {invites.length > 0 && (
        <>
          <div className="pt-4 pb-2">
            <h3 className="text-sm font-medium text-neutral-500 flex items-center gap-2">
              <Mail className="w-4 h-4" />
              Pending Invites
            </h3>
          </div>
          {invites.map((invite) => {
            const config = roleConfig[invite.role as keyof typeof roleConfig] || roleConfig.member
            const Icon = config.icon
            return (
              <div
                key={invite.id}
                className="flex items-center justify-between p-4 rounded-xl bg-black/10 border border-white/[0.03] opacity-75"
              >
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-xl bg-white/[0.03] border border-white/[0.08] flex items-center justify-center">
                    <Mail className="w-5 h-5 text-neutral-500" />
                  </div>
                  <div>
                    <div className="font-medium text-neutral-300">{invite.email}</div>
                    <div className="text-sm text-neutral-500">
                      Expires {new Date(invite.expiresAt.toDate()).toLocaleDateString()}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <span className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-lg border capitalize ${config.color}`}>
                    <Icon className="w-3 h-3" />
                    {invite.role}
                  </span>
                  <span className="px-2.5 py-1 text-xs font-medium rounded-lg bg-yellow-500/10 text-yellow-400 border border-yellow-500/20">
                    Pending
                  </span>
                  {canManage && (
                    <>
                      <button
                        onClick={() => navigator.clipboard.writeText(`${window.location.origin}/invite/${invite.id}`)}
                        className="flex items-center gap-1 px-3 py-1.5 text-sm text-neutral-300 hover:text-white hover:bg-white/[0.05] rounded-lg transition-colors"
                      >
                        <Copy className="w-3 h-3" />
                        Copy link
                      </button>
                      <button
                        onClick={() => handleRevokeInvite(invite.id)}
                        disabled={loading === invite.id}
                        className="flex items-center gap-1 px-3 py-1.5 text-sm text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-lg transition-colors disabled:opacity-50"
                      >
                        {loading === invite.id ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <X className="w-3 h-3" />
                        )}
                        Revoke
                      </button>
                    </>
                  )}
                </div>
              </div>
            )
          })}
        </>
      )}
    </div>
  )
}
