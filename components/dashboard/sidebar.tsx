'use client'

import Link from 'next/link'
import { SupportButton } from '@/components/support/gleap-support'
import { supportClient } from '@/lib/support/gleap-client'
import Image from 'next/image'
import { usePathname, useRouter } from 'next/navigation'
import { SessionUser } from '@/lib/auth/session'
import { useMobileMenu } from './mobile-menu-context'
import { useUsage } from '@/hooks/useUsage'
import { useSelectedProject } from '@/hooks/useSelectedProject'
import { ProjectSelector } from './project-selector'
import {
  Image as ImageIcon,
  Sparkles,
  LayoutDashboard,
  X,
  AlertTriangle,
  Palette,
  ArrowLeft,
  Settings,
  CreditCard,
  Users,
  LogOut,
  FileText,
  ScrollText,
  Package,
  Headset,
  ShoppingBag,
  LayoutTemplate,
  CalendarCheck2,
} from 'lucide-react'

interface SidebarProps {
  user: SessionUser
  internalIntegrationsEnabled: boolean
  /** Self-hosted installs have no billing, so the Billing link is hidden. */
  selfHosted?: boolean
}

// Project-scoped navigation (ordered by typical user workflow)
// storeTypes: if set, only show for those store types. If omitted, show for all.
const mainNavigation = [
  { name: 'Overview', href: '/overview', icon: LayoutDashboard, requiresProject: true },
  { name: 'Icons', href: '/icons', icon: Palette, requiresProject: true, storeTypes: ['ios', 'android'] as string[] },
  { name: 'Metadata', href: '/metadata', icon: FileText, requiresProject: true, storeTypes: ['ios', 'android'] as string[] },
  { name: 'Screenshots', href: '/screenshots', icon: ImageIcon, requiresProject: true, storeTypes: ['ios', 'android'] as string[] },
  { name: 'In-App Purchases', href: '/iap', icon: Package, requiresProject: true, storeTypes: ['ios', 'android'] as string[] },
  { name: 'Custom Pages', href: '/custom-pages', icon: LayoutTemplate, requiresProject: true, storeTypes: ['ios', 'android'] as string[] },
  { name: 'Purchases', href: '/purchases', icon: ShoppingBag, requiresProject: true, storeTypes: ['web'] as string[] },
  { name: 'Legal', href: '/legal', icon: ScrollText, requiresProject: true },
  { name: 'Support', href: '/support', icon: Headset, requiresProject: true },
  { name: 'Project Settings', href: '/settings', icon: Settings, requiresProject: true },
]

// Account navigation
const accountNavigation = [
  { name: 'Settings', href: '/settings', icon: Settings },
  { name: 'Billing', href: '/billing', icon: CreditCard },
  { name: 'Team', href: '/team', icon: Users },
]

export function DashboardSidebar({ user, internalIntegrationsEnabled, selfHosted = false }: SidebarProps) {
  const pathname = usePathname()
  const router = useRouter()
  const { isOpen, close } = useMobileMenu()
  const { usage, loading, overallPercentage, isNearingLimit, isAtLimit, isUnlimited } = useUsage()
  const { selectedProject, hasProject } = useSelectedProject()

  const SidebarContent = () => (
    <>
      {/* Logo */}
      <div className="flex items-center justify-between h-16 px-6 border-b border-white/[0.08]">
        <Link href="/dashboard" className="flex items-center gap-3" onClick={close}>
          <Image
            src="/copilot-icon.png"
            alt="App Listing Agent"
            width={28}
            height={28}
            className="w-7 h-7"
            unoptimized
          />
          <span className="font-bold text-white font-brand tracking-tight">App Listing Agent</span>
        </Link>
        {/* Close button - only visible on mobile */}
        <button
          onClick={close}
          className="lg:hidden p-2 rounded-lg hover:bg-white/[0.05] transition-colors"
        >
          <X className="w-5 h-5 text-neutral-400" />
        </button>
      </div>

      {/* Project Selector */}
      <ProjectSelector />

      {/* Navigation */}
      <nav className="flex-1 flex flex-col px-3 py-4">
        {/* Main Nav */}
        <div className="space-y-1">
          {mainNavigation.filter((item) => {
            if (
              !internalIntegrationsEnabled &&
              ['In-App Purchases', 'Purchases', 'Support'].includes(item.name)
            ) {
              return false
            }
            // Filter by storeType if specified
            if (item.storeTypes && selectedProject) {
              return item.storeTypes.includes(selectedProject.storeType)
            }
            return true
          }).map((item) => {
            // For project-scoped items, build proper href
            let href = item.href
            if (selectedProject) {
              if (item.name === 'Overview') {
                href = `/projects/${selectedProject.id}`
              } else if (item.name === 'Icons') {
                href = `/projects/${selectedProject.id}/icons`
              } else if (item.name === 'Metadata') {
                href = `/projects/${selectedProject.id}/metadata`
              } else if (item.name === 'Screenshots') {
                href = `/projects/${selectedProject.id}/screenshots`
              } else if (item.name === 'In-App Purchases') {
                href = `/projects/${selectedProject.id}/iap`
              } else if (item.name === 'Purchases') {
                href = `/projects/${selectedProject.id}/purchases`
              } else if (item.name === 'Legal') {
                href = `/projects/${selectedProject.id}/legal`
              } else if (item.name === 'Support') {
                href = `/projects/${selectedProject.id}/support`
              } else if (item.name === 'Custom Pages') {
                href = `/projects/${selectedProject.id}/custom-pages`
              } else if (item.name === 'Project Settings') {
                href = `/projects/${selectedProject.id}/settings`
              }
            }
            const isActive = item.name === 'Overview'
              ? pathname.startsWith('/projects/') && !pathname.includes('/settings') && !pathname.includes('/metadata') && !pathname.includes('/screenshots') && !pathname.includes('/legal') && !pathname.includes('/icons') && !pathname.includes('/iap') && !pathname.includes('/purchases') && !pathname.includes('/support') && !pathname.includes('/custom-pages') && pathname !== '/projects'
              : item.name === 'Project Settings'
                ? pathname.includes('/projects/') && pathname.includes('/settings')
                : item.name === 'Icons'
                  ? pathname.includes('/icons')
                  : item.name === 'Metadata'
                    ? pathname.includes('/metadata')
                    : item.name === 'Screenshots'
                      ? pathname.includes('/screenshots')
                      : item.name === 'In-App Purchases'
                        ? pathname.includes('/iap')
                        : item.name === 'Purchases'
                          ? pathname.includes('/purchases')
                          : item.name === 'Legal'
                            ? pathname.includes('/legal')
                            : item.name === 'Support'
                              ? pathname.includes('/support')
                              : item.name === 'Custom Pages'
                                ? pathname.includes('/custom-pages')
                                : pathname.startsWith(item.href)
            const Icon = item.icon
            const isDisabled = item.requiresProject && !hasProject

            if (isDisabled) {
              return (
                <div
                  key={item.name}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-[14px] font-medium text-neutral-600 cursor-not-allowed"
                  title="Select a project first"
                >
                  <Icon className="w-5 h-5" />
                  {item.name}
                </div>
              )
            }

            return (
              <Link
                key={item.name}
                href={href}
                onClick={close}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-[14px] font-medium transition-all ${
                  isActive
                    ? 'bg-white/[0.1] text-white border border-white/[0.15]'
                    : 'text-neutral-400 hover:text-white hover:bg-white/[0.05]'
                }`}
              >
                <Icon className={`w-5 h-5 ${isActive ? 'text-white' : ''}`} />
                {item.name}
              </Link>
            )
          })}

        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* AI Credits Card */}
        <div className={`mb-4 p-4 rounded-2xl border ${
          isAtLimit
            ? 'bg-gradient-to-br from-red-500/10 to-orange-500/10 border-red-500/30'
            : isNearingLimit
              ? 'bg-gradient-to-br from-amber-500/10 to-orange-500/10 border-amber-500/30'
              : 'bg-white/[0.03] border-white/[0.08]'
        }`}>
          <div className="flex items-center gap-2 mb-3">
            {isAtLimit || isNearingLimit ? (
              <AlertTriangle className={`w-4 h-4 ${isAtLimit ? 'text-red-400' : 'text-amber-400'}`} />
            ) : (
              <Sparkles className="w-4 h-4 text-neutral-400" />
            )}
            <span className="text-[13px] font-medium text-white">AI Credits</span>
          </div>
          <div className="text-[11px] text-neutral-400 mb-2">
            {isUnlimited ? (
              'Unlimited'
            ) : loading ? (
              'Loading...'
            ) : isAtLimit ? (
              <span className="text-red-400">Limit reached</span>
            ) : isNearingLimit ? (
              <span className="text-amber-400">{Math.round(overallPercentage)}% used</span>
            ) : (
              `${Math.round(overallPercentage)}% used`
            )}
          </div>
          <div className="h-1.5 bg-white/[0.1] rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                isAtLimit
                  ? 'bg-gradient-to-r from-red-500 to-orange-500'
                  : isNearingLimit
                    ? 'bg-gradient-to-r from-amber-500 to-orange-500'
                    : 'bg-white'
              }`}
              style={{ width: isUnlimited ? '100%' : `${Math.min(100, overallPercentage)}%` }}
            />
          </div>
          {isNearingLimit && !isAtLimit && (
            <Link
              href="/billing?reason=usage"
              onClick={close}
              className="block mt-2 py-2 text-xs text-amber-400 hover:text-amber-300 transition-colors"
            >
              Upgrade for more credits →
            </Link>
          )}
          {isAtLimit && (
            <Link
              href="/billing?reason=usage"
              onClick={close}
              className="block mt-2 py-2 text-xs text-red-400 hover:text-red-300 transition-colors"
            >
              Upgrade now to continue →
            </Link>
          )}
        </div>

        <SupportButton onOpen={close} className="flex items-center gap-3 px-3 py-3 mb-3 rounded-xl text-sm text-neutral-300 hover:text-white hover:bg-white/[0.05] focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-400"><Headset className="h-5 w-5" />Get App Listing Agent help</SupportButton>

        {/* Account Navigation */}
        <div className="pt-4 border-t border-white/[0.08] space-y-1">
          {internalIntegrationsEnabled && (
            <Link
              href="/setup-calls"
              onClick={close}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-[14px] font-medium transition-all ${pathname.startsWith('/setup-calls') ? 'bg-white/[0.1] text-white border border-white/[0.15]' : 'text-neutral-400 hover:text-white hover:bg-white/[0.05]'}`}
            >
              <CalendarCheck2 className="w-5 h-5" />
              Setup calls
            </Link>
          )}
          {accountNavigation.filter(item => !(selfHosted && item.href === '/billing')).map((item) => {
            const isActive = pathname.startsWith(item.href)
            const Icon = item.icon
            return (
              <Link
                key={item.name}
                href={item.href}
                onClick={close}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-[14px] font-medium transition-all ${
                  isActive
                    ? 'bg-white/[0.1] text-white border border-white/[0.15]'
                    : 'text-neutral-400 hover:text-white hover:bg-white/[0.05]'
                }`}
              >
                <Icon className={`w-5 h-5 ${isActive ? 'text-white' : ''}`} />
                {item.name}
              </Link>
            )
          })}
          <Link
            href="/dashboard"
            onClick={close}
            className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-[14px] font-medium text-neutral-400 hover:text-white hover:bg-white/[0.05] transition-all"
          >
            <ArrowLeft className="w-5 h-5" />
            All Apps
          </Link>
          <button
            onClick={async () => {
              await fetch('/api/auth/logout', { method: 'POST' })
              supportClient.identify(null)
              router.push('/login')
            }}
            className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-[14px] font-medium text-red-400 hover:text-red-300 hover:bg-red-500/10 transition-all w-full"
          >
            <LogOut className="w-5 h-5" />
            Sign out
          </button>
        </div>
      </nav>
    </>
  )

  return (
    <>
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:flex-col lg:w-64 lg:fixed lg:inset-y-0 z-40 border-r border-white/[0.08] bg-black/60 backdrop-blur-2xl">
        <SidebarContent />
      </aside>

      {/* Mobile Drawer Overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm lg:hidden"
          onClick={close}
        />
      )}

      {/* Mobile Drawer */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-64 flex flex-col border-r border-white/[0.08] bg-black/80 backdrop-blur-2xl lg:hidden transform transition-transform duration-300 ease-in-out ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <SidebarContent />
      </aside>
    </>
  )
}
