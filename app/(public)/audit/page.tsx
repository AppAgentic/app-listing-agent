import type { Metadata } from 'next'
import { ListingAudit } from '@/components/audit/listing-audit'
import { PublicFooter, PublicNav } from '@/components/public/trust-page'
import { serializeJsonLd } from '@/lib/seo/json-ld'
import { breadcrumbJsonLd, pageMetadata } from '@/lib/seo/site'

export const metadata: Metadata = pageMetadata({
  title: 'Free App Store and Play listing audit',
  description: 'Paste an App Store or Google Play link and see what holds your listing back: translations, screenshots, title, freshness and copy. Free, no sign-up.',
  path: '/audit',
})

const CHECKS = [
  ['Translations', 'Whether shoppers in 8 large non-English markets see a translated listing.'],
  ['Screenshots', 'How many you use, and missing iPad sets for universal apps.'],
  ['Title', 'Whether the name carries the words people search for.'],
  ['Copy', 'Description depth, plus an AI review of how well it sells.'],
  ['Freshness', 'When the listing last changed and whether release notes say anything.'],
  ['Ratings', 'Volume and average, the trust signals next to your name.'],
] as const

export default function ListingAuditPage() {
  const jsonLd = [
    breadcrumbJsonLd([
      { name: 'Home', path: '/' },
      { name: 'Free listing audit', path: '/audit' },
    ]),
  ]
  return (
    <main className="min-h-screen bg-[#080807] text-[#f7f2df]">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }} />
      <PublicNav />

      <section className="relative overflow-hidden px-6 pb-20 pt-16 text-center md:pt-24">
        <div className="pointer-events-none absolute left-1/2 top-0 h-[520px] w-[820px] -translate-x-1/2 rounded-full bg-purple-500/10 blur-[120px]" />
        <p className="relative text-xs font-semibold uppercase tracking-[0.24em] text-purple-300">Free listing audit</p>
        <h1 className="relative mx-auto mt-5 max-w-3xl font-brand text-4xl font-bold tracking-[-0.04em] text-white md:text-6xl">
          What’s holding your app listing back?
        </h1>
        <p className="relative mx-auto mt-6 max-w-2xl text-lg leading-8 text-[#f7f2df]/60">
          Paste your App Store or Google Play link. In about 20 seconds you get a score, the problems that cost you
          downloads, and how to fix each one.
        </p>
        <div className="relative mt-10">
          <ListingAudit />
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-6 pb-24">
        <h2 className="text-center font-brand text-2xl font-semibold text-white">What the audit checks</h2>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {CHECKS.map(([title, body]) => (
            <div key={title} className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5">
              <h3 className="font-semibold text-white">{title}</h3>
              <p className="mt-2 text-[14px] leading-relaxed text-[#f7f2df]/55">{body}</p>
            </div>
          ))}
        </div>
        <p className="mx-auto mt-8 max-w-2xl text-center text-[13px] leading-relaxed text-[#f7f2df]/40">
          The audit reads only what the stores show publicly. Your subtitle, keywords and promotional text aren’t public,
          so they’re checked after you connect App Store Connect or Google Play.
        </p>
      </section>

      <PublicFooter />
    </main>
  )
}
