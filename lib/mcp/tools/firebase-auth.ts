/**
 * Firebase Auth MCP Tools
 */

import { AccountContext, getProjectContext } from '@/lib/org/context'
import { getFirebaseAuthHelper } from '@/lib/services/firebase-auth'

async function getHelper(context: AccountContext, projectId: string) {
  const projectContext = await getProjectContext(context.userId, projectId)
  if (!projectContext) return { error: 'Project not found' as const }

  const helper = await getFirebaseAuthHelper(context.userId, projectId, projectContext.orgId)
  if (!helper) {
    return {
      error: 'Firebase Auth not configured. Add a Firebase Project ID in project settings and ensure a Firebase service account is configured.' as const
    }
  }
  return { helper }
}

// ============ List Users ============

export interface FirebaseAuthListUsersParams {
  projectId: string
  maxResults?: number
  nextPageToken?: string
}

export async function authListUsers(params: FirebaseAuthListUsersParams, context: AccountContext) {
  const r = await getHelper(context, params.projectId)
  if ('error' in r) return { success: false, error: r.error }
  try {
    const data = await r.helper.listUsers({ maxResults: params.maxResults, nextPageToken: params.nextPageToken })
    return { success: true, data }
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Failed' }
  }
}

// ============ Get User ============

export interface FirebaseAuthGetUserParams {
  projectId: string
  uid?: string
  email?: string
  phoneNumber?: string
}

export async function authGetUser(params: FirebaseAuthGetUserParams, context: AccountContext) {
  const r = await getHelper(context, params.projectId)
  if ('error' in r) return { success: false, error: r.error }
  try {
    const data = await r.helper.getUser({ uid: params.uid, email: params.email, phoneNumber: params.phoneNumber })
    return { success: true, data }
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Failed' }
  }
}

// ============ Update User ============

export interface FirebaseAuthUpdateUserParams {
  projectId: string
  uid: string
  displayName?: string | null
  email?: string
  emailVerified?: boolean
  disabled?: boolean
  phoneNumber?: string | null
  photoUrl?: string | null
  customAttributes?: string
}

export async function authUpdateUser(params: FirebaseAuthUpdateUserParams, context: AccountContext) {
  const r = await getHelper(context, params.projectId)
  if ('error' in r) return { success: false, error: r.error }
  try {
    const { uid, projectId: _p, ...updates } = params
    const data = await r.helper.updateUser(uid, updates)
    return { success: true, data }
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Failed' }
  }
}

// ============ Delete User ============

export interface FirebaseAuthDeleteUserParams {
  projectId: string
  uid: string
}

export async function authDeleteUser(params: FirebaseAuthDeleteUserParams, context: AccountContext) {
  const r = await getHelper(context, params.projectId)
  if ('error' in r) return { success: false, error: r.error }
  try {
    await r.helper.deleteUser(params.uid)
    return { success: true }
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Failed' }
  }
}
