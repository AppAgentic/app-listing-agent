import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { adminDb } from '@/lib/firebase/admin'
import { createAgentPairing, normalizeAgentOnboardingState } from '@/lib/agent-onboarding'

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const userDoc = await adminDb.collection('users').doc(session.userId).get()
  if (!userDoc.exists) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  return NextResponse.json({ onboarding: normalizeAgentOnboardingState(userDoc.data()) })
}

export async function POST() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const pairing = await createAgentPairing(session.userId)
    return NextResponse.json(pairing, { status: 201 })
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Failed to create pairing code',
    }, { status: 400 })
  }
}
