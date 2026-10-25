import { readBoundedJson } from '@/lib/api/bounded-body'
import { NextRequest } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth/session'
import { getAccountContext, hasContextPermission } from '@/lib/org/context'
import { getEffectivePlan } from '@/lib/billing/entitlements'
import { canUseScopedApiKeys } from '@/lib/billing/feature-access'
import { createApiKey, listApiKeys, revokeApiKey } from '@/lib/api/keys'
import { ApiKeyScope } from '@/lib/firebase/firestore'
import {
  successResponse,
  unauthorizedResponse,
  notFoundResponse,
  validationErrorResponse,
  upgradeRequiredResponse,
  errorResponse,
  ErrorCode,
  forbiddenResponse,
} from '@/lib/api/response'

const createKeySchema = z.object({
  name: z.string().min(1).max(50),
  scopes: z.array(z.enum(['translate', 'screenshots', 'publish', 'read', 'write', 'all'])).optional(),
  expiresInDays: z.number().min(1).max(365).optional()
})

// GET - List API keys
export async function GET() {
  const session = await getSession()
  if (!session) {
    return unauthorizedResponse()
  }

  const context = await getAccountContext(session.userId)
  if (!context) {
    return notFoundResponse('User not found')
  }

  // Check plan access (Growth and above)
  const plan = getEffectivePlan(context)

  // API keys available for pro and above (not starter/free)
  if (!canUseScopedApiKeys(plan)) {
    return upgradeRequiredResponse('API keys require a Growth plan or higher.')
  }

  const keys = await listApiKeys(context)

  // Return keys without sensitive data
  return successResponse({
    keys: keys.map(k => ({
      id: k.id,
      name: k.name,
      keyPrefix: k.keyPrefix,
      scopes: k.scopes,
      lastUsedAt: k.lastUsedAt?.toDate().toISOString() || null,
      lastUsedIp: k.lastUsedIp,
      expiresAt: k.expiresAt?.toDate().toISOString() || null,
      createdAt: k.createdAt.toDate().toISOString()
    }))
  })
}

// POST - Create new API key
export async function POST(request: NextRequest) {
  const session = await getSession()
  if (!session) {
    return unauthorizedResponse()
  }

  const context = await getAccountContext(session.userId)
  if (!context) {
    return notFoundResponse('User not found')
  }

  // Check permission for organization API key creation
  // API keys grant elevated access, so only admins/owners can create them
  if (context.type === 'organization' && !hasContextPermission(context, 'canManageCredentials')) {
    return forbiddenResponse('Only admins and owners can create API keys.')
  }

  // Check plan access
  const plan = getEffectivePlan(context)

  if (!canUseScopedApiKeys(plan)) {
    return upgradeRequiredResponse('API keys require a Growth plan or higher.')
  }

  // Parse request body
  let body
  try {
    body = createKeySchema.parse(await readBoundedJson(request))
  } catch {
    return validationErrorResponse('Invalid request body')
  }

  // Limit number of active keys
  const existingKeys = await listApiKeys(context)
  const maxKeys = plan === 'enterprise' ? 50 : plan === 'business' ? 20 : 5

  if (existingKeys.length >= maxKeys) {
    return errorResponse(
      `You can have up to ${maxKeys} active API keys. Revoke unused keys to create new ones.`,
      { status: 400, code: ErrorCode.USAGE_LIMIT_EXCEEDED }
    )
  }

  const { key, keyData } = await createApiKey(
    context,
    body.name,
    body.scopes as ApiKeyScope[] || ['all'],
    body.expiresInDays
  )

  // Return the key - THIS IS THE ONLY TIME the full key is shown!
  return successResponse({
    key, // Full key - show once
    keyData: {
      id: keyData.id,
      name: keyData.name,
      keyPrefix: keyData.keyPrefix,
      scopes: keyData.scopes,
      expiresAt: keyData.expiresAt?.toDate().toISOString() || null,
      createdAt: keyData.createdAt.toDate().toISOString()
    }
  }, 201)
}

// DELETE - Revoke an API key
export async function DELETE(request: NextRequest) {
  const session = await getSession()
  if (!session) {
    return unauthorizedResponse()
  }

  const context = await getAccountContext(session.userId)
  if (!context) {
    return notFoundResponse('User not found')
  }

  // Check permission for organization API key revocation
  if (context.type === 'organization' && !hasContextPermission(context, 'canManageCredentials')) {
    return forbiddenResponse('Only admins and owners can revoke API keys.')
  }

  const { searchParams } = new URL(request.url)
  const keyId = searchParams.get('id')

  if (!keyId) {
    return validationErrorResponse('Key ID required')
  }

  const success = await revokeApiKey(context, keyId)

  if (!success) {
    return notFoundResponse('Key not found')
  }

  return successResponse({ message: 'Key revoked successfully' })
}
