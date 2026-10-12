import { NextRequest, NextResponse } from 'next/server'
import { createSessionCookie, createOrUpdateUser, getSession } from '@/lib/auth/session'
import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { checkSignupEligibility } from '@/lib/auth/signup-policy'
import { sanitizeMarketingAttribution } from '@/lib/marketing/attribution'

async function removeFreshUnauthorizedAuthUser(userId: string): Promise<void> {
  try {
    const authUser = await adminAuth.getUser(userId)
    const createdAt = new Date(authUser.metadata.creationTime).getTime()
    if (Number.isFinite(createdAt) && Date.now() - createdAt < 10 * 60 * 1000) {
      await adminAuth.deleteUser(userId)
    }
  } catch (error) {
    // Session denial is the security boundary. Cleanup is best-effort so an
    // Auth service incident does not accidentally turn a denial into access.
    console.warn('Unable to clean up unauthorized fresh auth user:', error)
  }
}

// GET /api/auth/session - Get current session info
export async function GET() {
  try {
    const session = await getSession()
    if (!session) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    // Get user email from Firestore
    const userDoc = await adminDb.collection('users').doc(session.userId).get()
    const userData = userDoc.data()

    return NextResponse.json({
      userId: session.userId,
      email: userData?.email || null,
      name: userData?.displayName || null,
    })
  } catch (error) {
    console.error('Session fetch error:', error)
    return NextResponse.json({ error: 'Failed to get session' }, { status: 500 })
  }
}

// POST /api/auth/session - Create session from Firebase ID token
export async function POST(request: NextRequest) {
  try {
    const { idToken, inviteToken, attribution } = await request.json()

    if (!idToken) {
      return NextResponse.json({ error: 'ID token required' }, { status: 400 })
    }

    // Verify the ID token
    const decodedToken = await adminAuth.verifyIdToken(idToken)

    const eligibility = await checkSignupEligibility({
      firebaseUid: decodedToken.uid,
      email: decodedToken.email || '',
      inviteToken: typeof inviteToken === 'string' ? inviteToken : undefined,
    })

    if (!eligibility.allowed) {
      await removeFreshUnauthorizedAuthUser(decodedToken.uid)
      return NextResponse.json(
        { error: 'signup_not_available', message: 'Signups are currently invite-only.' },
        { status: 403 }
      )
    }

    // Create or update user in Firestore
    const user = await createOrUpdateUser(
      decodedToken.uid,
      decodedToken.email || '',
      decodedToken.name,
      decodedToken.picture,
      sanitizeMarketingAttribution(attribution),
    )

    // Create session cookie
    await createSessionCookie(idToken)

    return NextResponse.json({
      success: true,
      onboardingCompleted: user.onboardingCompleted
    })
  } catch (error) {
    console.error('Session creation error:', error)
    return NextResponse.json(
      { error: 'Failed to create session' },
      { status: 401 }
    )
  }
}
