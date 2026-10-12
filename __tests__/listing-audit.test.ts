import { describe, expect, it, vi } from 'vitest'
import { parseStoreUrl, targetKey } from '@/lib/listing-audit/parse-url'
import { runListingChecks } from '@/lib/listing-audit/checks'
import { isTranslated, safeIconUrl } from '@/lib/listing-audit/markets'
import { parsePlayPage } from '@/lib/listing-audit/fetch-play'
import { parseCopyReview, sanitizeReviewText } from '@/lib/listing-audit/ai-review'
import { runPublicListingAudit, type AuditCache } from '@/lib/listing-audit'
import type { ListingSnapshot } from '@/lib/listing-audit/types'

const NOW = new Date('2026-09-25T12:00:00Z')

function snapshot(overrides: Partial<ListingSnapshot> = {}): ListingSnapshot {
  return {
    store: 'ios',
    id: '1371187280',
    url: 'https://apps.apple.com/us/app/id1371187280',
    title: 'GymStreak: AI Personal Trainer',
    developer: 'GymStreak',
    iconUrl: null,
    genre: 'Health & Fitness',
    description: 'x'.repeat(1200),
    shortDescription: null,
    screenshotCount: 10,
    tabletScreenshotCount: 10,
    universal: true,
    rating: 4.7,
    ratingCount: 15000,
    lastUpdated: '2026-09-01T00:00:00Z',
    releaseNotes: 'Workout set details now align cleanly for faster logging.',
    markets: [
      { market: 'de', label: 'Germany', available: true, localized: true },
      { market: 'jp', label: 'Japan', available: true, localized: true },
    ],
    ...overrides,
  }
}

describe('parseStoreUrl', () => {
  it('reads App Store links with and without a country or scheme', () => {
    expect(parseStoreUrl('https://apps.apple.com/us/app/gymstreak/id1371187280')).toEqual({ store: 'ios', appId: '1371187280', country: 'us' })
    expect(parseStoreUrl('apps.apple.com/gb/app/id6739589473?mt=8')).toEqual({ store: 'ios', appId: '6739589473', country: 'gb' })
    expect(parseStoreUrl('https://apps.apple.com/app/id123456789')).toEqual({ store: 'ios', appId: '123456789', country: 'us' })
  })

  it('reads Google Play links', () => {
    expect(parseStoreUrl('https://play.google.com/store/apps/details?id=com.spotify.music&hl=en')).toEqual({ store: 'android', packageName: 'com.spotify.music' })
  })

  it('rejects other hosts, lookalikes and malformed ids', () => {
    for (const input of [
      '',
      'https://example.com/app/id1371187280',
      'https://apps.apple.com.evil.test/us/app/id1371187280',
      'https://play.google.com/store/apps/details?id=not a package',
      'https://play.google.com/store/search?q=gym',
      'https://apps.apple.com/us/app/gymstreak',
      'javascript:alert(1)',
    ]) {
      expect(parseStoreUrl(input)).toBeNull()
    }
  })

  it('builds stable cache keys', () => {
    expect(targetKey({ store: 'ios', appId: '1', country: 'us' })).toBe('ios_us_1')
    expect(targetKey({ store: 'ios', appId: '1', country: 'jp' })).toBe('ios_jp_1')
    expect(targetKey({ store: 'android', packageName: 'com.a.b' })).toBe('android_com.a.b')
  })
})

describe('runListingChecks', () => {
  it('scores a strong listing at 100 with strengths and the private fields noted', () => {
    const result = runListingChecks(snapshot(), NOW)
    expect(result.issues).toEqual([])
    expect(result.score).toBe(100)
    expect(result.strengths.map(item => item.id)).toEqual(expect.arrayContaining(['title_used', 'localized', 'screenshots', 'fresh', 'rating']))
    expect(result.notChecked.join(' ')).toMatch(/Subtitle, keywords and promotional text/)
  })

  it('flags an untranslated, thin, stale listing, high impact first', () => {
    const result = runListingChecks(snapshot({
      title: 'Focus',
      description: 'A timer.',
      screenshotCount: 3,
      tabletScreenshotCount: 0,
      lastUpdated: '2025-01-01T00:00:00Z',
      releaseNotes: 'Bug fixes and improvements.',
      ratingCount: 12,
      markets: [
        { market: 'de', label: 'Germany', available: true, localized: false },
        { market: 'jp', label: 'Japan', available: true, localized: false },
      ],
    }), NOW)
    const ids = result.issues.map(issue => issue.id)
    expect(ids).toEqual(expect.arrayContaining([
      'title_underused', 'not_localized', 'few_screenshots', 'no_ipad_screenshots', 'thin_description', 'stale', 'generic_release_notes', 'few_ratings',
    ]))
    expect(result.issues[0].severity).toBe('high')
    expect(result.score).toBeLessThan(40)
    expect(result.issues.find(issue => issue.id === 'few_ratings')?.fix).toBeNull()
  })

  it('names the missing markets when only some are translated', () => {
    const result = runListingChecks(snapshot({
      markets: [
        { market: 'de', label: 'Germany', available: true, localized: true },
        { market: 'jp', label: 'Japan', available: true, localized: false },
        { market: 'kr', label: 'South Korea', available: false, localized: false },
      ],
    }), NOW)
    const issue = result.issues.find(item => item.id === 'partly_localized')
    expect(issue?.title).toBe('Translated in 1 of 2 large markets')
    expect(issue?.detail).toContain('Japan')
  })

  it('checks the Play short description and uses the 77-language fix', () => {
    const result = runListingChecks(snapshot({
      store: 'android',
      shortDescription: 'Lift more.',
      universal: null,
      tabletScreenshotCount: null,
      releaseNotes: null,
      markets: [{ market: 'de', label: 'Germany', available: true, localized: false }],
    }), NOW)
    expect(result.issues.map(issue => issue.id)).toContain('short_description_underused')
    expect(result.issues.find(issue => issue.id === 'not_localized')?.fix).toContain('77 Google Play languages')
    expect(result.notChecked.join(' ')).not.toMatch(/Subtitle/)
  })
})

describe('isTranslated', () => {
  it('compares titles and the opening of the description, ignoring whitespace and case', () => {
    expect(isTranslated({ title: 'App', description: 'Hello  world' }, { title: 'app', description: 'hello world' })).toBe(false)
    expect(isTranslated({ title: 'App', description: 'Hello world' }, { title: 'App', description: 'Hallo Welt' })).toBe(true)
  })
})

describe('parsePlayPage', () => {
  const html = [
    '<meta property="og:title" content="Demo - Apps on Google Play">',
    '<script type="application/ld+json" nonce="x">{"@type":"SoftwareApplication","name":"Demo: Habit Tracker","description":"Build habits \\u0026 keep streaks","image":"https://play-lh.googleusercontent.com/icon","applicationCategory":"HEALTH_AND_FITNESS","author":{"@type":"Person","name":"Demo Ltd"},"aggregateRating":{"@type":"AggregateRating","ratingValue":"4.2","ratingCount":"321"}}</script>',
    '<img src="https://play-lh.googleusercontent.com/s1=w526" alt="Screenshot image"><img src="https://play-lh.googleusercontent.com/s1=w1052" alt="Screenshot image"><img src="https://play-lh.googleusercontent.com/s2=w526" alt="Screenshot image">',
    '<div class="bARER" data-g-id="description" inert>Line one &amp; more<br>Line two</div>',
    '<div>Updated on</div><div class="xg1aie">Sep 18, 2026</div>',
  ].join('')

  it('reads title, short and full description, rating, screenshots and update date', () => {
    const page = parsePlayPage(html)
    expect(page).toMatchObject({
      title: 'Demo: Habit Tracker',
      shortDescription: 'Build habits & keep streaks',
      description: 'Line one & more\nLine two',
      developer: 'Demo Ltd',
      rating: 4.2,
      ratingCount: 321,
      screenshotCount: 2,
      genre: 'health and fitness',
    })
    expect(page?.lastUpdated).toBe('2026-09-18T00:00:00.000Z')
  })

  it('returns null for a page without app data', () => {
    expect(parsePlayPage('<html><title>Not Found</title></html>')).toBeNull()
  })
})

describe('parseCopyReview', () => {
  it('accepts well-formed JSON and trims to three suggestions', () => {
    const review = parseCopyReview(JSON.stringify({
      verdict: 'Clear but feature-led.',
      suggestions: [1, 2, 3, 4].map(n => ({ title: `Tip ${n}`, detail: 'Do this.' })),
    }))
    expect(review?.suggestions).toHaveLength(3)
  })

  it('rejects malformed output', () => {
    expect(parseCopyReview('no json here')).toBeNull()
    expect(parseCopyReview('{"verdict": 3}')).toBeNull()
  })
})

describe('runPublicListingAudit', () => {
  const lookup = (country: string) => ({
    results: [{
      trackId: 1371187280,
      trackName: country === 'de' ? 'GymStreak: KI Fitness Trainer' : 'GymStreak: AI Personal Trainer',
      sellerName: 'GymStreak',
      description: country === 'de' ? 'Transformiere deine Fitnessreise' : 'Transform your fitness journey',
      screenshotUrls: Array(6).fill('s'),
      ipadScreenshotUrls: [],
      features: [],
      averageUserRating: 4.7,
      userRatingCount: 15000,
      currentVersionReleaseDate: '2026-09-01T00:00:00Z',
      releaseNotes: 'Faster logging for workout sets and cardio.',
      trackViewUrl: 'https://apps.apple.com/us/app/gymstreak/id1371187280?uo=4',
    }],
  })

  it('fetches only fixed store hosts, caches the report and serves the cache on repeat', async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input))
      expect(url.hostname).toBe('itunes.apple.com')
      return new Response(JSON.stringify(lookup(url.searchParams.get('country') ?? 'us')), { status: 200 })
    }) as unknown as typeof fetch
    const store = new Map<string, { report: never; createdAt: number }>()
    const cache: AuditCache = {
      get: async key => store.get(key) ?? null,
      set: async (key, report) => { store.set(key, { report: report as never, createdAt: NOW.getTime() }) },
    }
    const target = { store: 'ios' as const, appId: '1371187280', country: 'us' }
    const first = await runPublicListingAudit(target, { cache, fetchImpl, review: async () => null, now: () => NOW })
    expect(first.cached).toBe(false)
    expect(first.report.listing.url).toBe('https://apps.apple.com/us/app/gymstreak/id1371187280')
    const germany = first.report.markets.find(market => market.market === 'de')
    expect(germany).toMatchObject({ available: true, localized: true })
    expect(first.report.markets.find(market => market.market === 'fr')).toMatchObject({ available: true, localized: false })
    const calls = (fetchImpl as unknown as { mock: { calls: unknown[] } }).mock.calls.length

    const second = await runPublicListingAudit(target, { cache, fetchImpl, review: async () => null, now: () => NOW })
    expect(second.cached).toBe(true)
    expect((fetchImpl as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(calls)
  })

  it('reports a missing app', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ results: [] }), { status: 200 })) as unknown as typeof fetch
    await expect(runPublicListingAudit({ store: 'ios', appId: '999999', country: 'us' }, { fetchImpl, review: async () => null, now: () => NOW }))
      .rejects.toThrow('Listing not found')
  })
})

describe('output hardening', () => {
  it('strips links, emails and bare domains from AI text shown on our domain', () => {
    expect(sanitizeReviewText('Visit https://evil.test/x or www.evil.test now, email a@b.co, see evil.com today', 200))
      .toBe('Visit or now, email , see today')
  })

  it('only allows store image hosts over https for icons', () => {
    expect(safeIconUrl('https://is1-ssl.mzstatic.com/image/thumb/a.png')).toBe('https://is1-ssl.mzstatic.com/image/thumb/a.png')
    expect(safeIconUrl('https://play-lh.googleusercontent.com/abc')).toBe('https://play-lh.googleusercontent.com/abc')
    expect(safeIconUrl('http://is1-ssl.mzstatic.com/a.png')).toBeNull()
    expect(safeIconUrl('https://evil.test/a.png')).toBeNull()
    expect(safeIconUrl('javascript:alert(1)')).toBeNull()
  })
})
