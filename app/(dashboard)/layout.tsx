import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { safeLocalReturnTo } from '@/lib/billing/intent'
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth/session'
import { requireProductAccessForPage } from '@/lib/billing/page-gate'
import { DashboardShell } from '@/components/dashboard/dashboard-shell'
import { isInternalIntegrationIdentity } from '@/lib/features/internal-integrations'
import { isSelfHosted } from '@/lib/selfhost/config'

// Signed-in app surfaces are never search landing pages.
export const metadata: Metadata = { robots: { index: false, follow: false } }

export default async function DashboardLayout({
  children
}: {
  children: React.ReactNode
}) {
  const session = await getSession()
  const returnTo = safeLocalReturnTo((await headers()).get('x-app-path'))

  if (!session) {
    redirect(`/login?returnTo=${encodeURIComponent(returnTo)}`)
  }

  // Redirect to onboarding if not completed
  if (!session.onboardingCompleted) {
    redirect(`/onboarding?returnTo=${encodeURIComponent(returnTo)}`)
  }

  // Hard paywall: product pages need a trial/subscription or a comp entitlement (settings stays open).
  await requireProductAccessForPage(session.userId, returnTo)

  return (
    <div className="min-h-screen bg-black text-white selection:bg-purple-500/30 selection:text-purple-200" data-clarity-mask="true">
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
