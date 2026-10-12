import { NextRequest } from 'next/server'
import { z } from 'zod'
import { authenticateRequest, errorResponse, unauthorizedResponse } from '@/lib/api/auth'
import { getProjectContext, hasContextPermission, getAccountContext, AccountContext } from '@/lib/org/context'
import { getSession } from '@/lib/auth/session'
import { adminDb } from '@/lib/firebase/admin'
import { Timestamp } from 'firebase-admin/firestore'

const setAvailabilitySchema = z.object({
  projectId: z.string(),
  availableForSale: z.boolean(),
  availableInAllTerritories: z.boolean().default(true),
})

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

// GET /api/iap/[iapId]/availability - Get availability settings
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ iapId: string }> }
) {
  const { context: authContext, error: authError } = await getAuthContext(request)
  if (!authContext) {
    return unauthorizedResponse(authError)
  }

  const { iapId } = await params
  const { searchParams } = new URL(request.url)
  const projectId = searchParams.get('projectId')

  if (!projectId) {
    return errorResponse('projectId is required')
  }

  const projectContext = await getProjectContext(authContext.userId, projectId)
  if (!projectContext) {
    return errorResponse('Project not found', 404)
  }

  try {
    const basePath = projectContext.type === 'organization' && projectContext.orgId
      ? adminDb.collection('organizations').doc(projectContext.orgId).collection('projects').doc(projectId)
      : adminDb.collection('users').doc(authContext.userId).collection('projects').doc(projectId)

    const iapDoc = await basePath.collection('inAppPurchases').doc(iapId).get()
    if (!iapDoc.exists) {
      return errorResponse('IAP not found', 404)
    }

    const iapData = iapDoc.data()

    return Response.json({
      availableForSale: iapData?.availableForSale !== false, // Default to true
      availableInAllTerritories: iapData?.availableInAllTerritories !== false, // Default to true
    })
  } catch (error) {
    console.error('Error fetching IAP availability:', error)
    return errorResponse(error instanceof Error ? error.message : 'Failed to fetch availability', 500)
  }
}

// POST /api/iap/[iapId]/availability - Set availability settings
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ iapId: string }> }
) {
  const { context: authContext, error: authError } = await getAuthContext(request)
  if (!authContext) {
    return unauthorizedResponse(authError)
  }

  const { iapId } = await params

  let body
  try {
    body = setAvailabilitySchema.parse(await request.json())
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(`Validation error: ${error.errors.map(e => e.message).join(', ')}`)
    }
    return errorResponse('Invalid request body')
  }

  const { projectId, availableForSale, availableInAllTerritories } = body

  const projectContext = await getProjectContext(authContext.userId, projectId)
  if (!projectContext) {
    return errorResponse('Project not found', 404)
  }

  if (!hasContextPermission(projectContext, 'canCreateProjects')) {
    return errorResponse('Permission denied', 403)
  }

  try {
    const basePath = projectContext.type === 'organization' && projectContext.orgId
      ? adminDb.collection('organizations').doc(projectContext.orgId).collection('projects').doc(projectId)
      : adminDb.collection('users').doc(authContext.userId).collection('projects').doc(projectId)

    const iapRef = basePath.collection('inAppPurchases').doc(iapId)
    const iapDoc = await iapRef.get()

    if (!iapDoc.exists) {
      return errorResponse('IAP not found', 404)
    }

    // Update availability settings
    await iapRef.update({
      availableForSale,
      availableInAllTerritories,
      syncStatus: 'local_changes',
      updatedAt: Timestamp.now(),
    })

    return Response.json({
      success: true,
      availableForSale,
      availableInAllTerritories,
    })
  } catch (error) {
    console.error('Error updating IAP availability:', error)
    return errorResponse(error instanceof Error ? error.message : 'Failed to update availability', 500)
  }
}
