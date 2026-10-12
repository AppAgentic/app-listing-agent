import { timingSafeEqual } from 'crypto'
import { NextResponse } from 'next/server'
import { runAnalyticsMaintenance } from '@/lib/analytics/runtime'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET
  const header = request.headers.get('authorization') ?? ''
  if (!secret || secret.length < 16 || !header.startsWith('Bearer ')) return false
  const expected = Buffer.from(secret)
  const provided = Buffer.from(header.slice('Bearer '.length))
  return provided.length === expected.length && timingSafeEqual(provided, expected)
}

/** Cloud Scheduler hook: retries account-deletion cleanup of analytics rows. */
export async function POST(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(await runAnalyticsMaintenance(), { headers: { 'Cache-Control': 'no-store' } })
}
