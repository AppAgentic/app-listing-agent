import { NextRequest } from 'next/server'
import { getClientIp } from './client-ip'
import { createHash } from 'node:crypto'
import { Timestamp } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'

export interface RateLimitConfig {
  windowMs: number  // Time window in milliseconds
  maxRequests: number  // Max requests per window
}

// Default rate limit configurations by endpoint type
export const RATE_LIMIT_CONFIGS = {
  // Standard API endpoints
  default: { windowMs: 60000, maxRequests: 100 },
  // Auth-related endpoints (stricter)
  auth: { windowMs: 60000, maxRequests: 10 },
  // Expensive operations (metadata, screenshots)
  expensive: { windowMs: 60000, maxRequests: 20 },
  // AI operations (icons, screenshots) - more restrictive
  ai: { windowMs: 60000, maxRequests: 10 },
  // Webhook endpoints (higher limit)
  webhook: { windowMs: 60000, maxRequests: 200 },
} as const

// Alias for backward compatibility
export const RATE_LIMITS = RATE_LIMIT_CONFIGS

export interface RateLimitResult {
  allowed: boolean
  remaining: number
  resetAt: number
  retryAfter?: number
}

const testRateLimitStore = new Map<string, { count: number; resetAt: number }>()

function checkTestRateLimit(identifier: string, config: RateLimitConfig, now: number): RateLimitResult {
  const key = `${identifier}:${config.windowMs}:${config.maxRequests}`
  const entry = testRateLimitStore.get(key)
  if (!entry || entry.resetAt <= now) {
    const resetAt = now + config.windowMs
    testRateLimitStore.set(key, { count: 1, resetAt })
    return { allowed: true, remaining: config.maxRequests - 1, resetAt }
  }
  if (entry.count < config.maxRequests) {
    entry.count += 1
    return { allowed: true, remaining: config.maxRequests - entry.count, resetAt: entry.resetAt }
  }
  return {
    allowed: false,
    remaining: 0,
    resetAt: entry.resetAt,
    retryAfter: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)),
  }
}

/**
 * Check rate limit for a given identifier
 */
export async function checkRateLimit(
  identifier: string,
  config: RateLimitConfig = RATE_LIMIT_CONFIGS.default
): Promise<RateLimitResult> {
  const now = Date.now()
  if (process.env.NODE_ENV === 'test') return checkTestRateLimit(identifier, config, now)
  const documentId = createHash('sha256')
    .update(`${identifier}:${config.windowMs}:${config.maxRequests}`)
    .digest('hex')
  const entryRef = adminDb.collection('_rateLimits').doc(documentId)

  return adminDb.runTransaction(async transaction => {
    const snapshot = await transaction.get(entryRef)
    const data = snapshot.data()
    const storedResetAt = data?.resetAt instanceof Timestamp
      ? data.resetAt.toMillis()
      : Number(data?.resetAt || 0)
    const currentCount = Number(data?.count || 0)

    if (!snapshot.exists || storedResetAt <= now) {
      const resetAt = now + config.windowMs
      transaction.set(entryRef, {
        count: 1,
        resetAt: Timestamp.fromMillis(resetAt),
        expiresAt: Timestamp.fromMillis(resetAt + 24 * 60 * 60 * 1000),
        updatedAt: Timestamp.now(),
      })
      return { allowed: true, remaining: config.maxRequests - 1, resetAt }
    }

    if (currentCount < config.maxRequests) {
      const count = currentCount + 1
      transaction.update(entryRef, { count, updatedAt: Timestamp.now() })
      return { allowed: true, remaining: config.maxRequests - count, resetAt: storedResetAt }
    }

    return {
      allowed: false,
      remaining: 0,
      resetAt: storedResetAt,
      retryAfter: Math.max(1, Math.ceil((storedResetAt - now) / 1000)),
    }
  })
}

/**
 * Create rate limit identifier from request
 */
export function getRateLimitIdentifier(
  request: NextRequest,
  context?: { userId?: string },
  namespace = 'default'
): string {
  // Prefer user ID for authenticated requests
  if (context?.userId) {
    return `${namespace}:user:${context.userId}`
  }

  // Fall back to IP address
  return `${namespace}:ip:${getClientIp(request)}`
}

/**
 * Create rate-limited response
 */
export function rateLimitResponse(result: RateLimitResult): Response {
  return new Response(
    JSON.stringify({
      error: 'Too many requests',
      retryAfter: result.retryAfter
    }),
    {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        'Retry-After': String(result.retryAfter || 60),
        'X-RateLimit-Remaining': String(result.remaining),
        'X-RateLimit-Reset': String(Math.ceil(result.resetAt / 1000))
      }
    }
  )
}

/**
 * Add rate limit headers to response
 */
export function addRateLimitHeaders(response: Response, result: RateLimitResult): Response {
  const headers = new Headers(response.headers)
  headers.set('X-RateLimit-Remaining', String(result.remaining))
  headers.set('X-RateLimit-Reset', String(Math.ceil(result.resetAt / 1000)))

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  })
}

/**
 * Convenience function: check rate limit and return response if limited
 */
export async function withRateLimit(
  request: NextRequest,
  config: RateLimitConfig = RATE_LIMIT_CONFIGS.default,
  context?: { userId?: string },
  namespace = 'default'
): Promise<RateLimitResult & { response?: Response }> {
  const identifier = getRateLimitIdentifier(request, context, namespace)
  const result = await checkRateLimit(identifier, config)

  if (!result.allowed) {
    return { ...result, response: rateLimitResponse(result) }
  }

  return result
}

/**
 * Simple rate limit check (async wrapper for consistency with API routes)
 * Returns { success: boolean } for simpler usage
 */
export async function rateLimit(
  request: NextRequest,
  config: RateLimitConfig = RATE_LIMIT_CONFIGS.default,
  context?: { userId?: string }
): Promise<{ success: boolean; remaining: number; resetAt: number }> {
  const identifier = getRateLimitIdentifier(request, context)
  const result = await checkRateLimit(identifier, config)

  return {
    success: result.allowed,
    remaining: result.remaining,
    resetAt: result.resetAt
  }
}
