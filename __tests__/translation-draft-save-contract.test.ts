import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AccountContext } from '@/lib/org/context'

const state = vi.hoisted(() => ({
  documents: new Map<string, Record<string, unknown>>(),
  translate: vi.fn(),
  reserve: vi.fn(),
  settle: vi.fn(),
  refund: vi.fn(),
  projectContext: { type: 'personal', userId: 'reviewer' } as { type: string; userId: string; orgId?: string },
}))

vi.mock('@/lib/firebase/admin', () => {
  const snapshot = (path: string) => ({ exists: state.documents.has(path), data: () => state.documents.get(path) })
  const doc = (path: string): any => ({
    get: async () => snapshot(path),
    set: async (data: Record<string, unknown>) => { state.documents.set(path, data) },
    update: async (data: Record<string, unknown>) => { state.documents.set(path, { ...state.documents.get(path), ...data }) },
    collection: (name: string) => collection(`${path}/${name}`),
  })
  const collection = (path: string): any => ({
    doc: (id: string) => doc(`${path}/${id}`),
    where: (field: string, _operator: string, value: unknown) => ({
      get: async () => ({ docs: [...state.documents.entries()]
        .filter(([key, data]) => key.slice(0, key.lastIndexOf('/')) === path && data[field] === value)
        .map(([key]) => snapshot(key)) }),
    }),
  })
  return { adminDb: { collection } }
})
vi.mock('@/lib/org/context', () => ({
  getProjectContext: vi.fn(async () => state.projectContext),
  hasContextPermission: vi.fn(() => true),
}))
vi.mock('@/lib/services/translator', () => ({
  TranslationHelper: class { translateToLocales = state.translate },
}))
vi.mock('@/lib/api/usage', () => ({
  reserveUsage: state.reserve,
  settleUsage: state.settle,
  refundUsage: state.refund,
}))

import { translateMetadata } from '@/lib/mcp/tools/translate-metadata'
import { updateMetadata } from '@/lib/mcp/tools/update-metadata'
import { readMetadata } from '@/lib/mcp/tools/read-metadata'

const context = { userId: 'reviewer' } as AccountContext
const personal = 'users/reviewer/projects/atlas'
const oldMetadata = { locale: 'fr-FR', name: 'Atlas Habit', subtitle: 'Habitudes, routine et suivi', description: 'Existing description', promotionalText: 'Keep this promotion' }

beforeEach(() => {
  state.documents.clear()
  vi.clearAllMocks()
  state.projectContext = { type: 'personal', userId: 'reviewer' }
  state.reserve.mockResolvedValue({ allowed: true, replayed: false })
  state.translate.mockResolvedValue(new Map([['fr-FR', [
    { field: 'subtitle', translatedText: 'Planifiez, suivez vos routines', sourceHash: 'new-source', cached: false },
  ]]]))
  state.documents.set(personal, { name: 'Atlas Habit', primaryLocale: 'en-US', syncStatus: 'synced' })
  state.documents.set(`${personal}/metadata/fr-FR`, { ...oldMetadata })
})

describe('translation cache versus saved listing contract', () => {
  it('keeps old saved metadata unchanged until the explicit subset save, then verifies exact readback', async () => {
    const result = await translateMetadata({ projectId: 'atlas', store: 'appstore', locales: ['fr-FR'], metadata: { subtitle: 'Plan and track routines' } }, context)
    expect(result).toMatchObject({
      success: true,
      metadataSaved: false,
      translations: { 'fr-FR': { subtitle: 'Planifiez, suivez vos routines' } },
      nextAction: { tool: 'update_metadata', verificationTool: 'read_metadata', requests: [
        { projectId: 'atlas', store: 'appstore', locale: 'fr-FR', metadata: { subtitle: 'Planifiez, suivez vos routines' } },
      ] },
    })
    expect(state.documents.get(`${personal}/translations/fr-FR_subtitle`)).toMatchObject({ translatedText: 'Planifiez, suivez vos routines' })
    expect(state.documents.get(`${personal}/metadata/fr-FR`)).toEqual(oldMetadata)
    expect((await readMetadata({ projectId: 'atlas', locale: 'fr-FR' }, context)).locales?.[0].subtitle).toBe(oldMetadata.subtitle)
    expect(state.documents.get(personal)?.syncStatus).toBe('synced')

    expect(await updateMetadata(result.nextAction!.requests[0], context)).toMatchObject({ success: true, fieldsUpdated: ['subtitle'] })
    const saved = (await readMetadata({ projectId: 'atlas', locale: 'fr-FR' }, context)).locales?.[0]
    expect(saved).toMatchObject({ ...oldMetadata, subtitle: result.translations!['fr-FR'].subtitle })
    expect(state.documents.get(personal)?.syncStatus).toBe('local_changes')
    expect(state.translate).toHaveBeenCalledTimes(1)
    expect(state.reserve).toHaveBeenCalledTimes(1)
    expect(state.settle).toHaveBeenCalledWith(context, expect.any(String), 'translations', 1)
  })

  it('keeps cached results unsaved and bounds suggested saves to requested store fields', async () => {
    state.translate.mockResolvedValue(new Map([['fr-FR', [
      { field: 'title', translatedText: 'Atlas traduit', sourceHash: 'cached', cached: true },
      { field: 'description', translatedText: 'Unrequested replacement', sourceHash: 'extra', cached: true },
      { field: 'shortDescription', translatedText: 'Wrong store field', sourceHash: 'extra', cached: true },
    ]]]))
    const result = await translateMetadata({ projectId: 'atlas', store: 'appstore', locales: ['fr-FR'], metadata: { title: 'Atlas', shortDescription: 'Wrong store field' } }, context)
    expect(result.metadataSaved).toBe(false)
    expect(result.nextAction?.requests[0].metadata).toEqual({ title: 'Atlas traduit' })
    expect(state.documents.get(`${personal}/metadata/fr-FR`)).toEqual(oldMetadata)
    await updateMetadata(result.nextAction!.requests[0], context)
    expect((await readMetadata({ projectId: 'atlas', locale: 'fr-FR' }, context)).locales?.[0]).toMatchObject({ name: 'Atlas traduit', subtitle: oldMetadata.subtitle, description: oldMetadata.description })
    expect(state.settle).toHaveBeenCalledWith(context, expect.any(String), 'translations', 0)
  })

  it('reports no saved metadata and no save action when English filtering leaves no translation', async () => {
    const result = await translateMetadata({ projectId: 'atlas', store: 'appstore', locales: ['en-US'], metadata: { title: 'Atlas' } }, context)
    expect(result).toMatchObject({ success: true, metadataSaved: false, translations: {}, nextAction: null })
    expect(state.translate).not.toHaveBeenCalled()
    expect(state.reserve).not.toHaveBeenCalled()
    expect(state.documents.get(`${personal}/metadata/fr-FR`)).toEqual(oldMetadata)
  })
})

describe('saveToLocaleDraft', () => {
  it('saves exactly the requested translated fields in one call and preserves other fields', async () => {
    const result = await translateMetadata({ projectId: 'atlas', store: 'appstore', locales: ['fr-FR'], saveToLocaleDraft: true, metadata: { subtitle: 'Plan and track routines' } }, context)
    expect(result).toMatchObject({
      success: true,
      metadataSaved: true,
      savedLocales: { 'fr-FR': { saved: true, fieldsUpdated: ['subtitle'] } },
      nextAction: null,
    })
    const saved = (await readMetadata({ projectId: 'atlas', locale: 'fr-FR' }, context)).locales?.[0]
    expect(saved).toMatchObject({ ...oldMetadata, subtitle: 'Planifiez, suivez vos routines' })
    expect(state.translate).toHaveBeenCalledTimes(1)
  })

  it('reports an over-limit translation as unsaved without truncating or changing the draft', async () => {
    state.translate.mockResolvedValue(new Map([['fr-FR', [
      { field: 'subtitle', translatedText: 'Planifiez et suivez toutes vos routines quotidiennes', sourceHash: 'long', cached: false },
    ]]]))
    const result = await translateMetadata({ projectId: 'atlas', store: 'appstore', locales: ['fr-FR'], saveToLocaleDraft: true, metadata: { subtitle: 'Plan and track routines' } }, context)
    expect(result.success).toBe(false)
    expect(result.metadataSaved).toBe(false)
    expect(result.savedLocales?.['fr-FR']).toMatchObject({ saved: false })
    expect(result.savedLocales?.['fr-FR'].error).toContain('maximum is 30')
    expect(result.translations?.['fr-FR'].subtitle).toBe('Planifiez et suivez toutes vos routines quotidiennes')
    expect(state.documents.get(`${personal}/metadata/fr-FR`)).toEqual(oldMetadata)
  })
})

describe('authoritative translated field lengths', () => {
  it.each([false, true])('reports the real French counts for cached=%s without saving', async cached => {
    state.translate.mockResolvedValue(new Map([['fr-FR', [
      { field: 'title', translatedText: "Atlas : Suivi d'habitudes", sourceHash: 'title', cached },
      { field: 'subtitle', translatedText: 'Créer habitudes, suivi routine', sourceHash: 'subtitle', cached },
    ]]]))
    const result = await translateMetadata({ projectId: 'atlas', store: 'appstore', locales: ['fr-FR'], metadata: { title: 'Atlas', subtitle: 'Build habits, track progress' } }, context)
    expect(result.fieldValidation).toEqual({ 'fr-FR': {
      title: { characterCount: 25, limit: 30, withinLimit: true },
      subtitle: { characterCount: 30, limit: 30, withinLimit: true },
    } })
    expect(result.characterCountUnit).toBe('unicode-code-points')
    expect(result.metadataSaved).toBe(false)
    expect(state.documents.get(`${personal}/metadata/fr-FR`)).toEqual(oldMetadata)
  })

  it('agrees with save validation on astral Unicode and an over-limit cached result', async () => {
    const title = '🧭'.repeat(30)
    const subtitle = 'é'.repeat(31)
    state.translate.mockResolvedValue(new Map([['fr-FR', [
      { field: 'title', translatedText: title, sourceHash: 'title', cached: true },
      { field: 'subtitle', translatedText: subtitle, sourceHash: 'subtitle', cached: true },
    ]]]))
    const result = await translateMetadata({ projectId: 'atlas', store: 'appstore', locales: ['fr-FR'], metadata: { title: 'Atlas', subtitle: 'Habits' } }, context)
    expect(result.fieldValidation?.['fr-FR']).toEqual({
      title: { characterCount: 30, limit: 30, withinLimit: true },
      subtitle: { characterCount: 31, limit: 30, withinLimit: false },
    })
    expect(result.translations?.['fr-FR']).toEqual({ title, subtitle })
    expect(await updateMetadata(result.nextAction!.requests[0], context)).toMatchObject({ success: false, error: expect.stringContaining('31 characters') })
    expect(state.documents.get(`${personal}/metadata/fr-FR`)).toEqual(oldMetadata)
  })
})
