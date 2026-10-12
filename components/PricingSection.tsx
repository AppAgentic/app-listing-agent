'use client'

import { useEffect, useRef, useState } from 'react'
import { Check } from 'lucide-react'
import { trialIntentUrl } from '@/lib/billing/intent'
import { BILLING_PLANS, TRIAL_PERIOD_DAYS, offeredBillingPlans, type UserPlan } from '@/lib/billing/catalog'
import { BookingLink, TrackedFunnelLink } from '@/components/concierge/booking-link'
import { trackEvent } from '@/lib/analytics/client'

interface Plan {
  id: Exclude<UserPlan, 'free'>
  name: string
  monthlyPrice: number | null
  annualPrice: number | null
  desc: string
  features: string[]
  guidedAction: string
  popular: boolean
}

const planPresentation: Array<Pick<Plan, 'id' | 'desc' | 'guidedAction' | 'popular'>> = [
  {
    id: 'indie',
    desc: "For your first app",
    guidedAction: "Book a setup call",
    popular: false
  },
  {
    id: 'starter',
    desc: "For independent app builders",
    guidedAction: "Book a setup call",
    popular: false
  },
  {
    id: 'pro',
    desc: "For growing app businesses",
    guidedAction: "Book a setup call",
    popular: true
  },
  {
    id: 'business',
    desc: "For teams managing an app portfolio",
    guidedAction: "Book a setup call",
    popular: false
  },
  {
    id: 'enterprise',
    desc: "Custom scale with contract-backed limits",
    guidedAction: "Book a planning call",
    popular: false
  }
]

function formatAllowance(value: number): string {
  return value === -1 ? 'Unlimited' : value.toLocaleString()
}

/** "1 app", "3 apps", "Unlimited apps". */
function countLabel(value: number, singular: string, plural: string): string {
  return `${formatAllowance(value)} ${value === 1 ? singular : plural}`
}

// Indie is listed only when the deployment offers it (NEXT_PUBLIC_BILLING_INDIE_ENABLED, set once its Stripe prices exist).
function offeredPlans(): Plan[] {
  const offered = new Set<UserPlan>([...offeredBillingPlans(), 'enterprise'])
  return planPresentation.filter(presentation => offered.has(presentation.id)).map(presentation => {
    const definition = BILLING_PLANS[presentation.id]
    return {
      ...presentation,
      name: definition.name,
      monthlyPrice: definition.monthlyPriceUsd,
      annualPrice: definition.annualPriceUsd,
      features: [
        countLabel(definition.limits.apps, 'app', 'apps'),
        `${formatAllowance(definition.limits.translations)} translations/mo`,
        `${formatAllowance(definition.limits.screenshots)} screenshot credits/mo`,
        `${formatAllowance(definition.limits.icons)} icon credits/mo`,
        countLabel(definition.limits.teamMembers, 'team member', 'team members'),
        'No automatic usage charges',
      ],
    }
  })
}

export default function PricingSection() {
  const plans = offeredPlans()
  const [isAnnual, setIsAnnual] = useState(true)
  const sectionRef = useRef<HTMLElement>(null)

  // First-party analytics: the pricing paywall counts as viewed once it scrolls into view.
  useEffect(() => {
    const section = sectionRef.current
    if (!section || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return
      observer.disconnect()
      trackEvent('paywall_viewed', { props: { placement: 'pricing' } })
    }, { threshold: 0 })
    observer.observe(section)
    return () => observer.disconnect()
  }, [])

  const getPrice = (tier: Plan) => {
    const amount = isAnnual && tier.annualPrice !== null ? tier.annualPrice / 12 : tier.monthlyPrice
    return amount?.toLocaleString('en-US', { maximumFractionDigits: 2 })
  }

  return (
    <section ref={sectionRef} id="pricing" className="py-32 px-6 border-t border-white/[0.05]">
      <div className="max-w-6xl mx-auto text-center mb-12">
        <h2 className="text-4xl md:text-5xl font-bold tracking-tight mb-4">Simple, predictable pricing.</h2>
        <p className="text-neutral-500 text-[18px]">Choose a clear monthly allowance. Every plan starts with a {TRIAL_PERIOD_DAYS}-day free trial. No automatic usage charges.</p>
      </div>

      {/* Billing Toggle */}
      <div className="flex items-center justify-center gap-4 mb-16">
        <span className={`text-[15px] font-medium transition-colors ${!isAnnual ? 'text-white' : 'text-neutral-500'}`}>
          Monthly
        </span>
        <button
          type="button"
          role="switch"
          aria-label="Annual billing"
          aria-checked={isAnnual}
          onClick={() => setIsAnnual(!isAnnual)}
          className={`relative w-14 h-8 rounded-full transition-colors ${isAnnual ? 'bg-purple-500' : 'bg-white/10'}`}
        >
          <div
            className={`absolute top-1 w-6 h-6 bg-white rounded-full transition-transform ${isAnnual ? 'left-7' : 'left-1'}`}
          />
        </button>
        <span className={`text-[15px] font-medium transition-colors ${isAnnual ? 'text-white' : 'text-neutral-500'}`}>
          Annual
        </span>
        {isAnnual && (
          <span className="px-2.5 py-1 bg-emerald-500/10 border border-emerald-500/20 rounded-full text-[11px] font-bold text-emerald-500">
            SAVE 2 MONTHS
          </span>
        )}
      </div>

      <div className={`max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-6 ${plans.length > 4 ? 'lg:grid-cols-3 xl:grid-cols-5' : 'lg:grid-cols-4'}`}>
        {plans.map((tier, i) => (
          <div key={i} className={`relative flex flex-col ${plans.length > 4 ? 'p-6 xl:p-7' : 'p-8'} rounded-3xl border transition-all duration-300 ${tier.popular ? 'bg-white/[0.03] border-purple-500/50 shadow-[0_0_40px_rgba(139,92,246,0.1)]' : 'bg-transparent border-white/[0.08] hover:border-white/[0.2]'}`}>
            {tier.popular && (
              <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 bg-purple-500 rounded-full text-[10px] font-black tracking-widest uppercase">
                MOST POPULAR
              </div>
            )}
            <h3 className="text-[14px] font-bold text-neutral-500 uppercase tracking-widest mb-2">{tier.name}</h3>
            <div className="mb-2">
              {tier.monthlyPrice ? (
                <>
                  <span className="text-4xl font-bold">${getPrice(tier)}</span>
                  <span className="text-neutral-500 text-[14px]">/mo</span>
                </>
              ) : (
                <span className="text-4xl font-bold">Custom</span>
              )}
            </div>
            {isAnnual && tier.monthlyPrice && (
              <div className="text-[12px] text-neutral-500 mb-4">
                ${tier.annualPrice?.toLocaleString('en-US')} billed annually
              </div>
            )}
            {(!isAnnual || !tier.monthlyPrice) && <div className="mb-4" />}
            <p className="text-neutral-400 text-[14px] mb-8">{tier.desc}</p>

            <ul className="flex-1 space-y-4 mb-10">
              {tier.features.map((feat, j) => (
                <li key={j} className="flex items-center gap-3 text-[14px] text-neutral-300">
                  <Check className="w-4 h-4 text-emerald-500 flex-shrink-0" />
                  {feat}
                </li>
              ))}
            </ul>

            {tier.id === 'enterprise' ? (
              <BookingLink
                href={`/book?source=pricing&plan=${tier.id}&interval=${isAnnual ? 'annual' : 'monthly'}`}
                source={`pricing_${tier.id}_assisted`}
                className="w-full py-3 rounded-full font-bold text-[14px] text-center bg-white/10 text-white hover:bg-white/15"
              >
                Discuss Enterprise
              </BookingLink>
            ) : (
            <TrackedFunnelLink
              href={trialIntentUrl({ plan: tier.id, interval: isAnnual ? 'annual' : 'monthly' }, 'pricing')}
              source={`pricing_${tier.id}_self_service`}
              className={`w-full py-3 rounded-full font-bold text-[14px] transition-all text-center ${tier.popular ? 'bg-purple-500 text-white hover:bg-purple-600' : 'bg-white/[0.05] text-white hover:bg-white/[0.1]'}`}
            >
              Start {TRIAL_PERIOD_DAYS}-day free trial
            </TrackedFunnelLink>
            )}
            <BookingLink
              href={`/book?source=pricing&plan=${tier.id}&interval=${isAnnual ? 'annual' : 'monthly'}`}
              source={`pricing_${tier.id}_guided`}
              className="mt-3 w-full py-2 text-center text-[13px] font-semibold text-white/45 transition-colors hover:text-white"
            >
              {tier.guidedAction}
            </BookingLink>
          </div>
        ))}
      </div>

      {/* Note about quotas */}
      <div className="max-w-2xl mx-auto mt-12 text-center">
        <p className="text-neutral-500 text-[13px]">
          Prices in USD, before any applicable taxes. {TRIAL_PERIOD_DAYS}-day free trial on your first subscription; a card is required and you can cancel before it ends at no charge. Paid allowances refresh monthly, including on annual plans. Enterprise is arranged with our team.
        </p>
      </div>
    </section>
  )
}
