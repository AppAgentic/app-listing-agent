import { adminDb } from '@/lib/firebase/admin'
import { Timestamp } from 'firebase-admin/firestore'

export interface ScreenshotJob {
  id: string
  status: 'processing' | 'completed' | 'failed'
  userId: string
  projectId: string
  toolName: string
  totalScreenshots: number
  completedScreenshots: number
  results?: Array<{
    index: number
    headline: string
    success: boolean
    originalUrl?: string
    resizedUrls?: Record<string, string>
    error?: string
  }>
  stats?: {
    total: number
    success: number
    failed: number
  }
  error?: string
  createdAt: Timestamp
  updatedAt: Timestamp
}

const JOBS_COLLECTION = 'screenshotJobs'

export async function createScreenshotJob(params: {
  userId: string
  projectId: string
  toolName: string
  totalScreenshots: number
}): Promise<string> {
  const jobRef = adminDb.collection(JOBS_COLLECTION).doc()
  await jobRef.set({
    status: 'processing',
    userId: params.userId,
    projectId: params.projectId,
    toolName: params.toolName,
    totalScreenshots: params.totalScreenshots,
    completedScreenshots: 0,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  })
  return jobRef.id
}

// Strip undefined values from an object (Firestore rejects them)
function stripUndefined<T extends Record<string, any>>(obj: T): T {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined)
  ) as T
}

export async function completeScreenshotJob(
  jobId: string,
  results: ScreenshotJob['results'],
  stats: ScreenshotJob['stats']
): Promise<void> {
  const cleanResults = results?.map(r => stripUndefined(r)) ?? []
  await adminDb.collection(JOBS_COLLECTION).doc(jobId).update({
    status: 'completed',
    results: cleanResults,
    stats,
    completedScreenshots: stats?.total ?? 0,
    updatedAt: Timestamp.now(),
  })
}

export async function failScreenshotJob(jobId: string, error: string): Promise<void> {
  await adminDb.collection(JOBS_COLLECTION).doc(jobId).update({
    status: 'failed',
    error,
    updatedAt: Timestamp.now(),
  })
}

export async function getScreenshotJobStatus(
  jobId: string,
  userId: string
): Promise<ScreenshotJob | null> {
  const doc = await adminDb.collection(JOBS_COLLECTION).doc(jobId).get()
  if (!doc.exists) return null

  const data = doc.data()!
  // Auth check: only the job creator can check status
  if (data.userId !== userId) return null

  return { id: doc.id, ...data } as ScreenshotJob
}
