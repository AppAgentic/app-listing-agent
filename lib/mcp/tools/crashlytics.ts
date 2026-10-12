/**
 * Crashlytics MCP Tools
 * Provides MCP tools for Firebase Crashlytics: crash issues, stack traces,
 * device metrics, version metrics, issue state management, and notes.
 */

import { AccountContext, getProjectContext } from '@/lib/org/context'
import { getCrashlyticsHelper } from '@/lib/services/crashlytics'
import { getFirebaseAnalyticsHelper } from '@/lib/services/firebase-analytics'

// ============ Shared Helper ============

async function getHelper(context: AccountContext, projectId: string) {
  if (!projectId) {
    return { error: 'projectId is required' as const }
  }

  const projectContext = await getProjectContext(context.userId, projectId)
  if (!projectContext) {
    return { error: 'Project not found' as const }
  }

  const helper = await getCrashlyticsHelper(context.userId, projectId, projectContext.orgId)
  if (!helper) {
    return {
      error: 'Crashlytics not configured for this project. Add the Firebase App ID in project settings and ensure a Firebase/Google service account is configured.' as const,
      projectContext,
    }
  }

  return { helper, projectContext }
}

/**
 * Fallback: try to get crash-related data from Firebase Analytics (GA4)
 * when Crashlytics is not configured.
 */
async function tryAnalyticsCrashFallback(
  context: AccountContext,
  projectId: string,
  orgId?: string
) {
  const analyticsHelper = await getFirebaseAnalyticsHelper(context.userId, projectId, orgId)
  if (!analyticsHelper) return null

  try {
    const data = await analyticsHelper.runReport({
      dateRanges: [{ startDate: '30daysAgo', endDate: 'today' }],
      dimensions: [{ name: 'date' }],
      metrics: [
        { name: 'crashAffectedUsers' },
        { name: 'crashFreeUsersRate' },
        { name: 'activeUsers' },
      ],
      orderBys: [{ dimension: { dimensionName: 'date' }, desc: true }],
      limit: 30,
    })
    return data
  } catch {
    return null
  }
}

// ============ List Crash Issues ============

export interface ListCrashIssuesParams {
  projectId: string
  pageSize?: number
  startTime?: string
  endTime?: string
  errorTypes?: string[]
}

export interface ListCrashIssuesResult {
  success: boolean
  issues?: any[]
  nextPageToken?: string
  error?: string
}

export async function listCrashIssues(
  params: ListCrashIssuesParams,
  context: AccountContext
): Promise<ListCrashIssuesResult> {
  const { projectId, pageSize, startTime, endTime, errorTypes } = params
  const result = await getHelper(context, projectId)

  // If Crashlytics not configured but project exists, try Firebase Analytics as fallback
  if ('error' in result) {
    if ('projectContext' in result && result.projectContext) {
      const fallbackData = await tryAnalyticsCrashFallback(context, projectId, result.projectContext.orgId)
      if (fallbackData) {
        return {
          success: true,
          issues: [],
          _fallbackSource: 'firebase_analytics',
          _fallbackData: fallbackData,
          _note: 'Crashlytics not configured. Showing crash metrics from Firebase Analytics (GA4) instead. Configure Firebase App ID for detailed crash issues.',
        } as any
      }
    }
    return { success: false, error: result.error }
  }

  try {
    const data = await result.helper.getTopIssues({
      pageSize,
      intervalStartTime: startTime,
      intervalEndTime: endTime,
      issueErrorTypes: errorTypes,
    })
    return {
      success: true,
      issues: data.issues || data.topIssues || [],
      nextPageToken: data.nextPageToken,
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to list crash issues' }
  }
}

// ============ Get Crash Issue ============

export interface GetCrashIssueParams {
  projectId: string
  issueId: string
}

export interface GetCrashIssueResult {
  success: boolean
  issue?: any
  error?: string
}

export async function getCrashIssue(
  params: GetCrashIssueParams,
  context: AccountContext
): Promise<GetCrashIssueResult> {
  const { projectId, issueId } = params
  const result = await getHelper(context, projectId)
  if ('error' in result) return { success: false, error: result.error }

  try {
    const issue = await result.helper.getIssue(issueId)
    return { success: true, issue }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to get crash issue' }
  }
}

// ============ List Crash Events (Stack Traces) ============

export interface ListCrashEventsParams {
  projectId: string
  issueId?: string
  issueVariantId?: string
  pageSize?: number
  startTime?: string
}

export interface ListCrashEventsResult {
  success: boolean
  events?: any[]
  nextPageToken?: string
  error?: string
}

export async function listCrashEvents(
  params: ListCrashEventsParams,
  context: AccountContext
): Promise<ListCrashEventsResult> {
  const { projectId, issueId, issueVariantId, pageSize, startTime } = params
  const result = await getHelper(context, projectId)
  if ('error' in result) return { success: false, error: result.error }

  try {
    const data = await result.helper.listEvents({
      issueId,
      issueVariantId,
      pageSize,
      intervalStartTime: startTime,
    })
    return {
      success: true,
      events: data.events || [],
      nextPageToken: data.nextPageToken,
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to list crash events' }
  }
}

// ============ Get Crash Metrics (Top Versions) ============

export interface GetCrashMetricsParams {
  projectId: string
  pageSize?: number
  startTime?: string
}

export interface GetCrashMetricsResult {
  success: boolean
  versions?: any[]
  error?: string
}

export async function getCrashMetrics(
  params: GetCrashMetricsParams,
  context: AccountContext
): Promise<GetCrashMetricsResult> {
  const { projectId, pageSize, startTime } = params
  const result = await getHelper(context, projectId)
  if ('error' in result) {
    // Try Firebase Analytics fallback for crash metrics by app version
    if ('projectContext' in result && result.projectContext) {
      const analyticsHelper = await getFirebaseAnalyticsHelper(context.userId, projectId, result.projectContext.orgId)
      if (analyticsHelper) {
        try {
          const data = await analyticsHelper.runReport({
            dateRanges: [{ startDate: startTime || '30daysAgo', endDate: 'today' }],
            dimensions: [{ name: 'appVersion' }],
            metrics: [
              { name: 'crashAffectedUsers' },
              { name: 'crashFreeUsersRate' },
              { name: 'activeUsers' },
            ],
            orderBys: [{ metric: { metricName: 'crashAffectedUsers' }, desc: true }],
            limit: pageSize || 20,
          })
          return {
            success: true,
            versions: data.rows?.map(r => ({
              version: r.dimensionValues?.[0]?.value || 'unknown',
              crashAffectedUsers: Number(r.metricValues?.[0]?.value || 0),
              crashFreeRate: r.metricValues?.[1]?.value || 'N/A',
              activeUsers: Number(r.metricValues?.[2]?.value || 0),
            })) || [],
            _fallbackSource: 'firebase_analytics',
            _note: 'Crashlytics not configured. Version crash data from Firebase Analytics (GA4).',
          } as any
        } catch { /* Fall through to error */ }
      }
    }
    return { success: false, error: result.error }
  }

  try {
    const data = await result.helper.getTopVersions({ pageSize, intervalStartTime: startTime })
    return {
      success: true,
      versions: data.versions || data.topVersions || [],
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to get crash metrics' }
  }
}

// ============ Update Crash Issue State ============

export interface UpdateCrashIssueStateParams {
  projectId: string
  issueId: string
  state: 'OPEN' | 'CLOSED' | 'MUTED'
}

export interface UpdateCrashIssueStateResult {
  success: boolean
  issue?: any
  error?: string
}

export async function updateCrashIssueState(
  params: UpdateCrashIssueStateParams,
  context: AccountContext
): Promise<UpdateCrashIssueStateResult> {
  const { projectId, issueId, state } = params
  const result = await getHelper(context, projectId)
  if ('error' in result) return { success: false, error: result.error }

  try {
    const issue = await result.helper.updateIssue(issueId, state)
    return { success: true, issue }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to update crash issue state' }
  }
}

// ============ Add Crash Note ============

export interface AddCrashNoteParams {
  projectId: string
  issueId: string
  note: string
}

export interface AddCrashNoteResult {
  success: boolean
  noteId?: string
  error?: string
}

export async function addCrashNote(
  params: AddCrashNoteParams,
  context: AccountContext
): Promise<AddCrashNoteResult> {
  const { projectId, issueId, note } = params
  const result = await getHelper(context, projectId)
  if ('error' in result) return { success: false, error: result.error }

  try {
    const data = await result.helper.createNote(issueId, note)
    return { success: true, noteId: data.name?.split('/').pop() || data.id }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to add crash note' }
  }
}

// ============ List Crash Notes ============

export interface ListCrashNotesParams {
  projectId: string
  issueId: string
  pageSize?: number
}

export interface ListCrashNotesResult {
  success: boolean
  notes?: any[]
  error?: string
}

export async function listCrashNotes(
  params: ListCrashNotesParams,
  context: AccountContext
): Promise<ListCrashNotesResult> {
  const { projectId, issueId, pageSize } = params
  const result = await getHelper(context, projectId)
  if ('error' in result) return { success: false, error: result.error }

  try {
    const data = await result.helper.listNotes(issueId, pageSize || 20)
    return {
      success: true,
      notes: data.notes || [],
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to list crash notes' }
  }
}

// ============ Get Top Crash Devices ============

export interface GetTopCrashDevicesParams {
  projectId: string
  pageSize?: number
  storeType?: 'ios' | 'android'
}

export interface GetTopCrashDevicesResult {
  success: boolean
  devices?: any[]
  platform?: string
  error?: string
}

export async function getTopCrashDevices(
  params: GetTopCrashDevicesParams,
  context: AccountContext
): Promise<GetTopCrashDevicesResult> {
  const { projectId, pageSize, storeType } = params
  const result = await getHelper(context, projectId)
  if ('error' in result) {
    // Try Firebase Analytics fallback for device crash data
    if ('projectContext' in result && result.projectContext) {
      const analyticsHelper = await getFirebaseAnalyticsHelper(context.userId, projectId, result.projectContext.orgId)
      if (analyticsHelper) {
        try {
          const data = await analyticsHelper.runReport({
            dateRanges: [{ startDate: '30daysAgo', endDate: 'today' }],
            dimensions: [{ name: 'deviceModel' }],
            metrics: [
              { name: 'crashAffectedUsers' },
              { name: 'activeUsers' },
            ],
            orderBys: [{ metric: { metricName: 'crashAffectedUsers' }, desc: true }],
            limit: pageSize || 20,
          })
          return {
            success: true,
            devices: data.rows?.map(r => ({
              device: r.dimensionValues?.[0]?.value || 'unknown',
              crashAffectedUsers: Number(r.metricValues?.[0]?.value || 0),
              activeUsers: Number(r.metricValues?.[1]?.value || 0),
            })) || [],
            platform: storeType || 'unknown',
            _fallbackSource: 'firebase_analytics',
            _note: 'Crashlytics not configured. Device crash data from Firebase Analytics (GA4).',
          } as any
        } catch { /* Fall through to error */ }
      }
    }
    return { success: false, error: result.error }
  }

  try {
    // Determine platform from explicit storeType param or from the App ID itself
    let platform: string
    if (storeType) {
      platform = storeType
    } else {
      const appIdParts = result.helper.appId.split(':')
      platform = appIdParts[2] || 'android'
    }

    let data: any
    if (platform === 'ios') {
      data = await result.helper.getTopAppleDevices({ pageSize })
    } else {
      data = await result.helper.getTopAndroidDevices({ pageSize })
    }

    return {
      success: true,
      devices: data.devices || data.topDevices || [],
      platform,
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to get top crash devices' }
  }
}
