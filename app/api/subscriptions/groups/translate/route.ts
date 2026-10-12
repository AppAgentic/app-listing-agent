import { NextRequest } from 'next/server'
import { z } from 'zod'
import { authenticateRequest, errorResponse, unauthorizedResponse } from '@/lib/api/auth'
import { getProjectContext, hasContextPermission, getAccountContext, AccountContext } from '@/lib/org/context'
import { getSession } from '@/lib/auth/session'
import { adminDb } from '@/lib/firebase/admin'
import { Timestamp } from 'firebase-admin/firestore'
import { randomUUID } from 'crypto'
import {
  getGroupLocalesRequiringTranslation,
  translateGroupNames,
  type GroupTranslationCache,
} from '@/lib/services/iap-translator'
import {
  createReservationErrorResponse,
  refundUsage,
  reserveUsage,
  settleUsage,
} from '@/lib/api/usage'

const translateSchema = z.object({
  projectId: z.string(),
  groupId: z.string(),
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

  const { projectId, groupId, targetLocales, force } = body

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

    // Find subscription group
    const groupRef = basePath.collection('subscriptionGroups').doc(groupId)
    const groupDoc = await groupRef.get()

    if (!groupDoc.exists) {
      return errorResponse('Subscription group not found', 404)
    }

    // Get primary locale
    const project = await basePath.get()
    const primaryLocale = project.data()?.primaryLocale || 'en-US'

    // Get primary locale localization
    const primaryLocDoc = await groupRef.collection('localizations').doc(primaryLocale).get()

    if (!primaryLocDoc.exists || !primaryLocDoc.data()?.name) {
      return errorResponse('Primary locale localization not found. Please add content for the primary locale first.')
    }

    const primaryLoc = primaryLocDoc.data() as { name: string; customAppName?: string | null }

    // Get existing cache
    const cacheSnapshot = await basePath.collection('groupTranslations').get()
    const existingCache = new Map<string, GroupTranslationCache>()
    cacheSnapshot.docs.forEach(doc => {
      const data = doc.data()
      existingCache.set(`${data.locale}_${data.field}`, {
        sourceHash: data.sourceHash,
        translatedText: data.translatedText,
      })
    })

    const billableLocales = getGroupLocalesRequiringTranslation({
      sourceLocale: primaryLocale,
      targetLocales,
      name: primaryLoc.name,
      existingCache: force ? undefined : existingCache,
      forceTranslate: force,
    })
    if (billableLocales.length > 0) {
      usageOperationId = `subscription-group-translate:${request.headers.get('idempotency-key') || randomUUID()}`
      const reservation = await reserveUsage(authContext, {
        operationId: usageOperationId,
        usageType: 'translations',
        units: billableLocales.length,
        metadata: { route: 'subscription-group-translate', projectId, groupId },
      })
      if (!reservation.allowed) return createReservationErrorResponse(reservation)
      if (reservation.replayed) {
        return errorResponse('This translation request has already been processed', 409)
      }
    }

    // Translate
    const results = await translateGroupNames({
      sourceLocale: primaryLocale,
      targetLocales,
      name: primaryLoc.name,
      existingCache: force ? undefined : existingCache,
      forceTranslate: force,
    })

    // Save translations
    const batch = adminDb.batch()
    const now = Timestamp.now()

    for (const result of results) {
      // Save localization
      const locRef = groupRef.collection('localizations').doc(result.locale)
      batch.set(locRef, {
        locale: result.locale,
        name: result.name,
        customAppName: primaryLoc.customAppName || null, // Copy custom app name if exists
      }, { merge: true })

      // Save cache
      if (!result.fromCache) {
        const cacheKey = `group_${groupId}_${result.locale}_name`
        batch.set(basePath.collection('groupTranslations').doc(cacheKey), {
          locale: result.locale,
          field: 'name',
          sourceHash: result.sourceHash,
          translatedText: result.name,
          createdAt: now,
        })
      }
    }

    // Mark group as having local changes
    batch.update(groupRef, {
      syncStatus: 'local_changes',
      updatedAt: now,
    })

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
    console.error('Error translating subscription group:', error)
    return errorResponse(error instanceof Error ? error.message : 'Failed to translate subscription group', 500)
  }
}
