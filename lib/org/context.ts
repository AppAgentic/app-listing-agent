import { adminDb } from '../firebase/admin'
import { User, Organization, OrgMember, Project } from '../firebase/firestore'
import { getMember } from './members'
import { UserPlan } from '../constants'
import { getEffectivePlan, getEffectivePlanLimits } from '../billing/entitlements'

export type AccountType = 'personal' | 'organization'

export interface AccountContext {
  type: AccountType
  userId: string
  user: User
  organization?: Organization
  membership?: OrgMember
  orgId?: string
}

export interface ProjectContext extends AccountContext {
  project: Project
  projectId: string
}

// In-memory cache for account context to reduce Firestore reads
// TTL: 60 seconds - balances freshness with read reduction
const accountContextCache = new Map<string, { context: AccountContext; timestamp: number }>()
const ACCOUNT_CONTEXT_CACHE_TTL = 60 * 1000 // 60 seconds

// Project context cache with shorter TTL since project data changes more often
const projectContextCache = new Map<string, { context: ProjectContext; timestamp: number }>()
const PROJECT_CONTEXT_CACHE_TTL = 30 * 1000 // 30 seconds

/**
 * Get account context for a user
 * Determines if user is operating as personal account or as org member
 * Uses in-memory cache to reduce Firestore reads
 */
export async function getAccountContext(userId: string): Promise<AccountContext | null> {
  // Check cache first
  const cached = accountContextCache.get(userId)
  if (cached && cached.context.type === 'personal' && Date.now() - cached.timestamp < ACCOUNT_CONTEXT_CACHE_TTL) {
    return cached.context
  }

  // Get user document
  const userDoc = await adminDb.collection('users').doc(userId).get()

  if (!userDoc.exists) {
    return null
  }

  const user = userDoc.data() as User

  // Check if user belongs to an organization
  if (user.organizationId) {
    // Get organization
    const orgDoc = await adminDb
      .collection('organizations')
      .doc(user.organizationId)
      .get()

    if (orgDoc.exists) {
      const organization = orgDoc.data() as Organization

      // Get membership
      const membership = await getMember(user.organizationId, userId)

      if (membership) {
        const context: AccountContext = {
          type: 'organization',
          userId,
          user,
          organization,
          membership,
          orgId: user.organizationId
        }
        // Organization authorization is deliberately not process-cached. A
        // membership/role revocation must take effect across every Cloud Run
        // instance on the next request, not after a local TTL expires.
        return context
      }
    }
  }

  // Personal account
  const context: AccountContext = {
    type: 'personal',
    userId,
    user
  }
  // Cache the result
  accountContextCache.set(userId, { context, timestamp: Date.now() })
  return context
}

/**
 * Invalidate account context cache for a user
 * Call this when user data changes (e.g., org membership changes)
 */
export function invalidateAccountContextCache(userId: string): void {
  accountContextCache.delete(userId)
  // Also clear project caches for this user
  for (const key of projectContextCache.keys()) {
    if (key.startsWith(`${userId}:`)) {
      projectContextCache.delete(key)
    }
  }
}

/**
 * Get project context - resolves which account owns the project
 * Uses in-memory cache to reduce Firestore reads
 */
export async function getProjectContext(
  userId: string,
  projectId: string
): Promise<ProjectContext | null> {
  // Guard against empty strings that would cause Firestore "documentPath is not a valid resource path" errors
  if (!userId || !projectId) {
    console.error('[getProjectContext] Missing userId or projectId:', { userId: !!userId, projectId: !!projectId })
    return null
  }

  // Check cache first
  const cacheKey = `${userId}:${projectId}`
  const cached = projectContextCache.get(cacheKey)
  if (cached && cached.context.type === 'personal' && Date.now() - cached.timestamp < PROJECT_CONTEXT_CACHE_TTL) {
    return cached.context
  }

  const accountContext = await getAccountContext(userId)

  if (!accountContext) {
    return null
  }

  let projectDoc

  if (accountContext.type === 'organization' && accountContext.orgId) {
    // Check org projects
    projectDoc = await adminDb
      .collection('organizations')
      .doc(accountContext.orgId)
      .collection('projects')
      .doc(projectId)
      .get()
  }

  if (!projectDoc?.exists) {
    // Check personal projects
    projectDoc = await adminDb
      .collection('users')
      .doc(userId)
      .collection('projects')
      .doc(projectId)
      .get()

    if (!projectDoc.exists) {
      return null
    }

    // If found in personal projects but user is in org, use personal context
    const context: ProjectContext = {
      type: 'personal',
      userId,
      user: accountContext.user,
      project: projectDoc.data() as Project,
      projectId
    }
    // Cache the result
    projectContextCache.set(cacheKey, { context, timestamp: Date.now() })
    return context
  }

  const context: ProjectContext = {
    ...accountContext,
    project: projectDoc.data() as Project,
    projectId
  }
  // Organization project contexts carry membership permissions and therefore
  // are not process-cached; see getAccountContext above.
  if (context.type === 'personal') {
    projectContextCache.set(cacheKey, { context, timestamp: Date.now() })
  }
  return context
}

/**
 * Invalidate project context cache for a specific project
 * Call this when project data changes
 */
export function invalidateProjectContextCache(userId: string, projectId: string): void {
  projectContextCache.delete(`${userId}:${projectId}`)
}

/**
 * Get projects collection reference for the current context
 */
export function getProjectsCollection(context: AccountContext) {
  if (context.type === 'organization' && context.orgId) {
    return adminDb
      .collection('organizations')
      .doc(context.orgId)
      .collection('projects')
  }

  return adminDb.collection('users').doc(context.userId).collection('projects')
}

/**
 * Get usage document reference for the current context
 */
export function getUsageDocRef(context: AccountContext, month: string) {
  if (context.type === 'organization' && context.orgId) {
    return adminDb
      .collection('organizations')
      .doc(context.orgId)
      .collection('usage')
      .doc(month)
  }

  return adminDb.collection('users').doc(context.userId).collection('usage').doc(month)
}

/**
 * Get current plan limits for the context
 */
export function getPlanLimits(context: AccountContext) {
  return getEffectivePlanLimits(context)
}

/**
 * Get the plan type for the context
 */
export function getAccountPlan(context: AccountContext): UserPlan {
  return getEffectivePlan(context)
}

/**
 * Check if user has permission in current context
 */
export function hasContextPermission(
  context: AccountContext,
  permission: keyof OrgMember['permissions']
): boolean {
  if (context.type === 'personal') {
    // Personal accounts have all permissions for their own data
    return true
  }

  if (!context.membership) {
    return false
  }

  return context.membership.permissions[permission]
}

/**
 * Get API key for the current context
 */
export function getContextApiKey(context: AccountContext): string {
  if (context.type === 'organization' && context.organization) {
    return context.organization.apiKey
  }
  return context.user.apiKey
}

/**
 * Verify API key and return context
 */
export async function verifyApiKey(apiKey: string): Promise<AccountContext | null> {
  // Check organization API keys first
  const orgsWithKey = await adminDb
    .collection('organizations')
    .where('apiKey', '==', apiKey)
    .limit(1)
    .get()

  if (!orgsWithKey.empty) {
    const orgDoc = orgsWithKey.docs[0]
    const org = orgDoc.data() as Organization

    // Get the owner as the acting user
    const ownerDoc = await adminDb.collection('users').doc(org.ownerId).get()
    if (!ownerDoc.exists) {
      return null
    }

    const membership = await getMember(orgDoc.id, org.ownerId)

    return {
      type: 'organization',
      userId: org.ownerId,
      user: ownerDoc.data() as User,
      organization: org,
      membership: membership || undefined,
      orgId: orgDoc.id
    }
  }

  // Check personal API keys
  const usersWithKey = await adminDb
    .collection('users')
    .where('apiKey', '==', apiKey)
    .limit(1)
    .get()

  if (!usersWithKey.empty) {
    const userDoc = usersWithKey.docs[0]
    const user = userDoc.data() as User

    // If user belongs to org, return org context
    if (user.organizationId) {
      const orgDoc = await adminDb
        .collection('organizations')
        .doc(user.organizationId)
        .get()

      if (orgDoc.exists) {
        const membership = await getMember(user.organizationId, userDoc.id)

        return {
          type: 'organization',
          userId: userDoc.id,
          user,
          organization: orgDoc.data() as Organization,
          membership: membership || undefined,
          orgId: user.organizationId
        }
      }
    }

    return {
      type: 'personal',
      userId: userDoc.id,
      user
    }
  }

  return null
}
