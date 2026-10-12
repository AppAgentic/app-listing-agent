import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AccountContext } from '@/lib/org/context'
import type { UpdateMetadataParams } from '@/lib/mcp/tools/update-metadata'
const state = vi.hoisted(() => ({ saved: {} as Record<string, unknown>, set: vi.fn(), update: vi.fn(), collection: vi.fn() }))
vi.mock('@/lib/firebase/admin', () => {
  const doc = { collection: (name: string): unknown => { state.collection(name); return collection }, get: async () => ({ exists: true, data: () => state.saved }), set: state.set, update: state.update }
  const collection = { doc: () => doc }
  return { adminDb: { collection: (name: string) => { state.collection(name); return collection } } }
})
vi.mock('@/lib/org/context', () => ({ getProjectContext: async () => ({ type: 'personal' }), hasContextPermission: () => true }))
import { updateMetadata } from '@/lib/mcp/tools/update-metadata'
const context = { userId: 'reviewer' } as AccountContext
const params = (metadata: unknown, store: 'appstore' | 'playstore' = 'appstore') => ({ projectId: 'atlas', store, locale: 'fr-FR', metadata }) as UpdateMetadataParams
beforeEach(() => { vi.clearAllMocks(); state.saved = { name: 'Atlas', subtitle: 'Old subtitle', description: 'Keep description', keywords: 'keep' } })
describe('update_metadata validation before writes', () => {
  it.each([
    ['appstore', 'title', 30], ['appstore', 'subtitle', 30], ['appstore', 'description', 4000], ['appstore', 'keywords', 100],
    ['appstore', 'whatsNew', 4000], ['appstore', 'promotionalText', 170], ['playstore', 'title', 30],
    ['playstore', 'shortDescription', 80], ['playstore', 'fullDescription', 4000],
  ] as const)('rejects oversized %s %s without any partial write', async (store, field, limit) => {
    const result = await updateMetadata(params({ title: 'Valid sibling', [field]: 'é'.repeat(limit + 1) }, store), context)
    expect(result).toEqual({ success: false, error: `metadata.${field} is ${limit + 1} characters; maximum is ${limit}. No metadata was saved.` })
    expect(state.collection).not.toHaveBeenCalled(); expect(state.set).not.toHaveBeenCalled(); expect(state.update).not.toHaveBeenCalled()
  })
  it.each([null, 39, {}, ['copy']])('rejects non-text supplied values %j before writes', async value => {
    expect(await updateMetadata(params({ subtitle: value }), context)).toMatchObject({ success: false })
    expect(state.set).not.toHaveBeenCalled(); expect(state.update).not.toHaveBeenCalled()
  })
  it.each([null, [], 'copy'])('rejects malformed metadata %j', async metadata => {
    expect(await updateMetadata(params(metadata), context)).toMatchObject({ success: false })
    expect(state.collection).not.toHaveBeenCalled()
  })
  it('accepts exact Unicode code-point boundary and preserves all omitted siblings', async () => {
    const subtitle = '🌱'.repeat(30)
    expect(await updateMetadata(params({ subtitle }), context)).toEqual({ success: true, fieldsUpdated: ['subtitle'] })
    expect(state.set).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ ...state.saved, subtitle }))
    expect(state.update).toHaveBeenCalledOnce()
  })
  it('allows intentional clearing and continues ignoring unsupported store fields', async () => {
    expect(await updateMetadata(params({ subtitle: '', shortDescription: 'x'.repeat(81) }), context)).toEqual({ success: true, fieldsUpdated: ['subtitle'], fieldsIgnored: ['shortDescription'] })
    expect(state.set).toHaveBeenCalledWith(expect.objectContaining({ ...state.saved, subtitle: '' }))
  })
})
