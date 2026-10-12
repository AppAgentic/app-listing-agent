import { NextRequest } from 'next/server'
import { z } from 'zod'
import { authenticateRequest, errorResponse, unauthorizedResponse } from '@/lib/api/auth'
import { createReservationErrorResponse, UsageLimitError, withUsageReservation } from '@/lib/api/usage'
import { getProjectContext, hasContextPermission } from '@/lib/org/context'
import { AppStoreHelper, AppStoreMetadata } from '@/lib/services/appstore'
import { decryptAppStoreCredentials } from '@/lib/crypto/credentials'
import { adminDb } from '@/lib/firebase/admin'
import { logAuditEvent, AuditAction } from '@/lib/org/audit'
import { isAppStoreLocale } from '@/lib/constants'
import { randomUUID } from 'node:crypto'

const requestSchema = z.object({
  projectId: z.string(),
  locales: z.array(z.string()).min(1),
  dryRun: z.boolean().optional().default(false),
  translations: z.record(z.string(), z.object({
    title: z.string().optional(),
    subtitle: z.string().optional(),
    description: z.string().optional(),
    keywords: z.string().optional(),
    whatsNew: z.string().optional()
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
    body = requestSchema.parse(await request.json())
  } catch (error) {
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

  // Validate locales
  const invalidLocales = locales.filter(l => !isAppStoreLocale(l))
  if (invalidLocales.length > 0) {
    return errorResponse(`Invalid App Store locales: ${invalidLocales.join(', ')}`)
  }

  // Get credentials
  const credentialsRef = projectContext.type === 'organization' && projectContext.orgId
    ? adminDb
        .collection('organizations')
        .doc(projectContext.orgId)
        .collection('projects')
        .doc(projectId)
        .collection('credentials')
        .doc('appstore')
    : adminDb
        .collection('users')
        .doc(auth.context.userId)
        .collection('projects')
        .doc(projectId)
        .collection('credentials')
        .doc('appstore')

  const credentialsDoc = await credentialsRef.get()
  if (!credentialsDoc.exists) {
    return errorResponse('App Store credentials not configured', 400)
  }

  const encryptedCreds = credentialsDoc.data()!
  const credentials = await decryptAppStoreCredentials({
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
        const field = data.field as keyof typeof translations[typeof locale]
        if (field) {
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
        fields: Object.keys(fields)
      }))
    })
  }

  // Upload to App Store Connect
  let results: Array<{ locale: string; success: boolean; error?: string }>
  try {
    results = await withUsageReservation(
      auth.context,
      {
        operationId: `publish-appstore-route:${request.headers.get('idempotency-key')?.trim() || randomUUID()}`,
        usageType: 'publishing',
        units: 1,
        metadata: { route: 'upload/appstore', projectId },
      },
      async () => {
        const helper = new AppStoreHelper(credentials)
        const uploadResults: Array<{ locale: string; success: boolean; error?: string }> = []
        for (const locale of locales) {
          const localeTranslations = translations[locale]
          if (!localeTranslations || Object.keys(localeTranslations).length === 0) {
            uploadResults.push({ locale, success: false, error: 'No translations available' })
            continue
          }
          const metadata: AppStoreMetadata = {
            locale,
            name: localeTranslations.title || '',
            subtitle: localeTranslations.subtitle || '',
            description: localeTranslations.description || '',
            keywords: localeTranslations.keywords || '',
            whatsNew: localeTranslations.whatsNew || '',
            supportUrl: undefined,
            marketingUrl: undefined,
            privacyUrl: undefined,
          }
          uploadResults.push(await helper.uploadMetadata(metadata))
        }
        return uploadResults
      },
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
        store: 'appstore',
        locales: locales.length,
        successCount
      }
    })
  }

  return Response.json({
    success: successCount > 0,
    results,
    stats: {
      total: locales.length,
      success: successCount,
      failed: locales.length - successCount
    }
  })
}
