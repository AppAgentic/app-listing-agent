import { createHmac, timingSafeEqual } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { Timestamp } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { RATE_LIMIT_CONFIGS, withRateLimit } from '@/lib/api/rate-limit'
import { conciergeLeadId, recordConciergeEvent } from '@/lib/concierge-server'

function validSignature(rawBody: string, signature: string | null): boolean {
  const secret = process.env.CONCIERGE_BOOKING_WEBHOOK_SECRET
  if (!secret || !signature) return false
  const received = signature.replace(/^sha256=/, '').trim().toLowerCase()
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex')
  const left = Buffer.from(received)
  const right = Buffer.from(expected)
  return left.length === right.length && timingSafeEqual(left, right)
}
function stringAt(value: unknown, path: string[]): string | null {
  let current = value
  for (const segment of path) {
    if (!current || typeof current !== 'object') return null
    current = (current as Record<string, unknown>)[segment]
  }
  return typeof current === 'string' && current.trim() ? current.trim() : null
}

function firstAttendeeEmail(value: unknown): string | null {
  const paths = [
    ['email'],
    ['attendee', 'email'],
    ['booking', 'attendee', 'email'],
    ['payload', 'email'],
    ['payload', 'attendee', 'email'],
  ]
  for (const path of paths) {
    const match = stringAt(value, path)
    if (match) return match.toLowerCase()
  }

  const containers = [
    value,
    value && typeof value === 'object' ? (value as Record<string, unknown>).payload : null,
    value && typeof value === 'object' ? (value as Record<string, unknown>).booking : null,
  ]
  for (const container of containers) {
    if (!container || typeof container !== 'object') continue
    const attendees = (container as Record<string, unknown>).attendees
    if (!Array.isArray(attendees)) continue
    for (const attendee of attendees) {
      const email = stringAt(attendee, ['email'])
      if (email) return email.toLowerCase()
    }
  }
  return null
}

function bookingStart(value: unknown): Date | null {
  const paths = [
    ['startTime'],
    ['start'],
    ['booking', 'startTime'],
    ['payload', 'startTime'],
    ['payload', 'start'],
  ]
  for (const path of paths) {
    const candidate = stringAt(value, path)
    if (!candidate) continue
    const parsed = new Date(candidate)
    if (!Number.isNaN(parsed.getTime())) return parsed
  }
  return null
}

export async function POST(request: NextRequest) {
  const rateLimit = await withRateLimit(request, RATE_LIMIT_CONFIGS.webhook)
  if (rateLimit.response) return rateLimit.response
  const rawBody = await request.text()
  const signature = request.headers.get('x-concierge-signature') || request.headers.get('x-webhook-signature')
  if (!validSignature(rawBody, signature)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  try {
    const payload = JSON.parse(rawBody) as unknown
    const email = firstAttendeeEmail(payload)
    if (!email) return NextResponse.json({ error: 'missing_attendee_email' }, { status: 400 })
    const leadId = conciergeLeadId(email)
    const leadRef = adminDb.collection('conciergeLeads').doc(leadId)
    const lead = await leadRef.get()
    if (!lead.exists) return NextResponse.json({ success: true, matched: false })

    const scheduledAt = bookingStart(payload)
    const now = Timestamp.now()
    await leadRef.update({
      status: 'booked',
      bookedAt: now,
      scheduledAt: scheduledAt ? Timestamp.fromDate(scheduledAt) : null,
      bookingProviderEvent: stringAt(payload, ['type']) || stringAt(payload, ['event']) || 'booking_webhook',
      updatedAt: now,
    })
    await recordConciergeEvent({
      name: 'booking_confirmed',
      leadId,
      source: 'booking_webhook',
      metadata: { scheduled: Boolean(scheduledAt) },
    })

    return NextResponse.json({ success: true, matched: true })
  } catch (error) {
    console.error('Concierge booking webhook failed:', error)
    return NextResponse.json({ error: 'invalid_payload' }, { status: 400 })
  }
}
