import { NextRequest } from 'next/server'
import { z } from 'zod'
import { authenticateRequest, errorResponse, unauthorizedResponse } from '@/lib/api/auth'
import { getProjectContext, hasContextPermission, getAccountContext, AccountContext } from '@/lib/org/context'
import { getSession } from '@/lib/auth/session'
import { adminDb } from '@/lib/firebase/admin'
import { Timestamp } from 'firebase-admin/firestore'
import { uploadFile, deleteFile } from '@/lib/services/r2'

const uploadImageSchema = z.object({
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

// GET /api/subscriptions/[subId]/promotional-image - Get current promotional image for a subscription
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

    // Get promotional image if exists
    const imageDoc = await subscription.ref.collection('config').doc('promotionalImage').get()

    return Response.json({
      image: imageDoc.exists ? imageDoc.data() : null,
    })
  } catch (error) {
    console.error('Error fetching subscription promotional image:', error)
    return errorResponse(error instanceof Error ? error.message : 'Failed to fetch promotional image', 500)
  }
}

// POST /api/subscriptions/[subId]/promotional-image - Upload promotional image for a subscription
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
    body = uploadImageSchema.parse(await request.json())
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(`Validation error: ${error.errors.map(e => e.message).join(', ')}`)
    }
    return errorResponse('Invalid request body')
  }

  const { projectId, fileName, imageData, mimeType } = body

  // Validate base64 data size (max 5MB after decoding)
  const estimatedSize = (imageData.length * 3) / 4
  if (estimatedSize > 5 * 1024 * 1024) {
    return errorResponse('Image too large. Maximum size is 5MB.')
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
    const existingImage = await subscription.ref.collection('config').doc('promotionalImage').get()
    if (existingImage.exists) {
      const oldR2Key = existingImage.data()?.r2Key
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
      iapMediaType: 'promotionalImage',
    })

    // Save metadata to Firestore (URL reference, not the actual image data)
    const imageDataObj = {
      fileName,
      mimeType,
      fileSize: estimatedSize,
      r2Key: key,
      r2Url: url,
      uploadedAt: Timestamp.now(),
      uploadedBy: authContext.userId,
    }

    await subscription.ref.collection('config').doc('promotionalImage').set(imageDataObj)

    // Mark subscription as having local changes
    await subscription.ref.update({
      syncStatus: 'local_changes',
    })

    return Response.json({
      success: true,
      image: {
        fileName,
        mimeType,
        fileSize: estimatedSize,
        r2Url: url,
      },
    })
  } catch (error) {
    console.error('Error uploading subscription promotional image:', error)
    return errorResponse(error instanceof Error ? error.message : 'Failed to upload promotional image', 500)
  }
}

// DELETE /api/subscriptions/[subId]/promotional-image - Delete promotional image for a subscription
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

    // Get current image to find R2 key
    const imageDoc = await subscription.ref.collection('config').doc('promotionalImage').get()

    // Delete from R2 if key exists
    if (imageDoc.exists) {
      const data = imageDoc.data()
      if (data?.r2Key) {
        try {
          await deleteFile(data.r2Key)
        } catch (r2Error) {
          console.warn('Failed to delete from R2:', r2Error)
        }
      }
    }

    // Delete from Firestore
    await subscription.ref.collection('config').doc('promotionalImage').delete()

    return Response.json({
      success: true,
      message: 'Promotional image deleted',
    })
  } catch (error) {
    console.error('Error deleting subscription promotional image:', error)
    return errorResponse(error instanceof Error ? error.message : 'Failed to delete promotional image', 500)
  }
}
