import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { adminDb } from '@/lib/firebase/admin'
import { isInternalIntegrationIdentity } from '@/lib/features/internal-integrations'

export async function GET() {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    if (!isInternalIntegrationIdentity({
      userId: session.userId,
      email: session.email,
      orgId: session.organizationId,
    })) {
      return NextResponse.json({ apiKey: null })
    }

    let apiKey = null

    if (session.organizationId) {
      const orgDoc = await adminDb
        .collection('organizations')
        .doc(session.organizationId)
        .get()
      apiKey = orgDoc.data()?.apiKey
    } else {
      const userDoc = await adminDb
        .collection('users')
        .doc(session.userId)
        .get()
      apiKey = userDoc.data()?.apiKey
    }

    return NextResponse.json({ apiKey })
  } catch (error) {
    console.error('Failed to fetch settings:', error)
    return NextResponse.json(
      { error: 'Failed to fetch settings' },
      { status: 500 }
    )
  }
}
