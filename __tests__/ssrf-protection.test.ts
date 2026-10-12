import { describe, it, expect } from 'vitest'
import { z } from 'zod'

// Recreate the SSRF protection logic for testing
const ALLOWED_IMAGE_DOMAINS = [
  'is1-ssl.mzstatic.com',
  'is2-ssl.mzstatic.com',
  'is3-ssl.mzstatic.com',
  'is4-ssl.mzstatic.com',
  'is5-ssl.mzstatic.com',
  'play-lh.googleusercontent.com',
  'firebasestorage.googleapis.com',
  'storage.googleapis.com',
  'example-bucket.r2.cloudflarestorage.com',
]

function isAllowedImageUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return ALLOWED_IMAGE_DOMAINS.some(domain =>
      parsed.hostname === domain || parsed.hostname.endsWith('.' + domain)
    )
  } catch {
    return false
  }
}

const safeImageUrl = z.string().url().refine(isAllowedImageUrl, {
  message: 'Image URL must be from an allowed domain'
})

describe('SSRF Protection', () => {
  describe('isAllowedImageUrl', () => {
    it('should allow App Store CDN URLs', () => {
      expect(isAllowedImageUrl('https://is1-ssl.mzstatic.com/image/thumb/some-image.jpg')).toBe(true)
      expect(isAllowedImageUrl('https://is3-ssl.mzstatic.com/image/thumb/another.png')).toBe(true)
    })

    it('should allow Google Play Store URLs', () => {
      expect(isAllowedImageUrl('https://play-lh.googleusercontent.com/some-image')).toBe(true)
    })

    it('should allow Firebase Storage URLs', () => {
      expect(isAllowedImageUrl('https://firebasestorage.googleapis.com/v0/b/bucket/image.jpg')).toBe(true)
    })

    it('should allow R2 Storage URLs', () => {
      expect(isAllowedImageUrl('https://example-bucket.r2.cloudflarestorage.com/image.png')).toBe(true)
    })

    it('should block arbitrary URLs (SSRF protection)', () => {
      expect(isAllowedImageUrl('https://evil.com/image.jpg')).toBe(false)
      expect(isAllowedImageUrl('https://internal-server.local/admin')).toBe(false)
      expect(isAllowedImageUrl('http://169.254.169.254/latest/meta-data/')).toBe(false)
      expect(isAllowedImageUrl('http://localhost:3000/api/secret')).toBe(false)
    })

    it('should block file:// protocol', () => {
      expect(isAllowedImageUrl('file:///etc/passwd')).toBe(false)
    })

    it('should handle invalid URLs', () => {
      expect(isAllowedImageUrl('not-a-url')).toBe(false)
      expect(isAllowedImageUrl('')).toBe(false)
    })

    it('should not be fooled by subdomain attacks', () => {
      // Attacker trying to use allowed domain as subdomain
      expect(isAllowedImageUrl('https://is1-ssl.mzstatic.com.evil.com/image.jpg')).toBe(false)
    })

    it('should allow subdomains of allowed domains', () => {
      expect(isAllowedImageUrl('https://sub.firebasestorage.googleapis.com/image.jpg')).toBe(true)
    })
  })

  describe('safeImageUrl schema', () => {
    it('should validate allowed URLs', () => {
      const result = safeImageUrl.safeParse('https://is1-ssl.mzstatic.com/image.jpg')
      expect(result.success).toBe(true)
    })

    it('should reject disallowed URLs', () => {
      const result = safeImageUrl.safeParse('https://evil.com/image.jpg')
      expect(result.success).toBe(false)
    })

    it('should reject non-URL strings', () => {
      const result = safeImageUrl.safeParse('not-a-url')
      expect(result.success).toBe(false)
    })
  })
})
