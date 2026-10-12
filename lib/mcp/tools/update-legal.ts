import { adminDb } from '@/lib/firebase/admin'
import { appOrigin } from '@/lib/routing/app-url'
import { Timestamp } from 'firebase-admin/firestore'
import { AccountContext, getProjectContext, hasContextPermission } from '@/lib/org/context'
import { generatePublicSlug, LegalDocumentType } from '@/lib/firebase/firestore'
import { revalidatePath } from 'next/cache'

export interface UpdateLegalDocumentParams {
  projectId: string
  type: LegalDocumentType
  content: string
}

export interface UpdateLegalDocumentResult {
  success: boolean
  publicUrl?: string
  slug?: string
  error?: string
}

// Helper to resolve the project path that owns legal docs.
// Linked projects share legal docs — the link owner (iOS) is the source of truth.
async function resolveLegalProjectRef(
  userId: string,
  projectId: string,
  projectContext: Awaited<ReturnType<typeof getProjectContext>>
): Promise<FirebaseFirestore.DocumentReference> {
  const isOrgProject = projectContext!.type === 'organization' && projectContext!.orgId
  const basePath = isOrgProject
    ? adminDb.collection('organizations').doc(projectContext!.orgId!).collection('projects').doc(projectId)
    : adminDb.collection('users').doc(projectContext!.userId).collection('projects').doc(projectId)

  const projectDoc = await basePath.get()
  const projectData = projectDoc.data()

  if (projectData?.linkedProjectId && !projectData?.linkOwner) {
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

export async function updateLegalDocument(
  params: UpdateLegalDocumentParams,
  context: AccountContext
): Promise<UpdateLegalDocumentResult> {
  const { projectId, type, content } = params

  // Validate type
  if (type !== 'privacy_policy' && type !== 'terms_of_service') {
    return { success: false, error: 'Invalid type. Must be "privacy_policy" or "terms_of_service"' }
  }

  // Validate content
  if (!content || content.trim().length === 0) {
    return { success: false, error: 'Content cannot be empty' }
  }

  // Validate project access
  const projectContext = await getProjectContext(context.userId, projectId)
  if (!projectContext) {
    return { success: false, error: 'Project not found' }
  }

  if (!hasContextPermission(projectContext, 'canCreateProjects')) {
    return { success: false, error: 'Permission denied' }
  }

  // Resolve to the legal doc owner (linked projects share legal docs)
  const projectRef = await resolveLegalProjectRef(context.userId, projectId, projectContext)

  const now = Timestamp.now()

  // Get or create public slug on the legal doc owner project
  const projectDoc = await projectRef.get()
  const projectData = projectDoc.data()
  let publicSlug = projectData?.publicSlug

  if (!publicSlug) {
    publicSlug = generatePublicSlug()
    await projectRef.update({
      publicSlug,
      updatedAt: now,
    })
  }

  // Public legal pages resolve a slug through this lookup before reading the
  // owning project. Keep it in sync even when the slug already existed, because
  // older MCP/legal paths created published docs without backfilling it.
  const slugLookupRef = adminDb.collection('slugLookup').doc(publicSlug)
  const slugLookupDoc = await slugLookupRef.get()
  await slugLookupRef.set({
    projectPath: projectRef.path,
    createdAt: slugLookupDoc.data()?.createdAt || now,
    updatedAt: now,
  }, { merge: true })

  // Save legal document
  const legalRef = projectRef.collection('legal').doc(type)
  await legalRef.set({
    type,
    content,
    lastModifiedAt: now,
    lastModifiedBy: context.userId,
    isPublished: true,
  })

  // Trigger revalidation for the public page
  const urlType = type === 'privacy_policy' ? 'privacy' : 'terms'
  try {
    revalidatePath(`/legal/${publicSlug}/${urlType}`)
  } catch {
    // Revalidation may fail in some environments, but document is saved
  }

  // Construct the public URL
  const baseUrl = appOrigin()
  const publicUrl = `${baseUrl}/legal/${publicSlug}/${urlType}`

  return {
    success: true,
    publicUrl,
    slug: publicSlug,
  }
}
