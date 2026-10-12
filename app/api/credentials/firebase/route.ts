import { NextRequest } from 'next/server'
import { z } from 'zod'
import { authenticateRequest, errorResponse, unauthorizedResponse } from '@/lib/api/auth'
import { getProjectContext, hasContextPermission, getAccountContext, AccountContext } from '@/lib/org/context'
import { adminDb } from '@/lib/firebase/admin'
import { Timestamp } from 'firebase-admin/firestore'
import { encryptFirebaseCredentials } from '@/lib/crypto/credentials'
import { getSession } from '@/lib/auth/session'

// Supports both API key auth (MCP/programmatic) and session auth (settings page)
async function getAuth(request: NextRequest): Promise<{ context: AccountContext | null; error?: string }> {
  const authHeader = request.headers.get('Authorization')
  if (authHeader) {
    const auth = await authenticateRequest(request)
    if (auth.authenticated && auth.context) return { context: auth.context }
    return { context: null, error: auth.error }
  }
  const session = await getSession()
  if (session) {
    const context = await getAccountContext(session.userId)
    if (context) return { context }
    return { context: null, error: 'User not found' }
  }
  return { context: null, error: 'Authentication required' }
}

export async function GET(request: NextRequest) {
  const { context, error } = await getAuth(request)
  if (!context) return unauthorizedResponse(error)

  const { searchParams } = new URL(request.url)
  const projectId = searchParams.get('projectId')
  if (!projectId) return errorResponse('projectId is required')

  const projectContext = await getProjectContext(context.userId, projectId)
  if (!projectContext) return errorResponse('Project not found', 404)

  const basePath = projectContext.type === 'organization' && projectContext.orgId
    ? adminDb.collection('organizations').doc(projectContext.orgId).collection('projects').doc(projectId)
    : adminDb.collection('users').doc(context.userId).collection('projects').doc(projectId)

  const credDoc = await basePath.collection('credentials').doc('firebase').get()
  if (!credDoc.exists) {
    return Response.json({ configured: false })
  }

  const data = credDoc.data()!
  return Response.json({
    configured: true,
    serviceAccountEmail: data.serviceAccountEmail || null,
    addedAt: data.createdAt?.toDate?.()?.toISOString() || null,
  })
}

const requestSchema = z.object({
  projectId: z.string(),
  serviceAccount: z.string().min(1, 'Service account JSON is required'),
})

export async function POST(request: NextRequest) {
  const { context, error } = await getAuth(request)
  if (!context) return unauthorizedResponse(error)

  let body
  try {
    body = requestSchema.parse(await request.json())
  } catch (err) {
    if (err instanceof z.ZodError) {
      return errorResponse(err.errors[0]?.message || 'Invalid request body')
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

  const projectContext = await getProjectContext(context.userId, projectId)
  if (!projectContext) return errorResponse('Project not found', 404)
  if (!hasContextPermission(projectContext, 'canManageCredentials')) {
    return errorResponse('Permission denied', 403)
  }

  const basePath = projectContext.type === 'organization' && projectContext.orgId
    ? adminDb.collection('organizations').doc(projectContext.orgId).collection('projects').doc(projectId)
    : adminDb.collection('users').doc(context.userId).collection('projects').doc(projectId)

  try {
    const encrypted = await encryptFirebaseCredentials({ serviceAccountJson: serviceAccount })
    const now = Timestamp.now()

    await basePath.collection('credentials').doc('firebase').set({
      store: 'firebase',
      encryptedData: encrypted.encryptedData,
      encryptedDek: encrypted.encryptedDek,
      keyVersion: encrypted.keyVersion,
      serviceAccountEmail: parsedServiceAccount.client_email,
      addedBy: context.userId,
      createdAt: now,
      updatedAt: now,
    })

    return Response.json({
      success: true,
      message: 'Firebase service account saved successfully',
      serviceAccountEmail: parsedServiceAccount.client_email,
    })
  } catch (err) {
    console.error('Failed to encrypt Firebase credentials:', err)
    return errorResponse('Failed to encrypt credentials. Please try again.', 500)
  }
}

export async function DELETE(request: NextRequest) {
  const { context, error } = await getAuth(request)
  if (!context) return unauthorizedResponse(error)

  const { searchParams } = new URL(request.url)
  const projectId = searchParams.get('projectId')
  if (!projectId) return errorResponse('projectId is required')

  const projectContext = await getProjectContext(context.userId, projectId)
  if (!projectContext) return errorResponse('Project not found', 404)
  if (!hasContextPermission(projectContext, 'canManageCredentials')) {
    return errorResponse('Permission denied', 403)
  }

  const basePath = projectContext.type === 'organization' && projectContext.orgId
    ? adminDb.collection('organizations').doc(projectContext.orgId).collection('projects').doc(projectId)
    : adminDb.collection('users').doc(context.userId).collection('projects').doc(projectId)

  await basePath.collection('credentials').doc('firebase').delete()

  return Response.json({ success: true, message: 'Firebase credentials removed' })
}
