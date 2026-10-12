/**
 * SSRF Protection utilities
 * Validates URLs to prevent Server-Side Request Forgery attacks
 */

// Get R2 public URL domain from environment
const R2_PUBLIC_DOMAIN = (() => {
  const url = process.env.R2_PUBLIC_URL
  if (!url) return null
  try {
    return new URL(url).hostname
  } catch {
    return null
  }
})()

// Base allowed domains for image fetching
const BASE_ALLOWED_DOMAINS: string[] = [
  // App Store CDN
  'is1-ssl.mzstatic.com',
  'is2-ssl.mzstatic.com',
  'is3-ssl.mzstatic.com',
  'is4-ssl.mzstatic.com',
  'is5-ssl.mzstatic.com',
  // Google Play Store
  'play-lh.googleusercontent.com',
  // Firebase Storage
  'firebasestorage.googleapis.com',
  'storage.googleapis.com',
  // Cloudflare R2 - storage domains (matches {account_id}.r2.cloudflarestorage.com)
  'r2.cloudflarestorage.com',
  // Cloudflare R2 - public dev URLs (matches {bucket}.{id}.r2.dev)
  'r2.dev',
]

// Add R2 public URL domain from environment if configured
export const ALLOWED_IMAGE_DOMAINS: readonly string[] = R2_PUBLIC_DOMAIN
  ? [...BASE_ALLOWED_DOMAINS, R2_PUBLIC_DOMAIN]
  : BASE_ALLOWED_DOMAINS

/**
 * Check if a URL is from an allowed image domain
 * Prevents SSRF by only allowing known, trusted domains
 */
export function isAllowedImageUrl(url: string): boolean {
  try {
    const parsed = new URL(url)

    // Only allow HTTPS
    if (parsed.protocol !== 'https:') {
      return false
    }

    return ALLOWED_IMAGE_DOMAINS.some(domain =>
      parsed.hostname === domain || parsed.hostname.endsWith('.' + domain)
    )
  } catch {
    return false
  }
}

/**
 * Validate a URL for safe fetching
 * Returns the validated URL or throws an error
 */
export function validateSafeUrl(url: string, allowedDomains: readonly string[] = ALLOWED_IMAGE_DOMAINS): string {
  try {
    const parsed = new URL(url)

    // Block dangerous protocols
    if (!['https:', 'http:'].includes(parsed.protocol)) {
      throw new Error('URL must use HTTP or HTTPS protocol')
    }

    // Block internal IPs
    const hostname = parsed.hostname.toLowerCase()
    if (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname.startsWith('192.168.') ||
      hostname.startsWith('10.') ||
      hostname.startsWith('172.') ||
      hostname === '169.254.169.254' || // AWS metadata
      hostname.endsWith('.local') ||
      hostname.endsWith('.internal')
    ) {
      throw new Error('URL points to internal/private address')
    }

    // Check if domain is allowed
    const isAllowed = allowedDomains.some(domain =>
      parsed.hostname === domain || parsed.hostname.endsWith('.' + domain)
    )

    if (!isAllowed) {
      throw new Error('URL domain is not in the allowed list')
    }

    return url
  } catch (error) {
    if (error instanceof Error && error.message.includes('URL')) {
      throw error
    }
    throw new Error('Invalid URL format')
  }
}
