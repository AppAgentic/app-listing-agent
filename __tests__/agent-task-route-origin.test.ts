import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getAgentTask: vi.fn(),
  cancelAgentTask: vi.fn(),
}))

vi.mock('@/lib/auth/session', () => ({ getSession: mocks.getSession }))
vi.mock('@/lib/org/context', () => ({ getAccountContext: vi.fn() }))
vi.mock('@/lib/mcp/server', () => ({ executeAgentTaskOperation: vi.fn() }))
vi.mock('@/lib/mcp/agent-tasks', () => ({
  approveAgentTask: vi.fn(),
  cancelAgentTask: mocks.cancelAgentTask,
  getAgentTask: mocks.getAgentTask,
  serializeAgentTask: (task: { id: string }) => ({ id: task.id }),
}))

import { DELETE, POST } from '@/app/api/agent-tasks/[taskId]/route'

const params = { params: Promise.resolve({ taskId: 'task_1' }) }

// The URL Cloud Run hands to Next, not the public host.
function internalRequest(method: string, origin?: string) {
  return new NextRequest('http://0.0.0.0:8080/api/agent-tasks/task_1', {
    method,
    headers: origin ? { origin } : {},
  })
}

describe('agent task approval route origin check', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://applistingagent.com')
    mocks.getSession.mockResolvedValue({ userId: 'owner' })
    mocks.getAgentTask.mockResolvedValue({ id: 'task_1' })
    mocks.cancelAgentTask.mockResolvedValue({ id: 'task_1' })
  })

  it('lets the owner cancel from the public origin even though nextUrl is internal', async () => {
    const response = await DELETE(internalRequest('DELETE', 'https://applistingagent.com'), params)
    expect(response.status).toBe(200)
    expect(mocks.cancelAgentTask).toHaveBeenCalledWith('owner', 'task_1')
  })

  it('refuses foreign and missing origins before touching the task', async () => {
    for (const [method, handler] of [['POST', POST], ['DELETE', DELETE]] as const) {
      for (const origin of ['https://evil.example', undefined]) {
        const response = await handler(internalRequest(method, origin), params)
        expect(response.status).toBe(403)
        expect(await response.json()).toEqual({ error: 'Invalid origin' })
      }
    }
    expect(mocks.getSession).not.toHaveBeenCalled()
  })
})
