import { measureMetadataFields, type MetadataFieldLength } from '@/lib/mcp/metadata-field-lengths'
import { TranslationHelper, Store } from '@/lib/services/translator'
import { adminDb } from '@/lib/firebase/admin'
import { Timestamp } from 'firebase-admin/firestore'
import { isAppStoreLocale, isPlayStoreLocale } from '@/lib/constants'
import { AccountContext, getProjectContext, hasContextPermission } from '@/lib/org/context'
import crypto from 'crypto'
import { refundUsage, reserveUsage, settleUsage } from '@/lib/api/usage'
import { updateMetadata, type UpdateMetadataParams } from './update-metadata'

export interface TranslateMetadataParams {
  __usageOperationId?: string
  projectId: string
  store: 'appstore' | 'playstore'
  locales: string[]
  force?: boolean
  /** When true, also save the translated fields to each target locale's local draft. */
  saveToLocaleDraft?: boolean
  metadata: {
    title?: string
    subtitle?: string
    description?: string
    keywords?: string
    whatsNew?: string
    promotionalText?: string
    shortDescription?: string
    fullDescription?: string
  }
}

export interface TranslateMetadataResult {
  success: boolean
  translations?: Record<string, Record<string, string>>
  fieldValidation?: Record<string, Record<string, MetadataFieldLength>>
  characterCountUnit?: 'unicode-code-points'
  metadataSaved?: boolean
  savedLocales?: Record<string, { saved: boolean; fieldsUpdated?: string[]; error?: string }>
  message?: string
  nextAction?: {
    tool: 'update_metadata'
    requests: UpdateMetadataParams[]
    verificationTool: 'read_metadata'
  } | null
  stats?: {
    localesProcessed: number
    translationsCreated: number
    translationsCached: number
  }
  error?: string
  requiresUpgrade?: boolean
  upgradeUrl?: string
}

export async function translateMetadata(
  params: TranslateMetadataParams,
  context: AccountContext
): Promise<TranslateMetadataResult> {
  const { projectId, store, locales, force, metadata } = params

  // Validate project access
  const projectContext = await getProjectContext(context.userId, projectId)
  if (!projectContext) {
    return { success: false, error: 'Project not found' }
  }

  if (!hasContextPermission(projectContext, 'canCreateProjects')) {
    return { success: false, error: 'Permission denied' }
  }

  // Validate locales
  const isValidLocale = store === 'appstore' ? isAppStoreLocale : isPlayStoreLocale
  const invalidLocales = locales.filter(l => !isValidLocale(l))
  if (invalidLocales.length > 0) {
    return { success: false, error: `Invalid locales for ${store}: ${invalidLocales.join(', ')}` }
  }

  // Filter out English locales
  const targetLocales = locales.filter(l => !l.startsWith('en'))

  // Check usage limit
  const fieldsToTranslate = Object.keys(metadata).filter(k => metadata[k as keyof typeof metadata])
  const estimatedTranslations = targetLocales.length * fieldsToTranslate.length

  if (estimatedTranslations === 0) {
    return {
      success: true,
      translations: {},
      fieldValidation: {},
      characterCountUnit: 'unicode-code-points',
      metadataSaved: false,
      message: 'No target fields were translated. Saved listing metadata and stores are unchanged.',
      nextAction: null,
      stats: { localesProcessed: 0, translationsCreated: 0, translationsCached: 0 },
    }
  }
  const operationId = params.__usageOperationId || crypto.randomUUID()
  const reservation = await reserveUsage(context, {
    operationId,
    usageType: 'translations',
    units: estimatedTranslations,
    metadata: { tool: 'translate_metadata', projectId },
  })
  if (!reservation.allowed) {
    if (reservation.requiresUpgrade) {
      return {
        success: false,
        error: 'This feature requires a paid plan. Upgrade to Pro to unlock translations.',
        requiresUpgrade: true,
        upgradeUrl: '/billing'
      }
    }
    return {
      success: false,
      error: `Translation limit exceeded. Remaining: ${reservation.remaining}, Required: ${estimatedTranslations}`
    }
  }
  if (reservation.replayed) return { success: false, error: 'This translation operation was already processed' }

  // Get cached translations function
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
          .doc(context.userId)
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

  try {
    // Perform translations
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
        .doc(context.userId)
        .collection('projects')
        .doc(projectId)
        .collection('translations')

  let successCount = 0
  const translationResults: Record<string, Record<string, string>> = {}

  for (const [locale, translations] of results) {
    translationResults[locale] = {}

    for (const translation of translations) {
      if (!translation.cached) {
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

    await settleUsage(context, operationId, 'translations', successCount)

    // Translation cache is separate from the dashboard's metadata collection.
    // Offer bounded save requests, but never apply them as a translation side effect.
    const allowedFields = new Set(store === 'appstore'
      ? ['title', 'subtitle', 'description', 'keywords', 'whatsNew', 'promotionalText']
      : ['title', 'shortDescription', 'fullDescription'])
    const saveRequests: UpdateMetadataParams[] = Object.entries(translationResults)
      .filter(([locale]) => targetLocales.includes(locale))
      .map(([locale, translated]) => ({
        projectId,
        store,
        locale,
        metadata: Object.fromEntries(Object.entries(translated).filter(([field]) =>
          allowedFields.has(field) && fieldsToTranslate.includes(field)
        )),
      }))
      .filter(request => Object.keys(request.metadata).length > 0)

    const fieldValidation = Object.fromEntries(Object.entries(translationResults).map(([locale, fields]) =>
      [locale, measureMetadataFields(store, fields)]
    ))

    if (params.saveToLocaleDraft === true && saveRequests.length > 0) {
      // Explicitly requested save: apply exactly the translated fields to each
      // locale draft. update_metadata validates lengths and never truncates.
      const savedLocales: NonNullable<TranslateMetadataResult['savedLocales']> = {}
      for (const request of saveRequests) {
        const saved = await updateMetadata(request, context)
        savedLocales[request.locale] = saved.success
          ? { saved: true, fieldsUpdated: saved.fieldsUpdated ?? [] }
          : { saved: false, error: saved.error ?? 'The locale draft was not saved.' }
      }
      const allSaved = Object.values(savedLocales).every(entry => entry.saved)
      return {
        success: allSaved,
        translations: translationResults,
        fieldValidation,
        characterCountUnit: 'unicode-code-points',
        metadataSaved: allSaved,
        savedLocales,
        message: allSaved
          ? 'Translations were saved to the local locale drafts. Other fields in those locales are unchanged. Nothing was published to a store.'
          : 'Some locale drafts were not saved; see savedLocales for the reason. Nothing was published to a store.',
        ...(allSaved ? {} : { error: 'One or more translated locale drafts could not be saved.' }),
        nextAction: null,
        stats: {
          localesProcessed: targetLocales.length,
          translationsCreated: successCount,
          translationsCached: estimatedTranslations - successCount
        }
      }
    }

    return {
      success: true,
      translations: translationResults,
      fieldValidation,
      characterCountUnit: 'unicode-code-points',
      metadataSaved: false,
      message: 'Translations are returned and cached only. Saved listing metadata and stores are unchanged. The returned requests save these fields to the locale drafts; saveToLocaleDraft=true saves them in the same call.',
      nextAction: saveRequests.length > 0
        ? { tool: 'update_metadata', requests: saveRequests, verificationTool: 'read_metadata' }
        : null,
      stats: {
        localesProcessed: targetLocales.length,
        translationsCreated: successCount,
        translationsCached: estimatedTranslations - successCount
      }
    }
  } catch (error) {
    await refundUsage(context, operationId, 'translations')
    return { success: false, error: error instanceof Error ? error.message : 'Translation failed' }
  }
}
