import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SANDBOX_STRIPE_ACCOUNT_ID } from '@/lib/stripe/config'
import type { AccountContext } from '@/lib/org/context'
import { CLAUDE_EXCLUDED_TOOLS } from '@/lib/mcp/connector-profile'
const mocks = vi.hoisted(() => ({ create: vi.fn(), get: vi.fn(), list: vi.fn(), cancel: vi.fn(), claim: vi.fn(), internal: vi.fn() }))
vi.mock('@/lib/mcp/agent-tasks', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/mcp/agent-tasks')>(),
  serializeAgentTask: (task: { taskId: string; toolName: string }) => ({ taskId: task.taskId, toolName: task.toolName }),
  createAgentTask: mocks.create, getAgentTask: mocks.get, listAgentTasks: mocks.list, cancelAgentTask: mocks.cancel, claimAgentTaskExecution: mocks.claim,
}))
vi.mock('@/lib/features/internal-integrations', async importOriginal => ({
  ...await importOriginal<Record<string, unknown>>(), hasInternalIntegrationAccess: mocks.internal,
}))
import { handleMCPRequest, executeAgentTaskOperation } from '@/lib/mcp/server'
// Paid Stripe entitlement so tool calls pass the hard paywall (sandbox binding stubbed below).
const context = { type: 'personal', userId: 'profile-user', user: { email: 'profile@example.com', plan: 'pro', billing: { source: 'stripe', status: 'active', plan: 'pro', subscriptionId: 'sub_profile00001', livemode: false, providerAccountId: SANDBOX_STRIPE_ACCOUNT_ID } } } as AccountContext
const access = { connectorProfile: 'claude' as const }
const call = (method: string, params: Record<string, unknown> = {}, options = access) => handleMCPRequest({ jsonrpc: '2.0', id: 1, method, params }, context, 'project-a', options)
const task = (toolName: string, projectId = 'project-a') => ({ taskId: 'task-a', toolName, projectId, arguments: { projectId }, status: 'completed', result: { privateMarker: 'excluded-result' }, approval: { required: false } })
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('STRIPE_ACCOUNT_ID', SANDBOX_STRIPE_ACCOUNT_ID)
  vi.stubEnv('STRIPE_LIVEMODE', 'false')
})
describe('explicit Claude connector boundary', () => {
  it('lists44/40 tools while default retains55/51', async () => {
    for (const [profile, locked, count] of [['claude', false, 44], ['claude', true, 40], [undefined, false, 55], [undefined, true, 51]] as const) {
      const response = await handleMCPRequest({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, context, 'project-a', { connectorProfile: profile, projectScopeLocked: locked })
      expect((response.response.result as any).tools).toHaveLength(count)
    }
  })
  it('does not let internal accounts bypass the declared catalog', async () => {
    mocks.internal.mockReturnValue(true)
    expect(((await call('tools/list')).response.result as any).tools).toHaveLength(44)
    expect((await call('tools/call', { name: 'whop_create_checkout', arguments: {} })).response.error?.code).toBe(-32601)
    mocks.internal.mockReturnValue(false)
  })
  it.each([...CLAUDE_EXCLUDED_TOOLS])('rejects direct and task invocation of %s before any work', async name => {
    for (const params of [{ name, arguments: {} }, { name, arguments: {}, task: {} }]) {
      expect((await call('tools/call', params)).response.error?.code).toBe(-32601)
    }
    expect(mocks.claim).not.toHaveBeenCalled()
  })
  it.each(['tasks/get', 'tasks/cancel', 'tasks/result'])('blocks stored generation through %s before dispatch or disclosure', async method => {
    mocks.get.mockResolvedValue(task('generate_icon'))
    const result = await call(method, { taskId: 'task-a' })
    expect(result.response.error?.message).toBe('Task not found')
    expect(JSON.stringify(result)).not.toContain('excluded-result')
    expect(mocks.cancel).not.toHaveBeenCalled()
    expect(mocks.claim).not.toHaveBeenCalled()
  })
  it('filters stored task lists and guards deferred execution', async () => {
    mocks.list.mockResolvedValue({ tasks: [task('generate_icon'), task('update_metadata')], nextCursor: 'next' })
    const result = await call('tasks/list')
    expect((result.response.result as any).tasks).toHaveLength(1)
    mocks.get.mockResolvedValue(task('generate_icon'))
    await expect(executeAgentTaskOperation('task-a', context, access)).rejects.toThrow('Task not found')
    expect(mocks.claim).not.toHaveBeenCalled()
  })
  it('blocks foreign project tasks even when their tool is retained', async () => {
    mocks.get.mockResolvedValue(task('update_metadata', 'project-b'))
    const result = await handleMCPRequest({ jsonrpc: '2.0', id: 1, method: 'tasks/result', params: { taskId: 'task-a' } }, context, 'project-a', { ...access, projectScopeLocked: true })
    expect(result.response.error?.message).toBe('Task not found')
    expect(mocks.claim).not.toHaveBeenCalled()
  })
  it('does not disclose an excluded task returned by idempotency replay', async () => {
    mocks.create.mockResolvedValue({ task: task('generate_icon'), replayed: true })
    const result = await call('tools/call', { name: 'update_metadata', arguments: { store: 'appstore', locale: 'en-US', metadata: { subtitle: 'Draft' } }, task: {} })
    expect(result.response.error?.message).toBe('Task not found')
    expect(result.deferredWork).toBeUndefined()
  })
  it('applies read-only policy to retained stored write tasks', async () => {
    mocks.get.mockResolvedValue(task('update_metadata'))
    const readOnly = { ...context, user: { ...context.user, agentOnboarding: { policy: { mode: 'read_only' } } } } as AccountContext
    const result = await handleMCPRequest({ jsonrpc: '2.0', id: 1, method: 'tasks/result', params: { taskId: 'task-a' } }, readOnly, 'project-a', access)
    expect(result.response.error?.message).toBe('Task not found')
    expect(mocks.claim).not.toHaveBeenCalled()
  })
  it('preserves default completed-generation task readback', async () => {
    mocks.get.mockResolvedValue(task('generate_icon'))
    const result = await handleMCPRequest({ jsonrpc: '2.0', id: 1, method: 'tasks/result', params: { taskId: 'task-a' } }, context)
    expect((result.response.result as any).structuredContent.privateMarker).toBe('excluded-result')
    expect(mocks.claim).not.toHaveBeenCalled()
  })
  it('keeps both existing-asset resources and rejects unknown resources', async () => {
    expect(((await call('resources/list')).response.result as any).resources).toHaveLength(2)
    expect((await call('resources/read', { uri: 'ui://internal/generation' })).response.error?.code).toBe(-32602)
  })
})
