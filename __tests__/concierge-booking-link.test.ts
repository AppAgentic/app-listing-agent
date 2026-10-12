import { describe, expect, it, vi } from 'vitest'
import { createConciergeSessionId } from '@/components/concierge/booking-link'

describe('concierge session identifiers', () => {
  it('creates an identifier when randomUUID is unavailable on an HTTP preview', () => {
    const originalRandomUUID = globalThis.crypto.randomUUID
    vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation(array => {
      const bytes = array as Uint8Array
      bytes.fill(10)
      return array
    })
    Object.defineProperty(globalThis.crypto, 'randomUUID', { configurable: true, value: undefined })

    expect(createConciergeSessionId()).toBe('0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a')

    Object.defineProperty(globalThis.crypto, 'randomUUID', { configurable: true, value: originalRandomUUID })
    vi.restoreAllMocks()
  })
})
