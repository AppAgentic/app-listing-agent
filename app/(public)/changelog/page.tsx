import type { Metadata } from 'next'
import Link from 'next/link'
import { TrustPage } from '@/components/public/trust-page'
import { TRIAL_PERIOD_DAYS } from '@/lib/billing/catalog'
import { pageMetadata } from '@/lib/seo/site'

export const metadata: Metadata = pageMetadata({
  title: 'Changelog',
  description: 'Dated release notes for App Listing Agent (formerly AppStore Copilot): new store tools, billing, security and account changes.',
  path: '/changelog',
})

const releases = [
  {
    date: '25 September 2026',
    title: 'Free listing audit',
    items: ['Paste an App Store or Google Play link and get a score, the problems holding the listing back, and how to fix each one', 'Checks translations, screenshots, title, copy, freshness and ratings from the public store page', 'No account needed'],
    link: { href: '/audit', label: 'Run the audit' },
  },
  {
    date: '24 September 2026',
    title: 'New checkout and a free trial',
    items: [`Every self-serve plan starts with a ${TRIAL_PERIOD_DAYS}-day free trial on your first subscription; a card is required`, 'Checkout, receipts and cancellation now run through Stripe Managed Payments, with Onelink by Stripe as the merchant of record', 'A dedicated pricing page listing every plan’s allowances'],
    link: { href: '/pricing', label: 'See pricing' },
  },
  {
    date: '23 September 2026',
    title: 'AppStore Copilot is now App Listing Agent',
    items: ['New name and web address: applistingagent.com', 'Links to appstorecopilot.com redirect to the same page on applistingagent.com', 'Accounts, projects, connected stores and plans carry over unchanged'],
    link: { href: '/appstore-copilot', label: 'What changed and what didn’t' },
  },
  {
    date: '26 August 2026',
    title: 'Launch trust and account controls',
    items: ['Server-enforced invite and waitlist access', 'Self-service account deletion', 'Public privacy, terms, contact, and changelog pages'],
  },
  {
    date: 'August 2026',
    title: 'Verified billing and public launch surface',
    items: ['Whop-backed plan verification', 'Scoped agent and API keys', 'A focused public toolset for store metadata, screenshots, icons, and custom pages'],
  },
  {
    date: 'July 2026',
    title: 'Custom store pages',
    items: ['App Store custom product page workflows', 'Google Play custom store listings', 'Localized page content and screenshot support'],
  },
]

export default function ChangelogPage() {
  return (
    <TrustPage eyebrow="Product updates" title="Changelog" description="A concise record of meaningful App Listing Agent improvements.">
      <div className="space-y-12">
        {releases.map(release => (
          <section key={`${release.date}-${release.title}`} className="border-l border-white/10 pl-6">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-purple-300">{release.date}</p>
            <h2 className="mt-2 font-brand text-2xl font-semibold text-white">{release.title}</h2>
            <ul className="mt-4 space-y-2">
              {release.items.map(item => <li key={item} className="flex gap-3"><span className="text-purple-300">→</span><span>{item}</span></li>)}
            </ul>
            {'link' in release && release.link && (
              <Link href={release.link.href} className="mt-4 inline-block text-purple-300 underline underline-offset-4 hover:text-white">{release.link.label}</Link>
            )}
          </section>
        ))}
      </div>
    </TrustPage>
  )
}
