import { uploadAppStore, UploadAppStoreResult } from './upload-appstore'
import { uploadPlayStore, UploadPlayStoreResult } from './upload-playstore'
import { AccountContext } from '@/lib/org/context'

export interface SyncStoresParams {
  projectId: string
  locales: string[]
  dryRun?: boolean
  appstoreTranslations?: Parameters<typeof uploadAppStore>[0]['translations']
  playstoreTranslations?: Parameters<typeof uploadPlayStore>[0]['translations']
}

export interface SyncStoresResult {
  success: boolean
  appstore: UploadAppStoreResult
  playstore: UploadPlayStoreResult
  stats: {
    total: number
    success: number
    failed: number
  }
}

export async function syncStores(
  params: SyncStoresParams,
  context: AccountContext
): Promise<SyncStoresResult> {
  const { projectId, locales, dryRun, appstoreTranslations, playstoreTranslations } = params

  // Run uploads in parallel
  const [appstoreResult, playstoreResult] = await Promise.all([
    uploadAppStore({ projectId, locales, dryRun, translations: appstoreTranslations }, context),
    uploadPlayStore({ projectId, locales, dryRun, translations: playstoreTranslations }, context)
  ])

  const appstoreSuccess = appstoreResult.stats?.success || 0
  const playstoreSuccess = playstoreResult.stats?.success || 0
  const appstoreFailed = appstoreResult.stats?.failed || 0
  const playstoreFailed = playstoreResult.stats?.failed || 0

  return {
    success: appstoreResult.success || playstoreResult.success,
    appstore: appstoreResult,
    playstore: playstoreResult,
    stats: {
      total: (appstoreResult.stats?.total || 0) + (playstoreResult.stats?.total || 0),
      success: appstoreSuccess + playstoreSuccess,
      failed: appstoreFailed + playstoreFailed
    }
  }
}
