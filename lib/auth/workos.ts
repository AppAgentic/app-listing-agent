import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose'
import type { ApiKeyScope } from '@/lib/firebase/firestore'
import type { ConnectorProfile } from '@/lib/mcp/connector-profile'
import type { SessionUser } from '@/lib/auth/session'
import { appOrigin, appUrl } from '@/lib/routing/app-url'

export const WORKOS_PROJECT_CLAIM = 'https://appstorecopilot.com/claims/project_id'
export const WORKOS_AUTHORITY_CLAIM = 'https://appstorecopilot.com/claims/authority'

export interface WorkOSConfig {
  apiKey?: string
  issuer: string
  resource: string
}

export interface WorkOSProjectChoice {
  id: string
  name: string
}

export interface WorkOSAccess {
  userId: string
  email?: string
  projectId?: string
  scopes: ApiKeyScope[]
  payload: JWTPayload
}

interface WorkOSCompletionPayload {
  redirect_uri?: string
  error?: string
  code?: string
  message?: string
  error_description?: string
}

let remoteJwks: ReturnType<typeof createRemoteJWKSet> | null = null
let remoteJwksIssuer: string | null = null

export function getWorkOSConfig(options: { requireApiKey?: boolean; connectorProfile?: ConnectorProfile } = {}): WorkOSConfig | null {
  const domain = process.env.WORKOS_AUTHKIT_DOMAIN?.trim()
  const apiKey = process.env.WORKOS_API_KEY?.trim()
  if (!domain || (options.requireApiKey && !apiKey)) return null

  try {
    const issuer = new URL(domain).origin
    const resource = new URL(
      process.env.WORKOS_MCP_RESOURCE?.trim() || '/api/mcp',
      appOrigin()
    ).toString()
    return { apiKey, issuer, resource: options.connectorProfile === 'claude'
      ? new URL('/api/mcp/claude', resource).toString()
      : resource }
  } catch {
    return null
  }
}

export function getWorkOSProtectedResourceMetadata(connectorProfile?: ConnectorProfile) {
  const config = getWorkOSConfig({ connectorProfile })
  if (!config) return null

  return {
    resource: config.resource,
    authorization_servers: [config.issuer],
    bearer_methods_supported: ['header'],
    scopes_supported: ['openid', 'profile', 'email', 'offline_access'],
    resource_documentation: connectorProfile === 'claude'
      ? appUrl('/agents#claude')
      : appUrl('/agents'),
  }
}

export function getWorkOSAuthorizationChallenge(connectorProfile?: ConnectorProfile): string | null {
  if (!getWorkOSConfig()) return null
  return [
    'Bearer error="unauthorized"',
    'error_description="Authorization needed"',
    connectorProfile === 'claude'
      ? `resource_metadata="${appUrl('/.well-known/oauth-protected-resource/api/mcp/claude')}"`
      : `resource_metadata="${appUrl('/.well-known/oauth-protected-resource')}"`,
  ].join(', ')
}

export function workOSAuthorityToScopes(authority: unknown): ApiKeyScope[] {
  switch (authority) {
    case 'publish':
      return ['read', 'write', 'translate', 'screenshots', 'publish']
    case 'edit':
      return ['read', 'write', 'translate', 'screenshots']
    default:
      return ['read']
  }
}

export function isWorkOSAccessRevoked(
  revokedBefore: { toMillis(): number } | null | undefined,
  payload: Pick<JWTPayload, 'iat'> & { auth_time?: unknown }
): boolean {
  if (!revokedBefore) return false
  // `iat` advances when a refresh token is exchanged, while AuthKit's
  // `auth_time` remains anchored to the active authentication. Comparing the
  // cutoff to auth_time prevents a refresh token from bypassing account-level
  // revocation. Fail closed when neither claim is usable.
  const authenticationTime = typeof payload.auth_time === 'number'
    ? payload.auth_time
    : payload.iat
  if (typeof authenticationTime !== 'number' || !Number.isFinite(authenticationTime)) return true
  return authenticationTime * 1000 <= revokedBefore.toMillis()
}

export function resolveWorkOSProjectScope(
  requestedProjectId: string | null,
  enforcedProjectId?: string
): { projectId: string | null; error: string | null } {
  if (enforcedProjectId && requestedProjectId && requestedProjectId !== enforcedProjectId) {
    return { projectId: null, error: 'OAuth token is scoped to another project' }
  }
  return { projectId: enforcedProjectId || requestedProjectId, error: null }
}

function getRemoteJwks(issuer: string) {
  if (!remoteJwks || remoteJwksIssuer !== issuer) {
    remoteJwks = createRemoteJWKSet(new URL('/oauth2/jwks', issuer))
    remoteJwksIssuer = issuer
  }
  return remoteJwks
}

export async function verifyWorkOSAccessToken(token: string, connectorProfile?: ConnectorProfile): Promise<WorkOSAccess | null> {
  const config = getWorkOSConfig({ connectorProfile })
  if (!config) return null

  try {
    const { payload } = await jwtVerify(token, getRemoteJwks(config.issuer), {
      issuer: config.issuer,
      audience: config.resource,
    })
    if (!payload.sub) return null

    return {
      userId: payload.sub,
      email: typeof payload.email === 'string' ? payload.email : undefined,
      projectId: typeof payload[WORKOS_PROJECT_CLAIM] === 'string'
        ? payload[WORKOS_PROJECT_CLAIM] as string
        : undefined,
      scopes: workOSAuthorityToScopes(payload[WORKOS_AUTHORITY_CLAIM]),
      payload,
    }
  } catch {
    return null
  }
}

export async function completeWorkOSExternalAuthentication(
  externalAuthId: string,
  user: SessionUser,
  projects: WorkOSProjectChoice[]
): Promise<string> {
  const config = getWorkOSConfig({ requireApiKey: true })
  if (!config?.apiKey) throw new Error('WorkOS is not configured')

  const userConsentOptions: Array<Record<string, unknown>> = []
  if (projects.length > 0) {
    userConsentOptions.push({
      claim: WORKOS_PROJECT_CLAIM,
      type: 'enum',
      label: 'App workspace',
      choices: projects.slice(0, 100).map(project => ({
        value: project.id,
        label: project.name,
      })),
    })
  }
  userConsentOptions.push({
    claim: WORKOS_AUTHORITY_CLAIM,
    type: 'enum',
    label: 'Agent authority',
    choices: [
      { value: 'read', label: 'Review only' },
      { value: 'edit', label: 'Create and edit drafts' },
      { value: 'publish', label: 'Create, edit, and request publishing' },
    ],
  })

  const response = await fetch('https://api.workos.com/authkit/oauth2/complete', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      external_auth_id: externalAuthId,
      user: {
        id: user.userId,
        email: user.email,
        first_name: user.displayName || undefined,
        metadata: { appstorecopilot_plan: user.plan },
      },
      user_consent_options: userConsentOptions,
    }),
    cache: 'no-store',
  })

  const payload = await response.json().catch(() => null) as WorkOSCompletionPayload | null
  if (!response.ok || !payload?.redirect_uri) {
    const detail = [
      payload?.error || payload?.code,
      payload?.error_description || payload?.message,
    ]
      .filter((value): value is string => typeof value === 'string' && value.length > 0)
      .join(': ')
      .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '[redacted-email]')
      .replace(/\b(?:ext_auth_|01)[A-Za-z0-9_-]{8,}\b/g, '[redacted-id]')
      .slice(0, 240)
    throw new Error(`WorkOS completion failed with status ${response.status}${detail ? ` (${detail})` : ''}`)
  }

  const redirect = new URL(payload.redirect_uri)
  if (redirect.origin !== config.issuer) {
    throw new Error('WorkOS returned an unexpected redirect origin')
  }
  return redirect.toString()
}
