import { standardInterval } from './events'
import {
  emissionDocId,
  logAnalyticsFailure,
  serverFactRow,
  type EmissionLedger,
  type Env,
  type InsertRows,
} from './ingest'

/**
 * Server-side billing facts derived from verified, successfully processed Stripe webhook events
 * (standard mapping). Keys are business identities (invoice, subscription + cancel time, charge +
 * refunded amount), not webhook event ids, so replays, retries and sibling events emit at most once.
 * No email, card or Stripe customer data is recorded.
 */
export interface StripeFactEvent {
  id: string
  type: string
  created: number
  data: { object: unknown; previous_attributes?: unknown }
}

export interface BillingFact {
  key: string
  event: 'purchase' | 'subscription_canceled' | 'refund' | 'trial_started'
  props: Record<string, string | number | boolean>
  at: number
}

/** Price id → plan/interval from the configured Stripe catalog (never from metadata). */
export type PriceLookup = (priceId: unknown) => { plan: string; interval: string } | null

type Json = Record<string, unknown>
const record = (value: unknown): Json => (value && typeof value === 'object' && !Array.isArray(value) ? value as Json : {})
const idOf = (value: unknown, prefix: string) =>
  typeof value === 'string' && new RegExp(`^${prefix}_[A-Za-z0-9_]{6,120}$`).test(value) ? value : null
const currencyOf = (value: unknown) => {
  const currency = typeof value === 'string' ? value.toLowerCase() : ''
  return /^[a-z]{3}$/.test(currency) ? currency : null
}
/** Stripe amounts are already integer minor units. */
const minor = (value: unknown) => (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null)
const BILLING_REASONS = ['subscription_create', 'subscription_cycle', 'subscription_update', 'manual', 'subscription']

function subscriptionPlan(object: Json, prices: PriceLookup) {
  const items = Array.isArray(record(object.items).data) ? record(object.items).data as unknown[] : []
  return prices(record(record(items[0]).price).id)
}

export function stripeBillingFact(event: StripeFactEvent, prices: PriceLookup): BillingFact | null {
  const object = record(event.data?.object)
  const at = Number.isSafeInteger(event.created) ? event.created * 1000 : Date.now()
  switch (event.type) {
    case 'invoice.paid': {
      const id = idOf(object.id, 'in')
      const currency = currencyOf(object.currency)
      const value = minor(object.amount_paid)
      // A $0 invoice (the trial start) is not revenue; trial_started covers it.
      if (!id || object.status !== 'paid' || !currency || !value) return null
      const lines = Array.isArray(record(object.lines).data) ? record(object.lines).data as unknown[] : []
      const offer = lines
        .map(line => prices(record(record(record(line).pricing).price_details).price) ?? prices(record(record(line).price).id))
        .find(Boolean)
      const interval = standardInterval(offer?.interval)
      const reason = typeof object.billing_reason === 'string' && BILLING_REASONS.includes(object.billing_reason) ? object.billing_reason : 'other'
      return {
        key: `purchase:invoice:${id}`,
        event: 'purchase',
        at,
        props: {
          kind: 'subscription',
          ...(offer ? { plan: offer.plan } : {}),
          ...(interval ? { interval } : {}),
          billing_reason: reason,
          value_minor: value,
          currency,
        },
      }
    }
    case 'customer.subscription.created': {
      const id = idOf(object.id, 'sub')
      if (!id || object.status !== 'trialing' || !Number.isSafeInteger(object.trial_start) || !Number.isSafeInteger(object.trial_end)) return null
      const offer = subscriptionPlan(object, prices)
      const interval = standardInterval(offer?.interval)
      const trialDays = Math.round(((object.trial_end as number) - (object.trial_start as number)) / 86_400)
      return {
        key: `trial_started:${id}`,
        event: 'trial_started',
        at,
        props: {
          ...(offer ? { plan: offer.plan } : {}),
          ...(interval ? { interval } : {}),
          trial_days: trialDays,
        },
      }
    }
    case 'customer.subscription.updated': {
      const id = idOf(object.id, 'sub')
      const previous = record(event.data?.previous_attributes)
      const requested = object.cancel_at_period_end === true && previous.cancel_at_period_end === false
      if (!id || !requested) return null
      const cancelAt = Number.isSafeInteger(object.cancel_at) ? object.cancel_at : event.id
      return {
        key: `subscription_canceled:requested:${id}:${cancelAt}`,
        event: 'subscription_canceled',
        at,
        props: { phase: 'requested', ...(object.status === 'trialing' ? { during_trial: true } : {}) },
      }
    }
    case 'customer.subscription.deleted': {
      const id = idOf(object.id, 'sub')
      if (!id) return null
      return { key: `subscription_canceled:ended:${id}`, event: 'subscription_canceled', at, props: { phase: 'ended' } }
    }
    case 'charge.refunded': {
      const id = idOf(object.id, '(?:ch|py)')
      const currency = currencyOf(object.currency)
      const value = minor(object.amount_refunded)
      if (!id || !currency || !value) return null
      return { key: `refund:${id}:${value}`, event: 'refund', at, props: { value_minor: value, currency } }
    }
    default:
      return null
  }
}

export interface BillingEmitterDeps {
  ledger: EmissionLedger
  insert: InsertRows
  prices: PriceLookup
  env?: Env
  now?: () => number
}

/** Called after the inbox marks the Stripe event processed. Never throws; bounded by the insert timeout. */
export function billingAnalyticsEmitter(deps: BillingEmitterDeps) {
  return async (event: StripeFactEvent, userId: string | null): Promise<boolean> => {
    try {
      const fact = stripeBillingFact(event, deps.prices)
      if (!fact) return false
      if (!(await deps.ledger.claim(fact.key, (deps.now ?? Date.now)()))) return false
      await deps.insert([{
        insertId: emissionDocId(fact.key),
        json: serverFactRow(fact.event, userId, fact.props, fact.at, deps.env),
      }])
      return true
    } catch (error) {
      logAnalyticsFailure('billing', error)
      return false
    }
  }
}
