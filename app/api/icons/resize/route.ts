import { NextRequest } from 'next/server'
import { z } from 'zod'
import { authenticateRequest, errorResponse, unauthorizedResponse } from '@/lib/api/auth'
import { getSession } from '@/lib/auth/session'
import { getAccountContext, getProjectContext, hasContextPermission, AccountContext } from '@/lib/org/context'
import { resizeExternalIcon } from '@/lib/services/icon-generator'
import { rateLimit, RATE_LIMITS } from '@/lib/api/rate-limit'
import { isAllowedImageUrl } from '@/lib/api/ssrf-protection'

const requestSchema = z.object({
  projectId: z.string(),
  imageUrl: z.string().url(),
})

export async function POST(request: NextRequest) {
  // Rate limit
  const rateLimitResult = await rateLimit(request, RATE_LIMITS.expensive)
  if (!rateLimitResult.success) {
    return errorResponse('Rate limit exceeded. Please try again later.', 429)
  }

  // Authenticate - try session first, then API key
  let context: AccountContext | null = null

  const session = await getSession()
  if (session) {
    context = await getAccountContext(session.userId)
  }

  if (!context) {
    const auth = await authenticateRequest(request)
    if (!auth.authenticated || !auth.context) {
      return unauthorizedResponse(auth.error)
    }
    context = auth.context
  }

  if (!context) {
    return unauthorizedResponse('Authentication failed')
  }

  // Parse request
  let body
  try {
    body = requestSchema.parse(await request.json())
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(`Invalid request: ${error.errors[0]?.message || 'Validation failed'}`)
    }
    return errorResponse('Invalid request body')
  }

  const { projectId, imageUrl } = body

  // SSRF protection - validate image URL
  if (!isAllowedImageUrl(imageUrl)) {
    return errorResponse('Image URL must be from an allowed domain', 400)
  }

  // Get project context
  const projectContext = await getProjectContext(context.userId, projectId)
  if (!projectContext) {
    return errorResponse('Project not found', 404)
  }

  // Check permission
  if (!hasContextPermission(projectContext, 'canCreateProjects')) {
    return errorResponse('Permission denied', 403)
  }

  try {
    const result = await resizeExternalIcon(imageUrl, {
      userId: projectContext.type === 'personal' ? context.userId : undefined,
      orgId: projectContext.orgId,
      projectId,
    })

    if (!result.success) {
      return errorResponse(result.error || 'Failed to resize icon', 500)
    }

    return Response.json({
      success: true,
      ios: result.ios,
      android: result.android,
    })
  } catch (error) {
    return errorResponse(
      error instanceof Error ? error.message : 'Failed to resize icon',
      500
    )
  }
}
