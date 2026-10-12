'use client'

import Link from 'next/link'
import { useState, useEffect } from 'react'
import { Search, Menu, X, ExternalLink } from 'lucide-react'
import { DocsSearch } from './docs-search'
import { DocsMobileMenu } from './docs-mobile-menu'

export function DocsNavbar() {
  const [searchOpen, setSearchOpen] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  // Keyboard shortcut for search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setSearchOpen(true)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  return (
    <>
      <header className="fixed top-0 left-0 right-0 z-50 h-16 border-b border-white/[0.08] bg-[#0a0a0a]/80 backdrop-blur-xl">
        <div className="flex h-full items-center justify-between px-4 lg:px-6">
          {/* Left side */}
          <div className="flex items-center gap-4">
            {/* Mobile menu button */}
            <button
              onClick={() => setMobileMenuOpen(true)}
              className="p-2 text-white/70 hover:text-white lg:hidden"
            >
              <Menu className="h-5 w-5" />
            </button>

            {/* Logo */}
            <Link href="/" className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center">
                <span className="text-white font-bold text-sm">AC</span>
              </div>
              <span className="font-semibold text-white hidden sm:inline">
                App Listing Agent
              </span>
            </Link>

            {/* Docs badge */}
            <span className="rounded-md bg-white/[0.08] px-2 py-1 text-xs text-white/60">
              Docs
            </span>
          </div>

          {/* Center - Search */}
          <div className="flex-1 max-w-xl mx-4 hidden md:block">
            <button
              onClick={() => setSearchOpen(true)}
              className="w-full flex items-center gap-3 rounded-xl border border-white/[0.08] bg-white/[0.02] px-4 py-2.5 text-sm text-white/50 hover:bg-white/[0.05] transition-colors"
            >
              <Search className="h-4 w-4" />
              <span className="flex-1 text-left">Search documentation...</span>
              <kbd className="hidden sm:inline rounded border border-white/20 bg-white/5 px-2 py-0.5 text-xs">
                ⌘K
              </kbd>
            </button>
          </div>

          {/* Right side */}
          <div className="flex items-center gap-2">
            {/* Mobile search */}
            <button
              onClick={() => setSearchOpen(true)}
              className="p-2 text-white/70 hover:text-white md:hidden"
            >
              <Search className="h-5 w-5" />
            </button>

            {/* Dashboard link */}
            <Link
              href="/overview"
              className="flex items-center gap-1.5 rounded-lg bg-white/[0.08] px-3 py-2 text-sm text-white hover:bg-white/[0.12] transition-colors"
            >
              Dashboard
              <ExternalLink className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      </header>

      {/* Search modal */}
      <DocsSearch isOpen={searchOpen} onClose={() => setSearchOpen(false)} />

      {/* Mobile menu */}
      <DocsMobileMenu
        isOpen={mobileMenuOpen}
        onClose={() => setMobileMenuOpen(false)}
      />
    </>
  )
}
