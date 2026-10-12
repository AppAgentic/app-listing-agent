import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { WhopProjectHelper } from '@/lib/services/whop-project'

export async function POST(request: NextRequest) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { apiKey, companyId } = await request.json()

  if (!apiKey || !companyId) {
    return NextResponse.json({ error: 'API key and company ID are required' }, { status: 400 })
  }

  try {
    const helper = new WhopProjectHelper(apiKey, companyId)
    const result = await helper.testConnection()

    return NextResponse.json({
      success: true,
      message: 'Connected to Whop successfully',
      companyName: result.company.title,
      memberCount: result.company.member_count,
    })
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to connect to Whop',
    }, { status: 400 })
  }
}
