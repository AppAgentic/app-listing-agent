import { NextRequest } from 'next/server'
import { z } from 'zod'
import { errorResponse, unauthorizedResponse } from '@/lib/api/auth'
import { getProjectContext, hasContextPermission, getAccountContext } from '@/lib/org/context'
import { getSession } from '@/lib/auth/session'
import { listFiles, getPublicUrl } from '@/lib/services/r2'

const requestSchema = z.object({
  projectId: z.string(),
  category: z.enum(['raw', 'generated', 'final', 'reference', 'headline-analysis']).default('raw'),
})

export async function GET(request: NextRequest) {
  // Get session
  const session = await getSession()
  if (!session) {
    return unauthorizedResponse('Authentication required')
  }

  const context = await getAccountContext(session.userId)
  if (!context) {
    return unauthorizedResponse('User not found')
  }

  // Parse query params
  const searchParams = request.nextUrl.searchParams
  let params
  try {
    params = requestSchema.parse({
      projectId: searchParams.get('projectId'),
      category: searchParams.get('category') || 'raw',
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(`Validation error: ${error.issues.map(e => e.message).join(', ')}`)
    }
    return errorResponse('Invalid request parameters')
  }

  const { projectId, category } = params

  // Get project context to verify access
  const projectContext = await getProjectContext(context.userId, projectId)
  if (!projectContext) {
    return errorResponse('Project not found', 404)
  }

  // Check permission
  if (!hasContextPermission(projectContext, 'canCreateProjects')) {
    return errorResponse('Permission denied', 403)
  }

  try {
    // List files from R2
    const files = await listFiles({
      userId: projectContext.type === 'organization' ? undefined : context.userId,
      orgId: projectContext.orgId || undefined,
      projectId,
      category: category as any,
    })

    // Get public URLs for each file
    const screenshots = await Promise.all(
      files.map(async (key) => {
        const url = await getPublicUrl(key)
        const filename = key.split('/').pop() || key

        // Extract timestamp from filename if possible (e.g., raw-iphone67-0-1234567890.jpg)
        const timestampMatch = filename.match(/-(\d{13,})\./)
        const timestamp = timestampMatch ? parseInt(timestampMatch[1]) : Date.now()

        return {
          key,
          url,
          filename,
          uploadedAt: new Date(timestamp).toISOString(),
        }
      })
    )

    // Sort by upload date, newest first
    screenshots.sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime())

    return Response.json({
      success: true,
      screenshots,
      count: screenshots.length,
    })
  } catch (error) {
    console.error('Error listing screenshots:', error)
    return errorResponse(
      error instanceof Error ? error.message : 'Failed to list screenshots',
      500
    )
  }
}
