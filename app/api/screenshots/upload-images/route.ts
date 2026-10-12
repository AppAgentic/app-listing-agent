import { NextRequest } from 'next/server'
import { authenticateRequest, errorResponse, unauthorizedResponse } from '@/lib/api/auth'
import { getProjectContext, getAccountContext, AccountContext } from '@/lib/org/context'
import { getMutableProjectContext } from '@/lib/org/project-authorization'
import { getSession } from '@/lib/auth/session'
import { uploadFile } from '@/lib/services/r2'
import { recordCoreAction } from '@/lib/analytics/runtime'

async function getAuthContext(request: NextRequest): Promise<{ context: AccountContext | null; error?: string }> {
  const authHeader = request.headers.get('Authorization')
  if (authHeader) {
    const auth = await authenticateRequest(request)
    if (auth.authenticated && auth.context) {
      return { context: auth.context }
    }
    return { context: null, error: auth.error }
  }

  const session = await getSession()
  if (session) {
    const context = await getAccountContext(session.userId)
    if (context) {
      return { context }
    }
    return { context: null, error: 'User not found' }
  }

  return { context: null, error: 'Authentication required' }
}

export async function POST(request: NextRequest) {
  const { context, error: authError } = await getAuthContext(request)
  if (!context) {
    return unauthorizedResponse(authError)
  }

  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return errorResponse('Invalid form data')
  }

  const projectId = formData.get('projectId') as string
  if (!projectId) {
    return errorResponse('projectId is required')
  }

  const projectContext = await getMutableProjectContext(context.userId, projectId)
  if (!projectContext) {
    return errorResponse('Project not found', 404)
  }

  const files = formData.getAll('files') as File[]
  if (!files || files.length === 0) {
    return errorResponse('No files provided')
  }

  if (files.length > 10) {
    return errorResponse('Maximum 10 files allowed')
  }

  const results: Array<{ url: string; key: string; filename: string }> = []

  for (const file of files) {
    if (!file.type.startsWith('image/')) {
      continue
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    const ext = file.name.split('.').pop()?.toLowerCase() || 'png'
    const filename = `screenshot-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.${ext}`

    const upload = await uploadFile({
      userId: projectContext.type === 'personal' ? context.userId : undefined,
      orgId: projectContext.orgId,
      projectId,
      category: 'generated',
      filename,
      data: buffer,
      contentType: file.type,
    })

    results.push({
      url: upload.url,
      key: upload.key,
      filename: file.name,
    })
  }

  if (results.length > 0) await recordCoreAction(context.userId, 'screenshots_uploaded')

  return Response.json({ success: true, results })
}
