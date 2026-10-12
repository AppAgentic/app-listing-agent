import { describe, expect, it } from 'vitest'
import { decodeImageDataUrl, isAcceptableReference } from '@/lib/services/icon-engine'

const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

describe('icon reference inputs', () => {
  it('accepts base64 image data URLs from the annotation canvas and uploads', () => {
    const ref = `data:image/png;base64,${PNG_1PX}`
    expect(isAcceptableReference(ref)).toBe(true)
    expect(decodeImageDataUrl(ref)?.length).toBeGreaterThan(0)
    expect(isAcceptableReference(`data:image/jpeg;base64,${PNG_1PX}`)).toBe(true)
  })

  it('rejects non-image and malformed data URLs', () => {
    expect(isAcceptableReference(`data:text/html;base64,${PNG_1PX}`)).toBe(false)
    expect(isAcceptableReference('data:image/png;base64,')).toBe(false)
    expect(isAcceptableReference('data:image/svg+xml;base64,PHN2Zz4=')).toBe(false)
  })

  it('rejects oversized data URLs before decoding', () => {
    const huge = `data:image/png;base64,${'A'.repeat(28 * 1024 * 1024)}`
    expect(decodeImageDataUrl(huge)).toBeNull()
  })

  it('rejects plain http and unknown hosts', () => {
    expect(isAcceptableReference('http://example.com/a.png')).toBe(false)
    expect(isAcceptableReference('https://169.254.169.254/latest')).toBe(false)
  })
})
