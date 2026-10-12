import type { DocumentData, DocumentReference } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { expectedStripeBinding } from '@/lib/stripe/config'

export interface BillingAccount {
  ref: DocumentReference
  data: DocumentData
  user: DocumentData
  userId: string
  canManage: boolean
}

/** Read fresh ownership and billing state; never authorize billing via a cached role. */
export async function getBillingAccount(userId: string): Promise<BillingAccount | null> {
  const userRef = adminDb.collection('users').doc(userId)
  const user = (await userRef.get()).data()
  if (!user) return null
  if (typeof user.organizationId === 'string' && user.organizationId) {
    const ref = adminDb.collection('organizations').doc(user.organizationId)
    const data = (await ref.get()).data()
    if (data) return { ref, data, user, userId, canManage: data.ownerId === userId }
  }
  return { ref: userRef, data: user, user, userId, canManage: true }
}

const SUBSCRIPTION_HOLDING_STATUSES = ['active', 'trialing', 'past_due', 'incomplete']

/**
 * True when the document holds a Stripe subscription for this deployment's account and mode that is
 * still active, trialing, in payment retry, or recoverable (incomplete). Such accounts go to the billing portal, never a second checkout.
 */
export function hasExistingSubscription(data: DocumentData | undefined, env: Record<string, string | undefined> = process.env): boolean {
  const billing = data?.billing
  const binding = expectedStripeBinding(env)
  return Boolean(
    binding && billing &&
    billing.source === 'stripe' &&
    typeof billing.subscriptionId === 'string' && billing.subscriptionId &&
    billing.livemode === binding.livemode &&
    billing.providerAccountId === binding.accountId &&
    SUBSCRIPTION_HOLDING_STATUSES.includes(billing.status)
  )
}

export function stripeModeKey(livemode: boolean): 'live' | 'test' {
  return livemode ? 'live' : 'test'
}

/** The Stripe customer bound to this account for the given mode, if any. */
export function boundStripeCustomerId(data: DocumentData | undefined, livemode: boolean, accountId: string): string | null {
  const binding = data?.stripeCustomers?.[stripeModeKey(livemode)]
  return binding && typeof binding.id === 'string' && binding.id.startsWith('cus_') &&
    binding.livemode === livemode && binding.accountId === accountId ? binding.id : null
}

/**
 * One free trial per account per Stripe mode. The trial counts as used if the billed account or the
 * purchasing user has ever started one, so leaving or creating a workspace does not unlock another.
 */
export function isTrialEligible(account: DocumentData | undefined, user: DocumentData | undefined, livemode: boolean): boolean {
  const key = stripeModeKey(livemode)
  return !account?.billingTrial?.[key] && !user?.billingTrial?.[key]
}
