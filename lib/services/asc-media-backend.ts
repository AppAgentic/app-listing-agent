// Per-project App Store media backend switch (`ascMediaBackend` on the project
// doc: 'library' or absent/'legacy'). Same switch and asset index the push
// worker uses (functions/src/pushWorker.ts), so a file uploaded by either
// path is reused by the other.
// Plan: docs/plans/screenshots/asset-library-migration.md

import { adminDb } from '@/lib/firebase/admin'
import { firestoreAssetIndex, type AssetIndexCollection } from './asc-asset-library'
import type { AppStoreHelper, AscMediaBackend } from './appstore'

export function resolveAscMediaBackend(projectData: { ascMediaBackend?: unknown } | undefined | null): AscMediaBackend {
  return projectData?.ascMediaBackend === 'library' ? 'library' : 'legacy'
}

/** Server-only index of uploaded files: ascAssetLibraryIndex/{ascAppId}/images/{md5}. */
export function libraryAssetIndexCollection(ascAppId: string): AssetIndexCollection {
  return adminDb.collection('ascAssetLibraryIndex').doc(ascAppId).collection('images') as unknown as AssetIndexCollection
}

/** Points the helper at the project's media backend. Returns the backend chosen. */
export function configureAscMediaBackend(
  helper: Pick<AppStoreHelper, 'setMediaBackend'>,
  projectData: { ascMediaBackend?: unknown } | undefined | null,
  ascAppId: string
): AscMediaBackend {
  const backend = resolveAscMediaBackend(projectData)
  if (backend === 'library') {
    helper.setMediaBackend('library', firestoreAssetIndex(libraryAssetIndexCollection(ascAppId)))
  }
  return backend
}
