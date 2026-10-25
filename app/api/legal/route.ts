import { readBoundedJson, RequestBodyLimitError } from '@/lib/api/bounded-body'
import { NextRequest } from 'next/server'
import { z } from 'zod'
import { Timestamp } from 'firebase-admin/firestore'
import { revalidatePath } from 'next/cache'
import { adminDb } from '@/lib/firebase/admin'
import { errorResponse, unauthorizedResponse, successResponse } from '@/lib/api/auth'
import { getProjectContext, hasContextPermission, getAccountContext, AccountContext } from '@/lib/org/context'
import { getSession } from '@/lib/auth/session'
import { generatePublicSlug, type LegalDocumentType } from '@/lib/firebase/firestore'
import { appUrl } from '@/lib/routing/app-url'

// Helper to resolve the project path that owns legal docs.
// Linked projects share legal docs — the link owner (iOS) is the source of truth.
async function resolveLegalProjectPath(
  userId: string,
  projectId: string,
  projectContext: Awaited<ReturnType<typeof getProjectContext>>
): Promise<FirebaseFirestore.DocumentReference> {
  const isOrgProject = projectContext!.type === 'organization' && projectContext!.orgId
  const basePath = isOrgProject
    ? adminDb.collection('organizations').doc(projectContext!.orgId!).collection('projects').doc(projectId)
    : adminDb.collection('users').doc(projectContext!.userId).collection('projects').doc(projectId)

  // Check if this project is linked and not the owner
  const projectDoc = await basePath.get()
  const projectData = projectDoc.data()

  if (projectData?.linkedProjectId && !projectData?.linkOwner) {
    // This is the non-owner (e.g. Android) — resolve to the owner's path
    const ownerContext = await getProjectContext(userId, projectData.linkedProjectId)
    if (ownerContext) {
      const isOwnerOrg = ownerContext.type === 'organization' && ownerContext.orgId
      return isOwnerOrg
        ? adminDb.collection('organizations').doc(ownerContext.orgId!).collection('projects').doc(projectData.linkedProjectId)
        : adminDb.collection('users').doc(ownerContext.userId).collection('projects').doc(projectData.linkedProjectId)
    }
  }

  return basePath
}

// Helper to get auth context
async function getAuthContext(request: NextRequest): Promise<{ context: AccountContext | null; error?: string }> {
  const authHeader = request.headers.get('Authorization')
  if (authHeader) {
    const { authenticateRequest } = await import('@/lib/api/auth')
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

const getSchema = z.object({
  projectId: z.string(),
  type: z.enum(['privacy_policy', 'terms_of_service']).optional(),
})

const postSchema = z.object({
  projectId: z.string(),
  type: z.enum(['privacy_policy', 'terms_of_service']),
  content: z.string(),
  action: z.enum(['save_draft', 'publish']).default('save_draft'),
})

// GET - Fetch legal documents for a project
export async function GET(request: NextRequest) {
  const { context, error: authError } = await getAuthContext(request)
  if (!context) {
    return unauthorizedResponse(authError)
  }

  const { searchParams } = new URL(request.url)
  const parseResult = getSchema.safeParse({
    projectId: searchParams.get('projectId'),
    type: searchParams.get('type') || undefined,
  })

  if (!parseResult.success) {
    return errorResponse(parseResult.error.issues[0]?.message || 'Invalid request')
  }

  const { projectId, type } = parseResult.data

  const projectContext = await getProjectContext(context.userId, projectId)
  if (!projectContext) {
    return errorResponse('Project not found', 404)
  }

  // Resolve to the legal doc owner (linked projects share legal docs)
  const legalBasePath = await resolveLegalProjectPath(context.userId, projectId, projectContext)

  console.log('[Legal GET] Legal docs path:', legalBasePath.path)

  // Get project for publicSlug from the legal doc owner
  const projectDoc = await legalBasePath.get()
  const projectData = projectDoc.data()
  const publicSlug = projectData?.publicSlug || null

  if (type) {
    // Get specific document
    const docRef = legalBasePath.collection('legal').doc(type)
    const doc = await docRef.get()

    if (!doc.exists) {
      return successResponse({
        document: null,
        publicSlug,
        publicUrl: null,
      })
    }

    const urlType = type === 'privacy_policy' ? 'privacy' : 'terms'
    const docData = doc.data()
    return successResponse({
      document: {
        id: doc.id,
        ...docData,
        // Convert Firestore Timestamps to ISO strings
        lastDraftAt: docData?.lastDraftAt?.toDate?.()?.toISOString() || null,
        lastPublishedAt: docData?.lastPublishedAt?.toDate?.()?.toISOString() || null,
        lastModifiedAt: docData?.lastModifiedAt?.toDate?.()?.toISOString() || null,
      },
      publicSlug,
      publicUrl: publicSlug ? appUrl(`/legal/${publicSlug}/${urlType}`) : null,
    })
  }

  // Get all legal documents
  const legalCollection = legalBasePath.collection('legal')
  const snapshot = await legalCollection.get()

  console.log('[Legal GET] Found', snapshot.size, 'documents')

  const documents: Record<string, unknown> = {}
  snapshot.forEach(doc => {
    const data = doc.data()
    console.log('[Legal GET] Document:', doc.id, 'draftContent length:', data.draftContent?.length || 0)
    documents[doc.id] = {
      id: doc.id,
      ...data,
      // Convert Firestore Timestamps to ISO strings for JSON serialization
      lastDraftAt: data.lastDraftAt?.toDate?.()?.toISOString() || null,
      lastPublishedAt: data.lastPublishedAt?.toDate?.()?.toISOString() || null,
      lastModifiedAt: data.lastModifiedAt?.toDate?.()?.toISOString() || null,
    }
  })

  return successResponse({
    documents,
    publicSlug,
    publicUrls: publicSlug ? {
      privacy: appUrl(`/legal/${publicSlug}/privacy`),
      terms: appUrl(`/legal/${publicSlug}/terms`),
    } : null,
    // Debug info - remove in production
    _debug: {
      path: legalBasePath.path,
      docsFound: snapshot.size,
      projectType: projectContext.type,
    }
  })
}

// POST - Create or update a legal document
export async function POST(request: NextRequest) {
  const { context, error: authError } = await getAuthContext(request)
  if (!context) {
    return unauthorizedResponse(authError)
  }

  let body
  try {
    body = postSchema.parse(await readBoundedJson(request))
  } catch (error) {
    if (error instanceof RequestBodyLimitError) return Response.json({ error: error.message }, { status: 413 })
    if (error instanceof z.ZodError) {
      return errorResponse(error.issues[0]?.message || 'Invalid request body')
    }
    return errorResponse('Invalid request body')
  }

  const { projectId, type, content, action } = body

  const projectContext = await getProjectContext(context.userId, projectId)
  if (!projectContext) {
    return errorResponse('Project not found', 404)
  }

  if (!hasContextPermission(projectContext, 'canCreateProjects')) {
    return errorResponse('Permission denied', 403)
  }

  // Resolve to the legal doc owner (linked projects share legal docs)
  const legalBasePath = await resolveLegalProjectPath(context.userId, projectId, projectContext)

  console.log('[Legal POST] Legal docs path:', legalBasePath.path)

  // Check if project has a publicSlug, generate one if not
  const projectDoc = await legalBasePath.get()
  const projectData = projectDoc.data()
  let publicSlug = projectData?.publicSlug

  if (!publicSlug) {
    // Generate and save a new slug on the legal doc owner project
    publicSlug = generatePublicSlug()
    await legalBasePath.update({ publicSlug })
    // Also create a lookup entry for the public page to find this project
    await adminDb.collection('slugLookup').doc(publicSlug).set({
      projectPath: legalBasePath.path,
      createdAt: Timestamp.now(),
    })
  } else {
    // Ensure lookup entry exists for existing slugs
    const lookupDoc = await adminDb.collection('slugLookup').doc(publicSlug).get()
    if (!lookupDoc.exists) {
      await adminDb.collection('slugLookup').doc(publicSlug).set({
        projectPath: legalBasePath.path,
        createdAt: Timestamp.now(),
      })
    }
  }

  const docRef = legalBasePath.collection('legal').doc(type)
  const existingDoc = await docRef.get()
  const existingData = existingDoc.exists ? existingDoc.data() : null
  const now = Timestamp.now()

  if (action === 'publish') {
    // Publishing: update both draft and published content
    console.log('[Legal POST] Publishing, content length:', content.length)
    await docRef.set({
      type,
      draftContent: content,
      publishedContent: content,
      lastDraftAt: now,
      lastPublishedAt: now,
      lastModifiedBy: context.userId,
      isPublished: true,
    })

    // Revalidate the public page cache
    const urlType = type === 'privacy_policy' ? 'privacy' : 'terms'
    try {
      revalidatePath(`/legal/${publicSlug}/${urlType}`)
    } catch {
      // Revalidation may fail in some environments, that's ok
    }

    return successResponse({
      success: true,
      action: 'published',
      publicSlug,
      publicUrl: appUrl(`/legal/${publicSlug}/${urlType}`),
      hasUnpublishedChanges: false,
    })
  } else {
    // Saving draft: only update draft content
    console.log('[Legal POST] Saving draft, content length:', content.length)
    await docRef.set({
      type,
      draftContent: content,
      publishedContent: existingData?.publishedContent || null,
      lastDraftAt: now,
      lastPublishedAt: existingData?.lastPublishedAt || null,
      lastModifiedBy: context.userId,
      isPublished: existingData?.isPublished || false,
    })

    const urlType = type === 'privacy_policy' ? 'privacy' : 'terms'
    const hasUnpublishedChanges = content !== (existingData?.publishedContent || null)

    return successResponse({
      success: true,
      action: 'draft_saved',
      publicSlug,
      publicUrl: existingData?.isPublished ? appUrl(`/legal/${publicSlug}/${urlType}`) : null,
      hasUnpublishedChanges,
      // Debug info
      _debug: {
        path: legalBasePath.path,
        projectType: projectContext.type,
        contentLength: content.length,
      }
    })
  }
}
