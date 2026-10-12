import { createHash, randomBytes } from 'crypto'
import { adminDb } from '../firebase/admin'
import { Timestamp } from 'firebase-admin/firestore'
import { ApiKey, ApiKeyScope } from '../firebase/firestore'
import { AccountContext } from '../org/context'

/**
 * Generate a secure API key
 * Format: asc_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxx (36 chars after prefix)
 */
export function generateSecureApiKey(isTest: boolean = false): string {
  const prefix = isTest ? 'asc_test_' : 'asc_live_'
  const randomPart = randomBytes(27).toString('base64url').slice(0, 36)
  return prefix + randomPart
}

/**
 * Hash an API key for storage
 */
export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex')
}

/**
 * Get key prefix for display (first 12 chars)
 */
export function getKeyPrefix(key: string): string {
  return key.slice(0, 12) + '...'
}

/**
 * Create a new API key
 */
export async function createApiKey(
  context: AccountContext,
  name: string,
  scopes: ApiKeyScope[] = ['all'],
  expiresInDays?: number
): Promise<{ key: string; keyData: ApiKey }> {
  const key = generateSecureApiKey()
  const keyHash = hashApiKey(key)
  const keyPrefix = getKeyPrefix(key)
  const keyId = randomBytes(16).toString('hex')

  // Use type assertion for admin SDK Timestamp compatibility
  const keyData = {
    id: keyId,
    name,
    keyHash,
    keyPrefix,
    scopes,
    lastUsedAt: null,
    lastUsedIp: null,
    expiresAt: expiresInDays
      ? Timestamp.fromDate(new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000))
      : null,
    createdAt: Timestamp.now(),
    createdBy: context.userId,
    revokedAt: null
  } as ApiKey

  // Store in appropriate collection
  const keysRef = context.type === 'organization' && context.orgId
    ? adminDb.collection('organizations').doc(context.orgId).collection('apiKeys')
    : adminDb.collection('users').doc(context.userId).collection('apiKeys')

  await keysRef.doc(keyId).set(keyData)

  // Return the plaintext key (only shown once!)
  return { key, keyData }
}

/**
 * List API keys for a context (without the actual key values)
 */
export async function listApiKeys(context: AccountContext): Promise<ApiKey[]> {
  const keysRef = context.type === 'organization' && context.orgId
    ? adminDb.collection('organizations').doc(context.orgId).collection('apiKeys')
    : adminDb.collection('users').doc(context.userId).collection('apiKeys')

  const snapshot = await keysRef
    .where('revokedAt', '==', null)
    .orderBy('createdAt', 'desc')
    .get()

  return snapshot.docs.map(doc => doc.data() as ApiKey)
}

/**
 * Revoke an API key
 */
export async function revokeApiKey(
  context: AccountContext,
  keyId: string
): Promise<boolean> {
  const keysRef = context.type === 'organization' && context.orgId
    ? adminDb.collection('organizations').doc(context.orgId).collection('apiKeys')
    : adminDb.collection('users').doc(context.userId).collection('apiKeys')

  const keyDoc = await keysRef.doc(keyId).get()

  if (!keyDoc.exists) {
    return false
  }

  await keysRef.doc(keyId).update({
    revokedAt: Timestamp.now()
  })

  return true
}

/**
 * Verify an API key and return context
 */
export async function verifyApiKeyHashWithMetadata(
  key: string,
  clientIp?: string
): Promise<{ context: AccountContext; keyData: ApiKey } | null> {
  if (!key.startsWith('asc_')) {
    return null
  }

  const keyHash = hashApiKey(key)

  // Search in users' apiKeys subcollections
  const usersSnapshot = await adminDb.collectionGroup('apiKeys')
    .where('keyHash', '==', keyHash)
    .where('revokedAt', '==', null)
    .limit(1)
    .get()

  if (usersSnapshot.empty) {
    return null
  }

  const keyDoc = usersSnapshot.docs[0]
  const keyData = keyDoc.data() as ApiKey

  // Check expiration
  if (keyData.expiresAt && keyData.expiresAt.toDate() < new Date()) {
    return null
  }

  // Update last used
  await keyDoc.ref.update({
    lastUsedAt: Timestamp.now(),
    lastUsedIp: clientIp || null
  })

  // Determine if this is a user or org key from the path
  const pathParts = keyDoc.ref.path.split('/')
  // Path: users/{userId}/apiKeys/{keyId} or organizations/{orgId}/apiKeys/{keyId}

  if (pathParts[0] === 'users') {
    const userId = pathParts[1]
    const { getAccountContext } = await import('../org/context')
    const context = await getAccountContext(userId)
    return context ? { context, keyData } : null
  } else if (pathParts[0] === 'organizations') {
    const orgId = pathParts[1]
    const orgDoc = await adminDb.collection('organizations').doc(orgId).get()

    if (!orgDoc.exists) {
      return null
    }

    const org = orgDoc.data()
    const ownerDoc = await adminDb.collection('users').doc(org!.ownerId).get()

    if (!ownerDoc.exists) {
      return null
    }

    const { getMember } = await import('../org/members')
    const membership = await getMember(orgId, org!.ownerId)

    const context: AccountContext = {
      type: 'organization',
      userId: org!.ownerId,
      user: ownerDoc.data() as any,
      organization: org as any,
      membership: membership || undefined,
      orgId
    }
    return { context, keyData }
  }

  return null
}

export async function verifyApiKeyHash(
  key: string,
  clientIp?: string
): Promise<AccountContext | null> {
  const verification = await verifyApiKeyHashWithMetadata(key, clientIp)
  return verification?.context || null
}

/**
 * Check if an API key has a specific scope
 */
export function hasScope(keyData: ApiKey, requiredScope: ApiKeyScope): boolean {
  return keyData.scopes.includes('all') || keyData.scopes.includes(requiredScope)
}
