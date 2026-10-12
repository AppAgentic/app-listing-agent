import { adminDb } from '@/lib/firebase/admin'
import { Timestamp } from 'firebase-admin/firestore'
import type { Project, LocalizedMetadata, LinkConfiguration, SharedMetadataField, StoreType } from '@/lib/firebase/firestore'
import { mapLocale } from '@/lib/constants'

interface SyncResult {
  success: boolean
  synced: string[]
  skipped: string[]
  errors: string[]
}

/**
 * Cross-platform field mapping for metadata sync.
 * iOS field → Android field (and vice versa).
 * Fields not listed are copied as-is (same name on both platforms).
 */
const CROSS_PLATFORM_FIELD_MAP: Record<string, { ios: string; android: string }> = {
  description: { ios: 'description', android: 'fullDescription' },
}

/**
 * Map a metadata field name from one store type to another.
 * e.g., 'description' on iOS → 'fullDescription' on Android
 */
function mapFieldName(field: string, fromStore: StoreType, toStore: StoreType): string {
  if (fromStore === toStore) return field
  const mapping = CROSS_PLATFORM_FIELD_MAP[field]
  if (!mapping) return field // No cross-platform mapping, use as-is
  return fromStore === 'ios' ? mapping.android : mapping.ios
}

/**
 * Resolve locale pairs for cross-store sync.
 * Returns array of { sourceLocale, targetLocale, isNew } for locales that can be synced.
 * Handles locale mapping (e.g., iOS 'he' → Android 'iw-IL') and direct matches.
 * When createMissing is true, locales that don't exist on the target are still included
 * (marked as isNew) so the sync can create them.
 */
function resolveLocalePairs(
  sourceLocales: string[],
  targetLocales: string[],
  sourceStore: StoreType,
  targetStore: StoreType,
  filterLocales?: string[],
  createMissing: boolean = false
): Array<{ sourceLocale: string; targetLocale: string; isNew: boolean }> {
  const targetSet = new Set(targetLocales)
  const pairs: Array<{ sourceLocale: string; targetLocale: string; isNew: boolean }> = []

  const toProcess = filterLocales
    ? sourceLocales.filter(l => filterLocales.includes(l))
    : sourceLocales

  for (const sourceLocale of toProcess) {
    // Try direct match first
    if (targetSet.has(sourceLocale)) {
      pairs.push({ sourceLocale, targetLocale: sourceLocale, isNew: false })
      continue
    }

    // Try mapped locale for cross-store sync
    if (sourceStore !== targetStore) {
      const mapped = mapLocale(sourceLocale, sourceStore, targetStore)
      if (mapped !== sourceLocale && targetSet.has(mapped)) {
        // Mapped locale already exists on target
        pairs.push({ sourceLocale, targetLocale: mapped, isNew: false })
      } else if (createMissing && mapped) {
        // Locale doesn't exist on target yet — will be created
        pairs.push({ sourceLocale, targetLocale: mapped, isNew: true })
      }
    } else if (createMissing) {
      // Same store, locale just doesn't exist on target yet
      pairs.push({ sourceLocale, targetLocale: sourceLocale, isNew: true })
    }
  }

  return pairs
}

interface ProjectPaths {
  projectId: string
  basePath: FirebaseFirestore.CollectionReference
}

/**
 * Get the base path for a project
 */
export function getProjectBasePath(userId: string, orgId: string | null, projectId: string) {
  return orgId
    ? adminDb.collection('organizations').doc(orgId).collection('projects').doc(projectId)
    : adminDb.collection('users').doc(userId).collection('projects').doc(projectId)
}

/**
 * Sync metadata from source project to target project.
 * Handles cross-platform locale mapping (e.g., iOS 'he' → Android 'iw-IL')
 * and field name mapping (e.g., iOS 'description' → Android 'fullDescription').
 * Only syncs configured shared fields for locales that can be matched between projects.
 */
export async function syncMetadata(
  sourceProjectPath: FirebaseFirestore.DocumentReference,
  targetProjectPath: FirebaseFirestore.DocumentReference,
  linkConfig: LinkConfiguration,
  locales?: string[]
): Promise<SyncResult> {
  const result: SyncResult = {
    success: true,
    synced: [],
    skipped: [],
    errors: [],
  }

  if (!linkConfig.shareMetadata || linkConfig.sharedMetadataFields.length === 0) {
    result.skipped.push('Metadata sharing disabled')
    return result
  }

  try {
    // Get source and target project data
    const [sourceDoc, targetDoc] = await Promise.all([
      sourceProjectPath.get(),
      targetProjectPath.get(),
    ])

    if (!sourceDoc.exists || !targetDoc.exists) {
      result.success = false
      result.errors.push('Source or target project not found')
      return result
    }

    const sourceProject = sourceDoc.data() as Project
    const targetProject = targetDoc.data() as Project
    const isCrossStore = sourceProject.storeType !== targetProject.storeType

    // Resolve locale pairs with cross-platform mapping
    // createMissing: true — auto-create locales on target that don't exist yet
    const localePairs = resolveLocalePairs(
      sourceProject.enabledLocales || [],
      targetProject.enabledLocales || [],
      sourceProject.storeType,
      targetProject.storeType,
      locales,
      true // create missing locales on target
    )

    if (localePairs.length === 0) {
      result.skipped.push('No matching locales between projects (checked direct matches and locale mappings)')
      return result
    }

    const sourceMetadataCollection = sourceProjectPath.collection('metadata')
    const targetMetadataCollection = targetProjectPath.collection('metadata')

    // Track new locales to add to target's enabledLocales
    const newTargetLocales: string[] = []

    for (const { sourceLocale, targetLocale, isNew } of localePairs) {
      if (isNew) {
        newTargetLocales.push(targetLocale)
      }
      try {
        const sourceMetadataDoc = await sourceMetadataCollection.doc(sourceLocale).get()

        if (!sourceMetadataDoc.exists) {
          result.skipped.push(`${sourceLocale}: No source metadata`)
          continue
        }

        const sourceMetadata = sourceMetadataDoc.data() as LocalizedMetadata

        // Get existing target metadata for merge
        const targetMetadataDoc = await targetMetadataCollection.doc(targetLocale).get()
        const targetMetadata = targetMetadataDoc.exists
          ? targetMetadataDoc.data() as LocalizedMetadata
          : {} as Partial<LocalizedMetadata>

        // Build update with only shared fields, mapping field names cross-platform
        const update: Record<string, unknown> = {
          ...targetMetadata,
          locale: targetLocale,
          lastModifiedAt: Timestamp.now(),
          lastModifiedBy: 'sync',
        }

        const syncedFields: string[] = []

        for (const field of linkConfig.sharedMetadataFields) {
          const sourceValue = (sourceMetadata as unknown as Record<string, unknown>)[field]
          if (sourceValue === undefined) continue

          // Map the field name for the target platform
          const targetField = isCrossStore
            ? mapFieldName(field, sourceProject.storeType, targetProject.storeType)
            : field

          update[targetField] = sourceValue
          syncedFields.push(targetField !== field ? `${field}→${targetField}` : field)

          // When syncing 'description' to Android, also populate fullDescription
          // and vice versa, to keep both fields in sync
          if (isCrossStore && field === 'description' && targetProject.storeType === 'android') {
            update['fullDescription'] = sourceValue
            update['description'] = sourceValue // Keep description too for UI consistency
          } else if (isCrossStore && field === 'description' && targetProject.storeType === 'ios') {
            update['description'] = sourceValue
          }
        }

        await targetMetadataCollection.doc(targetLocale).set(update, { merge: true })
        const localeLabel = sourceLocale !== targetLocale
          ? `${sourceLocale}→${targetLocale}`
          : sourceLocale
        result.synced.push(`${localeLabel}: ${syncedFields.join(', ')}`)
      } catch (err) {
        result.errors.push(`${sourceLocale}: ${err instanceof Error ? err.message : 'Unknown error'}`)
      }
    }

    // Add new locales to target project's enabledLocales
    if (newTargetLocales.length > 0) {
      const existingLocales = targetProject.enabledLocales || []
      const updatedLocales = [...new Set([...existingLocales, ...newTargetLocales])]
      await targetProjectPath.update({ enabledLocales: updatedLocales })
    }

    // Update lastSyncedAt on both projects
    const now = Timestamp.now()
    await Promise.all([
      sourceProjectPath.update({ 'linkConfiguration.lastSyncedAt': now }),
      targetProjectPath.update({ 'linkConfiguration.lastSyncedAt': now }),
    ])

  } catch (err) {
    result.success = false
    result.errors.push(err instanceof Error ? err.message : 'Unknown error')
  }

  return result
}

/**
 * Handle auto-sync when metadata is saved
 * Called after a metadata save if the project has auto-sync enabled
 */
export async function handleAutoSync(
  projectPath: FirebaseFirestore.DocumentReference,
  changedLocale: string,
  changedFields: string[]
): Promise<SyncResult | null> {
  try {
    const projectDoc = await projectPath.get()
    if (!projectDoc.exists) return null

    const project = projectDoc.data() as Project

    // Check if project is linked with auto-sync enabled
    if (!project.linkedProjectId || !project.linkConfiguration) return null
    if (project.linkConfiguration.syncMode !== 'auto') return null
    if (!project.linkConfiguration.shareMetadata) return null

    // Check if any changed fields are in the shared fields list
    const sharedChangedFields = changedFields.filter(
      field => project.linkConfiguration!.sharedMetadataFields.includes(field as SharedMetadataField)
    )

    if (sharedChangedFields.length === 0) return null

    // Get linked project path (same user/org)
    const pathParts = projectPath.path.split('/')
    const isOrg = pathParts[0] === 'organizations'
    const ownerId = pathParts[1]

    const linkedProjectPath = isOrg
      ? adminDb.collection('organizations').doc(ownerId).collection('projects').doc(project.linkedProjectId)
      : adminDb.collection('users').doc(ownerId).collection('projects').doc(project.linkedProjectId)

    // Sync only the changed locale
    return await syncMetadata(
      projectPath,
      linkedProjectPath,
      project.linkConfiguration,
      [changedLocale]
    )
  } catch (err) {
    console.error('Auto-sync error:', err)
    return {
      success: false,
      synced: [],
      skipped: [],
      errors: [err instanceof Error ? err.message : 'Unknown error'],
    }
  }
}

/**
 * Full sync of all metadata from source to target
 */
export async function fullMetadataSync(
  sourceProjectPath: FirebaseFirestore.DocumentReference,
  targetProjectPath: FirebaseFirestore.DocumentReference,
  linkConfig: LinkConfiguration
): Promise<SyncResult> {
  return syncMetadata(sourceProjectPath, targetProjectPath, linkConfig)
}

/**
 * Get sync status between two linked projects
 */
export async function getSyncStatus(
  projectPath: FirebaseFirestore.DocumentReference
): Promise<{
  hasLink: boolean
  lastSyncedAt: Date | null
  syncMode: string | null
  localesDifference: string[]
}> {
  const projectDoc = await projectPath.get()
  if (!projectDoc.exists) {
    return {
      hasLink: false,
      lastSyncedAt: null,
      syncMode: null,
      localesDifference: [],
    }
  }

  const project = projectDoc.data() as Project

  if (!project.linkedProjectId || !project.linkConfiguration) {
    return {
      hasLink: false,
      lastSyncedAt: null,
      syncMode: null,
      localesDifference: [],
    }
  }

  // Get linked project to compare locales
  const pathParts = projectPath.path.split('/')
  const isOrg = pathParts[0] === 'organizations'
  const ownerId = pathParts[1]

  const linkedProjectPath = isOrg
    ? adminDb.collection('organizations').doc(ownerId).collection('projects').doc(project.linkedProjectId)
    : adminDb.collection('users').doc(ownerId).collection('projects').doc(project.linkedProjectId)

  const linkedProjectDoc = await linkedProjectPath.get()
  const linkedProject = linkedProjectDoc.exists ? linkedProjectDoc.data() as Project : null

  // Find locales that exist in one project but not the other
  const sourceLocales = new Set(project.enabledLocales || [])
  const targetLocales = new Set(linkedProject?.enabledLocales || [])
  const localesDifference = [
    ...[...sourceLocales].filter(l => !targetLocales.has(l)),
    ...[...targetLocales].filter(l => !sourceLocales.has(l)),
  ]

  return {
    hasLink: true,
    lastSyncedAt: project.linkConfiguration.lastSyncedAt?.toDate() || null,
    syncMode: project.linkConfiguration.syncMode,
    localesDifference,
  }
}
