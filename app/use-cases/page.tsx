import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { DISCOVERY_PAGES } from '@/lib/discovery-pages'
import { TrackedFunnelLink } from '@/components/concierge/booking-link'
import { pageMetadata } from '@/lib/seo/site'

export const metadata: Metadata = pageMetadata({
  title: 'AI app store operations use cases',
  description: 'Explore AI workflows for app store optimization, App Store and Google Play screenshots, localization, and MCP-connected store operations.',
  path: '/use-cases',
})
export default function UseCasesPage() {
  return (
    <main className="min-h-screen bg-[#070807] text-[#f5f1df]">
      <nav className="mx-auto flex max-w-7xl items-center justify-between px-6 py-6 lg:px-10">
        <Link href="/" className="flex items-center gap-3 text-sm font-semibold"><Image src="/copilot-icon.png" width={36} height={36} alt="" /> App Listing Agent</Link>
        <TrackedFunnelLink source="use_cases_nav" href="/login?mode=signup&source=use_cases_nav" className="rounded-full border border-white/15 px-4 py-2 text-sm font-semibold transition-colors hover:border-white/35">Start free trial</TrackedFunnelLink>
      </nav>
      <header className="mx-auto max-w-7xl px-6 pb-24 pt-24 lg:px-10 lg:pb-36 lg:pt-36">
        <p className="font-mono text-xs uppercase tracking-[0.23em] text-lime-200/70">Use cases</p>
        <h1 className="mt-7 max-w-5xl font-brand text-6xl font-bold leading-[0.96] tracking-[-0.055em] sm:text-8xl">App-store work your agent can actually finish.</h1>
        <p className="mt-8 max-w-2xl text-xl leading-8 text-white/50">Move from a plain-English request to app-specific metadata, visual assets, localization, and approval-ready store changes.</p>
      </header>
      <section className="border-t border-white/10">
        <div className="mx-auto max-w-7xl px-6 lg:px-10">
          {DISCOVERY_PAGES.map((page, index) => (
            <Link key={page.slug} href={`/use-cases/${page.slug}`} className="group grid gap-8 border-b border-white/10 py-14 transition-colors hover:bg-white/[0.015] sm:grid-cols-[90px_1fr_auto] sm:items-center lg:py-20">
              <span className="font-mono text-xs text-violet-400">0{index + 1}</span>
              <div><p className="font-mono text-[11px] uppercase tracking-[0.19em] text-white/35">{page.eyebrow}</p><h2 className="mt-3 text-3xl font-semibold tracking-[-0.035em] sm:text-5xl">{page.title}</h2><p className="mt-4 max-w-2xl leading-7 text-white/45">{page.description}</p></div>
              <ArrowRight className="h-6 w-6 text-white/30 transition-transform group-hover:translate-x-2 group-hover:text-lime-200" />
            </Link>
          ))}
        </div>
      </section>
      <section className="px-6 py-28 text-center lg:py-40"><h2 className="mx-auto max-w-3xl text-5xl font-bold tracking-[-0.05em] sm:text-7xl">Connect the app. Ask for the work.</h2><TrackedFunnelLink source="use_cases_final" href="/login?mode=signup&source=use_cases_final" className="mt-10 inline-flex items-center gap-3 rounded-full bg-[#f5f1df] px-7 py-4 text-sm font-bold text-black">Start free trial <ArrowRight className="h-4 w-4" /></TrackedFunnelLink></section>
    </main>
  )
}
