import { NextRequest } from 'next/server'
import { z } from 'zod'
import { authenticateRequest, errorResponse, unauthorizedResponse } from '@/lib/api/auth'
import { getProjectContext, hasContextPermission, getAccountContext, AccountContext } from '@/lib/org/context'
import { getSession } from '@/lib/auth/session'
import { adminDb } from '@/lib/firebase/admin'
import { logAuditEvent, AuditAction } from '@/lib/org/audit'
import { uploadFile, deleteFile } from '@/lib/services/r2'
import { Timestamp } from 'firebase-admin/firestore'
import sharp from 'sharp'

const requestSchema = z.object({
  projectId: z.string(),
  displayType: z.string(),
  screenshotId: z.string(),
  locale: z.string().optional(), // If saving to a translated screenshot
  selectedImageUrl: z.string(), // URL of the chosen variation
  discardUrls: z.array(z.string()).optional(), // URLs of variations to discard
})

// Helper to get auth context
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

export async function POST(request: NextRequest) {
  // Authenticate
  const { context: authContext, error: authError } = await getAuthContext(request)
  if (!authContext) {
    return unauthorizedResponse(authError)
  }

  // Parse request
  let body
  try {
    body = requestSchema.parse(await request.json())
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(`Validation error: ${error.errors.map(e => e.message).join(', ')}`)
    }
    return errorResponse('Invalid request body')
  }

  const { projectId, displayType, screenshotId, locale, selectedImageUrl, discardUrls } = body

  // Get project context
  const projectContext = await getProjectContext(authContext.userId, projectId)
  if (!projectContext) {
    return errorResponse('Project not found', 404)
  }

  // Check permission
  if (!hasContextPermission(projectContext, 'canCreateProjects')) {
    return errorResponse('Permission denied', 403)
  }

  // Get base path for this project
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

  try {
    const now = Timestamp.now()

    // Get the original screenshot to determine target dimensions
    let originalImageUrl: string | null = null

    if (locale) {
      // Get original localized screenshot
      const localizedKey = `${displayType}_${screenshotId}_${locale}`
      const localizedDoc = await basePath.collection('localizedScreenshots').doc(localizedKey).get()
      if (localizedDoc.exists) {
        originalImageUrl = localizedDoc.data()!.marketingImageUrl
      }
    } else {
      // Get original primary screenshot
      const screenshotSetDoc = await basePath.collection('screenshots').doc(displayType).get()
      if (screenshotSetDoc.exists) {
        const screenshotSet = screenshotSetDoc.data()!
        const screenshot = screenshotSet.screenshots.find((s: any) => s.id === screenshotId)
        if (screenshot) {
          originalImageUrl = screenshot.marketingImageUrl
        }
      }
    }

    if (!originalImageUrl) {
      return errorResponse('Original screenshot not found', 404)
    }

    // Fetch original image to get target dimensions
    const originalImageRes = await fetch(originalImageUrl)
    if (!originalImageRes.ok) {
      return errorResponse('Failed to fetch original image', 500)
    }
    const originalBuffer = Buffer.from(await originalImageRes.arrayBuffer())
    const originalMetadata = await sharp(originalBuffer).metadata()
    const targetWidth = originalMetadata.width || 1284
    const targetHeight = originalMetadata.height || 2778

    // Fetch selected variation and resize to match original dimensions
    const selectedImageRes = await fetch(selectedImageUrl)
    if (!selectedImageRes.ok) {
      return errorResponse('Failed to fetch selected image', 500)
    }
    const selectedBuffer = Buffer.from(await selectedImageRes.arrayBuffer())

    // Resize to exactly match original dimensions
    // Use JPEG for ~10x smaller files. App Store accepts both PNG and JPEG.
    const resizedBuffer = await sharp(selectedBuffer)
      .resize(targetWidth, targetHeight, {
        fit: 'cover',
        position: 'center',
      })
      .jpeg({ quality: 95, mozjpeg: true })
      .toBuffer()

    // Upload resized image to permanent storage
    const uploaded = await uploadFile({
      userId: projectContext.type === 'organization' ? undefined : authContext.userId,
      orgId: projectContext.orgId || undefined,
      projectId,
      category: 'generated',
      filename: `edited-${displayType}-${screenshotId}-${Date.now()}.jpg`,
      data: resizedBuffer,
      contentType: 'image/jpeg',
    })

    if (locale) {
      // Update localized screenshot
      const localizedKey = `${displayType}_${screenshotId}_${locale}`
      const localizedRef = basePath.collection('localizedScreenshots').doc(localizedKey)
      const localizedDoc = await localizedRef.get()

      if (!localizedDoc.exists) {
        return errorResponse('Localized screenshot not found', 404)
      }

      await localizedRef.update({
        marketingImageUrl: uploaded.url,
        marketingImageKey: uploaded.key,
        lastModifiedAt: now,
        lastModifiedBy: authContext.userId,
      })
    } else {
      // Update primary screenshot
      const screenshotSetDoc = await basePath.collection('screenshots').doc(displayType).get()
      if (!screenshotSetDoc.exists) {
        return errorResponse('Screenshot set not found', 404)
      }

      const screenshotSet = screenshotSetDoc.data()!
      const updatedScreenshots = screenshotSet.screenshots.map((s: any) => {
        if (s.id === screenshotId) {
          return {
            ...s,
            marketingImageUrl: uploaded.url,
            marketingImageKey: uploaded.key,
            updatedAt: now,
          }
        }
        return s
      })

      await basePath.collection('screenshots').doc(displayType).update({
        screenshots: updatedScreenshots,
        updatedAt: now,
        syncStatus: 'local_changes',
      })

      // Update project sync status
      await basePath.update({
        screenshotSyncStatus: 'local_changes',
        updatedAt: now,
      })
    }

    // Clean up discarded variations (best effort)
    if (discardUrls && discardUrls.length > 0) {
      for (const url of discardUrls) {
        try {
          // Extract key from URL and delete
          const urlObj = new URL(url)
          const key = urlObj.pathname.substring(1) // Remove leading slash
          if (key && key.includes('temp-edit')) {
            await deleteFile(key)
          }
        } catch (e) {
          // Ignore cleanup errors
          console.error('Failed to cleanup temp image:', e)
        }
      }
    }

    // Log audit event
    if (projectContext.type === 'organization' && projectContext.orgId) {
      await logAuditEvent({
        orgId: projectContext.orgId,
        action: AuditAction.PROJECT_UPDATED,
        userId: authContext.userId,
        resourceType: 'project',
        resourceId: projectId,
        metadata: {
          action: 'screenshot_edit_saved',
          displayType,
          screenshotId,
          locale: locale || 'primary',
        },
      })
    }

    return Response.json({
      success: true,
      screenshot: {
        id: screenshotId,
        marketingImageUrl: uploaded.url,
        marketingImageKey: uploaded.key,
      },
    })
  } catch (error) {
    console.error('Error saving edited screenshot:', error)
    return errorResponse(
      error instanceof Error ? error.message : 'Failed to save edited screenshot',
      500
    )
  }
}
