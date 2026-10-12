import { createHash, randomUUID } from 'node:crypto'
import { Timestamp, type DocumentReference, type Firestore, type Transaction } from 'firebase-admin/firestore'
import { normalizeUserPlan, type BillingInterval, type PublicBillingPlan } from '@/lib/billing/catalog'
import { isInternalIntegrationIdentity } from '@/lib/features/internal-integrations'
import { attributionToBillingMetadata, type MarketingAttribution } from '@/lib/marketing/attribution'
import { STRIPE_CATALOG_VERSION } from '@/lib/stripe/catalog'
import { priceIdFor, type StripeBillingConfig } from '@/lib/stripe/config'
import { StripeProviderError, type StripeRest } from '@/lib/stripe/rest'
import { boundStripeCustomerId, hasExistingSubscription, isTrialEligible, stripeModeKey } from './account'

export class CheckoutConflict extends Error {
  constructor(readonly code: 'existing_subscription' | 'checkout_pending' | 'billing_permission_changed') {
    super(code === 'existing_subscription'
      ? 'Your subscription is already connected. Manage your existing subscription.'
      : code === 'billing_permission_changed'
        ? 'Your workspace billing permissions changed. Refresh the page before continuing.'
        : 'A checkout is being prepared. Please try again in a moment.')
  }
}

export interface PreparedCheckout {
  id: string
  purchaseUrl: string
  trialDays: number
  expiresAt: number
}

const CREATION_LEASE_MS = 2 * 60 * 1000
const MAX_REUSE_MS = 30 * 60 * 1000
const REUSE_MARGIN_MS = 5 * 60 * 1000

export interface CheckoutRequest {
  db: Firestore
  stripe: Pick<StripeRest, 'createCustomer' | 'createCheckoutSession' | 'retrieveCheckoutSession' | 'expireCheckoutSession'>
  config: Pick<StripeBillingConfig, 'livemode' | 'accountId' | 'prices' | 'trialDays'>
  accountRef: DocumentReference
  actorUserId: string
  email: string
  plan: PublicBillingPlan
  interval: BillingInterval
  origin: string
  attribution?: MarketingAttribution | null
  /** Where Stripe returns a customer who backs out; defaults to the billing page. */
  cancelPath?: '/billing' | '/onboarding'
  now?: () => number
}

/** Stable per account and mode so a retried customer create returns the same Stripe customer. */
function customerIdempotencyKey(accountPath: string, livemode: boolean): string {
  return `asc-customer-${stripeModeKey(livemode)}-${createHash('sha256').update(accountPath).digest('hex').slice(0, 40)}`
}

/**
 * Prepares one hosted Stripe Checkout Session for an account's first subscription. It rechecks the
 * actor's ownership and the account's billing state inside transactions before and after the provider
 * calls, reuses an open session for the same selection, expires a superseded open session so two
 * subscriptions cannot be completed, and adds the free trial only when the account has never used it.
 */
export async function prepareSubscriptionCheckout(input: CheckoutRequest): Promise<PreparedCheckout> {
  const { db, stripe, config, accountRef, actorUserId } = input
  const now = input.now ?? Date.now
  const mode = stripeModeKey(config.livemode)
  const selection = `${input.plan}:${input.interval}`
  const leaseRef = db.collection('billingCheckouts').doc(`${accountRef.path.replaceAll('/', '_')}_${mode}`)
  const attempt = randomUUID()

  let trialDays = 0
  const assertEligible = async (transaction: Transaction) => {
    const account = (await transaction.get(accountRef)).data()
    const isPersonal = accountRef.path === `users/${actorUserId}`
    const user = isPersonal ? account : (await transaction.get(db.collection('users').doc(actorUserId))).data()
    const authorized = account && user && (isPersonal
      ? !user.organizationId
      : account.ownerId === actorUserId && accountRef.path === `organizations/${user.organizationId}`)
    if (!authorized) throw new CheckoutConflict('billing_permission_changed')
    const internalPaid = isInternalIntegrationIdentity({ userId: actorUserId, email: user.email }) &&
      normalizeUserPlan(account.billing?.plan || account.plan) !== 'free'
    if (internalPaid || hasExistingSubscription(account) || hasExistingSubscription(user)) {
      throw new CheckoutConflict('existing_subscription')
    }
    trialDays = config.trialDays > 0 && isTrialEligible(account, user, config.livemode) ? config.trialDays : 0
    return { account, user }
  }

  const start = await db.runTransaction(async transaction => {
    const { account } = await assertEligible(transaction)
    const current = now()
    const pending = (await transaction.get(leaseRef)).data() || {}
    if (pending.creatingUntil > current) throw new CheckoutConflict('checkout_pending')
    const reusable = pending.checkout as PreparedCheckout | undefined
    if (pending.selection === selection && reusable && pending.reuseUntil > current &&
        reusable.expiresAt - REUSE_MARGIN_MS > current && reusable.trialDays === trialDays) {
      return { reuse: reusable, previousSessionId: null, customerId: null }
    }
    transaction.set(leaseRef, {
      attempt,
      selection,
      creatingUntil: current + CREATION_LEASE_MS,
      checkout: reusable ?? null,
      updatedAt: Timestamp.fromMillis(current),
    })
    return {
      reuse: null,
      previousSessionId: reusable?.id ?? null,
      customerId: boundStripeCustomerId(account, config.livemode, config.accountId),
    }
  })
  if (start.reuse) return start.reuse

  // A superseded open session is expired first; a completed one means a subscription is on its way.
  if (start.previousSessionId) {
    try {
      const previous = await stripe.retrieveCheckoutSession(start.previousSessionId)
      if (previous.status === 'complete') throw new CheckoutConflict('existing_subscription')
      if (previous.status === 'open') await stripe.expireCheckoutSession(previous.id, `asc-expire-${previous.id}`)
    } catch (error) {
      if (error instanceof CheckoutConflict) throw error
      if (!(error instanceof StripeProviderError) || error.uncertain) throw new CheckoutConflict('checkout_pending')
    }
  }

  let customerId = start.customerId
  if (!customerId) {
    const customer = await stripe.createCustomer({
      email: input.email,
      metadata: {
        appstorecopilot_account_path: accountRef.path,
        appstorecopilot_user_id: actorUserId,
      },
      idempotencyKey: customerIdempotencyKey(accountRef.path, config.livemode),
    })
    if (customer.livemode !== config.livemode) throw new StripeProviderError('LIVEMODE_MISMATCH', null, false)
    customerId = await db.runTransaction(async transaction => {
      const account = (await transaction.get(accountRef)).data()
      const existing = boundStripeCustomerId(account, config.livemode, config.accountId)
      if (existing) return existing
      const indexRef = db.collection('billingCustomers').doc(customer.id)
      const index = (await transaction.get(indexRef)).data()
      if (index && index.accountPath !== accountRef.path) throw new Error('CUSTOMER_ACCOUNT_CONFLICT')
      transaction.set(accountRef, {
        stripeCustomers: { [mode]: { id: customer.id, livemode: config.livemode, accountId: config.accountId } },
      }, { merge: true })
      if (!index) {
        transaction.set(indexRef, {
          customerId: customer.id,
          accountPath: accountRef.path,
          userId: actorUserId,
          livemode: config.livemode,
          stripeAccountId: config.accountId,
          createdAt: Timestamp.fromMillis(now()),
        })
      }
      return customer.id
    })
  }

  const metadata = {
    appstorecopilot_account_path: accountRef.path,
    appstorecopilot_user_id: actorUserId,
    appstorecopilot_plan: input.plan,
    appstorecopilot_interval: input.interval,
    appstorecopilot_catalog_version: STRIPE_CATALOG_VERSION,
    appstorecopilot_trial_days: String(trialDays),
  }
  const successParams = new URLSearchParams({ checkout: 'complete', plan: input.plan, interval: input.interval })
  if (trialDays > 0) successParams.set('trial', '1')
  const cancelPath = input.cancelPath ?? '/billing'
  // Onboarding continues after payment (agent connection needs product access); billing confirms in place.
  const successPath = cancelPath
  const cancelParams = new URLSearchParams({ plan: input.plan, interval: input.interval, checkout: 'canceled' })
  const session = await stripe.createCheckoutSession({
    customerId,
    priceId: priceIdFor(config as StripeBillingConfig, input.plan, input.interval),
    clientReferenceId: accountRef.path.replace('/', ':'),
    successUrl: `${input.origin}${successPath}?${successParams}`,
    cancelUrl: `${input.origin}${cancelPath}?${cancelParams}`,
    metadata,
    subscriptionMetadata: { ...metadata, ...attributionToBillingMetadata(input.attribution) },
    trialDays,
    idempotencyKey: `asc-checkout-${attempt}`,
  })
  if (session.livemode !== config.livemode || !session.url) throw new StripeProviderError('CHECKOUT_SESSION_INVALID', null, true)
  let purchaseUrl: URL
  try { purchaseUrl = new URL(session.url) } catch { throw new StripeProviderError('CHECKOUT_SESSION_INVALID', null, true) }
  if (purchaseUrl.protocol !== 'https:' || purchaseUrl.hostname !== 'checkout.stripe.com') {
    throw new StripeProviderError('CHECKOUT_SESSION_INVALID', null, true)
  }
  const checkout: PreparedCheckout = { id: session.id, purchaseUrl: purchaseUrl.href, trialDays, expiresAt: session.expires_at * 1000 }

  await db.runTransaction(async transaction => {
    await assertEligible(transaction)
    const current = (await transaction.get(leaseRef)).data()
    if (current?.attempt !== attempt) throw new CheckoutConflict('checkout_pending')
    transaction.set(leaseRef, {
      attempt,
      selection,
      checkout,
      creatingUntil: 0,
      reuseUntil: Math.min(now() + MAX_REUSE_MS, checkout.expiresAt - REUSE_MARGIN_MS),
      updatedAt: Timestamp.fromMillis(now()),
    })
  })
  return checkout
}
