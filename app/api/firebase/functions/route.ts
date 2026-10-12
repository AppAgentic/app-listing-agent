import { NextRequest } from 'next/server'
import { getAuthContext, errorResponse } from '../../playstore-iap/_helpers'
import { getFirebaseFunctionsHelper } from '@/lib/services/firebase-functions'
import { getProjectContext } from '@/lib/org/context'

async function getHelper(request: NextRequest, projectId: string) {
  const { context, error } = await getAuthContext(request)
  if (!context) return { error: error || 'Auth required' }

  const projectContext = await getProjectContext(context.userId, projectId)
  if (!projectContext) return { error: 'Project not found' }

  const helper = await getFirebaseFunctionsHelper(context.userId, projectId, projectContext.orgId)
  if (!helper) return { error: 'Cloud Functions not configured. Add a Firebase Project ID in project settings and ensure a Firebase service account is configured.' }

  return { helper }
}

/**
 * GET /api/firebase/functions?projectId=...&action=...
 * Actions: list, get, logs, test
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const projectId = searchParams.get('projectId')
  const action = searchParams.get('action') || 'list'

  if (!projectId) return errorResponse('projectId required')

  const ctx = await getHelper(request, projectId)
  if ('error' in ctx) return errorResponse(ctx.error as string)
  const { helper } = ctx

  try {
    switch (action) {
      case 'list': {
        const pageSize = searchParams.get('pageSize') ? Number(searchParams.get('pageSize')) : undefined
        const data = await helper.listFunctions({ pageSize })
        return Response.json({ success: true, data })
      }
      case 'get': {
        const functionName = searchParams.get('functionName')
        if (!functionName) return errorResponse('functionName required')
        const region = searchParams.get('region') || undefined
        const data = await helper.getFunction(functionName, region)
        return Response.json({ success: true, data })
      }
      case 'logs': {
        const functionName = searchParams.get('functionName') || undefined
        const pageSize = searchParams.get('pageSize') ? Number(searchParams.get('pageSize')) : undefined
        const severity = searchParams.get('severity') as any || undefined
        const startTime = searchParams.get('startTime') || undefined
        const endTime = searchParams.get('endTime') || undefined
        const data = await helper.getFunctionLogs({ functionName, pageSize, severity, startTime, endTime })
        return Response.json({ success: true, data })
      }
      case 'test': {
        const connected = await helper.testConnection()
        return Response.json({ success: true, connected })
      }
      default:
        return errorResponse(`Unknown action: ${action}. Valid: list, get, logs, test`)
    }
  } catch (err: any) {
    return errorResponse(err.message || 'Cloud Functions API error')
  }
}
