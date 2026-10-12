import type { Metadata } from 'next'
import { BILLING_PLANS, offeredBillingPlans, type BillingPlanDefinition } from '@/lib/billing/catalog'

/**
 * Site-wide SEO facts. Everything here must match what the pages show.
 * Canonical host: applistingagent.com (apex). www and the legacy
 * appstorecopilot.com hosts 308 to it (lib/routing/canonical-host.ts).
 */
export const SITE_URL = 'https://applistingagent.com'
export const SITE_NAME = 'App Listing Agent'
/** Former product name (renamed 2026-09-23). */
export const FORMER_NAME = 'AppStore Copilot'
export const RENAME_DATE = '2026-09-23'
export const LEGACY_HOST = 'appstorecopilot.com'

export const ORGANIZATION_ID = `${SITE_URL}/#organization`
/** Referenced by the use-case pages (components/discovery/DiscoveryPageLayout.tsx). */
export const WEBSITE_ID = `${SITE_URL}/#website`
export const SOFTWARE_ID = `${SITE_URL}/#software`

export const SITE_DESCRIPTION =
  'Connect ChatGPT, Claude, Codex, or Cursor to App Store Connect and Google Play. Audit, localize, create screenshots, and publish approved changes.'

const OG_IMAGE = {
  url: '/opengraph-image',
  width: 1200,
  height: 630,
  alt: 'App Listing Agent — AI operations for the app stores',
}

/**
 * Metadata for a public page: title (the root template appends the brand once),
 * description, self-canonical, Open Graph and Twitter tags with the site image.
 * Pass `absoluteTitle` when the title already contains the brand.
 */
export function pageMetadata({
  title,
  absoluteTitle,
  description,
  path,
  socialTitle,
  robots,
}: {
  title?: string
  absoluteTitle?: string
  description: string
  path: string
  socialTitle?: string
  robots?: Metadata['robots']
}): Metadata {
  const shareTitle = socialTitle ?? absoluteTitle ?? (title ? `${title} | ${SITE_NAME}` : SITE_NAME)
  return {
    title: absoluteTitle ? { absolute: absoluteTitle } : title,
    description,
    alternates: { canonical: path },
    ...(robots ? { robots } : {}),
    openGraph: {
      type: 'website',
      siteName: SITE_NAME,
      url: path,
      title: shareTitle,
      description,
      images: [OG_IMAGE],
    },
    twitter: {
      card: 'summary_large_image',
      title: shareTitle,
      description,
      images: [OG_IMAGE.url],
    },
  }
}

export function organizationJsonLd() {
  // No sameAs: the product has no social or directory profiles we could
  // confirm (checked 2026-09-24). Add real profiles only once they exist.
  return {
    '@type': 'Organization',
    '@id': ORGANIZATION_ID,
    name: SITE_NAME,
    alternateName: FORMER_NAME,
    url: SITE_URL,
    logo: `${SITE_URL}/copilot-icon.png`,
    email: 'support@applistingagent.com',
    contactPoint: {
      '@type': 'ContactPoint',
      contactType: 'customer support',
      email: 'support@applistingagent.com',
      url: `${SITE_URL}/contact`,
    },
  }
}

export function websiteJsonLd() {
  return {
    '@type': 'WebSite',
    '@id': WEBSITE_ID,
    url: SITE_URL,
    name: SITE_NAME,
    alternateName: FORMER_NAME,
    description: SITE_DESCRIPTION,
    inLanguage: 'en',
    publisher: { '@id': ORGANIZATION_ID },
  }
}

/**
 * Public plans with a published price, cheapest first. Indie appears only when the deployment offers it
 * (NEXT_PUBLIC_BILLING_INDIE_ENABLED), so "from $X" copy and JSON-LD offers never advertise an unsellable plan.
 */
export function pricedPublicPlans(): BillingPlanDefinition[] {
  return offeredBillingPlans()
    .map(id => BILLING_PLANS[id])
    .filter(plan => plan.public && plan.monthlyPriceUsd !== null)
}

/**
 * One Offer per visible price on /pricing (monthly and annual per plan).
 * Prices come from lib/billing/catalog.ts, the same source as the pricing cards.
 */
export function planOffersJsonLd() {
  return pricedPublicPlans().flatMap(plan => {
    const offers = []
    if (plan.monthlyPriceUsd !== null) {
      offers.push({
        '@type': 'Offer',
        name: `${plan.name} (monthly)`,
        price: plan.monthlyPriceUsd.toFixed(2),
        priceCurrency: 'USD',
        url: `${SITE_URL}/pricing`,
        priceSpecification: {
          '@type': 'UnitPriceSpecification',
          price: plan.monthlyPriceUsd.toFixed(2),
          priceCurrency: 'USD',
          unitCode: 'MON',
          valueAddedTaxIncluded: false,
        },
      })
    }
    if (plan.annualPriceUsd !== null) {
      offers.push({
        '@type': 'Offer',
        name: `${plan.name} (annual)`,
        price: plan.annualPriceUsd.toFixed(2),
        priceCurrency: 'USD',
        url: `${SITE_URL}/pricing`,
        priceSpecification: {
          '@type': 'UnitPriceSpecification',
          price: plan.annualPriceUsd.toFixed(2),
          priceCurrency: 'USD',
          unitCode: 'ANN',
          valueAddedTaxIncluded: false,
        },
      })
    }
    return offers
  })
}

export function softwareApplicationJsonLd({ withOffers = false }: { withOffers?: boolean } = {}) {
  return {
    '@type': 'SoftwareApplication',
    '@id': SOFTWARE_ID,
    name: SITE_NAME,
    alternateName: FORMER_NAME,
    url: SITE_URL,
    description: SITE_DESCRIPTION,
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Web',
    publisher: { '@id': ORGANIZATION_ID },
    ...(withOffers ? { offers: planOffersJsonLd() } : {}),
  }
}

export function breadcrumbJsonLd(items: Array<{ name: string; path: string }>) {
  return {
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: `${SITE_URL}${item.path === '/' ? '' : item.path}`,
    })),
  }
}

export function formatUsd(value: number): string {
  return `$${value.toLocaleString('en-US', { maximumFractionDigits: 2 })}`
}
