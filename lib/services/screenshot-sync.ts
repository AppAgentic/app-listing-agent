/**
 * Screenshot & Icon Sync Service
 * Syncs screenshots and icons between linked iOS/Android projects
 * No file duplication — target project references the same R2 URLs
 */

import { adminDb } from '@/lib/firebase/admin'
import { Timestamp } from 'firebase-admin/firestore'
import type { Project, ScreenshotSet, ScreenshotDisplayType, LocalizedScreenshot, StoreType } from '@/lib/firebase/firestore'
import { IOS_TO_ANDROID_LOCALE_MAP, ANDROID_TO_IOS_LOCALE_MAP, mapLocale } from '@/lib/constants'

interface SyncResult {
  success: boolean
  synced: string[]
  skipped: string[]
  errors: string[]
}

// Map iOS display types to Android display types
const IOS_TO_ANDROID_DISPLAY_TYPE: Partial<Record<ScreenshotDisplayType, ScreenshotDisplayType>> = {
  'APP_IPHONE_69': 'PLAY_PHONE',
  'APP_IPHONE_65': 'PLAY_PHONE',
  'APP_IPHONE_63': 'PLAY_PHONE',
  'APP_IPHONE_61': 'PLAY_PHONE',
  'APP_IPHONE_55': 'PLAY_PHONE',
  'APP_IPAD_PRO_13': 'PLAY_TABLET',
  'APP_IPAD_PRO_129': 'PLAY_TABLET',
  'APP_IPAD_PRO_11': 'PLAY_TABLET',
}

// Map Android display types to iOS display types (use highest-priority iOS type)
const ANDROID_TO_IOS_DISPLAY_TYPE: Partial<Record<ScreenshotDisplayType, ScreenshotDisplayType>> = {
  'PLAY_PHONE': 'APP_IPHONE_69',
  'PLAY_TABLET': 'APP_IPAD_PRO_13',
}

/**
 * Map a display type from one store to another
 * When syncing iOS → Android, multiple iPhone sizes map to PLAY_PHONE.
 * We only sync the highest-priority one (6.9") to avoid duplicates.
 */
function mapDisplayType(
  displayType: ScreenshotDisplayType,
  fromStore: StoreType,
  toStore: StoreType
): ScreenshotDisplayType | null {
  if (fromStore === toStore) return displayType

  if (fromStore === 'ios') {
    return IOS_TO_ANDROID_DISPLAY_TYPE[displayType] ?? null
  }
  return ANDROID_TO_IOS_DISPLAY_TYPE[displayType] ?? null
}

// Which iOS phone types to sync (only the highest priority to avoid duplicates on PLAY_PHONE)
const IOS_PHONE_PRIORITY: ScreenshotDisplayType[] = [
  'APP_IPHONE_69', 'APP_IPHONE_65', 'APP_IPHONE_63', 'APP_IPHONE_61', 'APP_IPHONE_55',
]
const IOS_TABLET_PRIORITY: ScreenshotDisplayType[] = [
  'APP_IPAD_PRO_13', 'APP_IPAD_PRO_129', 'APP_IPAD_PRO_11',
]

/**
 * Sync screenshots from source project to target project
 * References the same R2 URLs — no file duplication
 */
export async function syncScreenshots(
  sourcePath: FirebaseFirestore.DocumentReference,
  targetPath: FirebaseFirestore.DocumentReference,
  sourceProject: Project,
  targetProject: Project
): Promise<SyncResult> {
  const result: SyncResult = {
    success: true,
    synced: [],
    skipped: [],
    errors: [],
  }

  try {
    // Get all source screenshot sets
    const sourceScreenshotsSnap = await sourcePath.collection('screenshots').get()

    if (sourceScreenshotsSnap.empty) {
      result.skipped.push('No screenshots in source project')
      return result
    }

    const sourceScreenshotSets = new Map<string, ScreenshotSet>()
    for (const doc of sourceScreenshotsSnap.docs) {
      sourceScreenshotSets.set(doc.id, doc.data() as ScreenshotSet)
    }

    // Determine which display types to sync
    // When iOS → Android, pick the best phone type and best tablet type
    const isCrossStore = sourceProject.storeType !== targetProject.storeType
    let displayTypesToSync: ScreenshotDisplayType[]

    if (isCrossStore && sourceProject.storeType === 'ios') {
      // Pick highest-priority iPhone type that exists
      const bestPhone = IOS_PHONE_PRIORITY.find(dt => sourceScreenshotSets.has(dt))
      const bestTablet = IOS_TABLET_PRIORITY.find(dt => sourceScreenshotSets.has(dt))
      displayTypesToSync = [bestPhone, bestTablet].filter((dt): dt is ScreenshotDisplayType => !!dt)
    } else {
      displayTypesToSync = [...sourceScreenshotSets.keys()] as ScreenshotDisplayType[]
    }

    if (displayTypesToSync.length === 0) {
      result.skipped.push('No matching display types to sync')
      return result
    }

    // Build locale mapping
    const fromStore = sourceProject.storeType
    const toStore = targetProject.storeType
    const targetLocalesSet = new Set(targetProject.enabledLocales || [])

    // Delete existing target screenshots (clean slate)
    const existingTargetScreenshots = await targetPath.collection('screenshots').get()
    const existingTargetLocalized = await targetPath.collection('localizedScreenshots').get()

    const deleteBatch = adminDb.batch()
    for (const doc of existingTargetScreenshots.docs) {
      deleteBatch.delete(doc.ref)
    }
    for (const doc of existingTargetLocalized.docs) {
      deleteBatch.delete(doc.ref)
    }
    if (!existingTargetScreenshots.empty || !existingTargetLocalized.empty) {
      await deleteBatch.commit()
    }

    // Sync each display type
    for (const sourceDisplayType of displayTypesToSync) {
      const screenshotSet = sourceScreenshotSets.get(sourceDisplayType)
      if (!screenshotSet) continue

      const targetDisplayType = isCrossStore
        ? mapDisplayType(sourceDisplayType, fromStore, toStore)
        : sourceDisplayType

      if (!targetDisplayType) {
        result.skipped.push(`${sourceDisplayType}: No matching target display type`)
        continue
      }

      try {
        // Create target screenshot set referencing the same R2 URLs
        const targetSet: Record<string, unknown> = {
          id: targetDisplayType,
          displayType: targetDisplayType,
          locale: isCrossStore
            ? mapLocale(screenshotSet.locale, fromStore, toStore)
            : screenshotSet.locale,
          screenshots: screenshotSet.screenshots.map(s => ({
            ...s,
            // Keep all image URLs/keys as-is — no file duplication
          })),
          styleConfig: screenshotSet.styleConfig,
          syncStatus: 'local_changes',
          lastPulledAt: null,
          lastPushedAt: null,
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now(),
          createdBy: 'sync',
        }

        await targetPath.collection('screenshots').doc(targetDisplayType).set(targetSet)
        result.synced.push(`${sourceDisplayType} → ${targetDisplayType} (${screenshotSet.screenshots.length} screenshots)`)
      } catch (err) {
        result.errors.push(`${sourceDisplayType}: ${err instanceof Error ? err.message : 'Unknown error'}`)
      }
    }

    // Sync localized screenshots
    const sourceLocalizedSnap = await sourcePath.collection('localizedScreenshots').get()

    if (!sourceLocalizedSnap.empty) {
      // Process in batches of 500 (Firestore batch limit)
      const localizedDocs = sourceLocalizedSnap.docs
      for (let i = 0; i < localizedDocs.length; i += 450) {
        const batchDocs = localizedDocs.slice(i, i + 450)
        const writeBatch = adminDb.batch()
        let batchCount = 0

        for (const doc of batchDocs) {
          const localized = doc.data() as LocalizedScreenshot
          const sourceDocDisplayType = localized.displayType as ScreenshotDisplayType | undefined

          // Map locale (e.g., iOS 'he' → Android 'iw-IL', or same locale if no mapping needed)
          const targetLocale = isCrossStore
            ? mapLocale(localized.locale, fromStore, toStore)
            : localized.locale

          // Map display type
          let targetDocDisplayType = sourceDocDisplayType
          if (isCrossStore && sourceDocDisplayType) {
            const mapped = mapDisplayType(sourceDocDisplayType, fromStore, toStore)
            if (!mapped) continue
            targetDocDisplayType = mapped
          }

          // Build new doc ID with remapped locale and display type
          const newDocId = targetDocDisplayType
            ? `${targetDocDisplayType}_${localized.screenshotId}_${targetLocale}`
            : `${localized.screenshotId}_${targetLocale}`

          const targetLocData: Record<string, unknown> = {
            locale: targetLocale,
            screenshotId: localized.screenshotId,
            displayType: targetDocDisplayType || localized.displayType,
            // Reference same R2 URLs — no file duplication
            marketingImageUrl: localized.marketingImageUrl,
            marketingImageKey: localized.marketingImageKey,
            headline: localized.headline,
            sourceHash: localized.sourceHash,
            lastModifiedAt: Timestamp.now(),
            lastModifiedBy: 'sync',
          }

          writeBatch.set(
            targetPath.collection('localizedScreenshots').doc(newDocId),
            targetLocData
          )
          batchCount++
        }

        if (batchCount > 0) {
          await writeBatch.commit()
          result.synced.push(`Synced ${batchCount} localized screenshots (batch ${Math.floor(i / 450) + 1})`)
        }
      }
    }

    // Update lastSyncedAt on both projects
    const now = Timestamp.now()
    await Promise.all([
      sourcePath.update({ 'linkConfiguration.lastSyncedAt': now }),
      targetPath.update({ 'linkConfiguration.lastSyncedAt': now }),
    ])

  } catch (err) {
    result.success = false
    result.errors.push(err instanceof Error ? err.message : 'Unknown error')
  }

  return result
}

/**
 * Sync icon from source project to target project
 * References the same R2 URL — no file duplication
 */
export async function syncIcon(
  sourcePath: FirebaseFirestore.DocumentReference,
  targetPath: FirebaseFirestore.DocumentReference,
  sourceProject: Project,
  targetProject: Project
): Promise<SyncResult> {
  const result: SyncResult = {
    success: true,
    synced: [],
    skipped: [],
    errors: [],
  }

  try {
    // Get the latest icon from source project
    const sourceIconsSnap = await sourcePath.collection('icons')
      .orderBy('createdAt', 'desc')
      .limit(1)
      .get()

    if (sourceIconsSnap.empty) {
      result.skipped.push('No icons in source project')
      return result
    }

    const sourceIcon = sourceIconsSnap.docs[0].data()
    const sourceIconId = sourceIconsSnap.docs[0].id

    // Write to target project's icons collection referencing the same R2 URLs
    const targetIconData: Record<string, unknown> = {
      id: `synced_${sourceIconId}`,
      style: sourceIcon.style || null,
      prompt: sourceIcon.prompt || null,
      // Reference same R2 URLs — no file duplication
      originalUrl: sourceIcon.originalUrl,
      ios: sourceIcon.ios,
      android: sourceIcon.android,
      createdAt: Timestamp.now(),
      createdBy: 'sync',
    }

    await targetPath.collection('icons').doc(`synced_${sourceIconId}`).set(targetIconData)
    result.synced.push(`Icon synced (${sourceIconId})`)

    // Update lastSyncedAt
    const now = Timestamp.now()
    await Promise.all([
      sourcePath.update({ 'linkConfiguration.lastSyncedAt': now }),
      targetPath.update({ 'linkConfiguration.lastSyncedAt': now }),
    ])

  } catch (err) {
    result.success = false
    result.errors.push(err instanceof Error ? err.message : 'Unknown error')
  }

  return result
}
