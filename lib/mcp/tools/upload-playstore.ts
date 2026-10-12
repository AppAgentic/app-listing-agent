import { PlayStoreHelper, PlayStoreMetadata } from '@/lib/services/playstore'
import { decryptPlayStoreCredentials } from '@/lib/crypto/credentials'
import { adminDb } from '@/lib/firebase/admin'
import { isPlayStoreLocale, IOS_TO_ANDROID_LOCALE_MAP } from '@/lib/constants'
import { AccountContext, getProjectContext, hasContextPermission } from '@/lib/org/context'
import { createReservationErrorResponse, refundUsage, reserveUsage, settleUsage } from '@/lib/api/usage'
import { logAuditEvent, AuditAction } from '@/lib/org/audit'
import { randomUUID } from 'node:crypto'

export interface UploadPlayStoreParams {
  __usageOperationId?: string
  projectId: string
  locales: string[]
  dryRun?: boolean
  translations?: Record<string, {
    title?: string
    shortDescription?: string
    fullDescription?: string
  }>
}

export interface UploadPlayStoreResult {
  success: boolean
  dryRun?: boolean
  wouldUpload?: Array<{
    locale: string
    androidLocale: string
    fields: string[]
    metadata: Record<string, string>
  }>
  results?: Array<{ locale: string; originalLocale?: string; success: boolean; error?: string }>
  stats?: {
    total: number
    success: number
    failed: number
  }
  error?: string
  requiresUpgrade?: boolean
  upgradeUrl?: string
}

export async function uploadPlayStore(
  params: UploadPlayStoreParams,
  context: AccountContext
): Promise<UploadPlayStoreResult> {
  const { projectId, locales, dryRun, translations: providedTranslations } = params

  // Validate project access
  const projectContext = await getProjectContext(context.userId, projectId)
  if (!projectContext) {
    return { success: false, error: 'Project not found' }
  }

  if (!hasContextPermission(projectContext, 'canCreateProjects')) {
    return { success: false, error: 'Permission denied' }
  }

  // Convert iOS locales to Android if needed and validate
  const androidLocales: string[] = []
  const localeMapping: Record<string, string> = {}

  for (const locale of locales) {
    const androidLocale = IOS_TO_ANDROID_LOCALE_MAP[locale] || locale
    if (!isPlayStoreLocale(androidLocale)) {
      return { success: false, error: `Invalid Play Store locale: ${locale} (${androidLocale})` }
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
        .doc(context.userId)
        .collection('projects')
        .doc(projectId)
        .collection('credentials')
        .doc('playstore')

  const credentialsDoc = await credentialsRef.get()
  if (!credentialsDoc.exists) {
    return { success: false, error: 'Play Store credentials not configured' }
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
    return {
      success: true,
      dryRun: true,
      wouldUpload: Object.entries(translations).map(([locale, fields]) => ({
        locale,
        androidLocale: localeMapping[locale] || locale,
        fields: Object.keys(fields),
        metadata: fields as Record<string, string>,
      }))
    }
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
    return { success: false, error: 'No translations available for upload' }
  }

  const operationId = params.__usageOperationId || `publish-playstore:${randomUUID()}`
  const reservation = await reserveUsage(context, {
    operationId,
    usageType: 'publishing',
    units: 1,
    metadata: { tool: 'upload_playstore_metadata', projectId },
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

  // Upload to Play Store
  let results: Array<{ locale: string; success: boolean; error?: string }>
  let successCount = 0
  try {
    const helper = new PlayStoreHelper(credentials)
    results = await helper.uploadMetadataBatch(metadataList)
    successCount = results.filter(r => r.success).length
  } catch (error) {
    await refundUsage(context, operationId, 'publishing')
    throw error
  }
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
        store: 'playstore',
        locales: locales.length,
        successCount
      }
    })
  }

  return {
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
  }
}
