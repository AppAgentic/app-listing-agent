import { NextRequest } from 'next/server'
import crypto from 'crypto'
import { z } from 'zod'
import { authenticateRequest, errorResponse, unauthorizedResponse } from '@/lib/api/auth'
import { getProjectContext, hasContextPermission, getAccountContext, AccountContext } from '@/lib/org/context'
import { getSession } from '@/lib/auth/session'
import { adminDb } from '@/lib/firebase/admin'
import { createReservationErrorResponse, refundUsage, reserveUsage, settleUsage } from '@/lib/api/usage'
import { uploadFile } from '@/lib/services/r2'
import { getIconEngine, isAcceptableReference, renderIconImage } from '@/lib/services/icon-engine'
import { ICON_CONSTRAINTS } from '@/lib/services/icon-prompt'

const requestSchema = z.object({
  projectId: z.string(),
  iconId: z.string(),
  prompt: z.string().min(1, 'Edit prompt is required').max(4000, 'Edit prompt is too long'),
  contextImageUrls: z.array(z.string()).max(4).optional(), // Reference images (up to 4)
  variationCount: z.number().int().min(1).max(4).default(1),
  currentImageUrl: z.string().optional(), // For iterative editing (use a variation as new base)
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

  const { projectId, iconId, prompt, contextImageUrls, variationCount, currentImageUrl } = body

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

  let operationId: string | null = null
  try {
    // Determine the current image URL to edit
    let imageToEdit = currentImageUrl

    if (!imageToEdit) {
      // Fetch the current icon
      const iconDoc = await basePath.collection('icons').doc(iconId).get()
      if (!iconDoc.exists) {
        return errorResponse('Icon not found', 404)
      }
      const iconData = iconDoc.data()!

      // Use iOS URL as the source (highest resolution)
      imageToEdit = iconData.ios || iconData.android
    }

    if (!imageToEdit) {
      return errorResponse('Icon image URL not found', 404)
    }

    const creditWeight = getIconEngine().creditWeight
    operationId = request.headers.get('idempotency-key') || crypto.randomUUID()
    const reservation = await reserveUsage(authContext, {
      operationId,
      usageType: 'icons',
      units: variationCount * creditWeight,
      metadata: { route: '/api/icons/edit', projectId, model: getIconEngine().model },
    })
    if (!reservation.allowed) return createReservationErrorResponse(reservation)
    if (reservation.replayed) return errorResponse('This icon edit was already processed', 409)

    // Generate variations
    const variations: Array<{ id: string; imageUrl: string }> = []
    const errors: string[] = []

    const imageUrls = [imageToEdit, ...(contextImageUrls || [])]
    if (imageUrls.some(url => !isAcceptableReference(url))) {
      await refundUsage(authContext, operationId, 'icons')
      return errorResponse('Invalid reference image URL', 400)
    }
    const renderVariation = async () => {
      try {
        const data = await renderIconImage(`Edit the FIRST image. Other images are style references. Preserve the core identity and change only what is requested. EDIT: ${prompt}\n${ICON_CONSTRAINTS}`, imageUrls)
        const uploaded = await uploadFile({
          userId: projectContext.type === 'organization' ? undefined : authContext.userId,
          orgId: projectContext.orgId || undefined, projectId,
          category: 'temp-edit', preservePng: true, filename: `icon-edit-${iconId}-${crypto.randomUUID()}.png`, data, contentType: 'image/png',
        })
        variations.push({ id: `variation-${crypto.randomUUID()}`, imageUrl: uploaded.url })
      } catch (error) { errors.push(error instanceof Error ? error.message : 'Edit failed') }
    }
    // Two at a time keeps four variations well inside the request timeout without bursting the provider.
    for (let i = 0; i < variationCount; i += 2) {
      await Promise.all(Array.from({ length: Math.min(2, variationCount - i) }, renderVariation))
    }

    if (variations.length === 0) {
      await refundUsage(authContext, operationId, 'icons')
      return errorResponse(`All variations failed: ${errors.join(', ')}`)
    }

    const creditsUsed = variations.length * creditWeight
    await settleUsage(authContext, operationId, 'icons', creditsUsed)

    return Response.json({
      success: true,
      variations,
      creditsUsed,
      errors: errors.length > 0 ? errors : undefined,
    })
  } catch (error) {
    if (operationId) await refundUsage(authContext, operationId, 'icons')
    console.error('Error editing icon:', error)
    return errorResponse(
      error instanceof Error ? error.message : 'Failed to edit icon',
      500
    )
  }
}
