import { NextRequest } from 'next/server'
import { z } from 'zod'
import { authenticateRequest, errorResponse, unauthorizedResponse } from '@/lib/api/auth'
import { getSession } from '@/lib/auth/session'
import { getAccountContext, getProjectContext, hasContextPermission, AccountContext } from '@/lib/org/context'
import { fetchAppStoreIcon, resizeIconForPlatforms } from '@/lib/services/icon-generator'
import { uploadFromUrl } from '@/lib/services/r2'
import { rateLimit, RATE_LIMITS } from '@/lib/api/rate-limit'

const requestSchema = z.object({
  projectId: z.string(),
  appId: z.string().regex(/^\d+$/, 'App ID must be numeric'),
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

  const { projectId, appId } = body

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
    // Fetch icon from App Store
    const appStoreResult = await fetchAppStoreIcon(appId)

    if (!appStoreResult.success || !appStoreResult.iconUrl) {
      return errorResponse(appStoreResult.error || 'Failed to fetch App Store icon', 404)
    }

    // Upload fetched icon to R2
    const uploaded = await uploadFromUrl({
      userId: projectContext.type === 'personal' ? context.userId : undefined,
      orgId: projectContext.orgId,
      projectId,
      category: 'icons',
      filename: `appstore-${appId}-${Date.now()}.png`,
      sourceUrl: appStoreResult.iconUrl,
    })

    // Fetch icon buffer for resizing
    const iconResponse = await fetch(appStoreResult.iconUrl)
    if (!iconResponse.ok) {
      return errorResponse('Failed to download App Store icon', 500)
    }
    const iconBuffer = Buffer.from(await iconResponse.arrayBuffer())

    // Resize to platform sizes
    const resized = await resizeIconForPlatforms(iconBuffer, {
      userId: projectContext.type === 'personal' ? context.userId : undefined,
      orgId: projectContext.orgId,
      projectId,
    })

    return Response.json({
      success: true,
      appName: appStoreResult.appName,
      originalUrl: uploaded.url,
      ios: resized.ios,
      android: resized.android,
    })
  } catch (error) {
    return errorResponse(
      error instanceof Error ? error.message : 'Failed to fetch App Store icon',
      500
    )
  }
}
