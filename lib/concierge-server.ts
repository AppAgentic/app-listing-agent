import { createHash, randomBytes } from 'crypto'
import { Timestamp } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { getAccountContext } from '@/lib/org/context'
import { getSession } from '@/lib/auth/session'
import { hasInternalIntegrationAccess } from '@/lib/features/internal-integrations'

export function normalizeLeadEmail(email: string): string {
  return email.trim().toLowerCase()
}

export function conciergeLeadId(email: string): string {
  return createHash('sha256').update(normalizeLeadEmail(email)).digest('hex')
}

export function createLeadTrackingToken(): { token: string; hash: string } {
  const token = randomBytes(24).toString('base64url')
  return { token, hash: hashLeadTrackingToken(token) }
}

export function hashLeadTrackingToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export async function requireInternalOperator() {
  const session = await getSession()
  if (!session) return null
  const context = await getAccountContext(session.userId)
  if (!context || !hasInternalIntegrationAccess(context)) return null
  return { session, context }
}

export async function recordConciergeEvent(input: {
  name: string
  leadId?: string | null
  sessionId?: string | null
  source?: string | null
  metadata?: Record<string, string | number | boolean | null>
}) {
  await adminDb.collection('conciergeEvents').add({
    ...input,
    createdAt: new Date(),
  })
}

export async function recordConciergeEventForUser(
  userId: string,
  name: string,
  metadata?: Record<string, string | number | boolean | null>,
) {
  try {
    const user = await adminDb.collection('users').doc(userId).get()
    const email = user.data()?.email
    if (typeof email !== 'string' || !email.trim()) return
    const leadId = conciergeLeadId(email)
    const leadRef = adminDb.collection('conciergeLeads').doc(leadId)
    if (!(await leadRef.get()).exists) return
    await recordConciergeEvent({ name, leadId, source: 'product', metadata })
    if (name === 'first_audit_completed' || name === 'paid') {
      const status = name === 'paid' ? 'paid' : 'activated'
      await leadRef.update({ status, [`${status}At`]: Timestamp.now(), updatedAt: Timestamp.now() })
      await adminDb.collection('waitlist').doc(leadId).set({
        status: name === 'paid' ? 'converted' : 'approved',
        ...(name === 'paid' ? { convertedAt: Timestamp.now() } : {}),
        updatedAt: Timestamp.now(),
      }, { merge: true })
    }
  } catch (error) {
    // Funnel analytics must never block onboarding, publishing, or billing.
    console.error('Concierge lifecycle event was not recorded:', error)
  }
}
