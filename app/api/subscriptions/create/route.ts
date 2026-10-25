import { readBoundedJson, RequestBodyLimitError } from '@/lib/api/bounded-body'
import { NextRequest } from 'next/server'
import { z } from 'zod'
import { authenticateRequest, errorResponse, unauthorizedResponse } from '@/lib/api/auth'
import { getProjectContext, hasContextPermission, getAccountContext, AccountContext } from '@/lib/org/context'
import { getSession } from '@/lib/auth/session'
import { adminDb } from '@/lib/firebase/admin'
import { Timestamp } from 'firebase-admin/firestore'
import { getAppStoreHelper } from '@/lib/services/credentials'
import type { Subscription, SubscriptionGroup, IAPSyncStatus, SubscriptionPeriod, IAPState } from '@/lib/firebase/firestore'

const createSubscriptionSchema = z.object({
  projectId: z.string(),
  groupId: z.string().optional(), // Existing group ID
  newGroupName: z.string().optional(), // Create new group
  productId: z.string().min(1).max(100),
  name: z.string().min(1).max(100),
  groupLevel: z.number().min(1).max(10).default(1),
  subscriptionPeriod: z.enum([
    'ONE_WEEK', 'ONE_MONTH', 'TWO_MONTHS', 'THREE_MONTHS', 'SIX_MONTHS', 'ONE_YEAR'
  ]),
  familyShareable: z.boolean().optional().default(false),
  localizations: z.array(z.object({
    locale: z.string(),
    displayName: z.string().max(30),
    description: z.string().max(45),
  })).optional(),
  pushToStore: z.boolean().optional().default(false),
  // Pricing config
  basePricePointId: z.string().optional(),
  baseTerritory: z.string().optional().default('USA'),
  pricingStrategy: z.enum(['equalized', 'custom', 'indexed']).optional().default('equalized'),
})

async function getAuthContext(request: NextRequest): Promise<{ context: AccountContext | null; error?: string }> {
  const authHeader = request.headers.get('Authorization')
  if (authHeader) {
    const auth = await authenticateRequest(request)
    if (auth.authenticated && auth.context) {
      return { context: auth.context }
    }
    return { context: null, error: auth.error }
  }

  const session = await getSession()
  if (session) {
    const context = await getAccountContext(session.userId)
    if (context) {
      return { context }
    }
    return { context: null, error: 'User not found' }
  }

  return { context: null, error: 'Authentication required' }
}

export async function POST(request: NextRequest) {
  const { context: authContext, error: authError } = await getAuthContext(request)
  if (!authContext) {
    return unauthorizedResponse(authError)
  }

  let body
  try {
    body = createSubscriptionSchema.parse(await readBoundedJson(request))
  } catch (error) {
    if (error instanceof RequestBodyLimitError) return Response.json({ error: error.message }, { status: 413 })
    if (error instanceof z.ZodError) {
      return errorResponse(`Validation error: ${error.issues.map(e => e.message).join(', ')}`)
    }
    return errorResponse('Invalid request body')
  }

  const {
    projectId,
    groupId,
    newGroupName,
    productId,
    name,
    groupLevel,
    subscriptionPeriod,
    familyShareable,
    localizations,
    pushToStore,
    basePricePointId,
    baseTerritory,
    pricingStrategy,
  } = body

  if (!groupId && !newGroupName) {
    return errorResponse('Either groupId or newGroupName is required')
  }

  const projectContext = await getProjectContext(authContext.userId, projectId)
  if (!projectContext) {
    return errorResponse('Project not found', 404)
  }

  if (!hasContextPermission(projectContext, 'canCreateProjects')) {
    return errorResponse('Permission denied', 403)
  }

  try {
    const basePath = projectContext.type === 'organization' && projectContext.orgId
      ? adminDb.collection('organizations').doc(projectContext.orgId).collection('projects').doc(projectId)
      : adminDb.collection('users').doc(authContext.userId).collection('projects').doc(projectId)

    const now = Timestamp.now()
    let groupRef: FirebaseFirestore.DocumentReference
    let groupData: SubscriptionGroup

    // Get or create the subscription group
    if (groupId) {
      groupRef = basePath.collection('subscriptionGroups').doc(groupId)
      const groupDoc = await groupRef.get()
      if (!groupDoc.exists) {
        return errorResponse('Subscription group not found', 404)
      }
      groupData = { id: groupDoc.id, ...groupDoc.data() } as SubscriptionGroup
    } else {
      // Create new group
      groupRef = basePath.collection('subscriptionGroups').doc()
      let groupAppStoreId: string | null = null
      let groupSyncStatus: IAPSyncStatus = 'pending_creation'

      if (pushToStore) {
        const appStoreHelper = await getAppStoreHelper(authContext.userId, projectId, projectContext.orgId)
        const created = await appStoreHelper.createSubscriptionGroup(newGroupName!)
        groupAppStoreId = created.id
        groupSyncStatus = 'synced'
      }

      groupData = {
        id: groupRef.id,
        appStoreId: groupAppStoreId,
        referenceName: newGroupName!,
        syncStatus: groupSyncStatus,
        createdAt: now,
        updatedAt: now,
      }

      await groupRef.set(groupData)
    }

    // Check if productId already exists in any subscription
    const existingCheck = await groupRef.collection('subscriptions')
      .where('productId', '==', productId)
      .limit(1)
      .get()

    if (!existingCheck.empty) {
      return errorResponse('Product ID already exists in this group', 409)
    }

    // Create the subscription
    const subRef = groupRef.collection('subscriptions').doc()
    let appStoreId: string | null = null
    let syncStatus: IAPSyncStatus = 'pending_creation'
    let state: IAPState | null = null

    if (pushToStore && groupData.appStoreId) {
      const appStoreHelper = await getAppStoreHelper(authContext.userId, projectId, projectContext.orgId)
      const created = await appStoreHelper.createSubscription({
        productId,
        name,
        groupId: groupData.appStoreId,
        groupLevel,
        subscriptionPeriod,
        familyShareable,
      })
      appStoreId = created.id
      state = created.state
      syncStatus = 'synced'

      // Push localizations if provided
      if (localizations && localizations.length > 0) {
        for (const loc of localizations) {
          await appStoreHelper.upsertSubscriptionLocalization(created.id, loc.locale, {
            displayName: loc.displayName,
            description: loc.description,
          })
        }
      }
    }

    const subscription: Subscription = {
      id: subRef.id,
      appStoreId,
      productId,
      name,
      groupId: groupRef.id,
      groupLevel,
      subscriptionPeriod: subscriptionPeriod as SubscriptionPeriod,
      familyShareable,
      state,
      syncStatus,
      createdAt: now,
      updatedAt: now,
    }

    await subRef.set(subscription)

    // Save localizations and pricing config locally
    const batch = adminDb.batch()

    if (localizations && localizations.length > 0) {
      for (const loc of localizations) {
        const locRef = subRef.collection('localizations').doc(loc.locale)
        batch.set(locRef, {
          locale: loc.locale,
          displayName: loc.displayName,
          description: loc.description,
        })
      }
    }

    // Save pricing config if provided
    if (basePricePointId) {
      const pricingRef = subRef.collection('config').doc('pricing')
      batch.set(pricingRef, {
        baseTerritory: baseTerritory || 'USA',
        basePricePointId,
        strategy: pricingStrategy || 'equalized',
        updatedAt: now,
      })
    }

    await batch.commit()

    return Response.json({
      success: true,
      group: groupData,
      subscription: {
        ...subscription,
        localizations: localizations || [],
        pricing: basePricePointId ? {
          baseTerritory: baseTerritory || 'USA',
          basePricePointId,
          strategy: pricingStrategy || 'equalized',
        } : null,
      },
    })
  } catch (error) {
    console.error('Error creating subscription:', error)
    return errorResponse(error instanceof Error ? error.message : 'Failed to create subscription', 500)
  }
}
