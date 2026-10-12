import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { getSession } from '@/lib/auth/session'
import { safeLocalReturnTo } from '@/lib/billing/intent'
import { requireProductAccessForPage } from '@/lib/billing/page-gate'
import { ProjectProvider } from '@/components/dashboard/project-context'
import { SelfHostedProvider } from '@/components/selfhost/self-hosted-context'
import { isSelfHosted } from '@/lib/selfhost/config'

// Signed-in app surfaces are never search landing pages.
export const metadata: Metadata = { robots: { index: false, follow: false } }

export default async function AppsLayout({
  children
}: {
  children: React.ReactNode
}) {
  const session = await getSession()

  if (!session) {
    redirect('/login')
  }

  // Redirect to onboarding if not completed
  if (!session.onboardingCompleted) {
    redirect('/onboarding')
  }

  // Hard paywall: the workspace needs a trial/subscription or a comp entitlement.
  await requireProductAccessForPage(session.userId, safeLocalReturnTo((await headers()).get('x-app-path')))

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white" data-clarity-mask="true">
      <SelfHostedProvider value={isSelfHosted()}>
        <ProjectProvider>
          {children}
        </ProjectProvider>
      </SelfHostedProvider>
    </div>
  )
}
