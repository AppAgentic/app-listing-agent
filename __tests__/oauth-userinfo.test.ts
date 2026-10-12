import { beforeEach, describe, expect, it, vi } from 'vitest'
import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { GET, OPTIONS, POST } from '@/app/oauth/userinfo/route'
import * as workos from '@/lib/auth/workos'

describe('OAuth UserInfo', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.clearAllMocks()
  })

  it('rejects requests without a bearer token', async () => {
    const response = await GET(new Request('https://applistingagent.com/oauth/userinfo'))
    expect(response.status).toBe(401)
    expect(response.headers.get('www-authenticate')).toContain('invalid_token')
  })

  it.each([GET, POST])('returns the verified Firebase identity for a valid resource token', async handler => {
    vi.spyOn(workos, 'verifyWorkOSAccessToken').mockResolvedValue({
      userId: 'reviewer-user',
      projectId: 'openai-review-atlas-habit',
      scopes: ['read', 'write'],
      payload: { sub: 'reviewer-user', auth_time: 1000, iat: 1000 },
    })
    vi.mocked(adminDb.collection).mockReturnValue({
      doc: vi.fn(() => ({
        get: vi.fn().mockResolvedValue({
          exists: true,
          data: () => ({ email: 'reviewer@example.com' }),
        }),
      })),
    } as never)
    vi.mocked(adminAuth.getUser).mockResolvedValue({
      uid: 'reviewer-user',
      email: 'reviewer@example.com',
      emailVerified: true,
    } as never)

    const response = await handler(new Request('https://applistingagent.com/oauth/userinfo', {
      method: handler === POST ? 'POST' : 'GET',
      headers: { authorization: 'Bearer signed-resource-token' },
    }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      sub: 'reviewer-user',
      email: 'reviewer@example.com',
      email_verified: true,
    })
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it('rejects a token at the account revocation cutoff', async () => {
    vi.spyOn(workos, 'verifyWorkOSAccessToken').mockResolvedValue({
      userId: 'reviewer-user',
      scopes: ['read'],
      payload: { sub: 'reviewer-user', auth_time: 1000, iat: 2000 },
    })
    vi.mocked(adminDb.collection).mockReturnValue({
      doc: vi.fn(() => ({
        get: vi.fn().mockResolvedValue({
          exists: true,
          data: () => ({ oauthRevokedBefore: { toMillis: () => 1_000_000 } }),
        }),
      })),
    } as never)

    const response = await POST(new Request('https://applistingagent.com/oauth/userinfo', {
      method: 'POST',
      headers: { authorization: 'Bearer revoked-resource-token' },
    }))

    expect(response.status).toBe(401)
    expect(adminAuth.getUser).not.toHaveBeenCalled()
  })

  it('allows browser preflight without credentials', async () => {
    const response = await OPTIONS()
    expect(response.status).toBe(204)
    expect(response.headers.get('access-control-allow-methods')).toContain('POST')
  })
})
