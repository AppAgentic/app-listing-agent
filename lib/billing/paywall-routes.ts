/**
 * Routes reachable without paid product access (hard paywall). Everything else under /api requires a
 * trialing/active/past_due subscription or a comp entitlement once the caller is identified. Keep this
 * list small and explicit; it is covered by __tests__/paywall.test.ts.
 */
const UNPAID_API_PREFIXES = [
  '/api/auth',            // sign-in, sign-out, signup eligibility
  '/api/onboarding',      // workspace creation, agent pairing, trial step state
  '/api/billing',         // checkout, portal, reconcile (cron-secret)
  '/api/subscription',    // billing page and paywall status
  '/api/usage',           // billing page allowance display
  '/api/webhooks',        // Stripe webhook (signature-verified)
  '/api/public',          // first-party analytics ingest
  '/api/analytics',       // analytics maintenance (cron-secret)
  '/api/health',
  '/api/hello',
  '/api/admin-mcp',       // admin key auth
  '/api/account',         // account deletion (DELETE /api/account)
  '/api/settings',        // account settings page (API key is internal-only anyway)
  '/api/oauth',           // agent/connector OAuth handshakes
  '/api/waitlist',
  '/api/concierge',       // setup-call booking and lead events
  '/api/capabilities',    // public capability manifest
  '/api/org/invite',      // accepting a workspace invite
  '/api/mcp',             // gated per tool inside the MCP server
  '/api/whop-project/webhook', // customer Whop store ingress (per-project signature, no user session)
]

function matchesPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`)
}

export function isUnpaidApiPath(pathname: string, method = 'GET'): boolean {
  // Account credentials are store credentials (product data), not account deletion.
  if (matchesPrefix(pathname, '/api/account/credentials')) return false
  void method
  return UNPAID_API_PREFIXES.some(prefix => matchesPrefix(pathname, prefix))
}

/** Dashboard pages an unpaid, signed-in user may still open (account management and deletion). */
const UNPAID_PAGE_PREFIXES = ['/settings']

export function isUnpaidPagePath(pathname: string): boolean {
  return UNPAID_PAGE_PREFIXES.some(prefix => matchesPrefix(pathname, prefix))
}

/** MCP tools callable without paid access: status/onboarding so an agent can explain the paywall. */
export const UNPAID_MCP_TOOLS = new Set(['get_onboarding_status'])
