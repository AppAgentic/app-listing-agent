import { adminDb } from '../firebase/admin'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { OrgMember } from '../firebase/firestore'
import { Role, getDefaultPermissions, canManageRole, canAssignRole, RolePermissions } from './permissions'
import { logAuditEvent, AuditAction } from './audit'
import { getOrganizationTeamMemberLimit, hasAvailableTeamSeat } from './team-limits'

export interface AddMemberParams {
  orgId: string
  userId: string
  email: string
  displayName: string
  role: Role
  invitedBy: string
  customPermissions?: Partial<RolePermissions>
}

export interface UpdateMemberParams {
  orgId: string
  userId: string
  updates: {
    role?: Role
    permissions?: Partial<RolePermissions>
    displayName?: string
  }
  updatedBy: string
}

export interface MemberWithId extends OrgMember {
  id: string
}

/**
 * Add a member to an organization
 */
export async function addMember(params: AddMemberParams): Promise<void> {
  const { orgId, userId, email, displayName, role, invitedBy, customPermissions } = params

  const permissions = {
    ...getDefaultPermissions(role),
    ...customPermissions
  }

  const memberData = {
    role,
    email,
    displayName,
    invitedBy,
    joinedAt: Timestamp.now(),
    permissions
  } as unknown as OrgMember

  const orgRef = adminDb.collection('organizations').doc(orgId)
  const memberRef = orgRef.collection('members').doc(userId)
  const userRef = adminDb.collection('users').doc(userId)
  await adminDb.runTransaction(async transaction => {
    const [orgDoc, existingMember, membersSnapshot] = await Promise.all([
      transaction.get(orgRef),
      transaction.get(memberRef),
      transaction.get(orgRef.collection('members')),
    ])
    if (!orgDoc.exists) throw new Error('Organization not found')
    if (!existingMember.exists) {
      const memberLimit = getOrganizationTeamMemberLimit(orgDoc.data() as any)
      if (!hasAvailableTeamSeat(membersSnapshot.size, memberLimit)) {
        throw new Error(`Team member limit reached (${memberLimit})`)
      }
    }
    transaction.set(memberRef, memberData)
    transaction.update(userRef, { organizationId: orgId, updatedAt: Timestamp.now() })
    transaction.update(orgRef, {
      teamSeatVersion: FieldValue.increment(1),
      updatedAt: Timestamp.now(),
    })
  })
  const { invalidateAccountContextCache } = await import('./context')
  invalidateAccountContextCache(userId)

  // Log audit event
  await logAuditEvent({
    orgId,
    action: AuditAction.MEMBER_ADDED,
    userId: invitedBy,
    resourceType: 'member',
    resourceId: userId,
    metadata: { email, role }
  })
}

/**
 * Get a member by ID
 */
export async function getMember(orgId: string, userId: string): Promise<MemberWithId | null> {
  const doc = await adminDb
    .collection('organizations')
    .doc(orgId)
    .collection('members')
    .doc(userId)
    .get()

  if (!doc.exists) {
    return null
  }

  return {
    id: doc.id,
    ...doc.data() as OrgMember
  }
}

/**
 * List all members of an organization
 */
export async function listMembers(orgId: string): Promise<MemberWithId[]> {
  const snapshot = await adminDb
    .collection('organizations')
    .doc(orgId)
    .collection('members')
    .orderBy('joinedAt', 'desc')
    .get()

  return snapshot.docs.map(doc => ({
    id: doc.id,
    ...doc.data() as OrgMember
  }))
}

/**
 * Update a member's role or permissions
 */
export async function updateMember(params: UpdateMemberParams): Promise<void> {
  const { orgId, userId, updates, updatedBy } = params

  // Get the updater's role to verify permissions
  const updater = await getMember(orgId, updatedBy)
  if (!updater) {
    throw new Error('Updater is not a member of the organization')
  }

  // Get the target member
  const target = await getMember(orgId, userId)
  if (!target) {
    throw new Error('Target member not found')
  }

  // Verify permission to manage this member
  if (!canManageRole(updater.role, target.role)) {
    throw new Error('Insufficient permissions to manage this member')
  }

  // If changing role, verify permission to assign new role
  if (updates.role && !canAssignRole(updater.role, updates.role)) {
    throw new Error(`Cannot assign role: ${updates.role}`)
  }

  const updateData: Partial<OrgMember> = {}

  if (updates.role) {
    updateData.role = updates.role
    // Reset permissions to new role defaults
    updateData.permissions = getDefaultPermissions(updates.role)
  }

  if (updates.permissions) {
    const basePermissions = updates.role
      ? getDefaultPermissions(updates.role)
      : target.permissions

    updateData.permissions = {
      ...basePermissions,
      ...updates.permissions
    }
  }

  if (updates.displayName) {
    updateData.displayName = updates.displayName
  }

  await adminDb
    .collection('organizations')
    .doc(orgId)
    .collection('members')
    .doc(userId)
    .update(updateData)
  const { invalidateAccountContextCache } = await import('./context')
  invalidateAccountContextCache(userId)

  // Log audit event
  await logAuditEvent({
    orgId,
    action: AuditAction.MEMBER_UPDATED,
    userId: updatedBy,
    resourceType: 'member',
    resourceId: userId,
    metadata: { updates }
  })
}

/**
 * Remove a member from an organization
 */
export async function removeMember(
  orgId: string,
  userId: string,
  removedBy: string
): Promise<void> {
  // Get the remover's role
  const remover = await getMember(orgId, removedBy)
  if (!remover) {
    throw new Error('Remover is not a member of the organization')
  }

  // Get the target member
  const target = await getMember(orgId, userId)
  if (!target) {
    throw new Error('Target member not found')
  }

  // Cannot remove owner
  if (target.role === 'owner') {
    throw new Error('Cannot remove organization owner')
  }

  // Verify permission to manage this member
  if (!canManageRole(remover.role, target.role)) {
    throw new Error('Insufficient permissions to remove this member')
  }

  // Remove from organization
  await adminDb
    .collection('organizations')
    .doc(orgId)
    .collection('members')
    .doc(userId)
    .delete()

  // Clear user's organizationId
  await adminDb.collection('users').doc(userId).update({
    organizationId: null,
    updatedAt: Timestamp.now()
  })
  const { invalidateAccountContextCache } = await import('./context')
  invalidateAccountContextCache(userId)

  // Log audit event
  await logAuditEvent({
    orgId,
    action: AuditAction.MEMBER_REMOVED,
    userId: removedBy,
    resourceType: 'member',
    resourceId: userId,
    metadata: { email: target.email, role: target.role }
  })
}

/**
 * Transfer organization ownership
 */
export async function transferOwnership(
  orgId: string,
  newOwnerId: string,
  currentOwnerId: string
): Promise<void> {
  // Verify current owner
  const currentOwner = await getMember(orgId, currentOwnerId)
  if (!currentOwner || currentOwner.role !== 'owner') {
    throw new Error('Only the owner can transfer ownership')
  }

  // Verify new owner is a member
  const newOwner = await getMember(orgId, newOwnerId)
  if (!newOwner) {
    throw new Error('New owner must be a member of the organization')
  }

  // Update roles in a batch
  const batch = adminDb.batch()

  // Set new owner
  const newOwnerRef = adminDb
    .collection('organizations')
    .doc(orgId)
    .collection('members')
    .doc(newOwnerId)

  batch.update(newOwnerRef, {
    role: 'owner',
    permissions: getDefaultPermissions('owner')
  })

  // Demote current owner to admin
  const currentOwnerRef = adminDb
    .collection('organizations')
    .doc(orgId)
    .collection('members')
    .doc(currentOwnerId)

  batch.update(currentOwnerRef, {
    role: 'admin',
    permissions: getDefaultPermissions('admin')
  })

  // Update organization owner
  const orgRef = adminDb.collection('organizations').doc(orgId)
  batch.update(orgRef, {
    ownerId: newOwnerId,
    updatedAt: Timestamp.now()
  })

  await batch.commit()
  const { invalidateAccountContextCache } = await import('./context')
  invalidateAccountContextCache(newOwnerId)
  invalidateAccountContextCache(currentOwnerId)

  // Log audit event
  await logAuditEvent({
    orgId,
    action: AuditAction.SETTINGS_CHANGED,
    userId: currentOwnerId,
    resourceType: 'settings',
    resourceId: orgId,
    metadata: {
      change: 'ownership_transferred',
      newOwnerId,
      newOwnerEmail: newOwner.email
    }
  })
}

/**
 * Get member count for an organization
 */
export async function getMemberCount(orgId: string): Promise<number> {
  const snapshot = await adminDb
    .collection('organizations')
    .doc(orgId)
    .collection('members')
    .count()
    .get()

  return snapshot.data().count
}

/**
 * Check if a user is a member of an organization
 */
export async function isMember(orgId: string, userId: string): Promise<boolean> {
  const member = await getMember(orgId, userId)
  return member !== null
}
