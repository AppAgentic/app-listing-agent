import { beforeEach, describe, expect, it, vi } from 'vitest'

// Ledger mechanics are plan-independent. The hard paywall removed free allowances, so these tests pin a
// small fixed allowance on the "free" row to keep exercising caps, retries and refunds.
vi.mock('@/lib/billing/catalog', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/billing/catalog')>()
  const free = { translations: 25, screenshots: 3, icons: 1, publishing: 5, apps: 1, teamMembers: 1 }
  return { ...actual, PLAN_LIMITS: { ...actual.PLAN_LIMITS, free }, BILLING_PLANS: { ...actual.BILLING_PLANS, free: { ...actual.BILLING_PLANS.free, limits: free } } }
})
import { adminDb } from '@/lib/firebase/admin'
import type { AccountContext } from '@/lib/org/context'
import { createFakeFirestore } from './helpers/fake-firestore'
import {
  refundUsage,
  normalizeOperationId,
  reserveUsage,
  settleUsage,
  withUsageReservation,
} from '@/lib/billing/ledger'

const fake = createFakeFirestore()
Object.assign(adminDb as object, fake.adminDb)

const context: AccountContext = {
  type: 'personal',
  userId: 'user-one',
  user: {
    email: 'customer@example.com',
    plan: 'free',
    planLimits: {
      translations: 25,
      screenshots: 3,
      icons: 1,
      publishing: 5,
      apps: 1,
      teamMembers: 1,
    },
    billing: {
      status: 'free',
      source: 'none',
      plan: 'free',
      updatedAt: {} as never,
    },
    organizationId: null,
    apiKey: 'test-key',
    createdAt: {} as never,
    updatedAt: {} as never,
  },
}

beforeEach(() => {
  fake.reset()
  fake.seed('users/user-one', context.user as unknown as Record<string, unknown>)
})

describe('atomic billing ledger', () => {
  it('serializes concurrent reservations so the hard cap cannot be exceeded', async () => {
    const reservations = await Promise.all([
      reserveUsage(context, { operationId: 'first', usageType: 'screenshots', units: 2 }),
      reserveUsage(context, { operationId: 'second', usageType: 'screenshots', units: 2 }),
    ])

    expect(reservations.filter(result => result.allowed)).toHaveLength(1)
    expect(reservations.filter(result => !result.allowed)).toHaveLength(1)
    const periodKey = reservations[0].periodKey
    expect(fake.read(`users/user-one/usage/${periodKey}`)?.screenshotsReserved).toBe(2)
  })

  it('deduplicates concurrent retries by operation ID', async () => {
    const reservations = await Promise.all([
      reserveUsage(context, { operationId: 'same-request', usageType: 'translations', units: 4 }),
      reserveUsage(context, { operationId: 'same-request', usageType: 'translations', units: 4 }),
    ])

    expect(reservations.filter(result => result.replayed)).toHaveLength(1)
    const periodKey = reservations[0].periodKey
    expect(fake.read(`users/user-one/usage/${periodKey}`)?.translationsReserved).toBe(4)
  })

  it('records an expiry so abandoned reservations can be reconciled', async () => {
    await reserveUsage(context, {
      operationId: 'long-running-job',
      usageType: 'screenshots',
      units: 1,
      ttlSeconds: 4 * 60 * 60,
    })

    const eventId = normalizeOperationId('screenshots', 'long-running-job')
    const event = fake.read(`users/user-one/usageEvents/${eventId}`)
    expect(event).toBeDefined()
    if (!event) throw new Error('Reservation event was not written')
    expect(event.expiresAt.toMillis()).toBeGreaterThan(event.createdAt.toMillis())
    expect(event.expiresAt.toMillis() - event.createdAt.toMillis()).toBe(4 * 60 * 60 * 1000)
  })

  it('settles partial usage exactly once', async () => {
    const reservation = await reserveUsage(context, {
      operationId: 'partial',
      usageType: 'translations',
      units: 5,
    })

    const first = await settleUsage(context, 'partial', 'translations', 3)
    const replay = await settleUsage(context, 'partial', 'translations', 3)

    expect(first).toEqual({ status: 'settled', settledUnits: 3, replayed: false })
    expect(replay).toEqual({ status: 'settled', settledUnits: 3, replayed: true })
    expect(fake.read(`users/user-one/usage/${reservation.periodKey}`)).toMatchObject({
      translationsReserved: 0,
      translationsUsed: 3,
    })
  })

  it('refunds failed provider work without leaving reserved credits', async () => {
    await expect(withUsageReservation(
      context,
      { operationId: 'provider-failure', usageType: 'translations', units: 2 },
      async () => { throw new Error('provider failed') }
    )).rejects.toThrow('provider failed')

    const retry = await reserveUsage(context, {
      operationId: 'replacement-request',
      usageType: 'translations',
      units: 25,
    })
    expect(retry.allowed).toBe(true)
  })

  it('reverses settled usage at most once', async () => {
    const reservation = await reserveUsage(context, {
      operationId: 'reversed',
      usageType: 'translations',
      units: 2,
    })
    await settleUsage(context, 'reversed', 'translations')

    expect(await refundUsage(context, 'reversed', 'translations')).toEqual({
      refundedUnits: 2,
      replayed: false,
    })
    expect(await refundUsage(context, 'reversed', 'translations')).toEqual({
      refundedUnits: 0,
      replayed: true,
    })
    expect(fake.read(`users/user-one/usage/${reservation.periodKey}`)?.translationsUsed).toBe(0)
  })
})
