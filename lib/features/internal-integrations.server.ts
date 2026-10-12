import 'server-only'

import { adminDb } from '@/lib/firebase/admin'
import { isInternalIntegrationIdentity } from './internal-integrations'

export async function isInternalIntegrationUser(userId: string, orgId?: string): Promise<boolean> {
  if (!userId) return false

  const userDoc = await adminDb.collection('users').doc(userId).get()
  if (!userDoc.exists) return false

  return isInternalIntegrationIdentity({
    email: userDoc.data()?.email,
    userId,
    orgId,
  })
}
