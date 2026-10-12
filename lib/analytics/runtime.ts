import { applicationDefault, type Credential } from 'firebase-admin/app'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { adminApp, adminDb } from '@/lib/firebase/admin'
import type { CoreAction } from './events'
import { billingAnalyticsEmitter, type PriceLookup, type StripeFactEvent } from './billing-facts'
import {
  analyticsDeletionId,
  bigQueryQuery,
  processAnalyticsDeletions,
  type AnalyticsDeletionStore,
} from './deletion'
import {
  UID_PATTERN,
  analyticsConfig,
  bigQueryInsert,
  emissionDocId,
  logAnalyticsFailure,
  serverFactRow,
  type AnalyticsConfig,
  type EmissionLedger,
  type InsertRows,
} from './ingest'

/**
 * Production wiring for first-party analytics: Application Default Credentials for BigQuery and
 * Firestore for durable once-only markers and deletion jobs. Every exported helper is disabled by the
 * APPSTORECOPILOT_PRODUCT_ANALYTICS_ENABLED flag and never throws into product code.
 */

let credential: Credential | null = null
let cachedToken: { value: string; expiresAt: number } | null = null

export async function analyticsAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt - 60_000 > Date.now()) return cachedToken.value
  credential ??= adminApp?.options.credential ?? applicationDefault()
  const token = await credential.getAccessToken()
  cachedToken = { value: token.access_token, expiresAt: Date.now() + token.expires_in * 1000 }
  return token.access_token
}

let insert: { key: string; rows: InsertRows } | null = null
export function runtimeInsert(config: AnalyticsConfig): InsertRows {
  const key = `${config.projectId}.${config.dataset}.${config.table}`
  if (!insert || insert.key !== key) insert = { key, rows: bigQueryInsert(config, analyticsAccessToken) }
  return insert.rows
}

export function firestoreEmissionLedger(): EmissionLedger {
  return {
    async claim(key, now) {
      try {
        await adminDb.collection('analyticsEmissions').doc(emissionDocId(key)).create({
          createdAt: Timestamp.fromMillis(now),
          expiresAt: Timestamp.fromMillis(now + 400 * 86_400_000),
        })
        return true
      } catch (error) {
        const code = (error as { code?: unknown })?.code
        if (code === 6 || code === 'already-exists' || code === 'ALREADY_EXISTS') return false
        throw error
      }
    },
  }
}

function withTimeout<T>(work: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  return Promise.race([
    work,
    new Promise<T>(resolve => { timer = setTimeout(() => resolve(fallback), ms) }),
  ]).finally(() => clearTimeout(timer))
}

// Per-instance memo of core actions already claimed, so repeat calls skip Firestore entirely.
const recordedCoreActions = new Set<string>()

/**
 * Records `core_action` the first time an account performs `action` (durable once-only marker).
 * Awaited by callers because App Hosting throttles CPU after the response; bounded to ~3 s. Never throws.
 */
export async function recordCoreAction(userId: string | null | undefined, action: CoreAction): Promise<void> {
  try {
    const config = analyticsConfig()
    if (!config || typeof userId !== 'string' || !UID_PATTERN.test(userId)) return
    const key = `core_action:${action}:${userId}`
    if (recordedCoreActions.has(key)) return
    await withTimeout((async () => {
      try {
        const now = Date.now()
        const claimed = await firestoreEmissionLedger().claim(key, now)
        if (recordedCoreActions.size > 50_000) recordedCoreActions.clear()
        recordedCoreActions.add(key)
        if (!claimed) return
        await runtimeInsert(config)([{ insertId: emissionDocId(key), json: serverFactRow('core_action', userId, { action }, now) }])
      } catch (error) {
        logAnalyticsFailure('core_action', error)
      }
    })(), 3000, undefined)
  } catch (error) {
    logAnalyticsFailure('core_action', error)
  }
}

/**
 * Emits purchase / subscription_canceled / refund / trial_started after a verified Stripe webhook event was
 * processed. `userId` is the billed account owner. Never throws.
 */
export async function emitStripeBillingFact(event: StripeFactEvent, userId: string | null, prices: PriceLookup): Promise<void> {
  try {
    const config = analyticsConfig()
    if (!config) return
    await withTimeout(
      billingAnalyticsEmitter({ ledger: firestoreEmissionLedger(), insert: runtimeInsert(config), prices })(event, userId),
      4000,
      false,
    )
  } catch (error) {
    logAnalyticsFailure('billing', error)
  }
}

/** Top-level `analyticsDeletions/{sha256(uid)}`. The uid is kept only while the job is pending. */
export class FirestoreAnalyticsDeletionStore implements AnalyticsDeletionStore {
  private doc(id: string) {
    if (!/^[a-f0-9]{64}$/.test(id)) throw new Error('INVALID_DELETION_JOB')
    return adminDb.collection('analyticsDeletions').doc(id)
  }
  async enqueue(uid: string, now: number) {
    if (!UID_PATTERN.test(uid)) throw new Error('INVALID_UID')
    const ref = this.doc(analyticsDeletionId(uid))
    await adminDb.runTransaction(async transaction => {
      const old = (await transaction.get(ref)).data()
      transaction.set(ref, {
        state: 'pending',
        uid,
        requestedAt: old?.requestedAt ?? now,
        reopenedAt: old ? now : null,
        nextAttemptAt: now,
        attempts: old?.attempts ?? 0,
        updatedAt: now,
      })
    })
  }
  async due(now: number, limit: number) {
    // Done jobs have no nextAttemptAt, so this single-field range query needs no composite index.
    const rows = await adminDb.collection('analyticsDeletions').where('nextAttemptAt', '<=', now).orderBy('nextAttemptAt').limit(limit).get()
    return rows.docs.map(row => row.id)
  }
  async claim(id: string, now: number, leaseMs: number) {
    const ref = this.doc(id)
    return adminDb.runTransaction(async transaction => {
      const job = (await transaction.get(ref)).data()
      if (!job || job.state !== 'pending' || typeof job.uid !== 'string' || !(Number(job.nextAttemptAt) <= now)) return null
      const attempts = Number(job.attempts ?? 0) + 1
      transaction.update(ref, { nextAttemptAt: now + leaseMs, attempts, updatedAt: now })
      return { id, uid: job.uid as string, attempts }
    })
  }
  async complete(id: string, now: number, result: { deletedRows: number; visitors: number }) {
    await this.doc(id).update({
      state: 'done',
      uid: FieldValue.delete(),
      nextAttemptAt: FieldValue.delete(),
      lastError: FieldValue.delete(),
      doneAt: now,
      deletedRows: result.deletedRows,
      linkedVisitors: result.visitors,
      updatedAt: now,
    })
  }
  async retry(id: string, now: number, nextAttemptAt: number, code: string) {
    await this.doc(id).update({ nextAttemptAt, lastError: code, updatedAt: now })
  }
}

/**
 * Queues deletion of the account's analytics rows. Enqueued even when ingest is disabled, so rows written
 * while it was enabled are still removed later. Never throws.
 */
export async function enqueueAnalyticsDeletion(uid: string | null | undefined, now = Date.now()): Promise<boolean> {
  if (typeof uid !== 'string' || !uid) return false
  try {
    await new FirestoreAnalyticsDeletionStore().enqueue(uid, now)
    return true
  } catch (error) {
    logAnalyticsFailure('deletion_enqueue', error)
    return false
  }
}

/** Scheduler hook (POST /api/analytics/maintenance). Disabled with the analytics flag. Never throws. */
export async function runAnalyticsMaintenance(now: () => number = Date.now) {
  const config = analyticsConfig()
  if (!config) return { enabled: false }
  try {
    const deletions = await processAnalyticsDeletions({
      store: new FirestoreAnalyticsDeletionStore(),
      query: bigQueryQuery(config, analyticsAccessToken),
      config,
      now,
    })
    return { enabled: true, deletions }
  } catch (error) {
    logAnalyticsFailure('maintenance', error)
    return { enabled: true, error: 'ANALYTICS_MAINTENANCE_FAILED' }
  }
}
