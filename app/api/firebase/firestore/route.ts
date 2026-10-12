import { NextRequest } from 'next/server'
import { getAuthContext, errorResponse } from '../../playstore-iap/_helpers'
import { getFirebaseFirestoreHelper } from '@/lib/services/firebase-firestore'
import { getProjectContext } from '@/lib/org/context'
import { getMutableProjectContext } from '@/lib/org/project-authorization'

async function getHelper(request: NextRequest, projectId: string, requireMutation = false) {
  const { context, error } = await getAuthContext(request)
  if (!context) return { error: error || 'Auth required' }

  const projectContext = requireMutation
    ? await getMutableProjectContext(context.userId, projectId)
    : await getProjectContext(context.userId, projectId)
  if (!projectContext) return { error: 'Project not found' }

  const helper = await getFirebaseFirestoreHelper(context.userId, projectId, projectContext.orgId)
  if (!helper) return { error: 'Firestore not configured. Add a Firebase Project ID in project settings and ensure a Firebase service account is configured.' }

  return { helper }
}

/**
 * GET /api/firebase/firestore?projectId=...&action=...
 * Actions: list_collections, list_documents, get_document, test
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const projectId = searchParams.get('projectId')
  const action = searchParams.get('action') || 'list_collections'

  if (!projectId) return errorResponse('projectId required')

  const ctx = await getHelper(request, projectId)
  if ('error' in ctx) return errorResponse(ctx.error as string)
  const { helper } = ctx

  try {
    switch (action) {
      case 'list_collections': {
        const data = await helper.listCollections()
        return Response.json({ success: true, data })
      }
      case 'list_documents': {
        const collection = searchParams.get('collection')
        if (!collection) return errorResponse('collection required')
        const pageSize = searchParams.get('pageSize') ? Number(searchParams.get('pageSize')) : undefined
        const pageToken = searchParams.get('pageToken') || undefined
        const data = await helper.listDocuments(collection, { pageSize, pageToken })
        return Response.json({ success: true, data })
      }
      case 'get_document': {
        const path = searchParams.get('path')
        if (!path) return errorResponse('path required')
        const data = await helper.getDocument(path)
        return Response.json({ success: true, data })
      }
      case 'test': {
        const connected = await helper.testConnection()
        return Response.json({ success: true, connected })
      }
      default:
        return errorResponse(`Unknown action: ${action}. Valid: list_collections, list_documents, get_document, test`)
    }
  } catch (err: any) {
    return errorResponse(err.message || 'Firestore API error')
  }
}

/**
 * POST /api/firebase/firestore
 * Body: { projectId, action, ...params }
 * Actions: query_collection, set_document, delete_document
 */
export async function POST(request: NextRequest) {
  let body: any
  try { body = await request.json() } catch { return errorResponse('Invalid JSON') }

  const { projectId, action } = body
  if (!projectId) return errorResponse('projectId required')
  if (!action) return errorResponse('action required')

  const ctx = await getHelper(request, projectId, action !== 'query_collection')
  if ('error' in ctx) return errorResponse(ctx.error as string)
  const { helper } = ctx

  try {
    switch (action) {
      case 'query_collection': {
        const { collection, filters, limit } = body
        if (!collection) return errorResponse('collection required')
        const data = await helper.queryCollection(collection, filters, limit)
        return Response.json({ success: true, data })
      }
      case 'set_document': {
        const { path, data: docData } = body
        if (!path) return errorResponse('path required')
        if (!docData || typeof docData !== 'object') return errorResponse('data object required')
        const result = await helper.setDocument(path, docData)
        return Response.json({ success: true, data: result })
      }
      case 'delete_document': {
        const { path } = body
        if (!path) return errorResponse('path required')
        await helper.deleteDocument(path)
        return Response.json({ success: true })
      }
      default:
        return errorResponse(`Unknown action: ${action}. Valid: query_collection, set_document, delete_document`)
    }
  } catch (err: any) {
    return errorResponse(err.message || 'Firestore API error')
  }
}
