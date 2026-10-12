import crypto from 'crypto'

/**
 * Verify admin API key using timing-safe comparison.
 * Key format: asc_admin_XXXXX
 * Compared against ASC_ADMIN_KEY env var.
 */
export function verifyAdminApiKey(apiKey: string): boolean {
  const expected = process.env.ASC_ADMIN_KEY
  if (!expected) {
    console.error('[admin-mcp] ASC_ADMIN_KEY environment variable is not set')
    return false
  }

  if (!apiKey.startsWith('asc_admin_')) {
    return false
  }

  // Timing-safe comparison to prevent timing attacks
  const keyBuffer = Buffer.from(apiKey)
  const expectedBuffer = Buffer.from(expected)

  if (keyBuffer.length !== expectedBuffer.length) {
    return false
  }

  return crypto.timingSafeEqual(keyBuffer, expectedBuffer)
}

/**
 * Generate a new admin API key.
 * Call this once to create the key, then store it as ASC_ADMIN_KEY.
 */
export function generateAdminApiKey(): string {
  const randomPart = crypto.randomBytes(32).toString('hex')
  return `asc_admin_${randomPart}`
}
