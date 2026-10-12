import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { adminDb } from '@/lib/firebase/admin'
import { normalizeAgentOnboardingState } from '@/lib/agent-onboarding'
import { Timestamp } from 'firebase-admin/firestore'
import { getBillingAccount, isTrialEligible } from '@/lib/billing/account'
import { getProductAccess } from '@/lib/billing/access'
import { getAccountContext, invalidateAccountContextCache } from '@/lib/org/context'
import { isBillingCheckoutEnabled, stripeBillingConfig } from '@/lib/stripe/config'
import { isSelfHosted } from '@/lib/selfhost/config'

/**
 * Hard paywall state for onboarding: whether the workspace already has product access, and whether the
 * paywall step can start a free trial (first subscription) or only a paid checkout.
 */
async function paywallState(userId: string) {
  invalidateAccountContextCache(userId)
  const context = await getAccountContext(userId)
  const access = context ? getProductAccess(context) : { allowed: false, reason: null, recoverable: false, ownerMustPay: false }
  // Self-hosted installs have no billing: no plan/trial step, and no Stripe reads.
  if (isSelfHosted()) {
    return {
      access: { allowed: true, recoverable: false, ownerMustPay: false },
      trial: { offered: false, days: 0 },
      checkoutEnabled: false,
      selfHosted: true,
    }
  }
  const config = stripeBillingConfig()
  const account = await getBillingAccount(userId)
  const trialEligible = Boolean(config && config.trialDays > 0 && account &&
    isTrialEligible(account.data, account.user, config.livemode))
  return {
    access: { allowed: access.allowed, recoverable: access.recoverable, ownerMustPay: access.ownerMustPay },
    trial: { offered: !access.allowed && trialEligible, days: config?.trialDays ?? 0 },
    checkoutEnabled: isBillingCheckoutEnabled(),
  }
}

// GET /api/onboarding - Check onboarding status
export async function GET() {
  try {
    const session = await getSession()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userDoc = await adminDb.collection('users').doc(session.userId).get()
    const paywall = await paywallState(session.userId)

    return NextResponse.json({
      ...paywall,
      onboardingCompleted: session.onboardingCompleted,
      workspaceName: session.workspaceName,
      email: session.email,
      displayName: session.displayName,
      plan: session.plan,
      agentOnboarding: normalizeAgentOnboardingState(userDoc.data()),
    })
  } catch (error) {
    console.error('Error checking onboarding status:', error)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

// POST /api/onboarding - Complete onboarding
export async function POST(request: NextRequest) {
  try {
    const session = await getSession()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { workspaceName, completeManually } = body

    if (!workspaceName || typeof workspaceName !== 'string') {
      return NextResponse.json({ error: 'Workspace name is required' }, { status: 400 })
    }

    const trimmedName = workspaceName.trim()
    if (trimmedName.length < 2 || trimmedName.length > 50) {
      return NextResponse.json({ error: 'Workspace name must be 2-50 characters' }, { status: 400 })
    }

    const now = Timestamp.now()

    // Workspace creation is the first step. Agent pairing is the recommended
    // continuation; an explicit dashboard-only path remains available.
    const userRef = adminDb.collection('users').doc(session.userId)
    await userRef.set({
      workspaceName: trimmedName,
      onboardingCompleted: completeManually === true,
      agentOnboarding: completeManually === true
        ? {
            status: 'complete',
            currentStep: 'complete',
            completedAt: now,
            completionMode: 'manual',
            updatedAt: now,
          }
        : {
            status: 'not_connected',
            currentStep: 'connect_agent',
            updatedAt: now,
          },
      updatedAt: now,
    }, { merge: true })

    return NextResponse.json({
      success: true,
      workspaceName: trimmedName,
      onboardingCompleted: completeManually === true,
      nextStep: completeManually === true ? 'dashboard' : 'connect_agent',
    })
  } catch (error) {
    console.error('Error completing onboarding:', error)
    return NextResponse.json({ error: 'Failed to complete onboarding' }, { status: 500 })
  }
}
