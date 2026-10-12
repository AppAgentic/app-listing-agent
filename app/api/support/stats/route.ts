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
  const chartType = searchParams.get('chartType')

  if (!projectId) {
    return NextResponse.json({ error: 'projectId is required' }, { status: 400 })
  }
  if (!chartType) {
    return NextResponse.json({ error: 'chartType is required' }, { status: 400 })
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
    const stat = await helper.getStatistic(chartType, {
      from: searchParams.get('from') || undefined,
      to: searchParams.get('to') || undefined,
    })
    return NextResponse.json(stat)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch statistics' },
      { status: 500 }
    )
  }
}
