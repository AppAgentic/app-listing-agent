const SENSITIVE_FIELD = /(?:error|message|warning|detail|reason|debug)/i

const GENERATION_ALLOWANCE_ERRORS = new Map([
  ['This feature requires a paid plan. Upgrade to Pro to unlock icon generation.', 'Insufficient icon generation allowance. This request did not start generation or consume credits.'],
  ['This feature requires a paid plan. Upgrade to Pro to unlock screenshot generation.', 'Insufficient screenshot generation allowance. This request did not start generation or consume credits.'],
])

export function redactSensitiveMCPText(value: string): string {
  return value
    .replace(/-----BEGIN (?:[A-Z0-9]+ )?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z0-9]+ )?PRIVATE KEY-----/g, '[redacted-private-key]')
    .replace(/\basc_(?:live|test|admin)_[A-Za-z0-9_-]{8,}\b/g, '[redacted-api-key]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[redacted-token]')
    .replace(/([?&](?:api_?key|token|secret|password|signature|x-goog-signature|x-amz-signature)=)[^&\s]+/gi, '$1[redacted]')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[redacted-email]')
    .slice(0, 2_000)
}

export function sanitizeMCPPublicOutput(value: unknown, key = ''): unknown {
  if (typeof value === 'string') {
    return SENSITIVE_FIELD.test(key) ? redactSensitiveMCPText(value) : value
  }
  if (Array.isArray(value)) return value.map(entry => sanitizeMCPPublicOutput(entry, key))
  if (!value || typeof value !== 'object') return value
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) return value

  const record = value as Record<string, unknown>
  // These exact responses originate before generation, when reserveUsage denies
  // the request. Keep website billing unchanged; MCP reports allowance only.
  const allowanceError = record.success === false && record.requiresUpgrade === true &&
    typeof record.error === 'string' ? GENERATION_ALLOWANCE_ERRORS.get(record.error) : undefined
  const publicRecord = allowanceError
    ? Object.fromEntries(Object.entries({ ...record, error: allowanceError })
      .filter(([field]) => !['requiresUpgrade', 'upgradeUrl', 'checkoutUrl', 'purchaseUrl'].includes(field)))
    : record

  return Object.fromEntries(
    Object.entries(publicRecord)
      .map(([childKey, child]) => [childKey, sanitizeMCPPublicOutput(child, childKey)])
  )
}
