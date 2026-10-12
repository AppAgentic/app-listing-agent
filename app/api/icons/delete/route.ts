import { NextRequest } from 'next/server'
import { z } from 'zod'
import { authenticateRequest, errorResponse, unauthorizedResponse } from '@/lib/api/auth'
import { getSession } from '@/lib/auth/session'
import { getAccountContext, AccountContext } from '@/lib/org/context'
import { getProjectContext, hasContextPermission } from '@/lib/org/context'
import { adminDb } from '@/lib/firebase/admin'

const requestSchema = z.object({
  projectId: z.string(),
  iconId: z.string(),
})

export async function POST(request: NextRequest) {
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

  const { projectId, iconId } = body

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
    // Get icon document reference based on project type
    const iconRef = projectContext.type === 'organization' && projectContext.orgId
      ? adminDb.collection('organizations').doc(projectContext.orgId).collection('projects').doc(projectId).collection('icons').doc(iconId)
      : adminDb.collection('users').doc(context.userId).collection('projects').doc(projectId).collection('icons').doc(iconId)

    // Check if icon exists
    const iconDoc = await iconRef.get()
    if (!iconDoc.exists) {
      return errorResponse('Icon not found', 404)
    }

    // Delete the icon document
    await iconRef.delete()

    return Response.json({
      success: true,
      message: 'Icon deleted successfully',
    })
  } catch (error) {
    console.error('Failed to delete icon:', error)
    return errorResponse(
      error instanceof Error ? error.message : 'Failed to delete icon',
      500
    )
  }
}
