import { readBoundedJson, RequestBodyLimitError } from '@/lib/api/bounded-body'
import { saveIconRecord } from '@/lib/services/icon-records'
import { NextRequest } from 'next/server'
import crypto from 'crypto'
import { z } from 'zod'
import { authenticateRequest, errorResponse, unauthorizedResponse } from '@/lib/api/auth'
import { getSession } from '@/lib/auth/session'
import { getAccountContext, AccountContext } from '@/lib/org/context'
import {
  createReservationErrorResponse,
  refundUsage,
  reserveUsage,
  settleUsage,
} from '@/lib/api/usage'
import { getProjectContext, hasContextPermission } from '@/lib/org/context'
import { generateIconVariations } from '@/lib/services/icon-generator'
import { logAuditEvent, AuditAction } from '@/lib/org/audit'
import { rateLimit, RATE_LIMITS } from '@/lib/api/rate-limit'
import { getIconEngine } from '@/lib/services/icon-engine'

const requestSchema = z.object({
  projectId: z.string(),
  prompt: z.string().min(10).max(500),
  colors: z.object({
    primary: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Invalid hex color'),
    secondary: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Invalid hex color').optional(),
  }).optional(),
})

export async function POST(request: NextRequest) {
  // Rate limit
  const rateLimitResult = await rateLimit(request, RATE_LIMITS.ai)
  if (!rateLimitResult.success) {
    return errorResponse('Rate limit exceeded. Please try again later.', 429)
  }

  // Authenticate - try session first, then API key
  let context: AccountContext | null = null

  const session = await getSession()
  if (session) {
    context = await getAccountContext(session.userId)
  }

  if (!context) {
    const auth = await authenticateRequest(request)
    if (!auth.authenticated || !auth.context) {
      return unauthorizedResponse(auth.error)
    }
    context = auth.context
  }

  if (!context) {
    return unauthorizedResponse('Authentication failed')
  }

  // Parse request
  let body
  try {
    body = requestSchema.parse(await readBoundedJson(request))
  } catch (error) {
    if (error instanceof RequestBodyLimitError) return Response.json({ error: error.message }, { status: 413 })
    if (error instanceof z.ZodError) {
      return errorResponse(`Invalid request: ${error.issues[0]?.message || 'Validation failed'}`)
    }
    return errorResponse('Invalid request body')
  }

  const { projectId, prompt, colors } = body

  // Get project context
  const projectContext = await getProjectContext(context.userId, projectId)
  if (!projectContext) {
    return errorResponse('Project not found', 404)
  }

  // Check permission
  if (!hasContextPermission(projectContext, 'canCreateProjects')) {
    return errorResponse('Permission denied', 403)
  }

  const creditWeight = getIconEngine().creditWeight
  const operationId = request.headers.get('idempotency-key') || crypto.randomUUID()
  const reservation = await reserveUsage(context, {
    operationId,
    usageType: 'icons',
    units: 4 * creditWeight,
    metadata: { route: '/api/icons/generate-variations', projectId, model: getIconEngine().model },
  })
  if (!reservation.allowed) return createReservationErrorResponse(reservation)
  if (reservation.replayed) return errorResponse('This icon operation was already processed', 409)

  try {
    const variations = await generateIconVariations(
      prompt,
      {
        userId: projectContext.type === 'personal' ? context.userId : undefined,
        orgId: projectContext.orgId,
        projectId,
      },
      colors
    )

    const savedIds = new Map<string, string>()
    for (const variation of variations) {
      if (!variation.icon.success) continue
      try {
        savedIds.set(variation.icon.originalUrl, await saveIconRecord(variation.icon, {
          userId: context.userId, orgId: projectContext.orgId, projectId, style: variation.style, prompt,
        }))
      } catch {
        variation.icon.success = false
        variation.icon.error = 'Could not save icon; this variation was not charged'
      }
    }

    const successCount = variations.filter(v => v.icon.success).length

    if (successCount === 0) {
      await refundUsage(context, operationId, 'icons')
      return errorResponse('All icon variations failed to generate', 500)
    }

    await settleUsage(context, operationId, 'icons', successCount * creditWeight)

    // Log audit event
    if (projectContext.type === 'organization' && projectContext.orgId) {
      await logAuditEvent({
        orgId: projectContext.orgId,
        action: AuditAction.ICON_GENERATED,
        userId: context.userId,
        resourceType: 'project',
        resourceId: projectId,
        metadata: {
          operation: 'variations',
          count: successCount,
          prompt,
        },
      })
    }

    return Response.json({
      success: true,
      variations: variations.map(v => ({
        id: savedIds.get(v.icon.originalUrl),
        style: v.style,
        success: v.icon.success,
        originalUrl: v.icon.originalUrl,
        ios: v.icon.ios,
        android: v.icon.android,
        error: v.icon.error,
      })),
    })
  } catch (error) {
    await refundUsage(context, operationId, 'icons')
    return errorResponse(
      error instanceof Error ? error.message : 'Icon variations generation failed',
      500
    )
  }
}
