/**
 * Firebase Firestore MCP Tools
 */

import { AccountContext, getProjectContext } from '@/lib/org/context'
import { getFirebaseFirestoreHelper } from '@/lib/services/firebase-firestore'

async function getHelper(context: AccountContext, projectId: string) {
  const projectContext = await getProjectContext(context.userId, projectId)
  if (!projectContext) return { error: 'Project not found' as const }

  const helper = await getFirebaseFirestoreHelper(context.userId, projectId, projectContext.orgId)
  if (!helper) {
    return {
      error: 'Firestore not configured. Add a Firebase Project ID in project settings and ensure a Firebase service account is configured.' as const
    }
  }
  return { helper }
}

// ============ List Collections ============

export interface FirestoreListCollectionsParams {
  projectId: string
}

export async function firestoreListCollections(
  params: FirestoreListCollectionsParams,
  context: AccountContext
) {
  const r = await getHelper(context, params.projectId)
  if ('error' in r) return { success: false, error: r.error }
  try {
    const data = await r.helper.listCollections()
    return { success: true, data }
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Failed' }
  }
}

// ============ List Documents ============

export interface FirestoreListDocumentsParams {
  projectId: string
  collection: string
  pageSize?: number
  pageToken?: string
}

export async function firestoreListDocuments(
  params: FirestoreListDocumentsParams,
  context: AccountContext
) {
  const r = await getHelper(context, params.projectId)
  if ('error' in r) return { success: false, error: r.error }
  try {
    const data = await r.helper.listDocuments(params.collection, { pageSize: params.pageSize, pageToken: params.pageToken })
    return { success: true, data }
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Failed' }
  }
}

// ============ Get Document ============

export interface FirestoreGetDocumentParams {
  projectId: string
  path: string
}

export async function firestoreGetDocument(
  params: FirestoreGetDocumentParams,
  context: AccountContext
) {
  const r = await getHelper(context, params.projectId)
  if ('error' in r) return { success: false, error: r.error }
  try {
    const data = await r.helper.getDocument(params.path)
    return { success: true, data }
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Failed' }
  }
}

// ============ Query Collection ============

export interface FirestoreQueryCollectionParams {
  projectId: string
  collection: string
  filters?: Array<{
    field: string
    op: 'EQUAL' | 'NOT_EQUAL' | 'LESS_THAN' | 'LESS_THAN_OR_EQUAL' | 'GREATER_THAN' | 'GREATER_THAN_OR_EQUAL' | 'ARRAY_CONTAINS' | 'IN' | 'NOT_IN'
    value: any
  }>
  limit?: number
}

export async function firestoreQueryCollection(
  params: FirestoreQueryCollectionParams,
  context: AccountContext
) {
  const r = await getHelper(context, params.projectId)
  if ('error' in r) return { success: false, error: r.error }
  try {
    const data = await r.helper.queryCollection(params.collection, params.filters as any, params.limit)
    return { success: true, data }
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Failed' }
  }
}

// ============ Set Document ============

export interface FirestoreSetDocumentParams {
  projectId: string
  path: string
  data: Record<string, any>
}

export async function firestoreSetDocument(
  params: FirestoreSetDocumentParams,
  context: AccountContext
) {
  const r = await getHelper(context, params.projectId)
  if ('error' in r) return { success: false, error: r.error }
  try {
    const data = await r.helper.setDocument(params.path, params.data)
    return { success: true, data }
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Failed' }
  }
}

// ============ Delete Document ============

export interface FirestoreDeleteDocumentParams {
  projectId: string
  path: string
}

export async function firestoreDeleteDocument(
  params: FirestoreDeleteDocumentParams,
  context: AccountContext
) {
  const r = await getHelper(context, params.projectId)
  if ('error' in r) return { success: false, error: r.error }
  try {
    await r.helper.deleteDocument(params.path)
    return { success: true }
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Failed' }
  }
}
