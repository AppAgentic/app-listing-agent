'use client'

import { useState, useEffect, useCallback, useRef } from 'react'

export interface TranslationJobProgress {
  current: number
  total: number
  currentLocale?: string
  currentDisplayType?: string
  byLocale?: Record<string, { success: number; failed: number; total: number }>
}

export interface TranslationJobResult {
  locale: string
  displayType: string
  screenshotId: string
  success: boolean
  imageUrl?: string
  error?: string
  provider?: 'kie' | 'fal' | 'openai'
  model?: string
  instructionsHash?: string
}

export interface TranslationJobStatus {
  jobId: string
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled'
  progress: TranslationJobProgress
  results: TranslationJobResult[]
  error?: string
  createdAt?: string
  startedAt?: string
  completedAt?: string
  // Continuation chain tracking
  currentJobId?: string  // Latest job in chain (if chained)
  chainLength?: number   // Number of jobs in chain
  isChained?: boolean    // Whether this is part of a chain
  continuedBy?: string   // Next job in chain (if any)
}

interface UseTranslationJobOptions {
  pollingInterval?: number // ms, default 2000
  onComplete?: (job: TranslationJobStatus) => void
  onError?: (error: string) => void
  onProgress?: (progress: TranslationJobProgress, newResults: TranslationJobResult[]) => void
}

interface ResumeJobResult {
  jobId: string
  originalJobId: string
  totalTasks: number
  completedInOriginal: number
  alreadyComplete?: boolean
}

export interface JobBillingInfo {
  currentUsage: number
  monthlyLimit: number
  willExceedLimit: boolean
  withinPlanCount: number
  overageCount: number
  estimatedOverageCost: number
  plan: string
}

export interface StartJobResult {
  jobId: string
  totalTasks: number
  billing: JobBillingInfo
}

interface UseTranslationJobReturn {
  job: TranslationJobStatus | null
  isPolling: boolean
  error: string | null
  startJob: (params: StartJobParams) => Promise<StartJobResult | null>
  previewJob: (params: StartJobParams) => Promise<{ totalTasks: number; billing: JobBillingInfo } | null>
  resumeJob: (jobId: string) => Promise<ResumeJobResult | null>
  cancelJob: () => Promise<boolean>
  clearJob: () => void
  attachToJob: (jobId: string) => void // Attach to an existing active job
}

interface StartJobParams {
  projectId: string
  targetLocales: string[]
  displayTypes?: string[]
  screenshotIds?: string[]
  screenshotIdsByLocale?: Record<string, string[]>  // Per-locale filtering
  translateInAppText?: boolean
  preserveInPhoneUI?: boolean
  translateMarketingOnly?: boolean
  translationInstructions?: string
  translationMode?: 'literal' | 'marketing_short' | 'transcreate' | 'ui_full'
  textLengthPolicy?: {
    headlineMaxChars?: number
    subtitleMaxChars?: number
    allowLineBreaks?: boolean
    shrinkFontLimitPercent?: number
  }
  provider?: 'kie' | 'fal' | 'openai'
  model?: string
  perScreenshotInstructions?: Record<string, string | {
    headline?: string
    subtitle?: string
    instructions?: string
    headlineMaxChars?: number
    subtitleMaxChars?: number
  }>
}

export function useTranslationJob(
  initialJobId: string | null = null,
  options: UseTranslationJobOptions = {}
): UseTranslationJobReturn {
  const {
    pollingInterval = 2000,
    onComplete,
    onError,
    onProgress,
  } = options

  const [job, setJob] = useState<TranslationJobStatus | null>(null)
  const [isPolling, setIsPolling] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [jobId, setJobId] = useState<string | null>(initialJobId)

  const pollingRef = useRef<NodeJS.Timeout | null>(null)
  const lastResultsCountRef = useRef<number>(0)
  const pollCountRef = useRef<number>(0)
  const lastProgressRef = useRef<number>(0)

  // Adaptive polling: start fast, slow down if no progress
  const getAdaptiveInterval = useCallback((progress: number) => {
    const baseInterval = pollingInterval
    const pollCount = pollCountRef.current

    // If progress is being made, keep polling fast
    if (progress > lastProgressRef.current) {
      lastProgressRef.current = progress
      pollCountRef.current = 0
      return baseInterval
    }

    // Exponential backoff: 2s -> 3s -> 4s -> 6s -> 8s (max 8s)
    const backoffMultiplier = Math.min(1 + Math.floor(pollCount / 3) * 0.5, 4)
    return Math.min(baseInterval * backoffMultiplier, 8000)
  }, [pollingInterval])

  // Store callbacks in refs to avoid re-triggering effects when callbacks change
  const onCompleteRef = useRef(onComplete)
  const onErrorRef = useRef(onError)
  const onProgressRef = useRef(onProgress)

  // Keep refs in sync with latest callbacks
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
  const fetchStatus = useCallback(async (id: string): Promise<TranslationJobStatus | null> => {
    try {
      const response = await fetch(`/api/screenshots/translate/status?jobId=${id}`)
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || `Failed to fetch job status: ${response.status}`)
      }
      return await response.json()
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
      const interval = getAdaptiveInterval(status.progress.current)
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

  // Preview job cost without starting it
  const previewJob = useCallback(async (params: StartJobParams): Promise<{ totalTasks: number; billing: JobBillingInfo } | null> => {
    try {
      const response = await fetch('/api/screenshots/translate/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || `Failed to preview job: ${response.status}`)
      }

      const data = await response.json()
      return { totalTasks: data.totalTasks, billing: data.billing }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to preview translation job'
      setError(message)
      return null
    }
  }, [])

  // Start a new job
  const startJob = useCallback(async (params: StartJobParams): Promise<StartJobResult | null> => {
    // Clear previous job state immediately to avoid showing stale progress
    setJob(null)
    setError(null)
    lastResultsCountRef.current = 0

    try {
      const response = await fetch('/api/screenshots/translate/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || `Failed to start job: ${response.status}`)
      }

      const data = await response.json()
      setJobId(data.jobId)
      return {
        jobId: data.jobId,
        totalTasks: data.totalTasks,
        billing: data.billing,
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to start translation job'
      setError(message)
      onError?.(message)
      return null
    }
  }, [onError])

  // Cancel the current job
  const cancelJob = useCallback(async (): Promise<boolean> => {
    if (!jobId) {
      console.log('[CancelJob] No jobId to cancel')
      return false
    }

    console.log('[CancelJob] Attempting to cancel job:', jobId)

    try {
      const response = await fetch('/api/screenshots/translate/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId }),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        console.log('[CancelJob] Cancel failed:', response.status, errorData)
        throw new Error(errorData.error || 'Failed to cancel job')
      }

      console.log('[CancelJob] Cancel successful')

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

  // Resume a failed/incomplete job
  const resumeJob = useCallback(async (resumeJobId: string): Promise<ResumeJobResult | null> => {
    // Clear previous job state
    setJob(null)
    setError(null)
    lastResultsCountRef.current = 0

    try {
      const response = await fetch('/api/screenshots/translate/resume', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId: resumeJobId }),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({})
        )
        throw new Error(errorData.error || `Failed to resume job: ${response.status}`)
      }

      const data = await response.json()

      // If all complete, no new job was created
      if (data.alreadyComplete) {
        return {
          jobId: resumeJobId,
          originalJobId: resumeJobId,
          totalTasks: 0,
          completedInOriginal: 0,
          alreadyComplete: true,
        }
      }

      // Start polling the new job
      setJobId(data.jobId)

      return {
        jobId: data.jobId,
        originalJobId: data.originalJobId,
        totalTasks: data.totalTasks,
        completedInOriginal: data.completedInOriginal,
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to resume translation job'
      setError(message)
      onErrorRef.current?.(message)
      return null
    }
  }, [])

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

  // Attach to an existing active job (e.g., on page load)
  const attachToJob = useCallback((activeJobId: string) => {
    // Clear previous state
    setJob(null)
    setError(null)
    lastResultsCountRef.current = 0
    // Set the job ID to start polling
    setJobId(activeJobId)
  }, [])

  return {
    job,
    isPolling,
    error,
    startJob,
    previewJob,
    resumeJob,
    cancelJob,
    clearJob,
    attachToJob,
  }
}

// Convenience hook for checking active jobs on a project
export function useActiveTranslationJobs(projectId: string | null) {
  const [jobs, setJobs] = useState<TranslationJobStatus[]>([])
  const [isLoading, setIsLoading] = useState(false)

  const refresh = useCallback(async () => {
    if (!projectId) {
      setJobs([])
      return
    }

    setIsLoading(true)
    try {
      const response = await fetch(`/api/screenshots/translate/status?projectId=${projectId}`)
      if (response.ok) {
        const data = await response.json()
        setJobs(data.jobs || [])
      }
    } catch (err) {
      console.error('Failed to fetch project jobs:', err)
    } finally {
      setIsLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    refresh()
  }, [refresh])

  return { jobs, isLoading, refresh }
}

// Interface for resumable job info
export interface ResumableJob {
  jobId: string
  status: string
  progress: TranslationJobProgress
  successCount: number
  failCount: number
  totalResults: number
  config: {
    targetLocales: string[]
    displayTypes: string[]
    screenshotIds?: string[]
    translateInAppText: boolean
  }
  createdAt: string
  completedAt?: string
  error?: string
}

// Hook for fetching jobs that can be resumed
export function useResumableJobs(projectId: string | null) {
  const [jobs, setJobs] = useState<ResumableJob[]>([])
  const [isLoading, setIsLoading] = useState(false)

  const refresh = useCallback(async () => {
    if (!projectId) {
      setJobs([])
      return
    }

    setIsLoading(true)
    try {
      const response = await fetch(`/api/screenshots/translate/status?projectId=${projectId}&resumable=true`)
      if (response.ok) {
        const data = await response.json()
        setJobs(data.jobs || [])
      }
    } catch (err) {
      console.error('Failed to fetch resumable jobs:', err)
    } finally {
      setIsLoading(false)
    }
  }, [projectId])

  const deleteJob = useCallback(async (jobId: string): Promise<boolean> => {
    try {
      const response = await fetch('/api/screenshots/translate/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId }),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || 'Failed to delete job')
      }

      // Remove from local state immediately
      setJobs(prev => prev.filter(j => j.jobId !== jobId))
      return true
    } catch (err) {
      console.error('Failed to delete job:', err)
      return false
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  return { jobs, isLoading, refresh, deleteJob }
}
