import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest, errorResponse, unauthorizedResponse } from '@/lib/api/auth'
import { getAccountContext, AccountContext } from '@/lib/org/context'
import { getSession } from '@/lib/auth/session'
import { getPushJob, cancelPushJob, getAggregatedPushJobStatus } from '@/lib/jobs/push-job'

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

// GET - Get job status
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const { jobId } = await params

  // Authenticate
  const { context: authContext, error: authError } = await getAuthContext(request)
  if (!authContext) {
    return unauthorizedResponse(authError)
  }

  // Check for aggregated status request
  const url = new URL(request.url)
  const aggregated = url.searchParams.get('aggregated') === 'true'

  if (aggregated) {
    const status = await getAggregatedPushJobStatus(authContext.userId, jobId)
    if (!status) {
      return errorResponse('Job not found', 404)
    }
    return NextResponse.json(status)
  }

  // Get the job
  const job = await getPushJob(authContext.userId, jobId)
  if (!job) {
    return errorResponse('Job not found', 404)
  }

  return NextResponse.json(job)
}

// DELETE - Cancel job
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const { jobId } = await params

  // Authenticate
  const { context: authContext, error: authError } = await getAuthContext(request)
  if (!authContext) {
    return unauthorizedResponse(authError)
  }

  // Cancel the job
  const cancelled = await cancelPushJob(authContext.userId, jobId)
  if (!cancelled) {
    return errorResponse('Cannot cancel job - it may not exist or is already completed', 400)
  }

  return NextResponse.json({ success: true, message: 'Job cancelled' })
}
