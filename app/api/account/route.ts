import { readBoundedJson } from '@/lib/api/bounded-body'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { Timestamp, type DocumentData, type DocumentReference } from 'firebase-admin/firestore'
import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { clearSession, getSession } from '@/lib/auth/session'
import { assessAccountDeletion } from '@/lib/auth/account-deletion'
import { emailHash } from '@/lib/auth/signup-policy'
import { RATE_LIMIT_CONFIGS, withRateLimit } from '@/lib/api/rate-limit'
import { deleteAccountFiles } from '@/lib/services/r2'
import { enqueueAnalyticsDeletion } from '@/lib/analytics/runtime'

const deletionSchema = z.object({
  confirmation: z.string().min(3).max(320),
})

export async function DELETE(request: NextRequest) {
  const rateLimit = await withRateLimit(request, RATE_LIMIT_CONFIGS.auth)
  if (rateLimit.response) return rateLimit.response

  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }

  let body: z.infer<typeof deletionSchema>
  try {
    body = deletionSchema.parse(await readBoundedJson(request))
  } catch {
    return NextResponse.json({ error: 'Type your account email to confirm deletion.' }, { status: 400 })
  }

  const userRef = adminDb.collection('users').doc(session.userId)
  const userSnapshot = await userRef.get()
  if (!userSnapshot.exists) {
    await clearSession()
    return NextResponse.json({ success: true })
  }

  const userData = userSnapshot.data()!
  let organizationRef: DocumentReference | null = null
  let memberRef: DocumentReference | null = null
  let organizationData: DocumentData | undefined
  let organizationRole: string | undefined | null
  let organizationMemberCount: number | undefined

  if (session.organizationId) {
    organizationRef = adminDb.collection('organizations').doc(session.organizationId)
    memberRef = organizationRef.collection('members').doc(session.userId)
    const [organizationSnapshot, membershipSnapshot, membersSnapshot] = await Promise.all([
      organizationRef.get(),
      memberRef.get(),
      organizationRef.collection('members').get(),
    ])
    organizationData = organizationSnapshot.data()
    organizationRole = membershipSnapshot.exists ? membershipSnapshot.data()!.role : null
    organizationMemberCount = membersSnapshot.size
  }

  const assessment = assessAccountDeletion({
    email: session.email,
    confirmation: body.confirmation,
    userBilling: userData.billing,
    organizationBilling: organizationData?.billing,
    organizationRole,
    organizationMemberCount,
  })

  if (!assessment.allowed) {
    return NextResponse.json({ error: assessment.code, message: assessment.message }, { status: 409 })
  }

  const deletionMarker = adminDb.collection('deletedAccounts').doc(emailHash(session.email))

  try {
    // The non-reversible marker prevents an account from being silently
    // recreated with an old invite if cleanup is interrupted midway.
    await deletionMarker.set({
      userId: session.userId,
      deletedAt: Timestamp.now(),
    })
    await adminAuth.revokeRefreshTokens(session.userId)
    // Durable, retrying removal of this account's product analytics rows (and its linked browser ids).
    await enqueueAnalyticsDeletion(session.userId)

    // User-scoped assets can exist even after joining an organization, so
    // always remove them. A sole owner additionally removes organization data.
    await deleteAccountFiles({ userId: session.userId })
    if (organizationRef && assessment.deleteOrganization) {
      await deleteAccountFiles({ orgId: session.organizationId })
    }

    if (organizationRef && assessment.deleteOrganization) {
      await adminDb.recursiveDelete(organizationRef)
    } else if (memberRef) {
      await memberRef.delete()
    }

    const waitlistRecords = await adminDb
      .collection('waitlist')
      .where('email', '==', session.email.trim().toLowerCase())
      .get()
    await Promise.all(waitlistRecords.docs.map(record => record.ref.delete()))

    // Removes projects, credentials, usage, generated metadata records, and
    // scoped API keys beneath the user document before deleting Firebase Auth.
    await adminDb.recursiveDelete(userRef)
    await adminAuth.deleteUser(session.userId)
    await clearSession()

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Account deletion failed after deletion marker was created:', error)
    await clearSession()
    return NextResponse.json(
      { error: 'deletion_incomplete', message: 'Deletion started but could not finish. Contact support so we can complete the cleanup.' },
      { status: 500 }
    )
  }
}
