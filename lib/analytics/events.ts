/**
 * First-party product analytics: the shared allow-list used by the browser and the ingest route.
 * Follows the shared product-analytics event standard (v1). Nothing here may carry
 * free text, URLs, emails or content; every prop is an enum, a bounded integer or a boolean.
 *
 * App Listing Agent tracks without a consent gate (product decision, 2026-09-17). Privacy hygiene still applies:
 * no IP / user agent stored, allow-listed events and catalog ids only, uid only from a verified session.
 */

export const ANALYTICS_BODY_LIMIT = 2048
export const ANALYTICS_APP = 'appstorecopilot'

export const VISITOR_STORAGE_KEY = 'appstorecopilot_analytics_visitor'
export const SESSION_STORAGE_KEY = 'appstorecopilot_analytics_session'
export const SESSION_IDLE_MS = 30 * 60_000

export const ONBOARDING_STEPS = 2

const PLANS = ['starter', 'pro', 'business'] as const
const SELECTABLE_PLANS = [...PLANS, 'enterprise'] as const
const INTERVALS = ['month', 'year'] as const
const CTA_PLACEMENTS = ['nav', 'hero', 'final_cta', 'pricing', 'audit'] as const

/** Onboarding step choices (1-based step index). Step 1 = workspace saved, step 2 = agent connected. */
export const ONBOARDING_CHOICES: Record<number, readonly string[]> = {
  1: ['agent', 'dashboard'],
  2: ['connected'],
}

/** Core product actions recorded server-side, once per account (first occurrence). */
export const CORE_ACTIONS = [
  'agent_connected',
  'first_audit_completed',
  'mcp_tool_called',
  'appstore_connected',
  'play_connected',
  'app_added',
  'store_published',
  'screenshots_generated',
  'screenshots_uploaded',
  'icons_generated',
  'translations_used',
] as const
export type CoreAction = typeof CORE_ACTIONS[number]

export const SURFACES = [
  'home', 'login', 'onboarding', 'onboarding_stores', 'billing', 'book', 'dashboard', 'overview',
  'project', 'project_new', 'project_metadata', 'project_screenshots', 'project_icons', 'project_custom_pages',
  'project_legal', 'project_settings', 'project_credentials', 'project_other', 'settings', 'team', 'translate',
  'setup_calls', 'agents', 'agent_task', 'docs', 'use_cases', 'changelog', 'contact', 'privacy', 'terms',
  'legal_page', 'invite', 'search', 'screenshot_options', 'oauth_error', 'audit',
] as const
export type AnalyticsSurface = typeof SURFACES[number]

const PROJECT_SECTIONS: Record<string, AnalyticsSurface> = {
  metadata: 'project_metadata',
  screenshots: 'project_screenshots',
  icons: 'project_icons',
  'custom-pages': 'project_custom_pages',
  legal: 'project_legal',
  settings: 'project_settings',
}

/** Allow-listed surface key for a pathname. Ids in the path are never reported. */
export function surfaceForPath(pathname: string): AnalyticsSurface | null {
  const path = pathname.split(/[?#]/, 1)[0].replace(/\/+$/, '') || '/'
  const parts = path.split('/').filter(Boolean)
  const fixed: Record<string, AnalyticsSurface> = {
    '/': 'home', '/login': 'login', '/onboarding': 'onboarding', '/onboarding/stores': 'onboarding_stores',
    '/billing': 'billing', '/book': 'book', '/dashboard': 'dashboard', '/overview': 'overview',
    '/projects/new': 'project_new', '/settings': 'settings', '/team': 'team', '/team/create': 'team',
    '/translate': 'translate', '/setup-calls': 'setup_calls', '/agents': 'agents', '/changelog': 'changelog',
    '/contact': 'contact', '/privacy': 'privacy', '/terms': 'terms', '/search': 'search',
    '/screenshot-options': 'screenshot_options', '/oauth/error': 'oauth_error', '/audit': 'audit',
  }
  if (fixed[path]) return fixed[path]
  switch (parts[0]) {
    case 'docs': return 'docs'
    case 'use-cases': return 'use_cases'
    case 'agent-tasks': return 'agent_task'
    case 'invite': return 'invite'
    case 'legal': return 'legal_page'
    case 'projects': {
      if (parts.length === 2) return 'project'
      if (parts[2] === 'settings' && parts[3] === 'credentials') return 'project_credentials'
      return PROJECT_SECTIONS[parts[2]] ?? 'project_other'
    }
    default: return null
  }
}

type PropRule = readonly string[] | 'int' | 'bool' | 'choice'
interface EventRule { surface?: 'required'; step?: true; props: Record<string, PropRule>; required?: string[] }

/** Events a browser may send. purchase / subscription_canceled / refund / trial_started / core_action are server-side only. */
export const CLIENT_EVENTS: Record<string, EventRule> = {
  page_view: { surface: 'required', props: {} },
  onboarding_step: { step: true, props: { choice: 'choice' }, required: ['choice'] },
  onboarding_completed: { props: { steps: 'int' } },
  signup_started: { props: { method: ['password', 'google'] }, required: ['method'] },
  signin_completed: { props: { method: ['password', 'google'], new_account: 'bool' }, required: ['method'] },
  paywall_viewed: { props: { placement: ['pricing', 'billing', 'onboarding'] }, required: ['placement'] },
  plan_selected: { props: { plan: SELECTABLE_PLANS, interval: INTERVALS, placement: ['pricing', 'billing', 'onboarding'] }, required: ['plan'] },
  checkout_started: { props: { kind: ['subscription'], plan: PLANS, interval: INTERVALS }, required: ['kind'] },
  // App Listing Agent extras (CTA clicks and the onboarding setup prompt copy).
  signup_cta_clicked: { props: { placement: CTA_PLACEMENTS }, required: ['placement'] },
  booking_cta_clicked: { props: { placement: CTA_PLACEMENTS }, required: ['placement'] },
  setup_prompt_copied: { props: {} },
  // Free public listing audit (/audit): which store, and the score band (low < 60 <= mid < 85 <= high).
  listing_audit_completed: { props: { store: ['ios', 'android'], score_band: ['low', 'mid', 'high'], cached: 'bool' }, required: ['store', 'score_band'] },
}
export const SERVER_EVENTS = ['purchase', 'subscription_canceled', 'refund', 'trial_started', 'core_action'] as const

export type AnalyticsProps = Record<string, string | number | boolean>
export type AnalyticsDevice = 'mobile' | 'desktop' | 'tablet'
export interface ClientEvent {
  event: string
  surface: AnalyticsSurface | null
  step: number | null
  props: AnalyticsProps
  visitorId: string
  sessionId: string
  source: string | null
  device: AnalyticsDevice
}

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
export const CLICK_KINDS = ['gclid', 'fbclid', 'twclid', 'ttclid', 'msclkid'] as const
export const SOURCE_PATTERN = /^[a-z0-9_.-]{1,40}$/
const BODY_KEYS = new Set(['v', 'event', 'surface', 'step', 'props', 'visitor_id', 'session_id', 'source', 'device'])

/** Strict parse of one browser event. Unknown keys, props, values or shapes reject the whole request. */
export function parseClientEvent(value: unknown): ClientEvent | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const body = value as Record<string, unknown>
  if (Object.keys(body).some(key => !BODY_KEYS.has(key))) return null
  if (body.v !== 1 || typeof body.event !== 'string' || !Object.hasOwn(CLIENT_EVENTS, body.event)) return null
  const rule = CLIENT_EVENTS[body.event]
  if (typeof body.visitor_id !== 'string' || !UUID_PATTERN.test(body.visitor_id)) return null
  if (typeof body.session_id !== 'string' || !UUID_PATTERN.test(body.session_id)) return null
  if (!['mobile', 'desktop', 'tablet'].includes(body.device as string)) return null
  const source = body.source ?? null
  if (source !== null && (typeof source !== 'string' || !SOURCE_PATTERN.test(source))) return null
  const surface = body.surface ?? null
  if (surface !== null && !(SURFACES as readonly string[]).includes(surface as string)) return null
  if (rule.surface === 'required' && surface === null) return null
  const step = body.step ?? null
  if (rule.step
    ? !(Number.isInteger(step) && (step as number) >= 1 && (step as number) <= ONBOARDING_STEPS)
    : step !== null) return null
  const rawProps = body.props ?? {}
  if (!rawProps || typeof rawProps !== 'object' || Array.isArray(rawProps)) return null
  const props: AnalyticsProps = {}
  for (const [key, raw] of Object.entries(rawProps as Record<string, unknown>)) {
    const propRule = Object.hasOwn(rule.props, key) ? rule.props[key] : undefined
    if (!propRule) return null
    if (propRule === 'int') {
      if (!Number.isInteger(raw) || (raw as number) < 0 || (raw as number) > 1000) return null
    } else if (propRule === 'bool') {
      if (typeof raw !== 'boolean') return null
    } else if (propRule === 'choice') {
      if (typeof raw !== 'string' || !ONBOARDING_CHOICES[step as number]?.includes(raw)) return null
    } else if (typeof raw !== 'string' || !propRule.includes(raw)) {
      return null
    }
    props[key] = raw as string | number | boolean
  }
  if (rule.required?.some(key => !(key in props))) return null
  return {
    event: body.event,
    surface: surface as AnalyticsSurface | null,
    step: step as number | null,
    props,
    visitorId: body.visitor_id,
    sessionId: body.session_id,
    source: source as string | null,
    device: body.device as AnalyticsDevice,
  }
}

/**
 * Acquisition source from the stored marketing attribution (lib/marketing/attribution, captured on landing):
 * an allow-listed utm_source value, else the click-id KIND only (never the click-id value).
 */
export function analyticsSource(attribution: {
  source?: string; fbclid?: string; twclid?: string; gclid?: string; oppref?: string
} | null | undefined): string | null {
  if (!attribution) return null
  const utm = attribution.source?.trim().toLowerCase() ?? ''
  if (SOURCE_PATTERN.test(utm)) return utm
  if (attribution.gclid) return 'gclid'
  if (attribution.fbclid) return 'fbclid'
  if (attribution.twclid) return 'twclid'
  if (attribution.oppref) return 'oppref'
  return null
}

/** Maps a billing interval from the catalog ('monthly' / 'annual') to the standard interval. */
export function standardInterval(interval: string | null | undefined): 'month' | 'year' | null {
  return interval === 'monthly' ? 'month' : interval === 'annual' ? 'year' : null
}
