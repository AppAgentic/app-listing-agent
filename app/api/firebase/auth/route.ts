import { NextRequest } from 'next/server'
import { getAuthContext, errorResponse } from '../../playstore-iap/_helpers'
import { getFirebaseAuthHelper } from '@/lib/services/firebase-auth'
import { getProjectContext } from '@/lib/org/context'
import { getMutableProjectContext } from '@/lib/org/project-authorization'

async function getHelper(request: NextRequest, projectId: string, requireMutation = false) {
  const { context, error } = await getAuthContext(request)
  if (!context) return { error: error || 'Auth required' }

  const projectContext = requireMutation
    ? await getMutableProjectContext(context.userId, projectId)
    : await getProjectContext(context.userId, projectId)
  if (!projectContext) return { error: 'Project not found' }

  const helper = await getFirebaseAuthHelper(context.userId, projectId, projectContext.orgId)
  if (!helper) return { error: 'Firebase Auth not configured. Add a Firebase Project ID in project settings and ensure a Firebase service account is configured.' }

  return { helper }
}

/**
 * GET /api/firebase/auth?projectId=...&action=...
 * Actions: list_users, get_user, test
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const projectId = searchParams.get('projectId')
  const action = searchParams.get('action') || 'list_users'

  if (!projectId) return errorResponse('projectId required')

  const ctx = await getHelper(request, projectId)
  if ('error' in ctx) return errorResponse(ctx.error as string)
  const { helper } = ctx

  try {
    switch (action) {
      case 'list_users': {
        const maxResults = searchParams.get('maxResults') ? Number(searchParams.get('maxResults')) : undefined
        const nextPageToken = searchParams.get('nextPageToken') || undefined
        const data = await helper.listUsers({ maxResults, nextPageToken })
        return Response.json({ success: true, data })
      }
      case 'get_user': {
        const uid = searchParams.get('uid') || undefined
        const email = searchParams.get('email') || undefined
        const phoneNumber = searchParams.get('phoneNumber') || undefined
        if (!uid && !email && !phoneNumber) return errorResponse('uid, email, or phoneNumber required')
        const data = await helper.getUser({ uid, email, phoneNumber })
        return Response.json({ success: true, data })
      }
      case 'test': {
        const connected = await helper.testConnection()
        return Response.json({ success: true, connected })
      }
      default:
        return errorResponse(`Unknown action: ${action}. Valid: list_users, get_user, test`)
    }
  } catch (err: any) {
    return errorResponse(err.message || 'Firebase Auth API error')
  }
}

/**
 * POST /api/firebase/auth
 * Body: { projectId, action, uid, ...updates }
 * Actions: update_user, disable_user, enable_user, delete_user
 */
export async function POST(request: NextRequest) {
  let body: any
  try { body = await request.json() } catch { return errorResponse('Invalid JSON') }

  const { projectId, action, uid } = body
  if (!projectId) return errorResponse('projectId required')
  if (!action) return errorResponse('action required')

  const ctx = await getHelper(request, projectId, true)
  if ('error' in ctx) return errorResponse(ctx.error as string)
  const { helper } = ctx

  try {
    switch (action) {
      case 'update_user': {
        if (!uid) return errorResponse('uid required')
        const { displayName, email, emailVerified, disabled, phoneNumber, photoUrl, customAttributes } = body
        const data = await helper.updateUser(uid, { displayName, email, emailVerified, disabled, phoneNumber, photoUrl, customAttributes })
        return Response.json({ success: true, data })
      }
      case 'disable_user': {
        if (!uid) return errorResponse('uid required')
        const data = await helper.disableUser(uid)
        return Response.json({ success: true, data })
      }
      case 'enable_user': {
        if (!uid) return errorResponse('uid required')
        const data = await helper.enableUser(uid)
        return Response.json({ success: true, data })
      }
      case 'delete_user': {
        if (!uid) return errorResponse('uid required')
        await helper.deleteUser(uid)
        return Response.json({ success: true })
      }
      default:
        return errorResponse(`Unknown action: ${action}. Valid: update_user, disable_user, enable_user, delete_user`)
    }
  } catch (err: any) {
    return errorResponse(err.message || 'Firebase Auth API error')
  }
}
