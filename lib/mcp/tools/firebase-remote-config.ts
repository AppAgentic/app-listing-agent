/**
 * Firebase Remote Config MCP Tools
 */

import { AccountContext, getProjectContext } from '@/lib/org/context'
import { getFirebaseRemoteConfigHelper } from '@/lib/services/firebase-remote-config'
import type { RemoteConfigTemplate } from '@/lib/services/firebase-remote-config'

async function getHelper(context: AccountContext, projectId: string) {
  const projectContext = await getProjectContext(context.userId, projectId)
  if (!projectContext) return { error: 'Project not found' as const }

  const helper = await getFirebaseRemoteConfigHelper(context.userId, projectId, projectContext.orgId)
  if (!helper) {
    return {
      error: 'Remote Config not configured. Add a Firebase Project ID in project settings and ensure a Firebase service account is configured.' as const
    }
  }
  return { helper }
}

// ============ Get Config ============

export interface GetRemoteConfigParams {
  projectId: string
}

export async function getRemoteConfig(params: GetRemoteConfigParams, context: AccountContext) {
  const r = await getHelper(context, params.projectId)
  if ('error' in r) return { success: false, error: r.error }
  try {
    const data = await r.helper.getTemplate()
    return { success: true, data }
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Failed' }
  }
}

// ============ Update Config ============

export interface UpdateRemoteConfigParams {
  projectId: string
  template: RemoteConfigTemplate
  etag: string
}

export async function updateRemoteConfig(params: UpdateRemoteConfigParams, context: AccountContext) {
  const r = await getHelper(context, params.projectId)
  if ('error' in r) return { success: false, error: r.error }
  try {
    const data = await r.helper.updateTemplate(params.template, params.etag)
    return { success: true, data }
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Failed' }
  }
}

// ============ Publish Config ============

export interface PublishRemoteConfigParams {
  projectId: string
  template: RemoteConfigTemplate
  etag: string
}

export async function publishRemoteConfig(params: PublishRemoteConfigParams, context: AccountContext) {
  const r = await getHelper(context, params.projectId)
  if ('error' in r) return { success: false, error: r.error }
  try {
    const data = await r.helper.publishTemplate(params.template, params.etag)
    return { success: true, data }
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Failed' }
  }
}

// ============ List Versions ============

export interface ListRemoteConfigVersionsParams {
  projectId: string
  pageSize?: number
}

export async function listRemoteConfigVersions(params: ListRemoteConfigVersionsParams, context: AccountContext) {
  const r = await getHelper(context, params.projectId)
  if ('error' in r) return { success: false, error: r.error }
  try {
    const data = await r.helper.listVersions({ pageSize: params.pageSize })
    return { success: true, data }
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Failed' }
  }
}
