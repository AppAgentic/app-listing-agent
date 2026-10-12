/**
 * Firebase Analytics (GA4 Data API v1beta) Service
 * Provides integration with Google Analytics for Firebase to pull user metrics,
 * event data, retention, and real-time stats.
 * Reuses the same Google service account as Crashlytics.
 */

import { google } from 'googleapis'
import { getFirebaseServiceAccountJson } from './crashlytics'

const ANALYTICS_BASE = 'https://analyticsdata.googleapis.com/v1beta'

// ============ Types ============

export interface AnalyticsDimension {
  name: string
}

export interface AnalyticsMetric {
  name: string
}

export interface AnalyticsDateRange {
  startDate: string  // e.g. "7daysAgo", "2024-01-01"
  endDate: string    // e.g. "today", "2024-01-31"
}

export interface AnalyticsOrderBy {
  metric?: { metricName: string }
  dimension?: { dimensionName: string }
  desc?: boolean
}

export interface AnalyticsReportRequest {
  dateRanges: AnalyticsDateRange[]
  dimensions?: AnalyticsDimension[]
  metrics: AnalyticsMetric[]
  limit?: number
  orderBys?: AnalyticsOrderBy[]
  dimensionFilter?: any
  metricFilter?: any
  keepEmptyRows?: boolean
}

export interface AnalyticsReportRow {
  dimensionValues?: Array<{ value: string }>
  metricValues?: Array<{ value: string }>
}

export interface AnalyticsReportResponse {
  dimensionHeaders?: Array<{ name: string }>
  metricHeaders?: Array<{ name: string; type: string }>
  rows?: AnalyticsReportRow[]
  rowCount?: number
  metadata?: any
}

// ============ Helper Class ============

export class FirebaseAnalyticsHelper {
  private authClient: any

  constructor(private serviceAccountJson: string, public readonly propertyId: string) {
    const serviceAccount = JSON.parse(serviceAccountJson)
    const auth = new google.auth.GoogleAuth({
      credentials: serviceAccount,
      scopes: ['https://www.googleapis.com/auth/analytics.readonly'],
    })
    this.authClient = auth
  }

  private async getToken(): Promise<string> {
    const client = await this.authClient.getClient()
    const { token } = await client.getAccessToken()
    return token!
  }

  private get propertyPath() {
    return `properties/${this.propertyId}`
  }

  private async post<T>(endpoint: string, body: any): Promise<T> {
    const token = await this.getToken()
    const url = `${ANALYTICS_BASE}/${this.propertyPath}:${endpoint}`

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    })

    if (!res.ok) {
      const err: any = await res.json().catch(() => ({}))
      const message = err?.error?.message || `Analytics API ${res.status}`
      console.error('[Firebase Analytics]', res.status, message, JSON.stringify(err?.error || {}))
      throw new Error(message)
    }

    return res.json()
  }

  /**
   * Run a flexible GA4 report. Returns rows with dimension and metric values.
   */
  async runReport(req: AnalyticsReportRequest): Promise<AnalyticsReportResponse> {
    return this.post<AnalyticsReportResponse>('runReport', req)
  }

  /**
   * Real-time report — active users in the last 30 minutes.
   */
  async runRealtimeReport(req: {
    dimensions?: AnalyticsDimension[]
    metrics: AnalyticsMetric[]
    limit?: number
  }): Promise<AnalyticsReportResponse> {
    return this.post<AnalyticsReportResponse>('runRealtimeReport', req)
  }

  /**
   * Top events by count over a date range.
   */
  async getTopEvents(params?: { startDate?: string; endDate?: string; limit?: number }) {
    return this.runReport({
      dateRanges: [{ startDate: params?.startDate || '30daysAgo', endDate: params?.endDate || 'today' }],
      dimensions: [{ name: 'eventName' }],
      metrics: [{ name: 'eventCount' }, { name: 'totalUsers' }],
      limit: params?.limit || 20,
      orderBys: [{ metric: { metricName: 'eventCount' }, desc: true }],
    })
  }

  /**
   * Core user metrics: DAU, WAU, MAU, sessions, new users.
   */
  async getUserMetrics(params?: { startDate?: string; endDate?: string }) {
    return this.runReport({
      dateRanges: [{ startDate: params?.startDate || '30daysAgo', endDate: params?.endDate || 'today' }],
      dimensions: [{ name: 'date' }],
      metrics: [
        { name: 'activeUsers' },
        { name: 'newUsers' },
        { name: 'sessions' },
        { name: 'screenPageViews' },
        { name: 'averageSessionDuration' },
      ],
      orderBys: [{ dimension: { dimensionName: 'date' }, desc: false }],
    })
  }

  /**
   * Active users right now (last 30 minutes), broken down by country.
   */
  async getRealtimeUsers() {
    return this.runRealtimeReport({
      dimensions: [{ name: 'country' }, { name: 'deviceCategory' }],
      metrics: [{ name: 'activeUsers' }],
      limit: 20,
    })
  }

  /**
   * User acquisition — where new users come from.
   */
  async getUserAcquisition(params?: { startDate?: string; endDate?: string; limit?: number }) {
    return this.runReport({
      dateRanges: [{ startDate: params?.startDate || '30daysAgo', endDate: params?.endDate || 'today' }],
      dimensions: [{ name: 'firstUserDefaultChannelGroup' }],
      metrics: [{ name: 'newUsers' }, { name: 'sessions' }],
      limit: params?.limit || 10,
      orderBys: [{ metric: { metricName: 'newUsers' }, desc: true }],
    })
  }

  /**
   * Top countries by active users.
   */
  async getTopCountries(params?: { startDate?: string; endDate?: string; limit?: number }) {
    return this.runReport({
      dateRanges: [{ startDate: params?.startDate || '30daysAgo', endDate: params?.endDate || 'today' }],
      dimensions: [{ name: 'country' }],
      metrics: [{ name: 'activeUsers' }, { name: 'newUsers' }],
      limit: params?.limit || 10,
      orderBys: [{ metric: { metricName: 'activeUsers' }, desc: true }],
    })
  }

  /**
   * Test connection — runs a minimal report.
   */
  async testConnection(): Promise<boolean> {
    await this.runReport({
      dateRanges: [{ startDate: 'yesterday', endDate: 'today' }],
      metrics: [{ name: 'activeUsers' }],
      limit: 1,
    })
    return true
  }
}

// ============ Factory Function ============

export async function getFirebaseAnalyticsHelper(
  userId: string,
  projectId: string,
  orgId?: string
): Promise<FirebaseAnalyticsHelper | null> {
  const { isInternalIntegrationUser } = await import('@/lib/features/internal-integrations.server')
  if (!await isInternalIntegrationUser(userId, orgId)) return null

  // Guard against empty strings that cause Firestore "documentPath is not a valid resource path" errors
  if (!userId || !projectId) {
    console.error('[getFirebaseAnalyticsHelper] Missing userId or projectId:', { userId: !!userId, projectId: !!projectId })
    return null
  }
  if (orgId !== undefined && !orgId) {
    orgId = undefined
  }

  const { adminDb } = await import('@/lib/firebase/admin')

  const basePath = orgId
    ? adminDb.collection('organizations').doc(orgId).collection('projects').doc(projectId)
    : adminDb.collection('users').doc(userId).collection('projects').doc(projectId)

  const projectDoc = await basePath.get()
  if (!projectDoc.exists) return null

  // Try this project's analyticsPropertyId, then fall back to the linked project's
  let propertyId = projectDoc.data()?.firebaseAnalyticsPropertyId
  if (!propertyId) {
    const linkedId = projectDoc.data()?.linkedProjectId
    if (linkedId && typeof linkedId === 'string' && linkedId.trim()) {
      const linkedBase = orgId
        ? adminDb.collection('organizations').doc(orgId).collection('projects').doc(linkedId)
        : adminDb.collection('users').doc(userId).collection('projects').doc(linkedId)
      const linkedDoc = await linkedBase.get()
      propertyId = linkedDoc.data()?.firebaseAnalyticsPropertyId
    }
  }
  if (!propertyId) return null

  const sa = await getFirebaseServiceAccountJson(userId, projectId, orgId)
  if (!sa) return null

  try {
    return new FirebaseAnalyticsHelper(sa, propertyId)
  } catch {
    return null
  }
}
