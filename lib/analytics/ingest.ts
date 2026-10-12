import { createHash, randomUUID } from 'crypto'
import { ANALYTICS_APP, ANALYTICS_BODY_LIMIT, parseClientEvent } from './events'
import { anonymousDailyCap, crawlerName, type AnonymousDailyCap, type BotDropCounter } from './guardrails'

/**
 * First-party product analytics (event standard v1): one row per event in BigQuery
 * `appstorecopilot.appstorecopilot_analytics.events`. No IP, user agent, email, URL or free text is
 * ever stored, and request payloads are never logged.
 */
export interface AnalyticsRow {
  ts: string
  app: typeof ANALYTICS_APP
  platform: 'web'
  event: string
  visitor_id: string | null
  session_id: string | null
  user_id: string | null
  surface: string | null
  step: number | null
  /** JSON-encoded string; the BigQuery streaming insert accepts it for the JSON column. */
  props: string
  source: string | null
  device: string | null
  app_version: string | null
}
export type InsertRows = (rows: { insertId: string; json: AnalyticsRow }[]) => Promise<void>
export interface AnalyticsConfig { projectId: string; dataset: string; table: string }
export type Env = Record<string, string | undefined>

export const UID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/

export function analyticsConfig(env: Env = process.env): AnalyticsConfig | null {
  if (env.APPSTORECOPILOT_PRODUCT_ANALYTICS_ENABLED !== 'true') return null
  const dataset = env.APPSTORECOPILOT_ANALYTICS_DATASET ?? ''
  const table = env.APPSTORECOPILOT_ANALYTICS_TABLE ?? ''
  const projectId = env.GCP_PROJECT_ID ?? env.GOOGLE_CLOUD_PROJECT ?? env.GCLOUD_PROJECT ?? ''
  if (!/^[a-z][a-z0-9_]{0,63}$/.test(dataset) || !/^[a-z][a-z0-9_]{0,63}$/.test(table)) return null
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId)) return null
  return { projectId, dataset, table }
}

/** App Hosting build id from the Cloud Run revision (e.g. `build-2026-09-17-001`). */
export function appVersion(env: Env = process.env): string | null {
  const match = /(build-\d{4}-\d{2}-\d{2}-\d{3})$/.exec(env.K_REVISION ?? '')
  return match ? match[1] : null
}

export type AccessToken = () => Promise<string>

/** BigQuery legacy streaming insert with a bounded timeout. Row errors fail the call (code only). */
export function bigQueryInsert(config: AnalyticsConfig, token: AccessToken, timeoutMs = 2500): InsertRows {
  return async rows => {
    const url = `https://bigquery.googleapis.com/bigquery/v2/projects/${config.projectId}/datasets/${config.dataset}/tables/${config.table}/insertAll`
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetch(url, {
        method: 'POST',
        signal: controller.signal,
        headers: { Authorization: `Bearer ${await token()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ skipInvalidRows: false, ignoreUnknownValues: false, rows }),
      })
      if (!response.ok) throw new Error(`BIGQUERY_HTTP_${response.status}`)
      const data = await response.json().catch(() => ({})) as { insertErrors?: unknown[] }
      if (data.insertErrors?.length) throw new Error('BIGQUERY_ROW_REJECTED')
    } catch (error) {
      if (error instanceof Error && /^BIGQUERY_[A-Z0-9_]+$/.test(error.message)) throw error
      throw new Error(controller.signal.aborted ? 'BIGQUERY_TIMEOUT' : 'BIGQUERY_INSERT_FAILED')
    } finally {
      clearTimeout(timer)
    }
  }
}

export function logAnalyticsFailure(kind: string, error: unknown) {
  // Code only: never the payload, token, visitor or user identity.
  const code = error instanceof Error ? error.message.replace(/[^A-Z0-9_ ]/gi, '').slice(0, 60) : 'UNKNOWN'
  const job = ['deletion', 'deletion_enqueue', 'maintenance'].includes(kind)
  console.warn(JSON.stringify({
    severity: 'WARNING',
    message: job ? 'product analytics job failed' : 'product analytics insert failed',
    kind,
    code,
  }))
}

/**
 * Fixed-window per-minute limits, per instance by design:
 * - every browser event: per-visitor sanity limit;
 * - anonymous events only: an instance-wide ceiling;
 * - events with a verified uid: a per-uid sanity limit instead of the instance ceiling, so signed-in users
 *   (and agents driving a signed-in browser) are never starved by anonymous traffic.
 * Server facts never pass through this limiter.
 */
export class AnalyticsRateLimiter {
  private windows = new Map<string, { window: number; count: number }>()
  private global = { window: 0, count: 0 }
  constructor(
    private readonly perVisitor = 60,
    private readonly perInstance = 2000,
    private readonly windowMs = 60_000,
    private readonly perUser = 120,
  ) {}
  private bump(key: string, window: number, limit: number) {
    if (this.windows.size > 20_000) this.windows.clear()
    const current = this.windows.get(key)
    if (!current || current.window !== window) {
      this.windows.set(key, { window, count: 1 })
      return 1 <= limit
    }
    return ++current.count <= limit
  }
  allowVisitor(visitorId: string, now: number) {
    return this.bump(`v:${visitorId}`, Math.floor(now / this.windowMs), this.perVisitor)
  }
  allowUser(userId: string, now: number) {
    return this.bump(`u:${userId}`, Math.floor(now / this.windowMs), this.perUser)
  }
  allowAnonymous(now: number) {
    const window = Math.floor(now / this.windowMs)
    if (this.global.window !== window) this.global = { window, count: 0 }
    return ++this.global.count <= this.perInstance
  }
}

export interface IngestDeps {
  env: Env
  now: () => number
  limiter: AnalyticsRateLimiter
  /** Anonymous-only per-instance UTC-day cap (see guardrails.ts). */
  dailyCap: AnonymousDailyCap
  /** Per-instance counter of dropped crawler events (logged at most hourly). */
  botDrops: BotDropCounter
  insert: InsertRows | null
  /** Verifies the `__session` cookie and returns its uid; throws when invalid. */
  verifySession: (sessionCookie: string) => Promise<string>
}
const empty = (status: number) => new Response(null, { status, headers: { 'Cache-Control': 'no-store' } })

export function allowedOrigins(env: Env): string[] {
  const origins = new Set<string>()
  for (const value of [env.NEXT_PUBLIC_APP_URL, env.APPSTORECOPILOT_ANALYTICS_EXTRA_ORIGIN]) {
    if (!value) continue
    try { origins.add(new URL(value).origin) } catch { /* ignore malformed config */ }
  }
  return [...origins]
}

function sessionCookie(request: Request): string | null {
  const header = request.headers.get('cookie')
  if (!header) return null
  for (const part of header.split(';')) {
    const index = part.indexOf('=')
    if (index > 0 && part.slice(0, index).trim() === '__session') {
      const value = part.slice(index + 1).trim()
      return value.length > 0 && value.length <= 8192 ? value : null
    }
  }
  return null
}

/**
 * POST /api/public/events. Order: flag → origin → content type → size → schema → per-visitor rate → uid →
 * (verified uid: per-uid rate | anonymous: crawler UA 204 → instance rate → UTC-day cap 204) → insert.
 * App Listing Agent deliberately has no consent gate and no DNT/GPC skip (product decision, 2026-09-17).
 * The user agent is only matched against the crawler lists here; it is never stored or logged.
 */
export async function handleAnalyticsRequest(request: Request, deps: IngestDeps): Promise<Response> {
  const config = analyticsConfig(deps.env)
  if (!config || !deps.insert) return empty(204)
  const origin = request.headers.get('origin')
  if (!origin || !allowedOrigins(deps.env).includes(origin)) return empty(403)
  if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') return empty(415)
  const declared = request.headers.get('content-length')
  if (declared !== null && !(Number(declared) <= ANALYTICS_BODY_LIMIT)) return empty(413)

  let parsed
  try {
    const reader = request.body?.getReader()
    if (!reader) return empty(400)
    const chunks: Uint8Array[] = []
    let size = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('TIMEOUT')), 3000) })
    try {
      for (;;) {
        const part = await Promise.race([reader.read(), deadline])
        if (part.done) break
        size += part.value.length
        if (size > ANALYTICS_BODY_LIMIT) return empty(413)
        chunks.push(part.value)
      }
    } finally {
      clearTimeout(timer)
      void reader.cancel().catch(() => {})
      reader.releaseLock()
    }
    parsed = parseClientEvent(JSON.parse(Buffer.concat(chunks).toString('utf8')))
  } catch {
    return empty(400)
  }
  if (!parsed) return empty(400)

  const now = deps.now()
  if (!deps.limiter.allowVisitor(parsed.visitorId, now)) return empty(429)

  // user_id comes ONLY from a server-verified session; an invalid session records the event anonymously.
  let userId: string | null = null
  const cookie = sessionCookie(request)
  if (cookie) {
    try { userId = await deps.verifySession(cookie) } catch { userId = null }
    if (userId !== null && !UID_PATTERN.test(userId)) userId = null
  }
  if (userId !== null) {
    // Signed-in users bypass the instance ceiling and the anonymous daily cap; only a per-uid sanity limit applies.
    if (!deps.limiter.allowUser(userId, now)) return empty(429)
  } else {
    // Crawler UAs are dropped only WITHOUT a verified uid: a signed-in session is never UA filtered.
    const crawler = crawlerName(request.headers.get('user-agent'))
    if (crawler) {
      deps.botDrops.record(crawler, now)
      return empty(204)
    }
    if (!deps.limiter.allowAnonymous(now)) return empty(429)
    // Cap tripped: 204 (not an error) so clients never retry; nothing is inserted.
    if (!deps.dailyCap.allow(now, anonymousDailyCap(deps.env))) return empty(204)
  }

  const row: AnalyticsRow = {
    ts: new Date(now).toISOString(),
    app: ANALYTICS_APP,
    platform: 'web',
    event: parsed.event,
    visitor_id: parsed.visitorId,
    session_id: parsed.sessionId,
    user_id: userId,
    surface: parsed.surface,
    step: parsed.step,
    props: JSON.stringify(parsed.props),
    source: parsed.source,
    device: parsed.device,
    app_version: appVersion(deps.env),
  }
  // Awaited: App Hosting (Cloud Run) throttles CPU after the response is sent.
  try { await deps.insert([{ insertId: randomUUID(), json: row }]) } catch (error) { logAnalyticsFailure('client', error) }
  return empty(204)
}

// ----- server-side facts -----

/** Durable at-most-once marker per business fact (Firestore `analyticsEmissions/{sha256(key)}`). */
export interface EmissionLedger { claim(key: string, now: number): Promise<boolean> }
export class MemoryEmissionLedger implements EmissionLedger {
  keys = new Set<string>()
  async claim(key: string) {
    if (this.keys.has(key)) return false
    this.keys.add(key)
    return true
  }
}
export const emissionDocId = (key: string) => createHash('sha256').update(key).digest('hex')

export function serverFactRow(
  event: string,
  userId: string | null,
  props: Record<string, string | number | boolean>,
  at: number,
  env: Env = process.env,
): AnalyticsRow {
  return {
    ts: new Date(at).toISOString(),
    app: ANALYTICS_APP,
    platform: 'web',
    event,
    visitor_id: null,
    session_id: null,
    user_id: userId && UID_PATTERN.test(userId) ? userId : null,
    surface: 'server',
    step: null,
    props: JSON.stringify(props),
    source: null,
    device: null,
    app_version: appVersion(env),
  }
}
