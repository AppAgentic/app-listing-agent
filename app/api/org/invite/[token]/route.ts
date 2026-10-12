import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { findInviteByToken, acceptInvite, revokeInvite } from '@/lib/org/invites'
import { adminDb } from '@/lib/firebase/admin'

// GET - Get invite info
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params

  // Find invite by token
  const result = await findInviteByToken(token)
  if (!result) {
    return NextResponse.json(
      { error: 'Invalid or expired invite' },
      { status: 404 }
    )
  }

  const { orgId, invite } = result

  if (invite.status !== 'pending' || invite.expiresAt.toDate() < new Date()) {
    return NextResponse.json(
      { error: 'Invalid or expired invite' },
      { status: 404 }
    )
  }

  // Get organization name
  const orgDoc = await adminDb.collection('organizations').doc(orgId).get()
  if (!orgDoc.exists) {
    return NextResponse.json(
      { error: 'Organization not found' },
      { status: 404 }
    )
  }

  const org = orgDoc.data()!

  return NextResponse.json({
    orgName: org.name,
    invitedBy: invite.invitedByName,
    role: invite.role,
    email: invite.email
  })
}

// POST - Accept invite
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params

  // Require authentication
  const session = await getSession()
  if (!session) {
    return NextResponse.json(
      { error: 'Authentication required' },
      { status: 401 }
    )
  }

  // Find invite by token
  const result = await findInviteByToken(token)
  if (!result) {
    return NextResponse.json(
      { error: 'Invalid or expired invite' },
      { status: 404 }
    )
  }

  const { orgId, invite } = result

  // Verify email matches (optional - can be removed if allowing any user to accept)
  // This adds security by ensuring only the invited email can accept
  if (invite.email.toLowerCase() !== session.email.toLowerCase()) {
    return NextResponse.json(
      { error: 'This invite was sent to a different email address' },
      { status: 403 }
    )
  }

  try {
    // Get user's display name
    const userDoc = await adminDb.collection('users').doc(session.userId).get()
    const displayName = userDoc.exists ? userDoc.data()!.displayName : session.email

    // Accept the invite
    await acceptInvite(orgId, token, session.userId, displayName)

    return NextResponse.json({ success: true, orgId })
  } catch (error) {
    console.error('Accept invite error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to accept invite' },
      { status: 500 }
    )
  }
}

// DELETE - Revoke a pending invite
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const session = await getSession()
  if (!session?.organizationId) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }

  const { token } = await params
  const result = await findInviteByToken(token)
  if (!result || result.orgId !== session.organizationId) {
    return NextResponse.json({ error: 'Invite not found' }, { status: 404 })
  }

  try {
    await revokeInvite(session.organizationId, token, session.userId)
    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to revoke invite' },
      { status: 400 }
    )
  }
}
