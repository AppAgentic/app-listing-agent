import { readBoundedJson, RequestBodyLimitError } from '@/lib/api/bounded-body'
import { NextRequest } from 'next/server'
import { z } from 'zod'
import { authenticateRequest, errorResponse, unauthorizedResponse } from '@/lib/api/auth'
import { getProjectContext, hasContextPermission, getAccountContext, AccountContext } from '@/lib/org/context'
import { getSession } from '@/lib/auth/session'
import { adminDb } from '@/lib/firebase/admin'
import { Timestamp } from 'firebase-admin/firestore'
import { uploadFile, deleteFile } from '@/lib/services/r2'

const uploadScreenshotSchema = z.object({
  projectId: z.string(),
  fileName: z.string(),
  imageData: z.string(),
  mimeType: z.string().default('image/png'),
})

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

// Helper to find subscription document across all groups
async function findSubscription(basePath: FirebaseFirestore.DocumentReference, subId: string) {
  const groupsSnapshot = await basePath.collection('subscriptionGroups').get()

  for (const groupDoc of groupsSnapshot.docs) {
    const subDoc = await groupDoc.ref.collection('subscriptions').doc(subId).get()
    if (subDoc.exists) {
      return { doc: subDoc, ref: subDoc.ref, groupRef: groupDoc.ref }
    }
  }

  return null
}

// GET /api/subscriptions/[subId]/screenshot - Get current screenshot for a subscription
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ subId: string }> }
) {
  const { context: authContext, error: authError } = await getAuthContext(request)
  if (!authContext) {
    return unauthorizedResponse(authError)
  }

  const { subId } = await params
  const { searchParams } = new URL(request.url)
  const projectId = searchParams.get('projectId')

  if (!projectId) {
    return errorResponse('projectId is required')
  }

  const projectContext = await getProjectContext(authContext.userId, projectId)
  if (!projectContext) {
    return errorResponse('Project not found', 404)
  }

  try {
    const basePath = projectContext.type === 'organization' && projectContext.orgId
      ? adminDb.collection('organizations').doc(projectContext.orgId).collection('projects').doc(projectId)
      : adminDb.collection('users').doc(authContext.userId).collection('projects').doc(projectId)

    const subscription = await findSubscription(basePath, subId)
    if (!subscription) {
      return errorResponse('Subscription not found', 404)
    }

    // Get screenshot if exists
    const screenshotDoc = await subscription.ref.collection('config').doc('reviewScreenshot').get()

    return Response.json({
      screenshot: screenshotDoc.exists ? screenshotDoc.data() : null,
    })
  } catch (error) {
    console.error('Error fetching subscription screenshot:', error)
    return errorResponse(error instanceof Error ? error.message : 'Failed to fetch screenshot', 500)
  }
}

// POST /api/subscriptions/[subId]/screenshot - Upload review screenshot for a subscription
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ subId: string }> }
) {
  const { context: authContext, error: authError } = await getAuthContext(request)
  if (!authContext) {
    return unauthorizedResponse(authError)
  }

  const { subId } = await params

  let body
  try {
    body = uploadScreenshotSchema.parse(await readBoundedJson(request))
  } catch (error) {
    if (error instanceof RequestBodyLimitError) return Response.json({ error: error.message }, { status: 413 })
    if (error instanceof z.ZodError) {
      return errorResponse(`Validation error: ${error.issues.map(e => e.message).join(', ')}`)
    }
    return errorResponse('Invalid request body')
  }

  const { projectId, fileName, imageData, mimeType } = body

  // Validate base64 data size (max 5MB after decoding)
  const estimatedSize = (imageData.length * 3) / 4
  if (estimatedSize > 5 * 1024 * 1024) {
    return errorResponse('Screenshot too large. Maximum size is 5MB.')
  }

  const projectContext = await getProjectContext(authContext.userId, projectId)
  if (!projectContext) {
    return errorResponse('Project not found', 404)
  }

  if (!hasContextPermission(projectContext, 'canCreateProjects')) {
    return errorResponse('Permission denied', 403)
  }

  try {
    const basePath = projectContext.type === 'organization' && projectContext.orgId
      ? adminDb.collection('organizations').doc(projectContext.orgId).collection('projects').doc(projectId)
      : adminDb.collection('users').doc(authContext.userId).collection('projects').doc(projectId)

    const subscription = await findSubscription(basePath, subId)
    if (!subscription) {
      return errorResponse('Subscription not found', 404)
    }

    const subData = subscription.doc.data()

    // Delete old R2 file if exists to avoid storage bloat
    const existingScreenshot = await subscription.ref.collection('config').doc('reviewScreenshot').get()
    if (existingScreenshot.exists) {
      const oldR2Key = existingScreenshot.data()?.r2Key
      if (oldR2Key) {
        try {
          await deleteFile(oldR2Key)
        } catch {
          // Continue even if delete fails (file may not exist)
        }
      }
    }

    // Upload to R2 instead of storing base64 in Firestore
    const imageBuffer = Buffer.from(imageData, 'base64')
    const { key, url } = await uploadFile({
      userId: projectContext.type === 'organization' ? undefined : authContext.userId,
      orgId: projectContext.type === 'organization' ? projectContext.orgId : undefined,
      projectId,
      category: 'iap-media',
      filename: fileName,
      data: imageBuffer,
      contentType: mimeType,
      iapProductId: subData?.productId || subId,
      iapMediaType: 'reviewScreenshot',
    })

    // Save metadata to Firestore (URL reference, not the actual image data)
    const screenshotData = {
      fileName,
      mimeType,
      fileSize: estimatedSize,
      r2Key: key,
      r2Url: url,
      uploadedAt: Timestamp.now(),
      uploadedBy: authContext.userId,
    }

    await subscription.ref.collection('config').doc('reviewScreenshot').set(screenshotData)

    // Mark subscription as having local changes
    await subscription.ref.update({
      syncStatus: 'local_changes',
    })

    return Response.json({
      success: true,
      screenshot: {
        fileName,
        mimeType,
        fileSize: estimatedSize,
        r2Url: url,
      },
    })
  } catch (error) {
    console.error('Error uploading subscription screenshot:', error)
    return errorResponse(error instanceof Error ? error.message : 'Failed to upload screenshot', 500)
  }
}

// DELETE /api/subscriptions/[subId]/screenshot - Delete review screenshot for a subscription
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ subId: string }> }
) {
  const { context: authContext, error: authError } = await getAuthContext(request)
  if (!authContext) {
    return unauthorizedResponse(authError)
  }

  const { subId } = await params
  const { searchParams } = new URL(request.url)
  const projectId = searchParams.get('projectId')

  if (!projectId) {
    return errorResponse('projectId is required')
  }

  const projectContext = await getProjectContext(authContext.userId, projectId)
  if (!projectContext) {
    return errorResponse('Project not found', 404)
  }

  if (!hasContextPermission(projectContext, 'canCreateProjects')) {
    return errorResponse('Permission denied', 403)
  }

  try {
    const basePath = projectContext.type === 'organization' && projectContext.orgId
      ? adminDb.collection('organizations').doc(projectContext.orgId).collection('projects').doc(projectId)
      : adminDb.collection('users').doc(authContext.userId).collection('projects').doc(projectId)

    const subscription = await findSubscription(basePath, subId)
    if (!subscription) {
      return errorResponse('Subscription not found', 404)
    }

    // Get current screenshot to find R2 key
    const screenshotDoc = await subscription.ref.collection('config').doc('reviewScreenshot').get()

    // Delete from R2 if key exists
    if (screenshotDoc.exists) {
      const data = screenshotDoc.data()
      if (data?.r2Key) {
        try {
          await deleteFile(data.r2Key)
        } catch (r2Error) {
          console.warn('Failed to delete from R2:', r2Error)
        }
      }
    }

    // Delete from Firestore
    await subscription.ref.collection('config').doc('reviewScreenshot').delete()

    return Response.json({
      success: true,
      message: 'Screenshot deleted',
    })
  } catch (error) {
    console.error('Error deleting subscription screenshot:', error)
    return errorResponse(error instanceof Error ? error.message : 'Failed to delete screenshot', 500)
  }
}
