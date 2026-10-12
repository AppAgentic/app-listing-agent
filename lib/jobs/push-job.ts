import { Timestamp } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'

export type PushJobStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled'

export interface PushJobConfig {
  displayTypes: string[]
  locales: string[]
}

export interface PushJobProgress {
  // Screenshot-level progress (for smooth progress bar)
  currentScreenshots: number  // Total screenshots uploaded so far
  totalScreenshots: number    // Total screenshots across all tasks
  // Set-level progress (for context)
  currentSets: number         // Number of display/locale sets completed
  totalSets: number           // Total number of display/locale sets
  // Current task info
  currentDisplayType?: string
  currentLocale?: string
  currentStep?: 'fetching' | 'uploading' | 'committing'
}

export interface PushJobResult {
  displayType: string
  locale: string
  success: boolean
  screenshotsUploaded?: number
  error?: string
  completedAt: Date | Timestamp
}

export interface PushJob {
  // Identity
  id: string
  userId: string
  orgId?: string
  projectId: string
  appId: string // App Store app ID or Play Store package name
  platform: 'ios' | 'android' // Platform type

  // Status
  status: PushJobStatus
  statusMessage?: string // Human-readable status for UI display

  // Configuration
  config: PushJobConfig

  // Progress
  progress: PushJobProgress

  // Results (updated as tasks complete)
  results: PushJobResult[]

  // App Store version info
  versionInfo?: {
    id: string
    versionString: string
    state: string
  }

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
  continuationOf?: string
  continuedBy?: string
  rootJobId?: string
  chainIndex?: number
}

// Create a new push job
export async function createPushJob(params: {
  userId: string
  orgId?: string
  projectId: string
  appId: string
  platform?: 'ios' | 'android'
  config: PushJobConfig
}): Promise<PushJob> {
  const { userId, orgId, projectId, appId, platform = 'ios', config } = params

  const jobRef = adminDb
    .collection('users')
    .doc(userId)
    .collection('pushJobs')
    .doc()

  const job: PushJob = {
    id: jobRef.id,
    userId,
    ...(orgId ? { orgId } : {}),
    projectId,
    appId,
    platform,
    status: 'pending',
    config,
    progress: {
      currentScreenshots: 0,
      totalScreenshots: 0,
      currentSets: 0,
      totalSets: 0,
    },
    results: [],
    createdAt: Timestamp.now(),
    retryCount: 0,
  }

  await jobRef.set(job)
  return job
}

// Get a push job by ID
export async function getPushJob(
  userId: string,
  jobId: string
): Promise<PushJob | null> {
  const jobRef = adminDb
    .collection('users')
    .doc(userId)
    .collection('pushJobs')
    .doc(jobId)

  const doc = await jobRef.get()
  if (!doc.exists) return null

  return { id: doc.id, ...doc.data() } as PushJob
}

// Update job status
export async function updatePushJobStatus(
  userId: string,
  jobId: string,
  status: PushJobStatus,
  additionalData?: Partial<PushJob>
): Promise<void> {
  const jobRef = adminDb
    .collection('users')
    .doc(userId)
    .collection('pushJobs')
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
export async function updatePushJobProgress(
  userId: string,
  jobId: string,
  progress: PushJobProgress,
  newResults?: PushJobResult[]
): Promise<void> {
  const jobRef = adminDb
    .collection('users')
    .doc(userId)
    .collection('pushJobs')
    .doc(jobId)

  const updateData: Record<string, any> = { progress }

  if (newResults && newResults.length > 0) {
    const { FieldValue } = await import('firebase-admin/firestore')
    updateData.results = FieldValue.arrayUnion(...newResults)
  }

  await jobRef.update(updateData)
}

// Cancel a job
export async function cancelPushJob(userId: string, jobId: string): Promise<boolean> {
  const job = await getPushJob(userId, jobId)
  if (!job) return false

  if (job.status !== 'pending' && job.status !== 'processing') {
    return false
  }

  await updatePushJobStatus(userId, jobId, 'cancelled')
  return true
}

// Get active push jobs for a user
export async function getActivePushJobs(userId: string): Promise<PushJob[]> {
  const snapshot = await adminDb
    .collection('users')
    .doc(userId)
    .collection('pushJobs')
    .where('status', 'in', ['pending', 'processing'])
    .orderBy('createdAt', 'desc')
    .limit(10)
    .get()

  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as PushJob))
}

// Get push jobs for a specific project
export async function getProjectPushJobs(
  userId: string,
  projectId: string,
  limit = 10
): Promise<PushJob[]> {
  const snapshot = await adminDb
    .collection('users')
    .doc(userId)
    .collection('pushJobs')
    .where('projectId', '==', projectId)
    .orderBy('createdAt', 'desc')
    .limit(limit)
    .get()

  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as PushJob))
}

// Estimate job duration based on task count
export function estimatePushJobDuration(taskCount: number): number {
  // App Store uploads are slower, roughly 30-60 seconds per screenshot set
  // With batch size of 5, and 45s average per task
  const batchSize = 5
  const avgTimePerTask = 45 // seconds
  const batches = Math.ceil(taskCount / batchSize)
  return batches * avgTimePerTask
}

// Get the full chain of jobs (for continuation tracking)
export async function getPushJobChain(
  userId: string,
  jobId: string
): Promise<PushJob[]> {
  const chain: PushJob[] = []

  let currentJob = await getPushJob(userId, jobId)
  if (!currentJob) return chain

  // Walk up to find the root
  while (currentJob.continuationOf) {
    const parentJob = await getPushJob(userId, currentJob.continuationOf)
    if (!parentJob) break
    currentJob = parentJob
  }

  // Walk down the chain from root
  chain.push(currentJob)
  while (currentJob.continuedBy) {
    const childJob = await getPushJob(userId, currentJob.continuedBy)
    if (!childJob) break
    chain.push(childJob)
    currentJob = childJob
  }

  return chain
}

// Aggregate results from entire job chain
export interface AggregatedPushJobStatus {
  rootJobId: string
  currentJobId: string
  status: PushJobStatus
  statusMessage?: string // Human-readable status for UI display
  totalProgress: {
    currentScreenshots: number
    totalScreenshots: number
    currentSets: number
    totalSets: number
    currentDisplayType?: string
    currentLocale?: string
  }
  allResults: PushJobResult[]
  chainLength: number
  createdAt: Date | Timestamp
  completedAt?: Date | Timestamp
  error?: string
  versionInfo?: PushJob['versionInfo']
}

export async function getAggregatedPushJobStatus(
  userId: string,
  jobId: string
): Promise<AggregatedPushJobStatus | null> {
  const chain = await getPushJobChain(userId, jobId)
  if (chain.length === 0) return null

  const rootJob = chain[0]
  const latestJob = chain[chain.length - 1]

  // Aggregate all results from the chain
  const allResults: PushJobResult[] = []
  let completedSets = 0
  let completedScreenshots = 0

  for (const job of chain) {
    allResults.push(...(job.results || []))
    completedSets += job.results?.length || 0
    // Sum up screenshots from results
    for (const result of (job.results || [])) {
      completedScreenshots += result.screenshotsUploaded || 0
    }
  }

  // Get totals from the root job (initial calculation) + current progress from latest job
  const totalSets = rootJob.progress.totalSets || completedSets
  const totalScreenshots = rootJob.progress.totalScreenshots || completedScreenshots

  // Use the latest job's current progress for live updates
  const currentScreenshots = latestJob.progress?.currentScreenshots || completedScreenshots
  const currentSets = latestJob.progress?.currentSets || completedSets

  return {
    rootJobId: rootJob.id,
    currentJobId: latestJob.id,
    status: latestJob.status,
    statusMessage: latestJob.statusMessage,
    totalProgress: {
      currentScreenshots,
      totalScreenshots,
      currentSets,
      totalSets,
      currentDisplayType: latestJob.progress?.currentDisplayType,
      currentLocale: latestJob.progress?.currentLocale,
    },
    allResults,
    chainLength: chain.length,
    createdAt: rootJob.createdAt,
    completedAt: latestJob.completedAt,
    error: latestJob.error,
    versionInfo: latestJob.versionInfo,
  }
}
