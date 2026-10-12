import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { getAccountContext } from '@/lib/org/context'
import { getCurrentUsage } from '@/lib/api/usage'

export async function GET() {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }

  const context = await getAccountContext(session.userId)
  if (!context) {
    return NextResponse.json({ error: 'Account not found' }, { status: 404 })
  }

  return NextResponse.json(await getCurrentUsage(context))
}
