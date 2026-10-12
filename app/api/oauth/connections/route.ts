import { NextResponse } from 'next/server'
import { Timestamp } from 'firebase-admin/firestore'
import { getSession } from '@/lib/auth/session'
import { adminDb } from '@/lib/firebase/admin'
import { invalidateAccountContextCache } from '@/lib/org/context'

export async function DELETE() {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const revokedBefore = Timestamp.now()
  await adminDb.collection('users').doc(session.userId).set({
    oauthRevokedBefore: revokedBefore,
    updatedAt: revokedBefore,
  }, { merge: true })
  invalidateAccountContextCache(session.userId)

  return NextResponse.json({
    success: true,
    message: 'All App Listing Agent OAuth agent access has been revoked.',
  })
}
