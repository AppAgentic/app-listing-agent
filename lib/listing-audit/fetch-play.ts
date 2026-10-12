import { AUDIT_MARKETS, isTranslated, readCapped, safeIconUrl } from './markets'
import type { ListingSnapshot, MarketCheck } from './types'

const PLAY_TIMEOUT_MS = 10000
const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15'

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

export function decodeHtml(text: string): string {
  return text
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (match, name) => ENTITIES[name.toLowerCase()] ?? match)
    .trim()
}

export interface PlayPage {
  title: string
  shortDescription: string | null
  description: string
  developer: string | null
  iconUrl: string | null
  genre: string | null
  rating: number | null
  ratingCount: number | null
  screenshotCount: number
  lastUpdated: string | null
}

/** Parses the public Play details page. Every field is optional except the title. */
export function parsePlayPage(html: string): PlayPage | null {
  const ldRaw = /<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/.exec(html)?.[1]
  let ld: Record<string, unknown> = {}
  try {
    ld = ldRaw ? (JSON.parse(ldRaw) as Record<string, unknown>) : {}
  } catch {
    ld = {}
  }
  const title = typeof ld.name === 'string' ? ld.name : null
  if (!title) return null
  const rating = ld.aggregateRating as { ratingValue?: string; ratingCount?: string } | undefined
  const author = ld.author as { name?: string } | undefined
  const descriptionHtml = /data-g-id="description"[^>]*>([\s\S]*?)<\/div>/.exec(html)?.[1] ?? ''
  const screenshots = new Set(
    [...html.matchAll(/<img[^>]+src="([^"]+)"[^>]*alt="Screenshot image"/g)].map(match => match[1].split('=')[0]),
  )
  const updated = /Updated on<\/div><div[^>]*>([^<]+)</.exec(html)?.[1]
  const updatedDate = updated ? new Date(`${updated} UTC`) : null

  return {
    title,
    shortDescription: typeof ld.description === 'string' ? decodeHtml(ld.description) : null,
    description: decodeHtml(descriptionHtml),
    developer: author?.name ?? null,
    iconUrl: safeIconUrl(typeof ld.image === 'string' ? ld.image : undefined),
    genre: typeof ld.applicationCategory === 'string' ? ld.applicationCategory.replace(/_/g, ' ').toLowerCase() : null,
    rating: rating?.ratingValue ? Number(rating.ratingValue) : null,
    ratingCount: rating?.ratingCount ? Number(rating.ratingCount) : null,
    screenshotCount: screenshots.size,
    lastUpdated: updatedDate && !Number.isNaN(updatedDate.getTime()) ? updatedDate.toISOString() : null,
  }
}

async function fetchPlayPage(packageName: string, hl: string, gl: string, fetchImpl: typeof fetch): Promise<PlayPage | null> {
  const url = `https://play.google.com/store/apps/details?id=${encodeURIComponent(packageName)}&hl=${hl}&gl=${gl}`
  const response = await fetchImpl(url, {
    headers: { 'User-Agent': BROWSER_UA, 'Accept-Language': hl },
    signal: AbortSignal.timeout(PLAY_TIMEOUT_MS),
    cache: 'no-store',
    redirect: 'follow',
  })
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`Google Play page failed (${response.status})`)
  if (response.url && new URL(response.url).hostname !== 'play.google.com') throw new Error('Google Play redirected off-site')
  return parsePlayPage(await readCapped(response))
}

/** Public Google Play listing for one app, plus which large markets show a translated listing. */
export async function fetchPlayListing(packageName: string, fetchImpl: typeof fetch = fetch): Promise<ListingSnapshot | null> {
  const base = await fetchPlayPage(packageName, 'en', 'US', fetchImpl)
  if (!base) return null
  const baseText = { title: base.title, description: base.description }

  const markets: MarketCheck[] = await Promise.all(
    AUDIT_MARKETS.map(async market => {
      try {
        const other = await fetchPlayPage(packageName, market.hl, market.gl, fetchImpl)
        if (!other) return { market: market.market, label: market.label, available: false, localized: false }
        return {
          market: market.market,
          label: market.label,
          available: true,
          localized: isTranslated(baseText, { title: other.title, description: other.description }),
        }
      } catch {
        return { market: market.market, label: market.label, available: false, localized: false }
      }
    }),
  )

  return {
    store: 'android',
    id: packageName,
    url: `https://play.google.com/store/apps/details?id=${packageName}`,
    title: base.title,
    developer: base.developer,
    iconUrl: base.iconUrl,
    genre: base.genre,
    description: base.description,
    shortDescription: base.shortDescription,
    screenshotCount: base.screenshotCount,
    tabletScreenshotCount: null,
    universal: null,
    rating: base.rating,
    ratingCount: base.ratingCount,
    lastUpdated: base.lastUpdated,
    releaseNotes: null,
    markets,
  }
}
