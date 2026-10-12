import { NextRequest } from 'next/server'
import crypto from 'crypto'
import { z } from 'zod'
import { authenticateRequest, errorResponse, unauthorizedResponse } from '@/lib/api/auth'
import { getProjectContext, hasContextPermission, getAccountContext, AccountContext } from '@/lib/org/context'
import { getSession } from '@/lib/auth/session'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { AI_MODELS } from '@/lib/billing/catalog'
import { createReservationErrorResponse, refundUsage, reserveUsage, settleUsage } from '@/lib/api/usage'

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)

const requestSchema = z.object({
  projectId: z.string(),
  field: z.string(),
  currentValue: z.string(),
  locale: z.string(),
  prompt: z.string(),
  referenceValue: z.string().nullable().optional(),
})

// Helper to get auth context from either API key or session
async function getAuthContext(request: NextRequest): Promise<{ context: AccountContext | null; error?: string }> {
  // First try API key / header-based auth
  const authHeader = request.headers.get('Authorization')
  if (authHeader) {
    const auth = await authenticateRequest(request)
    if (auth.authenticated && auth.context) {
      return { context: auth.context }
    }
    return { context: null, error: auth.error }
  }

  // Fallback to session-based auth (cookie-based)
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

// Field-specific constraints
const FIELD_LIMITS: Record<string, number> = {
  name: 30,
  subtitle: 30,
  keywords: 100,
  description: 4000,
  whatsNew: 4000,
  promotionalText: 170,
}

export async function POST(request: NextRequest) {
  // Authenticate (supports both API key and session)
  const { context: authContext, error: authError } = await getAuthContext(request)
  if (!authContext) {
    return unauthorizedResponse(authError)
  }

  // Parse request
  let body
  try {
    body = requestSchema.parse(await request.json())
  } catch (error) {
    return errorResponse('Invalid request body')
  }

  const { projectId, field, currentValue, locale, prompt, referenceValue } = body

  // Get project context
  const projectContext = await getProjectContext(authContext.userId, projectId)
  if (!projectContext) {
    return errorResponse('Project not found', 404)
  }

  // Check permission
  if (!hasContextPermission(projectContext, 'canCreateProjects')) {
    return errorResponse('Permission denied', 403)
  }

  // Check if Gemini API key is configured
  if (!process.env.GEMINI_API_KEY) {
    return errorResponse('AI service not configured. Please set GEMINI_API_KEY.', 503)
  }

  // Get character limit for field
  const charLimit = FIELD_LIMITS[field] || 4000

  // Build the AI prompt
  const systemPrompt = buildEnhancePrompt(field, currentValue, locale, prompt, referenceValue, charLimit)
  const operationId = request.headers.get('idempotency-key') || crypto.randomUUID()
  const reservation = await reserveUsage(authContext, {
    operationId,
    usageType: 'translations',
    units: 1,
    metadata: { route: '/api/ai/enhance', projectId, model: AI_MODELS.textFast },
  })
  if (!reservation.allowed) return createReservationErrorResponse(reservation)
  if (reservation.replayed) return errorResponse('This enhancement was already processed', 409)

  try {
    const model = genAI.getGenerativeModel({ model: AI_MODELS.textFast })
    const result = await model.generateContent(systemPrompt)
    const enhanced = result.response.text().trim()

    // Ensure it's within limits
    const finalText = enhanced.length > charLimit
      ? enhanced.substring(0, charLimit).trim()
      : enhanced
    await settleUsage(authContext, operationId, 'translations', 1)

    return Response.json({
      success: true,
      enhanced: finalText,
    })
  } catch (error) {
    await refundUsage(authContext, operationId, 'translations')
    console.error('AI enhancement failed:', error)
    return errorResponse(
      error instanceof Error ? error.message : 'AI enhancement failed',
      500
    )
  }
}

function buildEnhancePrompt(
  field: string,
  currentValue: string,
  locale: string,
  userPrompt: string,
  referenceValue: string | null | undefined,
  charLimit: number
): string {
  const fieldName = {
    name: 'App Name',
    subtitle: 'Subtitle',
    keywords: 'Keywords',
    description: 'Description',
    whatsNew: "What's New",
    promotionalText: 'Promotional Text',
  }[field] || field

  let prompt = `You are an expert App Store copywriter and optimizer. Your task is to modify the ${fieldName} field for an app listing.

LOCALE: ${locale}
CHARACTER LIMIT: ${charLimit} characters (MUST NOT exceed this)

CURRENT VALUE:
${currentValue || '(empty)'}
`

  if (referenceValue) {
    prompt += `
REFERENCE (primary language version for context):
${referenceValue}
`
  }

  prompt += `
USER REQUEST:
${userPrompt}

INSTRUCTIONS:
1. Apply the user's requested changes to the current value
2. Keep the result in the same language (${locale})
3. MUST stay under ${charLimit} characters
4. Maintain App Store optimization best practices
5. Keep the tone professional and engaging
${field === 'keywords' ? '6. Keep keywords comma-separated without spaces after commas' : ''}
${field === 'description' || field === 'whatsNew' ? '6. Preserve any existing formatting like bullet points and line breaks' : ''}

Return ONLY the enhanced text, nothing else. No explanations, no quotes, just the final text.`

  return prompt
}
