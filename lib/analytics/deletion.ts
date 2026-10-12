import { createHash } from 'crypto'
import { UUID_PATTERN } from './events'
import { UID_PATTERN, logAnalyticsFailure, type AccessToken, type AnalyticsConfig } from './ingest'

/**
 * Account-deletion cleanup of analytics rows: the account's `user_id` rows plus the rows of every browser
 * visitor id that was ever linked to it. BigQuery rejects DML on rows still in the streaming buffer
 * (~30-90 min after insert), so this is a durable, retrying job (Firestore `analyticsDeletions/{sha256}`).
 * Nothing here logs uids, visitor ids, SQL parameters or payloads.
 */

export type QueryParameter =
  | { name: string; type: 'STRING'; value: string }
  | { name: string; type: 'ARRAY<STRING>'; values: string[] }
/** Runs one parameterized GoogleSQL statement. SQL text never contains user data. */
export type AnalyticsQuery = (sql: string, parameters: QueryParameter[]) => Promise<{ rows: (string | null)[][]; affectedRows: number }>
export class StreamingBufferError extends Error { constructor() { super('BIGQUERY_STREAMING_BUFFER') } }

export const MAX_LINKED_VISITORS = 1000

function tableRef(config: AnalyticsConfig) {
  // Identifiers come from validated configuration (analyticsConfig), never from a request.
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(config.projectId) || !/^[a-z][a-z0-9_]{0,63}$/.test(config.dataset) || !/^[a-z][a-z0-9_]{0,63}$/.test(config.table)) {
    throw new Error('INVALID_ANALYTICS_CONFIG')
  }
  return `\`${config.projectId}.${config.dataset}.${config.table}\``
}

/** Throws StreamingBufferError while recently streamed rows block DML (retry later). */
export async function deleteUserAnalytics(query: AnalyticsQuery, config: AnalyticsConfig, uid: string) {
  if (!UID_PATTERN.test(uid)) throw new Error('INVALID_UID')
  const table = tableRef(config)
  const linked = await query(
    `SELECT DISTINCT visitor_id FROM ${table} WHERE user_id = @uid AND visitor_id IS NOT NULL LIMIT ${MAX_LINKED_VISITORS}`,
    [{ name: 'uid', type: 'STRING', value: uid }],
  )
  const visitors = linked.rows.map(row => row[0]).filter((id): id is string => typeof id === 'string' && UUID_PATTERN.test(id))
  const result = await query(`DELETE FROM ${table} WHERE user_id = @uid OR visitor_id IN UNNEST(@visitor_ids)`, [
    { name: 'uid', type: 'STRING', value: uid },
    { name: 'visitor_ids', type: 'ARRAY<STRING>', values: visitors },
  ])
  return { visitors: visitors.length, deletedRows: result.affectedRows }
}

export interface AnalyticsDeletionClaim { id: string; uid: string; attempts: number }
export interface AnalyticsDeletionStore {
  /** Idempotent: creates or reopens the pending job for this uid, due immediately. */
  enqueue(uid: string, now: number): Promise<void>
  due(now: number, limit: number): Promise<string[]>
  /** Leases a due pending job (nextAttemptAt = now + leaseMs, attempts + 1); null if not due or done. */
  claim(id: string, now: number, leaseMs: number): Promise<AnalyticsDeletionClaim | null>
  /** Marks done and drops the uid from the job document. */
  complete(id: string, now: number, result: { deletedRows: number; visitors: number }): Promise<void>
  retry(id: string, now: number, nextAttemptAt: number, code: string): Promise<void>
}
export const analyticsDeletionId = (uid: string) => createHash('sha256').update(`analytics-deletion-v1:${uid}`).digest('hex')

export function deletionRetryDelay(attempts: number, streamingBuffer: boolean) {
  // Streamed rows usually leave the buffer within ~30-90 minutes; other failures back off to six hours.
  if (streamingBuffer) return 20 * 60_000
  return Math.min(6 * 60 * 60_000, 5 * 60_000 * 2 ** Math.min(Math.max(attempts - 1, 0), 7))
}

/** Processes due deletion jobs. Retries forever on failure; never throws. */
export async function processAnalyticsDeletions(deps: {
  store: AnalyticsDeletionStore
  query: AnalyticsQuery
  config: AnalyticsConfig
  now?: () => number
  limit?: number
}) {
  const clock = deps.now ?? Date.now
  const counts: { due: number; completed: number; retried: number; error?: string } = { due: 0, completed: 0, retried: 0 }
  let ids: string[]
  try {
    ids = await deps.store.due(clock(), deps.limit ?? 5)
  } catch (error) {
    logAnalyticsFailure('deletion', error)
    return { ...counts, error: 'DELETION_QUEUE_UNAVAILABLE' }
  }
  for (const id of ids) {
    let claim: AnalyticsDeletionClaim | null = null
    try {
      claim = await deps.store.claim(id, clock(), 10 * 60_000)
      if (!claim) continue
      counts.due++
      const result = await deleteUserAnalytics(deps.query, deps.config, claim.uid)
      await deps.store.complete(id, clock(), result)
      counts.completed++
    } catch (error) {
      if (!claim) { logAnalyticsFailure('deletion', error); continue }
      const buffered = error instanceof StreamingBufferError
      const code = buffered
        ? 'BIGQUERY_STREAMING_BUFFER'
        : error instanceof Error ? error.message.replace(/[^A-Z0-9_]/gi, '').slice(0, 60) || 'UNKNOWN' : 'UNKNOWN'
      logAnalyticsFailure('deletion', new Error(code))
      await deps.store.retry(id, clock(), clock() + deletionRetryDelay(claim.attempts, buffered), code).catch(() => {})
      counts.retried++
    }
  }
  return counts
}

type Job = { state: 'pending' | 'done'; uid?: string; nextAttemptAt?: number; attempts: number; lastError?: string; deletedRows?: number }
export class MemoryAnalyticsDeletionStore implements AnalyticsDeletionStore {
  jobs = new Map<string, Job>()
  async enqueue(uid: string, now: number) {
    if (!UID_PATTERN.test(uid)) throw new Error('INVALID_UID')
    const id = analyticsDeletionId(uid)
    const old = this.jobs.get(id)
    this.jobs.set(id, { state: 'pending', uid, nextAttemptAt: now, attempts: old?.attempts ?? 0 })
  }
  async due(now: number, limit: number) {
    return [...this.jobs]
      .filter(([, job]) => job.state === 'pending' && (job.nextAttemptAt ?? Infinity) <= now)
      .sort((a, b) => a[1].nextAttemptAt! - b[1].nextAttemptAt!)
      .slice(0, limit)
      .map(([id]) => id)
  }
  async claim(id: string, now: number, leaseMs: number) {
    const job = this.jobs.get(id)
    if (!job || job.state !== 'pending' || !job.uid || (job.nextAttemptAt ?? Infinity) > now) return null
    job.nextAttemptAt = now + leaseMs
    job.attempts++
    return { id, uid: job.uid, attempts: job.attempts }
  }
  async complete(id: string, _now: number, result: { deletedRows: number }) {
    const job = this.jobs.get(id)!
    this.jobs.set(id, { state: 'done', attempts: job.attempts, deletedRows: result.deletedRows })
  }
  async retry(id: string, _now: number, nextAttemptAt: number, code: string) {
    const job = this.jobs.get(id)!
    job.nextAttemptAt = nextAttemptAt
    job.lastError = code
  }
}

// ----- BigQuery query runner -----

interface QueryResponse {
  jobComplete?: boolean
  jobReference?: { jobId?: string; location?: string }
  rows?: { f: { v: string | null }[] }[]
  numDmlAffectedRows?: string
  errors?: { message?: string }[]
  error?: { message?: string }
}

const streamingBufferMessage = (message: unknown) => typeof message === 'string' && /streaming buffer/i.test(message)

/** jobs.query with named parameters, polling getQueryResults until complete (bounded). */
export function bigQueryQuery(
  config: AnalyticsConfig,
  token: AccessToken,
  options: { pollMs?: number; deadlineMs?: number; fetchImpl?: typeof fetch } = {},
): AnalyticsQuery {
  const http = options.fetchImpl ?? fetch
  return async (sql, parameters) => {
    const base = `https://bigquery.googleapis.com/bigquery/v2/projects/${config.projectId}`
    const queryParameters = parameters.map(p => p.type === 'STRING'
      ? { name: p.name, parameterType: { type: 'STRING' }, parameterValue: { value: p.value } }
      : { name: p.name, parameterType: { type: 'ARRAY', arrayType: { type: 'STRING' } }, parameterValue: { arrayValues: p.values.map(value => ({ value })) } })
    const deadline = Date.now() + (options.deadlineMs ?? 60_000)
    const call = async (url: string, init: RequestInit) => {
      const response = await http(url, {
        ...init,
        headers: { Authorization: `Bearer ${await token()}`, 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(30_000),
      })
      const data = await response.json().catch(() => ({})) as QueryResponse
      if (!response.ok) {
        if (streamingBufferMessage(data.error?.message)) throw new StreamingBufferError()
        throw new Error('BIGQUERY_QUERY_FAILED')
      }
      return data
    }
    let response: QueryResponse
    try {
      response = await call(`${base}/queries`, {
        method: 'POST',
        body: JSON.stringify({ query: sql, useLegacySql: false, parameterMode: 'NAMED', queryParameters, timeoutMs: 20_000, maxResults: MAX_LINKED_VISITORS }),
      })
      while (!response.jobComplete) {
        const job = response.jobReference
        if (!job?.jobId || Date.now() > deadline) throw new Error('BIGQUERY_QUERY_TIMEOUT')
        await new Promise(resolve => setTimeout(resolve, options.pollMs ?? 1000))
        const params = new URLSearchParams({ timeoutMs: '10000', maxResults: String(MAX_LINKED_VISITORS), ...(job.location ? { location: job.location } : {}) })
        response = await call(`${base}/queries/${encodeURIComponent(job.jobId)}?${params}`, { method: 'GET' })
      }
    } catch (error) {
      if (error instanceof StreamingBufferError) throw error
      if (error instanceof Error && /^BIGQUERY_[A-Z_]+$/.test(error.message)) throw error
      throw new Error('BIGQUERY_QUERY_FAILED')
    }
    if (response.errors?.length) {
      throw response.errors.some(e => streamingBufferMessage(e.message)) ? new StreamingBufferError() : new Error('BIGQUERY_QUERY_FAILED')
    }
    return {
      rows: (response.rows ?? []).map(row => row.f.map(cell => cell.v)),
      affectedRows: Number(response.numDmlAffectedRows ?? 0),
    }
  }
}
