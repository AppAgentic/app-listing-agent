import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const mocks = vi.hoisted(() => ({ message: {} as Record<string, unknown>, auth: vi.fn(), dispatch: vi.fn(), project: vi.fn() }))
vi.mock('@/lib/api/auth', () => ({ authenticateRequest: mocks.auth }))
vi.mock('@/lib/mcp/server', () => ({ handleMCPRequest: mocks.dispatch }))
vi.mock('@/lib/org/context', () => ({ getProjectContext: mocks.project }))
vi.mock('@/lib/mcp/request-security', () => ({
  checkMCPRateLimit: vi.fn(async () => ({})), logMCPAuditEvent: vi.fn(),
  readBoundedMCPRequest: async () => ({ message: mocks.message }),
  secureMCPResponse: (response: Response) => response,
}))
import { POST as defaultPost, GET as defaultGet } from '@/app/api/mcp/route'
import { POST as claudePost, GET as claudeGet } from '@/app/api/mcp/claude/route'
beforeEach(() => {
  vi.clearAllMocks()
  mocks.auth.mockResolvedValue({ authenticated: true, context: { userId: 'route-user' }, oauthProjectId: 'project-a', apiKeyScopes: ['read'] })
  mocks.project.mockResolvedValue({})
  mocks.dispatch.mockResolvedValue({ response: { jsonrpc: '2.0', id: 1, result: {} } })
})
describe('trusted route profile forwarding', () => {
  it.each([['default', defaultPost, undefined], ['claude', claudePost, 'claude']] as const)('%s forwards profile for calls and notifications, ignoring spoofed body identity', async (_label, handler, profile) => {
    for (const method of ['tools/list', 'notifications/initialized']) {
      const request = new NextRequest('https://applistingagent.com/api/mcp', {
        method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
        body: JSON.stringify({ jsonrpc: '2.0', ...(method === 'tools/list' ? { id: 1 } : {}), method, params: { connectorProfile: profile ? undefined : 'claude', clientInfo: { name: 'claude' } } }),
      })
      Object.defineProperty(request, 'nextUrl', { value: new URL('https://applistingagent.com/api/mcp') })
      mocks.message = { jsonrpc: '2.0', ...(method === 'tools/list' ? { id: 1 } : {}), method, params: { connectorProfile: profile ? undefined : 'claude', clientInfo: { name: 'claude' } } }
      const response = await handler(request)
      expect(response.status).toBe(method === 'tools/list' ? 200 : 202)
      expect(mocks.auth).toHaveBeenLastCalledWith(request, profile)
      expect(mocks.dispatch.mock.calls.at(-1)?.[3]).toEqual({ connectorProfile: profile, apiKeyScopes: ['read'], projectScopeLocked: true })
    }
  })
  it.each([['default', defaultGet, '/.well-known/oauth-protected-resource"'], ['claude', claudeGet, '/.well-known/oauth-protected-resource/api/mcp/claude"']] as const)('%s GET rejects with its exact metadata challenge', async (_label, handler, path) => {
    vi.stubEnv('WORKOS_AUTHKIT_DOMAIN', 'https://auth.example.test')
    mocks.auth.mockResolvedValue({ authenticated: false })
    const response = await handler(new NextRequest('https://applistingagent.com/api/mcp', { headers: { accept: 'text/event-stream' } }))
    expect(response.status).toBe(401)
    expect(response.headers.get('www-authenticate')).toContain(path)
    vi.unstubAllEnvs()
  })
})
