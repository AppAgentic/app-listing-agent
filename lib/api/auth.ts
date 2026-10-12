import { NextRequest } from 'next/server'
import type { ConnectorProfile } from '@/lib/mcp/connector-profile'
import { verifyApiKey, AccountContext } from '../org/context'
import { verifyApiKeyHashWithMetadata } from './keys'
import type { ApiKeyScope } from '../firebase/firestore'
import { hasInternalIntegrationAccess } from '../features/internal-integrations'
import { adminAuth, adminDb } from '../firebase/admin'
import { withRateLimit, RATE_LIMIT_CONFIGS, RateLimitResult } from './rate-limit'
import { decodeJwt } from 'jose'
import {
  getWorkOSConfig,
  isWorkOSAccessRevoked,
  verifyWorkOSAccessToken,
} from '@/lib/auth/workos'
import { getClientIp } from './client-ip'

export interface AuthResult {
  authenticated: boolean
  context?: AccountContext
  error?: string
  rateLimit?: RateLimitResult
  apiKeyScopes?: ApiKeyScope[]
  legacyApiKey?: boolean
  oauthProjectId?: string
  authMethod?: 'api_key' | 'firebase' | 'workos'
}

/**
 * Authenticate request using API key or Firebase token
 */
export async function authenticateRequest(request: NextRequest, connectorProfile?: ConnectorProfile): Promise<AuthResult> {
  // Check for API key in Authorization header
  const authHeader = request.headers.get('Authorization')
  const clientIp = getClientIp(request)

  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7)

    // Try API key authentication
    if (token.startsWith('asc_')) {
      // New secure API keys (asc_live_ or asc_test_)
      if (token.startsWith('asc_live_') || token.startsWith('asc_test_')) {
        const verification = await verifyApiKeyHashWithMetadata(token, clientIp)
        if (verification) {
          return {
            authenticated: true,
            context: verification.context,
            apiKeyScopes: verification.keyData.scopes,
            authMethod: 'api_key',
          }
        }
        return { authenticated: false, error: 'Invalid or expired API key' }
      }

      // Legacy API keys (fallback for backwards compatibility)
      const context = await verifyApiKey(token)
      if (context && hasInternalIntegrationAccess(context)) {
        return {
          authenticated: true,
          context,
          apiKeyScopes: ['all'],
          legacyApiKey: true,
          authMethod: 'api_key',
        }
      }
      return { authenticated: false, error: 'Invalid API key' }
    }

    // WorkOS Standalone Connect tokens use the Firebase UID as `sub`, keeping
    // Firebase/Firestore as the account source of truth.
    const workosConfig = getWorkOSConfig({ connectorProfile })
    if (workosConfig) {
      try {
        const unverified = decodeJwt(token)
        if (unverified.iss === workosConfig.issuer) {
          const access = await verifyWorkOSAccessToken(token, connectorProfile)
          if (!access) return { authenticated: false, error: 'Invalid OAuth token' }

          // Revocation is a security boundary, so read it directly rather than
          // relying on the account-context cache shared by ordinary requests.
          const userDoc = await adminDb.collection('users').doc(access.userId).get()
          if (!userDoc.exists) return { authenticated: false, error: 'User not found' }
          if (isWorkOSAccessRevoked(userDoc.data()?.oauthRevokedBefore, access.payload)) {
            return { authenticated: false, error: 'OAuth access has been revoked' }
          }

          const { getAccountContext } = await import('../org/context')
          const context = await getAccountContext(access.userId)
          if (!context) return { authenticated: false, error: 'User not found' }

          return {
            authenticated: true,
            context,
            apiKeyScopes: access.scopes,
            oauthProjectId: access.projectId,
            authMethod: 'workos',
          }
        }
      } catch {
        // A non-WorkOS bearer token may still be a Firebase token.
      }
    }

    // Try Firebase ID token
    try {
      const decodedToken = await adminAuth.verifyIdToken(token)
      const context = await verifyApiKey(decodedToken.uid)

      // If no API key context, get from user ID directly
      if (!context) {
        const { getAccountContext } = await import('../org/context')
        const userContext = await getAccountContext(decodedToken.uid)
        if (userContext) {
          return { authenticated: true, context: userContext, authMethod: 'firebase' }
        }
      }

      if (context) {
        return { authenticated: true, context, authMethod: 'firebase' }
      }

      return { authenticated: false, error: 'User not found' }
    } catch {
      return { authenticated: false, error: 'Invalid token' }
    }
  }

  return { authenticated: false, error: 'No authorization header' }
}

// Re-export standardized response utilities for backwards compatibility
export {
  errorResponse,
  unauthorizedResponse,
  forbiddenResponse,
  notFoundResponse,
  validationErrorResponse,
  rateLimitResponse,
  upgradeRequiredResponse,
  internalErrorResponse,
  successResponse,
  ErrorCode,
} from './response'

/**
 * Get client IP from request
 */
export { getClientIp } from './client-ip'

type RateLimitType = keyof typeof RATE_LIMIT_CONFIGS

/**
 * Authenticate request with rate limiting
 * Returns early with 429 response if rate limited
 */
export async function authenticateWithRateLimit(
  request: NextRequest,
  rateLimitType: RateLimitType = 'default'
): Promise<AuthResult & { rateLimitResponse?: Response }> {
  // First check rate limit by IP (before auth to prevent brute force)
  const ipRateLimit = await withRateLimit(request, RATE_LIMIT_CONFIGS[rateLimitType])
  if (ipRateLimit.response) {
    return {
      authenticated: false,
      error: 'Rate limited',
      rateLimitResponse: ipRateLimit.response
    }
  }

  // Then authenticate
  const authResult = await authenticateRequest(request)

  // If authenticated, also check user-specific rate limit
  if (authResult.authenticated && authResult.context) {
    const userRateLimit = await withRateLimit(
      request,
      RATE_LIMIT_CONFIGS[rateLimitType],
      { userId: authResult.context.userId }
    )
    if (userRateLimit.response) {
      return {
        ...authResult,
        rateLimitResponse: userRateLimit.response
      }
    }
    return { ...authResult, rateLimit: userRateLimit }
  }

  return authResult
}

// Re-export rate limit utilities for direct use
export { withRateLimit, RATE_LIMIT_CONFIGS } from './rate-limit'
