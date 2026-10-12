import { NextRequest } from 'next/server'
import { authenticateRequest, errorResponse, unauthorizedResponse } from '@/lib/api/auth'
import { getAccountContext, AccountContext } from '@/lib/org/context'
import { getSession } from '@/lib/auth/session'
import { adminDb } from '@/lib/firebase/admin'

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
  const { context, error } = await getAuthContext(request)
  if (!context) {
    return unauthorizedResponse(error)
  }

  const projectId = request.nextUrl.searchParams.get('projectId')
  if (!projectId) {
    return errorResponse('projectId is required')
  }

  try {
    const jobsSnapshot = await adminDb
      .collection('screenshotJobs')
      .where('userId', '==', context.userId)
      .where('projectId', '==', projectId)
      .where('status', '==', 'completed')
      .orderBy('createdAt', 'desc')
      .limit(20)
      .get()

    const jobs = jobsSnapshot.docs.map(doc => {
      const data = doc.data()
      return {
        id: doc.id,
        status: data.status,
        toolName: data.toolName,
        totalScreenshots: data.totalScreenshots,
        completedScreenshots: data.completedScreenshots,
        results: data.results || [],
        stats: data.stats || null,
        createdAt: data.createdAt?.toDate?.().toISOString() || null,
        updatedAt: data.updatedAt?.toDate?.().toISOString() || null,
      }
    })

    return Response.json({ success: true, jobs })
  } catch (err) {
    // Firestore may require a composite index on first query
    const message = err instanceof Error ? err.message : 'Failed to fetch jobs'
    if (message.includes('index')) {
      return Response.json({
        success: true,
        jobs: [],
        indexRequired: true,
        message: 'Firestore composite index required. Check server logs for the creation link.'
      })
    }
    return errorResponse(message)
  }
}
