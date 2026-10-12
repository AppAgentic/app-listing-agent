import { describe, expect, it } from 'vitest'
import { APPSTORE_LOCALES, IOS_TO_ANDROID_LOCALE_MAP, LOCALE_FLAGS, LOCALE_NAMES, PLAYSTORE_LOCALES } from '@/lib/constants'

// Apple's locale shortcode table ("Managing metadata in your app by using locale
// shortcodes", App Store Connect API 4.3.1+), checked 2026-10-07.
const APPLE_LOCALES = [
  'ar-SA', 'bn-BD', 'ca', 'zh-Hans', 'zh-Hant', 'hr', 'cs', 'da', 'nl-NL', 'en-AU', 'en-CA', 'en-GB', 'en-US',
  'fi', 'fr-FR', 'fr-CA', 'de-DE', 'el', 'gu-IN', 'he', 'hi', 'hu', 'id', 'it', 'ja', 'kn-IN', 'ko', 'ms',
  'ml-IN', 'mr-IN', 'no', 'or-IN', 'pl', 'pt-BR', 'pt-PT', 'pa-IN', 'ro', 'ru', 'sk', 'sl-SI', 'es-MX',
  'es-ES', 'sv', 'ta-IN', 'te-IN', 'th', 'tr', 'uk', 'ur-PK', 'vi',
]

describe('App Store locales', () => {
  it("match Apple's 50 locale shortcodes", () => {
    expect([...APPSTORE_LOCALES].sort()).toEqual([...APPLE_LOCALES].sort())
  })

  it('every App Store locale has a name and a flag', () => {
    for (const locale of APPSTORE_LOCALES) {
      expect(LOCALE_NAMES[locale], locale).toBeTruthy()
      expect(LOCALE_FLAGS[locale], locale).toBeTruthy()
    }
  })

  it('maps to real Play locales where Play has the language', () => {
    for (const [ios, play] of Object.entries(IOS_TO_ANDROID_LOCALE_MAP)) {
      expect(APPSTORE_LOCALES as readonly string[], ios).toContain(ios)
      expect(PLAYSTORE_LOCALES as readonly string[], `${ios} → ${play}`).toContain(play)
    }
  })
})
