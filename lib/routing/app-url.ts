/**
 * Public origin of this deployment. Our hosted cloud is https://applistingagent.com; a self-hosted
 * install sets `NEXT_PUBLIC_APP_URL` to its own URL. Falls back to the hosted origin so production
 * behaviour is unchanged when the variable is missing or malformed.
 *
 * Marketing, SEO and docs pages deliberately keep the hosted constant (`lib/seo/site.ts`).
 */
export const HOSTED_APP_ORIGIN = 'https://applistingagent.com'

export function appOrigin(env: Record<string, string | undefined> = process.env): string {
  const raw = env.NEXT_PUBLIC_APP_URL?.trim()
  if (raw) {
    try {
      return new URL(raw).origin
    } catch {
      // fall through to the hosted origin
    }
  }
  return HOSTED_APP_ORIGIN
}

/** Absolute URL on this deployment, e.g. `appUrl('/api/mcp')`. */
export function appUrl(path = '/', env: Record<string, string | undefined> = process.env): string {
  return `${appOrigin(env)}${path.startsWith('/') ? path : `/${path}`}`
}
