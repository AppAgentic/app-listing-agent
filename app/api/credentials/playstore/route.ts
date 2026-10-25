import { readBoundedJson, RequestBodyLimitError } from '@/lib/api/bounded-body'
import { NextRequest } from 'next/server'
import { z } from 'zod'
import { authenticateRequest, errorResponse, unauthorizedResponse } from '@/lib/api/auth'
import { getProjectContext, hasContextPermission } from '@/lib/org/context'
import { adminDb } from '@/lib/firebase/admin'
import { Timestamp } from 'firebase-admin/firestore'
import { encryptPlayStoreCredentials } from '@/lib/crypto/credentials'
import { logAuditEvent, AuditAction } from '@/lib/org/audit'
import { recordCoreAction } from '@/lib/analytics/runtime'

const requestSchema = z.object({
  projectId: z.string(),
  serviceAccount: z.string().min(1, 'Service account JSON is required'),
})

export async function POST(request: NextRequest) {
  // Authenticate
  const auth = await authenticateRequest(request)
  if (!auth.authenticated || !auth.context) {
    return unauthorizedResponse(auth.error)
  }

  // Parse request
  let body
  try {
    body = requestSchema.parse(await readBoundedJson(request))
  } catch (error) {
    if (error instanceof RequestBodyLimitError) return Response.json({ error: error.message }, { status: 413 })
    if (error instanceof z.ZodError) {
      return errorResponse(error.issues[0]?.message || 'Invalid request body')
    }
    return errorResponse('Invalid request body')
  }

  const { projectId, serviceAccount } = body

  // Validate service account JSON
  let parsedServiceAccount
  try {
    parsedServiceAccount = JSON.parse(serviceAccount)
    if (!parsedServiceAccount.client_email || !parsedServiceAccount.private_key) {
      return errorResponse('Invalid service account JSON. Missing client_email or private_key.')
    }
  } catch {
    return errorResponse('Invalid JSON format')
  }

  // Get project context
  const projectContext = await getProjectContext(auth.context.userId, projectId)
  if (!projectContext) {
    return errorResponse('Project not found', 404)
  }

  // Check permission
  if (!hasContextPermission(projectContext, 'canManageCredentials')) {
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
        .doc(auth.context.userId)
        .collection('projects')
        .doc(projectId)

  // Get project to get the package name
  const projectDoc = await basePath.get()
  if (!projectDoc.exists) {
    return errorResponse('Project not found', 404)
  }

  const projectData = projectDoc.data()!
  const packageName = projectData.playStorePackage

  if (!packageName) {
    return errorResponse('Play Store package name not configured for this project', 400)
  }

  try {
    // Encrypt credentials
    const encrypted = await encryptPlayStoreCredentials({
      packageName,
      serviceAccountJson: serviceAccount,
    })

    const now = Timestamp.now()

    // Save encrypted credentials
    await basePath.collection('credentials').doc('playstore').set({
      store: 'playstore',
      encryptedData: encrypted.encryptedData,
      encryptedDek: encrypted.encryptedDek,
      keyVersion: encrypted.keyVersion,
      addedBy: auth.context.userId,
      createdAt: now,
      updatedAt: now,
    })

    // Log audit event
    if (projectContext.type === 'organization' && projectContext.orgId) {
      await logAuditEvent({
        orgId: projectContext.orgId,
        action: AuditAction.CREDENTIALS_ADDED,
        userId: auth.context.userId,
        resourceType: 'credentials',
        resourceId: `${projectId}/playstore`,
        metadata: {
          store: 'playstore',
          serviceAccountEmail: parsedServiceAccount.client_email,
        },
      })
    }

    await recordCoreAction(auth.context.userId, 'play_connected')

    return Response.json({
      success: true,
      message: 'Google Play Console credentials saved successfully',
    })
  } catch (error) {
    console.error('Failed to encrypt credentials:', error)
    return errorResponse('Failed to encrypt credentials. Please try again.', 500)
  }
}

export async function DELETE(request: NextRequest) {
  // Authenticate
  const auth = await authenticateRequest(request)
  if (!auth.authenticated || !auth.context) {
    return unauthorizedResponse(auth.error)
  }

  const { searchParams } = new URL(request.url)
  const projectId = searchParams.get('projectId')

  if (!projectId) {
    return errorResponse('projectId is required')
  }

  // Get project context
  const projectContext = await getProjectContext(auth.context.userId, projectId)
  if (!projectContext) {
    return errorResponse('Project not found', 404)
  }

  // Check permission
  if (!hasContextPermission(projectContext, 'canManageCredentials')) {
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
        .doc(auth.context.userId)
        .collection('projects')
        .doc(projectId)

  // Delete credentials
  await basePath.collection('credentials').doc('playstore').delete()

  // Log audit event
  if (projectContext.type === 'organization' && projectContext.orgId) {
    await logAuditEvent({
      orgId: projectContext.orgId,
      action: AuditAction.CREDENTIALS_DELETED,
      userId: auth.context.userId,
      resourceType: 'credentials',
      resourceId: `${projectId}/playstore`,
      metadata: {
        store: 'playstore',
      },
    })
  }

  return Response.json({
    success: true,
    message: 'Google Play Console credentials removed',
  })
}
