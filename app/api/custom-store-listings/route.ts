import { NextRequest } from 'next/server'
import { authenticateRequest, errorResponse, unauthorizedResponse } from '@/lib/api/auth'
import { getProjectContext, getAccountContext, AccountContext } from '@/lib/org/context'
import { getMutableProjectContext } from '@/lib/org/project-authorization'
import { getSession } from '@/lib/auth/session'
import { adminDb } from '@/lib/firebase/admin'
import { Timestamp } from 'firebase-admin/firestore'
import type { CustomStoreListing, CSLLocalization } from '@/lib/firebase/firestore'

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

function getBasePath(projectContext: any, userId: string, projectId: string) {
  return projectContext.type === 'organization' && projectContext.orgId
    ? adminDb.collection('organizations').doc(projectContext.orgId).collection('projects').doc(projectId)
    : adminDb.collection('users').doc(userId).collection('projects').doc(projectId)
}

// GET /api/custom-store-listings?projectId=xxx
export async function GET(request: NextRequest) {
  const { context: authContext, error: authError } = await getAuthContext(request)
  if (!authContext) return unauthorizedResponse(authError)

  const projectId = new URL(request.url).searchParams.get('projectId')
  if (!projectId) return errorResponse('projectId is required')

  const projectContext = await getProjectContext(authContext.userId, projectId)
  if (!projectContext) return errorResponse('Project not found', 404)

  try {
    const basePath = getBasePath(projectContext, authContext.userId, projectId)
    const snapshot = await basePath.collection('customStoreListings').orderBy('createdAt', 'desc').get()

    const listings = await Promise.all(snapshot.docs.map(async doc => {
      const locSnap = await doc.ref.collection('localizations').get()
      const localizations = locSnap.docs.map(d => ({ locale: d.id, ...d.data() }))
      return { id: doc.id, ...doc.data(), localizations }
    }))

    return Response.json({ listings })
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : 'Failed to list custom store listings', 500)
  }
}

// POST /api/custom-store-listings
export async function POST(request: NextRequest) {
  const { context: authContext, error: authError } = await getAuthContext(request)
  if (!authContext) return unauthorizedResponse(authError)

  let body: any
  try { body = await request.json() } catch { return errorResponse('Invalid request body') }

  const { projectId, name, targetingType, targetingCountries, localizations } = body
  if (!projectId) return errorResponse('projectId is required')
  if (!name) return errorResponse('name is required')

  const projectContext = await getMutableProjectContext(authContext.userId, projectId)
  if (!projectContext) return errorResponse('Project not found', 404)

  try {
    const basePath = getBasePath(projectContext, authContext.userId, projectId)
    const now = Timestamp.now()

    const listingData = {
      playStoreId: null,
      name,
      targetingType: targetingType || 'COUNTRY',
      targetingCountries: targetingCountries || [],
      syncStatus: 'pending_creation',
      createdAt: now,
      updatedAt: now,
    }

    const listingRef = basePath.collection('customStoreListings').doc()
    const batch = adminDb.batch()
    batch.set(listingRef, listingData)

    if (localizations?.length) {
      for (const loc of localizations) {
        const locRef = listingRef.collection('localizations').doc(loc.locale)
        batch.set(locRef, {
          locale: loc.locale,
          title: loc.title || '',
          shortDescription: loc.shortDescription || '',
          fullDescription: loc.fullDescription || '',
          iconUrl: null,
          iconKey: null,
          featureGraphicUrl: null,
          featureGraphicKey: null,
          videoUrl: null,
          screenshots: [],
        })
      }
    }

    await batch.commit()
    return Response.json({ success: true, listing: { id: listingRef.id, ...listingData } })
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : 'Failed to create custom store listing', 500)
  }
}
