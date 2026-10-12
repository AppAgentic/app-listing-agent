import { adminDb } from '@/lib/firebase/admin'
import { Timestamp } from 'firebase-admin/firestore'
import { uploadFromUrl } from '@/lib/services/r2'
import { getPlayStoreHelperForContext } from '@/app/api/playstore-iap/_helpers'
import { getProjectContext, type AccountContext } from '@/lib/org/context'
import { canMutateProject, PROJECT_MUTATION_FORBIDDEN } from '@/lib/org/project-authorization'
import type { Screenshot, ScreenshotSet, ScreenshotDisplayType } from '@/lib/firebase/firestore'

export interface PullPlayGraphicsParams {
  projectId: string
  displayTypes?: string[]
  locales?: string[]
}

// Map our display types to Google Play image types
const DISPLAY_TYPE_TO_IMAGE_TYPE: Record<string, string> = {
  'PLAY_PHONE': 'phoneScreenshots',
  'PLAY_TABLET': 'sevenInchScreenshots',
  'PLAY_FEATURE_GRAPHIC': 'featureGraphic',
}

/** Uses trusted server context; never synthesizes credentials or calls our HTTP route. */
export async function pullPlayStoreGraphics(params: PullPlayGraphicsParams, authContext: AccountContext) {
  const { projectId, displayTypes, locales } = params
  if (!projectId) return { success: false as const, error: 'projectId is required', status: 400 }
  const authorizedProject = await getProjectContext(authContext.userId, projectId)
  if (!authorizedProject) return { success: false as const, error: 'Project not found', status: 401 }
  if (!canMutateProject(authorizedProject)) return { success: false as const, error: PROJECT_MUTATION_FORBIDDEN, status: 403 }
  const result = await getPlayStoreHelperForContext(authContext, projectId)
  if ('error' in result) return { success: false as const, error: result.error, status: 401 }
  const { projectContext, basePath, helper } = result
  try {
    const now = Timestamp.now()
    const targetDisplayTypes = displayTypes || Object.keys(DISPLAY_TYPE_TO_IMAGE_TYPE)
    const batch = adminDb.batch()
    let totalPulled = 0
    const displayTypesPulled: string[] = []

    for (const dt of targetDisplayTypes) {
      const imageType = DISPLAY_TYPE_TO_IMAGE_TYPE[dt]
      if (!imageType) continue

      const pulledImages = await helper.pullImages({ imageType, locales })

      for (const { locale, imageUrls } of pulledImages) {
        const isFeatureGraphic = dt === 'PLAY_FEATURE_GRAPHIC'
        // Feature graphic: only 1 image; screenshots: up to 10
        const urls = isFeatureGraphic ? imageUrls.slice(0, 1) : imageUrls.slice(0, 10)

        const screenshots: Screenshot[] = []

        for (let i = 0; i < urls.length; i++) {
          const imageUrl = urls[i]
          // Upload to R2
          const uploaded = await uploadFromUrl({
            userId: projectContext.type === 'organization' ? undefined : authContext.userId,
            orgId: projectContext.orgId || undefined,
            projectId,
            category: 'raw' as const,
            filename: `pull-${dt}-${locale}-${i}-${Date.now()}.png`,
            sourceUrl: imageUrl,
          })

          screenshots.push({
            id: `${dt}-${locale}-${i}`,
            position: i,
            rawImageUrl: null,
            rawImageKey: null,
            marketingImageUrl: uploaded.url,
            marketingImageKey: uploaded.key,
            headline: '',
            generatedWith: null,
            styleSource: null,
            createdAt: now as any,
            updatedAt: now as any,
          })
        }

        if (screenshots.length > 0) {
          // Preserve the existing display-type document layout.
          const docId = `${dt}`
          const screenshotsCollection = basePath.collection('screenshots')
          const docRef = screenshotsCollection.doc(docId)

          const screenshotSet: ScreenshotSet = {
            id: docId,
            displayType: dt as ScreenshotDisplayType,
            locale,
            screenshots,
            styleConfig: null,
            syncStatus: 'synced',
            lastPulledAt: now,
            lastPushedAt: null,
            createdAt: now,
            updatedAt: now,
            createdBy: authContext.userId,
          } as ScreenshotSet

          batch.set(docRef, screenshotSet)
          totalPulled += screenshots.length

          if (!displayTypesPulled.includes(dt)) {
            displayTypesPulled.push(dt)
          }
        }
      }
    }

    if (totalPulled > 0) {
      batch.update(basePath, {
        screenshotSyncStatus: 'synced',
        updatedAt: now,
      })
      await batch.commit()
    }

    return {
      success: true as const,
      totalPulled,
      displayTypesPulled,
    }
  } catch (error) {
    return { success: false as const, error: error instanceof Error ? error.message : 'Failed to pull from Play Store', status: 500 }
  }
}
