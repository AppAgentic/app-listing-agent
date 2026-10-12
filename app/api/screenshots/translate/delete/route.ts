import { NextRequest } from 'next/server'
import { z } from 'zod'
import { errorResponse, unauthorizedResponse } from '@/lib/api/auth'
import { getAccountContext, AccountContext } from '@/lib/org/context'
import { getSession } from '@/lib/auth/session'
import { adminDb } from '@/lib/firebase/admin'
import { getTranslationJob } from '@/lib/jobs/translation-job'

const deleteJobSchema = z.object({
  jobId: z.string(),
})

// Helper to get auth context
async function getAuthContext(request: NextRequest): Promise<{ context: AccountContext | null; userId?: string; error?: string }> {
  const session = await getSession()
  if (session) {
    const context = await getAccountContext(session.userId)
    if (context) {
      return { context, userId: session.userId }
    }
    return { context: null, error: 'User not found' }
  }
  return { context: null, error: 'Authentication required' }
}

export async function POST(request: NextRequest) {
  // Authenticate
  const { context: authContext, userId, error: authError } = await getAuthContext(request)
  if (!authContext || !userId) {
    return unauthorizedResponse(authError)
  }

  // Parse request
  let body
  try {
    body = deleteJobSchema.parse(await request.json())
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(`Validation error: ${error.errors.map(e => e.message).join(', ')}`)
    }
    return errorResponse('Invalid request body')
  }

  const { jobId } = body

  try {
    // Verify the job exists and belongs to this user
    const job = await getTranslationJob(userId, jobId)
    if (!job) {
      return errorResponse('Job not found', 404)
    }

    // Only allow deleting completed, failed, or cancelled jobs
    if (job.status === 'pending' || job.status === 'processing') {
      return errorResponse('Cannot delete an active job. Cancel it first.')
    }

    // Delete the job
    await adminDb
      .collection('users')
      .doc(userId)
      .collection('translationJobs')
      .doc(jobId)
      .delete()

    return Response.json({
      success: true,
      message: 'Job deleted successfully',
    })
  } catch (error) {
    console.error('Error deleting translation job:', error)
    return errorResponse(
      error instanceof Error ? error.message : 'Failed to delete translation job',
      500
    )
  }
}
