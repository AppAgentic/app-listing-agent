import { redirect } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, LockKeyhole, Store } from 'lucide-react'
import { getSession } from '@/lib/auth/session'
import { adminDb } from '@/lib/firebase/admin'
import { getAccountContext } from '@/lib/org/context'
import { StoreCredentials } from '@/components/dashboard/store-credentials'

export default async function OnboardingStoresPage() {
  const session = await getSession()
  if (!session) redirect('/login?returnTo=/onboarding/stores')

  const context = await getAccountContext(session.userId)
  if (!context) redirect('/login')
  const credentialsRef = context.type === 'organization' && context.orgId
    ? adminDb.collection('organizations').doc(context.orgId).collection('credentials')
    : adminDb.collection('users').doc(context.userId).collection('credentials')
  const [appStoreDoc, playStoreDoc] = await Promise.all([
    credentialsRef.doc('appstore').get(),
    credentialsRef.doc('playstore').get(),
  ])

  return (
    <main className="min-h-screen bg-black text-white px-4 py-10">
      <div className="max-w-3xl mx-auto">
        <Link href="/onboarding" className="inline-flex items-center gap-2 text-sm text-neutral-400 hover:text-white mb-7">
          <ArrowLeft className="w-4 h-4" /> Back to agent onboarding
        </Link>
        <div className="rounded-2xl bg-white/[0.02] border border-white/[0.08] p-6 sm:p-8">
          <div className="flex items-start gap-4 mb-7">
            <div className="w-11 h-11 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center shrink-0"><Store className="w-5 h-5 text-purple-400" /></div>
            <div>
              <h1 className="text-2xl font-bold">Connect your app stores</h1>
              <p className="text-neutral-400 mt-1">This is the secure human handoff. Your private store credentials are encrypted here and are never returned to your agent.</p>
            </div>
          </div>
          <div className="mb-6 p-4 rounded-xl bg-emerald-500/5 border border-emerald-500/15 flex gap-3">
            <LockKeyhole className="w-5 h-5 text-emerald-400 shrink-0" />
            <p className="text-sm text-neutral-300">After connecting a store, return to your agent. It can see only connection status and imported app information—not the credential values.</p>
          </div>
          <StoreCredentials appStoreConnected={appStoreDoc.exists} playStoreConnected={playStoreDoc.exists} />
        </div>
      </div>
    </main>
  )
}
