import { describe, expect, it, vi } from 'vitest'
import { APPSTORE_SCREENSHOT_SIZES } from '@/lib/constants'
import { SCREENSHOT_DISPLAY_TYPES } from '@/lib/firebase/firestore'

vi.mock('@/lib/firebase/client', () => ({
  db: {},
}))

describe('Apple Watch screenshot display types', () => {
  const expectedWatchSizes = {
    APP_WATCH_ULTRA_3: { width: 422, height: 514, importKey: 'watch-ultra-3' },
    APP_WATCH_ULTRA: { width: 410, height: 502, importKey: 'watch-ultra' },
    APP_WATCH_SERIES_10: { width: 416, height: 496, importKey: 'watch-10' },
    APP_WATCH_SERIES_7: { width: 396, height: 484, importKey: 'watch-7' },
    APP_WATCH_SERIES_4: { width: 368, height: 448, importKey: 'watch-4' },
    APP_WATCH_SERIES_3: { width: 312, height: 390, importKey: 'watch-3' },
  } as const

  it('matches Apple Watch App Store screenshot dimensions', () => {
    for (const [displayType, expected] of Object.entries(expectedWatchSizes)) {
      expect(SCREENSHOT_DISPLAY_TYPES[displayType as keyof typeof expectedWatchSizes]).toMatchObject({
        width: expected.width,
        height: expected.height,
      })
    }
  })

  it('exposes Apple Watch import sizes for MCP and manual imports', () => {
    for (const expected of Object.values(expectedWatchSizes)) {
      expect(APPSTORE_SCREENSHOT_SIZES[expected.importKey]).toMatchObject({
        width: expected.width,
        height: expected.height,
      })
    }
  })

  it('marks Series 10/11 as the required Apple Watch target with fallbacks', () => {
    expect(SCREENSHOT_DISPLAY_TYPES.APP_WATCH_SERIES_10).toMatchObject({
      requirement: 'required',
    })
    expect(SCREENSHOT_DISPLAY_TYPES.APP_WATCH_SERIES_7).toMatchObject({
      requirement: 'fallback',
      fallbackFor: 'APP_WATCH_SERIES_10',
    })
    expect(SCREENSHOT_DISPLAY_TYPES.APP_WATCH_SERIES_4).toMatchObject({
      requirement: 'fallback',
      fallbackFor: 'APP_WATCH_SERIES_10',
    })
  })
})
