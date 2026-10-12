'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { X } from 'lucide-react'
import { docsNavigation } from '@/lib/docs/navigation'

interface DocsMobileMenuProps {
  isOpen: boolean
  onClose: () => void
}

export function DocsMobileMenu({ isOpen, onClose }: DocsMobileMenuProps) {
  const pathname = usePathname()

  if (!isOpen) return null

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm lg:hidden"
        onClick={onClose}
      />

      {/* Menu */}
      <div className="fixed top-0 left-0 z-50 h-full w-72 overflow-y-auto bg-[#0a0a0a] border-r border-white/[0.08] lg:hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-white/[0.08]">
          <span className="font-semibold text-white">Documentation</span>
          <button
            onClick={onClose}
            className="p-2 text-white/70 hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Navigation */}
        <nav className="p-4 space-y-6">
          {docsNavigation.map((section) => (
            <div key={section.title}>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-white/50">
                {section.title}
              </h3>
              <ul className="space-y-1">
                {section.items.map((item) => {
                  const isActive = pathname === item.href
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        onClick={onClose}
                        className={`
                          flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors
                          ${
                            isActive
                              ? 'bg-purple-500/20 text-purple-400 font-medium'
                              : 'text-white/60 hover:bg-white/[0.05] hover:text-white'
                          }
                        `}
                      >
                        {item.icon && <item.icon className="h-4 w-4" />}
                        <span>{item.title}</span>
                        {item.badge && (
                          <span className="ml-auto rounded-full bg-purple-500/20 px-2 py-0.5 text-xs text-purple-400">
                            {item.badge}
                          </span>
                        )}
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </nav>
      </div>
    </>
  )
}
