/**
 * Firebase Cloud Functions MCP Tools
 */

import { AccountContext, getProjectContext } from '@/lib/org/context'
import { getFirebaseFunctionsHelper } from '@/lib/services/firebase-functions'

async function getHelper(context: AccountContext, projectId: string) {
  const projectContext = await getProjectContext(context.userId, projectId)
  if (!projectContext) return { error: 'Project not found' as const }

  const helper = await getFirebaseFunctionsHelper(context.userId, projectId, projectContext.orgId)
  if (!helper) {
    return {
      error: 'Cloud Functions not configured. Add a Firebase Project ID in project settings and ensure a Firebase service account is configured.' as const
    }
  }
  return { helper }
}

// ============ List Functions ============

export interface FirebaseListFunctionsParams {
  projectId: string
  pageSize?: number
}

export async function firebaseListFunctions(params: FirebaseListFunctionsParams, context: AccountContext) {
  const r = await getHelper(context, params.projectId)
  if ('error' in r) return { success: false, error: r.error }
  try {
    const data = await r.helper.listFunctions({ pageSize: params.pageSize })
    return { success: true, data }
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Failed' }
  }
}

// ============ Get Function ============

export interface FirebaseGetFunctionParams {
  projectId: string
  functionName: string
  region?: string
}

export async function firebaseGetFunction(params: FirebaseGetFunctionParams, context: AccountContext) {
  const r = await getHelper(context, params.projectId)
  if ('error' in r) return { success: false, error: r.error }
  try {
    const data = await r.helper.getFunction(params.functionName, params.region)
    return { success: true, data }
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Failed' }
  }
}

// ============ Get Function Logs ============

export interface FirebaseGetFunctionLogsParams {
  projectId: string
  functionName?: string
  pageSize?: number
  severity?: 'DEFAULT' | 'DEBUG' | 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL'
  startTime?: string
  endTime?: string
}

export async function firebaseGetFunctionLogs(params: FirebaseGetFunctionLogsParams, context: AccountContext) {
  const r = await getHelper(context, params.projectId)
  if ('error' in r) return { success: false, error: r.error }
  try {
    const data = await r.helper.getFunctionLogs({
      functionName: params.functionName,
      pageSize: params.pageSize,
      severity: params.severity,
      startTime: params.startTime,
      endTime: params.endTime,
    })
    return { success: true, data }
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Failed' }
  }
}
