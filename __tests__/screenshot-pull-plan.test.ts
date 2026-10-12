import { describe, expect, it } from 'vitest'
import { planScreenshotPull } from '../lib/services/screenshot-pull-plan'
import type { PulledScreenshotSet } from '../lib/services/appstore'

const img = (name: string, width = 1290, height = 2796) => ({
  url: `https://example.test/${name}.png`, fileName: `${name}.png`, width, height, checksum: name,
})

describe('planScreenshotPull', () => {
  it('keeps every locale: primary as base, differing images as overrides', () => {
    const pulled: PulledScreenshotSet[] = [
      { displayType: 'APP_IPHONE_67', locale: 'de-DE', screenshots: [img('de1'), img('shared2')] },
      { displayType: 'APP_IPHONE_67', locale: 'en-US', screenshots: [img('en1'), img('shared2')] },
      { displayType: 'APP_IPHONE_67', locale: 'fr-FR', screenshots: [img('fr1'), img('fr2')] },
    ]
    const plan = planScreenshotPull(pulled, 'en-US')
    expect(plan.sets).toHaveLength(1)
    const [set] = plan.sets
    expect(set.displayType).toBe('APP_IPHONE_69')
    expect(set.baseLocale).toBe('en-US')
    expect(set.base.map(i => i.checksum)).toEqual(['en1', 'shared2'])
    expect(set.localized.map(l => [l.locale, l.index, l.image.checksum])).toEqual([
      ['de-DE', 0, 'de1'],
      ['fr-FR', 0, 'fr1'],
      ['fr-FR', 1, 'fr2'],
    ])
  })

  it('falls back to en-US, then the first locale, when the primary has no set', () => {
    expect(planScreenshotPull([
      { displayType: 'APP_IPHONE_67', locale: 'ja', screenshots: [img('ja')] },
      { displayType: 'APP_IPHONE_67', locale: 'en-US', screenshots: [img('en')] },
    ], 'fr-FR').sets[0].baseLocale).toBe('en-US')
    expect(planScreenshotPull([
      { displayType: 'APP_IPHONE_67', locale: 'ja', screenshots: [img('ja')] },
      { displayType: 'APP_IPHONE_67', locale: 'de-DE', screenshots: [img('de')] },
    ], undefined).sets[0].baseLocale).toBe('de-DE')
  })

  it('counts images past the base length instead of misplacing them', () => {
    const plan = planScreenshotPull([
      { displayType: 'APP_IPHONE_67', locale: 'en-US', screenshots: [img('a')] },
      { displayType: 'APP_IPHONE_67', locale: 'de-DE', screenshots: [img('a'), img('b'), img('c')] },
    ], 'en-US')
    expect(plan.sets[0].localized).toEqual([])
    expect(plan.sets[0].extraImagesDropped).toBe(2)
  })

  it('tells 6.3" from 6.1" by size and prefers the native 6.1" set', () => {
    const plan = planScreenshotPull([
      { displayType: 'APP_IPHONE_61', locale: 'en-US', screenshots: [img('p63', 1206, 2622)] },
      { displayType: 'APP_IPHONE_58', locale: 'en-US', screenshots: [img('p61', 1170, 2532)] },
      { displayType: 'APP_IPAD_PRO_3GEN_129', locale: 'en-US', screenshots: [img('ipad', 2064, 2752)] },
      { displayType: 'APP_DESKTOP', locale: 'en-US', screenshots: [img('mac', 2880, 1800)] },
    ], 'en-US')
    const byType = Object.fromEntries(plan.sets.map(s => [s.displayType, s.base[0].checksum]))
    expect(byType).toEqual({ APP_IPHONE_63: 'p63', APP_IPHONE_61: 'p61', APP_IPAD_PRO_13: 'ipad' })
    expect(plan.unsupported).toEqual(['APP_DESKTOP'])
  })

  it('maps a lone legacy 6.1" set (1179×2556) back to our 6.1"', () => {
    const plan = planScreenshotPull([
      { displayType: 'APP_IPHONE_61', locale: 'en-US', screenshots: [img('old61', 1179, 2556)] },
    ], 'en-US')
    expect(plan.sets[0].displayType).toBe('APP_IPHONE_61')
  })
})
