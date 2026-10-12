const isDevelopment = process.env.NODE_ENV === 'development'

/** Our hosted R2 custom domain. Always allowed, so the hosted CSP never depends on env. */
export const DEFAULT_R2_ASSET_ORIGIN = 'https://screens.appstorecopilot.com'

/**
 * Asset origins for img-src / media-src: the hosted R2 domain plus the origin of `R2_PUBLIC_URL`
 * when it is a valid https URL (a self-hosted bucket's public domain). Invalid values are ignored.
 */
export function r2AssetOrigins(env: Record<string, string | undefined> = process.env): string[] {
  const origins = [DEFAULT_R2_ASSET_ORIGIN]
  const raw = env.R2_PUBLIC_URL?.trim()
  if (raw) {
    try {
      const url = new URL(raw)
      if (url.protocol === 'https:' && !url.username && !url.password && !origins.includes(url.origin)) {
        origins.push(url.origin)
      }
    } catch {
      // ignore a malformed value
    }
  }
  return origins
}

export const buildContentSecurityPolicy = (
  development: boolean,
  env: Record<string, string | undefined> = process.env,
) => {
  const assets = r2AssetOrigins(env).join(' ')
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${development ? " 'unsafe-eval'" : ''} https://www.clarity.ms https://*.clarity.ms`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: ${assets} https://*.r2.cloudflarestorage.com https://*.r2.dev https://is1-ssl.mzstatic.com https://is2-ssl.mzstatic.com https://is3-ssl.mzstatic.com https://is4-ssl.mzstatic.com https://is5-ssl.mzstatic.com https://play-lh.googleusercontent.com https://www.gstatic.com https://*.gleap.io https://*.clarity.ms https://c.bing.com`,
    "font-src 'self' data:",
    `media-src 'self' ${assets}`,
    "connect-src 'self' https://*.googleapis.com https://*.firebaseio.com wss://*.firebaseio.com https://*.gleap.io wss://*.gleap.io https://*.clarity.ms https://c.bing.com",
    "frame-src 'self' https://*.firebaseapp.com https://accounts.google.com https://messenger-app.gleap.io https://outboundmedia.gleap.io",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'",
    ...(development ? [] : ["upgrade-insecure-requests"]),
  ].join('; ')
}

export const contentSecurityPolicy = buildContentSecurityPolicy(isDevelopment)

export const securityHeaders = [
  { key: 'Content-Security-Policy', value: contentSecurityPolicy },
  { key: 'X-DNS-Prefetch-Control', value: 'on' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
]
