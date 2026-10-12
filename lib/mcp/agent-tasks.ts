import { createHash, randomUUID } from 'crypto'
import { Timestamp } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { sanitizeMCPPublicOutput } from '@/lib/mcp/public-output'

export type AgentTaskStatus =
  | 'working'
  | 'input_required'
  | 'completed'
  | 'failed'
  | 'cancelled'

export interface AgentTaskApproval {
  required: boolean
  approvedAt?: Timestamp
  approvedBy?: string
  approvalHash?: string
  approvalUrl?: string
  preview?: unknown
  previewHash?: string
}

export interface AgentTaskProof {
  version: 1
  taskId: string
  toolName: string
  projectId?: string
  inputHash: string
  outputHash: string
  completedAt: string
  approvalHash?: string
  previewHash?: string
  digest: string
}

export interface AgentTaskRecord {
  taskId: string
  userId: string
  projectId?: string
  toolName: string
  arguments: Record<string, unknown>
  requestHash: string
  inputHash: string
  idempotencyKey?: string
  status: AgentTaskStatus
  statusMessage?: string
  ttl: number | null
  pollInterval: number
  approval: AgentTaskApproval
  result?: unknown
  error?: { code: number; message: string; fingerprint?: string }
  proof?: AgentTaskProof
  executionStartedAt?: Timestamp
  executionLeaseUntil?: Timestamp
  createdAt: Timestamp
  lastUpdatedAt: Timestamp
  expiresAt?: Timestamp
}

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000
const MAX_TTL_MS = 7 * 24 * 60 * 60 * 1000
const DEFAULT_POLL_INTERVAL_MS = 2_000

function stableStringify(value: unknown): string {
  if (value === undefined) return 'null'
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`

  const record = value as Record<string, unknown>
  return `{${Object.keys(record)
    .filter(key => record[key] !== undefined)
    .sort()
    .map(key => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(',')}}`
}

function firestoreSafe(value: unknown): unknown {
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol') return null
  if (value === null || typeof value !== 'object') return value
  if (value instanceof Date) return value.toISOString()
  if (value instanceof Timestamp) return value
  if (Array.isArray(value)) return value.map(firestoreSafe)

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined && typeof entry !== 'function' && typeof entry !== 'symbol')
      .map(([key, entry]) => [key, firestoreSafe(entry)])
  )
}

export function hashAgentTaskValue(value: unknown): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex')
}

function taskCollection(userId: string) {
  return adminDb.collection('users').doc(userId).collection('agentTasks')
}

function clampTtl(ttl?: unknown): number {
  if (typeof ttl !== 'number' || !Number.isFinite(ttl) || ttl <= 0) return DEFAULT_TTL_MS
  return Math.min(Math.floor(ttl), MAX_TTL_MS)
}

function publicTask(record: AgentTaskRecord) {
  return {
    taskId: record.taskId,
    status: record.status,
    ...(record.statusMessage ? { statusMessage: record.statusMessage } : {}),
    createdAt: record.createdAt.toDate().toISOString(),
    lastUpdatedAt: record.lastUpdatedAt.toDate().toISOString(),
    ttl: record.ttl,
    pollInterval: record.pollInterval,
  }
}

export function serializeAgentTask(record: AgentTaskRecord) {
  return publicTask(record)
}

export async function createAgentTask(input: {
  userId: string
  toolName: string
  arguments: Record<string, unknown>
  ttl?: unknown
  idempotencyKey?: string
  approvalRequired: boolean
}): Promise<{ task: AgentTaskRecord; replayed: boolean }> {
  const inputHash = hashAgentTaskValue({ toolName: input.toolName, arguments: input.arguments })
  const normalizedIdempotencyKey = input.idempotencyKey?.trim().slice(0, 200)
  const taskId = normalizedIdempotencyKey
    ? `task_${hashAgentTaskValue({ userId: input.userId, key: normalizedIdempotencyKey }).slice(0, 40)}`
    : `task_${randomUUID()}`
  const taskRef = taskCollection(input.userId).doc(taskId)
  const existing = await taskRef.get()

  if (existing.exists) {
    const task = existing.data() as AgentTaskRecord
    if ((task.requestHash || task.inputHash) !== inputHash || task.toolName !== input.toolName) {
      throw new Error('Idempotency key was already used with different task input')
    }
    return { task, replayed: true }
  }

  const ttl = clampTtl(input.ttl)
  const now = Timestamp.now()
  const task: AgentTaskRecord = {
    taskId,
    userId: input.userId,
    ...(typeof input.arguments.projectId === 'string'
      ? { projectId: input.arguments.projectId }
      : {}),
    toolName: input.toolName,
    arguments: input.arguments,
    requestHash: inputHash,
    inputHash,
    ...(normalizedIdempotencyKey ? { idempotencyKey: normalizedIdempotencyKey } : {}),
    status: 'working',
    statusMessage: input.approvalRequired
      ? 'Preparing a preview for human approval.'
      : 'The operation is in progress.',
    ttl,
    pollInterval: DEFAULT_POLL_INTERVAL_MS,
    approval: { required: input.approvalRequired },
    createdAt: now,
    lastUpdatedAt: now,
    expiresAt: Timestamp.fromMillis(now.toMillis() + ttl),
  }

  try {
    await taskRef.create(task)
    return { task, replayed: false }
  } catch (error) {
    // A concurrent retry can win between the read and create. Re-read the
    // deterministic document and return it only when the inputs still match.
    if (!normalizedIdempotencyKey) throw error
    const raced = await taskRef.get()
    if (!raced.exists) throw error
    const existingTask = raced.data() as AgentTaskRecord
    if ((existingTask.requestHash || existingTask.inputHash) !== inputHash || existingTask.toolName !== input.toolName) throw error
    return { task: existingTask, replayed: true }
  }
}

export async function getAgentTask(userId: string, taskId: string): Promise<AgentTaskRecord | null> {
  const doc = await taskCollection(userId).doc(taskId).get()
  if (!doc.exists) return null
  return doc.data() as AgentTaskRecord
}

export async function listAgentTasks(
  userId: string,
  cursor?: string,
  pageSize = 25
): Promise<{ tasks: AgentTaskRecord[]; nextCursor?: string }> {
  let query: FirebaseFirestore.Query = taskCollection(userId)
    .orderBy('createdAt', 'desc')
    .limit(Math.min(Math.max(pageSize, 1), 50) + 1)

  if (cursor) {
    const cursorDoc = await taskCollection(userId).doc(cursor).get()
    if (cursorDoc.exists) query = query.startAfter(cursorDoc)
  }

  const snapshot = await query.get()
  const docs = snapshot.docs.slice(0, pageSize)
  return {
    tasks: docs.map(doc => doc.data() as AgentTaskRecord),
    ...(snapshot.docs.length > pageSize && docs.length > 0
      ? { nextCursor: docs[docs.length - 1].id }
      : {}),
  }
}

export async function updateAgentTask(
  userId: string,
  taskId: string,
  update: Partial<AgentTaskRecord>
): Promise<AgentTaskRecord> {
  const ref = taskCollection(userId).doc(taskId)
  await ref.update({ ...update, lastUpdatedAt: Timestamp.now() })
  const refreshed = await ref.get()
  if (!refreshed.exists) throw new Error('Task not found')
  return refreshed.data() as AgentTaskRecord
}

export async function cancelAgentTask(userId: string, taskId: string): Promise<AgentTaskRecord> {
  const task = await getAgentTask(userId, taskId)
  if (!task) throw new Error('Task not found')
  if (['completed', 'failed', 'cancelled'].includes(task.status)) {
    throw new Error('Cannot cancel a task in a terminal state')
  }
  return updateAgentTask(userId, taskId, {
    status: 'cancelled',
    statusMessage: 'The task was cancelled by request.',
  })
}

export async function approveAgentTask(
  userId: string,
  taskId: string,
  approvedByUserId: string
): Promise<AgentTaskRecord> {
  const task = await getAgentTask(userId, taskId)
  if (!task) throw new Error('Task not found')
  if (!task.approval.required || task.status !== 'input_required') {
    throw new Error('Task is not waiting for approval')
  }

  const approvedAt = Timestamp.now()
  const approvalHash = hashAgentTaskValue({
    taskId,
    inputHash: task.inputHash,
    approvedBy: approvedByUserId,
    approvedAt: approvedAt.toDate().toISOString(),
    previewHash: task.approval.previewHash,
  })
  return updateAgentTask(userId, taskId, {
    status: 'working',
    statusMessage: 'Approved. The operation is in progress.',
    approval: {
      ...task.approval,
      approvedAt,
      approvedBy: approvedByUserId,
      approvalHash,
    },
  })
}

export async function claimAgentTaskExecution(
  userId: string,
  taskId: string
): Promise<{ claimed: boolean; task: AgentTaskRecord }> {
  const ref = taskCollection(userId).doc(taskId)
  return adminDb.runTransaction(async transaction => {
    const snapshot = await transaction.get(ref)
    if (!snapshot.exists) throw new Error('Task not found')
    const task = snapshot.data() as AgentTaskRecord
    if (['completed', 'failed', 'cancelled'].includes(task.status)) return { claimed: false, task }
    if (task.approval.required && !task.approval.approvedAt) return { claimed: false, task }

    const now = Timestamp.now()
    if (task.executionLeaseUntil && task.executionLeaseUntil.toMillis() > now.toMillis()) {
      return { claimed: false, task }
    }
    const update = {
      status: 'working' as const,
      statusMessage: 'The operation is in progress.',
      executionStartedAt: now,
      executionLeaseUntil: Timestamp.fromMillis(now.toMillis() + 15 * 60 * 1000),
      lastUpdatedAt: now,
    }
    transaction.update(ref, update)
    return { claimed: true, task: { ...task, ...update } }
  })
}

export async function completeAgentTask(
  userId: string,
  taskId: string,
  result: unknown
): Promise<AgentTaskRecord> {
  const task = await getAgentTask(userId, taskId)
  if (!task) throw new Error('Task not found')
  if (task.status === 'cancelled') return task

  const completedAt = new Date().toISOString()
  const safeResult = firestoreSafe(sanitizeMCPPublicOutput(result))
  const outputHash = hashAgentTaskValue(safeResult)
  const proofWithoutDigest = {
    version: 1 as const,
    taskId,
    toolName: task.toolName,
    ...(task.projectId ? { projectId: task.projectId } : {}),
    inputHash: task.inputHash,
    outputHash,
    completedAt,
    ...(task.approval.approvalHash
      ? { approvalHash: task.approval.approvalHash }
      : {}),
    ...(task.approval.previewHash
      ? { previewHash: task.approval.previewHash }
      : {}),
  }
  const proof: AgentTaskProof = {
    ...proofWithoutDigest,
    digest: hashAgentTaskValue(proofWithoutDigest),
  }

  return updateAgentTask(userId, taskId, {
    status: 'completed',
    statusMessage: 'The operation completed successfully.',
    result: safeResult,
    proof,
  })
}

export async function failAgentTask(
  userId: string,
  taskId: string,
  _error: unknown
): Promise<AgentTaskRecord> {
  const task = await getAgentTask(userId, taskId)
  if (!task) throw new Error('Task not found')
  if (task.status === 'cancelled') return task

  // Provider errors can contain signed URLs, identifiers, or reflected input.
  // Keep the durable user-facing record generic rather than persisting them.
  const publicMessage = 'The operation failed. Review account configuration and retry.'
  const fingerprint = hashAgentTaskValue({
    name: _error instanceof Error ? _error.name : typeof _error,
    message: _error instanceof Error ? _error.message : String(_error),
  }).slice(0, 20)
  return updateAgentTask(userId, taskId, {
    status: 'failed',
    statusMessage: publicMessage,
    error: {
      code: -32603,
      message: publicMessage,
      fingerprint,
    },
  })
}
