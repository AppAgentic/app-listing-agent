import { readBoundedJson, RequestBodyLimitError } from '@/lib/api/bounded-body'
import { NextRequest } from 'next/server'
import { z } from 'zod'
import { authenticateRequest, errorResponse, unauthorizedResponse } from '@/lib/api/auth'
import { getProjectContext, hasContextPermission, getAccountContext, AccountContext } from '@/lib/org/context'
import { getSession } from '@/lib/auth/session'
import { adminDb } from '@/lib/firebase/admin'
import { Timestamp } from 'firebase-admin/firestore'
import type { InAppPurchase, IAPProductType, IAPSyncStatus } from '@/lib/firebase/firestore'

const createIAPSchema = z.object({
  projectId: z.string(),
  productId: z.string().min(1).max(100),
  name: z.string().min(1).max(100),
  productType: z.enum(['CONSUMABLE', 'NON_CONSUMABLE', 'NON_RENEWING_SUBSCRIPTION']),
  familyShareable: z.boolean().optional().default(false),
  reviewNote: z.string().optional(),
  localizations: z.array(z.object({
    locale: z.string(),
    displayName: z.string().max(30),
    description: z.string().max(45),
  })).optional(),
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
    body = createIAPSchema.parse(await readBoundedJson(request))
  } catch (error) {
    if (error instanceof RequestBodyLimitError) return Response.json({ error: error.message }, { status: 413 })
    if (error instanceof z.ZodError) {
      return errorResponse(`Validation error: ${error.issues.map(e => e.message).join(', ')}`)
    }
    return errorResponse('Invalid request body')
  }

  const { projectId, productId, name, productType, familyShareable, reviewNote, localizations, basePricePointId, baseTerritory, pricingStrategy } = body

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

    // Check if productId already exists
    const existingSnapshot = await basePath.collection('inAppPurchases')
      .where('productId', '==', productId)
      .limit(1)
      .get()

    if (!existingSnapshot.empty) {
      return errorResponse('Product ID already exists', 409)
    }

    // Create the IAP
    const iapRef = basePath.collection('inAppPurchases').doc()
    const now = Timestamp.now()

    const iap: InAppPurchase = {
      id: iapRef.id,
      appStoreId: null,
      productId,
      name,
      productType: productType as IAPProductType,
      state: null,
      syncStatus: 'pending_creation' as IAPSyncStatus,
      familyShareable,
      reviewNote: reviewNote || null,
      createdAt: now,
      updatedAt: now,
    }

    await iapRef.set(iap)

    const batch = adminDb.batch()

    // Save localizations if provided
    if (localizations && localizations.length > 0) {
      for (const loc of localizations) {
        const locRef = iapRef.collection('localizations').doc(loc.locale)
        batch.set(locRef, {
          locale: loc.locale,
          displayName: loc.displayName,
          description: loc.description,
        })
      }
    }

    // Save pricing config if provided
    if (basePricePointId) {
      const pricingRef = iapRef.collection('config').doc('pricing')
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
      iap: {
        ...iap,
        localizations: localizations || [],
        pricing: basePricePointId ? {
          baseTerritory: baseTerritory || 'USA',
          basePricePointId,
          strategy: pricingStrategy || 'equalized',
        } : null,
      },
    })
  } catch (error) {
    console.error('Error creating IAP:', error)
    return errorResponse(error instanceof Error ? error.message : 'Failed to create IAP', 500)
  }
}
