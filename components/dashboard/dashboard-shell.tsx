'use client'

import { ProjectProvider } from './project-context'
import { MobileMenuProvider } from './mobile-menu-context'
import { DashboardSidebar } from './sidebar'
import { SessionUser } from '@/lib/auth/session'
import { InternalIntegrationsProvider } from './internal-integrations-context'
import { TrialBanner } from '@/components/billing/trial-banner'
import { SelfHostedProvider } from '@/components/selfhost/self-hosted-context'

interface DashboardShellProps {
  user: SessionUser
  internalIntegrationsEnabled: boolean
  /** Self-hosted install (server-computed): no billing link, no trial/payment banner. */
  selfHosted?: boolean
  children: React.ReactNode
}

export function DashboardShell({ user, internalIntegrationsEnabled, selfHosted = false, children }: DashboardShellProps) {
  return (
    <SelfHostedProvider value={selfHosted}>
      <ProjectProvider>
        <InternalIntegrationsProvider enabled={internalIntegrationsEnabled}>
          <MobileMenuProvider>
            {/* Sidebar - Fixed on desktop */}
            <DashboardSidebar user={user} internalIntegrationsEnabled={internalIntegrationsEnabled} selfHosted={selfHosted} />

            {/* Main Content Area - Offset for sidebar on desktop */}
            <div className="lg:ml-64 min-h-screen flex flex-col">
              {/* Page Content */}
              <main className="flex-1 p-4 sm:p-6 lg:p-8">
                <div className="max-w-6xl mx-auto">
                  {!selfHosted && <TrialBanner />}
                  {children}
                </div>
              </main>
            </div>
          </MobileMenuProvider>
        </InternalIntegrationsProvider>
      </ProjectProvider>
    </SelfHostedProvider>
  )
}
