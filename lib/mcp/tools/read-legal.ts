import { adminDb } from '@/lib/firebase/admin'
import { appOrigin } from '@/lib/routing/app-url'
import { AccountContext, getProjectContext, hasContextPermission } from '@/lib/org/context'

export interface ReadLegalDocumentsParams {
  projectId: string
}

interface LegalDocumentInfo {
  type: string
  exists: boolean
  isPublished: boolean
  publicUrl: string | null
  lastModifiedAt?: string
}

export interface ReadLegalDocumentsResult {
  success: boolean
  privacyPolicy?: LegalDocumentInfo
  termsOfService?: LegalDocumentInfo
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

export async function readLegalDocuments(
  params: ReadLegalDocumentsParams,
  context: AccountContext
): Promise<ReadLegalDocumentsResult> {
  const { projectId } = params

  const projectContext = await getProjectContext(context.userId, projectId)
  if (!projectContext) {
    return { success: false, error: 'Project not found' }
  }

  if (!hasContextPermission(projectContext, 'canCreateProjects')) {
    return { success: false, error: 'Permission denied' }
  }

  // Resolve to the legal doc owner (linked projects share legal docs)
  const projectRef = await resolveLegalProjectRef(context.userId, projectId, projectContext)

  const projectDoc = await projectRef.get()
  const projectData = projectDoc.data()
  const publicSlug = projectData?.publicSlug
  const baseUrl = appOrigin()

  const legalSnapshot = await projectRef.collection('legal').get()

  const buildInfo = (docId: string, urlPath: string): LegalDocumentInfo => {
    const doc = legalSnapshot.docs.find(d => d.id === docId)
    if (!doc) {
      return { type: docId, exists: false, isPublished: false, publicUrl: null }
    }
    const data = doc.data()
    const isPublished = data.isPublished || false
    return {
      type: docId,
      exists: true,
      isPublished,
      publicUrl: isPublished && publicSlug ? `${baseUrl}/legal/${publicSlug}/${urlPath}` : null,
      lastModifiedAt: data.lastModifiedAt?.toDate?.()?.toISOString() || undefined,
    }
  }

  return {
    success: true,
    privacyPolicy: buildInfo('privacy_policy', 'privacy'),
    termsOfService: buildInfo('terms_of_service', 'terms'),
  }
}
