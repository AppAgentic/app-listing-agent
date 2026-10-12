import { NextRequest } from 'next/server'
import { errorResponse, unauthorizedResponse } from '@/lib/api/auth'
import { getProjectContext, hasContextPermission, getAccountContext } from '@/lib/org/context'
import { getSession } from '@/lib/auth/session'
import { uploadFile, type ImageCategory } from '@/lib/services/r2'

export async function POST(request: NextRequest) {
  // Get session
  const session = await getSession()
  if (!session) {
    return unauthorizedResponse('Authentication required')
  }

  const context = await getAccountContext(session.userId)
  if (!context) {
    return unauthorizedResponse('User not found')
  }

  try {
    const formData = await request.formData()
    const file = formData.get('file') as File | null
    const projectId = formData.get('projectId') as string | null
    const category = (formData.get('category') as string || 'raw') as ImageCategory

    if (!file) {
      return errorResponse('No file provided')
    }

    if (!projectId) {
      return errorResponse('Project ID required')
    }

    // Get project context to verify access
    const projectContext = await getProjectContext(context.userId, projectId)
    if (!projectContext) {
      return errorResponse('Project not found', 404)
    }

    // Check permission
    if (!hasContextPermission(projectContext, 'canCreateProjects')) {
      return errorResponse('Permission denied', 403)
    }

    // Read file as buffer
    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    console.log(`[Upload] File: ${file.name}, size: ${file.size}, type: ${file.type}, buffer length: ${buffer.length}`)

    if (buffer.length === 0) {
      console.error(`[Upload] Empty buffer for file: ${file.name}`)
      return errorResponse('File is empty')
    }

    // Generate filename
    const timestamp = Date.now()
    const randomId = Math.random().toString(36).substr(2, 9)
    const extension = file.name.split('.').pop() || 'png'
    const filename = `${category}-${timestamp}-${randomId}.${extension}`

    // Upload to R2
    const uploaded = await uploadFile({
      userId: projectContext.type === 'organization' ? undefined : context.userId,
      orgId: projectContext.orgId || undefined,
      projectId,
      category,
      filename,
      data: buffer,
      contentType: file.type || 'image/png',
    })

    return Response.json({
      success: true,
      url: uploaded.url,
      key: uploaded.key,
    })
  } catch (error) {
    console.error('Upload error:', error)
    return errorResponse(
      error instanceof Error ? error.message : 'Upload failed',
      500
    )
  }
}
