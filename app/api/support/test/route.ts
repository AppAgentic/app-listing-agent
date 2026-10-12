import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { GleapHelper } from '@/lib/services/gleap'
import { isInternalIntegrationIdentity } from '@/lib/features/internal-integrations'

export async function POST(request: NextRequest) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!isInternalIntegrationIdentity({
    email: session.email,
    userId: session.userId,
    orgId: session.organizationId,
  })) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const { apiToken, gleapProjectId } = await request.json()

  if (!apiToken || !gleapProjectId) {
    return NextResponse.json({ error: 'API token and project ID are required' }, { status: 400 })
  }

  try {
    const helper = new GleapHelper(apiToken, gleapProjectId)
    // Use a lightweight call to validate credentials instead of getSupportOverview (6 parallel calls)
    const tickets = await helper.getTickets({ limit: 1 })

    return NextResponse.json({
      success: true,
      message: 'Connected to Gleap successfully',
      ticketCount: tickets.length,
    })
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to connect to Gleap',
    }, { status: 400 })
  }
}
