import { readBoundedJson, RequestBodyLimitError } from '@/lib/api/bounded-body'
import { NextRequest } from 'next/server'
import { z } from 'zod'
import { authenticateRequest, errorResponse, unauthorizedResponse } from '@/lib/api/auth'
import { createReservationErrorResponse, UsageLimitError, withUsageReservation } from '@/lib/api/usage'
import { getProjectContext, hasContextPermission } from '@/lib/org/context'
import { PlayStoreHelper, PlayStoreMetadata } from '@/lib/services/playstore'
import { decryptPlayStoreCredentials } from '@/lib/crypto/credentials'
import { adminDb } from '@/lib/firebase/admin'
import { logAuditEvent, AuditAction } from '@/lib/org/audit'
import { isPlayStoreLocale, IOS_TO_ANDROID_LOCALE_MAP } from '@/lib/constants'
import { randomUUID } from 'node:crypto'

const requestSchema = z.object({
  projectId: z.string(),
  locales: z.array(z.string()).min(1),
  dryRun: z.boolean().optional().default(false),
  translations: z.record(z.string(), z.object({
    title: z.string().optional(),
    shortDescription: z.string().optional(),
    fullDescription: z.string().optional()
  })).optional()
})

export async function POST(request: NextRequest) {
  // Authenticate
  const auth = await authenticateRequest(request)
  if (!auth.authenticated || !auth.context) {
    return unauthorizedResponse(auth.error)
  }

  // Parse request
  let body
  try {
    body = requestSchema.parse(await readBoundedJson(request))
  } catch (error) {
    if (error instanceof RequestBodyLimitError) return Response.json({ error: error.message }, { status: 413 })
    return errorResponse('Invalid request body')
  }

  const { projectId, locales, dryRun, translations: providedTranslations } = body

  // Get project context
  const projectContext = await getProjectContext(auth.context.userId, projectId)
  if (!projectContext) {
    return errorResponse('Project not found', 404)
  }

  // Check permission
  if (!hasContextPermission(projectContext, 'canCreateProjects')) {
    return errorResponse('Permission denied', 403)
  }

  // Convert iOS locales to Android if needed and validate
  const androidLocales: string[] = []
  const localeMapping: Record<string, string> = {}

  for (const locale of locales) {
    const androidLocale = IOS_TO_ANDROID_LOCALE_MAP[locale] || locale
    if (!isPlayStoreLocale(androidLocale)) {
      return errorResponse(`Invalid Play Store locale: ${locale} (${androidLocale})`)
    }
    androidLocales.push(androidLocale)
    localeMapping[locale] = androidLocale
  }

  // Get credentials
  const credentialsRef = projectContext.type === 'organization' && projectContext.orgId
    ? adminDb
        .collection('organizations')
        .doc(projectContext.orgId)
        .collection('projects')
        .doc(projectId)
        .collection('credentials')
        .doc('playstore')
    : adminDb
        .collection('users')
        .doc(auth.context.userId)
        .collection('projects')
        .doc(projectId)
        .collection('credentials')
        .doc('playstore')

  const credentialsDoc = await credentialsRef.get()
  if (!credentialsDoc.exists) {
    return errorResponse('Play Store credentials not configured', 400)
  }

  const encryptedCreds = credentialsDoc.data()!
  const credentials = await decryptPlayStoreCredentials({
    encryptedData: encryptedCreds.encryptedData,
    encryptedDek: encryptedCreds.encryptedDek,
    keyVersion: encryptedCreds.keyVersion
  })

  // Get translations from cache if not provided
  let translations = providedTranslations || {}

  if (Object.keys(translations).length === 0) {
    const translationsRef = projectContext.type === 'organization' && projectContext.orgId
      ? adminDb
          .collection('organizations')
          .doc(projectContext.orgId)
          .collection('projects')
          .doc(projectId)
          .collection('translations')
      : adminDb
          .collection('users')
          .doc(auth.context.userId)
          .collection('projects')
          .doc(projectId)
          .collection('translations')

    for (const locale of locales) {
      const snapshot = await translationsRef
        .where('locale', '==', locale)
        .get()

      translations[locale] = {}
      for (const doc of snapshot.docs) {
        const data = doc.data()
        const field = data.field as string
        // Map App Store fields to Play Store fields
        if (field === 'description') {
          (translations[locale] as Record<string, string>)['fullDescription'] = data.translatedText
        } else if (field === 'subtitle') {
          (translations[locale] as Record<string, string>)['shortDescription'] = data.translatedText
        } else if (field) {
          (translations[locale] as Record<string, string>)[field] = data.translatedText
        }
      }
    }
  }

  // Dry run - just return what would be uploaded
  if (dryRun) {
    return Response.json({
      success: true,
      dryRun: true,
      wouldUpload: Object.entries(translations).map(([locale, fields]) => ({
        locale,
        androidLocale: localeMapping[locale] || locale,
        fields: Object.keys(fields)
      }))
    })
  }

  // Build metadata array for batch upload
  const metadataList: PlayStoreMetadata[] = []

  for (const locale of locales) {
    const androidLocale = localeMapping[locale] || locale
    const localeTranslations = translations[locale]

    if (!localeTranslations || Object.keys(localeTranslations).length === 0) {
      continue
    }

    metadataList.push({
      locale: androidLocale,
      title: localeTranslations.title || '',
      shortDescription: localeTranslations.shortDescription || '',
      fullDescription: localeTranslations.fullDescription || ''
    })
  }

  if (metadataList.length === 0) {
    return errorResponse('No translations available for upload')
  }

  // Upload to Play Store
  let results: Array<{ locale: string; success: boolean; error?: string }>
  try {
    results = await withUsageReservation(
      auth.context,
      {
        operationId: `publish-playstore-route:${request.headers.get('idempotency-key')?.trim() || randomUUID()}`,
        usageType: 'publishing',
        units: 1,
        metadata: { route: 'upload/playstore', projectId },
      },
      async () => new PlayStoreHelper(credentials).uploadMetadataBatch(metadataList),
      uploadResults => uploadResults.some(result => result.success) ? 1 : 0,
    )
  } catch (error) {
    if (error instanceof UsageLimitError) return createReservationErrorResponse(error.result)
    if (error instanceof Error && error.message.includes('already been processed')) {
      return errorResponse('This publishing operation was already processed', 409)
    }
    throw error
  }

  const successCount = results.filter(r => r.success).length

  // Log audit event
  if (projectContext.type === 'organization' && projectContext.orgId) {
    await logAuditEvent({
      orgId: projectContext.orgId,
      action: AuditAction.UPLOAD_RUN,
      userId: auth.context.userId,
      resourceType: 'project',
      resourceId: projectId,
      metadata: {
        store: 'playstore',
        locales: locales.length,
        successCount
      }
    })
  }

  return Response.json({
    success: successCount > 0,
    results: results.map(r => ({
      ...r,
      originalLocale: Object.entries(localeMapping).find(([_, v]) => v === r.locale)?.[0]
    })),
    stats: {
      total: metadataList.length,
      success: successCount,
      failed: metadataList.length - successCount
    }
  })
}
