import { metadataCharacterCount, metadataFieldLimits } from '@/lib/mcp/metadata-field-lengths'
import { adminDb } from '@/lib/firebase/admin'
import { Timestamp } from 'firebase-admin/firestore'
import { isAppStoreLocale, isPlayStoreLocale } from '@/lib/constants'
import { AccountContext, getProjectContext, hasContextPermission } from '@/lib/org/context'

export interface UpdateMetadataParams {
  projectId: string
  store: 'appstore' | 'playstore'
  locale: string
  metadata: {
    title?: string  // Maps to 'name' in the DB
    subtitle?: string
    description?: string
    keywords?: string
    whatsNew?: string
    shortDescription?: string
    fullDescription?: string
    promotionalText?: string
    privacyUrl?: string
    marketingUrl?: string
    supportUrl?: string
  }
}

export interface UpdateMetadataResult {
  success: boolean
  fieldsUpdated?: string[]
  fieldsIgnored?: string[]
  error?: string
}

// Generate hash for change detection
function generateHash(data: Record<string, unknown>): string {
  const str = JSON.stringify(data, Object.keys(data).sort())
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash
  }
  return Math.abs(hash).toString(36)
}

export async function updateMetadata(
  params: UpdateMetadataParams,
  context: AccountContext
): Promise<UpdateMetadataResult> {
  const { projectId, store, locale, metadata } = params

  // Validate the request before any database operation. Never truncate user copy.
  if (store !== 'appstore' && store !== 'playstore') {
    return { success: false, error: 'store must be appstore or playstore' }
  }
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return { success: false, error: 'metadata must be an object of text fields' }
  }
  const limits = metadataFieldLimits(store)
  const validFields = new Set([...Object.keys(limits), ...(store === 'appstore' ? ['privacyUrl', 'marketingUrl', 'supportUrl'] : [])])
  for (const [field, value] of Object.entries(metadata)) {
    // Keep the existing contract: fields belonging to the other store are ignored.
    if (!validFields.has(field) || value === undefined) continue
    if (typeof value !== 'string') {
      return { success: false, error: `metadata.${field} must be a string. No metadata was saved.` }
    }
    const length = metadataCharacterCount(value)
    const limit = limits[field]
    if (limit !== undefined && length > limit) {
      return { success: false, error: `metadata.${field} is ${length} characters; maximum is ${limit}. No metadata was saved.` }
    }
  }

  // Validate project access
  const projectContext = await getProjectContext(context.userId, projectId)
  if (!projectContext) {
    return { success: false, error: 'Project not found' }
  }

  if (!hasContextPermission(projectContext, 'canCreateProjects')) {
    return { success: false, error: 'Permission denied' }
  }

  // Validate locale
  const isValidLocale = store === 'appstore' ? isAppStoreLocale : isPlayStoreLocale
  if (!isValidLocale(locale)) {
    return { success: false, error: `Invalid locale for ${store}: ${locale}` }
  }

  // Store-specific field sets
  const IOS_FIELDS = ['title', 'subtitle', 'description', 'keywords', 'whatsNew', 'promotionalText', 'privacyUrl', 'marketingUrl', 'supportUrl'] as const
  const ANDROID_FIELDS = ['title', 'shortDescription', 'fullDescription'] as const
  const allowedFields = new Set<string>(store === 'playstore' ? ANDROID_FIELDS : IOS_FIELDS)

  // Map input fields to DB fields (title -> name), filtering by store
  const dbMetadata: Record<string, string | null> = {
    locale,
  }
  const updatedFields: string[] = []
  const ignoredFields: string[] = []

  // Map title to name (DB field naming)
  if (metadata.title !== undefined && allowedFields.has('title')) {
    dbMetadata.name = metadata.title
    updatedFields.push('name')
  }
  if (metadata.subtitle !== undefined) {
    if (allowedFields.has('subtitle')) {
      dbMetadata.subtitle = metadata.subtitle
      updatedFields.push('subtitle')
    } else {
      ignoredFields.push('subtitle')
    }
  }
  if (metadata.description !== undefined) {
    if (allowedFields.has('description')) {
      dbMetadata.description = metadata.description
      updatedFields.push('description')
    } else {
      ignoredFields.push('description')
    }
  }
  if (metadata.keywords !== undefined) {
    if (allowedFields.has('keywords')) {
      dbMetadata.keywords = metadata.keywords
      updatedFields.push('keywords')
    } else {
      ignoredFields.push('keywords')
    }
  }
  if (metadata.whatsNew !== undefined) {
    if (allowedFields.has('whatsNew')) {
      dbMetadata.whatsNew = metadata.whatsNew
      updatedFields.push('whatsNew')
    } else {
      ignoredFields.push('whatsNew')
    }
  }
  if (metadata.shortDescription !== undefined) {
    if (allowedFields.has('shortDescription')) {
      dbMetadata.shortDescription = metadata.shortDescription
      updatedFields.push('shortDescription')
    } else {
      ignoredFields.push('shortDescription')
    }
  }
  if (metadata.fullDescription !== undefined) {
    if (allowedFields.has('fullDescription')) {
      dbMetadata.fullDescription = metadata.fullDescription
      updatedFields.push('fullDescription')
    } else {
      ignoredFields.push('fullDescription')
    }
  }
  if (metadata.promotionalText !== undefined) {
    if (allowedFields.has('promotionalText')) {
      dbMetadata.promotionalText = metadata.promotionalText
      updatedFields.push('promotionalText')
    } else {
      ignoredFields.push('promotionalText')
    }
  }
  if (metadata.privacyUrl !== undefined) {
    if (allowedFields.has('privacyUrl')) {
      dbMetadata.privacyUrl = metadata.privacyUrl
      updatedFields.push('privacyUrl')
    } else {
      ignoredFields.push('privacyUrl')
    }
  }
  if (metadata.marketingUrl !== undefined) {
    if (allowedFields.has('marketingUrl')) {
      dbMetadata.marketingUrl = metadata.marketingUrl
      updatedFields.push('marketingUrl')
    } else {
      ignoredFields.push('marketingUrl')
    }
  }
  if (metadata.supportUrl !== undefined) {
    if (allowedFields.has('supportUrl')) {
      dbMetadata.supportUrl = metadata.supportUrl
      updatedFields.push('supportUrl')
    } else {
      ignoredFields.push('supportUrl')
    }
  }

  if (updatedFields.length === 0) {
    return { success: false, error: 'No metadata fields provided' }
  }

  // Get base path for this project
  const basePath = projectContext.type === 'organization' && projectContext.orgId
    ? adminDb
        .collection('organizations')
        .doc(projectContext.orgId)
        .collection('projects')
        .doc(projectId)
    : adminDb
        .collection('users')
        .doc(context.userId)
        .collection('projects')
        .doc(projectId)

  const metadataCollection = basePath.collection('metadata')
  const docRef = metadataCollection.doc(locale)
  const now = Timestamp.now()

  // Get existing metadata to merge with
  const existingDoc = await docRef.get()
  const existingData = existingDoc.exists ? existingDoc.data() : {}

  // Merge existing data with updates
  const mergedMetadata = {
    ...existingData,
    ...dbMetadata,
    sourceHash: generateHash(dbMetadata),
    lastModifiedAt: now,
    lastModifiedBy: context.userId,
  }

  // Save to metadata collection (same as UI save route)
  await docRef.set(mergedMetadata)

  // Update project sync status
  await basePath.update({
    syncStatus: 'local_changes',
    updatedAt: now,
  })

  return {
    success: true,
    fieldsUpdated: updatedFields,
    ...(ignoredFields.length > 0 && {
      fieldsIgnored: ignoredFields,
    }),
  }
}
