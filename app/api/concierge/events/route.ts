import { timingSafeEqual } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { adminDb } from '@/lib/firebase/admin'
import { RATE_LIMIT_CONFIGS, withRateLimit } from '@/lib/api/rate-limit'
import { conciergeEventNames } from '@/lib/concierge'
import { hashLeadTrackingToken, recordConciergeEvent } from '@/lib/concierge-server'

const eventSchema = z.object({
  name: z.enum(conciergeEventNames),
  leadId: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  trackingToken: z.string().min(20).max(100).optional(),
  sessionId: z.string().uuid().optional(),
  source: z.string().trim().max(100).optional(),
  metadata: z.record(z.union([z.string().max(200), z.number(), z.boolean(), z.null()])).optional(),
})

function hashesMatch(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer)
}
export async function POST(request: NextRequest) {
  const rateLimit = await withRateLimit(request, RATE_LIMIT_CONFIGS.default)
  if (rateLimit.response) return rateLimit.response

  try {
    const event = eventSchema.parse(await request.json())
    if (event.leadId) {
      if (!event.trackingToken) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
      const lead = await adminDb.collection('conciergeLeads').doc(event.leadId).get()
      const expected = lead.data()?.trackingTokenHash
      if (typeof expected !== 'string' || !hashesMatch(expected, hashLeadTrackingToken(event.trackingToken))) {
        return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
      }
    }

    await recordConciergeEvent(event)
    return NextResponse.json({ success: true })
  } catch (error) {
    if (error && typeof error === 'object' && 'issues' in error) {
      return NextResponse.json({ error: 'validation_error' }, { status: 400 })
    }
    console.error('Concierge event failed:', error)
    return NextResponse.json({ error: 'server_error' }, { status: 500 })
  }
}
