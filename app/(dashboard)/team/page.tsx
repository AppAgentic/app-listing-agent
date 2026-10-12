import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth/session'
import { adminDb } from '@/lib/firebase/admin'
import { TeamContent } from './team-content'
import type { Role } from '@/lib/org/permissions'

interface TeamMember {
  userId: string
  email: string
  displayName: string
  role: Role
  joinedAt: any
}

async function getTeamData(organizationId: string) {
  const orgDoc = await adminDb.collection('organizations').doc(organizationId).get()
  if (!orgDoc.exists) return null

  const org = orgDoc.data()!

  const membersSnapshot = await adminDb
    .collection('organizations')
    .doc(organizationId)
    .collection('members')
    .get()

  const members = membersSnapshot.docs.map(doc => ({
    userId: doc.id,
    ...doc.data()
  })) as TeamMember[]

  const invitesSnapshot = await adminDb
    .collection('organizations')
    .doc(organizationId)
    .collection('invites')
    .where('status', '==', 'pending')
    .get()

  const invites = invitesSnapshot.docs.map(doc => ({
    id: doc.id,
    ...doc.data()
  }))

  return {
    organization: {
      id: organizationId,
      name: org.name,
      plan: org.plan,
      memberLimit: org.planLimits?.teamMembers || 5
    },
    members,
    invites
  }
}

export default async function TeamPage() {
  const session = await getSession()
  if (!session) return null

  // Check if user has team features
  if (session.plan !== 'business' && session.plan !== 'enterprise') {
    return <TeamContent type="upgrade" />
  }

  // If no organization, show create org prompt
  if (!session.organizationId) {
    return <TeamContent type="create" />
  }

  const data = await getTeamData(session.organizationId)
  if (!data) {
    redirect('/dashboard')
  }

  const currentMember = data.members.find(m => m.userId === session.userId)
  const canManage = currentMember?.role === 'owner' || currentMember?.role === 'admin'

  return (
    <TeamContent
      type="team"
      data={data}
      currentUserId={session.userId}
      canManage={canManage}
    />
  )
}
