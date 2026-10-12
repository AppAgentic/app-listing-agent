import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ generate: vi.fn(), variations: vi.fn(), save: vi.fn(), reserve: vi.fn(), settle: vi.fn(), refund: vi.fn(), project: vi.fn() }))
vi.mock('@/lib/services/icon-generator', () => ({ generateIcon: mocks.generate, generateIconVariations: mocks.variations }))
vi.mock('@/lib/services/icon-records', () => ({ saveIconRecord: mocks.save }))
vi.mock('@/lib/org/context', () => ({ getProjectContext: mocks.project, hasContextPermission: () => true }))
vi.mock('@/lib/api/usage', () => ({ reserveUsage: mocks.reserve, settleUsage: mocks.settle, refundUsage: mocks.refund }))
vi.mock('@/lib/org/audit', () => ({ logAuditEvent: vi.fn(), AuditAction: { ICON_GENERATED:'icon_generated' } }))
import { generateIcon, generateIconVariations } from '@/lib/mcp/tools/generate-icon'
import type { AccountContext } from '@/lib/org/context'
const context = { userId:'user-1', type:'personal' } as AccountContext
const icon = () => ({ success:true, originalUrl:'https://images.test/original.png', ios:'ios.png', android:'android.png' })
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv('ICON_ENGINE','openai')
  mocks.project.mockResolvedValue({ type:'personal' })
  mocks.reserve.mockResolvedValue({ allowed:true, replayed:false })
  mocks.generate.mockResolvedValue(icon()); mocks.save.mockResolvedValue('saved-id')
  mocks.variations.mockImplementation(async () => [0,1,2,3].map(i => ({ style:'liquid-glass', icon:{ ...icon(), originalUrl:`https://images.test/${i}.png` } })))
})
afterEach(() => vi.unstubAllEnvs())
describe('MCP icon persistence and ledger', () => {
  it('saves a personal icon before settling and charges OpenAI 1K credits', async () => {
    expect((await generateIcon({ projectId:'p', source:{ type:'prompt', prompt:'a silver mountain' } },context)).success).toBe(true)
    expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ success:true }),expect.objectContaining({ userId:'user-1', projectId:'p' }))
    expect(mocks.reserve).toHaveBeenCalledWith(context,expect.objectContaining({ units:3, metadata:expect.objectContaining({ model:'gpt-image-2.5-flare' }) }))
    expect(mocks.save.mock.invocationCallOrder[0]).toBeLessThan(mocks.settle.mock.invocationCallOrder[0])
  })
  it('saves to the authorized organization context', async () => {
    mocks.project.mockResolvedValue({ type:'organization', orgId:'org-1' })
    await generateIcon({ projectId:'p', source:{ type:'prompt', prompt:'a silver mountain' } },context)
    expect(mocks.save).toHaveBeenCalledWith(expect.anything(),expect.objectContaining({ orgId:'org-1', userId:'user-1' }))
  })
  it('returns persisted IDs for variations and settles only saved successes', async () => {
    mocks.save.mockRejectedValueOnce(new Error('write failed')).mockResolvedValue('saved-id')
    const result = await generateIconVariations({ projectId:'p',prompt:'a silver mountain' },context)
    expect(result.stats).toEqual({ total:4,success:3,failed:1 })
    expect(mocks.settle).toHaveBeenCalledWith(context,expect.any(String),'icons',9)
    expect(result.variations?.[1]).toMatchObject({ id:'saved-id',success:true })
  })
  it('refunds a save failure and never settles an invisible single icon', async () => {
    mocks.save.mockRejectedValueOnce(new Error('write failed'))
    expect((await generateIcon({ projectId:'p',source:{ type:'prompt',prompt:'a silver mountain' } },context)).success).toBe(false)
    expect(mocks.refund).toHaveBeenCalledOnce(); expect(mocks.settle).not.toHaveBeenCalled()
  })
  it('never generates again on a replayed reservation', async () => {
    mocks.reserve.mockResolvedValue({ allowed:true,replayed:true })
    await generateIconVariations({ projectId:'p',prompt:'a silver mountain' },context)
    expect(mocks.variations).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled()
  })
})
