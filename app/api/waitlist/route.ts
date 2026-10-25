import { readBoundedJson, RequestBodyLimitError } from '@/lib/api/bounded-body'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { adminDb } from '@/lib/firebase/admin'
import { Timestamp } from 'firebase-admin/firestore'
import { createHash } from 'crypto'
import { RATE_LIMIT_CONFIGS, withRateLimit } from '@/lib/api/rate-limit'

const waitlistSchema = z.object({
  email: z.string().email(),
  customerType: z.enum([
    'indie_developer',
    'app_studio',
    'enterprise',
    'agency',
    'other'
  ]),
  appCount: z.enum(['1-3', '4-10', '11-50', '50+']).optional(),
  referralSource: z.string().trim().max(200).optional(),
})

export async function POST(request: NextRequest) {
  const rateLimit = await withRateLimit(request, RATE_LIMIT_CONFIGS.auth)
  if (rateLimit.response) return rateLimit.response

  try {
    const body = await readBoundedJson(request, 64 * 1024)
    const data = waitlistSchema.parse(body)
    const email = data.email.trim().toLowerCase()
    const waitlistId = createHash('sha256').update(email).digest('hex')
    const docRef = adminDb.collection('waitlist').doc(waitlistId)

    // A deterministic, non-PII document ID makes concurrent submissions
    // idempotent without exposing the email address in Firestore paths.
    const [existing, legacyMatch] = await Promise.all([
      docRef.get(),
      adminDb.collection('waitlist').where('email', '==', email).limit(1).get(),
    ])
    if (existing.exists || !legacyMatch.empty) {
      return NextResponse.json(
        { success: true, message: "Thanks — we'll be in touch when access is available." },
        { status: 200 }
      )
    }

    await docRef.create({
      email,
      customerType: data.customerType,
      appCount: data.appCount || null,
      referralSource: data.referralSource || null,
      status: 'pending',
      createdAt: Timestamp.now(),
      notifiedAt: null,
      convertedAt: null,
    })

    return NextResponse.json({
      success: true,
      message: "You're on the list! We'll notify you when we launch.",
      position: (await adminDb.collection('waitlist').count().get()).data().count
    })
  } catch (error) {
    if (error instanceof RequestBodyLimitError) return Response.json({ error: error.message }, { status: 413 })
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'validation_error', details: error.issues },
        { status: 400 }
      )
    }

    if (
      typeof error === 'object' && error !== null &&
      ('code' in error && (error.code === 6 || error.code === 'already-exists'))
    ) {
      return NextResponse.json({
        success: true,
        message: "Thanks — we'll be in touch when access is available."
      })
    }

    console.error('Waitlist error:', error)
    return NextResponse.json(
      { error: 'server_error', message: 'Failed to join waitlist' },
      { status: 500 }
    )
  }
}
