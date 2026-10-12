import { describe, expect, it, vi } from 'vitest'
vi.unmock('next/server')
import { NextRequest } from 'next/server'
vi.mock('@/lib/api/auth', () => ({ authenticateRequest: vi.fn() }))
vi.mock('@/lib/firebase/admin', () => ({ adminAuth: {} }))
vi.mock('@/lib/features/internal-integrations', () => ({
  canApiKeyAccessApiPath: () => false,
  hasInternalIntegrationAccess: () => false,
  isInternalIntegrationIdentity: () => false,
  isInternalOnlyPath: (path: string) => path.startsWith('/internal'),
}))
import { proxy } from '@/proxy'

describe('trusted request navigation hints', () => {
  it('overwrites spoofed billing hints with the actual protected route', async () => {
    const response = await proxy(new NextRequest('https://applistingagent.com/projects', { headers: { 'x-app-path': '/billing' } }))
    expect(response.headers.get('x-middleware-request-x-app-path')).toBe('/projects')
    expect(response.headers.get('x-app-path')).toBeNull()
  })
  it('retains billing plan and interval on the forwarded request', async () => {
    const response = await proxy(new NextRequest('https://applistingagent.com/billing?plan=pro&interval=annual'))
    expect(response.headers.get('x-middleware-request-x-app-path')).toBe('/billing?plan=pro&interval=annual')
  })
  it('does not bypass internal access restrictions', async () => {
    const response = await proxy(new NextRequest('https://applistingagent.com/internal', { headers: { 'x-app-path': '/billing' } }))
    expect(response.status).toBe(404)
  })
})
