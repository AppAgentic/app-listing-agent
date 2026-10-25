import { readBoundedJson, RequestBodyLimitError } from '@/lib/api/bounded-body'
import { NextRequest } from 'next/server'
import { z } from 'zod'
import { authenticateRequest, errorResponse, unauthorizedResponse } from '@/lib/api/auth'
import { getProjectContext, hasContextPermission, getAccountContext, AccountContext } from '@/lib/org/context'
import { getSession } from '@/lib/auth/session'
import { checkUsageLimit } from '@/lib/api/usage'

const requestSchema = z.object({
  projectId: z.string(),
  operations: z.object({
    screenshotGeneration: z.number().min(0).default(0),
    variantGeneration: z.number().min(0).default(0),
    headlineSuggestions: z.number().min(0).default(0),
  }),
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

// Credit costs per operation
const CREDIT_COSTS = {
  screenshotGeneration: 1,  // 1 credit per screenshot
  variantGeneration: 1,     // 1 credit per variant
  headlineSuggestions: 0,   // Free (bundled)
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

  const { projectId, operations } = body

  // Get project context
  const projectContext = await getProjectContext(authContext.userId, projectId)
  if (!projectContext) {
    return errorResponse('Project not found', 404)
  }

  // Check permission
  if (!hasContextPermission(projectContext, 'canCreateProjects')) {
    return errorResponse('Permission denied', 403)
  }

  try {
    // Calculate total credits needed
    const screenshotCredits = operations.screenshotGeneration * CREDIT_COSTS.screenshotGeneration
    const variantCredits = operations.variantGeneration * CREDIT_COSTS.variantGeneration
    const headlineCredits = operations.headlineSuggestions * CREDIT_COSTS.headlineSuggestions
    const totalCredits = screenshotCredits + variantCredits + headlineCredits

    // Check current usage and limits
    const usageCheck = await checkUsageLimit(authContext, 'screenshots', totalCredits)

    // Hard caps: estimate whether the requested work can be reserved.
    const remaining = usageCheck.remaining
    const limit = usageCheck.limit

    return Response.json({
      success: true,
      credits: {
        screenshotGeneration: screenshotCredits,
        variantGeneration: variantCredits,
        headlineSuggestions: headlineCredits,
        total: totalCredits,
        remaining,
        limit,
        allowed: usageCheck.allowed,
        wouldExceedLimit: !usageCheck.allowed,
        isOverage: false,
      },
    })
  } catch (error) {
    console.error('Error checking credits:', error)
    return errorResponse(
      error instanceof Error ? error.message : 'Failed to check credits',
      500
    )
  }
}
