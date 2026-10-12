import { describe, expect, it } from 'vitest'
import { preferDraftPerLocale, upsertVersionedLocalization, VersionedMetadataError } from '@/lib/services/asc-iap-versions'

const ASC = 'https://api.appstoreconnect.apple.com'
type Loc = { id: string; locale: string; name: string; description?: string }

// Minimal fake of the versioned subscription endpoints, mirroring live behaviour
// (7 Oct 2026): approved localizations are locked, a draft copies them under new ids.
function fakeAsc(initial: { versions: Array<{ id: string; version: number; state: string; locs: Loc[] }> }) {
  const versions = initial.versions
  const calls: string[] = []
  let nextId = 1
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
  const request = async (method: string, url: string, body?: any) => {
    const path = url.replace(ASC, '').split('?')[0]
    calls.push(`${method} ${path}`)
    if (method === 'GET' && path === '/v1/subscriptions/sub1/versions') {
      return json({ data: versions.map(v => ({ id: v.id, attributes: { version: v.version, state: v.state } })) })
    }
    const listMatch = path.match(/^\/v1\/subscriptionVersions\/([^/]+)\/localizations$/)
    if (method === 'GET' && listMatch) {
      const v = versions.find(x => x.id === listMatch[1])!
      return json({ data: v.locs.map(l => ({ id: l.id, attributes: { locale: l.locale, name: l.name, description: l.description ?? null } })) })
    }
    if (method === 'POST' && path === '/v1/subscriptionVersions') {
      if (versions.some(v => v.state !== 'APPROVED')) return json({ errors: [{ code: 'STATE_ERROR.ALREADY_EXISTS' }] }, 409)
      const latest = versions[0]
      const draft = { id: `v${nextId++}`, version: latest.version + 1, state: 'PREPARE_FOR_SUBMISSION', locs: latest.locs.map(l => ({ ...l, id: `${l.id}-draft` })) }
      versions.unshift(draft)
      return json({ data: { id: draft.id, attributes: { version: draft.version, state: draft.state } } }, 201)
    }
    const patchMatch = path.match(/^\/v2\/subscriptionLocalizations\/(.+)$/)
    if (method === 'PATCH' && patchMatch) {
      for (const v of versions) {
        const loc = v.locs.find(l => l.id === patchMatch[1])
        if (loc) {
          if (v.state === 'APPROVED') return json({ errors: [{ code: 'ENTITY_ERROR.ATTRIBUTE.INVALID.UNMODIFIABLE' }] }, 409)
          Object.assign(loc, body.data.attributes)
          return json({ data: { id: loc.id, attributes: { locale: loc.locale, name: loc.name, description: loc.description } } })
        }
      }
      return json({}, 404)
    }
    if (method === 'POST' && path === '/v2/subscriptionLocalizations') {
      const v = versions.find(x => x.id === body.data.relationships.version.data.id)!
      const loc = { id: `new${nextId++}`, ...body.data.attributes }
      v.locs.push(loc)
      return json({ data: { id: loc.id, attributes: body.data.attributes } }, 201)
    }
    throw new Error(`unexpected ${method} ${url}`)
  }
  return { request, calls, versions }
}

const approved = () => ({ versions: [{ id: 'v-approved', version: 1, state: 'APPROVED', locs: [{ id: 'loc-en', locale: 'en-US', name: 'Premium', description: 'Annual Plan' }] }] })

describe('upsertVersionedLocalization', () => {
  it('writes nothing when the approved text already matches', async () => {
    const asc = fakeAsc(approved())
    const result = await upsertVersionedLocalization(asc.request, 'subscription', 'sub1', 'en-US', { name: 'Premium', description: 'Annual Plan' })
    expect(result.unchanged).toBe(true)
    expect(asc.calls.filter(c => !c.startsWith('GET'))).toEqual([])
  })

  it('opens a draft and edits its copy when approved text changes', async () => {
    const asc = fakeAsc(approved())
    const result = await upsertVersionedLocalization(asc.request, 'subscription', 'sub1', 'en-US', { name: 'Premium', description: 'Monthly Plan' })
    expect(result.createdDraft).toBe(true)
    expect(result.version).toMatchObject({ version: 2, state: 'PREPARE_FOR_SUBMISSION' })
    expect(result.localization).toMatchObject({ id: 'loc-en-draft', attributes: { description: 'Monthly Plan' } })
    expect(asc.calls.filter(c => !c.startsWith('GET'))).toEqual(['POST /v1/subscriptionVersions', 'PATCH /v2/subscriptionLocalizations/loc-en-draft'])
    expect(asc.versions[1].locs[0].description).toBe('Annual Plan') // approved copy untouched
  })

  it('reuses an open draft instead of creating another', async () => {
    const asc = fakeAsc({ versions: [
      { id: 'v-draft', version: 2, state: 'PREPARE_FOR_SUBMISSION', locs: [{ id: 'd-en', locale: 'en-US', name: 'Premium', description: 'x' }] },
      ...approved().versions,
    ] })
    await upsertVersionedLocalization(asc.request, 'subscription', 'sub1', 'en-US', { name: 'Premium', description: 'y' })
    expect(asc.calls.filter(c => !c.startsWith('GET'))).toEqual(['PATCH /v2/subscriptionLocalizations/d-en'])
  })

  it('adds a new locale to the draft', async () => {
    const asc = fakeAsc(approved())
    const result = await upsertVersionedLocalization(asc.request, 'subscription', 'sub1', 'de-DE', { name: 'Premium', description: 'Monatlich' })
    expect(result.createdDraft).toBe(true)
    expect(asc.calls.filter(c => !c.startsWith('GET'))).toEqual(['POST /v1/subscriptionVersions', 'POST /v2/subscriptionLocalizations'])
    expect(asc.versions[0].locs.map(l => l.locale)).toEqual(['en-US', 'de-DE'])
  })

  it('refuses while a version is in review', async () => {
    const asc = fakeAsc({ versions: [{ id: 'v2', version: 2, state: 'WAITING_FOR_REVIEW', locs: [] }] })
    await expect(upsertVersionedLocalization(asc.request, 'subscription', 'sub1', 'en-US', { name: 'x' }))
      .rejects.toMatchObject({ code: 'IN_REVIEW' })
  })

  it('reports versioning as unavailable when there are no versions', async () => {
    const asc = fakeAsc({ versions: [] })
    const error = await upsertVersionedLocalization(asc.request, 'subscription', 'sub1', 'en-US', { name: 'x' }).catch(e => e)
    expect(error).toBeInstanceOf(VersionedMetadataError)
    expect(error.code).toBe('VERSIONING_UNAVAILABLE')
  })
})

describe('preferDraftPerLocale', () => {
  it('keeps the draft when a locale has an approved and a draft localization', () => {
    const items = [
      { id: 'draft', locale: 'en-US', state: 'PREPARE_FOR_SUBMISSION' },
      { id: 'approved', locale: 'en-US', state: 'APPROVED' },
      { id: 'de', locale: 'de-DE', state: 'APPROVED' },
    ]
    expect(preferDraftPerLocale(items).map(i => i.id)).toEqual(['draft', 'de'])
    expect(preferDraftPerLocale([items[1], items[0]]).map(i => i.id)).toEqual(['draft'])
  })
})
