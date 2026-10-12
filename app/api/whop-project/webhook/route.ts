import { NextRequest, NextResponse } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { Timestamp } from 'firebase-admin/firestore'
import { isInternalIntegrationIdentity } from '@/lib/features/internal-integrations'
import { verifyProjectWebhookSignature } from '@/lib/whop/project-webhook-security'

// Whop webhook events we handle
type WhopWebhookEvent =
  | 'payment.completed'
  | 'membership.went_valid'
  | 'membership.went_invalid'
  | 'membership.cancelled'
  | 'membership.metadata_updated'

interface WhopWebhookPayload {
  action: WhopWebhookEvent
  data: Record<string, unknown>
  company_id?: string
}

// Find project by whopCompanyId to get the webhook secret
async function findProjectByCompanyId(companyId: string): Promise<{
  projectRef: FirebaseFirestore.DocumentReference
  webhookSecret: string | null
  internalOwner: boolean
} | null> {
  const usersSnapshot = await adminDb.collectionGroup('projects')
    .where('whopCompanyId', '==', companyId)
    .limit(1)
    .get()

  if (!usersSnapshot.empty) {
    const doc = usersSnapshot.docs[0]
    const data = doc.data()
    const pathSegments = doc.ref.path.split('/')
    const ownerType = pathSegments[0]
    const ownerId = pathSegments[1]
    return {
      projectRef: doc.ref,
      webhookSecret: data.whopWebhookSecret || null,
      internalOwner: isInternalIntegrationIdentity({
        userId: ownerType === 'users' ? ownerId : null,
        orgId: ownerType === 'organizations' ? ownerId : null,
      }),
    }
  }

  return null
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text()

  let payload: WhopWebhookPayload
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const companyId = payload.company_id || (payload.data?.company_id as string)
  if (!companyId) {
    return NextResponse.json({ error: 'Missing company_id' }, { status: 400 })
  }

  // Find project
  const project = await findProjectByCompanyId(companyId)
  if (!project) {
    return NextResponse.json({ error: 'Unknown company' }, { status: 404 })
  }
  if (!project.internalOwner) {
    return NextResponse.json({ error: 'Unknown company' }, { status: 404 })
  }

  // Fail closed: a project webhook is never allowed to mutate state unsigned.
  const signature = request.headers.get('x-whop-signature') || request.headers.get('whop-signature')
  const verification = verifyProjectWebhookSignature(rawBody, signature, project.webhookSecret)
  if (!verification.ok) {
    return NextResponse.json({ error: verification.error }, { status: verification.status })
  }

  // Store event in Firestore subcollection
  const eventRef = await project.projectRef.collection('whopEvents').add({
    action: payload.action,
    data: payload.data,
    companyId,
    receivedAt: Timestamp.now(),
    processed: true,
  })

  // Handle specific events — update project-level counters/cache if needed
  try {
    switch (payload.action) {
      case 'payment.completed':
        await project.projectRef.update({
          lastWhopPaymentAt: Timestamp.now(),
        })
        break
      case 'membership.went_valid':
      case 'membership.went_invalid':
      case 'membership.cancelled':
        await project.projectRef.update({
          lastWhopMembershipChangeAt: Timestamp.now(),
        })
        break
    }
  } catch (error) {
    // Log but don't fail — the event is already stored
    console.error(`[WhopWebhook] Failed to process ${payload.action}:`, error)
    await eventRef.update({ processed: false, processingError: error instanceof Error ? error.message : 'Unknown error' })
  }

  return NextResponse.json({ received: true })
}
