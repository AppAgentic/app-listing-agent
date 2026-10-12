import { readFileSync } from 'fs'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppStoreHelper } from '@/lib/services/appstore'
import { buildCatalog, clearRefDataCache, legacyDisplayTypeForGroup } from '@/lib/services/asc-asset-library'

vi.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: () => ({ doc: () => ({ collection: () => ({ doc: () => ({ get: async () => ({ exists: false, data: () => undefined }), set: async () => {} }) }) }) }) },
}))

const { configureAscMediaBackend, resolveAscMediaBackend } = await import('@/lib/services/asc-media-backend')

const ASC = 'https://api.appstoreconnect.apple.com'
const refData = JSON.parse(readFileSync(path.join(__dirname, 'fixtures/asc-asset-library-refdata.json'), 'utf8'))
const json = (body: unknown, status = 200) => new Response(body === undefined ? null : JSON.stringify(body), { status })

// Minimal PNG header: enough for size checks; the fake ASC "processes" it.
function png(width: number, height: number, seed: number): Buffer {
  const buf = Buffer.alloc(40)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0)
  buf.writeUInt32BE(13, 8)
  buf.write('IHDR', 12, 'ascii')
  buf.writeUInt32BE(width, 16)
  buf.writeUInt32BE(height, 20)
  buf[24] = 8
  buf[25] = 2
  buf.writeUInt32BE(seed, 36)
  return buf
}

const SPEC_1320 = 'bd402f1a-26ee-5b83-9dd7-972c60c43d47' // i1320x2868a0, IPHONE_DYNAMIC_ISLAND_LARGE_PROFILE

interface Placement { id: string; group: string; assetId: string; target: string }

function fakeAsc(options: { refDataStatus?: number } = {}) {
  const calls: string[] = []
  const images = new Map<string, { state: string; fileName: string; polls: number }>()
  let placements: Placement[] = []
  let seq = 0

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handler = async (method: string, url: string, body?: any): Promise<Response> => {
    const u = new URL(url)
    const p = u.pathname
    calls.push(`${method} ${p}`)
    if (p === '/v1/apps/123/appStoreVersions') return json({ data: [{ id: 'ver1', attributes: { createdDate: '2026-10-01T00:00:00Z' } }] })
    if (p === '/v1/appStoreVersions/ver1/appStoreVersionLocalizations') return json({ data: [{ id: 'loc-en', attributes: { locale: 'en-US' } }] })
    if (p === '/v1/apps/123/assetLibrary') return json({ data: { id: '123' } })
    if (p === '/v1/appAssetLibraryRefData') return options.refDataStatus ? json({ errors: [{ detail: 'down' }] }, options.refDataStatus) : json(refData)
    if (method === 'POST' && p === '/v1/appAssetLibraryImages') {
      const id = `img${++seq}`
      images.set(id, { state: 'AWAITING_UPLOAD', fileName: body.data.attributes.fileName, polls: 0 })
      return json({ data: { id, attributes: { uploadOperations: [{ method: 'PUT', url: `https://upload.example/${id}`, offset: 0, length: body.data.attributes.fileSize, requestHeaders: [] }] } } }, 201)
    }
    const img = p.match(/^\/v1\/appAssetLibraryImages\/([^/]+)$/)
    if (img) {
      const image = images.get(img[1])
      if (!image) return json(undefined, 404)
      if (method === 'PATCH') { image.state = 'UPLOAD_COMPLETE'; return json({ data: { id: img[1] } }) }
      if (image.state === 'UPLOAD_COMPLETE' && ++image.polls >= 1) image.state = 'PREPARE_FOR_SUBMISSION'
      return json({ data: { id: img[1], attributes: { state: image.state, specId: image.state === 'PREPARE_FOR_SUBMISSION' ? SPEC_1320 : undefined, fileName: image.fileName } } })
    }
    const list = p.match(/^\/v1\/(appStoreVersionLocalizations|appCustomProductPageLocalizations)\/([^/]+)\/placements$/)
    if (list && method === 'GET') {
      const group = u.searchParams.get('filter[placementGroup]')
      const rows = placements.filter(pl => pl.target === list[2] && (!group || pl.group === group))
      return json({
        data: rows.map(pl => ({ id: pl.id, attributes: { placementGroup: pl.group, placementType: 'APP_SCREENSHOT', state: 'ACTIVE' }, relationships: { image: { data: { type: 'appAssetLibraryImages', id: pl.assetId } } } })),
        included: rows.map(pl => ({ type: 'appAssetLibraryImages', id: pl.assetId, attributes: { state: 'APPROVED', fileName: `${pl.assetId}.png`, imageAsset: { templateUrl: `https://cdn.example/${pl.assetId}/{w}x{h}bb.{f}`, width: 1320, height: 2868 } } })),
        links: {},
      })
    }
    if (method === 'POST' && p === '/v1/appAssetLibraryPlacements') {
      const rel = body.data.relationships
      const target = (rel.appStoreVersionLocalization ?? rel.appCustomProductPageLocalization).data.id
      const id = `pl${++seq}`
      placements.push({ id, group: body.data.attributes.placementGroup, assetId: rel.image.data.id, target })
      return json({ data: { id } }, 201)
    }
    const del = p.match(/^\/v1\/appAssetLibraryPlacements\/([^/]+)$/)
    if (del && method === 'DELETE') { placements = placements.filter(pl => pl.id !== del[1]); return json(undefined, 204) }
    if (method === 'POST' && p === '/v1/appAssetLibraryPlacementOrderingRequests') {
      const order: string[] = body.data.relationships.orderedPlacements.data.map((d: { id: string }) => d.id)
      const moved = order.map(id => placements.find(pl => pl.id === id)!)
      placements = [...placements.filter(pl => !order.includes(pl.id)), ...moved]
      return json({ data: { id: 'ord' } }, 201)
    }
    // Legacy screenshot sets: enough to prove the fallback ran
    if (p === '/v1/appStoreVersionLocalizations/loc-en/appScreenshotSets') return json({ data: [] })
    if (method === 'POST' && p === '/v1/appScreenshotSets') return json({ data: { id: 'set1' } }, 201)
    if (method === 'POST' && p === '/v1/appScreenshots') return json({ data: { id: `shot${++seq}`, attributes: { uploadOperations: [{ method: 'PUT', url: 'https://upload.example/legacy', requestHeaders: [] }] } } }, 201)
    if (method === 'PATCH' && p.startsWith('/v1/appScreenshots/')) return json({ data: {} })
    return json({ errors: [{ detail: `unhandled ${method} ${p}` }] }, 500)
  }

  const seed = (target: string, group: string, assetIds: string[]) => {
    for (const assetId of assetIds) placements.push({ id: `seed-${assetId}-${group}`, group, assetId, target })
  }

  return { handler, calls, seed, placements: () => placements }
}

function libraryHelper(asc: ReturnType<typeof fakeAsc>) {
  const helper = new AppStoreHelper({ appId: '123', issuerId: 'i', keyId: 'k', privateKey: 'p' })
  ;(helper as unknown as { makeApiRequest: typeof asc.handler }).makeApiRequest = vi.fn(asc.handler)
  helper.setMediaBackend('library')
  return helper
}

const writes = (calls: string[]) => calls.filter(c => !c.startsWith('GET'))

describe('AppStoreHelper Asset Library backend', () => {
  beforeEach(() => {
    clearRefDataCache()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 200 })))
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('direct push places screenshots in order through the library, without screenshot sets', async () => {
    const asc = fakeAsc()
    const helper = libraryHelper(asc)
    const result = await helper.uploadScreenshots('en-US', [
      { fileName: '1.png', data: png(1320, 2868, 1) },
      { fileName: '2.png', data: png(1320, 2868, 2) },
    ], 'APP_IPHONE_67')
    expect(result).toEqual({ success: true, locale: 'en-US' })
    expect(asc.placements().map(pl => [pl.target, pl.group, pl.assetId])).toEqual([
      ['loc-en', 'IPHONE_DYNAMIC_ISLAND_LARGE_PROFILE', 'img1'],
      ['loc-en', 'IPHONE_DYNAMIC_ISLAND_LARGE_PROFILE', 'img2'],
    ])
    expect(asc.calls.some(c => c.includes('appScreenshotSets'))).toBe(false)
    expect(helper.mediaReport()).toEqual({ mediaBackend: 'library', libraryFallbacks: [] })
  })

  it('falls back to screenshot sets when the library fails, and reports it', async () => {
    const asc = fakeAsc({ refDataStatus: 503 })
    const helper = libraryHelper(asc)
    const result = await helper.uploadScreenshots('en-US', [{ fileName: '1.png', data: png(1320, 2868, 1) }], 'APP_IPHONE_67')
    expect(result.success).toBe(true)
    expect(asc.calls).toContain('POST /v1/appScreenshotSets')
    const report = helper.mediaReport()
    expect(report.libraryFallbacks).toHaveLength(1)
    expect(report.libraryFallbacks[0]).toMatchObject({ locale: 'en-US', displayType: 'APP_IPHONE_67' })
  })

  it('CPP push uploads once, skips an unchanged re-push and reorders without re-uploading', async () => {
    const asc = fakeAsc()
    const helper = libraryHelper(asc)
    const a = png(1320, 2868, 1)
    const b = png(1320, 2868, 2)

    const first = await helper.uploadCPPScreenshotSet('cpp-loc', 'APP_IPHONE_67', [{ fileName: 'a.png', data: a }, { fileName: 'b.png', data: b }])
    expect(first).toMatchObject({ success: true, screenshotIds: ['img1', 'img2'], screenshotsUploaded: 2 })

    asc.calls.length = 0
    await helper.uploadCPPScreenshotSet('cpp-loc', 'APP_IPHONE_67', [{ fileName: 'a.png', data: a }, { fileName: 'b.png', data: b }])
    expect(writes(asc.calls)).toEqual([])

    asc.calls.length = 0
    await helper.uploadCPPScreenshotSet('cpp-loc', 'APP_IPHONE_67', [{ fileName: 'b.png', data: b }, { fileName: 'a.png', data: a }])
    expect(writes(asc.calls)).toEqual(['POST /v1/appAssetLibraryPlacementOrderingRequests'])
    expect(asc.placements().map(pl => pl.assetId)).toEqual(['img2', 'img1'])
  })

  it('CPP prune removes placements of display types no longer used, keeps the rest', async () => {
    const asc = fakeAsc()
    asc.seed('cpp-loc', 'IPHONE_DYNAMIC_ISLAND_LARGE_PROFILE', ['x1'])
    asc.seed('cpp-loc', 'IPAD_13_PROFILE', ['y1', 'y2'])
    const helper = libraryHelper(asc)
    const result = await helper.pruneCPPScreenshotSets('cpp-loc', ['APP_IPHONE_67'])
    expect(result).toEqual({ success: true, deletedSetIds: ['IPAD_13_PROFILE'], preservedSetIds: ['IPHONE_DYNAMIC_ISLAND_LARGE_PROFILE'] })
    expect(asc.placements().map(pl => pl.assetId)).toEqual(['x1'])
  })

  it('pull reads placements as legacy display types, in order, skipping Duo', async () => {
    const asc = fakeAsc()
    asc.seed('loc-en', 'IPHONE_DYNAMIC_ISLAND_LARGE_PROFILE', ['b', 'a'])
    asc.seed('loc-en', 'IPHONE_DUO_PROFILE', ['duo'])
    const helper = libraryHelper(asc)
    const sets = await helper.pullScreenshots('ver1')
    expect(sets).toEqual([{
      displayType: 'APP_IPHONE_67',
      locale: 'en-US',
      screenshots: [
        { url: 'https://cdn.example/b/1320x2868bb.png', fileName: 'b.png', width: 1320, height: 2868, checksum: null },
        { url: 'https://cdn.example/a/1320x2868bb.png', fileName: 'a.png', width: 1320, height: 2868, checksum: null },
      ],
    }])
    expect(asc.calls.some(c => c.includes('appScreenshotSets'))).toBe(false)
  })

  it('stays on screenshot sets unless the project opts in', () => {
    expect(resolveAscMediaBackend(undefined)).toBe('legacy')
    expect(resolveAscMediaBackend({ ascMediaBackend: 'legacy' })).toBe('legacy')
    expect(resolveAscMediaBackend({ ascMediaBackend: 'library' })).toBe('library')
    const setMediaBackend = vi.fn()
    expect(configureAscMediaBackend({ setMediaBackend }, {}, '123')).toBe('legacy')
    expect(setMediaBackend).not.toHaveBeenCalled()
    expect(configureAscMediaBackend({ setMediaBackend }, { ascMediaBackend: 'library' }, '123')).toBe('library')
    expect(setMediaBackend).toHaveBeenCalledWith('library', expect.objectContaining({ get: expect.any(Function), set: expect.any(Function) }))
  })
})

describe('legacyDisplayTypeForGroup', () => {
  const catalog = buildCatalog(refData.data[0].attributes)
  it('maps library groups back to the display types our model uses', () => {
    expect(legacyDisplayTypeForGroup(catalog, 'IPHONE_DYNAMIC_ISLAND_LARGE_PROFILE')).toBe('APP_IPHONE_67')
    expect(legacyDisplayTypeForGroup(catalog, 'IPAD_13_PROFILE')).toBe('APP_IPAD_PRO_3GEN_129')
    expect(legacyDisplayTypeForGroup(catalog, 'IPAD_129_PROFILE')).toBe('APP_IPAD_PRO_129')
    expect(legacyDisplayTypeForGroup(catalog, 'WATCH_ULTRA_PROFILE')).toBe('APP_WATCH_ULTRA')
    expect(legacyDisplayTypeForGroup(catalog, 'MAC_PROFILE')).toBe('APP_DESKTOP')
    expect(legacyDisplayTypeForGroup(catalog, 'IPHONE_DUO_PROFILE')).toBeNull()
  })
})
