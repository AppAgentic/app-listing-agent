import { NextRequest } from 'next/server'
import { authenticateRequest, errorResponse, unauthorizedResponse } from '@/lib/api/auth'
import { getProjectContext } from '@/lib/org/context'
import { adminDb } from '@/lib/firebase/admin'
import type { MetadataHistoryEntry } from '@/lib/firebase/firestore'

export async function GET(request: NextRequest) {
  // Authenticate
  const auth = await authenticateRequest(request)
  if (!auth.authenticated || !auth.context) {
    return unauthorizedResponse(auth.error)
  }

  // Get params from query
  const { searchParams } = new URL(request.url)
  const projectId = searchParams.get('projectId')
  const limit = parseInt(searchParams.get('limit') || '20', 10)
  const offset = parseInt(searchParams.get('offset') || '0', 10)

  if (!projectId) {
    return errorResponse('projectId is required')
  }

  // Get project context
  const projectContext = await getProjectContext(auth.context.userId, projectId)
  if (!projectContext) {
    return errorResponse('Project not found', 404)
  }

  // Get base path for this project
  const basePath = projectContext.type === 'organization' && projectContext.orgId
    ? adminDb
        .collection('organizations')
        .doc(projectContext.orgId)
        .collection('projects')
        .doc(projectId)
    : adminDb
        .collection('users')
        .doc(auth.context.userId)
        .collection('projects')
        .doc(projectId)

  // Get history entries
  const historySnapshot = await basePath
    .collection('metadataHistory')
    .orderBy('version', 'desc')
    .limit(limit)
    .offset(offset)
    .get()

  const history: MetadataHistoryEntry[] = historySnapshot.docs.map(doc => ({
    id: doc.id,
    ...doc.data(),
  } as MetadataHistoryEntry))

  // Get total count
  const countSnapshot = await basePath.collection('metadataHistory').count().get()
  const total = countSnapshot.data().count

  return Response.json({
    success: true,
    history,
    pagination: {
      total,
      limit,
      offset,
      hasMore: offset + limit < total,
    },
  })
}
