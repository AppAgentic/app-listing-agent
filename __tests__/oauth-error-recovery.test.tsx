import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import {
  describeOAuthError,
  isOAuthLoginHandoff,
  oauthRetryHref,
  validateExternalAuthId,
} from '@/lib/auth/oauth-error'
import OAuthErrorPage from '@/app/oauth/error/page'

vi.mock('next/server', () => ({
  NextResponse: {
    redirect: (url: URL | string) => new Response(null, { status: 307, headers: { location: String(url) } }),
    json: (body: unknown, init?: ResponseInit) => new Response(JSON.stringify(body), init),
  },
}))

const sessionMock = vi.hoisted(() => ({ getSession: vi.fn() }))
const contextMock = vi.hoisted(() => ({ getAccountContext: vi.fn(), getProjectsCollection: vi.fn() }))
const workosMock = vi.hoisted(() => ({ completeWorkOSExternalAuthentication: vi.fn() }))
vi.mock('@/lib/auth/session', () => sessionMock)
vi.mock('@/lib/org/context', () => contextMock)
vi.mock('@/lib/auth/workos', () => workosMock)

import { GET as oauthLogin } from '@/app/oauth/login/route'

const VALID_ID = 'ext_auth_123456789'

function loginRequest(query: string, origin = 'https://applistingagent.com') {
  const url = `${origin}/oauth/login${query}`
  return { url, nextUrl: new URL(url) } as never
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('OAuth error mapping', () => {
  it('validates the external auth id with the login route rule', () => {
    expect(validateExternalAuthId(VALID_ID)).toBe(VALID_ID)
    expect(validateExternalAuthId([VALID_ID, 'other'])).toBe(VALID_ID)
    expect(validateExternalAuthId('short')).toBeNull()
    expect(validateExternalAuthId('has spaces and <html>')).toBeNull()
    expect(validateExternalAuthId(undefined)).toBeNull()
    expect(oauthRetryHref('a b/c')).toBe('/oauth/login?external_auth_id=a%20b%2Fc')
    expect(isOAuthLoginHandoff(`/oauth/login?external_auth_id=${VALID_ID}`)).toBe(true)
    expect(isOAuthLoginHandoff('/dashboard')).toBe(false)
    expect(isOAuthLoginHandoff('https://attacker.example/oauth/login')).toBe(false)
  })

  it('never offers a retry for a malformed request', () => {
    const view = describeOAuthError({ reason: 'invalid_request', external_auth_id: VALID_ID })
    expect(view.reason).toBe('invalid_request')
    expect(view.primary).toBeNull()
    expect(view.whatToDo).toMatch(/start the connection again/i)
  })

  it('offers a real retry through the existing login route when the handoff failed', () => {
    const view = describeOAuthError({ reason: 'authorization_failed', external_auth_id: VALID_ID })
    expect(view.primary).toEqual({ label: 'Try again', href: `/oauth/login?external_auth_id=${VALID_ID}` })
    expect(view.whatToDo).toMatch(/usually temporary/i)

    const withoutId = describeOAuthError({ reason: 'authorization_failed' })
    expect(withoutId.primary).toBeNull()
    expect(withoutId.whatToDo).toMatch(/your MCP client/i)
  })

  it('sends a signed-in user without a workspace to switch accounts', () => {
    const view = describeOAuthError({ reason: 'account_not_found', external_auth_id: VALID_ID })
    expect(view.primary).toEqual({ label: 'Sign out and switch account', href: '/logout' })
    expect(view.explanation).toMatch(/doesn’t have an App Listing Agent workspace/i)
  })

  it('degrades unknown or hostile reasons to a safe generic view', () => {
    const view = describeOAuthError({ reason: '<script>alert(1)</script>' })
    expect(view.reason).toBe('unknown')
    expect(view.code).toBe('scriptalert1script')
    expect(view.primary).toBeNull()
    expect(describeOAuthError({}).code).toBe('unknown')
    expect(describeOAuthError({ reason: ['invalid_request'] }).reason).toBe('invalid_request')
  })
})

describe('OAuth error page', () => {
  it('renders reason-specific copy, the retry action, and the nothing-shared reassurance', async () => {
    render(await OAuthErrorPage({
      searchParams: Promise.resolve({ reason: 'authorization_failed', external_auth_id: VALID_ID }),
    }))

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('We couldn’t connect this agent.')
    expect(screen.getByText(/couldn’t finish the handoff/i)).toBeTruthy()
    expect(screen.getByText(/Nothing was shared/i)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Try again' }).getAttribute('href'))
      .toBe(`/oauth/login?external_auth_id=${VALID_ID}`)
    expect(screen.getByRole('link', { name: /setup guide/i }).getAttribute('href')).toBe('/docs/mcp')
    expect(screen.getByText(/Error: authorization_failed/)).toBeTruthy()
  })

  it('omits the retry action when there is nothing safe to retry', async () => {
    render(await OAuthErrorPage({ searchParams: Promise.resolve({ reason: 'invalid_request' }) }))

    expect(screen.queryByRole('link', { name: 'Try again' })).toBeNull()
    expect(screen.getByRole('link', { name: /setup guide/i })).toBeTruthy()
    expect(screen.getByText(/incomplete/i)).toBeTruthy()
  })
})

describe('OAuth login route recovery plumbing', () => {
  it('reports a malformed request without echoing the invalid id', async () => {
    const response = await oauthLogin(loginRequest('?external_auth_id=bad%20id'))
    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe('https://applistingagent.com/oauth/error?reason=invalid_request')
  })

  it('forwards the validated id so the error page can retry the same handoff', async () => {
    sessionMock.getSession.mockResolvedValue({ userId: 'user-1', email: 'user@example.com', plan: 'starter' })
    contextMock.getAccountContext.mockResolvedValue(null)

    const response = await oauthLogin(loginRequest(`?external_auth_id=${VALID_ID}`))
    expect(response.headers.get('location'))
      .toBe(`https://applistingagent.com/oauth/error?reason=account_not_found&external_auth_id=${VALID_ID}`)
  })

  it('maps a failed WorkOS completion to authorization_failed with a retryable id', async () => {
    sessionMock.getSession.mockResolvedValue({ userId: 'user-1', email: 'user@example.com', plan: 'starter' })
    contextMock.getAccountContext.mockResolvedValue({ type: 'personal', userId: 'user-1' })
    contextMock.getProjectsCollection.mockReturnValue({
      orderBy: () => ({ limit: () => ({ get: async () => ({ docs: [] }) }) }),
    })
    workosMock.completeWorkOSExternalAuthentication.mockRejectedValue(new Error('WorkOS completion failed with status 500'))
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const response = await oauthLogin(loginRequest(`?external_auth_id=${VALID_ID}`))
    expect(response.headers.get('location'))
      .toBe(`https://applistingagent.com/oauth/error?reason=authorization_failed&external_auth_id=${VALID_ID}`)
  })

  it('still sends signed-out users to login with a return path', async () => {
    sessionMock.getSession.mockResolvedValue(null)
    const response = await oauthLogin(loginRequest(`?external_auth_id=${VALID_ID}`))
    expect(response.headers.get('location'))
      .toBe(`https://applistingagent.com/login?returnTo=${encodeURIComponent(`/oauth/login?external_auth_id=${VALID_ID}`)}`)
  })

  it('never leaks the internal App Hosting origin into browser redirects', async () => {
    sessionMock.getSession.mockResolvedValue(null)
    const response = await oauthLogin(loginRequest(
      `?external_auth_id=${VALID_ID}`,
      'https://0.0.0.0:8080'
    ))

    expect(response.headers.get('location'))
      .toBe(`https://applistingagent.com/login?returnTo=${encodeURIComponent(`/oauth/login?external_auth_id=${VALID_ID}`)}`)
  })
})
