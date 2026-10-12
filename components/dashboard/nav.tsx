'use client'

import Link from 'next/link'
import Image from 'next/image'
import { SessionUser } from '@/lib/auth/session'
import { useMobileMenu } from './mobile-menu-context'
import { Menu } from 'lucide-react'

interface NavProps {
  user: SessionUser
}

export function DashboardNav({ user }: NavProps) {
  const { open: openMobileMenu } = useMobileMenu()

  return (
    <header className="sticky top-4 z-30 mx-4 lg:mx-6">
      <nav className="flex items-center justify-between h-14 px-4 lg:px-5 rounded-2xl bg-black/40 backdrop-blur-2xl border border-white/[0.08] shadow-xl">
        {/* Left side - Mobile menu + Logo */}
        <div className="flex items-center gap-3">
          {/* Mobile menu button */}
          <button
            onClick={openMobileMenu}
            className="lg:hidden p-2 rounded-lg hover:bg-white/[0.05] transition-colors"
          >
            <Menu className="w-5 h-5 text-neutral-400" />
          </button>

          {/* Mobile logo */}
          <Link href="/dashboard" className="lg:hidden flex items-center gap-2">
            <Image
              src="/copilot-icon.png"
              alt="App Listing Agent"
              width={28}
              height={28}
              className="w-7 h-7"
              unoptimized
            />
            <span className="font-bold text-white font-brand">App Listing Agent</span>
          </Link>

          {/* Desktop - empty (sidebar has logo) */}
          <div className="hidden lg:block" />
        </div>

        {/* Right side - User avatar */}
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center text-white text-sm font-bold">
            {user.email?.charAt(0).toUpperCase() || 'U'}
          </div>
        </div>
      </nav>
    </header>
  )
}
