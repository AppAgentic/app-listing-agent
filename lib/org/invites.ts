import { adminDb } from '../firebase/admin'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import type { OrgInvite } from '../firebase/firestore'
import { Role, canAssignRole } from './permissions'
import { getMember } from './members'
import { logAuditEvent, AuditAction } from './audit'
import crypto from 'crypto'
import { getDefaultPermissions } from './permissions'
import { getOrganizationTeamMemberLimit, hasAvailableTeamSeat } from './team-limits'
import { invalidateAccountContextCache } from './context'

export interface CreateInviteParams {
  orgId: string
  email: string
  role: Role
  invitedBy: string
  invitedByName: string
}

export interface InviteWithId extends OrgInvite {
  id: string
  token: string
}

const INVITE_EXPIRY_DAYS = 7

/**
 * Generate a secure invite token
 */
function generateInviteToken(): string {
  return crypto.randomBytes(32).toString('base64url')
}

/**
 * Create an invite for a user to join an organization
 */
export async function createInvite(params: CreateInviteParams): Promise<InviteWithId> {
  const { orgId, email, role, invitedBy, invitedByName } = params

  // Get inviter's role to verify permissions
  const inviter = await getMember(orgId, invitedBy)
  if (!inviter) {
    throw new Error('Inviter is not a member of the organization')
  }

  if (!canAssignRole(inviter.role, role)) {
    throw new Error(`Cannot invite with role: ${role}`)
  }

  const normalizedEmail = email.trim().toLowerCase()
  const token = generateInviteToken()
  const expiresAt = Timestamp.fromDate(
    new Date(Date.now() + INVITE_EXPIRY_DAYS * 24 * 60 * 60 * 1000)
  )

  const inviteData = {
    email,
    role: role as 'admin' | 'member' | 'viewer',
    invitedBy,
    invitedByName,
    expiresAt,
    status: 'pending'
  } as unknown as OrgInvite

  // Store invite with token as document ID
  const orgRef = adminDb.collection('organizations').doc(orgId)
  const docRef = orgRef.collection('invites').doc(token)

  await adminDb.runTransaction(async transaction => {
    const [orgDoc, membersSnapshot, pendingInvitesSnapshot] = await Promise.all([
      transaction.get(orgRef),
      transaction.get(orgRef.collection('members')),
      transaction.get(orgRef.collection('invites').where('status', '==', 'pending')),
    ])
    if (!orgDoc.exists) throw new Error('Organization not found')

    const now = new Date()
    const activePendingInvites = pendingInvitesSnapshot.docs.filter(doc => {
      const invite = doc.data()
      const sameEmail = String(invite.email || '').trim().toLowerCase() === normalizedEmail
      const active = invite.expiresAt?.toDate?.() > now
      return active && !sameEmail
    })
    const memberLimit = getOrganizationTeamMemberLimit(orgDoc.data() as any)
    if (!hasAvailableTeamSeat(membersSnapshot.size + activePendingInvites.length, memberLimit)) {
      throw new Error(`Team member limit reached (${memberLimit})`)
    }

    for (const existing of pendingInvitesSnapshot.docs) {
      if (String(existing.data().email || '').trim().toLowerCase() === normalizedEmail) {
        transaction.update(existing.ref, { status: 'revoked' })
      }
    }
    transaction.set(docRef, inviteData)
    // Force concurrent invite/accept/member transactions for this organization
    // to conflict and retry against the latest seat count.
    transaction.update(orgRef, {
      teamSeatVersion: FieldValue.increment(1),
      updatedAt: Timestamp.now(),
    })
  })

  // Log audit event
  await logAuditEvent({
    orgId,
    action: AuditAction.MEMBER_INVITED,
    userId: invitedBy,
    resourceType: 'member',
    resourceId: token,
    metadata: { email, role }
  })

  return {
    id: token,
    token,
    ...inviteData
  }
}

/**
 * Get an invite by token
 */
export async function getInvite(orgId: string, token: string): Promise<InviteWithId | null> {
  const doc = await adminDb
    .collection('organizations')
    .doc(orgId)
    .collection('invites')
    .doc(token)
    .get()

  if (!doc.exists) {
    return null
  }

  return {
    id: doc.id,
    token: doc.id,
    ...doc.data() as OrgInvite
  }
}

/**
 * Find invite by token across all organizations
 */
export async function findInviteByToken(token: string): Promise<{
  orgId: string
  invite: InviteWithId
} | null> {
  // Search all orgs for this token
  const orgsSnapshot = await adminDb.collection('organizations').get()

  for (const orgDoc of orgsSnapshot.docs) {
    const invite = await getInvite(orgDoc.id, token)
    if (invite) {
      return { orgId: orgDoc.id, invite }
    }
  }

  return null
}

/**
 * Accept an invite and add user to organization
 */
export async function acceptInvite(
  orgId: string,
  token: string,
  userId: string,
  displayName: string
): Promise<void> {
  const orgRef = adminDb.collection('organizations').doc(orgId)
  const inviteRef = orgRef.collection('invites').doc(token)
  const memberRef = orgRef.collection('members').doc(userId)
  const userRef = adminDb.collection('users').doc(userId)
  let acceptedInvite: InviteWithId | null = null

  await adminDb.runTransaction(async transaction => {
    const [orgDoc, inviteDoc, existingMember, membersSnapshot] = await Promise.all([
      transaction.get(orgRef),
      transaction.get(inviteRef),
      transaction.get(memberRef),
      transaction.get(orgRef.collection('members')),
    ])

    if (!orgDoc.exists) throw new Error('Organization not found')
    if (!inviteDoc.exists) throw new Error('Invite not found')

    const invite = { id: inviteDoc.id, token: inviteDoc.id, ...inviteDoc.data() } as InviteWithId
    if (invite.status !== 'pending') throw new Error(`Invite is ${invite.status}`)
    if (invite.expiresAt.toDate() < new Date()) throw new Error('Invite has expired')
    if (existingMember.exists) throw new Error('User is already a member of this organization')

    const memberLimit = getOrganizationTeamMemberLimit(orgDoc.data() as any)
    if (!hasAvailableTeamSeat(membersSnapshot.size, memberLimit)) {
      throw new Error(`Team member limit reached (${memberLimit})`)
    }

    transaction.set(memberRef, {
      role: invite.role,
      email: invite.email,
      displayName,
      invitedBy: invite.invitedBy,
      joinedAt: Timestamp.now(),
      permissions: getDefaultPermissions(invite.role),
    })
    transaction.update(inviteRef, { status: 'accepted' })
    transaction.update(userRef, { organizationId: orgId, updatedAt: Timestamp.now() })
    transaction.update(orgRef, {
      teamSeatVersion: FieldValue.increment(1),
      updatedAt: Timestamp.now(),
    })
    acceptedInvite = invite
  })

  invalidateAccountContextCache(userId)
  await logAuditEvent({
    orgId,
    action: AuditAction.MEMBER_ADDED,
    userId: acceptedInvite!.invitedBy,
    resourceType: 'member',
    resourceId: userId,
    metadata: { email: acceptedInvite!.email, role: acceptedInvite!.role },
  })
}

/**
 * Revoke an invite
 */
export async function revokeInvite(
  orgId: string,
  token: string,
  revokedBy: string
): Promise<void> {
  const invite = await getInvite(orgId, token)

  if (!invite) {
    throw new Error('Invite not found')
  }

  if (invite.status !== 'pending') {
    throw new Error(`Cannot revoke invite that is ${invite.status}`)
  }

  // Get revoker's role
  const revoker = await getMember(orgId, revokedBy)
  if (!revoker) {
    throw new Error('Revoker is not a member of the organization')
  }

  // Only admins and owners can revoke invites
  if (revoker.role !== 'owner' && revoker.role !== 'admin') {
    throw new Error('Insufficient permissions to revoke invite')
  }

  await adminDb
    .collection('organizations')
    .doc(orgId)
    .collection('invites')
    .doc(token)
    .update({ status: 'revoked' })

  // Log audit event
  await logAuditEvent({
    orgId,
    action: AuditAction.INVITE_REVOKED,
    userId: revokedBy,
    resourceType: 'member',
    resourceId: token,
    metadata: { email: invite.email }
  })
}

/**
 * List pending invites for an organization
 */
export async function listPendingInvites(orgId: string): Promise<InviteWithId[]> {
  const snapshot = await adminDb
    .collection('organizations')
    .doc(orgId)
    .collection('invites')
    .where('status', '==', 'pending')
    .orderBy('expiresAt', 'asc')
    .get()

  return snapshot.docs.map(doc => ({
    id: doc.id,
    token: doc.id,
    ...doc.data() as OrgInvite
  }))
}

/**
 * Clean up expired invites
 */
export async function cleanupExpiredInvites(orgId: string): Promise<number> {
  const now = Timestamp.now()

  const expiredSnapshot = await adminDb
    .collection('organizations')
    .doc(orgId)
    .collection('invites')
    .where('status', '==', 'pending')
    .where('expiresAt', '<', now)
    .get()

  const batch = adminDb.batch()
  let count = 0

  for (const doc of expiredSnapshot.docs) {
    batch.update(doc.ref, { status: 'expired' })
    count++
  }

  if (count > 0) {
    await batch.commit()
  }

  return count
}

/**
 * Resend an invite (creates new invite with fresh expiry)
 */
export async function resendInvite(
  orgId: string,
  token: string,
  resentBy: string,
  resentByName: string
): Promise<InviteWithId> {
  const oldInvite = await getInvite(orgId, token)

  if (!oldInvite) {
    throw new Error('Invite not found')
  }

  if (oldInvite.status !== 'pending' && oldInvite.status !== 'expired') {
    throw new Error(`Cannot resend invite that is ${oldInvite.status}`)
  }

  // Create new invite with same details
  return createInvite({
    orgId,
    email: oldInvite.email,
    role: oldInvite.role,
    invitedBy: resentBy,
    invitedByName: resentByName
  })
}
