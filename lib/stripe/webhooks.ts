import { randomBytes } from 'node:crypto'
import { FieldValue, Timestamp, type DocumentReference, type Firestore } from 'firebase-admin/firestore'
import { PLAN_LIMITS, type UserPlan } from '@/lib/billing/catalog'
import { stripeModeKey } from '@/lib/billing/account'
import type { BillingStatus } from '@/lib/firebase/firestore'
import { attributionFromBillingMetadata } from '@/lib/marketing/attribution'
import { STRIPE_CATALOG_VERSION } from './catalog'
import { planForPrice, type StripeBillingConfig } from './config'
import { stripeId } from './ids'
import type { StripeCharge, StripeRest, StripeSubscription } from './rest'
import { verifyStripeSignature, WebhookSignatureError } from './signature'

/**
 * Stripe webhook processing:
 * 1. intake: raw-body HMAC verification (current + previous secret, 300 s tolerance), livemode check,
 *    then a durable `stripeWebhookInbox/{eventId}` row (created once; duplicates are acknowledged).
 * 2. processEvent: lease the row, re-read the canonical Stripe object (the payload only names it),
 *    apply the entitlement in a Firestore transaction, then mark processed. Failures back off and stay
 *    due for the reconcile sweep (`POST /api/billing/reconcile`).
 * Paid access is derived from the subscription's price through the configured catalog, never from metadata.
 */

export class WebhookRejected extends Error {
  constructor(readonly status: 400 | 413, readonly code: string) { super(code) }
}

export interface InboxRow {
  id: string
  type: string
  livemode: boolean
  created: number
  receivedAt: number
  objectId: string | null
  state: 'pending' | 'processing' | 'processed' | 'ignored' | 'failed'
  attempts: number
  nextAttemptAt: number
  lease: { id: string; expiresAt: number } | null
  result: string | null
  lastError: string | null
  userId: string | null
  updatedAt: number
  payload: string
}

export interface StripeEvent {
  id: string
  type: string
  livemode: boolean
  created: number
  data: { object: Record<string, unknown>; previous_attributes?: Record<string, unknown> }
}

export type StripeWebhookClient = Pick<StripeRest,
  'retrieveSubscription' | 'retrieveCheckoutSession' | 'retrieveInvoice' | 'retrieveCharge' |
  'listInvoicePaymentsForPaymentIntent' | 'cancelSubscription'>

export interface WebhookDeps {
  db: Firestore
  stripe: StripeWebhookClient
  config: Pick<StripeBillingConfig, 'livemode' | 'accountId' | 'prices' | 'webhookSecrets'>
  now?: () => number
  /** Runs after an event is marked processed. Must never throw (analytics, concierge). */
  onProcessed?: (event: StripeEvent, outcome: Outcome) => Promise<void>
}

export interface Outcome {
  state: 'processed' | 'ignored'
  detail: string
  userId?: string | null
  subscription?: { id: string; status: BillingStatus; plan: UserPlan; previousStatus: string | null; firstRecord: boolean } | null
}

const MAX_BODY_BYTES = 512 * 1024
const LEASE_MS = 120_000
type Json = Record<string, unknown>
const record = (value: unknown): Json => (value && typeof value === 'object' && !Array.isArray(value) ? value as Json : {})
const inbox = (db: Firestore, eventId: string) => db.collection('stripeWebhookInbox').doc(eventId)

export async function intakeStripeEvent(deps: WebhookDeps, rawBody: Buffer, signature: string | null): Promise<{ eventId: string; duplicate: boolean }> {
  const now = (deps.now ?? Date.now)()
  if (rawBody.length > MAX_BODY_BYTES) throw new WebhookRejected(413, 'BODY_TOO_LARGE')
  try {
    verifyStripeSignature(rawBody, signature, deps.config.webhookSecrets, Math.floor(now / 1000))
  } catch (error) {
    throw new WebhookRejected(400, error instanceof WebhookSignatureError ? error.message : 'WEBHOOK_SIGNATURE_INVALID')
  }
  let event: StripeEvent
  try { event = JSON.parse(rawBody.toString('utf8')) } catch { throw new WebhookRejected(400, 'WEBHOOK_PAYLOAD_INVALID') }
  if (!stripeId(event?.id, 'evt') || typeof event.type !== 'string' || event.type.length > 64 ||
      typeof event.livemode !== 'boolean' || !Number.isSafeInteger(event.created) || !event.data || typeof event.data !== 'object') {
    throw new WebhookRejected(400, 'WEBHOOK_PAYLOAD_INVALID')
  }
  // A sandbox event must never reach a live deployment and vice versa.
  if (event.livemode !== deps.config.livemode) throw new WebhookRejected(400, 'WEBHOOK_LIVEMODE_MISMATCH')
  const object = record(event.data.object)
  const row: InboxRow = {
    id: event.id,
    type: event.type,
    livemode: event.livemode,
    created: event.created,
    receivedAt: now,
    objectId: typeof object.id === 'string' ? object.id.slice(0, 100) : null,
    state: 'pending',
    attempts: 0,
    nextAttemptAt: now,
    lease: null,
    result: null,
    lastError: null,
    userId: null,
    updatedAt: now,
    payload: rawBody.toString('utf8'),
  }
  const ref = inbox(deps.db, event.id)
  const created = await deps.db.runTransaction(async transaction => {
    if ((await transaction.get(ref)).exists) return false
    transaction.create(ref, row)
    return true
  })
  return { eventId: event.id, duplicate: !created }
}

export async function processStripeEvent(deps: WebhookDeps, eventId: string): Promise<'processed' | 'ignored' | 'failed' | 'skipped'> {
  const clock = deps.now ?? Date.now
  const leaseId = randomBytes(8).toString('hex')
  const ref = inbox(deps.db, eventId)
  const row = await deps.db.runTransaction(async transaction => {
    const current = (await transaction.get(ref)).data() as InboxRow | undefined
    const now = clock()
    if (!current || current.state === 'processed' || current.state === 'ignored' ||
        (current.lease && current.lease.expiresAt > now) || current.nextAttemptAt > now) return null
    const next: InboxRow = { ...current, state: 'processing', lease: { id: leaseId, expiresAt: now + LEASE_MS }, attempts: current.attempts + 1, updatedAt: now }
    transaction.set(ref, next)
    return next
  })
  if (!row) return 'skipped'

  const finish = (update: Partial<InboxRow>) => deps.db.runTransaction(async transaction => {
    const current = (await transaction.get(ref)).data() as InboxRow | undefined
    if (!current || current.lease?.id !== leaseId) return
    transaction.set(ref, { ...current, ...update, lease: null, updatedAt: clock() })
  })

  let event: StripeEvent
  let outcome: Outcome
  try {
    event = JSON.parse(row.payload) as StripeEvent
    outcome = await applyStripeEvent(deps, event)
  } catch (error) {
    const backoff = Math.min(3_600_000, 30_000 * 2 ** Math.min(row.attempts, 7))
    const code = error instanceof Error ? error.message.replace(/[^A-Za-z0-9_ :-]/g, '').slice(0, 120) : 'UNKNOWN'
    console.error(`Stripe webhook event processing failed (${row.type}): ${code}`)
    await finish({ state: 'failed', lastError: code, nextAttemptAt: clock() + backoff })
    return 'failed'
  }
  await finish({ state: outcome.state, result: outcome.detail.slice(0, 200), lastError: null, userId: outcome.userId ?? null, nextAttemptAt: clock() })
  if (outcome.state === 'processed' && deps.onProcessed) await deps.onProcessed(event, outcome).catch(() => undefined)
  return outcome.state
}

/** Retries rows that failed or whose processing lease expired. Called by the reconcile scheduler. */
export async function processDueStripeEvents(deps: WebhookDeps, limit = 20): Promise<Record<string, string>> {
  const now = (deps.now ?? Date.now)()
  const results: Record<string, string> = {}
  const ids = new Set<string>()
  for (const state of ['pending', 'failed', 'processing'] as const) {
    const snapshot = await deps.db.collection('stripeWebhookInbox')
      .where('state', '==', state).where('nextAttemptAt', '<=', now).orderBy('nextAttemptAt').limit(limit).get()
    for (const doc of snapshot.docs) {
      const row = doc.data() as InboxRow
      if (row.receivedAt > now - 60_000 && state === 'pending') continue // the webhook request is still handling it
      if (!row.lease || row.lease.expiresAt <= now) ids.add(doc.id)
    }
  }
  for (const id of [...ids].slice(0, limit)) results[id] = await processStripeEvent(deps, id)
  return results
}

function assertLive(deps: WebhookDeps, object: { livemode: boolean }) {
  if (object.livemode !== deps.config.livemode) throw new Error('LIVEMODE_MISMATCH')
}

export async function applyStripeEvent(deps: WebhookDeps, event: StripeEvent): Promise<Outcome> {
  const object = record(event.data.object)
  switch (event.type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded': {
      const sessionId = stripeId(object.id, 'cs')
      if (!sessionId) return { state: 'ignored', detail: 'no session id' }
      const session = await deps.stripe.retrieveCheckoutSession(sessionId)
      assertLive(deps, session)
      const subscriptionId = stripeId(session.subscription, 'sub')
      if (session.mode !== 'subscription' || !subscriptionId) return { state: 'ignored', detail: 'not a subscription checkout' }
      return reconcileSubscription(deps, event, subscriptionId)
    }
    case 'checkout.session.expired':
    case 'checkout.session.async_payment_failed':
      return { state: 'ignored', detail: 'session did not create access' }
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
    case 'customer.subscription.paused':
    case 'customer.subscription.resumed':
    case 'customer.subscription.trial_will_end': {
      const subscriptionId = stripeId(object.id, 'sub')
      if (!subscriptionId) return { state: 'ignored', detail: 'no subscription id' }
      return reconcileSubscription(deps, event, subscriptionId)
    }
    case 'invoice.paid':
    case 'invoice.payment_failed':
    case 'invoice.payment_action_required': {
      const invoiceId = stripeId(object.id, 'in')
      if (!invoiceId) return { state: 'ignored', detail: 'no invoice id' }
      const invoice = await deps.stripe.retrieveInvoice(invoiceId)
      assertLive(deps, invoice)
      const subscriptionId = stripeId(invoice.parent?.subscription_details?.subscription, 'sub')
      if (!subscriptionId) return { state: 'ignored', detail: 'non-subscription invoice' }
      return reconcileSubscription(deps, event, subscriptionId, event.type === 'invoice.paid' && invoice.status === 'paid'
        ? { invoiceId: invoice.id, amountPaid: invoice.amount_paid, currency: invoice.currency.toUpperCase(), billingReason: invoice.billing_reason }
        : { invoiceId: invoice.id })
    }
    case 'charge.refunded':
      return applyRefund(deps, event, object)
    case 'charge.dispute.created':
    case 'charge.dispute.closed': {
      // Managed Payments handles disputes; record the fact for support only.
      const customerId = stripeId(object.customer, 'cus')
      const bound = customerId ? await customerBinding(deps, customerId) : null
      await recordBillingEvent(deps, event, { userId: bound?.userId ?? null, disputeId: typeof object.id === 'string' ? object.id : null })
      return { state: 'processed', detail: 'dispute recorded', userId: bound?.userId ?? null }
    }
    default:
      return { state: 'ignored', detail: `unhandled ${event.type}` }
  }
}

interface CustomerBinding { customerId: string; accountPath: string; userId: string; livemode: boolean; stripeAccountId: string }

async function customerBinding(deps: WebhookDeps, customerId: string): Promise<CustomerBinding | null> {
  const data = (await deps.db.collection('billingCustomers').doc(customerId).get()).data() as CustomerBinding | undefined
  if (!data || data.livemode !== deps.config.livemode || data.stripeAccountId !== deps.config.accountId) return null
  if (!/^(users|organizations)\/[A-Za-z0-9_-]{1,128}$/.test(data.accountPath) || !/^[A-Za-z0-9_-]{1,128}$/.test(data.userId)) return null
  return data
}

function billingStatus(status: StripeSubscription['status']): BillingStatus {
  if (status === 'trialing') return 'trialing'
  if (status === 'active') return 'active'
  // Stripe is retrying the renewal: access continues (grace) and the app asks for a payment fix.
  if (status === 'past_due') return 'past_due'
  // Payment never completed or retries exhausted: no access, recoverable through the portal.
  if (status === 'unpaid' || status === 'incomplete') return 'incomplete'
  return 'cancelled'
}

const HOLDING = ['active', 'trialing', 'past_due', 'incomplete']
const seconds = (value: number | null | undefined) => (typeof value === 'number' && Number.isSafeInteger(value) ? Timestamp.fromMillis(value * 1000) : null)

function billingEventBody(deps: WebhookDeps, event: StripeEvent, fields: Json): Json {
  return {
    provider: 'stripe',
    type: event.type,
    eventId: event.id,
    livemode: event.livemode,
    stripeAccountId: deps.config.accountId,
    providerEventAt: Timestamp.fromMillis(event.created * 1000),
    processedAt: Timestamp.fromMillis((deps.now ?? Date.now)()),
    ...fields,
  }
}

/** `billingEvents/{eventId}` is written once per Stripe event; replays leave it untouched. */
async function recordBillingEvent(deps: WebhookDeps, event: StripeEvent, fields: Json): Promise<boolean> {
  const ref = deps.db.collection('billingEvents').doc(event.id)
  return deps.db.runTransaction(async transaction => {
    if ((await transaction.get(ref)).exists) return false
    transaction.create(ref, billingEventBody(deps, event, fields))
    return true
  })
}

async function reconcileSubscription(
  deps: WebhookDeps,
  event: StripeEvent,
  subscriptionId: string,
  invoice?: { invoiceId: string; amountPaid?: number; currency?: string; billingReason?: string | null },
): Promise<Outcome> {
  const clock = deps.now ?? Date.now
  const subscription = await deps.stripe.retrieveSubscription(subscriptionId)
  assertLive(deps, subscription)
  const binding = await customerBinding(deps, subscription.customer)
  if (!binding) return { state: 'ignored', detail: 'customer not bound to an App Listing Agent account' }
  const metadataPath = subscription.metadata?.appstorecopilot_account_path
  if (metadataPath !== undefined && metadataPath !== binding.accountPath) throw new Error('SUBSCRIPTION_ACCOUNT_MISMATCH')

  const item = subscription.items.data[0]
  const price = item ? planForPrice(deps.config, item.price?.id) : null
  // Unknown prices never grant; the row stays failed and visible instead of silently dropping access changes.
  if (!item || subscription.items.data.length !== 1 || !price) throw new Error('SUBSCRIPTION_PRICE_NOT_IN_CATALOG')

  const status = billingStatus(subscription.status)
  const access = status === 'active' || status === 'trialing' || status === 'past_due'
  const plan: UserPlan = access ? price.plan : 'free'
  const syncedAt = clock()
  const mode = stripeModeKey(deps.config.livemode)
  const attribution = attributionFromBillingMetadata(subscription.metadata ?? {})
  const userRef = deps.db.collection('users').doc(binding.userId)

  const eventRef = deps.db.collection('billingEvents').doc(event.id)
  return deps.db.runTransaction(async transaction => {
    // Firestore transactions read everything before the first write.
    const eventExists = (await transaction.get(eventRef)).exists
    const userSnapshot = await transaction.get(userRef)
    if (!userSnapshot.exists) return { state: 'ignored' as const, detail: 'account owner no longer exists' }
    const user = userSnapshot.data() || {}
    let orgRef: DocumentReference | null = null
    if (binding.accountPath.startsWith('organizations/')) orgRef = deps.db.doc(binding.accountPath)
    else if (typeof user.organizationId === 'string' && user.organizationId) orgRef = deps.db.collection('organizations').doc(user.organizationId)
    const orgSnapshot = orgRef ? await transaction.get(orgRef) : null
    const org = orgSnapshot?.exists ? orgSnapshot.data() || {} : null
    if (binding.accountPath.startsWith('organizations/') && (!org || org.ownerId !== binding.userId)) {
      return { state: 'ignored' as const, detail: 'organization owner changed' }
    }

    const decide = (data: Json) => {
      const existing = record(data.billing)
      const sameMode = existing.source === 'stripe' && existing.livemode === deps.config.livemode && existing.providerAccountId === deps.config.accountId
      const conflict = sameMode && typeof existing.subscriptionId === 'string' && existing.subscriptionId !== subscription.id &&
        HOLDING.includes(String(existing.status)) && HOLDING.includes(status)
      const stale = sameMode && existing.subscriptionId === subscription.id &&
        typeof existing.providerSyncedAtMs === 'number' && existing.providerSyncedAtMs > syncedAt
      return { conflict, stale, previousStatus: sameMode && existing.subscriptionId === subscription.id ? String(existing.status) : null }
    }

    const billing = {
      status,
      source: 'stripe',
      plan,
      subscriptionId: subscription.id,
      customerId: subscription.customer,
      priceId: item.price.id,
      livemode: subscription.livemode,
      providerAccountId: deps.config.accountId,
      billingInterval: price.interval,
      cancelAtPeriodEnd: subscription.cancel_at_period_end === true,
      catalogVersion: STRIPE_CATALOG_VERSION,
      currentPeriodStart: seconds(item.current_period_start),
      currentPeriodEnd: seconds(item.current_period_end),
      trialEnd: subscription.status === 'trialing' ? seconds(subscription.trial_end) : null,
      providerEventAt: Timestamp.fromMillis(event.created * 1000),
      providerSyncedAtMs: syncedAt,
      ...(attribution ? { marketingAttribution: attribution } : {}),
      updatedAt: Timestamp.fromMillis(syncedAt),
    }
    const trialUsage = subscription.trial_start ? { usedAt: Timestamp.fromMillis(subscription.trial_start * 1000), subscriptionId: subscription.id } : null
    const legacyCleanup = {
      membershipId: FieldValue.delete(),
      whopUserId: FieldValue.delete(),
      billingManageUrl: FieldValue.delete(),
    }

    const userDecision = decide(user)
    if (!userDecision.conflict && !userDecision.stale) {
      transaction.update(userRef, {
        plan,
        planLimits: PLAN_LIMITS[plan],
        subscriptionStatus: status,
        billing: { ...billing, ...(user.billing?.reviewGrant ? { reviewGrant: user.billing.reviewGrant } : {}) },
        ...(trialUsage && !user.billingTrial?.[mode] ? { [`billingTrial.${mode}`]: trialUsage } : {}),
        ...legacyCleanup,
        updatedAt: Timestamp.fromMillis(syncedAt),
      })
    }
    const orgDecision = org && orgRef && org.ownerId === binding.userId ? decide(org) : null
    if (orgRef && org && orgDecision && !orgDecision.conflict && !orgDecision.stale) {
      transaction.update(orgRef, {
        plan,
        planLimits: PLAN_LIMITS[plan],
        subscriptionStatus: status,
        billing,
        ...(trialUsage && !org.billingTrial?.[mode] ? { [`billingTrial.${mode}`]: trialUsage } : {}),
        ...legacyCleanup,
        whopMembershipId: FieldValue.delete(),
        updatedAt: Timestamp.fromMillis(syncedAt),
      })
    }
    const conflict = userDecision.conflict || Boolean(orgDecision?.conflict)
    if (conflict) console.error('Stripe subscription conflicts with another active subscription on the same account; not applied')

    const firstRecord = !eventExists
    if (firstRecord) {
      transaction.create(eventRef, billingEventBody(deps, event, {
        subscriptionId: subscription.id,
        customerId: subscription.customer,
        userId: binding.userId,
        organizationId: orgRef && org ? orgRef.id : null,
        status,
        plan: price.plan,
        interval: price.interval,
        catalogVersion: STRIPE_CATALOG_VERSION,
        conflict,
        stale: userDecision.stale && (!orgDecision || orgDecision.stale),
        ...(invoice ? {
          invoiceId: invoice.invoiceId,
          ...(invoice.amountPaid !== undefined ? { grossAmountMinor: invoice.amountPaid, currency: invoice.currency, billingReason: invoice.billingReason ?? null } : {}),
        } : {}),
        ...(attribution ? { marketingAttribution: attribution } : {}),
      }))
    }

    return {
      state: 'processed' as const,
      detail: conflict ? 'conflicting subscription not applied' : `subscription ${subscription.status}`,
      userId: binding.userId,
      subscription: { id: subscription.id, status, plan: price.plan, previousStatus: userDecision.previousStatus, firstRecord },
    }
  })
}

/**
 * A full refund of a subscription payment ends paid access immediately (CloneUGC rule): the subscription is
 * cancelled at Stripe so it cannot renew, and the entitlement follows the cancelled subscription. Partial
 * refunds are recorded only.
 */
async function applyRefund(deps: WebhookDeps, event: StripeEvent, object: Json): Promise<Outcome> {
  const chargeId = stripeId(object.id, 'ch') ?? stripeId(object.id, 'py')
  if (!chargeId) return { state: 'ignored', detail: 'no charge id' }
  const charge: StripeCharge = await deps.stripe.retrieveCharge(chargeId)
  assertLive(deps, charge)
  const customerId = stripeId(charge.customer, 'cus')
  const binding = customerId ? await customerBinding(deps, customerId) : null
  if (!binding) return { state: 'ignored', detail: 'refund for an unbound customer' }
  const full = charge.refunded === true || (charge.amount > 0 && charge.amount_refunded >= charge.amount)
  const paymentIntentId = stripeId(charge.payment_intent, 'pi')
  let subscriptionId: string | null = null
  if (paymentIntentId) {
    const payments = await deps.stripe.listInvoicePaymentsForPaymentIntent(paymentIntentId)
    const invoiceId = stripeId(payments.data.find(payment => payment.status === 'paid')?.invoice ?? payments.data[0]?.invoice, 'in')
    if (invoiceId) {
      const invoice = await deps.stripe.retrieveInvoice(invoiceId)
      assertLive(deps, invoice)
      subscriptionId = stripeId(invoice.parent?.subscription_details?.subscription, 'sub')
    }
  }
  if (full && subscriptionId) {
    const subscription = await deps.stripe.retrieveSubscription(subscriptionId)
    assertLive(deps, subscription)
    if (!['canceled', 'incomplete_expired'].includes(subscription.status)) {
      await deps.stripe.cancelSubscription(subscriptionId, `asc-refund-cancel-${charge.id}`)
    }
    const outcome = await reconcileSubscription(deps, event, subscriptionId)
    await deps.db.runTransaction(async transaction => {
      const ref = deps.db.collection('billingEvents').doc(event.id)
      if ((await transaction.get(ref)).exists) transaction.update(ref, { chargeId: charge.id, refundedAmountMinor: charge.amount_refunded, fullRefund: true })
    })
    return { ...outcome, detail: 'full refund: subscription cancelled and access removed', userId: binding.userId }
  }
  await recordBillingEvent(deps, event, {
    userId: binding.userId,
    chargeId: charge.id,
    subscriptionId,
    refundedAmountMinor: charge.amount_refunded,
    currency: charge.currency.toUpperCase(),
    fullRefund: full,
  })
  return { state: 'processed', detail: full ? 'refund recorded (no subscription)' : 'partial refund recorded', userId: binding.userId }
}
