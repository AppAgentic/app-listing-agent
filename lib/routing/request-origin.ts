import { appOrigin } from './app-url'

type Env = Record<string, string | undefined>

/**
 * CSRF check for cookie-authenticated state changes (POST/PATCH/DELETE) from our own pages.
 *
 * The browser's `Origin` must exactly match this deployment's public origin (`appOrigin()`:
 * NEXT_PUBLIC_APP_URL, else https://applistingagent.com). Do not compare with
 * `request.nextUrl.origin`: behind Firebase App Hosting / Cloud Run that is the internal origin,
 * so the owner's own requests were refused with "Invalid origin" (16 Oct 2026).
 *
 * - Legacy and www hosts are not allowed: the proxy 308s every request on them to the canonical
 *   host, so no page we serve can post from them.
 * - A missing `Origin` is refused. Every current browser sends it on fetch() POST/DELETE, so only
 *   non-browser clients omit it, and those should use bearer-token APIs instead.
 * - X-Forwarded-Host is never consulted.
 * - Outside production the request's own origin is also accepted, for `next dev` on any port.
 */
export function isTrustedAppOrigin(
  request: { headers: Headers; nextUrl?: { origin: string } },
  env: Env = process.env
): boolean {
  const origin = request.headers.get('origin')
  // "null" is what sandboxed iframes and file:/data: pages send; never trust it.
  if (!origin || origin === 'null') return false
  const trusted = appOrigin(env)
  // Only an http(s) public origin can be trusted; a misconfigured file:/data:/javascript: URL
  // would otherwise yield "null" (Astra review, 16 Oct 2026).
  if (/^https?:\/\/[^/]+$/.test(trusted) && origin === trusted) return true
  return (
    env.NODE_ENV !== 'production' &&
    !!request.nextUrl &&
    /^https?:\/\//.test(request.nextUrl.origin) &&
    origin === request.nextUrl.origin
  )
}
