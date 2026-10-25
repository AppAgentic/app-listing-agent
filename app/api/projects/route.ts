import { readBoundedJson, RequestBodyLimitError } from '@/lib/api/bounded-body'
import { NextRequest } from 'next/server'
import { z } from 'zod'
import { randomUUID } from 'crypto'
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
import {
  createReservationErrorResponse,
  refundUsage,
  reserveUsage,
  settleUsage,
} from '@/lib/api/usage'
import { hasContextPermission, AccountContext, getAccountContext } from '@/lib/org/context'
import type { Project, MetadataSyncStatus, StoreType } from '@/lib/firebase/firestore'
import {
  hasInternalIntegrationAccess,
  stripInternalProjectFields,
} from '@/lib/features/internal-integrations'

// Helper to get auth context from either API key or session
async function getAuthContext(request: NextRequest): Promise<{ context: AccountContext | null; error?: string }> {
  // First try API key / header-based auth
  const authHeader = request.headers.get('Authorization')
  if (authHeader) {
    const auth = await authenticateRequest(request)
    if (auth.authenticated && auth.context) {
      return { context: auth.context }
    }
    return { context: null, error: auth.error }
  }

  // Fallback to session-based auth (cookie-based)
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

const createProjectSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  storeType: z.enum(['ios', 'android', 'web'], { error: 'Store type is required' }),
  appStoreAppId: z.string().nullable().optional(),
  playStorePackage: z.string().nullable().optional(),
  primaryLocale: z.string().default('en-US'),
  enabledLocales: z.array(z.string()).default(['en-US']),
}).refine((data) => {
  // Validate store ID matches store type
  if (data.storeType === 'ios' && data.playStorePackage) {
    return false
  }
  if (data.storeType === 'android' && data.appStoreAppId) {
    return false
  }
  // Web projects should not have any store IDs
  if (data.storeType === 'web' && (data.appStoreAppId || data.playStorePackage)) {
    return false
  }
  return true
}, {
  message: 'Store ID must match store type (iOS projects can only have App Store ID, Android projects can only have Play Store package, Web projects should not have store IDs)',
})

// GET - List projects
export async function GET(request: NextRequest) {
  // Authenticate (supports both API key and session)
  const { context, error } = await getAuthContext(request)
  if (!context) {
    return unauthorizedResponse(error)
  }

  // Get base path
  const basePath = context.orgId
    ? adminDb.collection('organizations').doc(context.orgId).collection('projects')
    : adminDb.collection('users').doc(context.userId).collection('projects')

  const snapshot = await basePath.orderBy('updatedAt', 'desc').get()

  const internalAccess = hasInternalIntegrationAccess(context)
  const projects = snapshot.docs
    .map(doc => ({ id: doc.id, ...doc.data() }) as Record<string, unknown> & { id: string })
    .filter(project => internalAccess || project.storeType !== 'web')
    .map(project => internalAccess ? project : stripInternalProjectFields(project))

  return successResponse({ projects, total: projects.length })
}

// POST - Create project
export async function POST(request: NextRequest) {
  // Authenticate (supports both API key and session)
  const { context, error } = await getAuthContext(request)
  if (!context) {
    return unauthorizedResponse(error)
  }

  // Check permission for organization project creation
  if (context.type === 'organization' && !hasContextPermission(context, 'canCreateProjects')) {
    return forbiddenResponse('You do not have permission to create projects in this organization.')
  }

  // Parse request
  let body
  try {
    body = createProjectSchema.parse(await readBoundedJson(request))
  } catch (error) {
    if (error instanceof RequestBodyLimitError) return Response.json({ error: error.message }, { status: 413 })
    if (error instanceof z.ZodError) {
      return validationErrorResponse(
        error.issues[0]?.message || 'Invalid request body',
        { errors: error.issues }
      )
    }
    return validationErrorResponse('Invalid request body')
  }

  const { name, storeType, appStoreAppId, playStorePackage, primaryLocale, enabledLocales } = body

  if (storeType === 'web' && !hasInternalIntegrationAccess(context)) {
    return errorResponse('Not found', 404)
  }

  const basePath = context.orgId
    ? adminDb.collection('organizations').doc(context.orgId).collection('projects')
    : adminDb.collection('users').doc(context.userId).collection('projects')
  const projectRef = basePath.doc()

  const usageOperationId = `create-project:${request.headers.get('idempotency-key') || randomUUID()}`
  const reservation = await reserveUsage(context, {
    operationId: usageOperationId,
    usageType: 'apps',
    units: 1,
    metadata: { route: 'projects-create', storeType, projectPath: projectRef.path },
  })
  if (!reservation.allowed) return createReservationErrorResponse(reservation)
  if (reservation.replayed) {
    return errorResponse('This project creation request has already been processed', 409)
  }

  // Create project
  const now = Timestamp.now()
  const projectData: Omit<Project, 'id'> = {
    name,

    // Store type - immutable after creation
    storeType: storeType as StoreType,

    // Store IDs (only one should be set based on storeType)
    appStoreAppId: storeType === 'ios' ? (appStoreAppId || null) : null,
    playStorePackage: storeType === 'android' ? (playStorePackage || null) : null,

    // Web store fields
    whopApiKey: null,
    whopCompanyId: null,
    whopWebhookSecret: null,

    // Project linking (initialized as null - no link)
    linkedProjectId: null,
    linkConfiguration: null,
    linkOwner: false,

    // Legacy metadata (empty initially)
    metadata: {
      title: '',
      subtitle: '',
      description: '',
      keywords: '',
      whatsNew: '',
    },

    // Version tracking
    appStoreVersionState: null,
    appStoreVersionId: null,
    appStoreVersionNumber: null,

    // Sync metadata
    lastPulledAt: null,
    lastPushedAt: null,
    syncStatus: 'never_synced' as MetadataSyncStatus,

    // Locale configuration
    primaryLocale,
    enabledLocales: enabledLocales.includes(primaryLocale)
      ? enabledLocales
      : [primaryLocale, ...enabledLocales],

    createdBy: context.userId,
    createdAt: now as unknown as Project['createdAt'],
    updatedAt: now as unknown as Project['updatedAt'],
  }

  let projectCreated = false
  try {
    await projectRef.set(projectData)
    projectCreated = true
    await settleUsage(context, usageOperationId, 'apps', 1)

    return successResponse({
      projectId: projectRef.id,
      project: {
        id: projectRef.id,
        ...projectData,
      },
    }, 201)
  } catch (error) {
    // If the project write succeeded, keep the slot reserved. The scheduled
    // reconciler will settle it from projectPath instead of granting a free app.
    if (!projectCreated) await refundUsage(context, usageOperationId, 'apps')
    console.error('Create project error:', error)
    return errorResponse('Failed to create project', 500)
  }
}
