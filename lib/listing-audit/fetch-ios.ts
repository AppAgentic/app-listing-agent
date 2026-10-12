import { AUDIT_MARKETS, isTranslated, readCapped, safeIconUrl } from './markets'
import type { ListingSnapshot, MarketCheck } from './types'

const LOOKUP_TIMEOUT_MS = 8000

interface LookupResult {
  trackId?: number
  trackName?: string
  artistName?: string
  sellerName?: string
  artworkUrl512?: string
  artworkUrl100?: string
  primaryGenreName?: string
  description?: string
  screenshotUrls?: string[]
  ipadScreenshotUrls?: string[]
  features?: string[]
  averageUserRating?: number
  userRatingCount?: number
  currentVersionReleaseDate?: string
  releaseNotes?: string
  trackViewUrl?: string
}

export async function lookupApp(appId: string, country: string, fetchImpl: typeof fetch = fetch): Promise<LookupResult | null> {
  const url = `https://itunes.apple.com/lookup?id=${encodeURIComponent(appId)}&country=${encodeURIComponent(country)}&entity=software`
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS), cache: 'no-store' })
  if (!response.ok) throw new Error(`App Store lookup failed (${response.status})`)
  const data = JSON.parse(await readCapped(response, 1_000_000)) as { results?: LookupResult[] }
  return data.results?.find(result => String(result.trackId) === appId) ?? null
}

/** Public App Store listing for one app, plus which large storefronts show a translated listing. */
export async function fetchIosListing(appId: string, country = 'us', fetchImpl: typeof fetch = fetch): Promise<ListingSnapshot | null> {
  const base = await lookupApp(appId, country, fetchImpl)
  if (!base || !base.trackName) return null
  const baseText = { title: base.trackName, description: base.description ?? '' }

  const markets: MarketCheck[] = await Promise.all(
    AUDIT_MARKETS.filter(market => market.country !== country).map(async market => {
      try {
        const other = await lookupApp(appId, market.country, fetchImpl)
        if (!other?.trackName) return { market: market.market, label: market.label, available: false, localized: false }
        return {
          market: market.market,
          label: market.label,
          available: true,
          localized: isTranslated(baseText, { title: other.trackName, description: other.description ?? '' }),
        }
      } catch {
        return { market: market.market, label: market.label, available: false, localized: false }
      }
    }),
  )

  return {
    store: 'ios',
    id: appId,
    url: base.trackViewUrl?.split('?')[0] ?? `https://apps.apple.com/${country}/app/id${appId}`,
    title: base.trackName,
    developer: base.sellerName ?? base.artistName ?? null,
    iconUrl: safeIconUrl(base.artworkUrl512 ?? base.artworkUrl100),
    genre: base.primaryGenreName ?? null,
    description: base.description ?? '',
    shortDescription: null,
    screenshotCount: base.screenshotUrls?.length ?? 0,
    tabletScreenshotCount: base.ipadScreenshotUrls?.length ?? 0,
    universal: base.features ? base.features.includes('iosUniversal') : null,
    rating: typeof base.averageUserRating === 'number' ? base.averageUserRating : null,
    ratingCount: typeof base.userRatingCount === 'number' ? base.userRatingCount : null,
    lastUpdated: base.currentVersionReleaseDate ?? null,
    releaseNotes: base.releaseNotes ?? null,
    markets,
  }
}
