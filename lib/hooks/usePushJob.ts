'use client'

import { useState, useEffect, useCallback, useRef } from 'react'

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
}

export interface PushJobVersionInfo {
  id: string
  versionString: string
  state: string
}

export interface PushJobStatus {
  jobId: string
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled'
  statusMessage?: string // Human-readable status message for UI
  progress: PushJobProgress
  results: PushJobResult[]
  versionInfo?: PushJobVersionInfo
  error?: string
  createdAt?: string
  startedAt?: string
  completedAt?: string
  // Continuation chain tracking
  currentJobId?: string
  chainLength?: number
  isChained?: boolean
  continuedBy?: string
}

interface UsePushJobOptions {
  pollingInterval?: number // ms, default 3000 (slightly longer for App Store operations)
  onComplete?: (job: PushJobStatus) => void
  onError?: (error: string) => void
  onProgress?: (progress: PushJobProgress, newResults: PushJobResult[]) => void
}

export interface StartPushJobResult {
  jobId: string
  totalTasks: number
  totalScreenshots: number
  displayTypes: string[]
  locales: string[]
  estimatedDuration: number
}

interface UsePushJobReturn {
  job: PushJobStatus | null
  isPolling: boolean
  error: string | null
  startJob: (params: StartPushJobParams) => Promise<StartPushJobResult | null>
  cancelJob: () => Promise<boolean>
  clearJob: () => void
  attachToJob: (jobId: string) => void
}

interface StartPushJobParams {
  projectId: string
  displayTypes?: string[]
  locales?: string[]
}

export function usePushJob(
  initialJobId: string | null = null,
  options: UsePushJobOptions = {}
): UsePushJobReturn {
  const {
    pollingInterval = 3000,
    onComplete,
    onError,
    onProgress,
  } = options

  const [job, setJob] = useState<PushJobStatus | null>(null)
  const [isPolling, setIsPolling] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [jobId, setJobId] = useState<string | null>(initialJobId)

  const pollingRef = useRef<NodeJS.Timeout | null>(null)
  const lastResultsCountRef = useRef<number>(0)
  const pollCountRef = useRef<number>(0)
  const lastProgressRef = useRef<number>(0)

  // Adaptive polling: start fast, slow down if no progress
  const getAdaptiveInterval = useCallback((currentScreenshots: number) => {
    const baseInterval = pollingInterval
    const pollCount = pollCountRef.current

    // If progress is being made, keep polling fast
    if (currentScreenshots > lastProgressRef.current) {
      lastProgressRef.current = currentScreenshots
      pollCountRef.current = 0
      return baseInterval
    }

    // Exponential backoff: 3s -> 4.5s -> 6s -> 9s -> 12s (max 12s)
    const backoffMultiplier = Math.min(1 + Math.floor(pollCount / 3) * 0.5, 4)
    return Math.min(baseInterval * backoffMultiplier, 12000)
  }, [pollingInterval])

  // Store callbacks in refs to avoid re-triggering effects
  const onCompleteRef = useRef(onComplete)
  const onErrorRef = useRef(onError)
  const onProgressRef = useRef(onProgress)

  useEffect(() => {
    onCompleteRef.current = onComplete
    onErrorRef.current = onError
    onProgressRef.current = onProgress
  }, [onComplete, onError, onProgress])

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollingRef.current) {
        clearTimeout(pollingRef.current)
      }
    }
  }, [])

  // Fetch job status
  const fetchStatus = useCallback(async (id: string): Promise<PushJobStatus | null> => {
    try {
      const response = await fetch(`/api/screenshots/push-job/${id}?aggregated=true`)
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || `Failed to fetch job status: ${response.status}`)
      }
      const data = await response.json()

      // Transform aggregated response to status format
      return {
        jobId: data.rootJobId || id,
        status: data.status,
        statusMessage: data.statusMessage,
        progress: data.totalProgress || {
          currentScreenshots: 0,
          totalScreenshots: 0,
          currentSets: 0,
          totalSets: 0
        },
        results: data.allResults || [],
        versionInfo: data.versionInfo,
        error: data.error,
        createdAt: data.createdAt,
        completedAt: data.completedAt,
        currentJobId: data.currentJobId,
        chainLength: data.chainLength,
        isChained: data.chainLength > 1,
        continuedBy: undefined,
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch job status'
      setError(message)
      onErrorRef.current?.(message)
      return null
    }
  }, [])

  // Poll for status
  const poll = useCallback(async () => {
    if (!jobId) return

    const status = await fetchStatus(jobId)
    if (!status) {
      setIsPolling(false)
      return
    }

    setJob(status)
    pollCountRef.current++

    // Check for new results
    if (status.results.length > lastResultsCountRef.current) {
      const newResults = status.results.slice(lastResultsCountRef.current)
      lastResultsCountRef.current = status.results.length
      onProgressRef.current?.(status.progress, newResults)
    }

    // Continue polling if job is still active
    if (status.status === 'pending' || status.status === 'processing') {
      // Use adaptive interval based on progress
      const interval = getAdaptiveInterval(status.progress.currentScreenshots)
      pollingRef.current = setTimeout(poll, interval)
    } else {
      setIsPolling(false)
      if (status.status === 'completed' || status.status === 'failed' || status.status === 'cancelled') {
        onCompleteRef.current?.(status)
      }
    }
  }, [jobId, fetchStatus, getAdaptiveInterval])

  // Start polling when jobId changes
  useEffect(() => {
    if (jobId) {
      setIsPolling(true)
      setError(null)
      lastResultsCountRef.current = 0
      pollCountRef.current = 0
      lastProgressRef.current = 0
      poll()
    }

    return () => {
      if (pollingRef.current) {
        clearTimeout(pollingRef.current)
      }
    }
  }, [jobId, poll])

  // Start a new job
  const startJob = useCallback(async (params: StartPushJobParams): Promise<StartPushJobResult | null> => {
    // Clear previous job state
    setJob(null)
    setError(null)
    lastResultsCountRef.current = 0

    try {
      const response = await fetch('/api/screenshots/push-job/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || `Failed to start push job: ${response.status}`)
      }

      const data = await response.json()
      setJobId(data.jobId)
      return {
        jobId: data.jobId,
        totalTasks: data.totalTasks,
        totalScreenshots: data.totalScreenshots,
        displayTypes: data.displayTypes,
        locales: data.locales,
        estimatedDuration: data.estimatedDuration,
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to start push job'
      setError(message)
      onError?.(message)
      return null
    }
  }, [onError])

  // Cancel the current job
  const cancelJob = useCallback(async (): Promise<boolean> => {
    if (!jobId) return false

    try {
      const response = await fetch(`/api/screenshots/push-job/${jobId}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || 'Failed to cancel job')
      }

      // Stop polling
      if (pollingRef.current) {
        clearTimeout(pollingRef.current)
      }
      setIsPolling(false)

      // Fetch final status
      const finalStatus = await fetchStatus(jobId)
      if (finalStatus) {
        setJob(finalStatus)
      }

      return true
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to cancel job'
      setError(message)
      return false
    }
  }, [jobId, fetchStatus])

  // Clear job state
  const clearJob = useCallback(() => {
    if (pollingRef.current) {
      clearTimeout(pollingRef.current)
    }
    setJob(null)
    setJobId(null)
    setIsPolling(false)
    setError(null)
    lastResultsCountRef.current = 0
  }, [])

  // Attach to an existing active job
  const attachToJob = useCallback((activeJobId: string) => {
    setJob(null)
    setError(null)
    lastResultsCountRef.current = 0
    setJobId(activeJobId)
  }, [])

  return {
    job,
    isPolling,
    error,
    startJob,
    cancelJob,
    clearJob,
    attachToJob,
  }
}

// Hook for checking active push jobs on a project
export function useActivePushJobs(projectId: string | null) {
  const [jobs, setJobs] = useState<PushJobStatus[]>([])
  const [isLoading, setIsLoading] = useState(false)

  const refresh = useCallback(async () => {
    if (!projectId) {
      setJobs([])
      return
    }

    setIsLoading(true)
    try {
      const response = await fetch(`/api/screenshots/push-job/active?projectId=${projectId}`)
      if (!response.ok) {
        throw new Error('Failed to fetch active push jobs')
      }

      const data = await response.json()

      // Transform to PushJobStatus format
      const activeJobs: PushJobStatus[] = (data.activeJobs || []).map((job: {
        jobId: string
        status: PushJobStatus['status']
        statusMessage?: string
        progress: PushJobProgress
        createdAt?: string
        startedAt?: string
        config?: { displayTypes?: string[]; locales?: string[] }
      }) => ({
        jobId: job.jobId,
        status: job.status,
        statusMessage: job.statusMessage,
        progress: job.progress || {
          currentScreenshots: 0,
          totalScreenshots: 0,
          currentSets: 0,
          totalSets: 0
        },
        results: [],
        createdAt: job.createdAt,
        startedAt: job.startedAt,
      }))

      setJobs(activeJobs)
    } catch (err) {
      console.error('Failed to fetch project push jobs:', err)
      setJobs([])
    } finally {
      setIsLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    refresh()
  }, [refresh])

  return { jobs, isLoading, refresh }
}
