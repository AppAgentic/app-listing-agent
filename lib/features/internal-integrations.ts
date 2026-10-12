import type { AccountContext } from '@/lib/org/context'
import type { ApiKeyScope } from '@/lib/firebase/firestore'
import {
  PUBLIC_LAUNCH_TOOL_NAMES,
  getRequiredScopeForPublicTool,
} from '@/lib/mcp/public-capabilities'

export { PUBLIC_LAUNCH_TOOL_NAMES, getRequiredScopeForPublicTool }

export type InternalIntegration = 'revenuecat' | 'gleap' | 'crashlytics'

/**
 * Public launch MCP surface.
 *
 * This is deliberately an allowlist rather than a blocklist: newly-added tools
 * remain internal until they are explicitly reviewed for public launch. The
 * public product is focused on creating and shipping the store presence, while
 * backend administration, monetization, analytics, experiments, and support
 * operations remain available only to allowlisted company accounts.
 */
const INTERNAL_ONLY_PAGE_SEGMENTS = [
  '/iap',
  '/analytics',
  '/support',
  '/purchases',
]

const INTERNAL_ONLY_PAGE_PATHS = [
  '/search',
]

const INTERNAL_ONLY_API_PREFIXES = [
  '/api/concierge/internal',
  '/api/appstore',
  '/api/crashlytics',
  '/api/credentials/firebase',
  '/api/firebase/',
  '/api/iap',
  '/api/playstore-iap',
  '/api/revenuecat/',
  '/api/stores/analytics/',
  '/api/subscriptions',
  '/api/support/',
  '/api/whop-project/',
]

const INTERNAL_ONLY_DOC_PREFIXES = [
  '/docs/api/iap',
  '/docs/api/revenuecat',
  '/docs/api/subscriptions',
  '/docs/mcp/create-iap-product',
  '/docs/mcp/create-offering',
  '/docs/mcp/create-revenuecat-app',
  '/docs/mcp/create-subscription',
  '/docs/mcp/iap-media',
  '/docs/mcp/iap-tools',
  '/docs/mcp/list-iap-products',
  '/docs/mcp/revenuecat-tools',
  '/docs/mcp/set-iap-pricing',
  '/docs/mcp/sync-iap-products',
  '/docs/mcp/sync-to-revenuecat',
  '/docs/mcp/update-iap-product',
]

const INTERNAL_ONLY_DESTRUCTIVE_API_PREFIXES = [
  '/api/custom-product-pages/',
  '/api/custom-store-listings/',
]

export const INTERNAL_PROJECT_FIELDS = [
  'revenueCatSecretKey',
  'revenueCatProjectId',
  'gleapApiToken',
  'gleapProjectId',
  'whopApiKey',
  'whopCompanyId',
  'whopWebhookSecret',
  'firebaseAppId',
  'firebaseAnalyticsPropertyId',
  'firebaseProjectId',
] as const

export function stripInternalProjectFields<T extends Record<string, unknown>>(project: T): T {
  const sanitized = { ...project }
  for (const field of INTERNAL_PROJECT_FIELDS) {
    delete sanitized[field]
  }
  return sanitized
}

const REVENUECAT_TOOL_NAMES = new Set([
  'get_revenuecat_api_keys',
  'list_revenuecat_apps',
  'create_revenuecat_app',
  'delete_revenuecat_app',
  'list_revenuecat_products',
  'create_revenuecat_product',
  'delete_revenuecat_product',
  'list_revenuecat_offerings',
  'get_revenuecat_offering',
  'create_revenuecat_offering',
  'update_revenuecat_offering',
  'delete_revenuecat_offering',
  'list_revenuecat_entitlements',
  'create_revenuecat_entitlement',
  'delete_revenuecat_entitlement',
  'update_revenuecat_entitlement',
  'create_revenuecat_package',
  'update_revenuecat_package',
  'delete_revenuecat_package',
  'list_revenuecat_packages',
  'attach_product_to_package',
  'detach_product_from_package',
  'sync_products_to_revenuecat',
  'create_offering_with_products',
])

const GLEAP_TOOL_NAMES = new Set([
  'list_gleap_tickets',
  'get_gleap_ticket',
  'search_gleap_tickets',
  'get_gleap_messages',
  'draft_gleap_reply',
  'send_gleap_reply',
  'update_gleap_ticket',
  'get_gleap_session',
  'get_gleap_session_activities',
  'list_gleap_help_articles',
  'create_gleap_help_article',
  'update_gleap_help_article',
  'create_gleap_collection',
  'delete_gleap_collection',
  'delete_gleap_help_article',
  'search_gleap_help_articles',
  'sync_gleap_ai_knowledge',
  'get_gleap_statistics',
  'get_gleap_support_overview',
])

const CRASHLYTICS_TOOL_NAMES = new Set([
  'list_crash_issues',
  'get_crash_issue',
  'list_crash_events',
  'get_crash_metrics',
  'update_crash_issue_state',
  'add_crash_note',
  'list_crash_notes',
  'get_top_crash_devices',
])

export const INTERNAL_INTEGRATION_TOOL_NAMES = [
  ...REVENUECAT_TOOL_NAMES,
  ...GLEAP_TOOL_NAMES,
  ...CRASHLYTICS_TOOL_NAMES,
] as const

function parseCsv(value?: string): string[] {
  return (value || '')
    .split(',')
    .map(item => item.trim().toLowerCase())
    .filter(Boolean)
}

export interface InternalIntegrationIdentity {
  email?: string | null
  userId?: string | null
  orgId?: string | null
}

export function isInternalCompanyEmail(email?: string | null): boolean {
  const normalizedEmail = email?.trim().toLowerCase()
  if (!normalizedEmail) return false

  const configuredEmails = parseCsv(process.env.INTERNAL_INTEGRATION_ALLOWED_EMAILS)
  if (configuredEmails.includes(normalizedEmail)) return true

  const domain = normalizedEmail.split('@')[1]
  if (!domain) return false

  const configuredDomains = parseCsv(process.env.INTERNAL_INTEGRATION_ALLOWED_DOMAINS)
  return configuredDomains.includes(domain)
}

export function isInternalIntegrationIdentity(identity: InternalIntegrationIdentity): boolean {
  const allowedUserIds = parseCsv(process.env.INTERNAL_INTEGRATION_ALLOWED_USER_IDS)
  if (identity.userId && allowedUserIds.includes(identity.userId.trim().toLowerCase())) {
    return true
  }

  const allowedOrgIds = parseCsv(process.env.INTERNAL_INTEGRATION_ALLOWED_ORG_IDS)
  if (identity.orgId && allowedOrgIds.includes(identity.orgId.trim().toLowerCase())) {
    return true
  }

  return isInternalCompanyEmail(identity.email)
}

export function hasInternalIntegrationAccess(
  subject: Pick<AccountContext, 'user' | 'userId' | 'orgId'> | { email?: string | null }
): boolean {
  if ('user' in subject) {
    return isInternalIntegrationIdentity({
      email: subject.user.email,
      userId: subject.userId,
      orgId: subject.orgId,
    })
  }

  return isInternalIntegrationIdentity({ email: subject.email })
}

export function getInternalIntegrationForTool(toolName: string): InternalIntegration | null {
  if (REVENUECAT_TOOL_NAMES.has(toolName)) return 'revenuecat'
  if (GLEAP_TOOL_NAMES.has(toolName)) return 'gleap'
  if (CRASHLYTICS_TOOL_NAMES.has(toolName)) return 'crashlytics'
  return null
}

export function isInternalIntegrationTool(toolName: string): boolean {
  return getInternalIntegrationForTool(toolName) !== null
}

export function isPublicLaunchTool(toolName: string): boolean {
  return PUBLIC_LAUNCH_TOOL_NAMES.has(toolName)
}

export function canApiKeyAccessTool(scopes: ApiKeyScope[], toolName: string): boolean {
  return scopes.includes('all') || scopes.includes(getRequiredScopeForPublicTool(toolName))
}

export function getRequiredScopeForApiPath(pathname: string, method = 'GET'): ApiKeyScope {
  const normalizedMethod = method.toUpperCase()
  if (normalizedMethod === 'GET' || normalizedMethod === 'HEAD' || normalizedMethod === 'OPTIONS') {
    return 'read'
  }

  if (
    pathname.includes('/publish') ||
    pathname.includes('/push') ||
    pathname.startsWith('/api/upload/appstore') ||
    pathname.startsWith('/api/upload/playstore') ||
    pathname.startsWith('/api/legal/push-to-appstore')
  ) {
    return 'publish'
  }

  if (pathname.includes('/translate')) return 'translate'
  if (
    pathname.startsWith('/api/screenshots') ||
    pathname.startsWith('/api/icons') ||
    pathname.includes('/screenshots')
  ) return 'screenshots'
  return 'write'
}

export function canApiKeyAccessApiPath(
  scopes: ApiKeyScope[],
  pathname: string,
  method = 'GET'
): boolean {
  return scopes.includes('all') || scopes.includes(getRequiredScopeForApiPath(pathname, method))
}

/**
 * Classifies routes that are unavailable to public launch accounts. The proxy
 * uses this as a defense-in-depth boundary; provider factories and MCP calls
 * still enforce their own account checks.
 */
export function isInternalOnlyPath(pathname: string, method = 'GET'): boolean {
  // Provider ingress for an already-configured internal Whop project. The
  // handler verifies the owning project account before accepting the event.
  if (pathname === '/api/whop-project/webhook') {
    return false
  }

  if (
    INTERNAL_ONLY_PAGE_PATHS.some(path => pathname === path || pathname.startsWith(`${path}/`))
  ) {
    return true
  }

  if (
    pathname === '/setup-calls' ||
    pathname.startsWith('/projects/') &&
    INTERNAL_ONLY_PAGE_SEGMENTS.some(segment => pathname.includes(`${segment}/`) || pathname.endsWith(segment))
  ) {
    return true
  }

  if (INTERNAL_ONLY_API_PREFIXES.some(prefix => pathname === prefix || pathname.startsWith(prefix))) {
    return true
  }

  if (INTERNAL_ONLY_DOC_PREFIXES.some(prefix => pathname === prefix || pathname.startsWith(`${prefix}/`))) {
    return true
  }

  return method.toUpperCase() === 'DELETE' &&
    INTERNAL_ONLY_DESTRUCTIVE_API_PREFIXES.some(prefix => pathname.startsWith(prefix))
}
