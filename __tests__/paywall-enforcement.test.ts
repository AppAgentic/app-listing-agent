import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AccountContext } from '@/lib/org/context'

const mocks = vi.hoisted(() => ({ auth: vi.fn(), verify: vi.fn(), context: vi.fn(), next: vi.fn() }))
vi.mock('next/server', () => ({
  NextResponse: class extends Response {
    static json(body: unknown, init?: ResponseInit) { return new Response(JSON.stringify(body), { ...init, headers: { 'content-type': 'application/json', ...Object.fromEntries(new Headers(init?.headers).entries()) } }) }
    static next() { mocks.next(); return new Response(null, { status: 200, headers: { 'x-next': '1' } }) }
  },
}))
vi.mock('@/lib/api/auth', () => ({ authenticateRequest: mocks.auth }))
vi.mock('@/lib/firebase/admin', () => ({ adminAuth: { verifySessionCookie: mocks.verify }, adminDb: {} }))
vi.mock('@/lib/org/context', () => ({ getAccountContext: mocks.context, invalidateAccountContextCache: vi.fn() }))
import { proxy } from '@/proxy'
import { handleMCPRequest } from '@/lib/mcp/server'
import { LIVE_STRIPE_ACCOUNT_ID, SANDBOX_STRIPE_ACCOUNT_ID } from '@/lib/stripe/config'

const SANDBOX = SANDBOX_STRIPE_ACCOUNT_ID
const context = (billing?: Record<string, unknown>, userId = 'user-one'): AccountContext => ({
  type: 'personal', userId,
  user: { email: 'user@example.com', plan: 'free', organizationId: null, ...(billing ? { billing } : {}) } as never,
})
const trialing = { source: 'stripe', status: 'trialing', plan: 'pro', subscriptionId: 'sub_enforce00001', livemode: false, providerAccountId: SANDBOX }
const request = (path: string, init: { method?: string; cookie?: boolean; bearer?: boolean } = {}) => {
  const url = new URL(`https://applistingagent.com${path}`)
  const headers = new Headers()
  if (init.bearer) headers.set('authorization', 'Bearer asc_live_testkey')
  return {
    nextUrl: url, method: init.method ?? 'GET', headers,
    cookies: { get: (name: string) => (init.cookie && name === '__session' ? { value: 'cookie' } : undefined) },
  } as never
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('STRIPE_ACCOUNT_ID', SANDBOX)
  vi.stubEnv('STRIPE_LIVEMODE', 'false')
  vi.stubEnv('INTERNAL_INTEGRATION_ALLOWED_USER_IDS', 'comp-solo')
  mocks.verify.mockResolvedValue({ uid: 'user-one' })
})
afterEach(() => vi.unstubAllEnvs())

describe('hard paywall enforcement in the request proxy', () => {
  it('returns an agent-actionable 402 for an unentitled dashboard session on a product API', async () => {
    mocks.context.mockResolvedValue(context())
    const response = await proxy(request('/api/projects', { cookie: true }))
    expect(response.status).toBe(402)
    const body = await response.json()
    expect(body).toMatchObject({ code: 'payment_required', billingUrl: expect.stringContaining('/billing?reason=subscription_required') })
    expect(body.nextStep).toMatch(/7-day free trial/)
  })

  it('blocks an unentitled API key on a product API', async () => {
    const ctx = context()
    mocks.auth.mockResolvedValue({ authenticated: true, context: ctx, apiKeyScopes: ['all'] })
    mocks.context.mockResolvedValue(ctx)
    expect((await proxy(request('/api/screenshots/generate', { method: 'POST', bearer: true }))).status).toBe(402)
  })

  it('lets trialing and comp accounts through', async () => {
    mocks.context.mockResolvedValue(context(trialing))
    expect((await proxy(request('/api/projects', { cookie: true }))).status).toBe(200)
    mocks.context.mockResolvedValue(context(undefined, 'comp-solo'))
    mocks.verify.mockResolvedValue({ uid: 'comp-solo' })
    expect((await proxy(request('/api/projects', { cookie: true }))).status).toBe(200)
  })

  it('blocks an account whose subscription ended', async () => {
    mocks.context.mockResolvedValue(context({ ...trialing, status: 'cancelled', plan: 'free' }))
    expect((await proxy(request('/api/projects', { cookie: true }))).status).toBe(402)
  })

  it.each([['/api/billing/checkout', 'POST'], ['/api/account', 'DELETE'], ['/api/onboarding', 'GET'], ['/api/subscription', 'GET'],
    ['/api/webhooks/stripe', 'POST'], ['/api/health', 'GET'], ['/api/public/events', 'POST'], ['/api/mcp', 'POST']])('keeps %s reachable when unpaid', async (path, method) => {
    mocks.context.mockResolvedValue(context())
    expect((await proxy(request(path, { method, cookie: true }))).status).toBe(200)
  })

  it('leaves unauthenticated requests to the route (their own 401)', async () => {
    expect((await proxy(request('/api/projects'))).status).toBe(200)
    expect(mocks.context).not.toHaveBeenCalled()
  })
})

describe('hard paywall enforcement for MCP tools', () => {
  it('returns payment_required for product tools', async () => {
    const ctx = context()
    mocks.context.mockResolvedValue(ctx)
    const blocked = await handleMCPRequest({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'list_importable_apps', arguments: {} } }, ctx)
    const result = blocked.response.result as { structuredContent?: Record<string, unknown>; content: Array<{ text: string }> }
    expect(result.structuredContent).toMatchObject({ success: false, code: 'payment_required', billingUrl: 'https://applistingagent.com/billing?reason=subscription_required' })
    expect(result.content[0].text).toContain('payment_required')
  })

  it('lets a trialing account call product tools past the paywall', async () => {
    const ctx = context(trialing)
    mocks.context.mockResolvedValue(ctx)
    const called = await handleMCPRequest({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'list_importable_apps', arguments: {} } }, ctx)
    const text = JSON.stringify(called.response)
    expect(text).not.toContain('payment_required')
  })
})

describe('self-hosted installs (SELF_HOSTED=true): billing off at every enforcement point', () => {
  it('lets an account with no subscription through the proxy and MCP tools/call', async () => {
    vi.stubEnv('SELF_HOSTED', 'true')
    const ctx = context()
    mocks.context.mockResolvedValue(ctx)
    expect((await proxy(request('/api/projects', { cookie: true }))).status).toBe(200)
    const called = await handleMCPRequest({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'list_importable_apps', arguments: {} } }, ctx)
    expect(JSON.stringify(called.response)).not.toContain('payment_required')
  })

  it('keeps the 402 when SELF_HOSTED=true is set on a live Stripe deployment', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.stubEnv('SELF_HOSTED', 'true')
    vi.stubEnv('STRIPE_ACCOUNT_ID', LIVE_STRIPE_ACCOUNT_ID)
    vi.stubEnv('STRIPE_LIVEMODE', 'true')
    mocks.context.mockResolvedValue(context())
    expect((await proxy(request('/api/projects', { cookie: true }))).status).toBe(402)
  })
})
