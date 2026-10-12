'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { docsNavigation, type NavSection, type NavItem } from '@/lib/docs/navigation'
import { ChevronRight } from 'lucide-react'

export function DocsSidebar() {
  const pathname = usePathname()

  return (
    <aside className="fixed top-16 left-0 z-40 h-[calc(100vh-4rem)] w-72 overflow-y-auto border-r border-white/[0.08] bg-[#0a0a0a] hidden lg:block">
      <nav className="px-4 py-6 space-y-8">
        {docsNavigation.map((section) => (
          <NavSectionComponent
            key={section.title}
            section={section}
            pathname={pathname}
          />
        ))}
      </nav>
    </aside>
  )
}

function NavSectionComponent({
  section,
  pathname
}: {
  section: NavSection
  pathname: string
}) {
  return (
    <div>
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-white/50">
        {section.title}
      </h3>
      <ul className="space-y-1">
        {section.items.map((item) => (
          <NavItemComponent key={item.href} item={item} pathname={pathname} />
        ))}
      </ul>
    </div>
  )
}

function NavItemComponent({
  item,
  pathname,
  depth = 0
}: {
  item: NavItem
  pathname: string
  depth?: number
}) {
  const isActive = pathname === item.href
  const isParentActive = item.items?.some(
    (subItem) => pathname === subItem.href || pathname.startsWith(subItem.href + '/')
  )

  return (
    <li>
      <Link
        href={item.href}
        className={`
          flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors
          ${depth > 0 ? 'ml-4 pl-4 border-l border-white/[0.08]' : ''}
          ${
            isActive
              ? 'bg-purple-500/20 text-purple-400 font-medium border border-purple-500/30'
              : isParentActive
              ? 'text-white/90'
              : 'text-white/60 hover:bg-white/[0.05] hover:text-white'
          }
        `}
      >
        {item.icon && <item.icon className="h-4 w-4 flex-shrink-0" />}
        <span className="flex-1">{item.title}</span>
        {item.badge && (
          <span className="rounded-full bg-purple-500/20 px-2 py-0.5 text-xs text-purple-400">
            {item.badge}
          </span>
        )}
        {item.items && (
          <ChevronRight
            className={`h-4 w-4 transition-transform ${
              isParentActive ? 'rotate-90' : ''
            }`}
          />
        )}
      </Link>

      {/* Nested items */}
      {item.items && (isActive || isParentActive) && (
        <ul className="mt-1 space-y-1">
          {item.items.map((subItem) => (
            <NavItemComponent
              key={subItem.href}
              item={subItem}
              pathname={pathname}
              depth={depth + 1}
            />
          ))}
        </ul>
      )}
    </li>
  )
}
