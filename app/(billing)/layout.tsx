import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { safeLocalReturnTo } from '@/lib/billing/intent'
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth/session'
import { DashboardShell } from '@/components/dashboard/dashboard-shell'
import { isInternalIntegrationIdentity } from '@/lib/features/internal-integrations'
import { isSelfHosted } from '@/lib/selfhost/config'

// Signed-in app surfaces are never search landing pages.
export const metadata: Metadata = { robots: { index: false, follow: false } }

export default async function BillingLayout({
  children
}: {
  children: React.ReactNode
}) {
  const session = await getSession()
  const returnTo = safeLocalReturnTo((await headers()).get('x-app-path'))

  if (!session) {
    redirect(`/login?mode=signup&returnTo=${encodeURIComponent(returnTo)}`)
  }

  // Self-hosted installs have no billing: the billing page does not exist there.
  if (isSelfHosted()) {
    redirect('/dashboard')
  }

  // This separate route group permits purchase review before store onboarding.
  // Dashboard routes retain their own unconditional onboarding gate.

  return (
    <div className="min-h-screen bg-black text-white selection:bg-purple-500/30 selection:text-purple-200">
      <DashboardShell
        user={session}
        internalIntegrationsEnabled={isInternalIntegrationIdentity({
          email: session.email,
          userId: session.userId,
          orgId: session.organizationId,
        })}
        selfHosted={isSelfHosted()}
      >
        {children}
      </DashboardShell>
    </div>
  )
}
