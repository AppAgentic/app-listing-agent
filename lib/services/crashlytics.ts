/**
 * Firebase Crashlytics API Service
 * Provides integration with Firebase Crashlytics for crash reporting and issue management.
 * Replicates the exact Firebase MCP server Crashlytics API calls.
 */

import { google } from 'googleapis'

const CRASHLYTICS_BASE = 'https://firebasecrashlytics.googleapis.com/v1alpha'
const TIMEOUT = 10000

// ============ Helper Class ============

export class CrashlyticsHelper {
  private authClient: any
  private projectNumber: string

  constructor(private serviceAccountJson: string, public readonly appId: string) {
    // App ID format: "1:PROJECT_NUMBER:android:HASH" or "1:PROJECT_NUMBER:ios:HASH"
    this.projectNumber = appId.split(':')[1]
    if (!this.projectNumber) {
      throw new Error('Invalid Firebase App ID format. Expected format: 1:PROJECT_NUMBER:platform:HASH')
    }
    const serviceAccount = JSON.parse(serviceAccountJson)
    const auth = new google.auth.GoogleAuth({
      credentials: serviceAccount,
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    })
    this.authClient = auth
  }

  private async getToken(): Promise<string> {
    const client = await this.authClient.getClient()
    const { token } = await client.getAccessToken()
    return token!
  }

  private get basePath() {
    return `/projects/${this.projectNumber}/apps/${this.appId}`
  }

  private async request<T>(
    method: string,
    path: string,
    opts: { body?: any; params?: Record<string, string | string[]> } = {}
  ): Promise<T> {
    const token = await this.getToken()
    const url = new URL(`${CRASHLYTICS_BASE}${path}`)
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        if (Array.isArray(v)) v.forEach(val => url.searchParams.append(k, val))
        else url.searchParams.set(k, v)
      }
    }

    console.log(`[Crashlytics] ${method} ${url.toString()}`)

    const res = await fetch(url.toString(), {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT),
    })

    if (!res.ok) {
      const err: any = await res.json().catch(() => ({}))
      const message = err?.error?.message || `Crashlytics API ${res.status}`
      console.error(`[Crashlytics] Error ${res.status}:`, message)
      throw new Error(message)
    }

    return res.json()
  }

  // ============ Reports ============

  async getTopIssues(params?: {
    pageSize?: number
    intervalStartTime?: string
    intervalEndTime?: string
    issueErrorTypes?: string[]
  }) {
    return this.request<any>('GET', `${this.basePath}/reports/topIssues`, {
      params: buildFilterParams(params),
    })
  }

  async getTopVersions(params?: {
    pageSize?: number
    intervalStartTime?: string
  }) {
    try {
      return await this.request<any>('GET', `${this.basePath}/reports/topVersions`, {
        params: buildFilterParams(params),
      })
    } catch (error) {
      // topVersions endpoint may not exist in v1alpha — fall back to extracting
      // version data from topIssues grouped by appVersion
      const errorMsg = error instanceof Error ? error.message : String(error)
      if (errorMsg.includes('Method not found') || errorMsg.includes('404') || errorMsg.includes('Not Found')) {
        console.warn('[Crashlytics] topVersions endpoint not available, falling back to topIssues version aggregation')
        const issuesData = await this.request<any>('GET', `${this.basePath}/reports/topIssues`, {
          params: buildFilterParams({ ...params, pageSize: params?.pageSize || 50 }),
        })
        // Extract version breakdown from issues
        const versionMap = new Map<string, { eventCount: number; issueCount: number }>()
        const issues = issuesData.issues || issuesData.topIssues || []
        for (const issue of issues) {
          const version = issue.latestAppVersion || issue.appVersion || 'unknown'
          const existing = versionMap.get(version) || { eventCount: 0, issueCount: 0 }
          existing.eventCount += Number(issue.eventCount || issue.count || 0)
          existing.issueCount += 1
          versionMap.set(version, existing)
        }
        const versions = Array.from(versionMap.entries())
          .map(([version, stats]) => ({ version, ...stats }))
          .sort((a, b) => b.eventCount - a.eventCount)
        return { versions, _fallback: true, _note: 'Aggregated from topIssues — topVersions endpoint unavailable' }
      }
      throw error
    }
  }

  async getTopAndroidDevices(params?: { pageSize?: number }) {
    return this.request<any>('GET', `${this.basePath}/reports/topAndroidDevices`, {
      params: buildFilterParams(params),
    })
  }

  async getTopAppleDevices(params?: { pageSize?: number }) {
    return this.request<any>('GET', `${this.basePath}/reports/topAppleDevices`, {
      params: buildFilterParams(params),
    })
  }

  async getTopOperatingSystems(params?: { pageSize?: number }) {
    return this.request<any>('GET', `${this.basePath}/reports/topOperatingSystems`, {
      params: buildFilterParams(params),
    })
  }

  // ============ Issues ============

  async getIssue(issueId: string) {
    return this.request<any>('GET', `${this.basePath}/issues/${issueId}`)
  }

  async updateIssue(issueId: string, state: 'OPEN' | 'CLOSED' | 'MUTED') {
    return this.request<any>('PATCH', `${this.basePath}/issues/${issueId}`, {
      body: { state },
      params: { updateMask: 'state' },
    })
  }

  // ============ Events (stack traces) ============

  async listEvents(params?: {
    issueId?: string
    issueVariantId?: string
    pageSize?: number
    intervalStartTime?: string
  }) {
    const filterParams = buildFilterParams(params)
    if (params?.issueId) filterParams['filter.issue.id'] = params.issueId
    if (params?.issueVariantId) filterParams['filter.issue.variant_id'] = params.issueVariantId
    return this.request<any>('GET', `${this.basePath}/events`, { params: filterParams })
  }

  // ============ Notes ============

  async listNotes(issueId: string, pageSize = 20) {
    return this.request<any>('GET', `${this.basePath}/issues/${issueId}/notes`, {
      params: { page_size: String(pageSize) },
    })
  }

  async createNote(issueId: string, note: string) {
    return this.request<any>('POST', `${this.basePath}/issues/${issueId}/notes`, {
      body: { body: note },
    })
  }

  async deleteNote(issueId: string, noteId: string) {
    return this.request<any>('DELETE', `${this.basePath}/issues/${issueId}/notes/${noteId}`)
  }

  // ============ Test Connection ============

  async testConnection(): Promise<boolean> {
    await this.getTopIssues({ pageSize: 1 })
    return true
  }
}

// ============ Param Builder ============

function buildFilterParams(params?: Record<string, any>): Record<string, string> {
  const out: Record<string, string> = {}
  if (!params) return out
  if (params.pageSize) out['page_size'] = String(params.pageSize)
  if (params.intervalStartTime) out['filter.interval.start_time'] = params.intervalStartTime
  if (params.intervalEndTime) out['filter.interval.end_time'] = params.intervalEndTime
  if (params.issueErrorTypes?.length) out['filter.issue.error_types'] = params.issueErrorTypes.join(',')
  return out
}

// ============ Shared Credential Lookup ============

/**
 * Resolve the Firebase service account JSON for Firebase APIs.
 * Priority:
 *   1. This project's credentials/firebase
 *   2. Linked project's credentials/firebase
 *
 * Exported so Analytics and other Firebase services can reuse the same logic.
 */
export async function getFirebaseServiceAccountJson(
  userId: string,
  projectId: string,
  orgId?: string
): Promise<string | null> {
  // Guard against empty strings that cause Firestore "documentPath is not a valid resource path" errors
  if (!userId || !projectId) {
    console.error('[getFirebaseServiceAccountJson] Missing userId or projectId:', { userId: !!userId, projectId: !!projectId })
    return null
  }
  if (orgId !== undefined && !orgId) {
    // orgId was explicitly passed but is empty — treat as personal account
    orgId = undefined
  }

  const { adminDb } = await import('@/lib/firebase/admin')
  const { decryptFirebaseCredentials } = await import('@/lib/crypto/credentials')

  const basePath = orgId
    ? adminDb.collection('organizations').doc(orgId).collection('projects').doc(projectId)
    : adminDb.collection('users').doc(userId).collection('projects').doc(projectId)

  const projectDoc = await basePath.get()
  if (!projectDoc.exists) return null
  const linkedProjectId = projectDoc.data()?.linkedProjectId

  async function tryFirebaseCred(credPath: any): Promise<string | null> {
    const doc = await credPath.doc('firebase').get()
    if (!doc.exists) return null
    try {
      const enc = doc.data()!
      const creds = await decryptFirebaseCredentials({ encryptedData: enc.encryptedData, encryptedDek: enc.encryptedDek, keyVersion: enc.keyVersion })
      return creds.serviceAccountJson || null
    } catch { return null }
  }

  const credPath = basePath.collection('credentials')

  const sa = await tryFirebaseCred(credPath)
  if (sa) return sa

  if (linkedProjectId && typeof linkedProjectId === 'string' && linkedProjectId.trim()) {
    const linkedBase = orgId
      ? adminDb.collection('organizations').doc(orgId).collection('projects').doc(linkedProjectId)
      : adminDb.collection('users').doc(userId).collection('projects').doc(linkedProjectId)
    const linkedCreds = linkedBase.collection('credentials')

    const linkedSa = await tryFirebaseCred(linkedCreds)
    if (linkedSa) return linkedSa
  }

  return null
}

// ============ Factory Function ============

/**
 * Get Crashlytics helper for a project.
 * Tries dedicated Firebase service account first (required for iOS, optional for Android).
 * Falls back to Play Store service account for Android projects.
 */
export async function getCrashlyticsHelper(
  userId: string,
  projectId: string,
  orgId?: string
): Promise<CrashlyticsHelper | null> {
  // Guard against empty strings that cause Firestore "documentPath is not a valid resource path" errors
  if (!userId || !projectId) {
    console.error('[getCrashlyticsHelper] Missing userId or projectId:', { userId: !!userId, projectId: !!projectId })
    return null
  }
  if (orgId !== undefined && !orgId) {
    orgId = undefined
  }

  const { isInternalIntegrationUser } = await import('@/lib/features/internal-integrations.server')
  if (!await isInternalIntegrationUser(userId, orgId)) {
    return null
  }

  const { adminDb } = await import('@/lib/firebase/admin')

  const basePath = orgId
    ? adminDb.collection('organizations').doc(orgId).collection('projects').doc(projectId)
    : adminDb.collection('users').doc(userId).collection('projects').doc(projectId)

  const projectDoc = await basePath.get()
  if (!projectDoc.exists) return null

  let firebaseAppId = projectDoc.data()?.firebaseAppId
  if (!firebaseAppId) {
    const linkedId = projectDoc.data()?.linkedProjectId
    if (linkedId && typeof linkedId === 'string' && linkedId.trim()) {
      const linkedBase = orgId
        ? adminDb.collection('organizations').doc(orgId).collection('projects').doc(linkedId)
        : adminDb.collection('users').doc(userId).collection('projects').doc(linkedId)
      const linkedDoc = await linkedBase.get()
      firebaseAppId = linkedDoc.data()?.firebaseAppId
    }
  }
  if (!firebaseAppId) return null

  const sa = await getFirebaseServiceAccountJson(userId, projectId, orgId)
  if (!sa) return null

  try {
    return new CrashlyticsHelper(sa, firebaseAppId)
  } catch {
    return null
  }
}
