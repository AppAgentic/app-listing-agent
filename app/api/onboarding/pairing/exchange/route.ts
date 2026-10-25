import { readBoundedJson } from '@/lib/api/bounded-body'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { exchangeAgentPairing } from '@/lib/agent-onboarding'
import { RATE_LIMIT_CONFIGS, withRateLimit } from '@/lib/api/rate-limit'

const exchangeSchema = z.object({
  code: z.string().min(12).max(20),
})

export async function POST(request: NextRequest) {
  const rateLimit = await withRateLimit(request, RATE_LIMIT_CONFIGS.auth)
  if (rateLimit.response) return rateLimit.response

  let input: z.infer<typeof exchangeSchema>
  try {
    input = exchangeSchema.parse(await readBoundedJson(request))
  } catch {
    return NextResponse.json({ error: 'A valid pairing code is required' }, { status: 400 })
  }

  try {
    const result = await exchangeAgentPairing(input.code)
    return NextResponse.json({
      ...result,
      warning: 'This API key is shown once. Store it in your agent secret store and do not print or share it.',
      nextAction: 'Configure the MCP server, then call get_onboarding_status.',
    })
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Pairing failed',
    }, { status: 400 })
  }
}
