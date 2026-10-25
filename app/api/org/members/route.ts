import { readBoundedJson } from '@/lib/api/bounded-body'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth/session'
import { adminDb } from '@/lib/firebase/admin'
import { hasPermission, canManageRole, getPermissionsForRole } from '@/lib/org/permissions'
import { createInvite } from '@/lib/org/invites'
import { updateMember, removeMember } from '@/lib/org/members'
import type { Role } from '@/lib/org/permissions'
import { appUrl } from '@/lib/routing/app-url'

// GET - List organization members
export async function GET(request: NextRequest) {
  // Require authentication
  const session = await getSession()
  if (!session) {
    return NextResponse.json(
      { error: 'Authentication required' },
      { status: 401 }
    )
  }

  if (!session.organizationId) {
    return NextResponse.json(
      { error: 'Not a member of any organization' },
      { status: 400 }
    )
  }

  try {
    // Get members
    const membersSnapshot = await adminDb
      .collection('organizations')
      .doc(session.organizationId)
      .collection('members')
      .get()

    const members = membersSnapshot.docs.map(doc => ({
      userId: doc.id,
      ...doc.data()
    }))

    // Get pending invites
    const invitesSnapshot = await adminDb
      .collection('organizations')
      .doc(session.organizationId)
      .collection('invites')
      .where('status', '==', 'pending')
      .get()

    const invites = invitesSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }))

    return NextResponse.json({
      members,
      pendingInvites: invites
    })
  } catch (error) {
    console.error('List members error:', error)
    return NextResponse.json(
      { error: 'Failed to list members' },
      { status: 500 }
    )
  }
}

// POST - Invite new member
const inviteSchema = z.object({
  email: z.string().trim().email().transform(email => email.toLowerCase()),
  role: z.enum(['admin', 'member', 'viewer'])
})

export async function POST(request: NextRequest) {
  // Require authentication
  const session = await getSession()
  if (!session) {
    return NextResponse.json(
      { error: 'Authentication required' },
      { status: 401 }
    )
  }

  if (!session.organizationId) {
    return NextResponse.json(
      { error: 'Not a member of any organization' },
      { status: 400 }
    )
  }

  // Check permissions
  const memberDoc = await adminDb
    .collection('organizations')
    .doc(session.organizationId)
    .collection('members')
    .doc(session.userId)
    .get()

  if (!memberDoc.exists) {
    return NextResponse.json(
      { error: 'Member not found' },
      { status: 404 }
    )
  }

  const member = memberDoc.data()!
  if (!hasPermission(member.role as Role, 'canInviteMembers')) {
    return NextResponse.json(
      { error: 'Permission denied' },
      { status: 403 }
    )
  }

  // Parse request body
  let body
  try {
    body = inviteSchema.parse(await readBoundedJson(request))
  } catch {
    return NextResponse.json(
      { error: 'Invalid request body' },
      { status: 400 }
    )
  }

  const { email, role } = body

  // Check if can assign this role
  if (!canManageRole(member.role as Role, role as Role)) {
    return NextResponse.json(
      { error: `Cannot invite users with ${role} role` },
      { status: 403 }
    )
  }

  // Check if user is already a member
  const existingMember = await adminDb
    .collection('organizations')
    .doc(session.organizationId)
    .collection('members')
    .where('email', '==', email)
    .limit(1)
    .get()

  if (!existingMember.empty) {
    return NextResponse.json(
      { error: 'User is already a member' },
      { status: 400 }
    )
  }

  // Check for existing pending invite
  const existingInvite = await adminDb
    .collection('organizations')
    .doc(session.organizationId)
    .collection('invites')
    .where('email', '==', email)
    .where('status', '==', 'pending')
    .limit(1)
    .get()

  if (!existingInvite.empty) {
    return NextResponse.json(
      { error: 'Pending invite already exists for this email' },
      { status: 400 }
    )
  }

  try {
    // Get user display name
    const userDoc = await adminDb.collection('users').doc(session.userId).get()
    const invitedByName = userDoc.exists ? userDoc.data()!.displayName : session.email

    // Create invite
    const invite = await createInvite({
      orgId: session.organizationId,
      email,
      role: role as Role,
      invitedBy: session.userId,
      invitedByName
    })

    return NextResponse.json({
      success: true,
      delivery: 'share_link',
      inviteUrl: appUrl(`/invite/${invite.token}`),
      invite: {
        id: invite.id,
        email: invite.email,
        role: invite.role,
        token: invite.token
      }
    })
  } catch (error) {
    console.error('Create invite error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create invite' },
      { status: 500 }
    )
  }
}

// PATCH - Update member role
const updateSchema = z.object({
  userId: z.string(),
  role: z.enum(['admin', 'member', 'viewer'])
})

export async function PATCH(request: NextRequest) {
  // Require authentication
  const session = await getSession()
  if (!session) {
    return NextResponse.json(
      { error: 'Authentication required' },
      { status: 401 }
    )
  }

  if (!session.organizationId) {
    return NextResponse.json(
      { error: 'Not a member of any organization' },
      { status: 400 }
    )
  }

  // Check permissions
  const memberDoc = await adminDb
    .collection('organizations')
    .doc(session.organizationId)
    .collection('members')
    .doc(session.userId)
    .get()

  if (!memberDoc.exists) {
    return NextResponse.json(
      { error: 'Member not found' },
      { status: 404 }
    )
  }

  const member = memberDoc.data()!
  if (!hasPermission(member.role as Role, 'canInviteMembers')) {
    return NextResponse.json(
      { error: 'Permission denied' },
      { status: 403 }
    )
  }

  // Parse request body
  let body
  try {
    body = updateSchema.parse(await readBoundedJson(request))
  } catch {
    return NextResponse.json(
      { error: 'Invalid request body' },
      { status: 400 }
    )
  }

  const { userId, role } = body

  // Cannot update self
  if (userId === session.userId) {
    return NextResponse.json(
      { error: 'Cannot update your own role' },
      { status: 400 }
    )
  }

  try {
    await updateMember({
      orgId: session.organizationId,
      userId,
      updates: {
        role: role as Role,
        permissions: getPermissionsForRole(role as Role),
      },
      updatedBy: session.userId
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Update member error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update member' },
      { status: 500 }
    )
  }
}

// DELETE - Remove member
export async function DELETE(request: NextRequest) {
  // Require authentication
  const session = await getSession()
  if (!session) {
    return NextResponse.json(
      { error: 'Authentication required' },
      { status: 401 }
    )
  }

  if (!session.organizationId) {
    return NextResponse.json(
      { error: 'Not a member of any organization' },
      { status: 400 }
    )
  }

  const searchParams = request.nextUrl.searchParams
  const userId = searchParams.get('userId')

  if (!userId) {
    return NextResponse.json(
      { error: 'userId is required' },
      { status: 400 }
    )
  }

  // Cannot remove self
  if (userId === session.userId) {
    return NextResponse.json(
      { error: 'Cannot remove yourself. Use leave organization instead.' },
      { status: 400 }
    )
  }

  // Check permissions
  const memberDoc = await adminDb
    .collection('organizations')
    .doc(session.organizationId)
    .collection('members')
    .doc(session.userId)
    .get()

  if (!memberDoc.exists) {
    return NextResponse.json(
      { error: 'Member not found' },
      { status: 404 }
    )
  }

  const member = memberDoc.data()!
  if (!hasPermission(member.role as Role, 'canInviteMembers')) {
    return NextResponse.json(
      { error: 'Permission denied' },
      { status: 403 }
    )
  }

  try {
    await removeMember(session.organizationId, userId, session.userId)
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Remove member error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to remove member' },
      { status: 500 }
    )
  }
}
