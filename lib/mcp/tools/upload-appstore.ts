import { AppStoreHelper, AppStoreMetadata } from '@/lib/services/appstore'
import { decryptAppStoreCredentials } from '@/lib/crypto/credentials'
import { adminDb } from '@/lib/firebase/admin'
import { isAppStoreLocale } from '@/lib/constants'
import { AccountContext, getProjectContext, hasContextPermission } from '@/lib/org/context'
import { createReservationErrorResponse, refundUsage, reserveUsage, settleUsage } from '@/lib/api/usage'
import { logAuditEvent, AuditAction } from '@/lib/org/audit'
import { randomUUID } from 'node:crypto'

export interface UploadAppStoreParams {
  __usageOperationId?: string
  projectId: string
  locales: string[]
  dryRun?: boolean
  translations?: Record<string, {
    title?: string
    subtitle?: string
    description?: string
    keywords?: string
    whatsNew?: string
  }>
}

export interface UploadAppStoreResult {
  success: boolean
  dryRun?: boolean
  wouldUpload?: Array<{
    locale: string
    fields: string[]
    metadata: Record<string, string>
  }>
  results?: Array<{ locale: string; success: boolean; error?: string }>
  stats?: {
    total: number
    success: number
    failed: number
  }
  error?: string
  requiresUpgrade?: boolean
  upgradeUrl?: string
}

export async function uploadAppStore(
  params: UploadAppStoreParams,
  context: AccountContext
): Promise<UploadAppStoreResult> {
  const { projectId, locales, dryRun, translations: providedTranslations } = params

  // Validate project access
  const projectContext = await getProjectContext(context.userId, projectId)
  if (!projectContext) {
    return { success: false, error: 'Project not found' }
  }

  if (!hasContextPermission(projectContext, 'canCreateProjects')) {
    return { success: false, error: 'Permission denied' }
  }

  // Validate locales
  const invalidLocales = locales.filter(l => !isAppStoreLocale(l))
  if (invalidLocales.length > 0) {
    return { success: false, error: `Invalid App Store locales: ${invalidLocales.join(', ')}` }
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
        .doc(context.userId)
        .collection('projects')
        .doc(projectId)
        .collection('credentials')
        .doc('appstore')

  const credentialsDoc = await credentialsRef.get()
  if (!credentialsDoc.exists) {
    return { success: false, error: 'App Store credentials not configured' }
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
          .doc(context.userId)
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
        if (field) {
          (translations[locale] as Record<string, string>)[field] = data.translatedText
        }
      }
    }
  }

  // Dry run - just return what would be uploaded
  if (dryRun) {
    return {
      success: true,
      dryRun: true,
      wouldUpload: Object.entries(translations).map(([locale, fields]) => ({
        locale,
        fields: Object.keys(fields),
        metadata: fields as Record<string, string>,
      }))
    }
  }

  const operationId = params.__usageOperationId || `publish-appstore:${randomUUID()}`
  const reservation = await reserveUsage(context, {
    operationId,
    usageType: 'publishing',
    units: 1,
    metadata: { tool: 'upload_appstore_metadata', projectId },
  })
  if (!reservation.allowed) {
    const response = createReservationErrorResponse(reservation)
    const payload = await response.json()
    return {
      success: false,
      error: payload.message || 'Publishing limit reached',
      requiresUpgrade: reservation.requiresUpgrade,
      upgradeUrl: '/billing',
    }
  }
  if (reservation.replayed) return { success: false, error: 'This publishing operation was already processed' }

  // Upload to App Store Connect
  const results: Array<{ locale: string; success: boolean; error?: string }> = []
  let successCount = 0
  try {
    const helper = new AppStoreHelper(credentials)
    for (const locale of locales) {
      const localeTranslations = translations[locale]
      if (!localeTranslations || Object.keys(localeTranslations).length === 0) {
        results.push({ locale, success: false, error: 'No translations available' })
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
        privacyUrl: undefined
      }

      const result = await helper.uploadMetadata(metadata)
      results.push(result)
    }
  } catch (error) {
    successCount = results.filter(r => r.success).length
    if (successCount > 0) await settleUsage(context, operationId, 'publishing', 1)
    else await refundUsage(context, operationId, 'publishing')
    throw error
  }
  successCount = results.filter(r => r.success).length
  await settleUsage(context, operationId, 'publishing', successCount > 0 ? 1 : 0)

  // Log audit event
  if (projectContext.type === 'organization' && projectContext.orgId) {
    await logAuditEvent({
      orgId: projectContext.orgId,
      action: AuditAction.UPLOAD_RUN,
      userId: context.userId,
      resourceType: 'project',
      resourceId: projectId,
      metadata: {
        store: 'appstore',
        locales: locales.length,
        successCount
      }
    })
  }

  return {
    success: successCount > 0,
    results,
    stats: {
      total: locales.length,
      success: successCount,
      failed: locales.length - successCount
    }
  }
}
