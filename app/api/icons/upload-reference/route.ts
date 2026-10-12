import { NextRequest } from 'next/server'
import { authenticateRequest, errorResponse, unauthorizedResponse } from '@/lib/api/auth'
import { getSession } from '@/lib/auth/session'
import { getAccountContext, getProjectContext, hasContextPermission, AccountContext } from '@/lib/org/context'
import { uploadReferenceIcon } from '@/lib/services/icon-generator'
import { rateLimit, RATE_LIMITS } from '@/lib/api/rate-limit'

const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB
const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/webp']

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

  try {
    const formData = await request.formData()
    const file = formData.get('file') as File | null
    const projectId = formData.get('projectId') as string | null

    if (!file) {
      return errorResponse('No file provided')
    }

    if (!projectId) {
      return errorResponse('Project ID is required')
    }

    // Validate file type
    if (!ALLOWED_TYPES.includes(file.type)) {
      return errorResponse('Invalid file type. Only PNG, JPEG, and WebP are allowed.')
    }

    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      return errorResponse('File too large. Maximum size is 10MB.')
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

    // Convert file to buffer
    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    // Upload reference icon
    const result = await uploadReferenceIcon(buffer, {
      userId: projectContext.type === 'personal' ? context.userId : undefined,
      orgId: projectContext.orgId,
      projectId,
    })

    return Response.json({
      success: true,
      referenceUrl: result.referenceUrl,
      previewUrl: result.previewUrl,
    })
  } catch (error) {
    return errorResponse(
      error instanceof Error ? error.message : 'Failed to upload reference icon',
      500
    )
  }
}
