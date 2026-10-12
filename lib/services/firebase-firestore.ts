/**
 * Firebase Firestore REST API Service
 * Provides access to Cloud Firestore via the REST API using a service account.
 * Requires firebaseProjectId set on the project.
 */

import { google } from 'googleapis'
import { getFirebaseServiceAccountJson } from './crashlytics'

const FIRESTORE_BASE = 'https://firestore.googleapis.com/v1'

// ============ Types ============

export interface FirestoreDocument {
  name?: string
  fields?: Record<string, FirestoreValue>
  createTime?: string
  updateTime?: string
}

export interface FirestoreValue {
  nullValue?: null
  booleanValue?: boolean
  integerValue?: string
  doubleValue?: number
  timestampValue?: string
  stringValue?: string
  bytesValue?: string
  referenceValue?: string
  geoPointValue?: { latitude: number; longitude: number }
  arrayValue?: { values?: FirestoreValue[] }
  mapValue?: { fields?: Record<string, FirestoreValue> }
}

export interface FirestoreQueryFilter {
  field: string
  op: 'EQUAL' | 'NOT_EQUAL' | 'LESS_THAN' | 'LESS_THAN_OR_EQUAL' | 'GREATER_THAN' | 'GREATER_THAN_OR_EQUAL' | 'ARRAY_CONTAINS' | 'IN' | 'NOT_IN' | 'ARRAY_CONTAINS_ANY'
  value: any
}

// ============ Helper Class ============

export class FirebaseFirestoreHelper {
  private authClient: any

  constructor(private serviceAccountJson: string, public readonly projectId: string) {
    const serviceAccount = JSON.parse(serviceAccountJson)
    const auth = new google.auth.GoogleAuth({
      credentials: serviceAccount,
      scopes: ['https://www.googleapis.com/auth/datastore'],
    })
    this.authClient = auth
  }

  private async getToken(): Promise<string> {
    const client = await this.authClient.getClient()
    const { token } = await client.getAccessToken()
    return token!
  }

  private get dbPath() {
    return `projects/${this.projectId}/databases/(default)/documents`
  }

  private async request<T>(method: string, path: string, body?: any): Promise<T> {
    const token = await this.getToken()
    const url = `${FIRESTORE_BASE}/${path}`

    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000),
    })

    if (!res.ok) {
      const err: any = await res.json().catch(() => ({}))
      const message = err?.error?.message || `Firestore API ${res.status}`
      throw new Error(message)
    }

    return res.json()
  }

  /**
   * List top-level collections in the database.
   */
  async listCollections(): Promise<string[]> {
    const data = await this.request<any>('POST', `${this.dbPath}:listCollectionIds`, {})
    return data.collectionIds || []
  }

  /**
   * List documents in a collection (shallow, max 100 by default).
   */
  async listDocuments(collection: string, params?: { pageSize?: number; pageToken?: string }): Promise<{ documents: FirestoreDocument[]; nextPageToken?: string }> {
    const qs = new URLSearchParams()
    if (params?.pageSize) qs.set('pageSize', String(params.pageSize))
    if (params?.pageToken) qs.set('pageToken', params.pageToken)
    const query = qs.toString() ? `?${qs.toString()}` : ''
    const data = await this.request<any>('GET', `${this.dbPath}/${collection}${query}`)
    return { documents: data.documents || [], nextPageToken: data.nextPageToken }
  }

  /**
   * Get a single document by path.
   */
  async getDocument(path: string): Promise<FirestoreDocument> {
    return this.request<FirestoreDocument>('GET', `${this.dbPath}/${path}`)
  }

  /**
   * Run a structured query against a collection.
   */
  async queryCollection(collection: string, filters?: FirestoreQueryFilter[], limit?: number): Promise<FirestoreDocument[]> {
    const where = filters && filters.length > 0 ? {
      compositeFilter: {
        op: 'AND',
        filters: filters.map(f => ({
          fieldFilter: {
            field: { fieldPath: f.field },
            op: f.op,
            value: this.encodeValue(f.value),
          }
        }))
      }
    } : undefined

    const body = {
      structuredQuery: {
        from: [{ collectionId: collection }],
        ...(where ? { where } : {}),
        ...(limit ? { limit } : {}),
      }
    }

    const data = await this.request<any[]>('POST', `${this.dbPath}:runQuery`, body)
    return (data || []).map((r: any) => r.document).filter(Boolean)
  }

  /**
   * Set (create or overwrite) a document.
   */
  async setDocument(path: string, data: Record<string, any>): Promise<FirestoreDocument> {
    const fields: Record<string, FirestoreValue> = {}
    for (const [key, val] of Object.entries(data)) {
      fields[key] = this.encodeValue(val)
    }
    return this.request<FirestoreDocument>('PATCH', `${this.dbPath}/${path}`, { fields })
  }

  /**
   * Delete a document.
   */
  async deleteDocument(path: string): Promise<void> {
    await this.request<any>('DELETE', `${this.dbPath}/${path}`)
  }

  /**
   * Test connection by listing collections.
   */
  async testConnection(): Promise<boolean> {
    await this.listCollections()
    return true
  }

  private encodeValue(val: any): FirestoreValue {
    if (val === null || val === undefined) return { nullValue: null }
    if (typeof val === 'boolean') return { booleanValue: val }
    if (typeof val === 'number') {
      if (Number.isInteger(val)) return { integerValue: String(val) }
      return { doubleValue: val }
    }
    if (typeof val === 'string') return { stringValue: val }
    if (Array.isArray(val)) return { arrayValue: { values: val.map(v => this.encodeValue(v)) } }
    if (typeof val === 'object') {
      const fields: Record<string, FirestoreValue> = {}
      for (const [k, v] of Object.entries(val)) fields[k] = this.encodeValue(v)
      return { mapValue: { fields } }
    }
    return { stringValue: String(val) }
  }
}

// ============ Factory Function ============

export async function getFirebaseFirestoreHelper(
  userId: string,
  projectId: string,
  orgId?: string
): Promise<FirebaseFirestoreHelper | null> {
  const { isInternalIntegrationUser } = await import('@/lib/features/internal-integrations.server')
  if (!await isInternalIntegrationUser(userId, orgId)) return null

  const { adminDb } = await import('@/lib/firebase/admin')

  const basePath = orgId
    ? adminDb.collection('organizations').doc(orgId).collection('projects').doc(projectId)
    : adminDb.collection('users').doc(userId).collection('projects').doc(projectId)

  const projectDoc = await basePath.get()
  if (!projectDoc.exists) return null

  const projectData = projectDoc.data()!
  let firestoreProjectId = projectData.firebaseProjectId as string | undefined
  if (!firestoreProjectId) {
    const linkedId = projectData.linkedProjectId as string | undefined
    if (linkedId) {
      const linkedBase = orgId
        ? adminDb.collection('organizations').doc(orgId).collection('projects').doc(linkedId)
        : adminDb.collection('users').doc(userId).collection('projects').doc(linkedId)
      const linkedDoc = await linkedBase.get()
      firestoreProjectId = linkedDoc.data()?.firebaseProjectId
    }
  }
  if (!firestoreProjectId) return null

  const sa = await getFirebaseServiceAccountJson(userId, projectId, orgId)
  if (!sa) return null

  return new FirebaseFirestoreHelper(sa, firestoreProjectId)
}
