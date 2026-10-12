import { NextRequest } from 'next/server'
import { z } from 'zod'
import { authenticateRequest, errorResponse, unauthorizedResponse } from '@/lib/api/auth'
import { getSession } from '@/lib/auth/session'
import { getProjectContext, hasContextPermission, getAccountContext, AccountContext } from '@/lib/org/context'
import { adminDb } from '@/lib/firebase/admin'
import { Timestamp } from 'firebase-admin/firestore'
import { logAuditEvent, AuditAction } from '@/lib/org/audit'
import {
  hasInternalIntegrationAccess,
  stripInternalProjectFields,
} from '@/lib/features/internal-integrations'

interface RouteParams {
  params: Promise<{ projectId: string }>
}

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

const updateProjectSchema = z.object({
  name: z.string().min(1).optional(),
  appStoreAppId: z.string().nullable().optional(),
  playStorePackage: z.string().nullable().optional(),
  primaryLocale: z.string().optional(),
  enabledLocales: z.array(z.string()).optional(),
  vendorNumber: z.string().nullable().optional(),
  // RevenueCat integration
  revenueCatSecretKey: z.string().nullable().optional(),
  revenueCatProjectId: z.string().nullable().optional(),
  // Gleap integration
  gleapApiToken: z.string().nullable().optional(),
  gleapProjectId: z.string().nullable().optional(),
  // Whop integration
  whopApiKey: z.string().nullable().optional(),
  whopCompanyId: z.string().nullable().optional(),
  whopWebhookSecret: z.string().nullable().optional(),
  // Firebase integration (Crashlytics + Analytics + Firestore/Auth/Functions/Remote Config)
  firebaseAppId: z.string().nullable().optional(),
  firebaseAnalyticsPropertyId: z.string().nullable().optional(),
  firebaseProjectId: z.string().nullable().optional(),
})

// GET - Get project
export async function GET(request: NextRequest, { params }: RouteParams) {
  const { projectId } = await params

  // Authenticate
  const { context: authContext, error } = await getAuthContext(request)
  if (!authContext) {
    return unauthorizedResponse(error)
  }

  // Get project context
  const projectContext = await getProjectContext(authContext.userId, projectId)
  if (!projectContext) {
    return errorResponse('Project not found', 404)
  }
  if (projectContext.project.storeType === 'web' && !hasInternalIntegrationAccess(authContext)) {
    return errorResponse('Project not found', 404)
  }

  // Get base path
  const basePath = projectContext.type === 'organization' && projectContext.orgId
    ? adminDb
        .collection('organizations')
        .doc(projectContext.orgId)
        .collection('projects')
        .doc(projectId)
    : adminDb
        .collection('users')
        .doc(authContext.userId)
        .collection('projects')
        .doc(projectId)

  const projectDoc = await basePath.get()
  if (!projectDoc.exists) {
    return errorResponse('Project not found', 404)
  }

  const rawProjectData = { ...projectDoc.data() }
  const projectData = hasInternalIntegrationAccess(authContext)
    ? rawProjectData
    : stripInternalProjectFields(rawProjectData)

  return Response.json({
    success: true,
    project: {
      id: projectId,
      ...projectData,
    },
  })
}

// PATCH - Update project
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const { projectId } = await params

  // Authenticate
  const { context: authContext, error } = await getAuthContext(request)
  if (!authContext) {
    return unauthorizedResponse(error)
  }

  // Parse request
  let body
  try {
    body = updateProjectSchema.parse(await request.json())
  } catch (err) {
    if (err instanceof z.ZodError) {
      return errorResponse(err.errors[0]?.message || 'Invalid request body')
    }
    return errorResponse('Invalid request body')
  }

  const includesInternalIntegrationFields = [
    body.revenueCatSecretKey,
    body.revenueCatProjectId,
    body.gleapApiToken,
    body.gleapProjectId,
    body.whopApiKey,
    body.whopCompanyId,
    body.whopWebhookSecret,
    body.firebaseAppId,
    body.firebaseAnalyticsPropertyId,
    body.firebaseProjectId,
  ].some(value => value !== undefined)

  if (includesInternalIntegrationFields && !hasInternalIntegrationAccess(authContext)) {
    return errorResponse('Not found', 404)
  }

  // Get project context
  const projectContext = await getProjectContext(authContext.userId, projectId)
  if (!projectContext) {
    return errorResponse('Project not found', 404)
  }
  if (projectContext.project.storeType === 'web' && !hasInternalIntegrationAccess(authContext)) {
    return errorResponse('Project not found', 404)
  }

  // Check permission
  if (!hasContextPermission(projectContext, 'canCreateProjects')) {
    return errorResponse('Permission denied', 403)
  }

  // Get base path
  const basePath = projectContext.type === 'organization' && projectContext.orgId
    ? adminDb
        .collection('organizations')
        .doc(projectContext.orgId)
        .collection('projects')
        .doc(projectId)
    : adminDb
        .collection('users')
        .doc(authContext.userId)
        .collection('projects')
        .doc(projectId)

  // Update project
  const updateData: Record<string, unknown> = {
    updatedAt: Timestamp.now(),
  }

  if (body.name !== undefined) updateData.name = body.name
  if (body.appStoreAppId !== undefined) updateData.appStoreAppId = body.appStoreAppId
  if (body.playStorePackage !== undefined) updateData.playStorePackage = body.playStorePackage
  if (body.primaryLocale !== undefined) updateData.primaryLocale = body.primaryLocale
  if (body.vendorNumber !== undefined) updateData.vendorNumber = body.vendorNumber
  if (body.enabledLocales !== undefined) {
    // Ensure primary locale is in enabled locales
    const primaryLocale = body.primaryLocale || (await basePath.get()).data()?.primaryLocale || 'en-US'
    updateData.enabledLocales = body.enabledLocales.includes(primaryLocale)
      ? body.enabledLocales
      : [primaryLocale, ...body.enabledLocales]
  }
  // RevenueCat fields
  if (body.revenueCatSecretKey !== undefined) updateData.revenueCatSecretKey = body.revenueCatSecretKey
  if (body.revenueCatProjectId !== undefined) updateData.revenueCatProjectId = body.revenueCatProjectId
  // Gleap fields
  if (body.gleapApiToken !== undefined) updateData.gleapApiToken = body.gleapApiToken
  if (body.gleapProjectId !== undefined) updateData.gleapProjectId = body.gleapProjectId
  // Whop fields
  if (body.whopApiKey !== undefined) updateData.whopApiKey = body.whopApiKey
  if (body.whopCompanyId !== undefined) updateData.whopCompanyId = body.whopCompanyId
  if (body.whopWebhookSecret !== undefined) updateData.whopWebhookSecret = body.whopWebhookSecret
  // Firebase fields (Crashlytics + Analytics + Firestore/Auth/Functions/Remote Config)
  if (body.firebaseAppId !== undefined) updateData.firebaseAppId = body.firebaseAppId
  if (body.firebaseAnalyticsPropertyId !== undefined) updateData.firebaseAnalyticsPropertyId = body.firebaseAnalyticsPropertyId
  if (body.firebaseProjectId !== undefined) updateData.firebaseProjectId = body.firebaseProjectId

  await basePath.update(updateData)

  // Log audit event
  if (projectContext.type === 'organization' && projectContext.orgId) {
    await logAuditEvent({
      orgId: projectContext.orgId,
      action: AuditAction.PROJECT_UPDATED,
      userId: authContext.userId,
      resourceType: 'project',
      resourceId: projectId,
      metadata: {
        fieldsUpdated: Object.keys(body),
      },
    })
  }

  return Response.json({
    success: true,
    message: 'Project updated',
  })
}

// DELETE - Delete project
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const { projectId } = await params

  // Authenticate
  const { context: authContext, error } = await getAuthContext(request)
  if (!authContext) {
    return unauthorizedResponse(error)
  }

  // Get project context
  const projectContext = await getProjectContext(authContext.userId, projectId)
  if (!projectContext) {
    return errorResponse('Project not found', 404)
  }
  if (projectContext.project.storeType === 'web' && !hasInternalIntegrationAccess(authContext)) {
    return errorResponse('Project not found', 404)
  }

  // Check permission (need delete permission)
  if (!hasContextPermission(projectContext, 'canDeleteProjects')) {
    return errorResponse('Permission denied', 403)
  }

  // Get base path
  const basePath = projectContext.type === 'organization' && projectContext.orgId
    ? adminDb
        .collection('organizations')
        .doc(projectContext.orgId)
        .collection('projects')
        .doc(projectId)
    : adminDb
        .collection('users')
        .doc(authContext.userId)
        .collection('projects')
        .doc(projectId)

  // Delete all subcollections first
  const collections = ['metadata', 'metadataHistory', 'drafts', 'credentials', 'translations']
  for (const collectionName of collections) {
    const snapshot = await basePath.collection(collectionName).get()
    const batch = adminDb.batch()
    snapshot.docs.forEach(doc => batch.delete(doc.ref))
    if (!snapshot.empty) {
      await batch.commit()
    }
  }

  // Delete project document
  await basePath.delete()

  // Log audit event
  if (projectContext.type === 'organization' && projectContext.orgId) {
    await logAuditEvent({
      orgId: projectContext.orgId,
      action: AuditAction.PROJECT_DELETED,
      userId: authContext.userId,
      resourceType: 'project',
      resourceId: projectId,
      metadata: {},
    })
  }

  return Response.json({
    success: true,
    message: 'Project deleted',
  })
}
