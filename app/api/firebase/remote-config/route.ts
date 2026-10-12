import { NextRequest } from 'next/server'
import { getAuthContext, errorResponse } from '../../playstore-iap/_helpers'
import { getFirebaseRemoteConfigHelper } from '@/lib/services/firebase-remote-config'
import { getProjectContext } from '@/lib/org/context'
import { getMutableProjectContext } from '@/lib/org/project-authorization'

async function getHelper(request: NextRequest, projectId: string, requireMutation = false) {
  const { context, error } = await getAuthContext(request)
  if (!context) return { error: error || 'Auth required' }

  const projectContext = requireMutation
    ? await getMutableProjectContext(context.userId, projectId)
    : await getProjectContext(context.userId, projectId)
  if (!projectContext) return { error: 'Project not found' }

  const helper = await getFirebaseRemoteConfigHelper(context.userId, projectId, projectContext.orgId)
  if (!helper) return { error: 'Remote Config not configured. Add a Firebase Project ID in project settings and ensure a Firebase service account is configured.' }

  return { helper }
}

/**
 * GET /api/firebase/remote-config?projectId=...&action=...
 * Actions: get, list_versions, test
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const projectId = searchParams.get('projectId')
  const action = searchParams.get('action') || 'get'

  if (!projectId) return errorResponse('projectId required')

  const ctx = await getHelper(request, projectId)
  if ('error' in ctx) return errorResponse(ctx.error as string)
  const { helper } = ctx

  try {
    switch (action) {
      case 'get': {
        const { template, etag } = await helper.getTemplate()
        return Response.json({ success: true, data: { template, etag } })
      }
      case 'list_versions': {
        const pageSize = searchParams.get('pageSize') ? Number(searchParams.get('pageSize')) : undefined
        const data = await helper.listVersions({ pageSize })
        return Response.json({ success: true, data })
      }
      case 'test': {
        const connected = await helper.testConnection()
        return Response.json({ success: true, connected })
      }
      default:
        return errorResponse(`Unknown action: ${action}. Valid: get, list_versions, test`)
    }
  } catch (err: any) {
    return errorResponse(err.message || 'Remote Config API error')
  }
}

/**
 * POST /api/firebase/remote-config
 * Body: { projectId, action, template?, etag?, versionNumber? }
 * Actions: update, publish, rollback
 */
export async function POST(request: NextRequest) {
  let body: any
  try { body = await request.json() } catch { return errorResponse('Invalid JSON') }

  const { projectId, action } = body
  if (!projectId) return errorResponse('projectId required')
  if (!action) return errorResponse('action required')

  const ctx = await getHelper(request, projectId, true)
  if ('error' in ctx) return errorResponse(ctx.error as string)
  const { helper } = ctx

  try {
    switch (action) {
      case 'update': {
        const { template, etag } = body
        if (!template) return errorResponse('template required')
        if (!etag) return errorResponse('etag required (use GET action to retrieve current etag)')
        const data = await helper.updateTemplate(template, etag)
        return Response.json({ success: true, data })
      }
      case 'publish': {
        const { template, etag } = body
        if (!template) return errorResponse('template required')
        if (!etag) return errorResponse('etag required')
        const data = await helper.publishTemplate(template, etag)
        return Response.json({ success: true, data })
      }
      case 'rollback': {
        const { versionNumber } = body
        if (!versionNumber) return errorResponse('versionNumber required')
        const data = await helper.rollback(versionNumber)
        return Response.json({ success: true, data })
      }
      default:
        return errorResponse(`Unknown action: ${action}. Valid: update, publish, rollback`)
    }
  } catch (err: any) {
    return errorResponse(err.message || 'Remote Config API error')
  }
}
