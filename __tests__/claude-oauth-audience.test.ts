import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const verify = vi.hoisted(() => vi.fn())
vi.mock('jose', () => ({ createRemoteJWKSet: vi.fn(() => 'test-jwks'), jwtVerify: verify }))
import { verifyWorkOSAccessToken, getWorkOSProtectedResourceMetadata } from '@/lib/auth/workos'
import { GET as metadata } from '@/app/.well-known/oauth-protected-resource/api/mcp/claude/route'
import { GET as userInfo } from '@/app/oauth/userinfo/route'
import { adminAuth, adminDb } from '@/lib/firebase/admin'
const base = 'https://applistingagent.com/api/mcp'
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('WORKOS_AUTHKIT_DOMAIN', 'https://auth.example.test')
  vi.stubEnv('WORKOS_MCP_RESOURCE', base)
  // Simulate signed-token audience enforcement at jose's verifier boundary.
  verify.mockImplementation(async (token, _key, options) => {
    if (token !== options.audience || options.issuer !== 'https://auth.example.test') throw Error('audience mismatch')
    return { payload: { sub: 'audience-user', aud: token, auth_time: 1000 } }
  })
})
afterEach(() => vi.unstubAllEnvs())
describe('explicit OAuth resource separation', () => {
  it('accepts each audience only on its configured endpoint', async () => {
    expect(await verifyWorkOSAccessToken(base)).not.toBeNull()
    expect(await verifyWorkOSAccessToken(base + '/claude', 'claude')).not.toBeNull()
    expect(await verifyWorkOSAccessToken(base, 'claude')).toBeNull()
    expect(await verifyWorkOSAccessToken(base + '/claude')).toBeNull()
    expect(await verifyWorkOSAccessToken('https://attacker.example')).toBeNull()
  })
  it('publishes separate exact protected-resource metadata', async () => {
    expect(getWorkOSProtectedResourceMetadata()?.resource).toBe(base)
    const response = metadata()
    expect((await response.json()).resource).toBe(base + '/claude')
  })
  it('UserInfo accepts Claude identity only after exact audience fallback and revocation check', async () => {
    vi.mocked(adminDb.collection).mockReturnValue({ doc: () => ({ get: async () => ({ exists: true, data: () => ({ oauthRevokedBefore: { toMillis: () => 500_000 } }) }) }) } as never)
    vi.mocked(adminAuth.getUser).mockResolvedValue({ uid: 'audience-user', email: 'verified@example.test', emailVerified: true } as never)
    const response = await userInfo(new Request('https://applistingagent.com/oauth/userinfo', { headers: { authorization: 'Bearer ' + base + '/claude' } }))
    expect(response.status).toBe(200)
    expect(verify.mock.calls.map(call => call[2].audience)).toEqual([base, base + '/claude'])
    expect(await response.json()).toEqual({ sub: 'audience-user', email: 'verified@example.test', email_verified: true })
  })
  it('still rejects revoked Claude tokens after the audience fallback', async () => {
    vi.mocked(adminDb.collection).mockReturnValue({ doc: () => ({ get: async () => ({ exists: true, data: () => ({ oauthRevokedBefore: { toMillis: () => 1_000_000 } }) }) }) } as never)
    const response = await userInfo(new Request('https://applistingagent.com/oauth/userinfo', { headers: { authorization: 'Bearer ' + base + '/claude' } }))
    expect(response.status).toBe(401)
    expect(adminAuth.getUser).not.toHaveBeenCalled()
  })
  it('does not use Firebase identity to rescue an unrelated audience', async () => {
    const response = await userInfo(new Request('https://applistingagent.com/oauth/userinfo', { headers: { authorization: 'Bearer https://attacker.example' } }))
    expect(response.status).toBe(401)
    expect(adminAuth.getUser).not.toHaveBeenCalled()
  })
})
