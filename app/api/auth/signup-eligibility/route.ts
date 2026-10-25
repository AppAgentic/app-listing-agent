import { readBoundedJson, RequestBodyLimitError } from '@/lib/api/bounded-body'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkSignupEligibility } from '@/lib/auth/signup-policy'
import { RATE_LIMIT_CONFIGS, withRateLimit } from '@/lib/api/rate-limit'

const requestSchema = z.object({
  email: z.string().email(),
  inviteToken: z.string().min(20).max(200).optional(),
})

export async function POST(request: NextRequest) {
  const rateLimit = await withRateLimit(request, RATE_LIMIT_CONFIGS.auth)
  if (rateLimit.response) return rateLimit.response

  try {
    const body = requestSchema.parse(await readBoundedJson(request))
    const eligibility = await checkSignupEligibility(body)

    if (!eligibility.allowed) {
      return NextResponse.json(
        { allowed: false, message: 'Signups are currently invite-only. Join the waitlist to request access.' },
        { status: 403 }
      )
    }

    return NextResponse.json({ allowed: true })
  } catch (error) {
    if (error instanceof RequestBodyLimitError) return Response.json({ error: error.message }, { status: 413 })
    if (error instanceof z.ZodError) {
      return NextResponse.json({ allowed: false, message: 'Enter a valid email address.' }, { status: 400 })
    }
    console.error('Signup eligibility error:', error)
    return NextResponse.json({ allowed: false, message: 'Unable to verify signup access.' }, { status: 500 })
  }
}
