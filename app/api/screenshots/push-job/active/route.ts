import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest, errorResponse, unauthorizedResponse } from '@/lib/api/auth'
import { getAccountContext, AccountContext } from '@/lib/org/context'
import { getSession } from '@/lib/auth/session'
import { getProjectPushJobs } from '@/lib/jobs/push-job'

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

// GET - Get active push jobs for a project
export async function GET(request: NextRequest) {
  // Authenticate
  const { context: authContext, error: authError } = await getAuthContext(request)
  if (!authContext) {
    return unauthorizedResponse(authError)
  }

  // Get projectId from query params
  const url = new URL(request.url)
  const projectId = url.searchParams.get('projectId')

  if (!projectId) {
    return errorResponse('projectId is required', 400)
  }

  try {
    // Get recent push jobs for this project
    const jobs = await getProjectPushJobs(authContext.userId, projectId, 5)

    // Filter to only active jobs (pending or processing)
    const activeJobs = jobs.filter(job =>
      job.status === 'pending' || job.status === 'processing'
    )

    // Return active jobs with essential info
    return NextResponse.json({
      activeJobs: activeJobs.map(job => ({
        jobId: job.id,
        status: job.status,
        statusMessage: job.statusMessage,
        progress: job.progress,
        createdAt: job.createdAt,
        startedAt: job.startedAt,
        config: job.config,
      })),
    })
  } catch (error) {
    console.error('[Push Jobs API] Error fetching active jobs:', error)
    // Return empty array on error to avoid breaking the UI
    return NextResponse.json({ activeJobs: [] })
  }
}
