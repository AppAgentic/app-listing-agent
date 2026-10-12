import { NextRequest } from 'next/server'
import { z } from 'zod'
import { authenticateRequest, errorResponse, unauthorizedResponse } from '@/lib/api/auth'
import { getProjectContext, hasContextPermission, getAccountContext, AccountContext } from '@/lib/org/context'
import { getSession } from '@/lib/auth/session'
import { adminDb } from '@/lib/firebase/admin'
import { Timestamp } from 'firebase-admin/firestore'
import { randomUUID } from 'crypto'
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
import type { IAPLocalization, IAPTranslationCache } from '@/lib/firebase/firestore'

const translateSchema = z.object({
  projectId: z.string(),
  iapId: z.string(),
  targetLocales: z.array(z.string()).min(1),
  force: z.boolean().optional().default(false),
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
  let usageOperationId: string | undefined
  try {
    body = translateSchema.parse(await request.json())
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(`Validation error: ${error.errors.map(e => e.message).join(', ')}`)
    }
    return errorResponse('Invalid request body')
  }

  const { projectId, iapId, targetLocales, force } = body

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

    // Get the IAP
    const iapDoc = await basePath.collection('inAppPurchases').doc(iapId).get()
    if (!iapDoc.exists) {
      return errorResponse('IAP not found', 404)
    }

    // Get primary locale localization
    const project = await basePath.get()
    const primaryLocale = project.data()?.primaryLocale || 'en-US'

    const primaryLocDoc = await basePath
      .collection('inAppPurchases')
      .doc(iapId)
      .collection('localizations')
      .doc(primaryLocale)
      .get()

    if (!primaryLocDoc.exists) {
      return errorResponse('Primary locale localization not found. Please add content for the primary locale first.')
    }

    const primaryLoc = primaryLocDoc.data() as IAPLocalization

    // Get existing translation cache
    const cacheSnapshot = await basePath.collection('iapTranslations').get()
    const existingCache = new Map<string, IAPTranslationCache>()
    cacheSnapshot.docs.forEach(doc => {
      const data = doc.data() as IAPTranslationCache
      existingCache.set(`${data.locale}_${data.field}`, data)
    })

    const billableLocales = getIAPLocalesRequiringTranslation({
      sourceLocale: primaryLocale,
      targetLocales,
      displayName: primaryLoc.displayName,
      description: primaryLoc.description,
      existingCache: force ? undefined : existingCache,
      forceTranslate: force,
    })
    if (billableLocales.length > 0) {
      usageOperationId = `iap-translate:${request.headers.get('idempotency-key') || randomUUID()}`
      const reservation = await reserveUsage(authContext, {
        operationId: usageOperationId,
        usageType: 'translations',
        units: billableLocales.length,
        metadata: { route: 'iap-translate', projectId, iapId },
      })
      if (!reservation.allowed) return createReservationErrorResponse(reservation)
      if (reservation.replayed) {
        return errorResponse('This translation request has already been processed', 409)
      }
    }

    // Translate
    const results = await translateIAPFields({
      sourceLocale: primaryLocale,
      targetLocales,
      displayName: primaryLoc.displayName,
      description: primaryLoc.description,
      existingCache: force ? undefined : existingCache,
      forceTranslate: force,
    })

    // Save translations to localizations and cache
    const batch = adminDb.batch()
    const now = Timestamp.now()

    for (const result of results) {
      // Save localization
      const locRef = basePath
        .collection('inAppPurchases')
        .doc(iapId)
        .collection('localizations')
        .doc(result.locale)

      batch.set(locRef, {
        locale: result.locale,
        displayName: result.displayName,
        description: result.description,
      }, { merge: true })

      // Save cache entries
      if (!result.fromCache) {
        const cacheKeyName = `${iapId}_${result.locale}_displayName`
        const cacheKeyDesc = `${iapId}_${result.locale}_description`

        batch.set(basePath.collection('iapTranslations').doc(cacheKeyName), {
          locale: result.locale,
          field: 'displayName',
          sourceHash: result.sourceHash,
          translatedText: result.displayName,
          createdAt: now,
        })

        batch.set(basePath.collection('iapTranslations').doc(cacheKeyDesc), {
          locale: result.locale,
          field: 'description',
          sourceHash: result.sourceHash,
          translatedText: result.description,
          createdAt: now,
        })
      }
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

    return Response.json({
      success: true,
      translations: results,
      summary: {
        total: results.length,
        fromCache: results.filter(r => r.fromCache).length,
        translated: results.filter(r => !r.fromCache).length,
      },
    })
  } catch (error) {
    if (usageOperationId) await refundUsage(authContext, usageOperationId, 'translations')
    console.error('Error translating IAP:', error)
    return errorResponse(error instanceof Error ? error.message : 'Failed to translate IAP', 500)
  }
}
