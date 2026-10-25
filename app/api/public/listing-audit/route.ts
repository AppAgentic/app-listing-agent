import { readBoundedJson } from '@/lib/api/bounded-body'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { Timestamp } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withRateLimit } from '@/lib/api/rate-limit'
import {
  AUDIT_CACHE_COLLECTION,
  AuditBusyError,
  ListingNotFoundError,
  parseStoreUrl,
  runPublicListingAudit,
  type AuditCache,
  type ListingAuditReport,
} from '@/lib/listing-audit'
import { appOrigin } from '@/lib/routing/app-url'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const bodySchema = z.object({ url: z.string().trim().min(1).max(500) })

const firestoreCache: AuditCache = {
  async get(key) {
    const snapshot = await adminDb.collection(AUDIT_CACHE_COLLECTION).doc(key).get()
    if (!snapshot.exists) return null
    const data = snapshot.data() as { report?: ListingAuditReport; createdAt?: Timestamp }
    if (!data.report || !data.createdAt) return null
    return { report: data.report, createdAt: data.createdAt.toMillis() }
  },
  async set(key, report) {
    await adminDb.collection(AUDIT_CACHE_COLLECTION).doc(key).set({ report, createdAt: Timestamp.now() })
  },
}

function allowedOrigins(): Set<string> {
  const origins = new Set(['https://applistingagent.com', 'https://www.applistingagent.com'])
  origins.add(appOrigin())
  return origins
}

/** Free public listing audit (no login). Only public store data; the pasted URL itself is never fetched. */
export async function POST(request: NextRequest) {
  const rateLimit = await withRateLimit(request, { windowMs: 60 * 60 * 1000, maxRequests: 12 }, undefined, 'listing-audit')
  if (rateLimit.response) return rateLimit.response

  // Only our own page may call this: JSON only (forces a CORS preflight) and a matching Origin when one is sent.
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    return NextResponse.json({ error: 'invalid_request', message: 'Paste an App Store or Google Play link.' }, { status: 415 })
  }
  const origin = request.headers.get('origin')
  if (origin && !allowedOrigins().has(origin)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  let url: string
  try {
    url = bodySchema.parse(await readBoundedJson(request)).url
  } catch {
    return NextResponse.json({ error: 'invalid_request', message: 'Paste an App Store or Google Play link.' }, { status: 400 })
  }

  const target = parseStoreUrl(url)
  if (!target) {
    return NextResponse.json(
      { error: 'unsupported_url', message: 'That doesn’t look like an App Store (apps.apple.com) or Google Play (play.google.com) app link.' },
      { status: 400 },
    )
  }

  try {
    const { report, cached } = await runPublicListingAudit(target, { cache: firestoreCache })
    return NextResponse.json({ report, cached })
  } catch (error) {
    if (error instanceof AuditBusyError) {
      return NextResponse.json({ error: 'busy', message: 'Lots of audits running right now. Please try again in a minute.' }, { status: 429, headers: { 'Retry-After': '60' } })
    }
    if (error instanceof ListingNotFoundError) {
      return NextResponse.json({ error: 'not_found', message: 'We couldn’t find that app on the store. Check the link and try again.' }, { status: 404 })
    }
    console.error('listing_audit_failed', error instanceof Error ? error.message : 'unknown')
    return NextResponse.json({ error: 'audit_failed', message: 'The store didn’t respond. Please try again in a minute.' }, { status: 502 })
  }
}
