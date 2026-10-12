import crypto from 'crypto'
import { FieldValue, Timestamp, type DocumentReference } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import type { AccountContext } from '@/lib/org/context'
import {
  getBillingPeriod,
  getEffectivePlan,
  getEffectivePlanLimits,
} from './entitlements'
import type { MeteredUsageType, PlanLimits, UserPlan } from './catalog'
import { recordCoreAction } from '@/lib/analytics/runtime'
import type { CoreAction } from '@/lib/analytics/events'

export type UsageEventStatus = 'reserved' | 'settled' | 'refunded'

export interface UsageReservationRequest {
  operationId: string
  usageType: MeteredUsageType
  units: number
  ttlSeconds?: number
  metadata?: Record<string, string | number | boolean | null>
}

export interface UsageReservationResult {
  allowed: boolean
  operationId: string
  usageType: MeteredUsageType
  reservedUnits: number
  usedUnits: number
  remaining: number
  limit: number
  plan: UserPlan
  periodKey: string
  requiresUpgrade: boolean
  replayed: boolean
  reason?: 'upgrade_required' | 'limit_reached'
}

interface UsageEventDocument {
  operationId: string
  usageType: MeteredUsageType
  status: UsageEventStatus
  periodKey: string
  plan: UserPlan
  reservedUnits: number
  settledUnits: number
  userId: string
  metadata?: Record<string, string | number | boolean | null>
  createdAt: Timestamp
  updatedAt: Timestamp
  expiresAt: Timestamp
}

interface UsageSummaryDocument {
  periodKey?: string
  plan?: UserPlan
  periodStartsAt?: Timestamp
  periodEndsAt?: Timestamp
  translationsUsed?: number
  translationsReserved?: number
  screenshotsUsed?: number
  screenshotsReserved?: number
  iconsUsed?: number
  iconsReserved?: number
  publishingUsed?: number
  publishingReserved?: number
  appsUsed?: number
  appsReserved?: number
}

export class UsageLimitError extends Error {
  readonly result: UsageReservationResult

  constructor(result: UsageReservationResult) {
    super(result.reason === 'upgrade_required'
      ? `Upgrade required for ${result.usageType}`
      : `Monthly ${result.usageType} limit reached`)
    this.name = 'UsageLimitError'
    this.result = result
  }
}

export function normalizeOperationId(namespace: string, operationId?: string): string {
  const source = `${namespace}:${operationId || crypto.randomUUID()}`
  return crypto.createHash('sha256').update(source).digest('hex')
}

function usageField(usageType: MeteredUsageType, suffix: 'Used' | 'Reserved'): string {
  return `${usageType}${suffix}`
}

function value(data: UsageSummaryDocument | undefined, field: string): number {
  const raw = data?.[field as keyof UsageSummaryDocument]
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : 0
}

function accountRoot(context: AccountContext): DocumentReference {
  if (context.type === 'organization' && context.orgId) {
    return adminDb.collection('organizations').doc(context.orgId)
  }
  return adminDb.collection('users').doc(context.userId)
}

function withFreshAccount(
  context: AccountContext,
  accountData: Record<string, unknown>
): AccountContext {
  if (context.type === 'organization') {
    return { ...context, organization: accountData as unknown as NonNullable<AccountContext['organization']> }
  }
  return { ...context, user: accountData as unknown as AccountContext['user'] }
}

function validateUnits(units: number): void {
  if (!Number.isSafeInteger(units) || units <= 0) {
    throw new Error('Usage units must be a positive safe integer')
  }
}

function reservationTtlSeconds(value: number | undefined): number {
  const ttlSeconds = value ?? 30 * 60
  if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds < 60 || ttlSeconds > 24 * 60 * 60) {
    throw new Error('Usage reservation TTL must be between 60 seconds and 24 hours')
  }
  return ttlSeconds
}

function limitFor(limits: PlanLimits, usageType: MeteredUsageType): number {
  return limits[usageType]
}

export async function reserveUsage(
  context: AccountContext,
  request: UsageReservationRequest
): Promise<UsageReservationResult> {
  validateUnits(request.units)
  const rootRef = accountRoot(context)
  const eventId = normalizeOperationId(request.usageType, request.operationId)
  const eventRef = rootRef.collection('usageEvents').doc(eventId)

  return adminDb.runTransaction(async transaction => {
    const [accountSnapshot, eventSnapshot] = await Promise.all([
      transaction.get(rootRef),
      transaction.get(eventRef),
    ])

    if (!accountSnapshot.exists) {
      throw new Error('Billing account not found')
    }

    if (eventSnapshot.exists) {
      const event = eventSnapshot.data() as UsageEventDocument
      const summaryRef = rootRef.collection('usage').doc(event.periodKey)
      const summarySnapshot = await transaction.get(summaryRef)
      const summary = summarySnapshot.data() as UsageSummaryDocument | undefined
      const usedUnits = value(summary, usageField(event.usageType, 'Used'))
      const reservedUnits = value(summary, usageField(event.usageType, 'Reserved'))
      const freshContext = withFreshAccount(context, accountSnapshot.data() || {})
      const limit = limitFor(getEffectivePlanLimits(freshContext), event.usageType)
      return {
        allowed: true,
        operationId: event.operationId,
        usageType: event.usageType,
        reservedUnits: event.reservedUnits,
        usedUnits,
        remaining: limit === -1 ? -1 : Math.max(0, limit - usedUnits - reservedUnits),
        limit,
        plan: event.plan,
        periodKey: event.periodKey,
        requiresUpgrade: false,
        replayed: true,
      }
    }

    const freshContext = withFreshAccount(context, accountSnapshot.data() || {})
    const evaluatedAt = new Date()
    const plan = getEffectivePlan(freshContext)
    const limits = getEffectivePlanLimits(freshContext, evaluatedAt)
    const period = getBillingPeriod(freshContext, evaluatedAt)
    const limit = limitFor(limits, request.usageType)
    const summaryRef = rootRef.collection('usage').doc(period.key)
    const summarySnapshot = await transaction.get(summaryRef)
    const summary = summarySnapshot.data() as UsageSummaryDocument | undefined
    const usedUnits = value(summary, usageField(request.usageType, 'Used'))
    const reservedUnits = value(summary, usageField(request.usageType, 'Reserved'))
    const remaining = limit === -1 ? -1 : Math.max(0, limit - usedUnits - reservedUnits)

    if (limit !== -1 && request.units > remaining) {
      return {
        allowed: false,
        operationId: request.operationId,
        usageType: request.usageType,
        reservedUnits: 0,
        usedUnits,
        remaining,
        limit,
        plan,
        periodKey: period.key,
        requiresUpgrade: plan === 'free',
        replayed: false,
        reason: plan === 'free' ? 'upgrade_required' : 'limit_reached',
      }
    }

    const now = Timestamp.now()
    const expiresAt = Timestamp.fromMillis(
      now.toMillis() + reservationTtlSeconds(request.ttlSeconds) * 1000
    )
    const event: UsageEventDocument = {
      operationId: request.operationId,
      usageType: request.usageType,
      status: 'reserved',
      periodKey: period.key,
      plan,
      reservedUnits: request.units,
      settledUnits: 0,
      userId: context.userId,
      ...(request.metadata ? { metadata: request.metadata } : {}),
      createdAt: now,
      updatedAt: now,
      expiresAt,
    }

    transaction.create(eventRef, event)
    transaction.set(summaryRef, {
      periodKey: period.key,
      plan,
      periodStartsAt: Timestamp.fromDate(period.startsAt),
      periodEndsAt: Timestamp.fromDate(period.endsAt),
      [usageField(request.usageType, 'Reserved')]: FieldValue.increment(request.units),
      updatedAt: now,
    }, { merge: true })

    return {
      allowed: true,
      operationId: request.operationId,
      usageType: request.usageType,
      reservedUnits: request.units,
      usedUnits,
      remaining: limit === -1 ? -1 : remaining - request.units,
      limit,
      plan,
      periodKey: period.key,
      requiresUpgrade: false,
      replayed: false,
    }
  })
}

const USAGE_CORE_ACTIONS: Record<MeteredUsageType, CoreAction> = {
  apps: 'app_added',
  publishing: 'store_published',
  screenshots: 'screenshots_generated',
  icons: 'icons_generated',
  translations: 'translations_used',
}

export async function settleUsage(
  context: AccountContext,
  operationId: string,
  usageType: MeteredUsageType,
  settledUnits?: number
): Promise<{ status: UsageEventStatus; settledUnits: number; replayed: boolean }> {
  const rootRef = accountRoot(context)
  const eventRef = rootRef.collection('usageEvents').doc(normalizeOperationId(usageType, operationId))

  const settled = await adminDb.runTransaction(async transaction => {
    const eventSnapshot = await transaction.get(eventRef)
    if (!eventSnapshot.exists) throw new Error('Usage reservation not found')
    const event = eventSnapshot.data() as UsageEventDocument

    if (event.status !== 'reserved') {
      return { status: event.status, settledUnits: event.settledUnits, replayed: true }
    }

    const actualUnits = settledUnits ?? event.reservedUnits
    if (!Number.isSafeInteger(actualUnits) || actualUnits < 0 || actualUnits > event.reservedUnits) {
      throw new Error('Settled usage must be between zero and the reserved amount')
    }

    const summaryRef = rootRef.collection('usage').doc(event.periodKey)
    const now = Timestamp.now()
    const status: UsageEventStatus = actualUnits === 0 ? 'refunded' : 'settled'
    transaction.update(eventRef, {
      status,
      settledUnits: actualUnits,
      updatedAt: now,
      ...(status === 'settled' ? { settledAt: now } : { refundedAt: now }),
    })
    transaction.set(summaryRef, {
      [usageField(usageType, 'Reserved')]: FieldValue.increment(-event.reservedUnits),
      ...(actualUnits > 0
        ? { [usageField(usageType, 'Used')]: FieldValue.increment(actualUnits) }
        : {}),
      updatedAt: now,
    }, { merge: true })

    return { status, settledUnits: actualUnits, replayed: false }
  })
  // First-party analytics: first settled use of each meter per account. Never throws.
  if (!settled.replayed && settled.status === 'settled') {
    await recordCoreAction(context.userId, USAGE_CORE_ACTIONS[usageType])
  }
  return settled
}

export async function refundUsage(
  context: AccountContext,
  operationId: string,
  usageType: MeteredUsageType
): Promise<{ refundedUnits: number; replayed: boolean }> {
  const rootRef = accountRoot(context)
  const eventRef = rootRef.collection('usageEvents').doc(normalizeOperationId(usageType, operationId))

  return adminDb.runTransaction(async transaction => {
    const eventSnapshot = await transaction.get(eventRef)
    if (!eventSnapshot.exists) return { refundedUnits: 0, replayed: true }
    const event = eventSnapshot.data() as UsageEventDocument
    if (event.status === 'refunded') return { refundedUnits: 0, replayed: true }

    const summaryRef = rootRef.collection('usage').doc(event.periodKey)
    const now = Timestamp.now()
    const refundedUnits = event.status === 'reserved' ? event.reservedUnits : event.settledUnits
    transaction.update(eventRef, {
      status: 'refunded',
      updatedAt: now,
      refundedAt: now,
    })
    transaction.set(summaryRef, {
      [usageField(usageType, event.status === 'reserved' ? 'Reserved' : 'Used')]: FieldValue.increment(-refundedUnits),
      updatedAt: now,
    }, { merge: true })
    return { refundedUnits, replayed: false }
  })
}

export async function withUsageReservation<T>(
  context: AccountContext,
  request: UsageReservationRequest,
  work: () => Promise<T>,
  settledUnits: (result: T) => number = () => request.units
): Promise<T> {
  const reservation = await reserveUsage(context, request)
  if (!reservation.allowed) throw new UsageLimitError(reservation)

  // A replay of a settled operation must not run a provider call again.
  if (reservation.replayed) {
    throw new Error('Usage operation has already been processed')
  }

  let result: T
  try {
    result = await work()
  } catch (error) {
    await refundUsage(context, request.operationId, request.usageType)
    throw error
  }

  // Provider work has completed. Settlement failures must leave the reservation
  // outstanding for reconciliation; refunding here would grant a free external
  // mutation and make a retry capable of repeating it.
  await settleUsage(context, request.operationId, request.usageType, settledUnits(result))
  return result
}

export async function readUsage(
  context: AccountContext,
  usageType: MeteredUsageType
): Promise<{ used: number; reserved: number; limit: number; remaining: number; plan: UserPlan; periodKey: string }> {
  const rootRef = accountRoot(context)
  const accountSnapshot = await rootRef.get()
  if (!accountSnapshot.exists) throw new Error('Billing account not found')
  const freshContext = withFreshAccount(context, accountSnapshot.data() || {})
  const evaluatedAt = new Date()
  const plan = getEffectivePlan(freshContext)
  const limit = limitFor(getEffectivePlanLimits(freshContext, evaluatedAt), usageType)
  const period = getBillingPeriod(freshContext, evaluatedAt)
  const summarySnapshot = await rootRef.collection('usage').doc(period.key).get()
  const summary = summarySnapshot.data() as UsageSummaryDocument | undefined
  const used = value(summary, usageField(usageType, 'Used'))
  const reserved = value(summary, usageField(usageType, 'Reserved'))
  return {
    used,
    reserved,
    limit,
    remaining: limit === -1 ? -1 : Math.max(0, limit - used - reserved),
    plan,
    periodKey: period.key,
  }
}
