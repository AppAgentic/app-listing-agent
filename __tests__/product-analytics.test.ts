// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'

const firestore = vi.hoisted(() => ({ created: new Set<string>(), createCalls: 0 }))
vi.mock('@/lib/firebase/admin', () => ({
  adminApp: null,
  adminAuth: {},
  adminDb: {
    collection: () => ({
      doc: (id: string) => ({
        create: async () => {
          firestore.createCalls++
          if (firestore.created.has(id)) throw Object.assign(new Error('exists'), { code: 6 })
          firestore.created.add(id)
        },
      }),
    }),
  },
}))
vi.mock('firebase-admin/app', async importOriginal => ({
  ...(await importOriginal<typeof import('firebase-admin/app')>()),
  applicationDefault: () => ({ getAccessToken: async () => ({ access_token: 'test-access-token', expires_in: 3600 }) }),
}))

import { analyticsSource, parseClientEvent, surfaceForPath } from '@/lib/analytics/events'
import {
  AnalyticsRateLimiter,
  MemoryEmissionLedger,
  handleAnalyticsRequest,
  type AnalyticsRow,
  type IngestDeps,
} from '@/lib/analytics/ingest'
import { billingAnalyticsEmitter, stripeBillingFact, type StripeFactEvent } from '@/lib/analytics/billing-facts'
import { AnonymousDailyCap, BotDropCounter, DEFAULT_ANON_DAILY_CAP, anonymousDailyCap, crawlerName } from '@/lib/analytics/guardrails'
import {
  MemoryAnalyticsDeletionStore,
  StreamingBufferError,
  deleteUserAnalytics,
  processAnalyticsDeletions,
  type AnalyticsQuery,
} from '@/lib/analytics/deletion'
import { recordCoreAction } from '@/lib/analytics/runtime'

const origin = 'https://applistingagent.com'
const env = {
  APPSTORECOPILOT_PRODUCT_ANALYTICS_ENABLED: 'true',
  APPSTORECOPILOT_ANALYTICS_DATASET: 'appstorecopilot_analytics',
  APPSTORECOPILOT_ANALYTICS_TABLE: 'events',
  GCP_PROJECT_ID: 'appstorecopilot',
  NEXT_PUBLIC_APP_URL: origin,
  K_REVISION: 'applistingagent-build-2026-09-17-002',
}
const visitor = '0f8fad5b-d9cb-469f-a165-70867728950e'
const session = '7c9e6679-7425-40de-944b-e07fc1f90ae7'
const base = { v: 1, visitor_id: visitor, session_id: session, device: 'mobile' }

function deps(overrides: Partial<IngestDeps> = {}) {
  const rows: AnalyticsRow[] = []
  const value: IngestDeps = {
    env,
    now: () => Date.parse('2026-09-17T12:00:00Z'),
    limiter: new AnalyticsRateLimiter(3),
    dailyCap: new AnonymousDailyCap(() => {}),
    botDrops: new BotDropCounter(() => {}),
    insert: async batch => { rows.push(...batch.map(row => row.json)) },
    verifySession: async cookie => {
      if (cookie !== 'valid-session') throw new Error('bad')
      return 'uid_verified_1'
    },
    ...overrides,
  }
  return { rows, value }
}
function post(body: unknown, headers: Record<string, string> = {}) {
  const text = typeof body === 'string' ? body : JSON.stringify(body)
  return new Request(`${origin}/api/public/events`, {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json', ...headers },
    body: text,
  })
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

const prices = (priceId: unknown) => (priceId === 'price_pro_month' ? { plan: 'pro', interval: 'monthly' } : null)
let stripeEventSequence = 0
const stripeEvent = (type: string, object: Record<string, unknown>, previous?: Record<string, unknown>): StripeFactEvent => ({
  id: `evt_${++stripeEventSequence}`, type, created: 1_789_600_000, data: { object, ...(previous ? { previous_attributes: previous } : {}) },
})
const invoicePaid = (id: string, amount: number) => stripeEvent('invoice.paid', {
  id, status: 'paid', amount_paid: amount, currency: 'usd', billing_reason: amount ? 'subscription_cycle' : 'subscription_create',
  lines: { data: [{ pricing: { price_details: { price: 'price_pro_month' } } }] },
})

describe('client event allow-list', () => {
  it('rejects unknown events, props, free text, ids in surfaces and server-only facts', () => {
    expect(parseClientEvent({ ...base, event: 'page_view', surface: 'home' })?.surface).toBe('home')
    expect(parseClientEvent({ ...base, event: 'onboarding_step', step: 1, props: { choice: 'agent' } })?.props.choice).toBe('agent')
    for (const bad of [
      { ...base, event: 'page_view' },
      { ...base, event: 'purchase', props: { value_minor: 100 } },
      { ...base, event: 'core_action', props: { action: 'agent_connected' } },
      { ...base, event: 'onboarding_step', step: 1, props: { choice: 'My Secret Workspace Name' } },
      { ...base, event: 'onboarding_step', step: 3, props: { choice: 'agent' } },
      { ...base, event: 'onboarding_step', step: 2, props: { choice: 'agent' } },
      { ...base, event: 'page_view', surface: '/projects/abc123/metadata' },
      { ...base, event: 'page_view', surface: 'home', email: 'a@b.test' },
      { ...base, event: 'page_view', surface: 'home', props: { url: 'https://x' } },
      { ...base, event: 'plan_selected', props: { plan: 'free-forever' } },
      { ...base, event: 'checkout_started', props: { kind: 'subscription', plan: 'enterprise' } },
      { ...base, event: 'page_view', surface: 'home', visitor_id: 'not-a-uuid' },
      { ...base, event: 'page_view', surface: 'home', source: 'https://evil.example/?q=1' },
      { ...base, event: 'page_view', surface: 'home', user_id: 'uid_spoofed' },
      { ...base, event: 'signin_completed', props: { method: 'password', new_account: 'yes' } },
    ]) expect(parseClientEvent(bad), JSON.stringify(bad)).toBeNull()
  })

  it('maps paths to surfaces without ids and sources to allow-listed names or click kinds only', () => {
    expect(surfaceForPath('/projects/p_8f2k/metadata')).toBe('project_metadata')
    expect(surfaceForPath('/projects/p_8f2k/settings/credentials/appstore')).toBe('project_credentials')
    expect(surfaceForPath('/agent-tasks/task_123')).toBe('agent_task')
    expect(surfaceForPath('/api/anything')).toBeNull()
    expect(analyticsSource({ source: 'Meta', fbclid: 'secret-click' })).toBe('meta')
    expect(analyticsSource({ source: '<script>', gclid: 'secret-click-value' })).toBe('gclid')
    expect(analyticsSource(null)).toBeNull()
  })
})

describe('ingest route', () => {
  it('honours the flag, origin, content type and size before storing anything', async () => {
    const event = { ...base, event: 'page_view', surface: 'home' }
    const off = deps({ env: { ...env, APPSTORECOPILOT_PRODUCT_ANALYTICS_ENABLED: 'false' } })
    expect((await handleAnalyticsRequest(post(event), off.value)).status).toBe(204)
    expect(off.rows).toHaveLength(0)
    const foreign = deps()
    expect((await handleAnalyticsRequest(post(event, { origin: 'https://evil.example' }), foreign.value)).status).toBe(403)
    expect(foreign.rows).toHaveLength(0)
    const big = deps()
    expect((await handleAnalyticsRequest(post({ ...event, padding: 'x'.repeat(3000) }), big.value)).status).toBe(413)
    expect(big.rows).toHaveLength(0)
    const text = deps()
    expect((await handleAnalyticsRequest(post(event, { 'content-type': 'text/plain' }), text.value)).status).toBe(415)
    const invalid = deps()
    expect((await handleAnalyticsRequest(post({ ...event, event: 'purchase' }), invalid.value)).status).toBe(400)
    expect(invalid.rows).toHaveLength(0)
  })

  it('tracks without a consent gate: DNT and GPC headers do not suppress events (product decision)', async () => {
    const d = deps()
    const event = { ...base, event: 'page_view', surface: 'home' }
    await handleAnalyticsRequest(post(event, { dnt: '1' }), d.value)
    await handleAnalyticsRequest(post(event, { 'sec-gpc': '1' }), d.value)
    expect(d.rows).toHaveLength(2)
  })

  it('stores no IP or user agent, takes user_id only from a verified session, and rate limits per visitor', async () => {
    const d = deps()
    const event = { ...base, event: 'onboarding_step', step: 1, props: { choice: 'agent' } }
    expect((await handleAnalyticsRequest(post(event, { 'x-forwarded-for': '203.0.113.9', 'user-agent': 'Secret/1.0' }), d.value)).status).toBe(204)
    expect((await handleAnalyticsRequest(post(event, { cookie: '__session=forged-session' }), d.value)).status).toBe(204)
    expect((await handleAnalyticsRequest(post(event, { cookie: 'other=1; __session=valid-session' }), d.value)).status).toBe(204)
    expect(d.rows.map(row => row.user_id)).toEqual([null, null, 'uid_verified_1'])
    expect((await handleAnalyticsRequest(post(event), d.value)).status).toBe(429)
    const row = d.rows[0]
    expect(Object.keys(row).sort()).toEqual(['app', 'app_version', 'device', 'event', 'platform', 'props', 'session_id', 'source', 'step', 'surface', 'ts', 'user_id', 'visitor_id'])
    expect(row).toMatchObject({ app: 'appstorecopilot', platform: 'web', app_version: 'build-2026-09-17-002', props: '{"choice":"agent"}' })
    expect(JSON.stringify(d.rows)).not.toContain('203.0.113.9')
    expect(JSON.stringify(d.rows)).not.toContain('Secret/1.0')
    const failing = deps({ insert: async () => { throw new Error('BIGQUERY_ROW_REJECTED') } })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect((await handleAnalyticsRequest(post(event), failing.value)).status).toBe(204)
  })
})

const CHROME_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'
const AGENT_UAS = {
  'ChatGPT-User': 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot',
  'Claude-User': 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Claude-User/1.0; +Claude-User@anthropic.com)',
  PerplexityBot: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)',
  GPTBot: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.1; +https://openai.com/gptbot',
  HeadlessChrome: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/128.0.0.0 Safari/537.36',
  Chrome: CHROME_UA,
  'CUBOT phone': 'Mozilla/5.0 (Linux; Android 12; CUBOT X50) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36',
  'Facebook in-app': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/470.0]',
}
const CRAWLER_UAS = [
  'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  'Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)',
  'Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)',
  'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
  'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)',
  'WhatsApp/2.23.20.0 A',
  'TelegramBot (like TwitterBot)',
  'Mozilla/5.0 (compatible; SomeNewCrawler/1.0)',
  'Mozilla/5.0 (compatible; ExampleBot/0.1)',
]

describe('cost guardrails (browser ingest only)', () => {
  const event = { ...base, event: 'page_view', surface: 'home' }
  const day1 = Date.parse('2026-09-17T23:59:00Z')
  const env1 = { ...env, APPSTORECOPILOT_ANALYTICS_ANON_DAILY_CAP: '2' }

  it('caps anonymous events per UTC day with a 204 and one warning, and resets on the UTC day rollover', async () => {
    let now = day1
    const warnings: Record<string, unknown>[] = []
    const d = deps({ env: env1, now: () => now, limiter: new AnalyticsRateLimiter(100), dailyCap: new AnonymousDailyCap(entry => warnings.push(entry)) })
    const statuses = []
    for (const visitorId of [visitor, session, visitor, session]) {
      statuses.push((await handleAnalyticsRequest(post({ ...event, visitor_id: visitorId }), d.value)).status)
    }
    expect(statuses).toEqual([204, 204, 204, 204])
    expect(d.rows).toHaveLength(2)
    expect(warnings).toEqual([expect.objectContaining({ severity: 'WARNING', code: 'analytics_daily_cap_reached', cap: 2, day: '2026-09-17' })])

    // Signed-in (verified uid) browser events still insert after the cap.
    expect((await handleAnalyticsRequest(post(event, { cookie: '__session=valid-session' }), d.value)).status).toBe(204)
    expect(d.rows.at(-1)).toMatchObject({ user_id: 'uid_verified_1' })
    expect(d.rows).toHaveLength(3)
    // A forged session is anonymous, so it stays capped.
    await handleAnalyticsRequest(post(event, { cookie: '__session=forged' }), d.value)
    expect(d.rows).toHaveLength(3)

    now = Date.parse('2026-09-18T00:00:01Z')
    expect((await handleAnalyticsRequest(post(event), d.value)).status).toBe(204)
    expect(d.rows).toHaveLength(4)
    expect(d.rows.at(-1)).toMatchObject({ user_id: null })
    expect(warnings).toHaveLength(1)
  })

  it('reads the cap from the env with a 200k default and supports 0 as an anonymous kill switch', async () => {
    expect(DEFAULT_ANON_DAILY_CAP).toBe(200_000)
    expect(anonymousDailyCap({})).toBe(200_000)
    expect(anonymousDailyCap({ APPSTORECOPILOT_ANALYTICS_ANON_DAILY_CAP: 'lots' })).toBe(200_000)
    expect(anonymousDailyCap({ APPSTORECOPILOT_ANALYTICS_ANON_DAILY_CAP: '-5' })).toBe(200_000)
    expect(anonymousDailyCap({ APPSTORECOPILOT_ANALYTICS_ANON_DAILY_CAP: '5000' })).toBe(5000)
    const off = deps({ env: { ...env, APPSTORECOPILOT_ANALYTICS_ANON_DAILY_CAP: '0' } })
    await handleAnalyticsRequest(post(event), off.value)
    await handleAnalyticsRequest(post(event, { cookie: '__session=valid-session' }), off.value)
    expect(off.rows.map(row => row.user_id)).toEqual(['uid_verified_1'])
  })

  it('lets signed-in users bypass the per-instance minute ceiling but keeps a per-uid limit', async () => {
    const d = deps({ limiter: new AnalyticsRateLimiter(1000, 1, 60_000, 3) })
    const second = { ...event, visitor_id: session }
    expect((await handleAnalyticsRequest(post(event), d.value)).status).toBe(204)
    expect((await handleAnalyticsRequest(post(second), d.value)).status).toBe(429)
    for (let i = 0; i < 3; i++) {
      expect((await handleAnalyticsRequest(post(second, { cookie: '__session=valid-session' }), d.value)).status).toBe(204)
    }
    expect((await handleAnalyticsRequest(post(second, { cookie: '__session=valid-session' }), d.value)).status).toBe(429)
    expect(d.rows.map(row => row.user_id)).toEqual([null, 'uid_verified_1', 'uid_verified_1', 'uid_verified_1'])
  })

  it('drops crawler user agents with 204 and counts them hourly without storing the user agent', async () => {
    const logs: Record<string, unknown>[] = []
    let now = day1
    const d = deps({ now: () => now, limiter: new AnalyticsRateLimiter(1000), botDrops: new BotDropCounter(entry => logs.push(entry)) })
    for (const ua of CRAWLER_UAS) {
      expect(crawlerName(ua), ua).not.toBeNull()
      expect((await handleAnalyticsRequest(post(event, { 'user-agent': ua }), d.value)).status).toBe(204)
    }
    expect(d.rows).toHaveLength(0)
    expect(logs).toHaveLength(1)
    expect(logs[0]).toMatchObject({ code: 'analytics_bot_events_dropped', dropped: 1, by_crawler: '{"googlebot":1}' })
    // A verified session is never UA filtered: an agent may drive a signed-in browser with any UA.
    expect((await handleAnalyticsRequest(post(event, { 'user-agent': CRAWLER_UAS[0], cookie: '__session=valid-session' }), d.value)).status).toBe(204)
    expect(d.rows.map(row => row.user_id)).toEqual(['uid_verified_1'])
    now += 3_600_000
    await handleAnalyticsRequest(post(event, { 'user-agent': CRAWLER_UAS[2] }), d.value)
    expect(logs).toHaveLength(2)
    expect(logs[1]).toMatchObject({ dropped: 10 })
    expect(JSON.stringify(logs)).not.toContain('Mozilla')
  })

  it('always accepts AI assistants, agents, headless browsers and normal browsers (allowlist wins)', async () => {
    const d = deps({ limiter: new AnalyticsRateLimiter(1000) })
    for (const [name, ua] of Object.entries(AGENT_UAS)) {
      expect(crawlerName(ua), name).toBeNull()
      expect((await handleAnalyticsRequest(post(event, { 'user-agent': ua }), d.value)).status, name).toBe(204)
    }
    for (const ua of [
      'Claude-SearchBot/1.0', 'ClaudeBot/1.0', 'OAI-SearchBot/1.0', 'Perplexity-User/1.0', 'Google-Extended', 'Playwright/1.55 Googlebot', 'Puppeteer spider',
      'Mozilla/5.0 (compatible; DuckAssistBot/1.2; +http://duckduckgo.com/duckassistbot.html)', 'Mozilla/5.0 (compatible; MistralAI-User/1.0; +https://docs.mistral.ai/robots)',
      'meta-externalagent/1.1 (+https://developers.facebook.com/docs/sharing/webmasters/crawler)', 'meta-externalfetcher/1.1', 'Mozilla/5.0 (compatible; YouBot/1.0)',
      'Mozilla/5.0 (compatible; Amazonbot/0.1)', 'cohere-ai', 'Mozilla/5.0 (compatible; GoogleAgent-Mariner/1.0)', 'Google-Agent/1.0', 'Gemini-Deep-Research',
      'Copilot/1.0', 'Manus-User/1.0', 'OpenAI-Operator/1.0', 'anthropic-ai', 'SomeNewAssistantBot/1.0', 'Acme-User/1.0', 'FooAgentBot',
    ]) {
      expect(crawlerName(ua), ua).toBeNull()
    }
    expect(crawlerName('Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)')).toBe('googlebot')
    expect(crawlerName('Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)')).toBe('ahrefsbot')
    expect(crawlerName(null)).toBeNull()
    expect(d.rows).toHaveLength(Object.keys(AGENT_UAS).length)
    expect(JSON.stringify(d.rows)).not.toContain('Mozilla')
  })

  it('never caps or user-agent filters server facts (webhook purchase/refund, MCP core_action)', async () => {
    // Exhaust the anonymous cap and see crawler traffic on the browser endpoint first.
    const capped = deps({ env: { ...env, APPSTORECOPILOT_ANALYTICS_ANON_DAILY_CAP: '0' } })
    await handleAnalyticsRequest(post(event, { 'user-agent': CRAWLER_UAS[0] }), capped.value)
    await handleAnalyticsRequest(post(event), capped.value)
    expect(capped.rows).toHaveLength(0)

    vi.stubEnv('APPSTORECOPILOT_ANALYTICS_ANON_DAILY_CAP', '0')
    const rows: AnalyticsRow[] = []
    const emit = billingAnalyticsEmitter({ ledger: new MemoryEmissionLedger(), insert: async batch => { rows.push(...batch.map(r => r.json)) }, prices, env: { ...env, APPSTORECOPILOT_ANALYTICS_ANON_DAILY_CAP: '0' } })
    expect(await emit(invoicePaid('in_guard000001', 9900), 'user-guard')).toBe(true)
    expect(await emit(stripeEvent('charge.refunded', { id: 'ch_guard000001', currency: 'usd', amount_refunded: 9900 }), 'user-guard')).toBe(true)
    expect(rows.map(row => row.event)).toEqual(['purchase', 'refund'])

    const inserted: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      inserted.push(...JSON.parse(String(init.body)).rows.map((row: { json: AnalyticsRow }) => row.json.event))
      return new Response('{}', { status: 200 })
    }))
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value)
    await recordCoreAction('user-guard-mcp', 'mcp_tool_called')
    expect(inserted).toEqual(['core_action'])
    firestore.createCalls = 0
    firestore.created.clear()
  })
})

describe('Stripe billing facts', () => {
  it('emits purchase, trial start, cancellation and refund once per business fact under replay', async () => {
    const rows: AnalyticsRow[] = []
    const emit = billingAnalyticsEmitter({ ledger: new MemoryEmissionLedger(), insert: async batch => { rows.push(...batch.map(r => r.json)) }, prices, env })
    const trial = stripeEvent('customer.subscription.created', { id: 'sub_one0000001', status: 'trialing', trial_start: 1_789_600_000, trial_end: 1_789_600_000 + 7 * 86_400, items: { data: [{ price: { id: 'price_pro_month' } }] } })
    expect(await emit(trial, 'user-one')).toBe(true)
    expect(await emit({ ...trial, id: 'evt_other' }, 'user-one')).toBe(false)
    expect(await emit(invoicePaid('in_trial000001', 0), 'user-one')).toBe(false)
    expect(await emit(invoicePaid('in_one00000001', 24_900), 'user-one')).toBe(true)
    expect(await emit(invoicePaid('in_one00000001', 24_900), 'user-one')).toBe(false)
    const cancel = stripeEvent('customer.subscription.updated', { id: 'sub_one0000001', status: 'active', cancel_at_period_end: true, cancel_at: 1_792_000_000 }, { cancel_at_period_end: false })
    await emit(cancel, 'user-one'); await emit(cancel, 'user-one')
    await emit(stripeEvent('customer.subscription.updated', { id: 'sub_one0000001', cancel_at_period_end: false }, { cancel_at_period_end: true }), 'user-one')
    const ended = stripeEvent('customer.subscription.deleted', { id: 'sub_one0000001' })
    await emit(ended, 'user-one'); await emit(ended, 'user-one')
    const refund = stripeEvent('charge.refunded', { id: 'ch_one00000001', currency: 'usd', amount_refunded: 24_900 })
    await emit(refund, 'user-one'); await emit(refund, 'user-one')

    expect(rows.map(row => [row.event, JSON.parse(row.props)])).toEqual([
      ['trial_started', { plan: 'pro', interval: 'month', trial_days: 7 }],
      ['purchase', { kind: 'subscription', plan: 'pro', interval: 'month', billing_reason: 'subscription_cycle', value_minor: 24_900, currency: 'usd' }],
      ['subscription_canceled', { phase: 'requested' }],
      ['subscription_canceled', { phase: 'ended' }],
      ['refund', { value_minor: 24_900, currency: 'usd' }],
    ])
    for (const row of rows) expect(row).toMatchObject({ user_id: 'user-one', surface: 'server', visitor_id: null, session_id: null })
    expect(JSON.stringify(rows)).not.toContain('@')
  })

  it('ignores $0 and unpaid invoices and never throws into webhook handling', async () => {
    expect(stripeBillingFact(invoicePaid('in_trial000002', 0), prices)).toBeNull()
    expect(stripeBillingFact({ ...invoicePaid('in_open0000001', 100), data: { object: { id: 'in_open0000001', status: 'open', amount_paid: 100, currency: 'usd' } } }, prices)).toBeNull()
    expect(stripeBillingFact(stripeEvent('customer.subscription.created', { id: 'sub_paidnotrial', status: 'active' }), prices)).toBeNull()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const failing = billingAnalyticsEmitter({ ledger: new MemoryEmissionLedger(), insert: async () => { throw new Error('BIGQUERY_DOWN') }, prices })
    await expect(failing(invoicePaid('in_two00000001', 100), 'user-one')).resolves.toBe(false)
    const brokenLedger = billingAnalyticsEmitter({ ledger: { claim: async () => { throw new Error('FIRESTORE_DOWN') } }, insert: async () => {}, prices })
    await expect(brokenLedger(invoicePaid('in_three000001', 100), 'user-one')).resolves.toBe(false)
  })
})

describe('core actions', () => {
  it('records each core action once per account and does nothing when the flag is off', async () => {
    const inserted: { rows: { insertId: string; json: AnalyticsRow }[] }[] = []
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      inserted.push(JSON.parse(String(init.body)))
      return new Response(JSON.stringify({}), { status: 200 })
    }))
    await recordCoreAction('user-core', 'agent_connected')
    expect(firestore.createCalls).toBe(0)

    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value)
    await recordCoreAction('user-core', 'agent_connected')
    await recordCoreAction('user-core', 'agent_connected')
    await recordCoreAction('user-core', 'store_published')
    await recordCoreAction('not a uid!', 'store_published')
    expect(firestore.createCalls).toBe(2)
    expect(inserted.flatMap(call => call.rows.map(row => [row.json.event, row.json.user_id, JSON.parse(row.json.props).action]))).toEqual([
      ['core_action', 'user-core', 'agent_connected'],
      ['core_action', 'user-core', 'store_published'],
    ])
  })
})

describe('account deletion', () => {
  it('deletes user rows and linked visitor rows, retrying while the streaming buffer blocks DML', async () => {
    const statements: { sql: string; params: unknown }[] = []
    let buffered = true
    const query: AnalyticsQuery = async (sql, params) => {
      statements.push({ sql, params })
      if (sql.startsWith('SELECT')) return { rows: [[visitor], ['not-a-uuid']], affectedRows: 0 }
      if (buffered) throw new StreamingBufferError()
      return { rows: [], affectedRows: 12 }
    }
    const config = { projectId: 'appstorecopilot', dataset: 'appstorecopilot_analytics', table: 'events' }
    const store = new MemoryAnalyticsDeletionStore()
    let now = 1_000_000
    await store.enqueue('user-delete', now)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await processAnalyticsDeletions({ store, query, config, now: () => now })).toMatchObject({ due: 1, retried: 1, completed: 0 })
    buffered = false
    expect(await processAnalyticsDeletions({ store, query, config, now: () => now })).toMatchObject({ due: 0 })
    now += 20 * 60_000
    expect(await processAnalyticsDeletions({ store, query, config, now: () => now })).toMatchObject({ due: 1, completed: 1 })
    expect([...store.jobs.values()][0]).toMatchObject({ state: 'done', deletedRows: 12 })
    expect([...store.jobs.values()][0].uid).toBeUndefined()
    const deletion = statements.at(-1)!
    expect(deletion.sql).toBe('DELETE FROM `appstorecopilot.appstorecopilot_analytics.events` WHERE user_id = @uid OR visitor_id IN UNNEST(@visitor_ids)')
    expect(deletion.params).toEqual([
      { name: 'uid', type: 'STRING', value: 'user-delete' },
      { name: 'visitor_ids', type: 'ARRAY<STRING>', values: [visitor] },
    ])
    await expect(deleteUserAnalytics(query, config, "x' OR 1=1 --")).rejects.toThrow('INVALID_UID')
  })
})
