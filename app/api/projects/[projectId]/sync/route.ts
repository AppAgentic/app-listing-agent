import { readBoundedJson, RequestBodyLimitError } from '@/lib/api/bounded-body'
import { NextRequest } from 'next/server'
import { z } from 'zod'
import {
  authenticateRequest,
  errorResponse,
  unauthorizedResponse,
  successResponse,
  validationErrorResponse,
} from '@/lib/api/auth'
import { getSession } from '@/lib/auth/session'
import { adminDb } from '@/lib/firebase/admin'
import { getAccountContext, AccountContext, getProjectContext } from '@/lib/org/context'
import { getMutableProjectContext } from '@/lib/org/project-authorization'
import { fullMetadataSync, getSyncStatus } from '@/lib/services/project-sync'
import { syncScreenshots as syncScreenshotsService, syncIcon as syncIconService } from '@/lib/services/screenshot-sync'
import type { Project } from '@/lib/firebase/firestore'

// Helper to get auth context from either API key or session
async function getAuthContext(request: NextRequest): Promise<{ context: AccountContext | null; error?: string }> {
  const authHeader = request.headers.get('Authorization')
  if (authHeader) {
    const auth = await authenticateRequest(request)
    if (auth.authenticated && auth.context) {
      return { context: auth.context }
    }
    return { context: null, error: auth.error }
  }

  const session = await getSession()
  if (session) {
    const context = await getAccountContext(session.userId)
    if (context) {
      return { context }
    }
    return { context: null, error: 'User not found' }
  }

  return { context: null, error: 'Authentication required' }
}

// Schema for manual sync
const syncSchema = z.object({
  direction: z.enum(['push', 'pull']),
  syncMetadata: z.boolean().default(true),
  syncScreenshots: z.boolean().default(false),
  syncIcons: z.boolean().default(false),
  locales: z.array(z.string()).optional(),
})

interface RouteContext {
  params: Promise<{ projectId: string }>
}

// GET - Get sync status
export async function GET(request: NextRequest, context: RouteContext) {
  const { projectId } = await context.params

  const { context: authContext, error } = await getAuthContext(request)
  if (!authContext) {
    return unauthorizedResponse(error)
  }

  // Get project context
  const projectContext = await getProjectContext(authContext.userId, projectId)
  if (!projectContext) {
    return errorResponse('Project not found', 404)
  }

  const projectPath = projectContext.type === 'organization' && projectContext.orgId
    ? adminDb.collection('organizations').doc(projectContext.orgId).collection('projects').doc(projectId)
    : adminDb.collection('users').doc(authContext.userId).collection('projects').doc(projectId)

  const status = await getSyncStatus(projectPath)

  return successResponse(status)
}

// POST - Trigger manual sync
export async function POST(request: NextRequest, context: RouteContext) {
  const { projectId } = await context.params

  const { context: authContext, error } = await getAuthContext(request)
  if (!authContext) {
    return unauthorizedResponse(error)
  }

  // Parse request body
  let body
  try {
    body = syncSchema.parse(await readBoundedJson(request))
  } catch (err) {
    if (err instanceof RequestBodyLimitError) return Response.json({ error: err.message }, { status: 413 })
    if (err instanceof z.ZodError) {
      return validationErrorResponse(
        err.issues[0]?.message || 'Invalid request body',
        { errors: err.issues }
      )
    }
    return validationErrorResponse('Invalid request body')
  }

  const { direction, syncMetadata, syncScreenshots, syncIcons, locales } = body

  // Get project context
  const projectContext = await getMutableProjectContext(authContext.userId, projectId)
  if (!projectContext) {
    return errorResponse('Project not found', 404)
  }

  const basePath = projectContext.type === 'organization' && projectContext.orgId
    ? adminDb.collection('organizations').doc(projectContext.orgId).collection('projects')
    : adminDb.collection('users').doc(authContext.userId).collection('projects')

  const projectPath = basePath.doc(projectId)
  const projectDoc = await projectPath.get()

  if (!projectDoc.exists) {
    return errorResponse('Project not found', 404)
  }

  const project = projectDoc.data() as Project

  if (!project.linkedProjectId || !project.linkConfiguration) {
    return errorResponse('Project is not linked', 400)
  }

  // Get linked project path
  const linkedProjectPath = basePath.doc(project.linkedProjectId)
  const linkedProjectDoc = await linkedProjectPath.get()

  if (!linkedProjectDoc.exists) {
    return errorResponse('Linked project not found', 404)
  }

  const sourceProject = (direction === 'push' ? projectDoc : linkedProjectDoc).data() as Project
  const targetProjectData = (direction === 'push' ? linkedProjectDoc : projectDoc).data() as Project

  const results: {
    metadata?: Awaited<ReturnType<typeof fullMetadataSync>>
    screenshots?: Awaited<ReturnType<typeof syncScreenshotsService>>
    icons?: Awaited<ReturnType<typeof syncIconService>>
  } = {}

  // Determine source and target based on direction
  const sourcePath = direction === 'push' ? projectPath : linkedProjectPath
  const targetPath = direction === 'push' ? linkedProjectPath : projectPath

  // Sync metadata if requested
  if (syncMetadata) {
    results.metadata = await fullMetadataSync(
      sourcePath,
      targetPath,
      {
        ...project.linkConfiguration,
        shareMetadata: true, // Override for manual sync
      }
    )
  }

  // Sync screenshots if requested
  if (syncScreenshots) {
    results.screenshots = await syncScreenshotsService(
      sourcePath,
      targetPath,
      sourceProject,
      targetProjectData
    )
  }

  // Sync icons if requested
  if (syncIcons) {
    results.icons = await syncIconService(
      sourcePath,
      targetPath,
      sourceProject,
      targetProjectData
    )
  }

  const overallSuccess = Object.values(results).every(r => r?.success !== false)

  return successResponse({
    success: overallSuccess,
    direction,
    results,
  })
}
