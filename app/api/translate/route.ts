import { readBoundedJson, RequestBodyLimitError } from '@/lib/api/bounded-body'
import { NextRequest } from 'next/server'
import crypto from 'crypto'
import { z } from 'zod'
import { authenticateRequest, errorResponse, unauthorizedResponse } from '@/lib/api/auth'
import {
  createReservationErrorResponse,
  readUsage,
  refundUsage,
  reserveUsage,
  settleUsage,
} from '@/lib/api/usage'
import { TranslationHelper, Store, TranslationField } from '@/lib/services/translator'
import { getProjectContext, hasContextPermission, getAccountContext, AccountContext } from '@/lib/org/context'
import { getSession } from '@/lib/auth/session'
import { adminDb } from '@/lib/firebase/admin'
import { Timestamp } from 'firebase-admin/firestore'
import { isAppStoreLocale, isPlayStoreLocale } from '@/lib/constants'

const requestSchema = z.object({
  projectId: z.string(),
  store: z.enum(['appstore', 'playstore']),
  locales: z.array(z.string()).min(1),
  force: z.boolean().optional().default(false),
  metadata: z.object({
    title: z.string().optional(),
    subtitle: z.string().optional(),
    description: z.string().optional(),
    keywords: z.string().optional(),
    whatsNew: z.string().optional(),
    promotionalText: z.string().optional(),
    shortDescription: z.string().optional(),
    fullDescription: z.string().optional()
  })
})

// Helper to get auth context from either API key or session
async function getAuthContext(request: NextRequest): Promise<{ context: AccountContext | null; error?: string }> {
  // First try API key / header-based auth
  const authHeader = request.headers.get('Authorization')
  if (authHeader) {
    const auth = await authenticateRequest(request)
    if (auth.authenticated && auth.context) {
      return { context: auth.context }
    }
    return { context: null, error: auth.error }
  }

  // Fallback to session-based auth (cookie-based)
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
  // Authenticate (supports both API key and session)
  const { context: authContext, error: authError } = await getAuthContext(request)
  if (!authContext) {
    return unauthorizedResponse(authError)
  }

  // Parse request
  let body
  try {
    body = requestSchema.parse(await readBoundedJson(request))
  } catch (error) {
    if (error instanceof RequestBodyLimitError) return Response.json({ error: error.message }, { status: 413 })
    return errorResponse('Invalid request body')
  }

  const { projectId, store, locales, force, metadata } = body

  // Get project context
  const projectContext = await getProjectContext(authContext.userId, projectId)
  if (!projectContext) {
    return errorResponse('Project not found', 404)
  }

  // Check permission
  if (!hasContextPermission(projectContext, 'canCreateProjects')) {
    return errorResponse('Permission denied', 403)
  }

  // Validate locales
  const isValidLocale = store === 'appstore' ? isAppStoreLocale : isPlayStoreLocale
  const invalidLocales = locales.filter(l => !isValidLocale(l))
  if (invalidLocales.length > 0) {
    return errorResponse(`Invalid locales for ${store}: ${invalidLocales.join(', ')}`)
  }

  // Filter out en-US (source language) but keep other English variants (en-GB, en-AU, etc.)
  // English regional variants get adapted spelling and terminology
  const targetLocales = locales.filter(l => l !== 'en-US')

  // Check usage limit (paywall for free users)
  const fieldsToTranslate = Object.keys(metadata).filter(k => metadata[k as keyof typeof metadata])
  const estimatedTranslations = targetLocales.length * fieldsToTranslate.length

  if (estimatedTranslations === 0) {
    return Response.json({
      success: true,
      translations: {},
      stats: { localesProcessed: 0, translationsCreated: 0, translationsCached: 0 },
    })
  }

  // Get cached translations
  const getCached = async (locale: string) => {
    const cacheRef = projectContext.type === 'organization' && projectContext.orgId
      ? adminDb
          .collection('organizations')
          .doc(projectContext.orgId)
          .collection('projects')
          .doc(projectId)
          .collection('translations')
      : adminDb
          .collection('users')
          .doc(authContext.userId)
          .collection('projects')
          .doc(projectId)
          .collection('translations')

    const cacheSnapshot = await cacheRef
      .where('locale', '==', locale)
      .get()

    const cached: Record<string, { translatedText: string; sourceHash: string }> = {}
    for (const doc of cacheSnapshot.docs) {
      const data = doc.data()
      cached[data.field] = {
        translatedText: data.translatedText,
        sourceHash: data.sourceHash
      }
    }
    return Object.keys(cached).length > 0 ? cached : undefined
  }

  // Check if Gemini API key is configured
  if (!process.env.GEMINI_API_KEY) {
    return errorResponse('Translation service not configured. Please set GEMINI_API_KEY.', 503)
  }

  const operationId = request.headers.get('idempotency-key') || crypto.randomUUID()
  const reservation = await reserveUsage(authContext, {
    operationId,
    usageType: 'translations',
    units: estimatedTranslations,
    metadata: { route: '/api/translate', projectId },
  })
  if (!reservation.allowed) return createReservationErrorResponse(reservation)
  if (reservation.replayed) {
    return errorResponse('This translation operation was already processed', 409)
  }

  try {
    // Translate
    const translator = new TranslationHelper()
    const results = await translator.translateToLocales(
      metadata,
      targetLocales,
      store as Store,
      force ? undefined : getCached
    )

  // Save translations to cache
  const translationsRef = projectContext.type === 'organization' && projectContext.orgId
    ? adminDb
        .collection('organizations')
        .doc(projectContext.orgId)
        .collection('projects')
        .doc(projectId)
        .collection('translations')
    : adminDb
        .collection('users')
        .doc(authContext.userId)
        .collection('projects')
        .doc(projectId)
        .collection('translations')

  let successCount = 0
  const translationResults: Record<string, Record<string, string>> = {}

  for (const [locale, translations] of results) {
    translationResults[locale] = {}

    for (const translation of translations) {
      if (!translation.cached) {
        // Save to cache
        const docId = `${locale}_${translation.field}`
        await translationsRef.doc(docId).set({
          locale,
          field: translation.field,
          sourceHash: translation.sourceHash,
          translatedText: translation.translatedText,
          createdAt: Timestamp.now()
        })
        successCount++
      }
      translationResults[locale][translation.field] = translation.translatedText
    }
  }

    await settleUsage(authContext, operationId, 'translations', successCount)
    const currentUsage = await readUsage(authContext, 'translations')

  // Check if any translations failed (collect errors)
  const errors: Array<{ locale: string; field: string; error: string }> = []
  for (const [locale, translations] of results) {
    const localeErrors = (translations as any).__errors
    if (localeErrors) {
      for (const err of localeErrors) {
        errors.push({ locale, ...err })
      }
    }
  }

    return Response.json({
      success: true,
      translations: translationResults,
      stats: {
        localesProcessed: targetLocales.length,
        translationsCreated: successCount,
        translationsCached: estimatedTranslations - successCount
      },
      billing: {
        currentUsage: currentUsage.used,
        monthlyLimit: currentUsage.limit,
        willExceedLimit: false,
        withinPlanCount: successCount,
        overageCount: 0,
        estimatedOverageCost: 0,
        plan: currentUsage.plan,
      },
      ...(errors.length > 0 ? { errors } : {})
    })
  } catch (error) {
    await refundUsage(authContext, operationId, 'translations')
    return errorResponse(error instanceof Error ? error.message : 'Translation failed', 500)
  }
}
