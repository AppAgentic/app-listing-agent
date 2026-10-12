export const MARKETING_QUERY_KEYS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'utm_term',
  'fbclid',
  'twclid',
  'gclid',
  'oppref',
] as const

export const MARKETING_ATTRIBUTION_STORAGE_KEY = 'appstorecopilot_marketing_attribution'

export type MarketingAttribution = {
  source?: string
  medium?: string
  campaign?: string
  content?: string
  term?: string
  fbclid?: string
  twclid?: string
  gclid?: string
  oppref?: string
  landingPath?: string
  referrer?: string
  capturedAt?: string
}

const FIELD_LIMITS: Record<keyof MarketingAttribution, number> = {
  source: 100,
  medium: 100,
  campaign: 200,
  content: 200,
  term: 200,
  fbclid: 500,
  twclid: 500,
  gclid: 500,
  oppref: 500,
  landingPath: 500,
  referrer: 500,
  capturedAt: 40,
}

function clean(value: unknown, limit: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim().replace(/[\u0000-\u001f\u007f]/g, '')
  return normalized ? normalized.slice(0, limit) : undefined
}

function cleanLandingPath(value: unknown): string | undefined {
  const path = clean(value, FIELD_LIMITS.landingPath)
  if (!path || !path.startsWith('/') || path.startsWith('//')) return undefined
  return path.split(/[?#]/, 1)[0]
}

function cleanReferrer(value: unknown): string | undefined {
  const referrer = clean(value, FIELD_LIMITS.referrer)
  if (!referrer) return undefined
  try {
    const url = new URL(referrer)
    if (!['http:', 'https:'].includes(url.protocol)) return undefined
    return `${url.origin}${url.pathname}`.slice(0, FIELD_LIMITS.referrer)
  } catch {
    return undefined
  }
}

export function sanitizeMarketingAttribution(value: unknown): MarketingAttribution | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const input = value as Record<string, unknown>
  const result: MarketingAttribution = {}

  for (const field of Object.keys(FIELD_LIMITS) as Array<keyof MarketingAttribution>) {
    const sanitized = field === 'landingPath'
      ? cleanLandingPath(input[field])
      : field === 'referrer'
        ? cleanReferrer(input[field])
        : clean(input[field], FIELD_LIMITS[field])
    if (sanitized) result[field] = sanitized
  }

  return Object.keys(result).length > 0 ? result : null
}

export function attributionFromSearchParams(
  searchParams: Pick<URLSearchParams, 'get'>,
  context?: { landingPath?: string; referrer?: string; capturedAt?: string },
): MarketingAttribution | null {
  const campaignFields = {
    source: searchParams.get('utm_source'),
    medium: searchParams.get('utm_medium'),
    campaign: searchParams.get('utm_campaign'),
    content: searchParams.get('utm_content'),
    term: searchParams.get('utm_term'),
    fbclid: searchParams.get('fbclid'),
    twclid: searchParams.get('twclid'),
    gclid: searchParams.get('gclid'),
    oppref: searchParams.get('oppref'),
  }
  if (!Object.values(campaignFields).some(Boolean)) return null
  return sanitizeMarketingAttribution({
    ...campaignFields,
    ...context,
  })
}

export function appendMarketingParams(
  href: string,
  searchParams: Pick<URLSearchParams, 'get'>,
): string {
  if (!href.startsWith('/') || href.startsWith('//')) return href
  const [pathAndQuery, hash = ''] = href.split('#', 2)
  const [path, existingQuery = ''] = pathAndQuery.split('?', 2)
  const nextParams = new URLSearchParams(existingQuery)

  for (const key of MARKETING_QUERY_KEYS) {
    if (nextParams.has(key)) continue
    const value = clean(searchParams.get(key), 500)
    if (value) nextParams.set(key, value)
  }

  const query = nextParams.toString()
  return `${path}${query ? `?${query}` : ''}${hash ? `#${hash}` : ''}`
}

const BILLING_METADATA_FIELDS: Array<[keyof MarketingAttribution, string]> = [
  ['source', 'appstorecopilot_utm_source'],
  ['medium', 'appstorecopilot_utm_medium'],
  ['campaign', 'appstorecopilot_utm_campaign'],
  ['content', 'appstorecopilot_utm_content'],
  ['term', 'appstorecopilot_utm_term'],
  ['fbclid', 'appstorecopilot_fbclid'],
  ['twclid', 'appstorecopilot_twclid'],
  ['gclid', 'appstorecopilot_gclid'],
  ['oppref', 'appstorecopilot_oppref'],
  ['landingPath', 'appstorecopilot_landing_path'],
]

export function attributionToSearchParams(
  value: MarketingAttribution | null | undefined,
): URLSearchParams {
  const attribution = sanitizeMarketingAttribution(value)
  const params = new URLSearchParams()
  if (!attribution) return params

  const fields: Array<[keyof MarketingAttribution, (typeof MARKETING_QUERY_KEYS)[number]]> = [
    ['source', 'utm_source'],
    ['medium', 'utm_medium'],
    ['campaign', 'utm_campaign'],
    ['content', 'utm_content'],
    ['term', 'utm_term'],
    ['fbclid', 'fbclid'],
    ['twclid', 'twclid'],
    ['gclid', 'gclid'],
    ['oppref', 'oppref'],
  ]
  for (const [field, key] of fields) {
    if (attribution[field]) params.set(key, attribution[field])
  }
  return params
}

type MarketingStorage = Pick<Storage, 'getItem' | 'setItem'>

export function readStoredMarketingAttribution(
  storage?: MarketingStorage | null,
): MarketingAttribution | null {
  if (!storage) return null
  try {
    const raw = storage.getItem(MARKETING_ATTRIBUTION_STORAGE_KEY)
    return raw ? sanitizeMarketingAttribution(JSON.parse(raw)) : null
  } catch {
    return null
  }
}

export function storeMarketingAttribution(
  value: MarketingAttribution | null | undefined,
  storage?: MarketingStorage | null,
): MarketingAttribution | null {
  const attribution = sanitizeMarketingAttribution(value)
  if (!attribution || !storage) return attribution
  try {
    storage.setItem(MARKETING_ATTRIBUTION_STORAGE_KEY, JSON.stringify(attribution))
  } catch {
    // Attribution must never block navigation, authentication, or checkout.
  }
  return attribution
}

export function resolveMarketingAttribution(
  searchParams: Pick<URLSearchParams, 'get'>,
  context?: { landingPath?: string; referrer?: string; capturedAt?: string },
  storage?: MarketingStorage | null,
): MarketingAttribution | null {
  const current = attributionFromSearchParams(searchParams, context)
  const stored = readStoredMarketingAttribution(storage)
  if (!current) return stored

  const campaignFields: Array<keyof MarketingAttribution> = [
    'source', 'medium', 'campaign', 'content', 'term', 'fbclid', 'twclid', 'gclid', 'oppref',
  ]
  const isPropagatedTouch = !!stored && campaignFields.every(
    field => current[field] === stored[field],
  )
  return isPropagatedTouch ? stored : storeMarketingAttribution(current, storage)
}

export function attributionToBillingMetadata(
  value: MarketingAttribution | null | undefined,
): Record<string, string> {
  const attribution = sanitizeMarketingAttribution(value)
  if (!attribution) return {}
  return Object.fromEntries(
    BILLING_METADATA_FIELDS.flatMap(([field, key]) =>
      attribution[field] ? [[key, attribution[field]]] : []
    )
  )
}

export function attributionFromBillingMetadata(
  metadata: Record<string, unknown>,
): MarketingAttribution | null {
  const value: MarketingAttribution = {}
  for (const [field, key] of BILLING_METADATA_FIELDS) {
    const sanitized = clean(metadata[key], FIELD_LIMITS[field])
    if (sanitized) value[field] = sanitized
  }
  return sanitizeMarketingAttribution(value)
}
