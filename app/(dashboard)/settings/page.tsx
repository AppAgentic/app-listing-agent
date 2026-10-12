import { getSession } from '@/lib/auth/session'
import { adminDb } from '@/lib/firebase/admin'
import { SettingsContent } from './settings-content'
import { isInternalIntegrationIdentity } from '@/lib/features/internal-integrations'
import { isSelfHosted } from '@/lib/selfhost/config'
import { SELF_HOSTED_PLAN, SELF_HOSTED_PLAN_LIMITS } from '@/lib/billing/catalog'

async function getUserData(userId: string, organizationId: string | undefined, internalAccess: boolean) {
  const userDoc = await adminDb.collection('users').doc(userId).get()
  const userData = userDoc.data()

  let orgData = null
  if (organizationId) {
    const orgDoc = await adminDb.collection('organizations').doc(organizationId).get()
    orgData = orgDoc.data()
  }

  // Get current month usage
  const currentMonth = new Date().toISOString().slice(0, 7)
  let usage = { translations: 0, screenshots: 0, uploads: 0 }

  if (organizationId) {
    const usageDoc = await adminDb
      .collection('organizations')
      .doc(organizationId)
      .collection('usage')
      .doc(currentMonth)
      .get()
    if (usageDoc.exists) {
      const data = usageDoc.data()!
      usage = {
        translations: data.translationsUsed || 0,
        screenshots: data.screenshotsUsed || 0,
        uploads: data.uploadsUsed || 0
      }
    }
  } else {
    const usageDoc = await adminDb
      .collection('users')
      .doc(userId)
      .collection('usage')
      .doc(currentMonth)
      .get()
    if (usageDoc.exists) {
      const data = usageDoc.data()!
      usage = {
        translations: data.translationsUsed || 0,
        screenshots: data.screenshotsUsed || 0,
        uploads: data.uploadsUsed || 0
      }
    }
  }

  // Check store credentials
  const credentialsRef = organizationId
    ? adminDb.collection('organizations').doc(organizationId).collection('credentials')
    : adminDb.collection('users').doc(userId).collection('credentials')

  const appStoreDoc = await credentialsRef.doc('appstore').get()
  const playStoreDoc = await credentialsRef.doc('playstore').get()

  return {
    apiKey: internalAccess ? (organizationId ? orgData?.apiKey : userData?.apiKey) : undefined,
    // Self-hosted installs have no billing: show the unlimited self-host plan, not the stored record.
    plan: isSelfHosted() ? SELF_HOSTED_PLAN : userData?.plan,
    limits: isSelfHosted() ? SELF_HOSTED_PLAN_LIMITS : userData?.planLimits,
    usage,
    organizationName: orgData?.name,
    appStoreConnected: appStoreDoc.exists,
    playStoreConnected: playStoreDoc.exists,
    email: userData?.email || ''
  }
}

export default async function SettingsPage() {
  const session = await getSession()
  if (!session) return null

  const internalAccess = isInternalIntegrationIdentity({
    userId: session.userId,
    email: session.email,
    orgId: session.organizationId,
  })
  const data = await getUserData(session.userId, session.organizationId, internalAccess)

  return (
    <SettingsContent
      data={data}
      internalAccess={internalAccess}
    />
  )
}
