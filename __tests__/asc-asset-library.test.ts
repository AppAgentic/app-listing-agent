import { readFileSync } from 'fs'
import path from 'path'
import zlib from 'zlib'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  AscAssetLibraryClient,
  AscLibraryError,
  buildCatalog,
  clearRefDataCache,
  groupForLegacyDisplayType,
  groupsForDimensions,
  memoryAssetIndex,
  planPlacements,
  preflightImage,
  readImageInfo,
  resolvePlacementGroup,
} from '../lib/services/asc-asset-library'

// Reference data captured from the live API (GET /v1/appAssetLibraryRefData, 6 Oct 2026)
const refData = JSON.parse(readFileSync(path.join(__dirname, 'fixtures/asc-asset-library-refdata.json'), 'utf8'))
const catalog = buildCatalog(refData.data[0].attributes)

function png(width: number, height: number, colorType = 2): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4)
    length.writeUInt32BE(data.length)
    return Buffer.concat([length, Buffer.from(type, 'ascii'), data, Buffer.alloc(4)])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = colorType
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(Buffer.from([0]))),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

function jpeg(width: number, height: number): Buffer {
  const sof = Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, 0, 0, 0, 0, 0x03])
  sof.writeUInt16BE(height, 5)
  sof.writeUInt16BE(width, 7)
  return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00]), sof])
}

describe('reference data catalog', () => {
  it('maps image sizes to placement groups from the live catalog', () => {
    expect(groupsForDimensions(catalog, 'APP_SCREENSHOT', 1320, 2868)).toEqual(['IPHONE_DYNAMIC_ISLAND_LARGE_PROFILE'])
    expect(groupsForDimensions(catalog, 'APP_SCREENSHOT', 1242, 2688)).toEqual(['IPHONE_FACE_ID_LARGE_PROFILE'])
    expect(groupsForDimensions(catalog, 'APP_SCREENSHOT', 1398, 2034)).toEqual(['IPHONE_DUO_PROFILE'])
    expect(groupsForDimensions(catalog, 'APP_SCREENSHOT', 2007, 2853)).toEqual(['IPHONE_DUO_PROFILE'])
    expect(groupsForDimensions(catalog, 'APP_SCREENSHOT', 1000, 1000)).toEqual([])
  })

  it('uses the legacy display type to break ties between groups', () => {
    expect(groupsForDimensions(catalog, 'APP_SCREENSHOT', 2048, 2732).sort()).toEqual(['IPAD_129_PROFILE', 'IPAD_13_PROFILE'])
    expect(resolvePlacementGroup(catalog, 'APP_SCREENSHOT', { width: 2048, height: 2732, legacyDisplayType: 'APP_IPAD_PRO_3GEN_129' })).toBe('IPAD_13_PROFILE')
    expect(resolvePlacementGroup(catalog, 'APP_SCREENSHOT', { width: 2048, height: 2732, legacyDisplayType: 'APP_IPAD_PRO_129' })).toBe('IPAD_129_PROFILE')
    expect(() => resolvePlacementGroup(catalog, 'APP_SCREENSHOT', { width: 2048, height: 2732 })).toThrow(/several groups/)
  })

  it('falls back to the size when the legacy display type does not fit', () => {
    expect(resolvePlacementGroup(catalog, 'APP_SCREENSHOT', { width: 1179, height: 2556, legacyDisplayType: 'APP_IPHONE_67' }))
      .toBe('IPHONE_DYNAMIC_ISLAND_MEDIUM_PROFILE')
    expect(() => resolvePlacementGroup(catalog, 'APP_SCREENSHOT', { width: 10, height: 10 })).toThrow(AscLibraryError)
  })

  it('maps every legacy display type the worker uses', () => {
    for (const [legacy, group] of [
      ['APP_IPHONE_67', 'IPHONE_DYNAMIC_ISLAND_LARGE_PROFILE'],
      ['APP_IPHONE_65', 'IPHONE_FACE_ID_LARGE_PROFILE'],
      ['APP_IPHONE_61', 'IPHONE_DYNAMIC_ISLAND_MEDIUM_PROFILE'],
      ['APP_IPHONE_58', 'IPHONE_FACE_ID_MEDIUM_PROFILE'],
      ['APP_IPHONE_55', 'IPHONE_HOME_BUTTON_LARGE_PROFILE'],
      ['APP_IPAD_PRO_3GEN_11', 'IPAD_11_PROFILE'],
      ['APP_WATCH_ULTRA_3', 'WATCH_ULTRA_PROFILE'],
      ['APP_WATCH_SERIES_10', 'WATCH_SERIES_10_PROFILE'],
      ['APP_DESKTOP', 'MAC_PROFILE'],
    ]) {
      expect(groupForLegacyDisplayType(catalog, legacy)).toBe(group)
    }
  })

  it('reads group limits per feature', () => {
    expect(catalog.maxCounts.get('APP_STORE_VERSIONS:APP_SCREENSHOT:IPHONE_DUO_PROFILE')).toBe(10)
    expect(catalog.maxCounts.get('CUSTOM_PRODUCT_PAGES:APP_SCREENSHOT:IPHONE_DYNAMIC_ISLAND_LARGE_PROFILE')).toBe(10)
  })
})

describe('image preflight', () => {
  it('reads PNG and JPEG headers', () => {
    expect(readImageInfo(png(1320, 2868))).toEqual({ width: 1320, height: 2868, mimeType: 'image/png', hasAlpha: false })
    expect(readImageInfo(png(1320, 2868, 6))?.hasAlpha).toBe(true)
    expect(readImageInfo(jpeg(1290, 2796))).toEqual({ width: 1290, height: 2796, mimeType: 'image/jpeg', hasAlpha: false })
    expect(readImageInfo(Buffer.from('nope'))).toBeNull()
  })

  it('rejects transparency where Apple does not allow it', () => {
    expect(preflightImage(catalog, 'APP_SCREENSHOT', 'IPHONE_DYNAMIC_ISLAND_LARGE_PROFILE', png(1320, 2868))).toEqual([])
    expect(preflightImage(catalog, 'APP_SCREENSHOT', 'IPHONE_DYNAMIC_ISLAND_LARGE_PROFILE', png(1320, 2868, 6))[0]).toMatch(/transparency/)
    // 5.5" home-button specs allow alpha
    expect(preflightImage(catalog, 'APP_SCREENSHOT', 'IPHONE_HOME_BUTTON_LARGE_PROFILE', png(1242, 2208, 6))).toEqual([])
  })

  it('rejects a size the group does not accept', () => {
    expect(preflightImage(catalog, 'APP_SCREENSHOT', 'IPHONE_DUO_PROFILE', png(1320, 2868))[0]).toMatch(/not an accepted size/)
  })
})

describe('planPlacements', () => {
  const p = (id: string, assetId: string) => ({ id, assetId })

  it('does nothing when already identical in order', () => {
    const plan = planPlacements([p('p1', 'a'), p('p2', 'b')], ['a', 'b'])
    expect(plan).toMatchObject({ unchanged: true, remove: [], create: [], keep: ['p1', 'p2'] })
  })

  it('reorders by reusing placements, without creating or deleting', () => {
    const plan = planPlacements([p('p1', 'a'), p('p2', 'b'), p('p3', 'c')], ['c', 'a', 'b'])
    expect(plan).toMatchObject({ unchanged: false, remove: [], create: [], keep: ['p3', 'p1', 'p2'] })
  })

  it('removes unwanted placements and creates missing ones in position', () => {
    const plan = planPlacements([p('p1', 'a'), p('p2', 'old')], ['a', 'new', 'b'])
    expect(plan.remove).toEqual(['p2'])
    expect(plan.create).toEqual([{ index: 1, assetId: 'new' }, { index: 2, assetId: 'b' }])
    expect(plan.keep).toEqual(['p1', null, null])
  })

  it('handles the same asset placed twice', () => {
    const plan = planPlacements([p('p1', 'a'), p('p2', 'a'), p('p3', 'a')], ['a', 'a'])
    expect(plan.keep).toEqual(['p1', 'p2'])
    expect(plan.remove).toEqual(['p3'])
  })
})

// --- Fake App Store Connect --------------------------------------------------

interface FakeImage { id: string; state: string; specId?: string; fileName: string; polls: number }
interface FakePlacement { id: string; group: string; type: string; assetId: string; target: string }

function fakeAsc(options: { specIdForUpload?: string; failProcessing?: boolean } = {}) {
  const calls: string[] = []
  const images = new Map<string, FakeImage>()
  let placements: FakePlacement[] = []
  let seq = 0
  const json = (status: number, body?: unknown) =>
    new Response(body === undefined ? null : JSON.stringify(body), { status })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const request = async (method: string, url: string, body?: any): Promise<Response> => {
    const u = new URL(url)
    const p = u.pathname
    calls.push(`${method} ${p}`)
    if (method === 'GET' && p === '/v1/apps/123/assetLibrary') return json(200, { data: { type: 'appAssetLibraries', id: '123' } })
    if (method === 'GET' && p === '/v1/appAssetLibraryRefData') return json(200, refData)
    if (method === 'POST' && p === '/v1/appAssetLibraryImages') {
      const id = `img${++seq}`
      images.set(id, { id, state: 'AWAITING_UPLOAD', fileName: body.data.attributes.fileName, polls: 0 })
      return json(201, {
        data: {
          id,
          attributes: {
            state: 'AWAITING_UPLOAD',
            uploadOperations: [{ method: 'PUT', url: `https://upload.example/${id}`, offset: 0, length: body.data.attributes.fileSize, requestHeaders: [{ name: 'Content-Type', value: 'image/png' }] }],
          },
        },
      })
    }
    const imageMatch = p.match(/^\/v1\/appAssetLibraryImages\/([^/]+)$/)
    if (imageMatch) {
      const img = images.get(imageMatch[1])
      if (method === 'PATCH') {
        if (!img || body.data.attributes.uploaded !== true || 'sourceFileChecksum' in body.data.attributes) return json(409)
        img.state = 'UPLOAD_COMPLETE'
        return json(200, { data: { id: img.id, attributes: { state: img.state } } })
      }
      if (method === 'DELETE') {
        if (placements.some(pl => pl.assetId === imageMatch[1])) return json(409, { errors: [{ code: 'STATE_ERROR.ASSET_HAS_PLACEMENTS' }] })
        images.delete(imageMatch[1])
        return json(204)
      }
      if (!img) return json(404)
      if (img.state === 'UPLOAD_COMPLETE' && ++img.polls >= 2) {
        img.state = options.failProcessing ? 'FAILED' : 'PREPARE_FOR_SUBMISSION'
        img.specId = options.specIdForUpload ?? 'bd402f1a-26ee-5b83-9dd7-972c60c43d47' // i1320x2868a0
      }
      return json(200, { data: { id: img.id, attributes: { state: img.state, specId: img.specId, fileName: img.fileName } } })
    }
    const relMatch = p.match(/^\/v1\/appAssetLibraryImages\/([^/]+)\/relationships\/placements$/)
    if (relMatch) return json(200, { data: placements.filter(pl => pl.assetId === relMatch[1]).map(pl => ({ id: pl.id })) })
    const listMatch = p.match(/^\/v1\/appStoreVersionLocalizations\/([^/]+)\/placements$/)
    if (listMatch && method === 'GET') {
      const group = u.searchParams.get('filter[placementGroup]')
      const rows = placements.filter(pl => pl.target === listMatch[1] && (!group || pl.group === group))
      return json(200, {
        data: rows.map(pl => ({
          id: pl.id,
          attributes: { placementGroup: pl.group, placementType: pl.type, state: 'ACTIVE' },
          relationships: { image: { data: { type: 'appAssetLibraryImages', id: pl.assetId } } },
        })),
        included: [],
        links: {},
      })
    }
    if (method === 'POST' && p === '/v1/appAssetLibraryPlacements') {
      const id = `pl${++seq}`
      placements.push({
        id,
        group: body.data.attributes.placementGroup,
        type: body.data.attributes.placementType,
        assetId: body.data.relationships.image.data.id,
        target: body.data.relationships.appStoreVersionLocalization.data.id,
      })
      return json(201, { data: { id } })
    }
    const placementMatch = p.match(/^\/v1\/appAssetLibraryPlacements\/([^/]+)$/)
    if (placementMatch && method === 'DELETE') {
      placements = placements.filter(pl => pl.id !== placementMatch[1])
      return json(204)
    }
    if (method === 'POST' && p === '/v1/appAssetLibraryPlacementOrderingRequests') {
      const order: string[] = body.data.relationships.orderedPlacements.data.map((d: { id: string }) => d.id)
      const group = body.data.attributes.placementGroup
      const inGroup = placements.filter(pl => pl.group === group)
      if (inGroup.length !== order.length) return json(409, { errors: [{ code: 'ENTITY_ERROR', detail: 'must name every placement' }] })
      placements = [...placements.filter(pl => pl.group !== group), ...order.map(id => inGroup.find(pl => pl.id === id)!)]
      return json(201, { data: { id: 'ord' } })
    }
    return json(500, { errors: [{ detail: `unhandled ${method} ${p}` }] })
  }

  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push(`${init.method} ${url}`)
    return new Response(null, { status: 200 })
  }) as unknown as typeof fetch

  const seedPlacements = (rows: Array<[string, string]>, group = 'IPHONE_DYNAMIC_ISLAND_LARGE_PROFILE') => {
    for (const [id, assetId] of rows) placements.push({ id, assetId, group, type: 'APP_SCREENSHOT', target: 'loc1' })
  }

  return { request, fetchImpl, calls, images, seedPlacements, placementIds: () => placements.map(pl => pl.id), placements: () => placements }
}

const target = { kind: 'appStoreVersionLocalization' as const, id: 'loc1' }
const GROUP = 'IPHONE_DYNAMIC_ISLAND_LARGE_PROFILE'

describe('AscAssetLibraryClient', () => {
  beforeEach(() => clearRefDataCache())

  const client = (asc: ReturnType<typeof fakeAsc>, index = memoryAssetIndex()) =>
    new AscAssetLibraryClient({ request: asc.request, appId: '123', fetchImpl: asc.fetchImpl, assetIndex: index, sleep: async () => {}, pollIntervalMs: 0 })

  it('uploads: reserve, PUT parts, commit uploaded:true without checksum, wait for processing', async () => {
    const asc = fakeAsc()
    const result = await client(asc).uploadImage({ fileName: '01.png', data: png(1320, 2868), expectedGroup: GROUP })
    expect(result).toMatchObject({ assetId: 'img1', reused: false })
    expect(asc.calls.slice(0, 4)).toEqual([
      'GET /v1/apps/123/assetLibrary',
      'POST /v1/appAssetLibraryImages',
      'PUT https://upload.example/img1',
      'PATCH /v1/appAssetLibraryImages/img1',
    ])
    expect(asc.images.get('img1')?.state).toBe('PREPARE_FOR_SUBMISSION')
  })

  it('reuses an indexed asset for the same file instead of uploading again', async () => {
    const asc = fakeAsc()
    const index = memoryAssetIndex()
    const data = png(1320, 2868)
    await client(asc, index).uploadImage({ fileName: '01.png', data })
    const second = await client(asc, index).uploadImage({ fileName: '01-de.png', data, expectedGroup: GROUP })
    expect(second).toMatchObject({ assetId: 'img1', reused: true })
    expect(asc.calls.filter(c => c === 'POST /v1/appAssetLibraryImages')).toHaveLength(1)
  })

  it('re-uploads when the indexed asset is gone', async () => {
    const asc = fakeAsc()
    const index = memoryAssetIndex()
    const data = png(1320, 2868)
    await client(asc, index).uploadImage({ fileName: '01.png', data })
    asc.images.delete('img1')
    const again = await client(asc, index).uploadImage({ fileName: '01.png', data })
    expect(again).toMatchObject({ assetId: 'img2', reused: false })
  })

  it('fails when Apple matches a spec outside the intended group', async () => {
    const asc = fakeAsc({ specIdForUpload: '92546362-6039-58e6-9823-97f9f7b02c2e' }) // 6.5" spec
    await expect(client(asc).uploadImage({ fileName: '01.png', data: png(1320, 2868), expectedGroup: GROUP }))
      .rejects.toMatchObject({ code: 'SPEC_MISMATCH' })
  })

  it('surfaces processing failures', async () => {
    const asc = fakeAsc({ failProcessing: true })
    await expect(client(asc).uploadImage({ fileName: '01.png', data: png(1320, 2868) }))
      .rejects.toMatchObject({ code: 'ASSET_FAILED' })
  })

  it('skips sync entirely when placements already match in order', async () => {
    const asc = fakeAsc()
    asc.seedPlacements([['p1', 'a'], ['p2', 'b']])
    const result = await client(asc).syncPlacements(target, 'APP_SCREENSHOT', GROUP, ['a', 'b'])
    expect(result).toMatchObject({ unchanged: true, created: 0, removed: 0 })
    expect(asc.calls.some(c => c.startsWith('POST') || c.startsWith('DELETE'))).toBe(false)
  })

  it('applies a pure reorder with one ordering request', async () => {
    const asc = fakeAsc()
    asc.seedPlacements([['p1', 'a'], ['p2', 'b'], ['p3', 'c']])
    const result = await client(asc).syncPlacements(target, 'APP_SCREENSHOT', GROUP, ['c', 'a', 'b'])
    expect(result).toMatchObject({ unchanged: false, created: 0, removed: 0, reordered: true })
    expect(asc.placementIds()).toEqual(['p3', 'p1', 'p2'])
    expect(asc.calls.filter(c => c.startsWith('POST'))).toEqual(['POST /v1/appAssetLibraryPlacementOrderingRequests'])
  })

  it('deletes before creating, then orders and verifies', async () => {
    const asc = fakeAsc()
    asc.seedPlacements([['p1', 'a'], ['p2', 'old']])
    asc.seedPlacements([['other', 'x']], 'IPAD_13_PROFILE')
    const result = await client(asc).syncPlacements(target, 'APP_SCREENSHOT', GROUP, ['new', 'a'])
    expect(result).toMatchObject({ created: 1, removed: 1 })
    const writes = asc.calls.filter(c => c.startsWith('POST') || c.startsWith('DELETE'))
    expect(writes).toEqual([
      'DELETE /v1/appAssetLibraryPlacements/p2',
      'POST /v1/appAssetLibraryPlacements',
      'POST /v1/appAssetLibraryPlacementOrderingRequests',
    ])
    expect(asc.placements().filter(pl => pl.group === GROUP).map(pl => pl.assetId)).toEqual(['new', 'a'])
    expect(asc.placements().some(pl => pl.id === 'other')).toBe(true)
  })

  it('refuses more items than the group allows', async () => {
    const asc = fakeAsc()
    const ids = Array.from({ length: 11 }, (_, i) => `a${i}`)
    await expect(client(asc).syncPlacements(target, 'APP_SCREENSHOT', GROUP, ids)).rejects.toMatchObject({ code: 'TOO_MANY_PLACEMENTS' })
  })

  it('only deletes assets that nothing places', async () => {
    const asc = fakeAsc()
    const c = client(asc)
    await c.uploadImage({ fileName: '01.png', data: png(1320, 2868) })
    asc.seedPlacements([['p1', 'img1']])
    expect(await c.deleteAssetIfUnplaced('img1')).toBe(false)
    await c.syncPlacements(target, 'APP_SCREENSHOT', GROUP, [])
    expect(await c.deleteAssetIfUnplaced('img1')).toBe(true)
    expect(asc.images.has('img1')).toBe(false)
  })
})

describe('functions mirror', () => {
  it('functions/src/ascAssetLibrary.ts is identical to lib/services/asc-asset-library.ts', () => {
    const root = path.join(__dirname, '..')
    expect(readFileSync(path.join(root, 'functions/src/ascAssetLibrary.ts'), 'utf8'))
      .toBe(readFileSync(path.join(root, 'lib/services/asc-asset-library.ts'), 'utf8'))
  })
})
