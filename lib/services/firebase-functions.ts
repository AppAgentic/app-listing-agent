/**
 * Firebase Cloud Functions Management API Service
 * Provides listing and inspection of deployed Cloud Functions.
 * Requires firebaseProjectId set on the project.
 */

import { google } from 'googleapis'
import { getFirebaseServiceAccountJson } from './crashlytics'

const FUNCTIONS_BASE = 'https://cloudfunctions.googleapis.com/v2'
const LOGGING_BASE = 'https://logging.googleapis.com/v2'

// ============ Types ============

export interface CloudFunction {
  name: string
  description?: string
  state?: 'ACTIVE' | 'FAILED' | 'DEPLOYING' | 'DELETING' | 'UNKNOWN'
  url?: string
  runtime?: string
  entryPoint?: string
  updateTime?: string
  labels?: Record<string, string>
  serviceConfig?: {
    uri?: string
    timeoutSeconds?: number
    availableMemory?: string
    maxInstanceCount?: number
    minInstanceCount?: number
  }
  eventTrigger?: {
    eventType?: string
    pubsubTopic?: string
    serviceAccountEmail?: string
  }
}

export interface FunctionLogEntry {
  timestamp?: string
  severity?: string
  textPayload?: string
  jsonPayload?: Record<string, any>
  resource?: { labels?: Record<string, string> }
  insertId?: string
}

// ============ Helper Class ============

export class FirebaseFunctionsHelper {
  private authClient: any

  constructor(private serviceAccountJson: string, public readonly projectId: string) {
    const serviceAccount = JSON.parse(serviceAccountJson)
    const auth = new google.auth.GoogleAuth({
      credentials: serviceAccount,
      scopes: [
        'https://www.googleapis.com/auth/cloud-platform',
      ],
    })
    this.authClient = auth
  }

  private async getToken(): Promise<string> {
    const client = await this.authClient.getClient()
    const { token } = await client.getAccessToken()
    return token!
  }

  private async get<T>(url: string): Promise<T> {
    const token = await this.getToken()

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15000),
    })

    if (!res.ok) {
      const err: any = await res.json().catch(() => ({}))
      const message = err?.error?.message || `Cloud Functions API ${res.status}`
      throw new Error(message)
    }

    return res.json()
  }

  /**
   * List all Cloud Functions in all regions.
   */
  async listFunctions(params?: { pageSize?: number }): Promise<CloudFunction[]> {
    const pageSize = params?.pageSize || 100
    const url = `${FUNCTIONS_BASE}/projects/${this.projectId}/locations/-/functions?pageSize=${pageSize}`
    const data = await this.get<any>(url)
    return (data.functions || []).map((f: any) => ({
      name: f.name?.split('/').pop() || f.name,
      description: f.description,
      state: f.state,
      url: f.serviceConfig?.uri,
      runtime: f.buildConfig?.runtime,
      entryPoint: f.buildConfig?.entryPoint,
      updateTime: f.updateTime,
      labels: f.labels,
      serviceConfig: f.serviceConfig,
      eventTrigger: f.eventTrigger,
    }))
  }

  /**
   * Get a specific function by name.
   */
  async getFunction(functionName: string, region?: string): Promise<CloudFunction> {
    const loc = region || 'us-central1'
    const url = `${FUNCTIONS_BASE}/projects/${this.projectId}/locations/${loc}/functions/${functionName}`
    const f = await this.get<any>(url)
    return {
      name: f.name?.split('/').pop() || f.name,
      description: f.description,
      state: f.state,
      url: f.serviceConfig?.uri,
      runtime: f.buildConfig?.runtime,
      entryPoint: f.buildConfig?.entryPoint,
      updateTime: f.updateTime,
      labels: f.labels,
      serviceConfig: f.serviceConfig,
      eventTrigger: f.eventTrigger,
    }
  }

  /**
   * Fetch recent logs for a function using Cloud Logging API.
   */
  async getFunctionLogs(params?: {
    functionName?: string
    pageSize?: number
    severity?: 'DEFAULT' | 'DEBUG' | 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL'
    startTime?: string
    endTime?: string
  }): Promise<FunctionLogEntry[]> {
    const token = await this.getToken()
    const pageSize = params?.pageSize || 50

    let filter = `resource.type="cloud_run_revision" OR resource.type="cloud_function"`
    filter += ` AND resource.labels.project_id="${this.projectId}"`
    if (params?.functionName) filter += ` AND resource.labels.function_name="${params.functionName}"`
    if (params?.severity) filter += ` AND severity>=${params.severity}`
    if (params?.startTime) filter += ` AND timestamp>="${params.startTime}"`
    if (params?.endTime) filter += ` AND timestamp<="${params.endTime}"`

    const body = {
      resourceNames: [`projects/${this.projectId}`],
      filter,
      pageSize,
      orderBy: 'timestamp desc',
    }

    const res = await fetch(`${LOGGING_BASE}/entries:list`, {
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
      throw new Error(err?.error?.message || `Logging API ${res.status}`)
    }

    const data = await res.json()
    return data.entries || []
  }

  /**
   * Test connection by listing functions.
   */
  async testConnection(): Promise<boolean> {
    await this.listFunctions({ pageSize: 1 })
    return true
  }
}

// ============ Factory Function ============

export async function getFirebaseFunctionsHelper(
  userId: string,
  projectId: string,
  orgId?: string
): Promise<FirebaseFunctionsHelper | null> {
  const { isInternalIntegrationUser } = await import('@/lib/features/internal-integrations.server')
  if (!await isInternalIntegrationUser(userId, orgId)) return null

  const { adminDb } = await import('@/lib/firebase/admin')

  const basePath = orgId
    ? adminDb.collection('organizations').doc(orgId).collection('projects').doc(projectId)
    : adminDb.collection('users').doc(userId).collection('projects').doc(projectId)

  const projectDoc = await basePath.get()
  if (!projectDoc.exists) return null

  const projectData = projectDoc.data()!
  let firebaseProjectId = projectData.firebaseProjectId as string | undefined
  if (!firebaseProjectId) {
    const linkedId = projectData.linkedProjectId as string | undefined
    if (linkedId) {
      const linkedBase = orgId
        ? adminDb.collection('organizations').doc(orgId).collection('projects').doc(linkedId)
        : adminDb.collection('users').doc(userId).collection('projects').doc(linkedId)
      const linkedDoc = await linkedBase.get()
      firebaseProjectId = linkedDoc.data()?.firebaseProjectId
    }
  }
  if (!firebaseProjectId) return null

  const sa = await getFirebaseServiceAccountJson(userId, projectId, orgId)
  if (!sa) return null

  return new FirebaseFunctionsHelper(sa, firebaseProjectId)
}
