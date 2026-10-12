import { afterEach, describe, expect, it, vi } from 'vitest'
import { TranslationHelper } from '@/lib/services/translator'

// Exercise field selection, cache reuse and length enforcement without a paid provider call.
describe('App Store promotional text translation', () => {
  afterEach(() => vi.restoreAllMocks())

  it('translates promotional copy alongside release notes and reuses its cache', async () => {
    const helper = new TranslationHelper()
    const generate = vi.spyOn(helper as any, 'generateText')
      .mockResolvedValueOnce('Première version.')
      .mockResolvedValueOnce('Faites-vous une petite promesse aujourd’hui.')
    const source = { whatsNew: 'Initial release.', promotionalText: 'Make one small promise to yourself today.' }
    const results = await helper.translateAll(source, 'fr-FR', 'appstore')
    expect(results.map(result => result.field)).toEqual(['whatsNew', 'promotionalText'])
    const promo = results[1]
    expect(promo.translatedText).toBe('Faites-vous une petite promesse aujourd’hui.')
    expect(generate.mock.calls[1][0]).toContain('170')
    const cached = await helper.translateAll({ promotionalText: source.promotionalText }, 'fr-FR', 'appstore', {
      promotionalText: { translatedText: promo.translatedText, sourceHash: promo.sourceHash },
    })
    expect(cached[0]).toMatchObject({ field: 'promotionalText', cached: true, translatedText: promo.translatedText })
    expect(generate).toHaveBeenCalledTimes(2)
  })

  it('shortens promotional copy at its 170 character limit', async () => {
    const helper = new TranslationHelper()
    const generate = vi.spyOn(helper as any, 'generateText')
      .mockResolvedValueOnce('x'.repeat(171))
      .mockResolvedValueOnce('Une petite habitude, chaque jour.')
    const [result] = await helper.translateAll({ promotionalText: 'A daily habit.' }, 'fr-FR', 'appstore')
    expect(generate).toHaveBeenCalledTimes(2)
    expect(result.translatedText).toBe('Une petite habitude, chaque jour.')
    expect(result.translatedText.length).toBeLessThanOrEqual(170)
  })

  it('excludes promotional copy from Play Store translation and skips empty source', async () => {
    const helper = new TranslationHelper()
    const generate = vi.spyOn(helper as any, 'generateText')
    expect(await helper.translateAll({ promotionalText: 'Apple only' }, 'fr-FR', 'playstore')).toEqual([])
    expect(await helper.translateAll({ promotionalText: '' }, 'fr-FR', 'appstore')).toEqual([])
    expect(generate).not.toHaveBeenCalled()
  })
})
