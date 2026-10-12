import type { NextRequest } from 'next/server'

/**
 * Client IP for rate limiting and logging.
 *
 * Firebase App Hosting sets `x-fah-client-ip` itself, so it is preferred. The left-most
 * `x-forwarded-for` value is whatever the client sent (verified on the live site 2026-09-25:
 * a spoofed value bypassed per-IP limits), so it is only a fallback for local dev and other hosts.
 */
export function getClientIp(request: NextRequest): string {
  return (
    request.headers.get('x-fah-client-ip')?.trim() ||
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown'
  )
}
