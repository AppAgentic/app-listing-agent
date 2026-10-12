import { NextRequest } from 'next/server'
import { z } from 'zod'
import { authenticateRequest, errorResponse, unauthorizedResponse } from '@/lib/api/auth'
import { getAccountContext, AccountContext } from '@/lib/org/context'
import { getSession } from '@/lib/auth/session'
import { cancelJob, getTranslationJob, getLatestJobInChain } from '@/lib/jobs/translation-job'

const cancelJobSchema = z.object({
  jobId: z.string(),
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
    body = cancelJobSchema.parse(await request.json())
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(`Validation error: ${error.errors.map(e => e.message).join(', ')}`)
    }
    return errorResponse('Invalid request body')
  }

  const { jobId } = body

  try {
    // Verify job exists and belongs to user
    const job = await getTranslationJob(authContext.userId, jobId)
    if (!job) {
      console.log('[CancelJob] Job not found:', { userId: authContext.userId, jobId })
      return errorResponse('Job not found', 404)
    }

    console.log('[CancelJob] Found job:', { jobId, status: job.status, projectId: job.projectId })

    // Find the latest job in the chain (in case of auto-continuation)
    const latestJob = await getLatestJobInChain(authContext.userId, jobId)

    console.log('[CancelJob] Latest job in chain:', {
      latestJobId: latestJob?.id,
      latestJobStatus: latestJob?.status,
    })

    // Determine which job to cancel:
    // 1. If the original job is still active, cancel it
    // 2. If the latest job in chain is active, cancel that
    // 3. Otherwise, the job cannot be cancelled
    let jobToCancel = job

    if (job.status === 'pending' || job.status === 'processing') {
      // Original job is still active - cancel it
      jobToCancel = job
    } else if (latestJob && (latestJob.status === 'pending' || latestJob.status === 'processing')) {
      // Latest job in chain is active - cancel that
      jobToCancel = latestJob
    } else if (latestJob) {
      // Neither is active
      console.log('[CancelJob] Cannot cancel - no active job found. Original status:', job.status, 'Latest status:', latestJob.status)
      return errorResponse(`Job cannot be cancelled - original job is '${job.status}', chain latest is '${latestJob.status}'`)
    } else {
      // No chain, original not active
      console.log('[CancelJob] Cannot cancel - job status is:', job.status)
      return errorResponse(`Job cannot be cancelled - current status is '${job.status}'`)
    }

    console.log('[CancelJob] Job to cancel:', {
      jobId: jobToCancel.id,
      status: jobToCancel.status,
      isChained: jobToCancel.id !== jobId
    })

    // Cancel the active job
    const cancelled = await cancelJob(authContext.userId, jobToCancel.id)

    if (!cancelled) {
      console.log('[CancelJob] cancelJob returned false for:', jobToCancel.id)
      return errorResponse('Job cannot be cancelled (status may have changed)')
    }

    return Response.json({
      success: true,
      message: 'Job cancelled successfully',
      cancelledJobId: jobToCancel.id,
      wasChained: jobToCancel.id !== jobId,
    })
  } catch (error) {
    console.error('Error cancelling translation job:', error)
    return errorResponse(
      error instanceof Error ? error.message : 'Failed to cancel job',
      500
    )
  }
}
