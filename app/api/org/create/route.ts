import { readBoundedJson } from '@/lib/api/bounded-body'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession, generateApiKey } from '@/lib/auth/session'
import { adminDb } from '@/lib/firebase/admin'
import { PLAN_LIMITS } from '@/lib/constants'
import { Timestamp } from 'firebase-admin/firestore'
import { isVerifiedPaidEntitlement } from '@/lib/billing/entitlements'
import { isSelfHosted } from '@/lib/selfhost/config'

const createOrgSchema = z.object({
  name: z.string().min(2).max(100)
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

  // Check if user has Business or Enterprise plan
  if (session.plan !== 'business' && session.plan !== 'enterprise') {
    return NextResponse.json(
      { error: 'Organization creation requires Business or Enterprise plan' },
      { status: 403 }
    )
  }

  // Check if user already belongs to an organization
  if (session.organizationId) {
    return NextResponse.json(
      { error: 'You already belong to an organization' },
      { status: 400 }
    )
  }

  // Parse request body
  let body
  try {
    body = createOrgSchema.parse(await readBoundedJson(request))
  } catch {
    return NextResponse.json(
      { error: 'Invalid request body' },
      { status: 400 }
    )
  }

  const { name } = body
  const limits = PLAN_LIMITS[session.plan]

  try {
    // Get user data
    const userDoc = await adminDb.collection('users').doc(session.userId).get()
    if (!userDoc.exists) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      )
    }
    const userData = userDoc.data()!
    if (!isSelfHosted() && !isVerifiedPaidEntitlement(userData.billing)) {
      return NextResponse.json(
        { error: 'A verified paid subscription is required to create an organization' },
        { status: 403 }
      )
    }

    // Create organization
    const orgRef = adminDb.collection('organizations').doc()
    const orgId = orgRef.id

    await orgRef.set({
      name,
      ownerId: session.userId,
      plan: session.plan,
      planLimits: limits,
      billing: userData.billing,
      // The Stripe customer binding stays with the purchasing owner's personal account; the webhook keeps
      // this organization in sync because the owner holds the subscription.
      ...(userData.billingTrial ? { billingTrial: userData.billingTrial } : {}),
      apiKey: generateApiKey(),
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
      settings: {
        ssoEnabled: false,
        allowedDomains: [],
        auditLogRetentionDays: session.plan === 'enterprise' ? 90 : 30,
        requireMfa: false
      }
    })

    // Add creator as owner member
    await orgRef.collection('members').doc(session.userId).set({
      role: 'owner',
      email: session.email,
      displayName: userData.displayName || session.email,
      invitedBy: session.userId,
      joinedAt: Timestamp.now(),
      permissions: {
        canCreateProjects: true,
        canDeleteProjects: true,
        canManageCredentials: true,
        canInviteMembers: true,
        canViewAuditLog: true
      }
    })

    // Update user's organizationId
    await adminDb.collection('users').doc(session.userId).update({
      organizationId: orgId,
      updatedAt: Timestamp.now()
    })

    return NextResponse.json({
      success: true,
      organizationId: orgId,
      name
    })
  } catch (error) {
    console.error('Create org error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create organization' },
      { status: 500 }
    )
  }
}
