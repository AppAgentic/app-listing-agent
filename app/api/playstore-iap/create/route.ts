import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { Timestamp } from 'firebase-admin/firestore'
import { getPlayStoreContext, errorResponse, unauthorizedResponse } from '../_helpers'

const createProductSchema = z.object({
  projectId: z.string(),
  sku: z.string().min(1).max(150),
  defaultLanguage: z.string().default('en-US'),
  defaultPriceUsd: z.number().positive().optional(),
  localizations: z.array(z.object({
    locale: z.string(),
    title: z.string().max(55),
    description: z.string().max(80),
  })).optional(),
})

// POST /api/playstore-iap/create — Create a one-time product locally
export async function POST(request: NextRequest) {
  let body
  try {
    body = createProductSchema.parse(await request.json())
  } catch (error) {
    if (error instanceof z.ZodError) return errorResponse(error.errors[0].message, 400)
    return errorResponse('Invalid request body', 400)
  }

  const ctx = await getPlayStoreContext(request, body.projectId)
  if ('error' in ctx && !ctx.basePath) return unauthorizedResponse(ctx.error)
  const { basePath } = ctx as any

  try {
    // Check for duplicate SKU
    const existing = await basePath.collection('playStoreProducts').where('sku', '==', body.sku).get()
    if (!existing.empty) {
      return errorResponse(`Product with SKU "${body.sku}" already exists`, 409)
    }

    const now = Timestamp.now()
    const productData = {
      sku: body.sku,
      productType: 'ONE_TIME' as const,
      status: null,
      syncStatus: 'pending_creation' as const,
      defaultLanguage: body.defaultLanguage,
      defaultPriceUsd: body.defaultPriceUsd || null,
      createdAt: now,
      updatedAt: now,
    }

    const docRef = await basePath.collection('playStoreProducts').add(productData)

    // Save localizations
    if (body.localizations?.length) {
      const batch = (await import('@/lib/firebase/admin')).adminDb.batch()
      for (const loc of body.localizations) {
        batch.set(docRef.collection('localizations').doc(loc.locale), loc)
      }
      await batch.commit()
    }

    // Save pricing config
    if (body.defaultPriceUsd) {
      await docRef.collection('config').doc('pricing').set({
        basePriceUsd: body.defaultPriceUsd,
        strategy: 'auto_convert',
        updatedAt: now,
      })
    }

    return NextResponse.json({ success: true, id: docRef.id, ...productData })
  } catch (error: any) {
    return errorResponse(error.message || 'Failed to create product', 500)
  }
}
