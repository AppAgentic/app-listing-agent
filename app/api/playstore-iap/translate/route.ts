import { readBoundedJson, RequestBodyLimitError } from '@/lib/api/bounded-body'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { Timestamp } from 'firebase-admin/firestore'
import { randomUUID } from 'crypto'
import { adminDb } from '@/lib/firebase/admin'
import { getPlayStoreContext, errorResponse, unauthorizedResponse } from '../_helpers'
import {
  getIAPLocalesRequiringTranslation,
  translateIAPFields,
} from '@/lib/services/iap-translator'
import {
  createReservationErrorResponse,
  refundUsage,
  reserveUsage,
  settleUsage,
} from '@/lib/api/usage'
import { PLAYSTORE_IAP_LIMITS } from '@/lib/constants'
import type { IAPTranslationCache } from '@/lib/firebase/firestore'

const translateSchema = z.object({
  projectId: z.string(),
  itemId: z.string(),
  itemType: z.enum(['product', 'subscription']),
  targetLocales: z.array(z.string()).min(1),
  force: z.boolean().optional().default(false),
})

// POST /api/playstore-iap/translate — AI-translate product/subscription listings
export async function POST(request: NextRequest) {
  let body
  try {
    body = translateSchema.parse(await readBoundedJson(request))
  } catch (error) {
    if (error instanceof RequestBodyLimitError) return Response.json({ error: error.message }, { status: 413 })
    if (error instanceof z.ZodError) {
      return errorResponse(`Validation error: ${error.issues.map(e => e.message).join(', ')}`)
    }
    return errorResponse('Invalid request body')
  }

  const { projectId, itemId, itemType, targetLocales, force } = body

  const ctx = await getPlayStoreContext(request, projectId)
  if ('error' in ctx && !ctx.basePath) return unauthorizedResponse(ctx.error)
  const { authContext, basePath } = ctx as Exclude<typeof ctx, { error: string }>

  let usageOperationId: string | undefined
  try {
    const collection = itemType === 'product' ? 'playStoreProducts' : 'playStoreSubscriptions'
    const itemDoc = await basePath.collection(collection).doc(itemId).get()
    if (!itemDoc.exists) return errorResponse(`${itemType} not found`, 404)

    const itemData = itemDoc.data()
    const primaryLocale = itemData?.defaultLanguage || 'en-US'

    // Get primary locale localization
    const primaryLocDoc = await basePath
      .collection(collection).doc(itemId)
      .collection('localizations').doc(primaryLocale).get()

    if (!primaryLocDoc.exists) {
      return errorResponse('Primary locale localization not found. Please add content for the primary locale first.')
    }

    const primaryLoc = primaryLocDoc.data()!

    // Get existing translation cache
    const cacheSnapshot = await basePath.collection('playStoreIapTranslations').get()
    const existingCache = new Map<string, IAPTranslationCache>()
    cacheSnapshot.docs.forEach((doc: any) => {
      const data = doc.data() as IAPTranslationCache
      existingCache.set(`${data.locale}_${data.field}`, data)
    })

    const billableLocales = getIAPLocalesRequiringTranslation({
      sourceLocale: primaryLocale,
      targetLocales,
      displayName: primaryLoc.title || '',
      description: primaryLoc.description || '',
      existingCache: force ? undefined : existingCache,
      forceTranslate: force,
    })
    if (billableLocales.length > 0) {
      usageOperationId = `play-iap-translate:${request.headers.get('idempotency-key') || randomUUID()}`
      const reservation = await reserveUsage(authContext, {
        operationId: usageOperationId,
        usageType: 'translations',
        units: billableLocales.length,
        metadata: { route: 'play-iap-translate', projectId, itemId, itemType },
      })
      if (!reservation.allowed) return createReservationErrorResponse(reservation)
      if (reservation.replayed) {
        return errorResponse('This translation request has already been processed', 409)
      }
    }

    // Translate using shared service — map field names (Play Store uses title/description)
    const results = await translateIAPFields({
      sourceLocale: primaryLocale,
      targetLocales,
      displayName: primaryLoc.title || '',
      description: primaryLoc.description || '',
      existingCache: force ? undefined : existingCache,
      forceTranslate: force,
    })

    // Save translations to localizations and cache
    const batch = adminDb.batch()
    const now = Timestamp.now()

    for (const result of results) {
      // Enforce Play Store character limits
      const title = result.displayName.substring(0, PLAYSTORE_IAP_LIMITS.title)
      const description = result.description.substring(0, PLAYSTORE_IAP_LIMITS.description)

      // Save localization
      const locRef = basePath
        .collection(collection).doc(itemId)
        .collection('localizations').doc(result.locale)

      batch.set(locRef, {
        locale: result.locale,
        title,
        description,
      }, { merge: true })

      // Save cache entries
      if (!result.fromCache) {
        const cacheKeyName = `${itemId}_${result.locale}_displayName`
        const cacheKeyDesc = `${itemId}_${result.locale}_description`

        batch.set(basePath.collection('playStoreIapTranslations').doc(cacheKeyName), {
          locale: result.locale,
          field: 'displayName',
          sourceHash: result.sourceHash,
          translatedText: title,
          createdAt: now,
        })

        batch.set(basePath.collection('playStoreIapTranslations').doc(cacheKeyDesc), {
          locale: result.locale,
          field: 'description',
          sourceHash: result.sourceHash,
          translatedText: description,
          createdAt: now,
        })
      }
    }

    // Mark parent item as having local changes so push picks it up
    const itemRef = basePath.collection(collection).doc(itemId)
    if (itemData?.syncStatus === 'synced') {
      batch.update(itemRef, { syncStatus: 'local_changes', updatedAt: Timestamp.now() })
    }

    await batch.commit()
    if (usageOperationId) {
      await settleUsage(
        authContext,
        usageOperationId,
        'translations',
        results.filter(result => !result.fromCache).length
      )
    }

    return NextResponse.json({
      success: true,
      translations: results.map(r => ({
        locale: r.locale,
        title: r.displayName.substring(0, PLAYSTORE_IAP_LIMITS.title),
        description: r.description.substring(0, PLAYSTORE_IAP_LIMITS.description),
        fromCache: r.fromCache,
      })),
      summary: {
        total: results.length,
        fromCache: results.filter(r => r.fromCache).length,
        translated: results.filter(r => !r.fromCache).length,
      },
    })
  } catch (error: any) {
    if (usageOperationId) await refundUsage(authContext, usageOperationId, 'translations')
    console.error('Error translating Play Store listing:', error)
    return errorResponse(error.message || 'Failed to translate listing', 500)
  }
}
