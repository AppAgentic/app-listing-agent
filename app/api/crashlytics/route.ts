import { NextRequest } from 'next/server'
import { getAuthContext, errorResponse, unauthorizedResponse } from '../playstore-iap/_helpers'
import { getCrashlyticsHelper } from '@/lib/services/crashlytics'
import { getProjectContext } from '@/lib/org/context'
import { getMutableProjectContext } from '@/lib/org/project-authorization'
import { hasInternalIntegrationAccess } from '@/lib/features/internal-integrations'

async function getHelper(request: NextRequest, projectId: string, requireMutation = false) {
  const { context, error } = await getAuthContext(request)
  if (!context) return { error: error || 'Auth required', status: 401 }
  if (!hasInternalIntegrationAccess(context)) return { error: 'Not found', status: 404 }

  const projectContext = requireMutation
    ? await getMutableProjectContext(context.userId, projectId)
    : await getProjectContext(context.userId, projectId)
  if (!projectContext) return { error: 'Project not found', status: 404 }

  const helper = await getCrashlyticsHelper(context.userId, projectId, projectContext.orgId)
  if (!helper) return { error: 'Firebase Crashlytics not configured. Add the Firebase App ID in project settings and ensure a Firebase service account (or Play Store service account for Android) is configured.', status: 400 }

  return { helper, status: 200 }
}

/**
 * GET /api/crashlytics?projectId=...&action=...
 * Actions: top_issues, top_versions, top_devices, top_os, get_issue, list_events, list_notes, test
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const projectId = searchParams.get('projectId')
  const action = searchParams.get('action') || 'top_issues'

  if (!projectId) return errorResponse('projectId required')

  const ctx = await getHelper(request, projectId)
  if ('error' in ctx) return errorResponse(ctx.error as string, ctx.status || 400)
  const { helper } = ctx

  try {
    switch (action) {
      case 'top_issues': {
        const data = await helper.getTopIssues({
          pageSize: searchParams.get('pageSize') ? Number(searchParams.get('pageSize')) : undefined,
          intervalStartTime: searchParams.get('startTime') || undefined,
          intervalEndTime: searchParams.get('endTime') || undefined,
          issueErrorTypes: searchParams.get('errorTypes')?.split(',').filter(Boolean),
        })
        return Response.json({ success: true, data })
      }
      case 'top_versions': {
        const data = await helper.getTopVersions({
          pageSize: searchParams.get('pageSize') ? Number(searchParams.get('pageSize')) : undefined,
          intervalStartTime: searchParams.get('startTime') || undefined,
        })
        return Response.json({ success: true, data })
      }
      case 'top_devices': {
        const pageSize = searchParams.get('pageSize') ? Number(searchParams.get('pageSize')) : undefined
        const platform = helper.appId.split(':')[2]
        const data = platform === 'ios'
          ? await helper.getTopAppleDevices({ pageSize })
          : await helper.getTopAndroidDevices({ pageSize })
        return Response.json({ success: true, data, platform })
      }
      case 'top_os': {
        const data = await helper.getTopOperatingSystems({
          pageSize: searchParams.get('pageSize') ? Number(searchParams.get('pageSize')) : undefined,
        })
        return Response.json({ success: true, data })
      }
      case 'get_issue': {
        const issueId = searchParams.get('issueId')
        if (!issueId) return errorResponse('issueId required')
        const data = await helper.getIssue(issueId)
        return Response.json({ success: true, data })
      }
      case 'list_events': {
        const data = await helper.listEvents({
          issueId: searchParams.get('issueId') || undefined,
          issueVariantId: searchParams.get('issueVariantId') || undefined,
          pageSize: searchParams.get('pageSize') ? Number(searchParams.get('pageSize')) : undefined,
          intervalStartTime: searchParams.get('startTime') || undefined,
        })
        return Response.json({ success: true, data })
      }
      case 'list_notes': {
        const issueId = searchParams.get('issueId')
        if (!issueId) return errorResponse('issueId required')
        const data = await helper.listNotes(issueId, searchParams.get('pageSize') ? Number(searchParams.get('pageSize')) : 20)
        return Response.json({ success: true, data })
      }
      case 'test': {
        const connected = await helper.testConnection()
        return Response.json({ success: true, connected })
      }
      default:
        return errorResponse(`Unknown action: ${action}`)
    }
  } catch (err: any) {
    return errorResponse(err.message || 'Crashlytics API error')
  }
}

/**
 * POST /api/crashlytics
 * Body: { projectId, action, issueId, state?, note?, noteId? }
 * Actions: update_issue, create_note, delete_note
 */
export async function POST(request: NextRequest) {
  let body: any
  try { body = await request.json() } catch { return errorResponse('Invalid JSON') }

  const { projectId, action, issueId, state, note, noteId } = body
  if (!projectId) return errorResponse('projectId required')
  if (!action) return errorResponse('action required')

  const ctx = await getHelper(request, projectId, true)
  if ('error' in ctx) return errorResponse(ctx.error as string, ctx.status || 400)
  const { helper } = ctx

  try {
    switch (action) {
      case 'update_issue': {
        if (!issueId) return errorResponse('issueId required')
        if (!['OPEN', 'CLOSED', 'MUTED'].includes(state)) return errorResponse('state must be OPEN, CLOSED, or MUTED')
        const data = await helper.updateIssue(issueId, state)
        return Response.json({ success: true, data })
      }
      case 'create_note': {
        if (!issueId) return errorResponse('issueId required')
        if (!note) return errorResponse('note text required')
        const data = await helper.createNote(issueId, note)
        return Response.json({ success: true, data })
      }
      case 'delete_note': {
        if (!issueId) return errorResponse('issueId required')
        if (!noteId) return errorResponse('noteId required')
        const data = await helper.deleteNote(issueId, noteId)
        return Response.json({ success: true, data })
      }
      default:
        return errorResponse(`Unknown action: ${action}`)
    }
  } catch (err: any) {
    return errorResponse(err.message || 'Crashlytics API error')
  }
}
