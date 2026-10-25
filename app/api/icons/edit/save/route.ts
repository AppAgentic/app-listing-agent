import { readBoundedJson, RequestBodyLimitError } from '@/lib/api/bounded-body'
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

// Standard icon sizes
const ICON_SIZE_IOS = 1024
const ICON_SIZE_ANDROID = 512

const requestSchema = z.object({
  projectId: z.string(),
  iconId: z.string(), // Original icon ID (for reference)
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
    body = requestSchema.parse(await readBoundedJson(request))
  } catch (error) {
    if (error instanceof RequestBodyLimitError) return Response.json({ error: error.message }, { status: 413 })
    if (error instanceof z.ZodError) {
      return errorResponse(`Validation error: ${error.issues.map(e => e.message).join(', ')}`)
    }
    return errorResponse('Invalid request body')
  }

  const { projectId, iconId, selectedImageUrl, discardUrls } = body

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
    const timestamp = Date.now()

    // Get the original icon document (for reference/metadata)
    const originalIconDoc = await basePath.collection('icons').doc(iconId).get()
    const originalIcon = originalIconDoc.exists ? originalIconDoc.data() : null

    // Fetch selected variation
    const selectedImageRes = await fetch(selectedImageUrl)
    if (!selectedImageRes.ok) {
      return errorResponse('Failed to fetch selected image', 500)
    }
    const selectedBuffer = Buffer.from(await selectedImageRes.arrayBuffer())

    // Generate both iOS and Android sized icons
    const iOSBuffer = await sharp(selectedBuffer)
      .resize(ICON_SIZE_IOS, ICON_SIZE_IOS, {
        fit: 'cover',
        position: 'center',
      })
      .png()
      .toBuffer()

    const androidBuffer = await sharp(selectedBuffer)
      .resize(ICON_SIZE_ANDROID, ICON_SIZE_ANDROID, {
        fit: 'cover',
        position: 'center',
      })
      .png()
      .toBuffer()

    // Generate new icon ID
    const newIconId = `icon-edited-${timestamp}-${Math.random().toString(36).substr(2, 9)}`

    // Upload both sizes to permanent storage
    const iOSUploaded = await uploadFile({
      userId: projectContext.type === 'organization' ? undefined : authContext.userId,
      orgId: projectContext.orgId || undefined,
      projectId,
      category: 'icons',
      iconSize: 'ios',
      filename: `${newIconId}.png`,
      data: iOSBuffer,
      contentType: 'image/png',
    })

    const androidUploaded = await uploadFile({
      userId: projectContext.type === 'organization' ? undefined : authContext.userId,
      orgId: projectContext.orgId || undefined,
      projectId,
      category: 'icons',
      iconSize: 'android',
      filename: `${newIconId}.png`,
      data: androidBuffer,
      contentType: 'image/png',
    })

    // Also upload the original/high-res version
    const originalUploaded = await uploadFile({
      userId: projectContext.type === 'organization' ? undefined : authContext.userId,
      orgId: projectContext.orgId || undefined,
      projectId,
      category: 'icons',
      filename: `${newIconId}-original.png`,
      data: selectedBuffer,
      contentType: 'image/png',
    })

    // Create NEW icon document (preserve original)
    const newIconData = {
      id: newIconId,
      ios: iOSUploaded.url,
      iosKey: iOSUploaded.key,
      android: androidUploaded.url,
      androidKey: androidUploaded.key,
      originalUrl: originalUploaded.url,
      originalKey: originalUploaded.key,
      // Preserve style from original if available
      style: originalIcon?.style || 'edited',
      // Mark as edited from original
      editedFrom: iconId,
      source: 'edit',
      createdAt: now,
      createdBy: authContext.userId,
      timestamp,
    }

    await basePath.collection('icons').doc(newIconId).set(newIconData)

    // Update project timestamp
    await basePath.update({
      updatedAt: now,
    })

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
          action: 'icon_edit_created',
          newIconId,
          editedFromIconId: iconId,
        },
      })
    }

    return Response.json({
      success: true,
      icon: {
        id: newIconId,
        ios: iOSUploaded.url,
        iosKey: iOSUploaded.key,
        android: androidUploaded.url,
        androidKey: androidUploaded.key,
        originalUrl: originalUploaded.url,
        style: newIconData.style,
        editedFrom: iconId,
        timestamp,
      },
    })
  } catch (error) {
    console.error('Error saving edited icon:', error)
    return errorResponse(
      error instanceof Error ? error.message : 'Failed to save edited icon',
      500
    )
  }
}
