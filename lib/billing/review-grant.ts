import type { ReviewGrant } from '@/lib/firebase/firestore'

export const REVIEW_LIMITS = Object.freeze({ icons: 10, screenshots: 30, translations: 150 })

export function reviewPeriod(now: Date) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
  return { id: 'review-' + start.toISOString().slice(0, 7), start, end }
}

function millis(value: unknown): number {
  try {
    if (value instanceof Date) return value.getTime()
    if (value && typeof (value as { toMillis?: unknown }).toMillis === 'function') {
      const result = (value as { toMillis(): unknown }).toMillis()
      return typeof result === 'number' ? result : NaN
    }
  } catch { /* Invalid stored grant fails closed. */ }
  return NaN
}

/** Quota grant values are untrusted until fully validated, even from a typed record. */
export function validReviewGrant(value: unknown, accountId: string, now = new Date()): ReviewGrant | null {
  if (!value || typeof value !== 'object' || !accountId || !Number.isFinite(now.getTime())) return null
  const grant = value as ReviewGrant
  const fields = ['source', 'id', 'accountId', 'startsAt', 'expiresAt', 'revokedAt', 'limits']
  if (Object.keys(grant).some(key => !fields.includes(key))) return null
  if (grant.source !== 'review' || grant.accountId !== accountId || grant.revokedAt != null) return null
  const period = reviewPeriod(now)
  const startsAt = millis(grant.startsAt)
  const expiresAt = millis(grant.expiresAt)
  if (grant.id !== period.id || !Number.isFinite(startsAt) || !Number.isFinite(expiresAt)
    || startsAt < period.start.getTime() || startsAt > now.getTime()
    || expiresAt !== period.end.getTime() || now.getTime() >= expiresAt) return null
  if (!grant.limits || typeof grant.limits !== 'object'
    || Object.keys(grant.limits).length !== 3
    || Object.entries(REVIEW_LIMITS).some(([key, cap]) => grant.limits[key as keyof typeof REVIEW_LIMITS] !== cap)) return null
  return grant
}
