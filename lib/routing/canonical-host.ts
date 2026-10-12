// The product moved from appstorecopilot.com to applistingagent.com (2026-09-23).
// Every request to a legacy or www host is permanently redirected to the same
// path on the canonical host. 308 keeps the method and body, so MCP POSTs and
// webhooks that still target the old host are not turned into GETs. Customer
// legal pages already pushed to App Store Connect keep resolving this way.
export const CANONICAL_HOST = 'applistingagent.com'

const REDIRECT_HOSTS = new Set([
  'appstorecopilot.com',
  'www.appstorecopilot.com',
  'www.applistingagent.com',
])

export function canonicalRedirectUrl(url: URL, forwardedHost: string | null, host: string | null): string | null {
  const requestHost = (forwardedHost?.split(',')[0] || host || '').trim().toLowerCase().replace(/:\d+$/, '')
  if (!REDIRECT_HOSTS.has(requestHost)) return null
  return `https://${CANONICAL_HOST}${url.pathname}${url.search}`
}
