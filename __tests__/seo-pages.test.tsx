import React from 'react'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Metadata } from 'next'
import sitemap from '@/app/sitemap'
import { BILLING_PLANS } from '@/lib/billing/catalog'
import { DISCOVERY_PAGES } from '@/lib/discovery-pages'
import {
  WEBSITE_ID,
  formatUsd,
  organizationJsonLd,
  planOffersJsonLd,
  pricedPublicPlans,
  websiteJsonLd,
} from '@/lib/seo/site'
import PricingPage, { metadata as pricingMetadata } from '@/app/pricing/page'
import { metadata as renameMetadata } from '@/app/(public)/appstore-copilot/page'
import { generateMetadata as fastlaneMetadataFactory } from '@/app/(public)/compare/fastlane/page'
import { metadata as auditMetadata } from '@/app/(public)/audit/page'
import { metadata as changelogMetadata } from '@/app/(public)/changelog/page'
import { metadata as contactMetadata } from '@/app/(public)/contact/page'
import { metadata as privacyMetadata } from '@/app/(public)/privacy/page'
import { metadata as termsMetadata } from '@/app/(public)/terms/page'
import { metadata as agentsMetadata } from '@/app/agents/page'
import { metadata as bookMetadata } from '@/app/book/page'
import { metadata as useCasesMetadata } from '@/app/use-cases/page'

vi.mock('@/components/concierge/booking-link', () => ({
  BookingLink: ({ source: _source, ...props }: any) => <a {...props} />,
  TrackedFunnelLink: ({ source: _source, ...props }: any) => <a {...props} />,
}))
afterEach(cleanup)

const ROOT_TEMPLATE = (title: string) => `${title} | App Listing Agent`

function finalTitle(metadata: Metadata): string {
  const title = metadata.title
  if (typeof title === 'string') return ROOT_TEMPLATE(title)
  if (title && typeof title === 'object' && 'absolute' in title) return title.absolute
  throw new Error('page has no title')
}

const pages: Array<[string, Metadata]> = [
  ['/pricing', pricingMetadata],
  ['/appstore-copilot', renameMetadata],
  ['/compare/fastlane', fastlaneMetadataFactory()],
  ['/audit', auditMetadata],
  ['/changelog', changelogMetadata],
  ['/contact', contactMetadata],
  ['/privacy', privacyMetadata],
  ['/terms', termsMetadata],
  ['/agents', agentsMetadata],
  ['/book', bookMetadata],
  ['/use-cases', useCasesMetadata],
]

describe('SEO basics on public pages', () => {
  it.each(pages)('%s has a self-canonical, one brand mention and bounded title/description', (path, metadata) => {
    expect(metadata.alternates?.canonical).toBe(path)
    const title = finalTitle(metadata)
    expect(title.length).toBeLessThanOrEqual(60)
    expect(title.split('App Listing Agent').length - 1).toBe(1)
    expect(typeof metadata.description).toBe('string')
    expect((metadata.description as string).length).toBeLessThanOrEqual(155)
    expect(metadata.openGraph?.url).toBe(path)
  })

  it('gives every page a unique description', () => {
    const descriptions = pages.map(([, metadata]) => metadata.description)
    expect(new Set(descriptions).size).toBe(descriptions.length)
  })

  it('keeps the JS-only booking page out of the index and the sitemap', () => {
    expect(bookMetadata.robots).toEqual({ index: false, follow: true })
    expect(sitemap().map(entry => entry.url)).not.toContain('https://applistingagent.com/book')
  })
})

describe('sitemap', () => {
  it('uses real per-page dates instead of the request time', () => {
    const first = sitemap()
    const today = new Date().toISOString().slice(0, 10)
    for (const entry of first) {
      expect(entry.lastModified).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(String(entry.lastModified) <= today).toBe(true)
    }
    expect(sitemap()).toEqual(first)
  })

  it('lists the pricing, rename and comparison pages on the canonical host', () => {
    const urls = sitemap().map(entry => entry.url)
    for (const path of ['/pricing', '/appstore-copilot', '/compare/fastlane']) {
      expect(urls).toContain(`https://applistingagent.com${path}`)
    }
    expect(urls.every(url => url.startsWith('https://applistingagent.com'))).toBe(true)
    for (const page of DISCOVERY_PAGES) {
      expect(page.updated >= page.published).toBe(true)
    }
  })
})

describe('structured data', () => {
  it('defines the #website node the use-case pages reference', () => {
    expect(WEBSITE_ID).toBe('https://applistingagent.com/#website')
    expect(websiteJsonLd()['@id']).toBe(WEBSITE_ID)
    expect(organizationJsonLd()).not.toHaveProperty('sameAs')
  })

  it('derives offers from the billing catalog', () => {
    const offers = planOffersJsonLd()
    const expected = pricedPublicPlans().flatMap(plan => [plan.monthlyPriceUsd, plan.annualPriceUsd])
    expect(offers.map(offer => Number(offer.price))).toEqual(expected)
    expect(offers.every(offer => offer.priceCurrency === 'USD')).toBe(true)
  })

  it('shows every offered price on the /pricing page', () => {
    const { container } = render(<PricingPage />)
    const text = container.textContent ?? ''
    for (const plan of pricedPublicPlans()) {
      expect(text).toContain(`${formatUsd(plan.monthlyPriceUsd!)}/mo`)
      expect(text).toContain(`${formatUsd(plan.annualPriceUsd!)}/yr`)
    }
    expect(text).toContain(`${formatUsd(BILLING_PLANS.starter.monthlyPriceUsd!)} a month for ${BILLING_PLANS.starter.name}`)
    const scripts = container.querySelectorAll('script[type="application/ld+json"]')
    expect(scripts).toHaveLength(1)
    const graph = JSON.parse(scripts[0].innerHTML)['@graph'] as Array<Record<string, unknown>>
    const software = graph.find(node => node['@type'] === 'SoftwareApplication') as { offers: unknown[] }
    expect(software.offers).toHaveLength(planOffersJsonLd().length)
    expect(container.querySelectorAll('h1')).toHaveLength(1)
  })
})

describe('Indie on /pricing and in structured data', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.resetModules() })

  it('advertises plans from $99 with no Indie offer while Indie is not offered', () => {
    expect(pricedPublicPlans().map(plan => plan.id)).toEqual(['starter', 'pro', 'business'])
    expect(planOffersJsonLd().some(offer => offer.name.startsWith('Indie'))).toBe(false)
    expect(pricingMetadata.description).toContain('start at $99/month')
    const { container } = render(<PricingPage />)
    expect(container.textContent).not.toContain('Indie')
  })

  it('adds Indie to the cards, the comparison table, the "from" price and the JSON-LD offers when enabled', async () => {
    vi.stubEnv('NEXT_PUBLIC_BILLING_INDIE_ENABLED', 'true')
    vi.resetModules()
    const site = await import('@/lib/seo/site')
    const page = await import('@/app/pricing/page')
    const fastlane = await import('@/app/(public)/compare/fastlane/page')

    expect(site.pricedPublicPlans().map(plan => plan.id)).toEqual(['indie', 'starter', 'pro', 'business'])
    const offers = site.planOffersJsonLd()
    expect(offers.slice(0, 2).map(offer => [offer.name, offer.price])).toEqual([['Indie (monthly)', '49.00'], ['Indie (annual)', '490.00']])

    const description = String(page.metadata.description)
    expect(description).toContain('start at $49/month')
    expect(description).toContain('Indie, Solo, Pro, Studio and Enterprise')
    expect(description.length).toBeLessThanOrEqual(155)

    const { container } = render(<page.default />)
    const text = container.textContent ?? ''
    expect(text).toContain('$49 a month for Indie')
    expect(text).toContain('$490/yr')
    expect(text).toContain('(2 months free)')
    const indieRow = Array.from(container.querySelectorAll('tbody tr')).find(row => row.querySelector('th')?.textContent === 'Indie')!
    expect(Array.from(indieRow.querySelectorAll('td')).map(cell => cell.textContent)).toEqual(['$49/mo', '$490/yr', '1', '50', '10', '3', '1'])
    const graph = JSON.parse(container.querySelector('script[type="application/ld+json"]')!.innerHTML)['@graph'] as Array<Record<string, unknown>>
    const software = graph.find(node => node['@type'] === 'SoftwareApplication') as { offers: Array<{ name: string }> }
    expect(software.offers).toHaveLength(8)
    expect(software.offers[0].name).toBe('Indie (monthly)')

    const { container: compare } = render(<fastlane.default />)
    expect(compare.textContent).toContain('Paid plans from $49/month')
  })
})

