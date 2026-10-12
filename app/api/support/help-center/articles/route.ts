import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { getProjectContext } from '@/lib/org/context'
import { getMutableProjectContext } from '@/lib/org/project-authorization'
import { getGleapHelper } from '@/lib/services/gleap'

export async function GET(request: NextRequest) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const projectId = searchParams.get('projectId')
  if (!projectId) {
    return NextResponse.json({ error: 'projectId is required' }, { status: 400 })
  }

  const projectContext = await getProjectContext(session.userId, projectId)
  if (!projectContext) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  }

  const helper = await getGleapHelper(session.userId, projectId, projectContext.orgId)
  if (!helper) {
    return NextResponse.json({ error: 'Gleap not configured' }, { status: 400 })
  }

  try {
    const collectionId = searchParams.get('collectionId') || undefined
    const articles = await helper.getArticles(collectionId)
    return NextResponse.json({ articles })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch articles' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { projectId, title, content, collectionId, status } = await request.json()

  if (!projectId) {
    return NextResponse.json({ error: 'projectId is required' }, { status: 400 })
  }
  if (!title || !content) {
    return NextResponse.json({ error: 'title and content are required' }, { status: 400 })
  }
  if (!collectionId) {
    return NextResponse.json({ error: 'collectionId is required' }, { status: 400 })
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
    const article = await helper.createArticle(collectionId, {
      title,
      content,
      status: status || 'published',
    })
    return NextResponse.json({ article })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create article' },
      { status: 500 }
    )
  }
}
