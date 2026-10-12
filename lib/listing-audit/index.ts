import { reviewListingCopy } from './ai-review'
import { runListingChecks } from './checks'
import { fetchIosListing } from './fetch-ios'
import { fetchPlayListing } from './fetch-play'
import { targetKey } from './parse-url'
import type { ListingAuditReport, ListingSnapshot, StoreTarget } from './types'

export { parseStoreUrl } from './parse-url'
export type { ListingAuditReport } from './types'

export const AUDIT_CACHE_COLLECTION = 'publicListingAudits'
const CACHE_TTL_MS = 24 * 60 * 60 * 1000
const AI_DAILY_CAP = Number(process.env.LISTING_AUDIT_AI_DAILY_CAP ?? 300)

// Per-instance cap on AI reviews for anonymous traffic (cost guardrail, resets each UTC day).
let aiDay = ''
let aiCount = 0
function takeAiBudget(now: Date): boolean {
  const day = now.toISOString().slice(0, 10)
  if (day !== aiDay) {
    aiDay = day
    aiCount = 0
  }
  if (aiCount >= AI_DAILY_CAP) return false
  aiCount += 1
  return true
}

// Per-instance ceiling on fresh (uncached) audits, independent of client IP: the per-IP limit keys on
// X-Forwarded-For, which a client can influence, so this bounds outbound store traffic and AI cost regardless.
const FRESH_PER_MINUTE = Number(process.env.LISTING_AUDIT_FRESH_PER_MINUTE ?? 30)
const FRESH_PER_DAY = Number(process.env.LISTING_AUDIT_FRESH_PER_DAY ?? 400)
let freshMinute = 0
let freshMinuteCount = 0
let freshDay = ''
let freshDayCount = 0
export class AuditBusyError extends Error {}
function takeFreshBudget(now: Date): boolean {
  const minute = Math.floor(now.getTime() / 60_000)
  const day = now.toISOString().slice(0, 10)
  if (minute !== freshMinute) {
    freshMinute = minute
    freshMinuteCount = 0
  }
  if (day !== freshDay) {
    freshDay = day
    freshDayCount = 0
  }
  if (freshMinuteCount >= FRESH_PER_MINUTE || freshDayCount >= FRESH_PER_DAY) return false
  freshMinuteCount += 1
  freshDayCount += 1
  return true
}

export interface AuditCache {
  get(key: string): Promise<{ report: ListingAuditReport; createdAt: number } | null>
  set(key: string, report: ListingAuditReport): Promise<void>
}

export interface AuditDeps {
  cache?: AuditCache
  fetchImpl?: typeof fetch
  review?: (listing: ListingSnapshot) => Promise<ListingAuditReport['aiReview']>
  now?: () => Date
}

export class ListingNotFoundError extends Error {}

export function buildReport(listing: ListingSnapshot, aiReview: ListingAuditReport['aiReview'], now: Date): ListingAuditReport {
  const checks = runListingChecks(listing, now)
  return {
    version: 1,
    generatedAt: now.toISOString(),
    listing: {
      store: listing.store,
      id: listing.id,
      url: listing.url,
      title: listing.title,
      developer: listing.developer,
      iconUrl: listing.iconUrl,
      genre: listing.genre,
      rating: listing.rating,
      ratingCount: listing.ratingCount,
      lastUpdated: listing.lastUpdated,
    },
    score: checks.score,
    issues: checks.issues,
    strengths: checks.strengths,
    markets: listing.markets,
    notChecked: checks.notChecked,
    aiReview,
  }
}

/** Audits one public listing. Cached per app for 24 hours so repeat visits cost nothing. */
export async function runPublicListingAudit(target: StoreTarget, deps: AuditDeps = {}): Promise<{ report: ListingAuditReport; cached: boolean }> {
  const now = deps.now?.() ?? new Date()
  const key = targetKey(target)
  const hit = await deps.cache?.get(key).catch(() => null)
  if (hit && now.getTime() - hit.createdAt < CACHE_TTL_MS) return { report: hit.report, cached: true }

  if (!takeFreshBudget(now)) throw new AuditBusyError('Audit capacity reached')
  const listing = target.store === 'ios'
    ? await fetchIosListing(target.appId, target.country, deps.fetchImpl)
    : await fetchPlayListing(target.packageName, deps.fetchImpl)
  if (!listing) throw new ListingNotFoundError('Listing not found')

  const review = deps.review ?? reviewListingCopy
  const aiReview = takeAiBudget(now) ? await review(listing) : null
  const report = buildReport(listing, aiReview, now)
  await deps.cache?.set(key, report).catch(() => undefined)
  return { report, cached: false }
}
