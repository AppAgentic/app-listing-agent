import type { Env } from './ingest'

/**
 * Runaway-cost guardrails for the BROWSER ingest endpoint only (added 2026-09-17).
 * Server facts (purchase, subscription_canceled, refund, core_action) never pass through here: they insert directly
 * from the webhook / MCP / agent code paths and are never capped or user-agent filtered.
 */

const DAY_MS = 86_400_000
const HOUR_MS = 3_600_000

/** 200k anonymous events per instance per UTC day x maxInstances 10 = at most ~2M anonymous events/day fleet-wide. */
export const DEFAULT_ANON_DAILY_CAP = 200_000
export const ANON_DAILY_CAP_ENV = 'APPSTORECOPILOT_ANALYTICS_ANON_DAILY_CAP'

/** Env override: a non-negative integer (0 stops anonymous inserts); anything else falls back to the default. */
export function anonymousDailyCap(env: Env): number {
  const raw = env[ANON_DAILY_CAP_ENV]?.trim()
  return raw && /^\d{1,9}$/.test(raw) ? Number(raw) : DEFAULT_ANON_DAILY_CAP
}

export type GuardLog = (entry: Record<string, string | number>) => void
const warn: GuardLog = entry => console.warn(JSON.stringify(entry))

/**
 * In-memory per-instance counter of ANONYMOUS browser events with a UTC-day window. Events with a verified uid
 * never call this. When the cap trips, the caller returns 204 without inserting; one warning is logged per
 * instance per UTC day.
 */
export class AnonymousDailyCap {
  private day = -1
  private count = 0
  private warnedDay = -1
  constructor(private readonly log: GuardLog = warn) {}

  allow(now: number, cap: number): boolean {
    const day = Math.floor(now / DAY_MS)
    if (day !== this.day) {
      this.day = day
      this.count = 0
    }
    if (this.count < cap) {
      this.count++
      return true
    }
    if (this.warnedDay !== day) {
      this.warnedDay = day
      this.log({
        severity: 'WARNING',
        message: 'product analytics anonymous daily cap reached; anonymous browser events are dropped until 00:00 UTC',
        code: 'analytics_daily_cap_reached',
        cap,
        day: new Date(day * DAY_MS).toISOString().slice(0, 10),
      })
    }
    return false
  }
}

/**
 * AI assistants and agents acting for users, plus automation browsers. The allowlist ALWAYS wins over the
 * denylist: losing agent traffic is never acceptable (product decision).
 */
const AGENT_ALLOWLIST =
  /ChatGPT-User|OAI-SearchBot|GPTBot|OpenAI|Claude-User|Claude-SearchBot|ClaudeBot|anthropic-ai|Perplexity-User|PerplexityBot|Google-Extended|Google-?Agent|Gemini|Copilot|DuckAssistBot|MistralAI-User|Meta-ExternalAgent|Meta-ExternalFetcher|YouBot|Amazonbot|cohere-ai|Manus|HeadlessChrome|Playwright|Puppeteer/i

/** Conservative denylist of search, SEO and link-preview crawlers. Names are logged, never the user agent. */
const CRAWLERS: ReadonlyArray<readonly [string, RegExp]> = [
  ['googlebot', /Googlebot/i],
  ['bingbot', /bingbot/i],
  ['applebot', /Applebot/i],
  ['duckduckbot', /DuckDuckBot/i],
  ['yandexbot', /YandexBot/i],
  ['baiduspider', /Baiduspider/i],
  ['ahrefsbot', /AhrefsBot/i],
  ['semrushbot', /SemrushBot/i],
  ['mj12bot', /MJ12bot/i],
  ['dotbot', /DotBot/i],
  ['petalbot', /PetalBot/i],
  ['facebookexternalhit', /facebookexternalhit/i],
  ['twitterbot', /Twitterbot/i],
  ['slackbot', /Slackbot-LinkExpanding/i],
  ['discordbot', /Discordbot/i],
  ['linkedinbot', /LinkedInBot/i],
  // Link-preview fetcher ("WhatsApp/2.x A"), anchored so a browser UA that merely mentions WhatsApp is kept.
  ['whatsapp', /^WhatsApp\//i],
  ['telegrambot', /TelegramBot/i],
]

/** Real device names that end in "bot" (e.g. CUBOT Android phones) must never trip the generic rule. */
const HUMAN_BOT_TOKENS = new Set(['cubot'])

/** Assistant/agent indicators: the generic rule never fires on these (the explicit denylist still applies). */
const AGENT_INDICATOR = /agent|assistant|-user\b/i

/** Generic rule: a whole UA token that ends in "bot", or contains "crawler"/"spider". */
function genericCrawler(userAgent: string): boolean {
  return userAgent.split(/[^A-Za-z0-9]+/).some(token => {
    const lower = token.toLowerCase()
    if (!lower || HUMAN_BOT_TOKENS.has(lower)) return false
    return lower.endsWith('bot') || lower.includes('crawler') || lower.includes('spider')
  })
}

/**
 * Returns the matched crawler name, or null to accept. Allowlisted agents are always accepted. Callers apply this only to
 * events WITHOUT a verified uid: a signed-in session is never UA filtered (an agent may drive it with any UA).
 */
export function crawlerName(userAgent: string | null | undefined): string | null {
  if (!userAgent) return null
  const ua = userAgent.slice(0, 1024)
  if (AGENT_ALLOWLIST.test(ua)) return null
  for (const [name, pattern] of CRAWLERS) if (pattern.test(ua)) return name
  return !AGENT_INDICATOR.test(ua) && genericCrawler(ua) ? 'generic' : null
}

/**
 * Per-instance counter of dropped crawler events, logged at most once per hour (counts by crawler name only) so an
 * over-aggressive filter is visible in Cloud Logging.
 */
export class BotDropCounter {
  private counts = new Map<string, number>()
  private lastLog = -Infinity
  constructor(private readonly log: GuardLog = warn) {}

  record(name: string, now: number) {
    this.counts.set(name, (this.counts.get(name) ?? 0) + 1)
    if (now - this.lastLog < HOUR_MS) return
    this.lastLog = now
    const byCrawler = Object.fromEntries([...this.counts].sort(([a], [b]) => a.localeCompare(b)))
    const total = [...this.counts.values()].reduce((sum, value) => sum + value, 0)
    this.counts.clear()
    this.log({
      severity: 'NOTICE',
      message: 'product analytics crawler events dropped',
      code: 'analytics_bot_events_dropped',
      dropped: total,
      by_crawler: JSON.stringify(byCrawler),
    })
  }
}
