import { readBoundedJson, RequestBodyLimitError } from '@/lib/api/bounded-body'
import { NextRequest } from 'next/server'
import { z } from 'zod'
import {
  authenticateRequest,
  errorResponse,
  unauthorizedResponse,
  successResponse,
  validationErrorResponse,
  forbiddenResponse,
} from '@/lib/api/auth'
import { getSession } from '@/lib/auth/session'
import { adminDb } from '@/lib/firebase/admin'
import { Timestamp } from 'firebase-admin/firestore'
import { getAccountContext, AccountContext, getProjectContext } from '@/lib/org/context'
import { getMutableProjectContext } from '@/lib/org/project-authorization'
import type { Project, LinkConfiguration, LinkSyncMode, SharedMetadataField } from '@/lib/firebase/firestore'

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

// Schema for creating a link
const createLinkSchema = z.object({
  targetProjectId: z.string().min(1, 'Target project ID is required'),
  syncMode: z.enum(['auto', 'manual']).default('manual'),
  shareMetadata: z.boolean().default(true),
  shareScreenshots: z.boolean().default(true),
  shareIcons: z.boolean().default(true),
  sharedMetadataFields: z.array(z.enum([
    'name', 'subtitle', 'description', 'keywords', 'whatsNew', 'promotionalText'
  ])).default(['name', 'subtitle', 'description', 'keywords', 'whatsNew', 'promotionalText']),
})

// Schema for updating link configuration
const updateLinkSchema = z.object({
  syncMode: z.enum(['auto', 'manual']).optional(),
  shareMetadata: z.boolean().optional(),
  shareScreenshots: z.boolean().optional(),
  shareIcons: z.boolean().optional(),
  sharedMetadataFields: z.array(z.enum([
    'name', 'subtitle', 'description', 'keywords', 'whatsNew', 'promotionalText'
  ])).optional(),
})

interface RouteContext {
  params: Promise<{ projectId: string }>
}

// GET - Get link status and configuration
export async function GET(request: NextRequest, context: RouteContext) {
  const { projectId } = await context.params

  const { context: authContext, error } = await getAuthContext(request)
  if (!authContext) {
    return unauthorizedResponse(error)
  }

  // Get project context to verify ownership
  const projectContext = await getProjectContext(authContext.userId, projectId)
  if (!projectContext) {
    return errorResponse('Project not found', 404)
  }

  // Get project base path
  const basePath = projectContext.type === 'organization' && projectContext.orgId
    ? adminDb.collection('organizations').doc(projectContext.orgId).collection('projects')
    : adminDb.collection('users').doc(authContext.userId).collection('projects')

  // Get project data
  const projectDoc = await basePath.doc(projectId).get()
  if (!projectDoc.exists) {
    return errorResponse('Project not found', 404)
  }

  const project = projectDoc.data() as Project

  // If no link exists
  if (!project.linkedProjectId) {
    return successResponse({
      linked: false,
      linkedProjectId: null,
      linkConfiguration: null,
      linkOwner: false,
      linkedProject: null,
    })
  }

  // Get linked project info
  const linkedProjectDoc = await basePath.doc(project.linkedProjectId).get()
  const linkedProject = linkedProjectDoc.exists ? linkedProjectDoc.data() as Project : null

  return successResponse({
    linked: true,
    linkedProjectId: project.linkedProjectId,
    linkConfiguration: project.linkConfiguration,
    linkOwner: project.linkOwner,
    linkedProject: linkedProject ? {
      id: project.linkedProjectId,
      name: linkedProject.name,
      storeType: linkedProject.storeType,
      appStoreAppId: linkedProject.appStoreAppId,
      playStorePackage: linkedProject.playStorePackage,
    } : null,
  })
}

// POST - Create link between two projects
export async function POST(request: NextRequest, context: RouteContext) {
  const { projectId } = await context.params

  const { context: authContext, error } = await getAuthContext(request)
  if (!authContext) {
    return unauthorizedResponse(error)
  }

  // Parse request body
  let body
  try {
    body = createLinkSchema.parse(await readBoundedJson(request))
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

  const { targetProjectId, syncMode, shareMetadata, shareScreenshots, shareIcons, sharedMetadataFields } = body

  // Cannot link to self
  if (projectId === targetProjectId) {
    return errorResponse('Cannot link a project to itself', 400)
  }

  // Get project context to verify ownership
  const sourceProjectContext = await getMutableProjectContext(authContext.userId, projectId)
  if (!sourceProjectContext) {
    return errorResponse('Source project not found', 404)
  }

  const targetProjectContext = await getMutableProjectContext(authContext.userId, targetProjectId)
  if (!targetProjectContext) {
    return errorResponse('Target project not found', 404)
  }

  // Get base paths for both projects
  const sourceBasePath = sourceProjectContext.type === 'organization' && sourceProjectContext.orgId
    ? adminDb.collection('organizations').doc(sourceProjectContext.orgId).collection('projects')
    : adminDb.collection('users').doc(authContext.userId).collection('projects')

  const targetBasePath = targetProjectContext.type === 'organization' && targetProjectContext.orgId
    ? adminDb.collection('organizations').doc(targetProjectContext.orgId).collection('projects')
    : adminDb.collection('users').doc(authContext.userId).collection('projects')

  // Get both project documents
  const [sourceDoc, targetDoc] = await Promise.all([
    sourceBasePath.doc(projectId).get(),
    targetBasePath.doc(targetProjectId).get(),
  ])

  if (!sourceDoc.exists) {
    return errorResponse('Source project not found', 404)
  }
  if (!targetDoc.exists) {
    return errorResponse('Target project not found', 404)
  }

  const sourceProject = sourceDoc.data() as Project
  const targetProject = targetDoc.data() as Project

  // Validate store types are different (iOS can only link with Android)
  if (sourceProject.storeType === targetProject.storeType) {
    return errorResponse(
      `Cannot link projects of the same store type. ${sourceProject.storeType === 'ios' ? 'iOS' : 'Android'} projects can only link with ${sourceProject.storeType === 'ios' ? 'Android' : 'iOS'} projects.`,
      400
    )
  }

  // Check if either project is already linked
  if (sourceProject.linkedProjectId) {
    return errorResponse('Source project is already linked to another project. Unlink first.', 400)
  }
  if (targetProject.linkedProjectId) {
    return errorResponse('Target project is already linked to another project.', 400)
  }

  // Create link configuration
  const linkConfig: LinkConfiguration = {
    syncMode: syncMode as LinkSyncMode,
    shareMetadata,
    shareScreenshots,
    shareIcons,
    sharedMetadataFields: sharedMetadataFields as SharedMetadataField[],
    lastSyncedAt: null,
  }

  const now = Timestamp.now()

  // Update both projects atomically
  const batch = adminDb.batch()

  batch.update(sourceBasePath.doc(projectId), {
    linkedProjectId: targetProjectId,
    linkConfiguration: linkConfig,
    linkOwner: true, // Source project is the link owner
    updatedAt: now,
  })

  batch.update(targetBasePath.doc(targetProjectId), {
    linkedProjectId: projectId,
    linkConfiguration: linkConfig,
    linkOwner: false, // Target project is not the link owner
    updatedAt: now,
  })

  await batch.commit()

  return successResponse({
    message: 'Projects linked successfully',
    linkedProjectId: targetProjectId,
    linkConfiguration: linkConfig,
    linkOwner: true,
  }, 201)
}

// PATCH - Update link configuration
export async function PATCH(request: NextRequest, context: RouteContext) {
  const { projectId } = await context.params

  const { context: authContext, error } = await getAuthContext(request)
  if (!authContext) {
    return unauthorizedResponse(error)
  }

  // Parse request body
  let body
  try {
    body = updateLinkSchema.parse(await readBoundedJson(request))
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

  // Get project context
  const projectContext = await getMutableProjectContext(authContext.userId, projectId)
  if (!projectContext) {
    return errorResponse('Project not found', 404)
  }

  const basePath = projectContext.type === 'organization' && projectContext.orgId
    ? adminDb.collection('organizations').doc(projectContext.orgId).collection('projects')
    : adminDb.collection('users').doc(authContext.userId).collection('projects')

  const projectDoc = await basePath.doc(projectId).get()
  if (!projectDoc.exists) {
    return errorResponse('Project not found', 404)
  }

  const project = projectDoc.data() as Project

  if (!project.linkedProjectId || !project.linkConfiguration) {
    return errorResponse('Project is not linked', 400)
  }

  // Update link configuration
  const updatedConfig: LinkConfiguration = {
    ...project.linkConfiguration,
    ...body,
  }

  const now = Timestamp.now()

  // Update both projects with the new configuration
  const linkedBasePath = projectContext.type === 'organization' && projectContext.orgId
    ? adminDb.collection('organizations').doc(projectContext.orgId).collection('projects')
    : adminDb.collection('users').doc(authContext.userId).collection('projects')

  const batch = adminDb.batch()

  batch.update(basePath.doc(projectId), {
    linkConfiguration: updatedConfig,
    updatedAt: now,
  })

  batch.update(linkedBasePath.doc(project.linkedProjectId), {
    linkConfiguration: updatedConfig,
    updatedAt: now,
  })

  await batch.commit()

  return successResponse({
    message: 'Link configuration updated',
    linkConfiguration: updatedConfig,
  })
}

// DELETE - Remove link
export async function DELETE(request: NextRequest, context: RouteContext) {
  const { projectId } = await context.params

  const { context: authContext, error } = await getAuthContext(request)
  if (!authContext) {
    return unauthorizedResponse(error)
  }

  // Get project context
  const projectContext = await getMutableProjectContext(authContext.userId, projectId)
  if (!projectContext) {
    return errorResponse('Project not found', 404)
  }

  const basePath = projectContext.type === 'organization' && projectContext.orgId
    ? adminDb.collection('organizations').doc(projectContext.orgId).collection('projects')
    : adminDb.collection('users').doc(authContext.userId).collection('projects')

  const projectDoc = await basePath.doc(projectId).get()
  if (!projectDoc.exists) {
    return errorResponse('Project not found', 404)
  }

  const project = projectDoc.data() as Project

  if (!project.linkedProjectId) {
    return errorResponse('Project is not linked', 400)
  }

  const linkedProjectId = project.linkedProjectId

  // Get linked project base path (same as source since they must be in same user/org)
  const linkedBasePath = basePath

  const now = Timestamp.now()

  // Remove link from both projects
  const batch = adminDb.batch()

  batch.update(basePath.doc(projectId), {
    linkedProjectId: null,
    linkConfiguration: null,
    linkOwner: false,
    updatedAt: now,
  })

  batch.update(linkedBasePath.doc(linkedProjectId), {
    linkedProjectId: null,
    linkConfiguration: null,
    linkOwner: false,
    updatedAt: now,
  })

  await batch.commit()

  return successResponse({
    message: 'Projects unlinked successfully',
    unlinkedProjectId: linkedProjectId,
  })
}
