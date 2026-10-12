import { NextRequest } from 'next/server'
import { authenticateRequest, unauthorizedResponse } from '@/lib/api/auth'
import { getSession } from '@/lib/auth/session'
import { adminDb } from '@/lib/firebase/admin'
import { boundStripeCustomerId, hasExistingSubscription, isTrialEligible } from '@/lib/billing/account'
import { SELF_HOSTED_PLAN, TRIAL_PERIOD_DAYS } from '@/lib/billing/catalog'
import { getEffectivePlan } from '@/lib/billing/entitlements'
import { getAccountContext } from '@/lib/org/context'
import { expectedStripeBinding, stripeBillingConfig } from '@/lib/stripe/config'
import type { Organization, User } from '@/lib/firebase/firestore'
import { isSelfHosted } from '@/lib/selfhost/config'

const iso = (value: { toDate?: () => Date } | null | undefined) => value?.toDate?.()?.toISOString() || null

export async function GET(request: NextRequest) {
  // Dashboard requests authenticate with the httpOnly __session cookie. Public
  // API clients still use bearer authentication, so retain that as a fallback.
  const session = await getSession()
  const context = session
    ? await getAccountContext(session.userId)
    : (await authenticateRequest(request)).context

  if (!context) {
    return unauthorizedResponse('Authentication required')
  }

  // Self-hosted installs have no billing: report unlimited access without reading Stripe state.
  if (isSelfHosted()) {
    return Response.json({
      plan: SELF_HOSTED_PLAN,
      status: 'self_hosted',
      selfHosted: true,
      renewsAt: null,
      trialEndsAt: null,
      cancelledAt: null,
      subscriptionId: null,
      billingInterval: null,
      cancelAtPeriodEnd: false,
      canManageBilling: false,
      hasExistingSubscription: false,
      canOpenPortal: false,
      trialEligible: false,
      trialDays: 0,
    })
  }

  const accountRef = context.type === 'organization' && context.orgId
    ? adminDb.collection('organizations').doc(context.orgId)
    : adminDb.collection('users').doc(context.userId)
  const accountDoc = await accountRef.get()
  const data = accountDoc.data() || {}
  const binding = expectedStripeBinding()
  // A record from another Stripe mode or account (e.g. a sandbox test) is invisible to this deployment.
  const current = binding && data.billing?.source === 'stripe' &&
    data.billing.livemode === binding.livemode && data.billing.providerAccountId === binding.accountId
  const billing = current ? data.billing : {}

  const canManageBilling = context.type !== 'organization' || data.ownerId === context.userId
  const config = stripeBillingConfig()
  const livemode = binding?.livemode ?? false
  const userData = context.type === 'organization' ? context.user : data

  return Response.json({
    plan: getEffectivePlan(context.type === 'organization'
      ? { ...context, organization: data as Organization }
      : { ...context, user: data as User }),
    status: billing.status || 'free',
    renewsAt: iso(billing.currentPeriodEnd),
    trialEndsAt: billing.status === 'trialing' ? iso(billing.trialEnd) : null,
    cancelledAt: iso(data.cancelledAt),
    subscriptionId: billing.subscriptionId || null,
    billingInterval: ['monthly', 'annual'].includes(billing.billingInterval) ? billing.billingInterval : null,
    cancelAtPeriodEnd: billing.cancelAtPeriodEnd === true,
    canManageBilling,
    hasExistingSubscription: hasExistingSubscription(data),
    canOpenPortal: Boolean(canManageBilling && binding && (
      boundStripeCustomerId(data, binding.livemode, binding.accountId) ||
      boundStripeCustomerId(userData, binding.livemode, binding.accountId)
    )),
    trialEligible: Boolean(config && config.trialDays > 0 && !hasExistingSubscription(data) && isTrialEligible(data, userData, livemode)),
    trialDays: config?.trialDays ?? TRIAL_PERIOD_DAYS,
  })
}
