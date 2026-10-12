/**
 * Maps the `/oauth/login` failure reasons onto truthful, recoverable copy for
 * `/oauth/error`. Recovery links are built only from routes that already
 * exist and from an `external_auth_id` that passes the same validation the
 * login route applies; nothing here invents a redirect.
 */

/** Mirrors the guard in `app/oauth/login/route.ts`. */
export const OAUTH_EXTERNAL_AUTH_ID = /^[A-Za-z0-9_-]{10,200}$/

export const OAUTH_ERROR_REASONS = ['invalid_request', 'account_not_found', 'authorization_failed'] as const
export type OAuthErrorReason = typeof OAUTH_ERROR_REASONS[number]

export interface OAuthErrorView {
  /** Validated reason, or `unknown` when the query string carried anything else. */
  reason: OAuthErrorReason | 'unknown'
  /** Machine code shown in the support line. */
  code: string
  title: string
  /** One plain sentence about what went wrong. */
  explanation: string
  /** One plain sentence about how to recover. */
  whatToDo: string
  /** Primary recovery action, present only when a safe, existing route applies. */
  primary: { label: string; href: string } | null
}

type QueryValue = string | string[] | null | undefined

function first(value: QueryValue): string | null {
  const candidate = Array.isArray(value) ? value[0] : value
  return typeof candidate === 'string' && candidate.length > 0 ? candidate : null
}

export function isOAuthErrorReason(value: unknown): value is OAuthErrorReason {
  return typeof value === 'string' && (OAUTH_ERROR_REASONS as readonly string[]).includes(value)
}

export function validateExternalAuthId(value: QueryValue): string | null {
  const candidate = first(value)
  return candidate && OAUTH_EXTERNAL_AUTH_ID.test(candidate) ? candidate : null
}

/** The existing login route that finishes a WorkOS handoff for a validated ID. */
export function oauthRetryHref(externalAuthId: string): string {
  return `/oauth/login?external_auth_id=${encodeURIComponent(externalAuthId)}`
}

/** OAuth completion is a one-time server handoff and must not use Next client navigation. */
export function isOAuthLoginHandoff(path: string): boolean {
  try {
    const url = new URL(path, 'https://applistingagent.com')
    return url.origin === 'https://applistingagent.com' && url.pathname === '/oauth/login'
  } catch {
    return false
  }
}

export function describeOAuthError(params: { reason?: QueryValue; external_auth_id?: QueryValue }): OAuthErrorView {
  const rawReason = first(params.reason)
  const reason: OAuthErrorView['reason'] = isOAuthErrorReason(rawReason) ? rawReason : 'unknown'
  const externalAuthId = validateExternalAuthId(params.external_auth_id)
  const retry = externalAuthId ? { label: 'Try again', href: oauthRetryHref(externalAuthId) } : null
  const restart = 'Go back to ChatGPT, Claude, or your MCP client and start the connection again.'

  switch (reason) {
    case 'invalid_request':
      return {
        reason,
        code: reason,
        title: 'We couldn’t connect this agent.',
        explanation: 'The connection link from your agent was incomplete, so App Listing Agent couldn’t tell which connection to finish.',
        whatToDo: restart,
        primary: null,
      }
    case 'account_not_found':
      return {
        reason,
        code: reason,
        title: 'We couldn’t connect this agent.',
        explanation: 'You’re signed in, but this login doesn’t have an App Listing Agent workspace yet.',
        whatToDo: 'Sign out, sign in with the account that owns your apps, then start the connection again from your client.',
        primary: { label: 'Sign out and switch account', href: '/logout' },
      }
    case 'authorization_failed':
      return {
        reason,
        code: reason,
        title: 'We couldn’t connect this agent.',
        explanation: 'App Listing Agent couldn’t finish the handoff with the sign-in service.',
        whatToDo: retry
          ? 'This is usually temporary. Try again now; if it keeps failing, restart the connection from your client.'
          : `This is usually temporary. ${restart}`,
        primary: retry,
      }
    default:
      return {
        reason,
        code: rawReason ? rawReason.replace(/[^a-z0-9_-]/gi, '').slice(0, 40) || 'unknown' : 'unknown',
        title: 'We couldn’t connect this agent.',
        explanation: 'Something interrupted the connection before it finished.',
        whatToDo: retry ? 'Try again now, or restart the connection from your client.' : restart,
        primary: retry,
      }
  }
}
