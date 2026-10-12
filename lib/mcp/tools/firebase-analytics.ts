/**
 * Firebase Analytics MCP Tools
 * Provides MCP tools for Google Analytics for Firebase (GA4):
 * user metrics, event data, real-time users, acquisition, and custom reports.
 */

import { AccountContext, getProjectContext } from '@/lib/org/context'
import { getFirebaseAnalyticsHelper } from '@/lib/services/firebase-analytics'

async function getHelper(context: AccountContext, projectId: string) {
  const projectContext = await getProjectContext(context.userId, projectId)
  if (!projectContext) return { error: 'Project not found' as const }

  const helper = await getFirebaseAnalyticsHelper(context.userId, projectId, projectContext.orgId)
  if (!helper) {
    return {
      error: 'Firebase Analytics not configured. Add a GA4 Property ID in project settings and ensure a Firebase service account is configured.' as const
    }
  }
  return { helper }
}

// ============ User Metrics ============

export interface GetAnalyticsUserMetricsParams {
  projectId: string
  startDate?: string
  endDate?: string
}

export async function getAnalyticsUserMetrics(
  params: GetAnalyticsUserMetricsParams,
  context: AccountContext
) {
  const r = await getHelper(context, params.projectId)
  if ('error' in r) return { success: false, error: r.error }
  try {
    const data = await r.helper.getUserMetrics({ startDate: params.startDate, endDate: params.endDate })
    return { success: true, data }
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Failed' }
  }
}

// ============ Top Events ============

export interface GetAnalyticsTopEventsParams {
  projectId: string
  startDate?: string
  endDate?: string
  limit?: number
}

export async function getAnalyticsTopEvents(
  params: GetAnalyticsTopEventsParams,
  context: AccountContext
) {
  const r = await getHelper(context, params.projectId)
  if ('error' in r) return { success: false, error: r.error }
  try {
    const data = await r.helper.getTopEvents({ startDate: params.startDate, endDate: params.endDate, limit: params.limit })
    return { success: true, data }
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Failed' }
  }
}

// ============ Realtime Users ============

export interface GetAnalyticsRealtimeUsersParams {
  projectId: string
}

export async function getAnalyticsRealtimeUsers(
  params: GetAnalyticsRealtimeUsersParams,
  context: AccountContext
) {
  const r = await getHelper(context, params.projectId)
  if ('error' in r) return { success: false, error: r.error }
  try {
    const data = await r.helper.getRealtimeUsers()
    return { success: true, data }
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Failed' }
  }
}

// ============ User Acquisition ============

export interface GetAnalyticsAcquisitionParams {
  projectId: string
  startDate?: string
  endDate?: string
  limit?: number
}

export async function getAnalyticsAcquisition(
  params: GetAnalyticsAcquisitionParams,
  context: AccountContext
) {
  const r = await getHelper(context, params.projectId)
  if ('error' in r) return { success: false, error: r.error }
  try {
    const data = await r.helper.getUserAcquisition({ startDate: params.startDate, endDate: params.endDate, limit: params.limit })
    return { success: true, data }
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Failed' }
  }
}

// ============ Custom Report ============

export interface RunAnalyticsReportParams {
  projectId: string
  startDate: string
  endDate: string
  metrics: string[]
  dimensions?: string[]
  limit?: number
  orderByMetric?: string
}

export async function runAnalyticsReport(
  params: RunAnalyticsReportParams,
  context: AccountContext
) {
  const r = await getHelper(context, params.projectId)
  if ('error' in r) return { success: false, error: r.error }
  try {
    const data = await r.helper.runReport({
      dateRanges: [{ startDate: params.startDate, endDate: params.endDate }],
      metrics: params.metrics.map(name => ({ name })),
      dimensions: params.dimensions?.map(name => ({ name })),
      limit: params.limit,
      orderBys: params.orderByMetric
        ? [{ metric: { metricName: params.orderByMetric }, desc: true }]
        : undefined,
    })
    return { success: true, data }
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Failed' }
  }
}
