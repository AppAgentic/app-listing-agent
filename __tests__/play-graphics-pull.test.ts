import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AccountContext } from '@/lib/org/context'
import { adminDb } from '@/lib/firebase/admin'
const mocks = vi.hoisted(() => ({ project: vi.fn(), helper: vi.fn(), auth: vi.fn(), upload: vi.fn(), mutate: vi.fn() }))
vi.mock('@/lib/org/context', async original => ({ ...await original<Record<string, unknown>>(), getProjectContext: mocks.project }))
vi.mock('@/lib/org/project-authorization', async original => ({ ...await original<Record<string, unknown>>(), canMutateProject: mocks.mutate }))
vi.mock('@/app/api/playstore-iap/_helpers', async original => ({ ...await original<Record<string, unknown>>(), getPlayStoreHelperForContext: mocks.helper, getAuthContext: mocks.auth }))
vi.mock('@/lib/services/r2', async original => ({ ...await original<Record<string, unknown>>(), uploadFromUrl: mocks.upload }))
import { pullPlayStoreGraphics } from '@/lib/services/play-graphics-pull'
import { executeTool } from '@/lib/mcp/server'
import { POST } from '@/app/api/screenshots/play-pull/route'
import type { NextRequest } from 'next/server'
vi.mock('@/lib/firebase/admin', () => ({ adminDb: { batch: vi.fn(), collection: vi.fn() }, adminAuth: {} }))
afterEach(() => vi.restoreAllMocks())
const context = { type: 'personal', userId: 'oauth-user', user: {} } as AccountContext
const pull = vi.fn()
const batch = { set: vi.fn(), update: vi.fn(), commit: vi.fn() }
const doc = { id: 'PLAY_PHONE' }
const basePath = { collection: vi.fn(() => ({ doc: vi.fn(() => doc) })) }
beforeEach(() => {
  vi.clearAllMocks()
  mocks.project.mockResolvedValue({ ...context, projectId: 'project-a', project: {} })
  mocks.mutate.mockReturnValue(true)
  mocks.helper.mockResolvedValue({ authContext: context, projectContext: context, basePath, helper: { pullImages: pull } })
  mocks.auth.mockResolvedValue({ context })
  pull.mockResolvedValue([{ locale: 'en-US', imageUrls: ['https://play.example/art.png'] }])
  mocks.upload.mockResolvedValue({ url: 'https://screens.appstorecopilot.com/qa.png', key: 'qa.png' })
  vi.mocked(adminDb.batch).mockReturnValue(batch as never)
})
describe('Play graphics shared authenticated operation', () => {
  it('MCP OAuth context without apiKey reaches provider and saves through shared service', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const result = await executeTool('pull_play_store_graphics', { projectId: 'project-a', displayTypes: ['PLAY_PHONE'], locales: ['en-US'] }, context)
    expect(result).toMatchObject({ success: true, totalPulled: 1, displayTypesPulled: ['PLAY_PHONE'] })
    expect(mocks.helper).toHaveBeenCalledWith(context, 'project-a')
    expect(pull).toHaveBeenCalledWith({ imageType: 'phoneScreenshots', locales: ['en-US'] })
    expect(batch.set).toHaveBeenCalledWith(doc, expect.objectContaining({ locale: 'en-US', syncStatus: 'synced', createdBy: 'oauth-user' }))
    expect(batch.commit).toHaveBeenCalledOnce()
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })
  it.each(['foreign-project', 'read-only'])('denies %s before credentials, provider, storage or writes', async reason => {
    if (reason === 'foreign-project') mocks.project.mockResolvedValue(null)
    else mocks.mutate.mockReturnValue(false)
    expect(await executeTool('pull_play_store_graphics', { projectId: 'project-a' }, context)).toMatchObject({ success: false })
    expect(mocks.helper).not.toHaveBeenCalled()
    expect(pull).not.toHaveBeenCalled()
    expect(mocks.upload).not.toHaveBeenCalled()
    expect(batch.commit).not.toHaveBeenCalled()
  })
  it('the trusted-context credential resolver independently rejects a foreign project', async () => {
    const actual = await vi.importActual<typeof import('@/app/api/playstore-iap/_helpers')>('@/app/api/playstore-iap/_helpers')
    mocks.project.mockResolvedValue(null)
    expect(await actual.getPlayStoreHelperForContext(context, 'foreign-project')).toEqual({ error: 'Project not found' })
    expect(mocks.project).toHaveBeenCalledWith('oauth-user', 'foreign-project')
    expect(adminDb.collection).not.toHaveBeenCalled()
  })
  it('retains web authentication before the shared operation', async () => {
    mocks.auth.mockResolvedValue({ context: null, error: 'Authentication required' })
    const request = () => new Request('https://applistingagent.com/api/screenshots/play-pull', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ projectId: 'project-a', displayTypes: ['PLAY_PHONE'] }) }) as NextRequest
    expect((await POST(request())).status).toBe(401)
    expect(mocks.helper).not.toHaveBeenCalled()
    mocks.auth.mockResolvedValue({ context })
    const response = await POST(request())
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ success: true, totalPulled: 1 })
  })
  it('returns provider failure without committing local changes', async () => {
    pull.mockRejectedValue(new Error('Play Store unavailable'))
    expect(await pullPlayStoreGraphics({ projectId: 'project-a' }, context)).toMatchObject({ success: false, error: 'Play Store unavailable', status: 500 })
    expect(mocks.upload).not.toHaveBeenCalled()
    expect(batch.commit).not.toHaveBeenCalled()
  })
  it('preserves the empty pull result without writing a screenshot set', async () => {
    pull.mockResolvedValue([])
    expect(await pullPlayStoreGraphics({ projectId: 'project-a', displayTypes: ['PLAY_PHONE'] }, context)).toEqual({ success: true, totalPulled: 0, displayTypesPulled: [] })
    expect(batch.set).not.toHaveBeenCalled()
    expect(batch.commit).not.toHaveBeenCalled()
  })
  it('returns credential prerequisites without dispatching a provider call', async () => {
    mocks.helper.mockResolvedValue({ error: 'Play Store credentials not configured' })
    expect(await pullPlayStoreGraphics({ projectId: 'project-a' }, context)).toMatchObject({ success: false, error: 'Play Store credentials not configured' })
    expect(pull).not.toHaveBeenCalled()
  })
})
