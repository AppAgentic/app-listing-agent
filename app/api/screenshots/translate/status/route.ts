import { NextRequest } from 'next/server'
import { authenticateRequest, errorResponse, unauthorizedResponse } from '@/lib/api/auth'
import { getAccountContext, AccountContext } from '@/lib/org/context'
import { getSession } from '@/lib/auth/session'
import {
  getTranslationJob,
  getActiveJobs,
  getProjectJobs,
  getResumableJobs,
  getAggregatedJobStatus,
  getLatestJobInChain
} from '@/lib/jobs/translation-job'

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

export async function GET(request: NextRequest) {
  // Authenticate
  const { context: authContext, error: authError } = await getAuthContext(request)
  if (!authContext) {
    return unauthorizedResponse(authError)
  }

  const { searchParams } = new URL(request.url)
  const jobId = searchParams.get('jobId')
  const projectId = searchParams.get('projectId')
  const listActive = searchParams.get('active') === 'true'
  const listResumable = searchParams.get('resumable') === 'true'

  try {
    // Get specific job (with chain aggregation for continuation support)
    if (jobId) {
      const job = await getTranslationJob(authContext.userId, jobId)
      if (!job) {
        console.log('[JobStatus] Job not found:', { userId: authContext.userId, jobId })
        return errorResponse('Job not found', 404)
      }

      // Check if this job is part of a continuation chain
      const aggregated = await getAggregatedJobStatus(authContext.userId, jobId)
      const latestJob = await getLatestJobInChain(authContext.userId, jobId)

      console.log('[JobStatus] Job chain info:', {
        requestedJobId: jobId,
        requestedJobStatus: job.status,
        latestJobId: latestJob?.id,
        latestJobStatus: latestJob?.status,
        chainLength: aggregated?.chainLength,
        aggregatedStatus: aggregated?.status,
      })

      if (aggregated && aggregated.chainLength > 1) {
        // Return aggregated status for chained jobs
        return Response.json({
          jobId: aggregated.rootJobId,
          currentJobId: aggregated.currentJobId,
          status: aggregated.status,
          progress: aggregated.totalProgress,
          results: aggregated.allResults,
          error: aggregated.error,
          config: job.config, // Include original config for restoring state
          createdAt: aggregated.createdAt,
          completedAt: aggregated.completedAt,
          chainLength: aggregated.chainLength,
          isChained: true,
        })
      }

      // Single job (no chain)
      return Response.json({
        jobId: job.id,
        status: job.status,
        progress: job.progress,
        results: job.results,
        error: job.error,
        config: job.config, // Include config for restoring state on page refresh
        createdAt: job.createdAt,
        startedAt: job.startedAt,
        completedAt: job.completedAt,
        continuedBy: job.continuedBy, // Include if it has a continuation
        isChained: false,
      })
    }

    // List resumable jobs for a project
    if (projectId && listResumable) {
      const jobs = await getResumableJobs(authContext.userId, projectId)
      return Response.json({
        jobs: jobs.map(job => {
          const successCount = job.results?.filter(r => r.success).length || 0
          const failCount = job.results?.filter(r => !r.success).length || 0
          return {
            jobId: job.id,
            status: job.status,
            progress: job.progress,
            successCount,
            failCount,
            totalResults: job.results?.length || 0,
            config: job.config,
            createdAt: job.createdAt,
            completedAt: job.completedAt,
            error: job.error,
          }
        }),
      })
    }

    // List jobs for a project
    if (projectId) {
      const jobs = await getProjectJobs(authContext.userId, projectId)
      return Response.json({
        jobs: jobs.map(job => ({
          jobId: job.id,
          status: job.status,
          progress: job.progress,
          resultsCount: job.results.length,
          config: job.config, // Include config for restoring state on page load
          createdAt: job.createdAt,
          completedAt: job.completedAt,
        })),
      })
    }

    // List active jobs
    if (listActive) {
      const jobs = await getActiveJobs(authContext.userId)
      return Response.json({
        jobs: jobs.map(job => ({
          jobId: job.id,
          projectId: job.projectId,
          status: job.status,
          progress: job.progress,
          config: job.config, // Include config for restoring state on page load
          createdAt: job.createdAt,
        })),
      })
    }

    return errorResponse('Must provide jobId, projectId, or active=true')
  } catch (error) {
    console.error('Error getting translation job status:', error)
    return errorResponse(
      error instanceof Error ? error.message : 'Failed to get job status',
      500
    )
  }
}
