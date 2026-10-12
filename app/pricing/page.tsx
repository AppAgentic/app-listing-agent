import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import PricingSection from '@/components/PricingSection'
import { PublicFooter, PublicNav } from '@/components/public/trust-page'
import { BookingLink, TrackedFunnelLink } from '@/components/concierge/booking-link'
import { BILLING_PLANS, offeredBillingPlans, type BillingPlanDefinition } from '@/lib/billing/catalog'
import { serializeJsonLd } from '@/lib/seo/json-ld'
import {
  SITE_URL,
  SOFTWARE_ID,
  WEBSITE_ID,
  breadcrumbJsonLd,
  formatUsd,
  pageMetadata,
  pricedPublicPlans,
  softwareApplicationJsonLd,
} from '@/lib/seo/site'

// Every price and allowance on this page comes from lib/billing/catalog.ts,
// the same source as the homepage pricing cards and Stripe checkout, so the
// page, the JSON-LD offers and checkout cannot drift apart.


const tablePlans: BillingPlanDefinition[] = [...offeredBillingPlans(), 'enterprise' as const]
  .map(id => BILLING_PLANS[id])
  .filter(plan => plan.public)

function allowance(value: number): string {
  return value === -1 ? 'Unlimited' : value.toLocaleString('en-US')
}

function joinList(items: string[]): string {
  if (items.length <= 1) return items.join('')
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

/** Months saved by paying annually, if it is the same whole number for every priced plan. */
function annualMonthsSaved(plans: BillingPlanDefinition[]): number | null {
  const saved = plans.map(plan =>
    plan.monthlyPriceUsd && plan.annualPriceUsd !== null
      ? 12 - plan.annualPriceUsd / plan.monthlyPriceUsd
      : null
  )
  const first = saved[0]
  if (first === null || first === undefined || first <= 0 || !Number.isInteger(first)) return null
  return saved.every(value => value === first) ? first : null
}

const priced = pricedPublicPlans()
const monthsSaved = annualMonthsSaved(priced)
const monthlySummary = joinList(priced.map(plan => `${formatUsd(plan.monthlyPriceUsd ?? 0)} a month for ${plan.name}`))
const annualSummary = joinList(priced.map(plan => formatUsd(plan.annualPriceUsd ?? 0)))

export const metadata: Metadata = pageMetadata({
  title: 'Pricing and plans',
  description: `App Listing Agent plans start at ${formatUsd(priced[0]?.monthlyPriceUsd ?? 0)}/month. Compare ${joinList(tablePlans.map(plan => plan.name))} prices, allowances and billing terms.`,
  path: '/pricing',
})

const faqs = [
  {
    question: 'How much does App Listing Agent cost?',
    answer: `Paid plans cost ${monthlySummary}, in US dollars before any applicable taxes. Paying annually costs ${annualSummary} a year${monthsSaved ? ` (${monthsSaved} months free)` : ''}. Enterprise is priced by contract. Every self-serve plan starts with a 7-day free trial; there is no free plan.`,
  },
  {
    question: 'Are there usage charges on top of the plan price?',
    answer: 'No. Each plan has monthly allowances for translations, screenshot credits and icon credits. They are hard caps: nothing is charged automatically when you reach one, and you can move to a larger plan when you need more.',
  },
  {
    question: 'Do annual plans get the whole year of allowances up front?',
    answer: 'No. Paid allowances refresh every month, including on annual plans.',
  },
  {
    question: 'How does payment work?',
    answer: 'Checkout runs through Stripe Managed Payments, with Onelink by Stripe as the merchant of record. A payment method is required to start the 7-day trial; if you do not cancel before it ends, the plan you chose is charged automatically. Applicable taxes and the final total appear before you pay. Payment methods, invoices, cancellation and plan changes are managed in the Stripe billing portal. Subscriptions renew until cancelled.',
  },
  {
    question: 'Is publishing to the stores limited?',
    answer: 'Paid plans do not limit how many approved changes you publish to App Store Connect or Google Play. Every live store change still needs your approval first.',
  },
  {
    question: 'How does Enterprise work?',
    answer: 'Enterprise is arranged with our team. Book a planning call and we will set up the plan with you.',
  },
]

const structuredData = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'WebPage',
      '@id': `${SITE_URL}/pricing#webpage`,
      url: `${SITE_URL}/pricing`,
      name: 'App Listing Agent pricing',
      description: faqs[0].answer,
      isPartOf: { '@id': WEBSITE_ID },
      about: { '@id': SOFTWARE_ID },
    },
    breadcrumbJsonLd([
      { name: 'Home', path: '/' },
      { name: 'Pricing', path: '/pricing' },
    ]),
    softwareApplicationJsonLd({ withOffers: true }),
    {
      '@type': 'FAQPage',
      mainEntity: faqs.map(faq => ({
        '@type': 'Question',
        name: faq.question,
        acceptedAnswer: { '@type': 'Answer', text: faq.answer },
      })),
    },
  ],
}

export default function PricingPage() {
  return (
    <main className="min-h-screen bg-[#080807] text-[#f7f2df]">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(structuredData) }} />
      <PublicNav />

      <header className="mx-auto max-w-5xl px-6 pb-8 pt-16 md:pt-24">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-purple-300">Pricing</p>
        <h1 className="mt-5 font-brand text-4xl font-bold tracking-[-0.04em] text-white md:text-6xl">App Listing Agent pricing</h1>
        <p className="mt-6 max-w-3xl text-lg leading-8 text-[#f7f2df]/70">{faqs[0].answer}</p>
        <p className="mt-4 max-w-3xl text-[15px] leading-7 text-[#f7f2df]/55">
          Every plan connects your AI agent to App Store Connect and Google Play for listing audits, metadata,
          translations, screenshots, icons and custom store pages. Plans differ in how many apps you manage,
          your monthly allowances and team seats. There are no automatic usage charges.
        </p>
      </header>

      <PricingSection />

      <section aria-labelledby="compare-heading" className="border-t border-white/[0.06]">
        <div className="mx-auto max-w-5xl px-6 py-20 md:py-24">
          <h2 id="compare-heading" className="font-brand text-3xl font-bold tracking-[-0.03em] text-white md:text-4xl">Compare plans</h2>
          <p className="mt-4 max-w-2xl text-[15px] leading-7 text-[#f7f2df]/55">
            Monthly and annual prices in USD, before any applicable taxes. Allowances refresh monthly on every paid plan.
          </p>
          <div className="mt-10 overflow-x-auto rounded-2xl border border-white/10">
            <table className="w-full min-w-[640px] text-left text-sm">
              <caption className="sr-only">App Listing Agent plans, prices and monthly allowances</caption>
              <thead className="bg-white/[0.03] text-xs uppercase tracking-[0.12em] text-[#f7f2df]/50">
                <tr>
                  <th scope="col" className="px-4 py-3 font-semibold">Plan</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Monthly</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Annual</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Apps</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Translations / mo</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Screenshot credits / mo</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Icon credits / mo</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Team members</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.06] text-[#f7f2df]/80">
                {tablePlans.map(plan => (
                  <tr key={plan.id}>
                    <th scope="row" className="px-4 py-4 font-semibold text-white">{plan.name}</th>
                    <td className="px-4 py-4">{plan.monthlyPriceUsd === null ? 'Custom' : `${formatUsd(plan.monthlyPriceUsd)}/mo`}</td>
                    <td className="px-4 py-4">{plan.annualPriceUsd === null ? 'Custom' : `${formatUsd(plan.annualPriceUsd)}/yr`}</td>
                    <td className="px-4 py-4">{allowance(plan.limits.apps)}</td>
                    <td className="px-4 py-4">{allowance(plan.limits.translations)}</td>
                    <td className="px-4 py-4">{allowance(plan.limits.screenshots)}</td>
                    <td className="px-4 py-4">{allowance(plan.limits.icons)}</td>
                    <td className="px-4 py-4">{allowance(plan.limits.teamMembers)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section aria-labelledby="faq-heading" className="border-t border-white/[0.06]">
        <div className="mx-auto max-w-5xl px-6 py-20 md:py-24">
          <h2 id="faq-heading" className="font-brand text-3xl font-bold tracking-[-0.03em] text-white md:text-4xl">Pricing questions</h2>
          <dl className="mt-10 divide-y divide-white/[0.08] border-y border-white/[0.08]">
            {faqs.slice(1).map(faq => (
              <div key={faq.question} className="grid gap-3 py-7 md:grid-cols-[0.8fr_1.2fr] md:gap-10">
                <dt className="font-brand text-lg font-semibold text-white">{faq.question}</dt>
                <dd className="text-[15px] leading-7 text-[#f7f2df]/65">{faq.answer}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-8 text-[15px] leading-7 text-[#f7f2df]/55">
            Comparing tools? Read <Link href="/compare/fastlane" className="text-purple-300 underline underline-offset-4 hover:text-white">App Listing Agent vs fastlane</Link>.
          </p>
          <div className="mt-10 flex flex-col gap-3 sm:flex-row">
            <TrackedFunnelLink
              href="/login?mode=signup&source=pricing_page"
              source="pricing_page_self_service"
              className="inline-flex items-center justify-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-bold text-black transition-colors hover:bg-neutral-200"
            >
              Start 7-day free trial <ArrowRight className="h-4 w-4" />
            </TrackedFunnelLink>
            <BookingLink
              href="/book?source=pricing_page"
              source="pricing_page_guided"
              className="inline-flex items-center justify-center rounded-full border border-purple-400/25 bg-purple-400/[0.08] px-6 py-3 text-sm font-bold text-purple-100 transition-colors hover:border-purple-300/40 hover:bg-purple-400/[0.14]"
            >
              Book a planning call
            </BookingLink>
          </div>
        </div>
      </section>

      <PublicFooter />
    </main>
  )
}
