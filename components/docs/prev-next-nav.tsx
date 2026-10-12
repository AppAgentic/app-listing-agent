'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { getPrevNextNav } from '@/lib/docs/navigation'

export function PrevNextNav() {
  const pathname = usePathname()
  const { prev, next } = getPrevNextNav(pathname)

  return (
    <nav className="mt-16 flex items-center justify-between border-t border-white/[0.08] pt-8">
      {prev ? (
        <Link
          href={prev.href}
          className="group flex items-center gap-2 rounded-lg border border-white/[0.08] px-4 py-3 hover:bg-white/[0.05] transition-colors"
        >
          <ChevronLeft className="h-5 w-5 text-white/50 group-hover:text-purple-400" />
          <div>
            <p className="text-xs text-white/50">Previous</p>
            <p className="text-sm font-medium text-white group-hover:text-purple-400">
              {prev.title}
            </p>
          </div>
        </Link>
      ) : (
        <div />
      )}

      {next ? (
        <Link
          href={next.href}
          className="group flex items-center gap-2 rounded-lg border border-white/[0.08] px-4 py-3 hover:bg-white/[0.05] transition-colors text-right"
        >
          <div>
            <p className="text-xs text-white/50">Next</p>
            <p className="text-sm font-medium text-white group-hover:text-purple-400">
              {next.title}
            </p>
          </div>
          <ChevronRight className="h-5 w-5 text-white/50 group-hover:text-purple-400" />
        </Link>
      ) : (
        <div />
      )}
    </nav>
  )
}
