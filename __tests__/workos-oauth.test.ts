import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  completeWorkOSExternalAuthentication,
  getWorkOSAuthorizationChallenge,
  getWorkOSConfig,
  getWorkOSProtectedResourceMetadata,
  isWorkOSAccessRevoked,
  resolveWorkOSProjectScope,
  verifyWorkOSAccessToken,
  workOSAuthorityToScopes,
  WORKOS_AUTHORITY_CLAIM,
  WORKOS_PROJECT_CLAIM,
} from '@/lib/auth/workos'
import { getPublicCapabilityManifest } from '@/lib/mcp/capability-manifest'
import { TOOL_DEFINITIONS, decoratePublicToolDefinition } from '@/lib/mcp/server'
import { GET as getAuthorizationMetadata } from '@/app/.well-known/oauth-authorization-server/route'
import { GET as getProtectedResourceMetadata } from '@/app/.well-known/oauth-protected-resource/route'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function configureWorkOS() {
  vi.stubEnv('WORKOS_AUTHKIT_DOMAIN', 'https://auth.example.test')
  vi.stubEnv('WORKOS_API_KEY', 'test_api_key_not_a_secret')
  vi.stubEnv('WORKOS_MCP_RESOURCE', 'https://applistingagent.com/api/mcp')
}

describe('WorkOS Standalone Connect', () => {
  it('stays disabled until an AuthKit domain is configured', () => {
    vi.stubEnv('WORKOS_AUTHKIT_DOMAIN', '')
    vi.stubEnv('WORKOS_API_KEY', '')
    expect(getWorkOSConfig()).toBeNull()
    expect(getWorkOSProtectedResourceMetadata()).toBeNull()
    expect(getWorkOSAuthorizationChallenge()).toBeNull()
  })

  it('answers 404 for the OAuth discovery documents when WorkOS is not configured', async () => {
    vi.stubEnv('WORKOS_AUTHKIT_DOMAIN', '')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    expect(getProtectedResourceMetadata().status).toBe(404)
    expect((await getAuthorizationMetadata()).status).toBe(404)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('builds resource, documentation and challenge URLs from this deployment origin', () => {
    vi.stubEnv('WORKOS_AUTHKIT_DOMAIN', 'https://auth.example.test')
    vi.stubEnv('WORKOS_MCP_RESOURCE', '')
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://listings.example.org')
    expect(getWorkOSProtectedResourceMetadata()).toMatchObject({
      resource: 'https://listings.example.org/api/mcp',
      resource_documentation: 'https://listings.example.org/agents',
    })
    expect(getWorkOSAuthorizationChallenge('claude')).toContain(
      'resource_metadata="https://listings.example.org/.well-known/oauth-protected-resource/api/mcp/claude"'
    )
  })

  it('publishes standard protected-resource metadata and challenge', () => {
    configureWorkOS()
    expect(getWorkOSProtectedResourceMetadata()).toEqual({
      resource: 'https://applistingagent.com/api/mcp',
      authorization_servers: ['https://auth.example.test'],
      bearer_methods_supported: ['header'],
      scopes_supported: ['openid', 'profile', 'email', 'offline_access'],
      resource_documentation: 'https://applistingagent.com/agents',
    })
    expect(getWorkOSAuthorizationChallenge()).toContain(
      'resource_metadata="https://applistingagent.com/.well-known/oauth-protected-resource"'
    )
  })

  it('maps consent authority to least-privilege MCP scopes', () => {
    expect(workOSAuthorityToScopes('read')).toEqual(['read'])
    expect(workOSAuthorityToScopes('edit')).toEqual([
      'read', 'write', 'translate', 'screenshots',
    ])
    expect(workOSAuthorityToScopes('publish')).toEqual([
      'read', 'write', 'translate', 'screenshots', 'publish',
    ])
    expect(workOSAuthorityToScopes('forged')).toEqual(['read'])
  })

  it('revokes tokens issued at or before the account cutoff', () => {
    const revokedBefore = { toMillis: () => 2_000_000 }
    expect(isWorkOSAccessRevoked(revokedBefore, { iat: 1999 })).toBe(true)
    expect(isWorkOSAccessRevoked(revokedBefore, { iat: 2000 })).toBe(true)
    expect(isWorkOSAccessRevoked(revokedBefore, { iat: 2001 })).toBe(false)
    expect(isWorkOSAccessRevoked(revokedBefore, {})).toBe(true)
    expect(isWorkOSAccessRevoked(null, {})).toBe(false)
  })

  it('keeps refreshed tokens anchored to the original authentication time', () => {
    const revokedBefore = { toMillis: () => 2_000_000 }
    expect(isWorkOSAccessRevoked(revokedBefore, { auth_time: 1999, iat: 3000 })).toBe(true)
    expect(isWorkOSAccessRevoked(revokedBefore, { auth_time: 2001, iat: 3000 })).toBe(false)
  })

  it('locks an OAuth token to its consented project', () => {
    expect(resolveWorkOSProjectScope(null, 'project-one')).toEqual({
      projectId: 'project-one',
      error: null,
    })
    expect(resolveWorkOSProjectScope('project-one', 'project-one')).toEqual({
      projectId: 'project-one',
      error: null,
    })
    expect(resolveWorkOSProjectScope('project-two', 'project-one')).toEqual({
      projectId: null,
      error: 'OAuth token is scoped to another project',
    })
  })

  it('fails closed for a forged access token', async () => {
    configureWorkOS()
    await expect(verifyWorkOSAccessToken('forged.jwt.token')).resolves.toBeNull()
  })

  it('completes Firebase identity handoff with project and authority consent', async () => {
    configureWorkOS()
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      redirect_uri: 'https://auth.example.test/oauth2/continue?id=one',
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    const redirect = await completeWorkOSExternalAuthentication('ext_auth_123456789', {
      userId: 'firebase-user',
      email: 'user@example.com',
      displayName: 'Example User',
      plan: 'starter',
      onboardingCompleted: true,
    }, [{ id: 'project-one', name: 'Project One' }])

    expect(redirect).toBe('https://auth.example.test/oauth2/continue?id=one')
    const request = fetchMock.mock.calls[0]
    const body = JSON.parse(request[1].body)
    expect(body.user).toMatchObject({ id: 'firebase-user', email: 'user@example.com' })
    expect(body.user_consent_options).toEqual(expect.arrayContaining([
      expect.objectContaining({ claim: WORKOS_PROJECT_CLAIM }),
      expect.objectContaining({ claim: WORKOS_AUTHORITY_CLAIM }),
    ]))
  })

  it('rejects a completion redirect outside the configured AuthKit origin', async () => {
    configureWorkOS()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      redirect_uri: 'https://attacker.example/steal',
    }), { status: 200, headers: { 'content-type': 'application/json' } })))

    await expect(completeWorkOSExternalAuthentication('ext_auth_123456789', {
      userId: 'firebase-user',
      email: 'user@example.com',
      plan: 'starter',
      onboardingCompleted: true,
    }, [])).rejects.toThrow('unexpected redirect origin')
  })

  it('reports sanitized WorkOS completion details without leaking identities or handoff ids', async () => {
    configureWorkOS()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: 'invalid_request',
      message: 'External auth ID 01M14RV30BDXPSHWFXK3K3SXJY for user@example.com is invalid',
    }), { status: 400, headers: { 'content-type': 'application/json' } })))

    await expect(completeWorkOSExternalAuthentication('ext_auth_123456789', {
      userId: 'firebase-user',
      email: 'user@example.com',
      plan: 'starter',
      onboardingCompleted: true,
    }, [])).rejects.toThrow(
      'WorkOS completion failed with status 400 (invalid_request: External auth ID [redacted-id] for [redacted-email] is invalid)'
    )
  })

  it('advertises OAuth only when configured', () => {
    configureWorkOS()
    const manifest = getPublicCapabilityManifest()
    expect(manifest.authentication.oauth).toBe(true)
    expect(manifest.authentication.methods).toContain('oauth_2_1')
    expect(manifest.capabilities.every(tool => tool.securitySchemes?.[0]?.type === 'oauth2')).toBe(true)

    const tool = TOOL_DEFINITIONS.find(definition => definition.name === 'read_metadata')!
    expect(decoratePublicToolDefinition(tool).securitySchemes).toEqual([{
      type: 'oauth2',
      scopes: ['openid', 'email', 'offline_access'],
    }])
  })

  it('advertises the resource-bound UserInfo endpoint', async () => {
    configureWorkOS()
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        issuer: 'https://auth.example.test',
        registration_endpoint: 'https://auth.example.test/oauth2/register',
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        issuer: 'https://auth.example.test',
        userinfo_endpoint: 'https://auth.example.test/oauth2/userinfo',
      }), { status: 200 })))

    const response = await getAuthorizationMetadata()
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      issuer: 'https://auth.example.test',
      registration_endpoint: 'https://auth.example.test/oauth2/register',
      userinfo_endpoint: 'https://applistingagent.com/oauth/userinfo',
    })
  })
})
