import { readBoundedJson, RequestBodyLimitError } from '@/lib/api/bounded-body'
import { NextRequest } from 'next/server'
import { z } from 'zod'
import { authenticateRequest, errorResponse, unauthorizedResponse } from '@/lib/api/auth'
import { getSession } from '@/lib/auth/session'
import { getAccountContext, AccountContext } from '@/lib/org/context'
import { getProjectContext, hasContextPermission } from '@/lib/org/context'
import { adminDb } from '@/lib/firebase/admin'

const requestSchema = z.object({
  projectId: z.string(),
  limit: z.number().min(1).max(100).optional().default(50),
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
    body = requestSchema.parse(await readBoundedJson(request))
  } catch (error) {
    if (error instanceof RequestBodyLimitError) return Response.json({ error: error.message }, { status: 413 })
    if (error instanceof z.ZodError) {
      return errorResponse(`Invalid request: ${error.issues[0]?.message || 'Validation failed'}`)
    }
    return errorResponse('Invalid request body')
  }

  const { projectId, limit } = body

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
    // Get icons collection based on project type
    const iconsRef = projectContext.type === 'organization' && projectContext.orgId
      ? adminDb.collection('organizations').doc(projectContext.orgId).collection('projects').doc(projectId).collection('icons')
      : adminDb.collection('users').doc(context.userId).collection('projects').doc(projectId).collection('icons')

    const snapshot = await iconsRef
      .orderBy('createdAt', 'desc')
      .limit(limit)
      .get()

    const icons = snapshot.docs.map(doc => {
      const data = doc.data()
      return {
        id: doc.id,
        style: data.style || null,
        prompt: data.prompt || null,
        concept: data.concept || null,
        originalUrl: data.originalUrl,
        ios: data.ios,
        android: data.android,
        timestamp: data.createdAt?.toMillis() || Date.now(),
      }
    })

    return Response.json({
      success: true,
      icons,
    })
  } catch (error) {
    console.error('Failed to list icons:', error)
    return errorResponse(
      error instanceof Error ? error.message : 'Failed to list icons',
      500
    )
  }
}
