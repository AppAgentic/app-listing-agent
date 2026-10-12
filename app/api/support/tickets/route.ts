import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { getProjectContext } from '@/lib/org/context'
import { getGleapHelper } from '@/lib/services/gleap'
import type { GleapTicketType, GleapTicketStatus, GleapTicketPriority } from '@/lib/services/gleap'

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
    const tickets = await helper.getTickets({
      type: searchParams.get('type') as GleapTicketType | undefined,
      status: searchParams.get('status') as GleapTicketStatus | undefined,
      priority: searchParams.get('priority') as GleapTicketPriority | undefined,
      sort: searchParams.get('sort') || undefined,
      limit: searchParams.get('limit') ? Number(searchParams.get('limit')) : undefined,
      skip: searchParams.get('skip') ? Number(searchParams.get('skip')) : undefined,
    })

    return NextResponse.json({ tickets })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch tickets' },
      { status: 500 }
    )
  }
}
