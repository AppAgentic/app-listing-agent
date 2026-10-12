import { NextRequest } from 'next/server'
import crypto from 'crypto'
import { z } from 'zod'
import { errorResponse, unauthorizedResponse } from '@/lib/api/auth'
import { getProjectContext, hasContextPermission, getAccountContext, AccountContext } from '@/lib/org/context'
import { getSession } from '@/lib/auth/session'
import { adminDb } from '@/lib/firebase/admin'
import { runComplianceCheck, AIComplianceIssue as SharedAIComplianceIssue } from '@/lib/services/compliance'
import { AI_MODELS } from '@/lib/billing/catalog'
import { createReservationErrorResponse, refundUsage, reserveUsage, settleUsage } from '@/lib/api/usage'

const requestSchema = z.object({
  projectId: z.string(),
  locale: z.string(),
  storeType: z.enum(['ios', 'android']).optional().default('ios'),
  metadata: z.object({
    name: z.string().optional(),
    subtitle: z.string().optional(),
    keywords: z.string().optional(),
    description: z.string().optional(),
    whatsNew: z.string().optional(),
    promotionalText: z.string().optional(),
    privacyUrl: z.string().nullable().optional(),
    // Android/Play Store fields
    shortDescription: z.string().optional(),
    fullDescription: z.string().optional(),
  }),
})

// Helper to get auth context
async function getAuthContext(request: NextRequest): Promise<{ context: AccountContext | null; error?: string }> {
  const authHeader = request.headers.get('Authorization')
  if (authHeader) {
    const { authenticateRequest } = await import('@/lib/api/auth')
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

export type AIComplianceIssue = SharedAIComplianceIssue

export async function POST(request: NextRequest) {
  const { context: authContext, error: authError } = await getAuthContext(request)
  if (!authContext) {
    return unauthorizedResponse(authError)
  }

  let body
  try {
    body = requestSchema.parse(await request.json())
  } catch {
    return errorResponse('Invalid request body')
  }

  const { projectId, locale, metadata, storeType } = body

  const projectContext = await getProjectContext(authContext.userId, projectId)
  if (!projectContext) {
    return errorResponse('Project not found', 404)
  }

  if (!hasContextPermission(projectContext, 'canCreateProjects')) {
    return errorResponse('Permission denied', 403)
  }

  if (!process.env.GEMINI_API_KEY) {
    return errorResponse('AI service not configured', 503)
  }

  // Base path for this project
  const isOrgProject = projectContext.type === 'organization' && projectContext.orgId
  const basePath = isOrgProject
    ? adminDb.collection('organizations').doc(projectContext.orgId!).collection('projects').doc(projectId)
    : adminDb.collection('users').doc(authContext.userId).collection('projects').doc(projectId)

  const operationId = request.headers.get('idempotency-key') || crypto.randomUUID()
  const reservation = await reserveUsage(authContext, {
    operationId,
    usageType: 'translations',
    units: 1,
    metadata: { route: '/api/ai/compliance-check', projectId, model: AI_MODELS.textQuality },
  })
  if (!reservation.allowed) return createReservationErrorResponse(reservation)
  if (reservation.replayed) return errorResponse('This compliance check was already processed', 409)

  try {
    const analysis = await runComplianceCheck({
      projectId,
      locale,
      storeType,
      metadata,
      basePath,
    })
    await settleUsage(authContext, operationId, 'translations', 1)

    return Response.json({
      success: true,
      issues: analysis.issues,
      legalStatus: analysis.legalStatus,
      effectivePrivacyUrl: analysis.effectivePrivacyUrl,
      effectiveTermsUrl: analysis.effectiveTermsUrl,
      appContext: analysis.appContext,
    })
  } catch (error) {
    await refundUsage(authContext, operationId, 'translations')
    console.error('AI compliance check failed:', error)
    return errorResponse(
      error instanceof Error ? error.message : 'AI compliance check failed',
      500
    )
  }
}
