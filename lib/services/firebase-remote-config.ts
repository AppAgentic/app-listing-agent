/**
 * Firebase Remote Config REST API Service
 * Provides management of Remote Config parameters and conditions.
 * Requires firebaseProjectId set on the project.
 */

import { google } from 'googleapis'
import { getFirebaseServiceAccountJson } from './crashlytics'

const RC_BASE = 'https://firebaseremoteconfig.googleapis.com/v1'

// ============ Types ============

export interface RemoteConfigParameter {
  defaultValue?: { value?: string; useInAppDefault?: boolean }
  conditionalValues?: Record<string, { value?: string; useInAppDefault?: boolean }>
  description?: string
  valueType?: 'STRING' | 'BOOLEAN' | 'NUMBER' | 'JSON'
}

export interface RemoteConfigCondition {
  name: string
  expression: string
  tagColor?: string
}

export interface RemoteConfigTemplate {
  parameters?: Record<string, RemoteConfigParameter>
  conditions?: RemoteConfigCondition[]
  parameterGroups?: Record<string, {
    description?: string
    parameters: Record<string, RemoteConfigParameter>
  }>
  version?: {
    versionNumber?: string
    updateTime?: string
    updateUser?: { email?: string; name?: string; imageUrl?: string }
    description?: string
    updateOrigin?: string
    updateType?: string
    rollbackSource?: string
  }
}

export interface RemoteConfigVersion {
  versionNumber: string
  updateTime?: string
  updateUser?: { email?: string; name?: string }
  description?: string
  updateOrigin?: string
  updateType?: string
}

// ============ Helper Class ============

export class FirebaseRemoteConfigHelper {
  private authClient: any

  constructor(private serviceAccountJson: string, public readonly projectId: string) {
    const serviceAccount = JSON.parse(serviceAccountJson)
    const auth = new google.auth.GoogleAuth({
      credentials: serviceAccount,
      scopes: ['https://www.googleapis.com/auth/firebase.remoteconfig'],
    })
    this.authClient = auth
  }

  private async getToken(): Promise<string> {
    const client = await this.authClient.getClient()
    const { token } = await client.getAccessToken()
    return token!
  }

  private async request<T>(method: string, path: string, body?: any, extraHeaders?: Record<string, string>): Promise<{ data: T; etag?: string }> {
    const token = await this.getToken()
    const url = `${RC_BASE}/${path}`

    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...extraHeaders,
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000),
    })

    if (!res.ok) {
      const err: any = await res.json().catch(() => ({}))
      const message = err?.error?.message || `Remote Config API ${res.status}`
      throw new Error(message)
    }

    const data = await res.json()
    const etag = res.headers.get('ETag') || undefined
    return { data, etag }
  }

  /**
   * Get the current Remote Config template.
   */
  async getTemplate(): Promise<{ template: RemoteConfigTemplate; etag: string }> {
    const { data, etag } = await this.request<RemoteConfigTemplate>('GET', `projects/${this.projectId}/remoteConfig`)
    return { template: data, etag: etag || '*' }
  }

  /**
   * Update the Remote Config template (requires ETag from getTemplate).
   * Pass etag='*' to force-update regardless of conflicts.
   */
  async updateTemplate(template: RemoteConfigTemplate, etag: string): Promise<RemoteConfigTemplate> {
    const { data } = await this.request<RemoteConfigTemplate>('PUT', `projects/${this.projectId}/remoteConfig`, template, {
      'If-Match': etag,
    })
    return data
  }

  /**
   * Publish (validate + update) a template. Same as updateTemplate but validates first.
   */
  async publishTemplate(template: RemoteConfigTemplate, etag: string): Promise<RemoteConfigTemplate> {
    // Validate first
    await this.request<any>('POST', `projects/${this.projectId}/remoteConfig:validate`, template)
    return this.updateTemplate(template, etag)
  }

  /**
   * List historical versions.
   */
  async listVersions(params?: { pageSize?: number }): Promise<RemoteConfigVersion[]> {
    const qs = params?.pageSize ? `?pageSize=${params.pageSize}` : ''
    const { data } = await this.request<any>('GET', `projects/${this.projectId}/remoteConfig:listVersions${qs}`)
    return data.versions || []
  }

  /**
   * Rollback to a specific version number.
   */
  async rollback(versionNumber: string): Promise<RemoteConfigTemplate> {
    const { data } = await this.request<RemoteConfigTemplate>('POST', `projects/${this.projectId}/remoteConfig:rollback`, { versionNumber })
    return data
  }

  /**
   * Test connection by fetching the template.
   */
  async testConnection(): Promise<boolean> {
    await this.getTemplate()
    return true
  }
}

// ============ Factory Function ============

export async function getFirebaseRemoteConfigHelper(
  userId: string,
  projectId: string,
  orgId?: string
): Promise<FirebaseRemoteConfigHelper | null> {
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

  return new FirebaseRemoteConfigHelper(sa, firebaseProjectId)
}
