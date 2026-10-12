import { beforeEach, describe, expect, it, vi } from 'vitest'

const taskStore = vi.hoisted(() => new Map<string, Record<string, unknown>>())

vi.mock('@/lib/firebase/admin', () => {
  class Snapshot {
    constructor(readonly id: string, private value?: Record<string, unknown>) {}
    get exists() { return this.value !== undefined }
    data() { return this.value }
  }

  class DocumentRef {
    constructor(readonly path: string) {}
    get id() { return this.path.slice(this.path.lastIndexOf('/') + 1) }
    collection(name: string) { return new CollectionRef(`${this.path}/${name}`) }
    async get() { return new Snapshot(this.id, taskStore.get(this.path)) }
    async create(value: Record<string, unknown>) {
      if (taskStore.has(this.path)) throw new Error('Already exists')
      taskStore.set(this.path, value)
    }
    async update(value: Record<string, unknown>) {
      const current = taskStore.get(this.path)
      if (!current) throw new Error('Not found')
      taskStore.set(this.path, { ...current, ...value })
    }
  }

  class CollectionRef {
    constructor(readonly path: string) {}
    doc(id: string) { return new DocumentRef(`${this.path}/${id}`) }
  }

  return {
    adminDb: {
      collection: (name: string) => new CollectionRef(name),
      runTransaction: async (callback: (transaction: {
        get: (ref: DocumentRef) => Promise<Snapshot>
        update: (ref: DocumentRef, value: Record<string, unknown>) => void
      }) => Promise<unknown>) => callback({
        get: ref => ref.get(),
        update: (ref, value) => {
          const current = taskStore.get(ref.path)
          if (!current) throw new Error('Not found')
          taskStore.set(ref.path, { ...current, ...value })
        },
      }),
    },
  }
})

import {
  approveAgentTask,
  cancelAgentTask,
  claimAgentTaskExecution,
  completeAgentTask,
  createAgentTask,
  failAgentTask,
  getAgentTask,
  hashAgentTaskValue,
  updateAgentTask,
} from '@/lib/mcp/agent-tasks'

describe('durable agent tasks', () => {
  beforeEach(() => taskStore.clear())

  it('hashes semantically identical input consistently', () => {
    expect(hashAgentTaskValue({ b: 2, a: 1 })).toBe(hashAgentTaskValue({ a: 1, b: 2 }))
  })

  it('replays the same idempotent request and rejects changed input', async () => {
    const input = {
      userId: 'user-one',
      toolName: 'translate_metadata',
      arguments: { projectId: 'project-one', locale: 'fr-FR' },
      idempotencyKey: 'request-123',
      approvalRequired: false,
    }
    const first = await createAgentTask(input)
    const replay = await createAgentTask(input)

    expect(first.replayed).toBe(false)
    expect(replay.replayed).toBe(true)
    expect(replay.task.taskId).toBe(first.task.taskId)

    await expect(createAgentTask({
      ...input,
      arguments: { projectId: 'project-one', locale: 'de-DE' },
    })).rejects.toThrow('different task input')
  })

  it('locks approval to the task input and emits a completion proof', async () => {
    const { task } = await createAgentTask({
      userId: 'user-one',
      toolName: 'upload_appstore_metadata',
      arguments: { projectId: 'project-one', locales: ['fr-FR'], dryRun: false },
      idempotencyKey: 'publish-123',
      approvalRequired: true,
    })
    await updateAgentTask('user-one', task.taskId, {
      status: 'input_required',
      approval: { required: true, preview: { locales: ['fr-FR'] } },
    })
    const approved = await approveAgentTask('user-one', task.taskId, 'user-one')
    const completed = await completeAgentTask('user-one', task.taskId, {
      success: true,
      omittedByProvider: undefined,
    })

    expect(approved.approval.approvalHash).toHaveLength(64)
    expect(approved.approval.approvedBy).toBe('user-one')
    expect(completed.status).toBe('completed')
    expect(completed.proof).toMatchObject({
      taskId: task.taskId,
      toolName: 'upload_appstore_metadata',
      inputHash: task.inputHash,
      approvalHash: approved.approval.approvalHash,
    })
    expect(completed.proof?.outputHash).toHaveLength(64)
    expect(completed.proof?.digest).toHaveLength(64)
    expect(completed.result).toEqual({ success: true })
  })

  it('does not persist raw provider errors in durable task records', async () => {
    const { task } = await createAgentTask({
      userId: 'user-one',
      toolName: 'translate_metadata',
      arguments: { projectId: 'project-one' },
      approvalRequired: false,
    })
    const failed = await failAgentTask(
      'user-one',
      task.taskId,
      new Error('Bearer secret-token appeared in a provider URL')
    )

    expect(failed.error?.message).toBe('The operation failed. Review account configuration and retry.')
    expect(failed.error?.fingerprint).toHaveLength(20)
    expect(JSON.stringify(failed)).not.toContain('secret-token')
  })

  it('never lets a cancelled task become completed', async () => {
    const { task } = await createAgentTask({
      userId: 'user-one',
      toolName: 'translate_metadata',
      arguments: { projectId: 'project-one' },
      approvalRequired: false,
    })
    await cancelAgentTask('user-one', task.taskId)
    await completeAgentTask('user-one', task.taskId, { success: true })

    expect((await getAgentTask('user-one', task.taskId))?.status).toBe('cancelled')
  })

  it('leases execution so duplicate workers cannot run the same task', async () => {
    const { task } = await createAgentTask({
      userId: 'user-one',
      toolName: 'translate_metadata',
      arguments: { projectId: 'project-one' },
      approvalRequired: false,
    })
    const first = await claimAgentTaskExecution('user-one', task.taskId)
    const duplicate = await claimAgentTaskExecution('user-one', task.taskId)

    expect(first.claimed).toBe(true)
    expect(duplicate.claimed).toBe(false)
  })
})
