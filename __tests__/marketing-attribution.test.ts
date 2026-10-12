import { describe, expect, it } from 'vitest'
import {
  appendMarketingParams,
  attributionToSearchParams,
  attributionFromSearchParams,
  attributionFromBillingMetadata,
  attributionToBillingMetadata,
  MARKETING_ATTRIBUTION_STORAGE_KEY,
  readStoredMarketingAttribution,
  resolveMarketingAttribution,
  sanitizeMarketingAttribution,
} from '@/lib/marketing/attribution'

function memoryStorage() {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
  }
}

describe('marketing attribution', () => {
  it('captures supported campaign and click parameters', () => {
    const params = new URLSearchParams(
      'utm_source=chatgpt&utm_medium=cpc&utm_campaign=launch&utm_content=hero&oppref=openai-click'
    )
    expect(attributionFromSearchParams(params, {
      landingPath: '/login?invite=must-not-persist',
      referrer: 'https://chatgpt.com/path?private=value',
      capturedAt: '2026-08-31T12:00:00.000Z',
    })).toEqual({
      source: 'chatgpt',
      medium: 'cpc',
      campaign: 'launch',
      content: 'hero',
      oppref: 'openai-click',
      landingPath: '/login',
      referrer: 'https://chatgpt.com/path',
      capturedAt: '2026-08-31T12:00:00.000Z',
    })
  })

  it('does not overwrite a prior campaign on an ordinary direct login', () => {
    expect(attributionFromSearchParams(new URLSearchParams(), {
      landingPath: '/login',
      referrer: 'https://applistingagent.com/',
      capturedAt: '2026-08-31T12:00:00.000Z',
    })).toBeNull()
  })

  it('carries attribution through an internal funnel link without overwriting explicit values', () => {
    const params = new URLSearchParams('utm_source=x&utm_campaign=paid&twclid=click-one')
    expect(appendMarketingParams('/login?mode=signup&utm_source=partner#form', params))
      .toBe('/login?mode=signup&utm_source=partner&utm_campaign=paid&twclid=click-one#form')
    expect(appendMarketingParams('https://example.com', params)).toBe('https://example.com')
  })

  it('persists an explicit landing touch and restores it after internal navigation', () => {
    const storage = memoryStorage()
    const landing = resolveMarketingAttribution(
      new URLSearchParams('utm_source=chatgpt&utm_campaign=launch&oppref=openai-click'),
      { landingPath: '/use-cases/ai-app-store-optimization', capturedAt: '2026-09-02T12:00:00.000Z' },
      storage,
    )

    expect(landing).toEqual({
      source: 'chatgpt',
      campaign: 'launch',
      oppref: 'openai-click',
      landingPath: '/use-cases/ai-app-store-optimization',
      capturedAt: '2026-09-02T12:00:00.000Z',
    })
    expect(resolveMarketingAttribution(new URLSearchParams(), { landingPath: '/login' }, storage))
      .toEqual(landing)
    expect(resolveMarketingAttribution(
      new URLSearchParams('utm_source=chatgpt&utm_campaign=launch&oppref=openai-click'),
      { landingPath: '/login', capturedAt: '2026-09-02T12:05:00.000Z' },
      storage,
    )).toEqual(landing)
    expect(readStoredMarketingAttribution(storage)).toEqual(landing)
    expect(storage.getItem(MARKETING_ATTRIBUTION_STORAGE_KEY)).not.toBeNull()
    expect(appendMarketingParams(
      '/login?mode=signup&source=discovery_hero',
      attributionToSearchParams(landing),
    )).toBe('/login?mode=signup&source=discovery_hero&utm_source=chatgpt&utm_campaign=launch&oppref=openai-click')
  })

  it('replaces a stored campaign only when a new explicit campaign arrives', () => {
    const storage = memoryStorage()
    resolveMarketingAttribution(new URLSearchParams('utm_source=meta&fbclid=old-click'), undefined, storage)
    expect(resolveMarketingAttribution(
      new URLSearchParams('utm_source=x&twclid=new-click'),
      undefined,
      storage,
    )).toEqual({ source: 'x', twclid: 'new-click' })
  })

  it('sanitizes size and URL boundaries before server persistence', () => {
    expect(sanitizeMarketingAttribution({
      source: `x${'a'.repeat(200)}`,
      landingPath: '//evil.example/path',
      referrer: 'javascript:alert(1)',
    })).toEqual({ source: `x${'a'.repeat(99)}` })
  })

  it('round-trips supported fields through billing metadata', () => {
    const metadata = attributionToBillingMetadata({
      source: 'meta',
      campaign: 'launch',
      fbclid: 'click-one',
      oppref: 'openai-click-one',
      capturedAt: 'not-forwarded',
    })
    expect(metadata).toEqual({
      appstorecopilot_utm_source: 'meta',
      appstorecopilot_utm_campaign: 'launch',
      appstorecopilot_fbclid: 'click-one',
      appstorecopilot_oppref: 'openai-click-one',
    })
    expect(attributionFromBillingMetadata(metadata)).toEqual({
      source: 'meta',
      campaign: 'launch',
      fbclid: 'click-one',
      oppref: 'openai-click-one',
    })
  })
})
