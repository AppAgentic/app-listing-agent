import { Timestamp } from 'firebase-admin/firestore'
import { createHash } from 'crypto'
import { adminDb } from '@/lib/firebase/admin'

export type TranslationJobStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled'
export type ScreenshotTranslationMode = 'literal' | 'marketing_short' | 'transcreate' | 'ui_full'
export type ScreenshotTranslationProvider = 'kie' | 'fal' | 'openai'

export interface ScreenshotTextLengthPolicy {
  headlineMaxChars?: number
  subtitleMaxChars?: number
  allowLineBreaks?: boolean
  shrinkFontLimitPercent?: number
}

export type PerScreenshotTranslationInstruction = string | {
  headline?: string
  subtitle?: string
  instructions?: string
  headlineMaxChars?: number
  subtitleMaxChars?: number
}

export interface TranslationJobConfig {
  targetLocales: string[]
  displayTypes: string[] // Which device types to translate
  screenshotIds?: string[] // Optional: specific screenshots only (legacy - same for all locales)
  screenshotIdsByLocale?: Record<string, string[]> // Optional: per-locale filtering
  customPage?: {
    type: 'customProductPage'
    pageId: string
    sourceLocale: string
  }
  translateInAppText: boolean
  translationInstructions?: string
  translationMode?: ScreenshotTranslationMode
  textLengthPolicy?: ScreenshotTextLengthPolicy
  provider?: ScreenshotTranslationProvider
  model?: string
  preserveInPhoneUI?: boolean
  translateMarketingOnly?: boolean
  perScreenshotInstructions?: Record<string, PerScreenshotTranslationInstruction>
  instructionsHash?: string
  usageReservation?: {
    operationId: string
    usageType: 'screenshots'
    reservedUnits: number
    unitWeight: number
  }
}

export interface TranslationJobProgress {
  current: number
  total: number
  currentLocale?: string
  currentDisplayType?: string
}

export interface TranslationJobResult {
  locale: string
  displayType: string
  screenshotId: string
  success: boolean
  imageUrl?: string
  error?: string
  completedAt: Date | Timestamp
}

export interface TranslationJob {
  // Identity
  id: string
  userId: string
  orgId?: string
  projectId: string

  // Status
  status: TranslationJobStatus

  // Configuration
  config: TranslationJobConfig

  // Progress
  progress: TranslationJobProgress

  // Results (updated as tasks complete)
  results: TranslationJobResult[]

  // Timestamps
  createdAt: Date | Timestamp
  startedAt?: Date | Timestamp
  completedAt?: Date | Timestamp

  // Error handling
  error?: string
  retryCount: number
  lastRetryAt?: Date | Timestamp

  // For job resumption if it times out
  lastProcessedIndex?: number

  // Continuation chain tracking (for auto-continuation on timeout)
  continuationOf?: string    // Parent job ID this continues from
  continuedBy?: string       // Child job ID that continues this
  rootJobId?: string         // Original job in the chain
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value)
  }

  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`
  }

  const record = value as Record<string, unknown>
  const keys = Object.keys(record)
    .filter(key => record[key] !== undefined)
    .sort()

  return `{${keys.map(key => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`
}

export function getTranslationInstructionsHash(config: TranslationJobConfig): string | undefined {
  const instructionConfig = {
    translationInstructions: config.translationInstructions,
    translationMode: config.translationMode,
    textLengthPolicy: config.textLengthPolicy,
    provider: config.provider,
    model: config.model,
    preserveInPhoneUI: config.preserveInPhoneUI,
    translateMarketingOnly: config.translateMarketingOnly,
    perScreenshotInstructions: config.perScreenshotInstructions,
  }

  const hasInstructions = Object.values(instructionConfig).some(value => value !== undefined)
  if (!hasInstructions) return undefined

  return createHash('sha256')
    .update(stableStringify(instructionConfig))
    .digest('hex')
    .slice(0, 16)
}

// Create a new translation job
export async function createTranslationJob(params: {
  userId: string
  orgId?: string
  projectId: string
  config: TranslationJobConfig
}): Promise<TranslationJob> {
  const { userId, orgId, projectId, config } = params
  const instructionsHash = getTranslationInstructionsHash(config)
  const normalizedConfig: TranslationJobConfig = instructionsHash
    ? { ...config, instructionsHash }
    : config

  const jobRef = adminDb
    .collection('users')
    .doc(userId)
    .collection('translationJobs')
    .doc()

  const job: TranslationJob = {
    id: jobRef.id,
    userId,
    ...(orgId ? { orgId } : {}),
    projectId,
    status: 'pending',
    config: normalizedConfig,
    progress: {
      current: 0,
      total: 0,
    },
    results: [],
    createdAt: Timestamp.now(),
    retryCount: 0,
  }

  await jobRef.set(job)
  return job
}

// Get a translation job by ID
export async function getTranslationJob(
  userId: string,
  jobId: string
): Promise<TranslationJob | null> {
  const jobRef = adminDb
    .collection('users')
    .doc(userId)
    .collection('translationJobs')
    .doc(jobId)

  const doc = await jobRef.get()
  if (!doc.exists) return null

  return { id: doc.id, ...doc.data() } as TranslationJob
}

// Update job status
export async function updateJobStatus(
  userId: string,
  jobId: string,
  status: TranslationJobStatus,
  additionalData?: Partial<TranslationJob>
): Promise<void> {
  const jobRef = adminDb
    .collection('users')
    .doc(userId)
    .collection('translationJobs')
    .doc(jobId)

  const updateData: Record<string, any> = {
    status,
    ...additionalData,
  }

  if (status === 'processing' && !additionalData?.startedAt) {
    updateData.startedAt = Timestamp.now()
  }

  if (status === 'completed' || status === 'failed' || status === 'cancelled') {
    updateData.completedAt = Timestamp.now()
  }

  await jobRef.update(updateData)
}

// Update job progress and results
export async function updateJobProgress(
  userId: string,
  jobId: string,
  progress: TranslationJobProgress,
  newResults?: TranslationJobResult[]
): Promise<void> {
  const jobRef = adminDb
    .collection('users')
    .doc(userId)
    .collection('translationJobs')
    .doc(jobId)

  const updateData: Record<string, any> = { progress }

  if (newResults && newResults.length > 0) {
    // Use arrayUnion to append results without overwriting
    const { FieldValue } = await import('firebase-admin/firestore')
    updateData.results = FieldValue.arrayUnion(...newResults)
  }

  await jobRef.update(updateData)
}

// Cancel a job
export async function cancelJob(userId: string, jobId: string): Promise<boolean> {
  const job = await getTranslationJob(userId, jobId)
  if (!job) return false

  // Only cancel if pending or processing
  if (job.status !== 'pending' && job.status !== 'processing') {
    return false
  }

  await updateJobStatus(userId, jobId, 'cancelled')
  return true
}

// Get active jobs for a user
export async function getActiveJobs(userId: string): Promise<TranslationJob[]> {
  const snapshot = await adminDb
    .collection('users')
    .doc(userId)
    .collection('translationJobs')
    .where('status', 'in', ['pending', 'processing'])
    .orderBy('createdAt', 'desc')
    .limit(10)
    .get()

  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as TranslationJob))
}

// Get jobs for a specific project
export async function getProjectJobs(
  userId: string,
  projectId: string,
  limit = 10
): Promise<TranslationJob[]> {
  const snapshot = await adminDb
    .collection('users')
    .doc(userId)
    .collection('translationJobs')
    .where('projectId', '==', projectId)
    .orderBy('createdAt', 'desc')
    .limit(limit)
    .get()

  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as TranslationJob))
}

// Check if there's an active translation job for a project
export async function hasActiveTranslationJob(
  userId: string,
  projectId: string
): Promise<{ active: boolean; jobId?: string }> {
  const snapshot = await adminDb
    .collection('users')
    .doc(userId)
    .collection('translationJobs')
    .where('projectId', '==', projectId)
    .where('status', 'in', ['pending', 'processing'])
    .limit(1)
    .get()

  if (snapshot.empty) {
    return { active: false }
  }

  return { active: true, jobId: snapshot.docs[0].id }
}

// Estimate job duration based on task count
export function estimateJobDuration(taskCount: number): number {
  // Roughly 15-30 seconds per translation with parallel processing
  // With batch size of 5, and 20s average per task
  const batchSize = 5
  const avgTimePerTask = 20 // seconds
  const batches = Math.ceil(taskCount / batchSize)
  return batches * avgTimePerTask
}

// Get jobs that can be resumed (failed or completed with failures)
export async function getResumableJobs(
  userId: string,
  projectId: string,
  limit = 5
): Promise<TranslationJob[]> {
  // Simple query without composite index requirement
  // Just get recent jobs and filter in code
  const snapshot = await adminDb
    .collection('users')
    .doc(userId)
    .collection('translationJobs')
    .orderBy('createdAt', 'desc')
    .limit(50) // Get more and filter in code
    .get()

  const jobs: TranslationJob[] = []

  snapshot.docs.forEach(doc => {
    const job = { id: doc.id, ...doc.data() } as TranslationJob

    // Filter by project
    if (job.projectId !== projectId) return

    // Include failed jobs
    if (job.status === 'failed') {
      jobs.push(job)
      return
    }

    // Include completed jobs that have some failures
    if (job.status === 'completed') {
      const failedCount = job.results?.filter(r => !r.success).length || 0
      if (failedCount > 0) {
        jobs.push(job)
      }
    }
  })

  return jobs.slice(0, limit)
}

// Get the full chain of jobs (for continuation tracking)
export async function getJobChain(
  userId: string,
  jobId: string
): Promise<TranslationJob[]> {
  const chain: TranslationJob[] = []
  const seenIds = new Set<string>()

  // Get the starting job
  const startingJob = await getTranslationJob(userId, jobId)
  if (!startingJob) return chain

  // Walk UP from starting job to find the root
  const upChain: TranslationJob[] = []
  let currentJob: TranslationJob | null = startingJob

  while (currentJob && !seenIds.has(currentJob.id)) {
    seenIds.add(currentJob.id)
    upChain.unshift(currentJob) // Add to front so root is first
    if (currentJob.continuationOf) {
      currentJob = await getTranslationJob(userId, currentJob.continuationOf)
    } else {
      currentJob = null
    }
  }

  // Now walk DOWN from root via continuedBy
  const root = upChain[0]
  chain.push(root)

  currentJob = root
  while (currentJob?.continuedBy && !seenIds.has(currentJob.continuedBy)) {
    const childJob = await getTranslationJob(userId, currentJob.continuedBy)
    if (!childJob) break
    seenIds.add(childJob.id)
    chain.push(childJob)
    currentJob = childJob
  }

  // If the starting job isn't in the chain (broken chain), add it at the end
  // This handles cases where continuedBy wasn't set but continuationOf was
  if (!chain.some(j => j.id === startingJob.id)) {
    chain.push(startingJob)
  }

  return chain
}

// Get the latest job in a chain (the one currently processing or the final one)
export async function getLatestJobInChain(
  userId: string,
  jobId: string
): Promise<TranslationJob | null> {
  const chain = await getJobChain(userId, jobId)
  if (chain.length === 0) return null
  return chain[chain.length - 1]
}

// Aggregate results from entire job chain
export interface AggregatedJobStatus {
  rootJobId: string
  currentJobId: string
  status: TranslationJobStatus
  totalProgress: {
    current: number
    total: number
  }
  allResults: TranslationJobResult[]
  chainLength: number
  createdAt: Date | Timestamp
  completedAt?: Date | Timestamp
  error?: string
}

export async function getAggregatedJobStatus(
  userId: string,
  jobId: string
): Promise<AggregatedJobStatus | null> {
  const chain = await getJobChain(userId, jobId)
  if (chain.length === 0) return null

  const rootJob = chain[0]
  const latestJob = chain[chain.length - 1]

  // Aggregate all results from the chain
  const allResults: TranslationJobResult[] = []
  let totalProcessed = 0

  for (const job of chain) {
    allResults.push(...(job.results || []))
    totalProcessed += job.results?.length || 0
  }

  // Calculate total from root job's original total or sum of all
  const totalTasks = rootJob.progress.total || totalProcessed

  return {
    rootJobId: rootJob.id,
    currentJobId: latestJob.id,
    status: latestJob.status,
    totalProgress: {
      current: totalProcessed,
      total: totalTasks,
    },
    allResults,
    chainLength: chain.length,
    createdAt: rootJob.createdAt,
    completedAt: latestJob.completedAt,
    error: latestJob.error,
  }
}
