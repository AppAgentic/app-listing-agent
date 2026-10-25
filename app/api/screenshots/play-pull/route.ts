import { readBoundedJson, RequestBodyLimitError } from '@/lib/api/bounded-body'
import { NextRequest } from 'next/server'
import { z } from 'zod'
import { getAuthContext, errorResponse, unauthorizedResponse } from '@/app/api/playstore-iap/_helpers'
import { pullPlayStoreGraphics } from '@/lib/services/play-graphics-pull'

const requestSchema = z.object({
  projectId: z.string(),
  displayTypes: z.array(z.string()).optional(),
  locales: z.array(z.string()).optional(),
})

export async function POST(request: NextRequest) {
  let body
  try {
    body = requestSchema.parse(await readBoundedJson(request))
  } catch (error) {
    if (error instanceof RequestBodyLimitError) return Response.json({ error: error.message }, { status: 413 })
    if (error instanceof z.ZodError) return errorResponse(`Validation error: ${error.issues.map(e => e.message).join(', ')}`)
    return errorResponse('Invalid request body')
  }
  const { context, error } = await getAuthContext(request)
  if (!context) return unauthorizedResponse(error)
  const result = await pullPlayStoreGraphics(body, context)
  if (!result.success) return errorResponse(result.error || 'Failed to pull from Play Store', result.status)
  return Response.json(result)
}
