import Link from 'next/link'
import Image from 'next/image'
import type { ReactNode } from 'react'

/** Shared header for public trust, pricing and comparison pages. */
export function PublicNav() {
  return (
    <nav className="border-b border-white/[0.08]">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-5">
        <Link href="/" className="flex items-center gap-2.5 font-brand font-semibold tracking-tight">
          <Image src="/copilot-icon.png" alt="" width={28} height={28} unoptimized />
          App Listing Agent
        </Link>
        <div className="flex items-center gap-5 text-sm text-[#f7f2df]/60">
          <Link href="/docs" className="transition-colors hover:text-white">Docs</Link>
          <Link href="/contact" className="transition-colors hover:text-white">Contact</Link>
          <Link href="/login" className="rounded-full border border-white/15 px-4 py-2 text-white transition-colors hover:bg-white/10">Sign in</Link>
        </div>
      </div>
    </nav>
  )
}

/** Shared footer for public trust, pricing and comparison pages. */
export function PublicFooter() {
  return (
    <footer className="border-t border-white/[0.08]">
      <div className="mx-auto flex max-w-5xl flex-col justify-between gap-4 px-6 py-8 text-sm text-[#f7f2df]/45 sm:flex-row">
        <div className="flex flex-col gap-1">
          <span>© {new Date().getFullYear()} App Agentic Ltd</span>
          <span>App Listing Agent is operated by App Agentic Ltd</span>
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          <Link href="/pricing" className="hover:text-white">Pricing</Link>
          <Link href="/audit" className="hover:text-white">Free listing audit</Link>
          <Link href="/compare/fastlane" className="hover:text-white">vs fastlane</Link>
          <Link href="/appstore-copilot" className="hover:text-white">Formerly AppStore Copilot</Link>
          <Link href="/privacy" className="hover:text-white">Privacy</Link>
          <Link href="/terms" className="hover:text-white">Terms</Link>
          <Link href="/changelog" className="hover:text-white">Changelog</Link>
        </div>
      </div>
    </footer>
  )
}

export function TrustPage({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string
  title: string
  description: ReactNode
  children: ReactNode
}) {
  return (
    <main className="min-h-screen bg-[#080807] text-[#f7f2df]">
      <PublicNav />

      <article className="mx-auto max-w-3xl px-6 pb-24 pt-16 md:pt-24">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-purple-300">{eyebrow}</p>
        <h1 className="mt-5 font-brand text-4xl font-bold tracking-[-0.04em] text-white md:text-6xl">{title}</h1>
        <p className="mt-6 max-w-2xl text-lg leading-8 text-[#f7f2df]/60">{description}</p>
        <div className="trust-copy mt-14 space-y-10 text-[15px] leading-7 text-[#f7f2df]/70">
          {children}
        </div>
      </article>

      <PublicFooter />
    </main>
  )
}

export function TrustSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="mb-3 font-brand text-xl font-semibold text-white">{title}</h2>
      <div className="space-y-3">{children}</div>
    </section>
  )
}
