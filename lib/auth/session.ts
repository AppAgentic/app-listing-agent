import { cookies } from 'next/headers'
import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { PLAN_LIMITS, UserPlan } from '@/lib/constants'
import { SELF_HOSTED_PLAN, normalizeUserPlan } from '@/lib/billing/catalog'
import { isSelfHosted } from '@/lib/selfhost/config'
import { isVerifiedPaidEntitlement } from '@/lib/billing/entitlements'
import { isInternalIntegrationIdentity } from '@/lib/features/internal-integrations'
import { Timestamp } from 'firebase-admin/firestore'
import crypto from 'crypto'
import { sanitizeMarketingAttribution, type MarketingAttribution } from '@/lib/marketing/attribution'

export interface SessionUser {
  userId: string
  email: string
  displayName?: string
  photoUrl?: string
  plan: UserPlan
  organizationId?: string
  workspaceName?: string
  onboardingCompleted: boolean
}

// Generate API key for user
export function generateApiKey(): string {
  return `asc_${crypto.randomBytes(32).toString('hex')}`
}

function resolveSessionPlan(
  userId: string,
  data: Record<string, any>
): UserPlan {
  if (isSelfHosted()) return SELF_HOSTED_PLAN
  if (isInternalIntegrationIdentity({ userId, email: data.email })) {
    return normalizeUserPlan(data.billing?.plan || data.plan)
  }
  if (isVerifiedPaidEntitlement(data.billing)) {
    return normalizeUserPlan(data.billing.plan)
  }
  return 'free'
}

// Create or get user in Firestore
export async function createOrUpdateUser(
  firebaseUid: string,
  email: string,
  displayName?: string,
  photoUrl?: string,
  attribution?: MarketingAttribution | null,
): Promise<SessionUser> {
  const userRef = adminDb.collection('users').doc(firebaseUid)
  const userDoc = await userRef.get()

  if (!userDoc.exists) {
    // New users are free until a verified billing webhook activates a paid plan.
    const safeAttribution = sanitizeMarketingAttribution(attribution)
    const userData = {
      email,
      displayName: displayName || email.split('@')[0],
      photoUrl: photoUrl || null,
      plan: 'free' as UserPlan,
      planLimits: PLAN_LIMITS.free,
      billing: {
        status: 'free',
        source: 'none',
        plan: 'free',
        subscriptionId: null,
        currentPeriodStart: null,
        currentPeriodEnd: null,
        updatedAt: Timestamp.now(),
      },
      apiKey: generateApiKey(),
      organizationId: null,
      workspaceName: null,
      onboardingCompleted: false,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...(safeAttribution ? {
        marketingAttribution: {
          firstTouch: safeAttribution,
          lastTouch: safeAttribution,
        },
      } : {}),
    }
    await userRef.set(userData)

    return {
      userId: firebaseUid,
      email,
      displayName: userData.displayName,
      photoUrl: userData.photoUrl || undefined,
      plan: 'free',
      organizationId: undefined,
      workspaceName: undefined,
      onboardingCompleted: false
    }
  } else {
    // Existing user - update last login
    const data = userDoc.data()!
    const safeAttribution = sanitizeMarketingAttribution(attribution)
    await userRef.update({
      updatedAt: new Date(),
      ...(safeAttribution ? {
        'marketingAttribution.lastTouch': safeAttribution,
        ...(!data.marketingAttribution?.firstTouch
          ? { 'marketingAttribution.firstTouch': safeAttribution }
          : {}),
      } : {}),
    })

    return {
      userId: firebaseUid,
      email: data.email,
      displayName: data.displayName,
      photoUrl: data.photoUrl,
      plan: resolveSessionPlan(firebaseUid, data),
      organizationId: data.organizationId || undefined,
      workspaceName: data.workspaceName || undefined,
      onboardingCompleted: data.onboardingCompleted ?? false
    }
  }
}

// Create session cookie from Firebase ID token
export async function createSessionCookie(idToken: string): Promise<string> {
  // Verify the ID token and create a session cookie
  const expiresIn = 60 * 60 * 24 * 7 * 1000 // 7 days
  const sessionCookie = await adminAuth.createSessionCookie(idToken, { expiresIn })

  const cookieStore = await cookies()
  cookieStore.set('__session', sessionCookie, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 7, // 7 days
    path: '/'
  })

  return sessionCookie
}

// Get current session from cookie
export async function getSession(): Promise<SessionUser | null> {
  const cookieStore = await cookies()
  const sessionCookie = cookieStore.get('__session')

  if (!sessionCookie?.value) {
    return null
  }

  try {
    // Verify the session cookie
    const decodedClaims = await adminAuth.verifySessionCookie(sessionCookie.value, true)

    // Get user data from Firestore
    const userDoc = await adminDb.collection('users').doc(decodedClaims.uid).get()

    if (!userDoc.exists) {
      return null
    }

    const data = userDoc.data()!
    return {
      userId: decodedClaims.uid,
      email: data.email,
      displayName: data.displayName,
      photoUrl: data.photoUrl,
      plan: resolveSessionPlan(decodedClaims.uid, data),
      organizationId: data.organizationId || undefined,
      workspaceName: data.workspaceName || undefined,
      onboardingCompleted: data.onboardingCompleted ?? false
    }
  } catch (error) {
    // Session invalid or expired
    return null
  }
}

// Clear session cookie
export async function clearSession(): Promise<void> {
  const cookieStore = await cookies()
  cookieStore.delete('__session')
}

// Require authentication (for API routes)
export async function requireAuth(): Promise<SessionUser> {
  const session = await getSession()
  if (!session) {
    throw new Error('Unauthorized')
  }
  return session
}

// Update user's plan (internal/admin use; paid plans come from the Stripe webhook)
export async function updateUserPlan(
  userId: string,
  plan: UserPlan
): Promise<void> {
  const userRef = adminDb.collection('users').doc(userId)
  await userRef.update({
    plan,
    planLimits: PLAN_LIMITS[plan],
    updatedAt: new Date()
  })
}
