import { NextRequest } from 'next/server'
import { authenticateRequest, errorResponse, unauthorizedResponse } from '@/lib/api/auth'
import { getAccountContext, AccountContext } from '@/lib/org/context'
import { getSession } from '@/lib/auth/session'
import { syncCustomProductPages } from '@/lib/mcp/tools/custom-product-pages'

async function getAuthContext(request: NextRequest): Promise<{ context: AccountContext | null; error?: string }> {
  const authHeader = request.headers.get('Authorization')
  if (authHeader) {
    const auth = await authenticateRequest(request)
    if (auth.authenticated && auth.context) return { context: auth.context }
    return { context: null, error: auth.error }
  }
  const session = await getSession()
  if (session) {
    const context = await getAccountContext(session.userId)
    if (context) return { context }
    return { context: null, error: 'User not found' }
  }
  return { context: null, error: 'Authentication required' }
}

// POST /api/custom-product-pages/push — Push CPPs to App Store Connect
export async function POST(request: NextRequest) {
  const { context: authContext, error: authError } = await getAuthContext(request)
  if (!authContext) return unauthorizedResponse(authError)

  let body: any
  try { body = await request.json() } catch { return errorResponse('Invalid request body') }
  const { projectId, pageIds, pushAll, force } = body
  if (!projectId) return errorResponse('projectId is required')

  try {
    const results = await syncCustomProductPages({
      projectId,
      direction: 'push',
      confirmed: true,
      pageIds,
      pushAll: pushAll ?? true,
      force,
    }, authContext)

    return Response.json(results, { status: results.success ? 200 : 207 })
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : 'Push failed', 500)
  }
}
