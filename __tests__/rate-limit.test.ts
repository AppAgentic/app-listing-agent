import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  checkRateLimit,
  RATE_LIMIT_CONFIGS,
  rateLimitResponse
} from '@/lib/api/rate-limit'

describe('Rate Limiting', () => {
  beforeEach(() => {
    // Reset the rate limit store between tests by advancing time
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('checkRateLimit', () => {
    it('should allow first request', async () => {
      const result = await checkRateLimit('test-user-1', { windowMs: 60000, maxRequests: 10 })

      expect(result.allowed).toBe(true)
      expect(result.remaining).toBe(9)
    })

    it('should decrement remaining count on each request', async () => {
      const identifier = 'test-user-2'
      const config = { windowMs: 60000, maxRequests: 5 }

      const result1 = await checkRateLimit(identifier, config)
      expect(result1.remaining).toBe(4)

      const result2 = await checkRateLimit(identifier, config)
      expect(result2.remaining).toBe(3)

      const result3 = await checkRateLimit(identifier, config)
      expect(result3.remaining).toBe(2)
    })

    it('should block requests when limit is reached', async () => {
      const identifier = 'test-user-3'
      const config = { windowMs: 60000, maxRequests: 3 }

      // Use up all requests
      await checkRateLimit(identifier, config)
      await checkRateLimit(identifier, config)
      await checkRateLimit(identifier, config)

      // 4th request should be blocked
      const result = await checkRateLimit(identifier, config)

      expect(result.allowed).toBe(false)
      expect(result.remaining).toBe(0)
      expect(result.retryAfter).toBeDefined()
    })

    it('should reset after window expires', async () => {
      const identifier = 'test-user-4'
      const config = { windowMs: 1000, maxRequests: 2 }

      // Use up all requests
      await checkRateLimit(identifier, config)
      await checkRateLimit(identifier, config)

      const blockedResult = await checkRateLimit(identifier, config)
      expect(blockedResult.allowed).toBe(false)

      // Advance time past the window
      vi.advanceTimersByTime(1500)

      // Should be allowed again
      const result = await checkRateLimit(identifier, config)
      expect(result.allowed).toBe(true)
      expect(result.remaining).toBe(1)
    })

    it('should use default config when not specified', async () => {
      const result = await checkRateLimit('test-user-5')

      expect(result.allowed).toBe(true)
      // Default is 100 requests per minute
      expect(result.remaining).toBe(RATE_LIMIT_CONFIGS.default.maxRequests - 1)
    })

    it('should track different identifiers separately', async () => {
      const config = { windowMs: 60000, maxRequests: 2 }

      // User A uses their limit
      await checkRateLimit('user-a', config)
      await checkRateLimit('user-a', config)
      const userAResult = await checkRateLimit('user-a', config)
      expect(userAResult.allowed).toBe(false)

      // User B should still have their quota
      const userBResult = await checkRateLimit('user-b', config)
      expect(userBResult.allowed).toBe(true)
      expect(userBResult.remaining).toBe(1)
    })
  })

  describe('rateLimitResponse', () => {
    it('should return 429 status', () => {
      const result = {
        allowed: false,
        remaining: 0,
        resetAt: Date.now() + 60000,
        retryAfter: 60
      }

      const response = rateLimitResponse(result)

      expect(response.status).toBe(429)
    })

    it('should include rate limit headers', () => {
      const result = {
        allowed: false,
        remaining: 0,
        resetAt: Date.now() + 30000,
        retryAfter: 30
      }

      const response = rateLimitResponse(result)

      expect(response.headers.get('Retry-After')).toBe('30')
      expect(response.headers.get('X-RateLimit-Remaining')).toBe('0')
    })
  })

  describe('RATE_LIMIT_CONFIGS', () => {
    it('should have stricter limits for auth endpoints', () => {
      expect(RATE_LIMIT_CONFIGS.auth.maxRequests).toBeLessThan(
        RATE_LIMIT_CONFIGS.default.maxRequests
      )
    })

    it('should have higher limits for webhooks', () => {
      expect(RATE_LIMIT_CONFIGS.webhook.maxRequests).toBeGreaterThan(
        RATE_LIMIT_CONFIGS.default.maxRequests
      )
    })
  })
})
