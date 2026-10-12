import { NextRequest } from 'next/server'
import { getAuthContext, errorResponse, unauthorizedResponse } from '../../playstore-iap/_helpers'
import { getFirebaseAnalyticsHelper } from '@/lib/services/firebase-analytics'
import { getProjectContext } from '@/lib/org/context'

async function getHelper(request: NextRequest, projectId: string) {
  const { context, error } = await getAuthContext(request)
  if (!context) return { error: error || 'Auth required' }

  const projectContext = await getProjectContext(context.userId, projectId)
  if (!projectContext) return { error: 'Project not found' }

  const helper = await getFirebaseAnalyticsHelper(context.userId, projectId, projectContext.orgId)
  if (!helper) return { error: 'Firebase Analytics not configured. Add a GA4 Property ID in project settings and ensure a Firebase service account is set.' }

  return { helper }
}

/**
 * GET /api/firebase/analytics?projectId=...&action=...
 *
 * Actions:
 *   user_metrics   – DAU/sessions/new users over a date range
 *   top_events     – most triggered events
 *   realtime       – active users right now
 *   acquisition    – user acquisition channels
 *   countries      – top countries by active users
 *   report         – custom report (body via query param not supported for GET; use POST)
 *   test           – test connection
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const projectId = searchParams.get('projectId')
  const action = searchParams.get('action') || 'user_metrics'

  if (!projectId) return errorResponse('projectId required')

  const ctx = await getHelper(request, projectId)
  if ('error' in ctx) return errorResponse(ctx.error as string)
  const { helper } = ctx

  const startDate = searchParams.get('startDate') || undefined
  const endDate = searchParams.get('endDate') || undefined
  const limit = searchParams.get('limit') ? Number(searchParams.get('limit')) : undefined

  try {
    switch (action) {
      case 'user_metrics': {
        const data = await helper.getUserMetrics({ startDate, endDate })
        return Response.json({ success: true, data })
      }
      case 'top_events': {
        const data = await helper.getTopEvents({ startDate, endDate, limit })
        return Response.json({ success: true, data })
      }
      case 'realtime': {
        const data = await helper.getRealtimeUsers()
        return Response.json({ success: true, data })
      }
      case 'acquisition': {
        const data = await helper.getUserAcquisition({ startDate, endDate, limit })
        return Response.json({ success: true, data })
      }
      case 'countries': {
        const data = await helper.getTopCountries({ startDate, endDate, limit })
        return Response.json({ success: true, data })
      }
      case 'test': {
        const ok = await helper.testConnection()
        return Response.json({ success: true, connected: ok })
      }
      default:
        return errorResponse(`Unknown action: ${action}. Valid: user_metrics, top_events, realtime, acquisition, countries, test`)
    }
  } catch (err: any) {
    return errorResponse(err.message || 'Analytics API error')
  }
}

/**
 * POST /api/firebase/analytics
 * Body: { projectId, action: 'report', request: AnalyticsReportRequest }
 * Allows running a fully custom GA4 report.
 */
export async function POST(request: NextRequest) {
  let body: any
  try { body = await request.json() } catch { return errorResponse('Invalid JSON') }

  const { projectId, action, request: reportRequest } = body
  if (!projectId) return errorResponse('projectId required')

  const ctx = await getHelper(request, projectId)
  if ('error' in ctx) return errorResponse(ctx.error as string)
  const { helper } = ctx

  try {
    if (action === 'report') {
      if (!reportRequest) return errorResponse('request body required for report action')
      const data = await helper.runReport(reportRequest)
      return Response.json({ success: true, data })
    }
    return errorResponse(`Unknown action: ${action}`)
  } catch (err: any) {
    return errorResponse(err.message || 'Analytics API error')
  }
}
