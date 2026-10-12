import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { getProjectContext } from '@/lib/org/context'
import { getMutableProjectContext } from '@/lib/org/project-authorization'
import { getGleapHelper } from '@/lib/services/gleap'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ ticketId: string }> }
) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { ticketId } = await params
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
    const ticket = await helper.getTicket(ticketId)
    return NextResponse.json({ ticket })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch ticket' },
      { status: 500 }
    )
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ ticketId: string }> }
) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { ticketId } = await params
  const body = await request.json()
  const { projectId, ...updates } = body

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
    const ticket = await helper.updateTicket(ticketId, updates)
    return NextResponse.json({ ticket })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update ticket' },
      { status: 500 }
    )
  }
}
