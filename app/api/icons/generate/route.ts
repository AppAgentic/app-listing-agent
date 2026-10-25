import { readBoundedJson, RequestBodyLimitError } from '@/lib/api/bounded-body'
import { NextRequest } from 'next/server'
import crypto from 'crypto'
import { z } from 'zod'
import { authenticateRequest, errorResponse, unauthorizedResponse } from '@/lib/api/auth'
import { getSession } from '@/lib/auth/session'
import { getAccountContext } from '@/lib/org/context'
import {
  createReservationErrorResponse,
  refundUsage,
  reserveUsage,
  settleUsage,
} from '@/lib/api/usage'
import { getProjectContext, hasContextPermission, AccountContext } from '@/lib/org/context'
import { generateIcon, IconSource } from '@/lib/services/icon-generator'
import { APP_CATEGORIES, isIconStyle, normalizeIconStyle } from '@/lib/constants'
import { logAuditEvent, AuditAction } from '@/lib/org/audit'
import { rateLimit, RATE_LIMITS } from '@/lib/api/rate-limit'
import { isAllowedImageUrl } from '@/lib/api/ssrf-protection'
import { adminDb } from '@/lib/firebase/admin'
import { Timestamp } from 'firebase-admin/firestore'
import { getIconEngine } from '@/lib/services/icon-engine'

const sourceSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('prompt'),
    prompt: z.string().min(10).max(10000),
  }),
  z.object({
    type: z.literal('metadata'),
    appMetadata: z.object({
      title: z.string().min(1).max(100),
      category: z.enum([...APP_CATEGORIES]).optional(),
      subtitle: z.string().max(100).optional(),
      description: z.string().max(10000).optional(),
      keywords: z.string().max(1000).optional(),
    }),
  }),
  z.object({
    type: z.literal('reference'),
    referenceImageUrl: z.string().url(),
    prompt: z.string().max(10000).optional(),
  }),
  z.object({
    type: z.literal('appstore'),
    appId: z.string().regex(/^\d+$/, 'App ID must be numeric'),
  }),
])

const requestSchema = z.object({
  projectId: z.string(),
  source: sourceSchema,
  style: z.string().refine(isIconStyle, 'Invalid icon style').optional(),
  concept: z.object({ subject: z.string().min(1).max(600), metaphor: z.string().min(1).max(600), colorIdea: z.string().min(1).max(600) }).optional(),
  colors: z.object({
    primary: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Invalid hex color'),
    secondary: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Invalid hex color').optional(),
  }).optional(),
  background: z.enum(['solid', 'gradient']).optional(),
})

export async function POST(request: NextRequest) {
  // Rate limit
  const rateLimitResult = await rateLimit(request, RATE_LIMITS.ai)
  if (!rateLimitResult.success) {
    return errorResponse('Rate limit exceeded. Please try again later.', 429)
  }

  // Authenticate - try session first, then API key
  let context: AccountContext | null = null

  // Try session-based auth (for web app)
  const session = await getSession()
  if (session) {
    context = await getAccountContext(session.userId)
  }

  // Fall back to API key auth (for external API calls)
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

  const { projectId, source, style, colors, background, concept } = body

  // Get project context
  const projectContext = await getProjectContext(context.userId, projectId)
  if (!projectContext) {
    return errorResponse('Project not found', 404)
  }

  // Check permission
  if (!hasContextPermission(projectContext, 'canCreateProjects')) {
    return errorResponse('Permission denied', 403)
  }

  // SSRF protection: validate reference image URL
  if (source.type === 'reference' && source.referenceImageUrl) {
    if (!isAllowedImageUrl(source.referenceImageUrl)) {
      return errorResponse('Invalid image URL. Only images from allowed domains are permitted.', 400)
    }
  }

  const creditWeight = getIconEngine().creditWeight
  const operationId = request.headers.get('idempotency-key') || crypto.randomUUID()
  const reservation = await reserveUsage(context, {
    operationId,
    usageType: 'icons',
    units: creditWeight,
    metadata: { route: '/api/icons/generate', projectId, model: getIconEngine().model },
  })
  if (!reservation.allowed) return createReservationErrorResponse(reservation)
  if (reservation.replayed) return errorResponse('This icon operation was already processed', 409)

  try {
    const result = await generateIcon(
      {
        source: source as IconSource,
        style: style && isIconStyle(style) ? style : undefined,
        colors,
        background,
        concept,
      },
      {
        userId: projectContext.type === 'personal' ? context.userId : undefined,
        orgId: projectContext.orgId,
        projectId,
      }
    )

    if (!result.success) {
      await refundUsage(context, operationId, 'icons')
      return errorResponse(result.error || 'Icon generation failed', 500)
    }

    // Generate a unique ID for the icon
    const iconId = `icon-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`

    // Extract prompt for storage
    const promptText = source.type === 'prompt' ? source.prompt :
                       source.type === 'metadata' ? source.appMetadata.title :
                       null

    // Save icon to Firestore
    const iconData = {
      id: iconId,
      style: style && isIconStyle(style) ? normalizeIconStyle(style) : null,
      prompt: promptText,
      concept: concept || null,
      originalUrl: result.originalUrl,
      ios: result.ios,
      android: result.android,
      createdAt: Timestamp.now(),
      createdBy: context.userId,
    }

    const iconsRef = projectContext.type === 'organization' && projectContext.orgId
      ? adminDb.collection('organizations').doc(projectContext.orgId).collection('projects').doc(projectId).collection('icons')
      : adminDb.collection('users').doc(context.userId).collection('projects').doc(projectId).collection('icons')

    await iconsRef.doc(iconId).set(iconData)

    await settleUsage(context, operationId, 'icons', creditWeight)

    // Log audit event
    if (projectContext.type === 'organization' && projectContext.orgId) {
      await logAuditEvent({
        orgId: projectContext.orgId,
        action: AuditAction.ICON_GENERATED,
        userId: context.userId,
        resourceType: 'project',
        resourceId: projectId,
        metadata: {
          sourceType: source.type,
          style,
        },
      })
    }

    return Response.json({
      success: true,
      id: iconId,
      concept: concept || null,
      style: style && isIconStyle(style) ? normalizeIconStyle(style) : null,
      originalUrl: result.originalUrl,
      ios: result.ios,
      android: result.android,
      timestamp: Date.now(),
    })
  } catch (error) {
    await refundUsage(context, operationId, 'icons')
    return errorResponse(
      error instanceof Error ? error.message : 'Icon generation failed',
      500
    )
  }
}
