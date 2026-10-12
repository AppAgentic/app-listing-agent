import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { getProjectContext } from '@/lib/org/context'
import { getMutableProjectContext } from '@/lib/org/project-authorization'
import { getGleapHelper } from '@/lib/services/gleap'
import { adminDb } from '@/lib/firebase/admin'

export async function POST(request: NextRequest) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { projectId } = await request.json()

  if (!projectId) {
    return NextResponse.json({ error: 'projectId is required' }, { status: 400 })
  }

  const projectContext = await getMutableProjectContext(session.userId, projectId)
  if (!projectContext) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  }

  const helper = await getGleapHelper(session.userId, projectId, projectContext.orgId)
  if (!helper) {
    return NextResponse.json({ error: 'Gleap not configured' }, { status: 400 })
  }

  try {
    // Get project metadata
    const basePath = projectContext.type === 'organization' && projectContext.orgId
      ? adminDb.collection('organizations').doc(projectContext.orgId).collection('projects').doc(projectId)
      : adminDb.collection('users').doc(session.userId).collection('projects').doc(projectId)

    const projectDoc = await basePath.get()
    const projectData = projectDoc.data()

    // Get primary locale metadata
    const primaryLocale = projectData?.primaryLocale || 'en-US'
    const metadataDoc = await basePath.collection('metadata').doc(primaryLocale).get()
    const metadata = metadataDoc.exists ? metadataDoc.data() : null

    if (!metadata) {
      return NextResponse.json({ error: 'No metadata found to sync' }, { status: 400 })
    }

    // Build content from metadata
    const parts: string[] = []
    if (metadata.name) parts.push(`App Name: ${metadata.name}`)
    if (metadata.subtitle) parts.push(`Subtitle: ${metadata.subtitle}`)
    if (metadata.description) parts.push(`Description: ${metadata.description}`)
    if (metadata.fullDescription) parts.push(`Full Description: ${metadata.fullDescription}`)
    if (metadata.keywords) parts.push(`Keywords: ${metadata.keywords}`)
    if (metadata.whatsNew) parts.push(`What's New: ${metadata.whatsNew}`)
    if (metadata.promotionalText) parts.push(`Promotional Text: ${metadata.promotionalText}`)

    if (parts.length === 0) {
      return NextResponse.json({ error: 'No metadata content to sync' }, { status: 400 })
    }

    const content = parts.join('\n\n')
    const batchId = `metadata-sync-${projectId}`

    // Delete old batch first, then push new content
    try {
      await helper.deleteAIContentBatch(batchId)
    } catch {
      // Batch may not exist yet, that's fine
    }

    const result = await helper.pushAIContent({
      type: 'text',
      content,
      batchId,
    })

    return NextResponse.json({
      success: true,
      contentId: result.id,
      batchId,
      fieldsSync: parts.length,
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to sync AI content' },
      { status: 500 }
    )
  }
}
