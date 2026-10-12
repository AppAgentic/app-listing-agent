'use client'

import Link from 'next/link'
import { TeamMembersList } from '@/components/dashboard/team-members'
import { InviteMemberForm } from '@/components/dashboard/invite-member'
import { Users, Crown, Building2, UserPlus, Lock } from 'lucide-react'
import type { Role } from '@/lib/org/permissions'

interface TeamMember {
  userId: string
  email: string
  displayName: string
  role: Role
  joinedAt: any
}

interface TeamData {
  organization: {
    id: string
    name: string
    plan: string
    memberLimit: number
  }
  members: TeamMember[]
  invites: any[]
}

interface TeamContentProps {
  type: 'upgrade' | 'create' | 'team'
  data?: TeamData
  currentUserId?: string
  canManage?: boolean
}

export function TeamContent({ type, data, currentUserId, canManage }: TeamContentProps) {
  if (type === 'upgrade') {
    return (
      <div className="text-center py-16 rounded-2xl bg-black/40 backdrop-blur-xl border border-white/[0.08]">
        <div className="w-16 h-16 mx-auto mb-6 rounded-2xl bg-white/[0.05] border border-white/[0.08] flex items-center justify-center">
          <Lock className="w-8 h-8 text-neutral-400" />
        </div>
        <h2 className="text-xl font-semibold text-white mb-2">Team Features</h2>
        <p className="text-neutral-400 mb-6 max-w-sm mx-auto">
          Team management is available on Studio and Enterprise plans.
        </p>
        <a
          href="/billing?plan=business&interval=monthly&reason=team"
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-white text-black rounded-xl font-medium hover:bg-neutral-200 transition-colors"
        >
          <Crown className="w-4 h-4" />
          Upgrade Plan
        </a>
      </div>
    )
  }

  if (type === 'create') {
    return (
      <div className="text-center py-16 rounded-2xl bg-black/40 backdrop-blur-xl border border-white/[0.08]">
        <div className="w-16 h-16 mx-auto mb-6 rounded-2xl bg-white/[0.05] border border-white/[0.08] flex items-center justify-center">
          <Building2 className="w-8 h-8 text-neutral-400" />
        </div>
        <h2 className="text-xl font-semibold text-white mb-2">Create Your Organization</h2>
        <p className="text-neutral-400 mb-6 max-w-sm mx-auto">
          Create an organization to start inviting team members and collaborating.
        </p>
        <Link
          href="/team/create"
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-white text-black rounded-xl font-medium hover:bg-neutral-200 transition-colors"
        >
          <Building2 className="w-4 h-4" />
          Create Organization
        </Link>
      </div>
    )
  }

  // Team view
  if (!data) return null

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white">{data.organization.name}</h1>
          <div className="flex items-center gap-3 mt-1">
            <span className="text-neutral-400">
              {data.members.length} member{data.members.length !== 1 ? 's' : ''}
            </span>
            <div className="w-1 h-1 rounded-full bg-neutral-600" />
            <span className="px-2 py-0.5 rounded-md bg-white/[0.05] text-white text-xs font-medium border border-white/[0.1] capitalize">
              {data.organization.plan}
            </span>
          </div>
        </div>
      </div>

      {/* Invite Form */}
      {canManage && (
        <div className="rounded-2xl bg-white/[0.02] border border-white/[0.08] p-6 mb-6">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-xl bg-white/[0.05] border border-white/[0.08] flex items-center justify-center">
              <UserPlus className="w-5 h-5 text-neutral-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-white">Invite Team Member</h2>
              <p className="text-sm text-neutral-500">Create a secure invite link to share with your teammate</p>
            </div>
          </div>
          <InviteMemberForm
            memberLimit={data.organization.memberLimit}
            currentCount={data.members.length + data.invites.length}
          />
        </div>
      )}

      {/* Members List */}
      <div className="rounded-2xl bg-white/[0.02] border border-white/[0.08] p-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-white/[0.05] border border-white/[0.08] flex items-center justify-center">
            <Users className="w-5 h-5 text-neutral-400" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-white">Team Members</h2>
            <p className="text-sm text-neutral-500">Manage your team and their permissions</p>
          </div>
        </div>
        <TeamMembersList
          members={data.members as any}
          invites={data.invites as any}
          currentUserId={currentUserId || ''}
          canManage={canManage || false}
        />
      </div>
    </div>
  )
}
