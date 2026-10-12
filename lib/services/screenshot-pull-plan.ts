// Turns screenshot sets read back from App Store Connect (one per locale × set
// type) into our storage model: one base set per device type in the primary
// locale, plus per-locale overrides in localizedScreenshots wherever another
// locale shows a different image at the same position.
import type { PulledScreenshotSet } from './appstore'

type PulledImage = PulledScreenshotSet['screenshots'][number]

// App Store set type → our device type. Where one App Store slot can hold two of
// our device types (see asc-screenshot-slots.ts), the image size decides.
function internalDisplayType(ascDisplayType: string, width: number, height: number): string | null {
  const size = `${Math.min(width, height)}x${Math.max(width, height)}`
  switch (ascDisplayType) {
    case 'APP_IPHONE_67': return 'APP_IPHONE_69'
    case 'APP_IPHONE_65': return 'APP_IPHONE_65'
    case 'APP_IPHONE_61': return size === '1206x2622' ? 'APP_IPHONE_63' : 'APP_IPHONE_61'
    case 'APP_IPHONE_58': return 'APP_IPHONE_61'
    case 'APP_IPHONE_55': return 'APP_IPHONE_55'
    case 'APP_IPAD_PRO_3GEN_129': return 'APP_IPAD_PRO_13'
    case 'APP_IPAD_PRO_129': return 'APP_IPAD_PRO_129'
    case 'APP_IPAD_PRO_3GEN_11':
    case 'APP_IPAD_PRO_11': return 'APP_IPAD_PRO_11'
    case 'APP_WATCH_ULTRA_3':
    case 'APP_WATCH_ULTRA':
    case 'APP_WATCH_SERIES_10':
    case 'APP_WATCH_SERIES_7':
    case 'APP_WATCH_SERIES_4':
    case 'APP_WATCH_SERIES_3':
      return ascDisplayType
    default:
      return null
  }
}

// When two App Store sets land on the same device type in one locale, keep the
// one whose display class matches that device natively.
const ASC_PRECEDENCE = ['APP_IPHONE_58', 'APP_IPHONE_61', 'APP_IPAD_PRO_3GEN_11', 'APP_IPAD_PRO_11']

export interface PulledDeviceSet {
  displayType: string
  /** Locale the base set comes from (the primary locale when it has this device). */
  baseLocale: string
  base: PulledImage[]
  /** Other locales' images that differ from the base at the same position. */
  localized: Array<{ locale: string; index: number; image: PulledImage }>
  /** Images in other locales beyond the base set's length (no position to attach to). */
  extraImagesDropped: number
}

export interface PullPlan {
  sets: PulledDeviceSet[]
  /** App Store set types we don't support (e.g. Mac, Apple TV). */
  unsupported: string[]
}

function sameImage(a: PulledImage, b: PulledImage): boolean {
  if (a.checksum && b.checksum) return a.checksum === b.checksum
  return a.url === b.url
}

export function planScreenshotPull(pulled: PulledScreenshotSet[], primaryLocale: string | null | undefined): PullPlan {
  const unsupported = new Set<string>()
  // device type → locale → { asc type, images }
  const byDevice = new Map<string, Map<string, { ascDisplayType: string; images: PulledImage[] }>>()

  for (const set of pulled) {
    if (set.screenshots.length === 0) continue
    const first = set.screenshots[0]
    const displayType = internalDisplayType(set.displayType, first.width, first.height)
    if (!displayType) {
      unsupported.add(set.displayType)
      continue
    }
    const locales = byDevice.get(displayType) ?? new Map()
    byDevice.set(displayType, locales)
    const existing = locales.get(set.locale)
    const rank = (t: string) => {
      const i = ASC_PRECEDENCE.indexOf(t)
      return i === -1 ? ASC_PRECEDENCE.length : i
    }
    if (!existing || rank(set.displayType) < rank(existing.ascDisplayType)) {
      locales.set(set.locale, { ascDisplayType: set.displayType, images: set.screenshots })
    }
  }

  const sets: PulledDeviceSet[] = []
  for (const [displayType, locales] of byDevice) {
    const sortedLocales = [...locales.keys()].sort()
    const baseLocale = primaryLocale && locales.has(primaryLocale)
      ? primaryLocale
      : locales.has('en-US') ? 'en-US' : sortedLocales[0]
    const base = locales.get(baseLocale)!.images
    const localized: PulledDeviceSet['localized'] = []
    let extraImagesDropped = 0

    for (const locale of sortedLocales) {
      if (locale === baseLocale) continue
      const images = locales.get(locale)!.images
      images.forEach((image, index) => {
        if (index >= base.length) {
          extraImagesDropped++
        } else if (!sameImage(image, base[index])) {
          localized.push({ locale, index, image })
        }
      })
    }
    sets.push({ displayType, baseLocale, base, localized, extraImagesDropped })
  }

  return { sets, unsupported: [...unsupported] }
}
