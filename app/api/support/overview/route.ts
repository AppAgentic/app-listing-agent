import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { getProjectContext } from '@/lib/org/context'
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
    // Fetch overview stats — individual failures shouldn't break the whole response
    const [openTickets, firstResponse, closeTime, ratings, newTickets, closedTickets] = await Promise.allSettled([
      helper.getTicketCount({ status: 'OPEN' }),
      helper.getStatistic('MEDIAN_FIRST_RESPONSE_TIME'),
      helper.getStatistic('MEDIAN_CLOSE_TIME'),
      helper.getStatistic('CONVERSATION_RATINGS'),
      helper.getStatistic('NEW_TICKETS_COUNT'),
      helper.getStatistic('TICKET_CLOSE_COUNT'),
    ])

    return NextResponse.json({
      openTickets: openTickets.status === 'fulfilled' ? openTickets.value : 0,
      medianFirstResponseTime: firstResponse.status === 'fulfilled' ? firstResponse.value.data : null,
      medianCloseTime: closeTime.status === 'fulfilled' ? closeTime.value.data : null,
      conversationRatings: ratings.status === 'fulfilled' ? ratings.value.data : null,
      newTicketsCount: newTickets.status === 'fulfilled' ? newTickets.value.data : null,
      ticketCloseCount: closedTickets.status === 'fulfilled' ? closedTickets.value.data : null,
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch support overview' },
      { status: 500 }
    )
  }
}
