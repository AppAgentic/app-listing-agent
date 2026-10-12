import { NextRequest, NextResponse } from 'next/server'
import { Timestamp } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { RATE_LIMIT_CONFIGS, withRateLimit } from '@/lib/api/rate-limit'
import { conciergeLeadSchema, nextLeadStatus, nextWaitlistStatus, qualifyConciergeLead } from '@/lib/concierge'
import {
  conciergeLeadId,
  createLeadTrackingToken,
  normalizeLeadEmail,
  recordConciergeEvent,
} from '@/lib/concierge-server'

function configuredBookingUrl(): string | null {
  const value = process.env.CONCIERGE_BOOKING_URL?.trim()
  if (!value) return null
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'https:' ? parsed.toString() : null
  } catch {
    return null
  }
}

export async function POST(request: NextRequest) {
  const rateLimit = await withRateLimit(request, RATE_LIMIT_CONFIGS.auth)
  if (rateLimit.response) return rateLimit.response

  try {
    const input = conciergeLeadSchema.parse(await request.json())
    const email = normalizeLeadEmail(input.email)
    const id = conciergeLeadId(email)
    const leadRef = adminDb.collection('conciergeLeads').doc(id)
    const waitlistRef = adminDb.collection('waitlist').doc(id)
    const [existing, existingWaitlist] = await Promise.all([leadRef.get(), waitlistRef.get()])
    const existingData = existing.exists ? existing.data() : null
    const existingWaitlistData = existingWaitlist.exists ? existingWaitlist.data() : null
    const qualification = qualifyConciergeLead(input)
    const now = Timestamp.now()
    const tracking = createLeadTrackingToken()
    const disposition = qualification.qualified ? 'qualified' : 'waitlisted'
    const status = nextLeadStatus(existingData?.status, disposition)
    const waitlistStatus = nextWaitlistStatus(existingWaitlistData?.status, status)

    await Promise.all([
      leadRef.set({
        ...input,
        email,
        status,
        qualificationScore: qualification.score,
        qualificationReasons: qualification.reasons,
        trackingTokenHash: tracking.hash,
        createdAt: existingData?.createdAt || now,
        updatedAt: now,
        applicationCount: Number(existingData?.applicationCount || 0) + 1,
      }, { merge: true }),
      waitlistRef.set({
        email,
        customerType: input.customerType,
        appCount: input.appCount,
        referralSource: input.source,
        status: waitlistStatus,
        conciergeLeadId: id,
        qualificationScore: qualification.score,
        createdAt: existingData?.createdAt || now,
        updatedAt: now,
        notifiedAt: null,
        convertedAt: null,
      }, { merge: true }),
      recordConciergeEvent({
        name: 'application_submitted',
        leadId: id,
        source: input.source,
        metadata: { qualified: qualification.qualified, score: qualification.score },
      }),
    ])

    return NextResponse.json({
      success: true,
      leadId: id,
      trackingToken: tracking.token,
      disposition,
      bookingUrl: qualification.qualified ? configuredBookingUrl() : null,
    })
  } catch (error) {
    if (error && typeof error === 'object' && 'issues' in error) {
      return NextResponse.json({ error: 'validation_error' }, { status: 400 })
    }
    console.error('Concierge lead submission failed:', error)
    return NextResponse.json({ error: 'server_error' }, { status: 500 })
  }
}
