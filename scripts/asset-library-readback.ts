/**
 * Read-only check of the Asset Library client against a live app: reads the
 * library id, reference data and every APP_SCREENSHOT placement on one version
 * localization, and resolves each placed image back to its group. Makes GET
 * requests only.
 *
 * Run: ASC_TOKEN=$(asc auth token --confirm | tail -1) \
 *   npx tsx scripts/asset-library-readback.ts <ascAppId> [locale=en-US]
 */
import { AscAssetLibraryClient, groupsForDimensions } from '../lib/services/asc-asset-library'

async function main() {
  const [appId, locale = 'en-US'] = process.argv.slice(2)
  const token = process.env.ASC_TOKEN
  if (!appId || !token) throw new Error('Usage: ASC_TOKEN=... npx tsx scripts/asset-library-readback.ts <ascAppId> [locale]')

  const request = async (method: string, url: string) => {
    if (method !== 'GET') throw new Error(`Read-only script refused ${method} ${url}`)
    return fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  }
  const client = new AscAssetLibraryClient({ request, appId })

  const libraryId = await client.getLibraryId()
  const catalog = await client.getCatalog('APP_SCREENSHOT')
  console.log(`library ${libraryId}; ${catalog.groups.size} placement groups, ${catalog.imageSpecs.size} image specs`)

  const versions = await (await request('GET', `https://api.appstoreconnect.apple.com/v1/apps/${appId}/appStoreVersions?limit=1&fields%5BappStoreVersions%5D=versionString,appStoreState`)).json()
  const version = versions.data[0]
  const locs = await (await request('GET', `https://api.appstoreconnect.apple.com/v1/appStoreVersions/${version.id}/appStoreVersionLocalizations?filter%5Blocale%5D=${locale}`)).json()
  const localization = locs.data[0] ?? (await (await request('GET', `https://api.appstoreconnect.apple.com/v1/appStoreVersions/${version.id}/appStoreVersionLocalizations?limit=1`)).json()).data[0]
  if (!localization) throw new Error(`Version ${version.id} has no localizations`)
  console.log(`version ${version.attributes.versionString} (${version.attributes.appStoreState}), ${localization.attributes?.locale ?? locale} localization ${localization.id}`)

  const placements = await client.listPlacements({ kind: 'appStoreVersionLocalization', id: localization.id }, 'APP_SCREENSHOT')
  let mismatches = 0
  for (const p of placements) {
    const w = p.image?.width
    const h = p.image?.height
    const fits = w && h ? groupsForDimensions(catalog, 'APP_SCREENSHOT', w, h) : []
    const ok = fits.includes(p.placementGroup)
    if (!ok) mismatches++
    console.log(`${ok ? 'ok ' : 'MISMATCH'} ${p.placementGroup} ${p.state} ${p.image?.fileName ?? p.assetId} ${w}x${h} → fits ${fits.join('|') || 'nothing'}`)
  }
  console.log(`${placements.length} placements, ${mismatches} group mismatches`)
  if (mismatches > 0) process.exitCode = 1
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
