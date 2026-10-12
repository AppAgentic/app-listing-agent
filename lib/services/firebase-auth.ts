/**
 * Firebase Auth REST API Service
 * Provides user management via Firebase Auth REST API + Identity Toolkit.
 * Requires firebaseProjectId set on the project.
 */

import { google } from 'googleapis'
import { getFirebaseServiceAccountJson } from './crashlytics'

const IDENTITY_BASE = 'https://identitytoolkit.googleapis.com/v1'

// ============ Types ============

export interface FirebaseUser {
  localId: string
  email?: string
  emailVerified?: boolean
  displayName?: string
  photoUrl?: string
  disabled?: boolean
  providerUserInfo?: Array<{
    providerId: string
    rawId?: string
    email?: string
    displayName?: string
    photoUrl?: string
  }>
  createdAt?: string
  lastLoginAt?: string
  lastRefreshAt?: string
  phoneNumber?: string
  customAttributes?: string
}

export interface UpdateUserParams {
  displayName?: string | null
  email?: string
  emailVerified?: boolean
  disabled?: boolean
  phoneNumber?: string | null
  photoUrl?: string | null
  customAttributes?: string
}

// ============ Helper Class ============

export class FirebaseAuthHelper {
  private authClient: any

  constructor(private serviceAccountJson: string, public readonly projectId: string) {
    const serviceAccount = JSON.parse(serviceAccountJson)
    const auth = new google.auth.GoogleAuth({
      credentials: serviceAccount,
      scopes: ['https://www.googleapis.com/auth/firebase'],
    })
    this.authClient = auth
  }

  private async getToken(): Promise<string> {
    const client = await this.authClient.getClient()
    const { token } = await client.getAccessToken()
    return token!
  }

  private async post<T>(endpoint: string, body: any): Promise<T> {
    const token = await this.getToken()
    const url = `${IDENTITY_BASE}/${endpoint}?targetProjectId=${this.projectId}`

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
      const message = err?.error?.message || `Firebase Auth ${res.status}`
      throw new Error(message)
    }

    return res.json()
  }

  /**
   * List users (up to maxResults, default 100).
   */
  async listUsers(params?: { maxResults?: number; nextPageToken?: string }): Promise<{ users: FirebaseUser[]; nextPageToken?: string }> {
    const data = await this.post<any>('projects:listUsers', {
      maxResults: params?.maxResults || 100,
      nextPageToken: params?.nextPageToken,
    })
    return { users: data.users || [], nextPageToken: data.nextPageToken }
  }

  /**
   * Get a user by UID or email.
   */
  async getUser(identifier: { uid?: string; email?: string; phoneNumber?: string }): Promise<FirebaseUser | null> {
    const localId = identifier.uid ? [identifier.uid] : undefined
    const email = identifier.email ? [identifier.email] : undefined
    const phoneNumber = identifier.phoneNumber ? [identifier.phoneNumber] : undefined

    const data = await this.post<any>('accounts:lookup', { localId, email, phoneNumber })
    return data.users?.[0] || null
  }

  /**
   * Update a user's profile or account state.
   */
  async updateUser(uid: string, updates: UpdateUserParams): Promise<FirebaseUser> {
    const body: any = { localId: uid }
    if (updates.email !== undefined) body.email = updates.email
    if (updates.emailVerified !== undefined) body.emailVerified = updates.emailVerified
    if (updates.displayName !== undefined) {
      if (updates.displayName === null) body.deleteAttribute = ['DISPLAY_NAME']
      else body.displayName = updates.displayName
    }
    if (updates.disabled !== undefined) body.disableUser = updates.disabled
    if (updates.phoneNumber !== undefined) {
      if (updates.phoneNumber === null) body.deleteAttribute = [...(body.deleteAttribute || []), 'PHONE_NUMBER']
      else body.phoneNumber = updates.phoneNumber
    }
    if (updates.photoUrl !== undefined) {
      if (updates.photoUrl === null) body.deleteAttribute = [...(body.deleteAttribute || []), 'PHOTO_URL']
      else body.photoUrl = updates.photoUrl
    }
    if (updates.customAttributes !== undefined) body.customAttributes = updates.customAttributes

    const data = await this.post<any>('accounts:update', body)
    return data
  }

  /**
   * Disable a user.
   */
  async disableUser(uid: string): Promise<FirebaseUser> {
    return this.updateUser(uid, { disabled: true })
  }

  /**
   * Enable a user.
   */
  async enableUser(uid: string): Promise<FirebaseUser> {
    return this.updateUser(uid, { disabled: false })
  }

  /**
   * Delete a user by UID.
   */
  async deleteUser(uid: string): Promise<void> {
    await this.post('accounts:delete', { localId: uid })
  }

  /**
   * Test connection by listing 1 user.
   */
  async testConnection(): Promise<boolean> {
    await this.listUsers({ maxResults: 1 })
    return true
  }
}

// ============ Factory Function ============

export async function getFirebaseAuthHelper(
  userId: string,
  projectId: string,
  orgId?: string
): Promise<FirebaseAuthHelper | null> {
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

  return new FirebaseAuthHelper(sa, firebaseProjectId)
}
