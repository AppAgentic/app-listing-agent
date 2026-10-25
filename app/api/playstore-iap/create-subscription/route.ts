import { readBoundedJson, RequestBodyLimitError } from '@/lib/api/bounded-body'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { Timestamp } from 'firebase-admin/firestore'
import { getPlayStoreContext, errorResponse, unauthorizedResponse } from '../_helpers'

const createSubscriptionSchema = z.object({
  projectId: z.string(),
  productId: z.string().min(1).max(150),
  defaultLanguage: z.string().default('en-US'),
  localizations: z.array(z.object({
    locale: z.string(),
    title: z.string().max(55),
    description: z.string().max(80),
  })).optional(),
  basePlans: z.array(z.object({
    basePlanId: z.string().min(1),
    type: z.enum(['AUTO_RENEWING', 'PREPAID']),
    billingPeriodDuration: z.string().optional(), // ISO 8601: P1W, P1M, P3M, P6M, P1Y
    gracePeriodDuration: z.string().optional(),
    defaultPriceUsd: z.number().positive().optional(),
  })).min(1),
})

// POST /api/playstore-iap/create-subscription — Create a subscription locally
export async function POST(request: NextRequest) {
  let body
  try {
    body = createSubscriptionSchema.parse(await readBoundedJson(request))
  } catch (error) {
    if (error instanceof RequestBodyLimitError) return Response.json({ error: error.message }, { status: 413 })
    if (error instanceof z.ZodError) return errorResponse(error.issues[0].message, 400)
    return errorResponse('Invalid request body', 400)
  }

  const ctx = await getPlayStoreContext(request, body.projectId)
  if ('error' in ctx && !ctx.basePath) return unauthorizedResponse(ctx.error)
  const { basePath } = ctx as any

  try {
    // Check for duplicate product ID
    const existing = await basePath.collection('playStoreSubscriptions').where('productId', '==', body.productId).get()
    if (!existing.empty) {
      return errorResponse(`Subscription with product ID "${body.productId}" already exists`, 409)
    }

    const now = Timestamp.now()
    const subData = {
      productId: body.productId,
      syncStatus: 'pending_creation' as const,
      defaultLanguage: body.defaultLanguage,
      basePlans: body.basePlans.map(bp => {
        const plan: Record<string, any> = {
          basePlanId: bp.basePlanId,
          state: null,
          type: bp.type,
          defaultPriceUsd: bp.defaultPriceUsd || null,
        }
        if (bp.billingPeriodDuration) plan.billingPeriodDuration = bp.billingPeriodDuration
        if (bp.gracePeriodDuration) plan.gracePeriodDuration = bp.gracePeriodDuration
        return plan
      }),
      createdAt: now,
      updatedAt: now,
    }

    const docRef = await basePath.collection('playStoreSubscriptions').add(subData)

    // Save localizations
    if (body.localizations?.length) {
      const batch = (await import('@/lib/firebase/admin')).adminDb.batch()
      for (const loc of body.localizations) {
        batch.set(docRef.collection('localizations').doc(loc.locale), loc)
      }
      await batch.commit()
    }

    // Save pricing config for each base plan
    for (const bp of body.basePlans) {
      if (bp.defaultPriceUsd) {
        await docRef.collection('config').doc(`basePlan_${bp.basePlanId}_pricing`).set({
          basePriceUsd: bp.defaultPriceUsd,
          strategy: 'auto_convert',
          updatedAt: now,
        })
      }
    }

    return NextResponse.json({ success: true, id: docRef.id, ...subData })
  } catch (error: any) {
    return errorResponse(error.message || 'Failed to create subscription', 500)
  }
}
