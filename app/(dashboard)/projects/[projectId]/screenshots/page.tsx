'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useParams } from 'next/navigation'
import {
  Image,
  Plus,
  Trash2,
  Sparkles,
  Save,
  Loader2,
  Languages,
  AlertCircle,
  Cloud,
  CloudDownload,
  CloudUpload,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Upload,
  Smartphone,
  Tablet,
  Watch,
  Eye,
  X,
  Check,
  Star,
  ChevronDown,
  ChevronRight,
  HelpCircle,
  RefreshCw,
  Globe,
  Wand2,
  Info,
  GripVertical,
  Pause,
  Pencil,
  Type,
  Download,
  Link2,
  LayoutTemplate,
} from 'lucide-react'
import { APPSTORE_LOCALES, LOCALE_NAMES, LOCALE_FLAGS } from '@/lib/constants'
import type { ScreenshotSet, ScreenshotDisplayType, Screenshot, ScreenshotSyncStatus } from '@/lib/firebase/firestore'
import { SCREENSHOT_DISPLAY_TYPES } from '@/lib/firebase/firestore'
import { ScreenshotWizard } from '@/components/screenshots/ScreenshotWizard'
import { ScreenshotEditModal } from '@/components/screenshot-edit-modal'
import { ImportMcpScreenshotsModal } from '@/components/screenshots/ImportMcpScreenshotsModal'
import { OptimizedImage } from '@/components/ui/optimized-image'
import { useTranslationJob, useResumableJobs, type TranslationJobStatus, type TranslationJobResult, type ResumableJob } from '@/lib/hooks/useTranslationJob'
import { usePushJob, useActivePushJobs, type PushJobStatus } from '@/lib/hooks/usePushJob'
import { useNotifications } from '@/lib/hooks/useNotifications'
import { Bell, BellOff } from 'lucide-react'

// Helper to calculate per-locale translation progress
interface LocaleProgressInfo {
  successCount: number
  failCount: number
  total: number
  isProcessing: boolean
  isPending: boolean
  isComplete: boolean
}

function getLocaleProgress(
  locale: string,
  job: TranslationJobStatus | null,
  targetLocales: string[]
): LocaleProgressInfo | null {
  if (!job || !targetLocales.includes(locale)) return null

  const localeResults = job.results.filter(r => r.locale === locale)
  const successCount = localeResults.filter(r => r.success).length
  const failCount = localeResults.filter(r => !r.success).length
  const isCurrentlyProcessing = job.progress.currentLocale === locale

  // Use actual per-locale total from byLocale if available, otherwise estimate
  const byLocaleData = job.progress.byLocale?.[locale]
  const estimatedTotal = byLocaleData?.total ?? Math.ceil(job.progress.total / targetLocales.length)

  // Only mark as complete if we have a valid total and have processed all items
  // Don't show complete when total is 0 (job just started) or job is still pending/processing
  const processedCount = successCount + failCount
  const isComplete = estimatedTotal > 0 && processedCount >= estimatedTotal && processedCount > 0

  return {
    successCount,
    failCount,
    total: estimatedTotal,
    isProcessing: isCurrentlyProcessing,
    isPending: localeResults.length === 0 && !isCurrentlyProcessing,
    isComplete,
  }
}

// Device type display info - updated per Apple 2024/2025 requirements
const DEVICE_ICONS: Record<string, React.ReactNode> = {
  'APP_IPHONE_69': <Smartphone className="w-4 h-4" />,
  'APP_IPHONE_65': <Smartphone className="w-4 h-4" />,
  'APP_IPHONE_63': <Smartphone className="w-4 h-4" />,
  'APP_IPHONE_61': <Smartphone className="w-4 h-4" />,
  'APP_IPHONE_55': <Smartphone className="w-4 h-4" />,
  'APP_IPAD_PRO_13': <Tablet className="w-4 h-4" />,
  'APP_IPAD_PRO_129': <Tablet className="w-4 h-4" />,
  'APP_IPAD_PRO_11': <Tablet className="w-4 h-4" />,
  'APP_WATCH_ULTRA_3': <Watch className="w-4 h-4" />,
  'APP_WATCH_ULTRA': <Watch className="w-4 h-4" />,
  'APP_WATCH_SERIES_10': <Watch className="w-4 h-4" />,
  'APP_WATCH_SERIES_7': <Watch className="w-4 h-4" />,
  'APP_WATCH_SERIES_4': <Watch className="w-4 h-4" />,
  'APP_WATCH_SERIES_3': <Watch className="w-4 h-4" />,
}

interface ProjectInfo {
  id: string
  name: string
  storeType: 'ios' | 'android'
  appStoreAppId: string | null
  primaryLocale: string
  enabledLocales: string[]
  screenshotSyncStatus: ScreenshotSyncStatus
  lastScreenshotPulledAt: any
  lastScreenshotPushedAt: any
  linkedProjectId: string | null
}

// Format timestamp to relative time
function formatTimeAgo(timestamp: any): string {
  if (!timestamp) return 'Never'
  const date = timestamp?.toDate ? timestamp.toDate() : new Date(timestamp)
  // Check if date is valid
  if (isNaN(date.getTime())) return 'Never'
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMins / 60)
  const diffDays = Math.floor(diffHours / 24)

  if (diffMins < 1) return 'Just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`
  return date.toLocaleDateString()
}

// Sync status badge component
function SyncStatusBadge({ status }: { status: ScreenshotSyncStatus }) {
  switch (status) {
    case 'synced':
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium bg-green-500/10 text-green-400 border border-green-500/20">
          <CheckCircle2 className="w-3 h-3" />
          Synced
        </span>
      )
    case 'local_changes':
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20">
          <Clock className="w-3 h-3" />
          Unpublished Changes
        </span>
      )
    case 'conflict':
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium bg-red-500/10 text-red-400 border border-red-500/20">
          <AlertTriangle className="w-3 h-3" />
          Conflict
        </span>
      )
    case 'never_synced':
    default:
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium bg-neutral-500/10 text-neutral-400 border border-neutral-500/20">
          <Cloud className="w-3 h-3" />
          Never Synced
        </span>
      )
  }
}

// Locale helpers
function getLocaleName(locale: string): string {
  return LOCALE_NAMES[locale] || locale
}

function getLocaleFlag(locale: string): string {
  return LOCALE_FLAGS[locale] || '🌐'
}

export default function ScreenshotsPage() {
  const params = useParams()
  const projectId = params.projectId as string

  // State
  const [project, setProject] = useState<ProjectInfo | null>(null)
  const [screenshotSets, setScreenshotSets] = useState<Record<string, ScreenshotSet>>({})
  const [localizedScreenshots, setLocalizedScreenshots] = useState<Record<string, any>>({})
  const [selectedLocale, setSelectedLocale] = useState<string>('')
  const [expandedDevices, setExpandedDevices] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [pulling, setPulling] = useState(false)
  const [pullProgress, setPullProgress] = useState<string>('')
  const [pushing, setPushing] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [translating, setTranslating] = useState(false)
  const [activeJobIds, setActiveJobIds] = useState<Set<string>>(new Set()) // Track all active job IDs
  const [error, setError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [hasChanges, setHasChanges] = useState(false)

  // Modal states
  const [generateModalOpen, setGenerateModalOpen] = useState(false)
  const [wizardOpen, setWizardOpen] = useState(false)
  const [importModalOpen, setImportModalOpen] = useState(false)
  const [wizardDeviceType, setWizardDeviceType] = useState<ScreenshotDisplayType | null>(null)
  const [translateModalOpen, setTranslateModalOpen] = useState(false)
  const [incompleteJobsModalOpen, setIncompleteJobsModalOpen] = useState(false)
  const [appMetadata, setAppMetadata] = useState<{ name: string; description: string; category?: string } | null>(null)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState<string | null>(null) // displayType to delete
  const [deleting, setDeleting] = useState(false)
  const [pushConfirmOpen, setPushConfirmOpen] = useState(false)
  // Feature graphic generation state
  const [fgGenerating, setFgGenerating] = useState(false)
  const [fgHeadline, setFgHeadline] = useState('')
  const [fgShowForm, setFgShowForm] = useState(false)
  const [selectedPushLocales, setSelectedPushLocales] = useState<string[]>([])
  const [showPushProgressDialog, setShowPushProgressDialog] = useState(false)

  // Linked project state
  const [linkedProjectName, setLinkedProjectName] = useState<string | null>(null)
  const [syncingFromLinked, setSyncingFromLinked] = useState(false)
  const [pushProgressDetails, setPushProgressDetails] = useState<{
    step: 'connecting' | 'uploading' | 'complete' | 'error'
    message: string
    current?: number
    total?: number
    currentTask?: { displayType: string; locale: string }
    currentBatch?: Array<{ displayType: string; locale: string }>
    results?: Array<{ displayType: string; locale: string; success: boolean; error?: string; screenshotsUploaded?: number }>
    error?: string
    stats?: { total: number; success: number; failed: number; screenshotsUploaded: number }
    versionInfo?: { id: string; version: string; state: string }
    // Granular progress
    currentStep?: 'fetching' | 'processing' | 'uploading' | 'committing'
    currentScreenshot?: number
    totalScreenshots?: number
  } | null>(null)
  const [previewImage, setPreviewImage] = useState<string | null>(null)
  const [selectedDeviceForGenerate, setSelectedDeviceForGenerate] = useState<string>('')

  // Edit modal state
  const [editModalOpen, setEditModalOpen] = useState(false)
  const [editingScreenshot, setEditingScreenshot] = useState<{
    deviceType: string
    screenshot: Screenshot
    locale: string
    isTranslated: boolean
    rawImageUrl?: string | null // For primary context
    primaryImageUrl?: string    // For translated context
    initialPrompt?: string      // Pre-filled prompt for quick actions
  } | null>(null)

  // Generate form state
  const [rawImages, setRawImages] = useState<{ url: string; headline: string }[]>([])
  const [styleType, setStyleType] = useState<'category' | 'reference'>('category')
  const [selectedCategory, setSelectedCategory] = useState('health_fitness')
  const [referenceImageUrl, setReferenceImageUrl] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const directUploadRef = useRef<HTMLInputElement>(null)
  const [uploadingDirect, setUploadingDirect] = useState(false)
  const [uploadTargetDevice, setUploadTargetDevice] = useState<string | null>(null)

  // Ref to track last screenshots refresh time for throttling during translation
  const lastRefreshTimeRef = useRef<number>(0)
  // Ref to track completed job ID for delayed cleanup
  const completedJobIdRef = useRef<string | null>(null)
  // Ref to store loadScreenshots function for use in callbacks (avoids stale closure)
  const loadScreenshotsRef = useRef<((setDefaultLocale?: boolean, silent?: boolean) => Promise<void>) | null>(null)

  // Translate form state
  const [targetLocales, setTargetLocales] = useState<string[]>([])
  const [translateInAppText, setTranslateInAppText] = useState(true)
  const [showTranslationHelp, setShowTranslationHelp] = useState(false)
  const [syncOnlyMode, setSyncOnlyMode] = useState(false) // Only translate screenshots that need syncing

  // Active translation tracking (persists which locales are being translated for sidebar progress)
  const [translationTargetLocales, setTranslationTargetLocales] = useState<string[]>([])
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false)

  // Track failed translations per locale for retry functionality
  const [failedLocales, setFailedLocales] = useState<Record<string, { count: number; displayTypes: string[]; screenshotIds: string[] }>>({})
  const [retryingLocale, setRetryingLocale] = useState<string | null>(null)

  // Translate/Retranslate confirmation dialog state
  const [translateConfirm, setTranslateConfirm] = useState<{
    type: 'screenshot' | 'deviceSet'
    deviceType: string
    screenshotId?: string
    screenshotCount?: number
    isNewTranslation?: boolean  // true for new translation, false for retranslation
  } | null>(null)

  // Track which specific items are being translated (for showing loading state)
  // Key format: "screenshotId_locale" to allow multiple concurrent translations
  const [translatingItems, setTranslatingItems] = useState<Set<string>>(new Set())

  // Track if we've already recovered active jobs (to prevent re-running on every screenshotSets change)
  const hasRecoveredJobsRef = useRef(false)

  // Helper to check if a screenshot is being translated for a specific locale
  const isScreenshotTranslating = useCallback((screenshotId: string, locale: string) => {
    return translatingItems.has(`${screenshotId}_${locale}`)
  }, [translatingItems])

  // Helper to check for translation conflicts before starting a new job
  // Returns array of conflicting screenshotId_locale combinations
  const getTranslationConflicts = useCallback((screenshotIds: string[], locales: string[]): string[] => {
    const conflicts: string[] = []
    locales.forEach(locale => {
      screenshotIds.forEach(id => {
        const key = `${id}_${locale}`
        if (translatingItems.has(key)) {
          conflicts.push(key)
        }
      })
    })
    return conflicts
  }, [translatingItems])

  // Helper to check if any locale has screenshots currently being translated
  const hasActiveTranslationsForLocales = useCallback((locales: string[]): boolean => {
    for (const key of translatingItems) {
      const locale = key.split('_').pop()
      if (locale && locales.includes(locale)) {
        return true
      }
    }
    return false
  }, [translatingItems])

  // Helper to get screenshot IDs that need syncing for a specific locale
  // Returns screenshots that are either untranslated or out of sync
  const getScreenshotsNeedingSync = useCallback((locale: string): string[] => {
    if (locale === project?.primaryLocale) return []

    const needsSync: string[] = []
    Object.entries(screenshotSets).forEach(([deviceType, set]) => {
      (set.screenshots || []).forEach(screenshot => {
        const localizedKey = `${deviceType}_${screenshot.id}_${locale}`
        const localized = localizedScreenshots[localizedKey]

        if (!localized) {
          // Untranslated
          needsSync.push(screenshot.id)
        } else if (localized.primaryUpdatedAt && screenshot.updatedAt) {
          // Check if out of sync
          const primaryTs = screenshot.updatedAt as any
          const translationTs = localized.primaryUpdatedAt as any
          const primaryUpdatedTime = primaryTs?.toMillis ? primaryTs.toMillis() : new Date(primaryTs).getTime()
          const translationPrimaryTime = translationTs?.toMillis ? translationTs.toMillis() : new Date(translationTs).getTime()
          if (primaryUpdatedTime > translationPrimaryTime) {
            needsSync.push(screenshot.id)
          }
        }
      })
    })
    return needsSync
  }, [screenshotSets, localizedScreenshots, project?.primaryLocale])

  // Track which locales have been notified as complete (to avoid duplicate notifications)
  const notifiedLocalesRef = useRef<Set<string>>(new Set())

  // Notifications
  const { permission: notificationPermission, isSupported: notificationsSupported, requestPermission, sendNotification } = useNotifications()

  // Drag and drop state
  const [draggedItem, setDraggedItem] = useState<{ deviceType: string; index: number } | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)

  const storeName = project?.storeType === 'ios' ? 'App Store' : 'Play Store'
  const storeConnectName = project?.storeType === 'ios' ? 'App Store Connect' : 'Google Play Console'
  const hasStoreConnection = project?.storeType === 'android' ? !!project : !!project?.appStoreAppId

  const isAndroid = project?.storeType === 'android'

  // Filter display types by store type (iOS shows APP_IPHONE_*/APP_IPAD_*, Android shows PLAY_*)
  // PLAY_FEATURE_GRAPHIC is excluded here — it gets its own dedicated section
  const storeDisplayTypes = useMemo(() => {
    return Object.entries(SCREENSHOT_DISPLAY_TYPES).filter(([type]) => {
      if (project?.storeType === 'android') {
        return type.startsWith('PLAY_') && type !== 'PLAY_FEATURE_GRAPHIC'
      }
      // Default to iOS types
      return type.startsWith('APP_')
    }) as [ScreenshotDisplayType, typeof SCREENSHOT_DISPLAY_TYPES[ScreenshotDisplayType]][]
  }, [project?.storeType])

  // Feature graphic (Android only) — separate from regular screenshots
  const featureGraphicSet = useMemo(() => {
    if (!isAndroid) return null
    return screenshotSets['PLAY_FEATURE_GRAPHIC'] ?? null
  }, [isAndroid, screenshotSets])

  // Resumable jobs hook
  const { jobs: resumableJobs, refresh: refreshResumableJobs, deleteJob: deleteResumableJob } = useResumableJobs(projectId)

  // Translation job hook
  const {
    job: translationJob,
    isPolling: isPollingTranslation,
    error: translationError,
    startJob: startTranslationJob,
    resumeJob: resumeTranslationJob,
    cancelJob: cancelTranslationJob,
    clearJob: clearTranslationJob,
    attachToJob: attachToTranslationJob,
  } = useTranslationJob(null, {
    pollingInterval: 2000,
    onComplete: async (job) => {
      const successCount = job.results.filter(r => r.success).length
      const failCount = job.results.filter(r => !r.success).length
      showSuccess(`Translated ${successCount} screenshots${failCount > 0 ? ` (${failCount} failed)` : ''}`)

      // Send final notification
      if (notificationPermission === 'granted') {
        if (failCount > 0) {
          sendNotification('Translation Complete', {
            body: `${successCount} screenshots translated, ${failCount} failed`,
            tag: 'translation-complete',
          })
        } else {
          sendNotification('All Translations Complete! 🎉', {
            body: `${successCount} screenshots translated successfully`,
            tag: 'translation-complete',
          })
        }
      }

      setTranslateModalOpen(false)
      setTargetLocales([])
      // Remove ALL items from this job from translating set (both successful and failed)
      // Use job config to determine which items to remove, not just results
      setTranslatingItems(prev => {
        const newSet = new Set(prev)
        // First, try to remove based on results (handles both success and failure)
        job.results.forEach(result => {
          if (result.screenshotId) {
            newSet.delete(`${result.screenshotId}_${result.locale}`)
          }
        })
        // Also remove any items that match the job's target locales
        // This ensures we clear items even if they weren't in results
        const jobLocales = [...new Set(job.results.map(r => r.locale))]
        const keysToRemove: string[] = []
        newSet.forEach(key => {
          const locale = key.split('_').pop()
          if (locale && jobLocales.includes(locale)) {
            keysToRemove.push(key)
          }
        })
        keysToRemove.forEach(key => newSet.delete(key))
        return newSet
      })
      setRetryingLocale(null)
      setHasChanges(true)

      // Update failed locales based on final results (clear successes, add failures)
      // This ensures the sidebar reflects the actual final state after retries
      const targetLocalesInJob = [...new Set(job.results.map(r => r.locale))]
      const newFailedLocales: Record<string, { count: number; displayTypes: string[]; screenshotIds: string[] }> = {}

      job.results.filter(r => !r.success).forEach(result => {
        if (!newFailedLocales[result.locale]) {
          newFailedLocales[result.locale] = { count: 0, displayTypes: [], screenshotIds: [] }
        }
        newFailedLocales[result.locale].count++
        if (!newFailedLocales[result.locale].displayTypes.includes(result.displayType)) {
          newFailedLocales[result.locale].displayTypes.push(result.displayType)
        }
        if (result.screenshotId && !newFailedLocales[result.locale].screenshotIds.includes(result.screenshotId)) {
          newFailedLocales[result.locale].screenshotIds.push(result.screenshotId)
        }
      })

      // Clear locales that were in this job but have no failures (they succeeded)
      setFailedLocales(prev => {
        const updated = { ...prev }
        targetLocalesInJob.forEach(locale => {
          if (!newFailedLocales[locale]) {
            delete updated[locale] // No failures for this locale, remove from failed state
          } else {
            updated[locale] = newFailedLocales[locale]
          }
        })
        return updated
      })

      // Use silent refresh to avoid UI flicker
      await loadScreenshots(false, true)
      refreshResumableJobs()
      // Clear sessionStorage after job completes
      sessionStorage.removeItem(`translation-job-${projectId}`)

      // Track this completed job ID for delayed cleanup
      const completedJobId = job.jobId
      completedJobIdRef.current = completedJobId

      // Get the locales that were part of this specific job
      const jobLocales = [...new Set(job.results.map(r => r.locale))]

      // Remove this job from active jobs
      setActiveJobIds(prev => {
        const newSet = new Set(prev)
        newSet.delete(completedJobId)
        return newSet
      })

      // Delay clearing the translation UI state so users can see the final status
      // This keeps progress bars visible for 3 seconds after completion
      setTimeout(() => {
        // Use translatingItems as the source of truth - only clear if nothing is being translated
        setTranslatingItems(currentItems => {
          if (currentItems.size === 0) {
            // No other items being translated, clear everything
            setTranslationTargetLocales([])
            setTranslating(false)
            clearTranslationJob()
            completedJobIdRef.current = null
          } else {
            // Other items still being translated
            // Remove only the locales from this job that have no remaining items
            setTranslationTargetLocales(prevLocales => {
              return prevLocales.filter(locale => {
                // Keep locale if it has items still being translated
                for (const item of currentItems) {
                  if (item.endsWith(`_${locale}`)) {
                    return true
                  }
                }
                return false
              })
            })
          }
          return currentItems
        })
      }, 3000)
    },
    onError: (errorMsg) => {
      setError(errorMsg)
      // On error, remove this job from active jobs
      if (translationJob?.jobId) {
        setActiveJobIds(prev => {
          const newSet = new Set(prev)
          newSet.delete(translationJob.jobId)
          return newSet
        })
      }
      // Only clear translating state if no other items are being translated
      setTranslatingItems(currentItems => {
        if (currentItems.size === 0) {
          setTranslating(false)
          setTranslationTargetLocales([])
        }
        return currentItems
      })
    },
    onProgress: (progress, newResults) => {
      // Clear completed items from translatingItems as they finish (for incremental UI updates)
      if (newResults && newResults.length > 0) {
        setTranslatingItems(prev => {
          const newSet = new Set(prev)
          newResults.forEach(result => {
            if (result.screenshotId) {
              newSet.delete(`${result.screenshotId}_${result.locale}`)
            }
          })
          return newSet
        })

        // Refresh screenshots to show new translated images (throttled to every 3 seconds)
        const now = Date.now()
        if (now - lastRefreshTimeRef.current > 3000) {
          lastRefreshTimeRef.current = now
          // Use silent refresh to avoid UI flicker (via ref to avoid stale closure)
          loadScreenshotsRef.current?.(false, true)
        }
      }

      // Check if any locale just completed and send notification
      if (newResults && newResults.length > 0 && notificationPermission === 'granted') {
        // Group results by locale
        const localeResults: Record<string, { success: number; fail: number }> = {}
        newResults.forEach(r => {
          if (!localeResults[r.locale]) {
            localeResults[r.locale] = { success: 0, fail: 0 }
          }
          if (r.success) {
            localeResults[r.locale].success++
          } else {
            localeResults[r.locale].fail++
          }
        })

        // Check each locale and send notification if newly completed
        Object.entries(localeResults).forEach(([locale, counts]) => {
          // Calculate estimated total per locale
          const estimatedTotalPerLocale = Math.ceil(progress.total / translationTargetLocales.length)
          const localeProgress = getLocaleProgress(locale, { progress, results: newResults } as TranslationJobStatus, translationTargetLocales)

          if (localeProgress?.isComplete && !notifiedLocalesRef.current.has(locale)) {
            notifiedLocalesRef.current.add(locale)
            const localeName = LOCALE_NAMES[locale] || locale
            const flag = LOCALE_FLAGS[locale] || '🌐'

            if (localeProgress.failCount > 0) {
              sendNotification(`${flag} ${localeName} Translation Complete`, {
                body: `${localeProgress.successCount} screenshots translated, ${localeProgress.failCount} failed`,
                tag: `translation-${locale}`,
              })
            } else {
              sendNotification(`${flag} ${localeName} Translation Complete`, {
                body: `All ${localeProgress.successCount} screenshots translated successfully!`,
                tag: `translation-${locale}`,
              })
            }
          }
        })
      }
    },
  })

  // Push job hook for background screenshot pushing
  const {
    job: pushJob,
    isPolling: isPushPolling,
    error: pushJobError,
    startJob: startPushJob,
    cancelJob: cancelPushJob,
    clearJob: clearPushJob,
    attachToJob: attachToPushJob,
  } = usePushJob(null, {
    pollingInterval: 3000,
    onComplete: async (job) => {
      const successCount = job.results.filter(r => r.success).length
      const failCount = job.results.filter(r => !r.success).length
      // Use the total from progress (which is always accurate) instead of summing from results
      // Results might be incomplete due to Firestore limitations or missing screenshotsUploaded field
      const totalUploaded = job.progress.totalScreenshots
      // Also calculate from results as a fallback for display
      const resultsTotal = job.results.filter(r => r.success).reduce((sum, r) => sum + (r.screenshotsUploaded || 0), 0)
      // Use whichever is larger (progress is more reliable)
      const displayTotal = Math.max(totalUploaded, resultsTotal)

      if (failCount > 0) {
        setPushProgressDetails({
          step: 'error',
          message: `Pushed with errors: ${successCount}/${job.progress.totalSets} sets succeeded`,
          current: job.progress.totalScreenshots,
          total: job.progress.totalScreenshots,
          results: job.results.map(r => ({
            displayType: r.displayType,
            locale: r.locale,
            success: r.success,
            error: r.error,
            screenshotsUploaded: r.screenshotsUploaded,
          })),
          stats: { total: job.progress.totalSets, success: successCount, failed: failCount, screenshotsUploaded: displayTotal },
          versionInfo: job.versionInfo ? { id: job.versionInfo.id, version: job.versionInfo.versionString, state: job.versionInfo.state } : undefined,
          error: `${failCount} set(s) failed`,
        })
      } else {
        setPushProgressDetails({
          step: 'complete',
          message: `Successfully pushed ${displayTotal} screenshots to ${storeConnectName}`,
          current: job.progress.totalScreenshots,
          total: job.progress.totalScreenshots,
          results: job.results.map(r => ({
            displayType: r.displayType,
            locale: r.locale,
            success: r.success,
            error: r.error,
            screenshotsUploaded: r.screenshotsUploaded,
          })),
          stats: { total: job.progress.totalSets, success: job.progress.totalSets, failed: 0, screenshotsUploaded: displayTotal },
          versionInfo: job.versionInfo ? { id: job.versionInfo.id, version: job.versionInfo.versionString, state: job.versionInfo.state } : undefined,
        })
        setHasChanges(false)
      }

      // Refresh data
      await loadScreenshots(false)
      setPushing(false)
    },
    onError: (errorMsg) => {
      setPushProgressDetails({
        step: 'error',
        message: 'Push failed',
        error: errorMsg,
      })
      setError(errorMsg)
      setPushing(false)
    },
    onProgress: (progress, newResults) => {
      // Update progress dialog - use statusMessage from job if available
      setPushProgressDetails(prev => ({
        ...prev!,
        step: 'uploading',
        message: pushJob?.statusMessage || `Uploading ${progress.currentScreenshots}/${progress.totalScreenshots} screenshots`,
        current: progress.currentScreenshots,
        total: progress.totalScreenshots,
        currentTask: progress.currentDisplayType && progress.currentLocale
          ? { displayType: progress.currentDisplayType, locale: progress.currentLocale }
          : undefined,
      }))
    },
  })

  // Check for active push jobs on page load
  const { jobs: activePushJobs } = useActivePushJobs(projectId)

  // Auto-attach to active push job on mount
  useEffect(() => {
    if (activePushJobs.length > 0 && !pushJob && !isPushPolling) {
      const activeJob = activePushJobs[0]
      console.log('[Push] Found active push job on page load:', activeJob.jobId)

      // Attach to the active job
      attachToPushJob(activeJob.jobId)

      // Set up the progress dialog
      setPushing(true)
      setShowPushProgressDialog(true)
      setPushProgressDetails({
        step: 'uploading',
        message: activeJob.statusMessage || `Uploading ${activeJob.progress.currentScreenshots}/${activeJob.progress.totalScreenshots} screenshots`,
        current: activeJob.progress.currentScreenshots,
        total: activeJob.progress.totalScreenshots,
      })
    }
  }, [activePushJobs, pushJob, isPushPolling, attachToPushJob])

  // Sync pushJob status message to progress dialog
  useEffect(() => {
    if (pushJob && pushJob.status === 'processing' && pushProgressDetails?.step === 'uploading') {
      setPushProgressDetails(prev => {
        if (!prev) return prev
        return {
          ...prev,
          message: pushJob.statusMessage || `Uploading ${pushJob.progress.currentScreenshots}/${pushJob.progress.totalScreenshots} screenshots`,
          current: pushJob.progress.currentScreenshots,
          total: pushJob.progress.totalScreenshots,
          currentTask: pushJob.progress.currentDisplayType && pushJob.progress.currentLocale
            ? { displayType: pushJob.progress.currentDisplayType, locale: pushJob.progress.currentLocale }
            : prev.currentTask,
          // Granular progress
          currentStep: pushJob.progress.currentStep,
        }
      })
    }
  }, [pushJob?.statusMessage, pushJob?.progress.currentScreenshots, pushJob?.progress.totalScreenshots, pushJob?.progress.currentDisplayType, pushJob?.progress.currentLocale, pushJob?.progress.currentStep, pushJob?.status, pushProgressDetails?.step])

  // Check if a locale has its own translated screenshots
  const localeHasTranslations = useCallback((locale: string): boolean => {
    if (locale === project?.primaryLocale) return true // Primary always has its own
    // Check if any localized screenshot exists for this locale
    return Object.keys(localizedScreenshots).some(key => key.endsWith(`_${locale}`))
  }, [localizedScreenshots, project?.primaryLocale])

  // Get sync status for a locale
  // Returns: 'needs_translation' | 'needs_sync' | 'synced' | null (for primary)
  const getLocaleSyncStatus = useCallback((locale: string): 'needs_translation' | 'needs_sync' | 'synced' | null => {
    if (locale === project?.primaryLocale) return null // Primary doesn't need sync

    // Get all primary screenshots across all device types
    const allPrimaryScreenshots: { deviceType: string; screenshot: Screenshot }[] = []
    Object.entries(screenshotSets).forEach(([deviceType, set]) => {
      (set.screenshots || []).forEach(screenshot => {
        allPrimaryScreenshots.push({ deviceType, screenshot })
      })
    })

    if (allPrimaryScreenshots.length === 0) return null // No screenshots to sync

    // Check localization status for each screenshot
    let hasAnyTranslation = false
    let hasOutOfSync = false
    let hasUntranslated = false

    allPrimaryScreenshots.forEach(({ deviceType, screenshot }) => {
      const localizedKey = `${deviceType}_${screenshot.id}_${locale}`
      const localized = localizedScreenshots[localizedKey]

      if (localized) {
        hasAnyTranslation = true
        // Check if out of sync
        if (localized.primaryUpdatedAt && screenshot.updatedAt) {
          const primaryTs = screenshot.updatedAt as any
          const translationTs = localized.primaryUpdatedAt as any
          const primaryUpdatedTime = primaryTs?.toMillis ? primaryTs.toMillis() : new Date(primaryTs).getTime()
          const translationPrimaryTime = translationTs?.toMillis ? translationTs.toMillis() : new Date(translationTs).getTime()
          if (primaryUpdatedTime > translationPrimaryTime) {
            hasOutOfSync = true
          }
        }
      } else {
        hasUntranslated = true
      }
    })

    // Determine overall status
    if (!hasAnyTranslation) return 'needs_translation'
    if (hasOutOfSync || hasUntranslated) return 'needs_sync'
    return 'synced'
  }, [screenshotSets, localizedScreenshots, project?.primaryLocale])

  // Get screenshots for the currently selected locale
  // For primary locale: use screenshotSets directly
  // For other locales: merge localized screenshots over the primary ones
  const getScreenshotsForLocale = useCallback((deviceType: string): Screenshot[] => {
    // Get primary screenshots and sort by position to ensure consistent ordering
    // Use index as fallback if position is undefined to maintain stable sort
    const rawScreenshots = screenshotSets[deviceType]?.screenshots || []
    const primaryScreenshots = rawScreenshots
      .map((s, idx) => ({ ...s, _sortKey: s.position ?? idx }))
      .sort((a, b) => a._sortKey - b._sortKey)
      .map(({ _sortKey, ...s }) => s) as typeof rawScreenshots

    // If viewing primary locale, return sorted primary screenshots
    if (selectedLocale === project?.primaryLocale) {
      return primaryScreenshots
    }

    // For non-primary locales, show ALL screenshots with localized versions where available
    // This gives users visibility into what's translated vs what's pending
    return primaryScreenshots.map(screenshot => {
      const localizedKey = `${deviceType}_${screenshot.id}_${selectedLocale}`
      const localized = localizedScreenshots[localizedKey]

      if (localized) {
        // Has translation - use localized image
        // Check if out of sync: primary has been updated after translation was created
        let isOutOfSync = false
        if (localized.primaryUpdatedAt && screenshot.updatedAt) {
          const primaryTs = screenshot.updatedAt as any
          const translationTs = localized.primaryUpdatedAt as any
          const primaryUpdatedTime = primaryTs?.toMillis ? primaryTs.toMillis() : new Date(primaryTs).getTime()
          const translationPrimaryTime = translationTs?.toMillis ? translationTs.toMillis() : new Date(translationTs).getTime()
          // If primary was updated after translation was created, it's out of sync
          isOutOfSync = primaryUpdatedTime > translationPrimaryTime
        }

        return {
          ...screenshot,
          marketingImageUrl: localized.marketingImageUrl,
          headline: localized.headline,
          isLocalized: true,
          isPendingTranslation: false,
          isOutOfSync,
        } as Screenshot & { isLocalized?: boolean; isPendingTranslation?: boolean; isOutOfSync?: boolean }
      }

      // No translation yet - show primary with pending indicator
      return {
        ...screenshot,
        isLocalized: false,
        isPendingTranslation: true, // Indicates this needs translation
        isOutOfSync: false,
      } as Screenshot & { isLocalized?: boolean; isPendingTranslation?: boolean; isOutOfSync?: boolean }
    })
  }, [screenshotSets, localizedScreenshots, selectedLocale, project?.primaryLocale])

  // Show success message temporarily
  const showSuccess = useCallback((message: string) => {
    setSuccessMessage(message)
    setTimeout(() => setSuccessMessage(null), 3000)
  }, [])

  // Load screenshots
  // setDefaultLocale: whether to set the selected locale to primary (initial load)
  // silent: if true, don't show loading state (for background refreshes)
  const loadScreenshots = useCallback(async (setDefaultLocale = true, silent = false) => {
    try {
      if (!silent) {
        setLoading(true)
      }
      const response = await fetch(`/api/screenshots?projectId=${projectId}`)
      if (!response.ok) throw new Error('Failed to load screenshots')
      const data = await response.json()

      // Batch state updates together to minimize re-renders
      setProject(data.project)
      setScreenshotSets(data.screenshotSets || {})
      setLocalizedScreenshots(data.localizedScreenshots || {})

      // Set default locale only on initial load
      if (setDefaultLocale && data.project?.primaryLocale) {
        setSelectedLocale(data.project.primaryLocale)
      }

      // Expand devices that have screenshots by default (only on initial load)
      if (setDefaultLocale) {
        const devicesWithScreenshots = Object.keys(data.screenshotSets || {})
        if (devicesWithScreenshots.length > 0) {
          setExpandedDevices(new Set(devicesWithScreenshots))
        }
      }

      // Fetch app metadata for the wizard
      if (data.project?.primaryLocale) {
        try {
          const metadataResponse = await fetch(
            `/api/metadata?projectId=${projectId}&locale=${data.project.primaryLocale}`
          )
          if (metadataResponse.ok) {
            const metadataData = await metadataResponse.json()
            setAppMetadata({
              name: metadataData.metadata?.name || data.project.name || 'App',
              description: metadataData.metadata?.description || '',
              category: undefined, // Could be fetched from project settings if needed
            })
          }
        } catch {
          // Fallback to project name
          setAppMetadata({
            name: data.project.name || 'App',
            description: '',
          })
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load screenshots')
    } finally {
      if (!silent) {
        setLoading(false)
      }
    }
  }, [projectId])

  // Keep ref in sync with loadScreenshots for use in callbacks
  useEffect(() => {
    loadScreenshotsRef.current = loadScreenshots
  }, [loadScreenshots])

  useEffect(() => {
    loadScreenshots()
  }, [loadScreenshots])

  // Fetch linked project name when project loads
  useEffect(() => {
    if (!project?.linkedProjectId) {
      setLinkedProjectName(null)
      return
    }
    const fetchLinkedName = async () => {
      try {
        const res = await fetch(`/api/metadata?projectId=${project.linkedProjectId}`)
        if (res.ok) {
          const data = await res.json()
          setLinkedProjectName(data.project?.name || null)
        }
      } catch {}
    }
    fetchLinkedName()
  }, [project?.linkedProjectId])

  // Sync screenshots from linked project
  const handleSyncFromLinked = async () => {
    if (!project?.linkedProjectId) return
    setSyncingFromLinked(true)
    setError(null)
    try {
      const res = await fetch(`/api/projects/${projectId}/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          direction: 'pull',
          syncMetadata: false,
          syncScreenshots: true,
          syncIcons: false,
        }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to sync screenshots')
      }
      const data = await res.json()
      const synced = data.results?.screenshots?.synced?.length || 0
      showSuccess(`Imported ${synced} screenshot set${synced !== 1 ? 's' : ''} from linked project`)
      await loadScreenshots(false, true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to sync screenshots')
    } finally {
      setSyncingFromLinked(false)
    }
  }

  // Check for active translation jobs on mount and attach to them
  useEffect(() => {
    const checkActiveJobs = async () => {
      if (!projectId) return
      // Only run recovery once per page load
      if (hasRecoveredJobsRef.current) return
      hasRecoveredJobsRef.current = true

      try {
        // First check sessionStorage for quick recovery (no API call needed)
        const savedJobId = sessionStorage.getItem(`translation-job-${projectId}`)
        if (savedJobId) {
          // Verify the job is still active before attaching
          const jobResponse = await fetch(`/api/screenshots/translate/status?jobId=${savedJobId}`)
          if (jobResponse.ok) {
            const jobData = await jobResponse.json()
            if (jobData.status === 'pending' || jobData.status === 'processing') {
              // Restore state from saved job config
              if (jobData.config?.targetLocales) {
                setTranslationTargetLocales(jobData.config.targetLocales)
                setTargetLocales(jobData.config.targetLocales)
              } else if (jobData.progress?.currentLocale) {
                // Fallback to current locale if config not available
                setTranslationTargetLocales([jobData.progress.currentLocale])
              }
              // Restore translating items from job config
              if (jobData.config?.targetLocales) {
                // Get all screenshot IDs from loaded screenshot sets
                const allScreenshotIds: string[] = []
                Object.values(screenshotSets).forEach((set: any) => {
                  set.screenshots?.forEach((s: any) => allScreenshotIds.push(s.id))
                })

                setTranslatingItems(prev => {
                  const newSet = new Set(prev)
                  const targetLocs: string[] = jobData.config.targetLocales || []
                  // Use screenshotIds from config if available, otherwise use all screenshots
                  const screenshotIds: string[] = jobData.config.screenshotIds || allScreenshotIds
                  targetLocs.forEach((locale: string) => {
                    screenshotIds.forEach((id: string) => newSet.add(`${id}_${locale}`))
                  })
                  return newSet
                })
              }
              // Clear any pending completion cleanup from a previous job
              completedJobIdRef.current = null
              attachToTranslationJob(savedJobId)
              setTranslating(true)
              return // Found active job, don't query for more
            } else {
              // Job completed, clear sessionStorage
              sessionStorage.removeItem(`translation-job-${projectId}`)
            }
          }
        }

        // Query jobs for this specific project (uses Firestore composite index)
        const response = await fetch(`/api/screenshots/translate/status?projectId=${projectId}`)
        if (response.ok) {
          const data = await response.json()
          // Find ALL active (pending/processing) jobs
          const activeJobs = data.jobs?.filter((j: any) =>
            j.status === 'pending' || j.status === 'processing'
          ) || []

          if (activeJobs.length > 0) {
            // Collect all target locales from all active jobs
            const allTargetLocales = new Set<string>()
            const allTranslatingItems = new Set<string>()

            // Get all screenshot IDs from the loaded screenshot sets
            const allScreenshotIds: string[] = []
            Object.values(screenshotSets).forEach((set: any) => {
              set.screenshots?.forEach((s: any) => allScreenshotIds.push(s.id))
            })

            activeJobs.forEach((activeJob: any) => {
              // Collect target locales
              if (activeJob.config?.targetLocales) {
                activeJob.config.targetLocales.forEach((l: string) => allTargetLocales.add(l))
              }

              // Collect translating items
              const jobLocales: string[] = activeJob.config?.targetLocales || []
              // Use screenshotIds from config if available, otherwise use all screenshots
              const jobScreenshotIds: string[] = activeJob.config?.screenshotIds || allScreenshotIds

              jobLocales.forEach((locale: string) => {
                jobScreenshotIds.forEach((id: string) => allTranslatingItems.add(`${id}_${locale}`))
              })
            })

            setTranslationTargetLocales([...allTargetLocales])
            setTargetLocales([...allTargetLocales])
            setTranslatingItems(allTranslatingItems)

            // Attach to the first job (the hook will handle multiple via the status endpoint)
            // Clear any pending completion cleanup from a previous job
            completedJobIdRef.current = null
            attachToTranslationJob(activeJobs[0].jobId)
            setTranslating(true)
            // Save first job to sessionStorage for future recovery
            sessionStorage.setItem(`translation-job-${projectId}`, activeJobs[0].jobId)

            console.log(`[Recovery] Found ${activeJobs.length} active jobs, locales:`, [...allTargetLocales])
          }
        }
      } catch (err) {
        console.error('Failed to check for active translation jobs:', err)
      }
    }

    // Only check for active jobs after screenshots are loaded (so we can populate translatingItems)
    if (Object.keys(screenshotSets).length > 0) {
      checkActiveJobs()
    }
  }, [projectId, attachToTranslationJob, screenshotSets])

  // Cleanup translatingItems for screenshots that are now translated
  // This handles concurrent jobs where old job results aren't processed by callbacks
  useEffect(() => {
    if (translatingItems.size === 0) return

    // Build a set of translated screenshotId_locale pairs from localizedScreenshots
    // localizedScreenshots keys are: deviceType_screenshotId_locale
    const translatedPairs = new Set<string>()
    Object.keys(localizedScreenshots).forEach(key => {
      const parts = key.split('_')
      if (parts.length >= 3) {
        // deviceType_screenshotId_locale -> screenshotId_locale
        const screenshotId = parts[1]
        const locale = parts.slice(2).join('_') // Handle locales with underscores
        translatedPairs.add(`${screenshotId}_${locale}`)
      }
    })

    // Remove items from translatingItems that are now translated
    const itemsToRemove: string[] = []
    translatingItems.forEach(item => {
      if (translatedPairs.has(item)) {
        itemsToRemove.push(item)
      }
    })

    if (itemsToRemove.length > 0) {
      setTranslatingItems(prev => {
        const newSet = new Set(prev)
        itemsToRemove.forEach(item => newSet.delete(item))
        // Also reset translating state if all items are done
        if (newSet.size === 0) {
          setTranslating(false)
          setTranslationTargetLocales([])
        }
        return newSet
      })
    }
  }, [localizedScreenshots, translatingItems])

  // Pull screenshots from store
  const handlePull = async () => {
    if (project?.storeType !== 'android' && !project?.appStoreAppId) {
      setError(`Project is not connected to ${storeConnectName}`)
      return
    }

    setPulling(true)
    setPullProgress(`Connecting to ${storeName}...`)
    setError(null)

    try {
      setPullProgress(`Fetching screenshots from ${storeName}...`)

      // Android uses the play-pull route; iOS uses the regular pull route
      const pullUrl = isAndroid ? '/api/screenshots/play-pull' : '/api/screenshots/pull'

      const response = await fetch(pullUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId }),
      })

      if (!response.ok) {
        const text = await response.text()
        let errorMessage = `Pull failed (${response.status})`
        try {
          const data = JSON.parse(text)
          errorMessage = data.error || errorMessage
        } catch {}
        throw new Error(errorMessage)
      }

      setPullProgress('Processing screenshots...')
      const data = await response.json()

      setPullProgress('Updating local data...')
      await loadScreenshots(false)

      const pulledCount = isAndroid ? data.totalPulled : data.totalScreenshots
      const typesCount = isAndroid ? data.displayTypesPulled?.length : data.displayTypesPulled
      showSuccess(`Pulled ${pulledCount} screenshots from ${typesCount} device types`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to pull screenshots')
    } finally {
      setPulling(false)
      setPullProgress('')
    }
  }

  // Open push confirmation modal
  const handlePushClick = () => {
    if (project?.storeType !== 'android' && !project?.appStoreAppId) {
      setError(`Project is not connected to ${storeConnectName}`)
      return
    }
    // Context-aware: preselect the current locale being viewed
    const currentLocale = selectedLocale || project?.primaryLocale
    if (currentLocale) {
      setSelectedPushLocales([currentLocale])
    } else {
      // Fallback to all locales if no current locale
      setSelectedPushLocales(project?.enabledLocales || [])
    }
    setPushConfirmOpen(true)
  }

  // Push screenshots to store (after confirmation)
  const handlePush = async () => {
    if (project?.storeType !== 'android' && !project?.appStoreAppId) {
      setError(`Project is not connected to ${storeConnectName}`)
      return
    }

    setPushConfirmOpen(false)
    setPushing(true)
    setShowPushProgressDialog(true)
    setError(null)

    // Step 1: Connecting / Starting job
    setPushProgressDetails({
      step: 'connecting',
      message: 'Starting push job...',
    })

    try {
      const result = await startPushJob({
        projectId,
        locales: selectedPushLocales.length > 0 ? selectedPushLocales : (project?.enabledLocales || []),
      })

      if (!result) {
        throw new Error('Failed to start push job')
      }

      // Update progress to show uploading state
      setPushProgressDetails({
        step: 'uploading',
        message: `Uploading ${result.totalScreenshots} screenshots to ${storeConnectName}...`,
        current: 0,
        total: result.totalScreenshots,
      })

      // The hook will handle the rest via polling and callbacks
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to start push job'
      setPushProgressDetails({
        step: 'error',
        message: 'Push failed',
        error: errorMessage,
      })
      setError(errorMessage)
      setPushing(false)
    }
  }

  // Cancel ongoing push
  const handleCancelPush = async () => {
    const cancelled = await cancelPushJob()
    if (cancelled) {
      setShowPushProgressDialog(false)
      setPushProgressDetails(null)
      setPushing(false)
    }
  }

  // Generate screenshots with AI
  const handleGenerate = async () => {
    if (!selectedDeviceForGenerate || rawImages.length === 0) {
      setError('Please select a device type and add raw screenshots')
      return
    }

    setGenerating(true)
    setError(null)

    try {
      const response = await fetch('/api/screenshots/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          displayType: selectedDeviceForGenerate,
          rawImages,
          styleConfig: {
            type: styleType,
            category: styleType === 'category' ? selectedCategory : undefined,
            referenceImageUrl: styleType === 'reference' ? referenceImageUrl : undefined,
          },
          locale: selectedLocale || project?.primaryLocale || 'en-US',
        }),
      })

      if (!response.ok) {
        const text = await response.text()
        let errorMessage = `Generation failed (${response.status})`
        try {
          const data = JSON.parse(text)
          errorMessage = data.error || errorMessage
        } catch {}
        throw new Error(errorMessage)
      }

      const data = await response.json()
      showSuccess(`Generated ${data.generated} screenshots`)
      setGenerateModalOpen(false)
      setRawImages([])
      setSelectedDeviceForGenerate('')
      setHasChanges(true)
      await loadScreenshots(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate screenshots')
    } finally {
      setGenerating(false)
    }
  }

  // Cancel ongoing translation
  const handleCancelTranslation = useCallback(async () => {
    setCancelConfirmOpen(false)
    const success = await cancelTranslationJob()
    if (success) {
      const successCount = translationJob?.results.filter(r => r.success).length || 0
      if (successCount > 0) {
        showSuccess(`Translation cancelled. ${successCount} screenshots were translated.`)
        setHasChanges(true)
        await loadScreenshots(false, true) // Use silent refresh
      }
      setTranslateModalOpen(false)
      setTargetLocales([])
      setTranslationTargetLocales([])
      setTranslating(false)
      clearTranslationJob()
    }
  }, [cancelTranslationJob, translationJob, showSuccess, loadScreenshots, clearTranslationJob])

  // Translate screenshots to other locales (using background job)
  const handleTranslate = async () => {
    if (targetLocales.length === 0) {
      setError('Please select target locales')
      return
    }

    // Get all screenshot IDs across all device types
    const allScreenshotIds: string[] = []
    Object.values(screenshotSets).forEach(set => {
      set.screenshots?.forEach(s => allScreenshotIds.push(s.id))
    })

    // In sync-only mode, build per-locale screenshot ID map
    // Each locale only gets the screenshots it specifically needs
    let screenshotIdsToTranslate: string[] = allScreenshotIds
    let screenshotIdsByLocale: Record<string, string[]> | undefined = undefined

    if (syncOnlyMode) {
      screenshotIdsByLocale = {}
      let totalTasks = 0

      targetLocales.forEach(locale => {
        const needsSync = getScreenshotsNeedingSync(locale)
        console.log(`[SyncOnly] Locale ${locale} needs sync:`, needsSync)
        if (needsSync.length > 0) {
          screenshotIdsByLocale![locale] = needsSync
          totalTasks += needsSync.length
        }
      })

      // Also build a union for tracking translatingItems
      const allIdsNeedingSync = new Set<string>()
      Object.values(screenshotIdsByLocale).forEach(ids => {
        ids.forEach(id => allIdsNeedingSync.add(id))
      })
      screenshotIdsToTranslate = [...allIdsNeedingSync]

      console.log(`[SyncOnly] Per-locale breakdown:`, screenshotIdsByLocale)
      console.log(`[SyncOnly] Total tasks: ${totalTasks}`)

      if (totalTasks === 0) {
        console.log('[SyncOnly] No screenshots need syncing, returning early')
        setError('All selected languages are already synced. No translation needed.')
        return
      }
    }

    console.log('[Translate] Checking for conflicts...')
    console.log('[Translate] translatingItems:', [...translatingItems])

    // Check for conflicts with already-running translations
    const conflicts = getTranslationConflicts(screenshotIdsToTranslate, targetLocales)
    console.log('[Translate] Conflicts found:', conflicts)
    if (conflicts.length > 0) {
      // Find which locales have conflicts
      const conflictingLocales = [...new Set(conflicts.map(c => c.split('_').pop() || ''))]
      console.log('[Translate] Blocking due to conflicts:', conflictingLocales)
      setError(`Translation already in progress for: ${conflictingLocales.map(l => getLocaleName(l)).join(', ')}. Wait for it to complete or select different languages.`)
      return
    }

    console.log('[Translate] No conflicts, proceeding to start job...')

    // Request notification permission in background (don't wait)
    if (notificationsSupported && notificationPermission !== 'granted') {
      requestPermission() // Fire and forget - don't block translation
    }

    // Clear notification tracking for new translation
    notifiedLocalesRef.current = new Set()

    // Track screenshots being translated - use per-locale tracking if available
    setTranslatingItems(prev => {
      const newSet = new Set(prev)
      if (screenshotIdsByLocale) {
        // Per-locale: only track the specific screenshots for each locale
        Object.entries(screenshotIdsByLocale).forEach(([locale, ids]) => {
          ids.forEach(id => newSet.add(`${id}_${locale}`))
        })
      } else {
        // All screenshots to all locales
        targetLocales.forEach(locale => {
          screenshotIdsToTranslate.forEach(id => newSet.add(`${id}_${locale}`))
        })
      }
      return newSet
    })

    // Clear any pending completion cleanup from a previous job
    completedJobIdRef.current = null
    setTranslating(true)
    setError(null)
    // Store target locales for sidebar progress display
    setTranslationTargetLocales([...targetLocales])

    console.log('[Translate] Calling startTranslationJob with:', {
      projectId,
      targetLocales,
      translateInAppText,
      screenshotIdsByLocale: screenshotIdsByLocale ? Object.keys(screenshotIdsByLocale).length + ' locales' : 'N/A',
    })

    const result = await startTranslationJob({
      projectId,
      targetLocales,
      translateInAppText,
      // Pass per-locale filtering if in sync-only mode
      ...(screenshotIdsByLocale ? { screenshotIdsByLocale } : {}),
    })

    console.log('[Translate] startTranslationJob result:', result)

    if (!result) {
      // Error is handled by onError callback - remove items we added
      setTranslatingItems(prev => {
        const newSet = new Set(prev)
        targetLocales.forEach(locale => {
          screenshotIdsToTranslate.forEach(id => newSet.delete(`${id}_${locale}`))
        })
        return newSet
      })
      setTranslating(false)
      setTranslationTargetLocales([])
    } else {
      // Track this job as active
      setActiveJobIds(prev => new Set([...prev, result.jobId]))
      // Store jobId in sessionStorage for page reload recovery
      sessionStorage.setItem(`translation-job-${projectId}`, result.jobId)
    }
    // Success: job is now being polled via useTranslationJob hook
  }

  // Retry translation for a specific locale (only retries failed screenshots)
  const handleRetryLocale = async (locale: string) => {
    // Get the failed screenshot IDs before clearing
    const failedInfo = failedLocales[locale]
    const failedScreenshotIds = failedInfo?.screenshotIds || []

    // Check for conflicts - use failed screenshot IDs if available, otherwise all screenshots
    const screenshotIdsToCheck = failedScreenshotIds.length > 0
      ? failedScreenshotIds
      : Object.values(screenshotSets).flatMap(set => set.screenshots?.map(s => s.id) || [])

    const conflicts = getTranslationConflicts(screenshotIdsToCheck, [locale])
    if (conflicts.length > 0) {
      showSuccess(`Translation already in progress for ${getLocaleName(locale)}`)
      return
    }

    setRetryingLocale(locale)
    setError(null)

    // Clear notification tracking for retry
    notifiedLocalesRef.current.delete(locale)

    // Clear this locale from failed locales
    setFailedLocales(prev => {
      const newFailed = { ...prev }
      delete newFailed[locale]
      return newFailed
    })

    // Track retrying screenshots
    setTranslatingItems(prev => {
      const newSet = new Set(prev)
      screenshotIdsToCheck.forEach(id => newSet.add(`${id}_${locale}`))
      return newSet
    })

    // Set up tracking for retry
    // Clear any pending completion cleanup from a previous job
    completedJobIdRef.current = null
    setTranslating(true)
    setTranslationTargetLocales([locale])

    // Only retry the specific failed screenshots, not all screenshots
    const result = await startTranslationJob({
      projectId,
      targetLocales: [locale],
      translateInAppText,
      ...(failedScreenshotIds.length > 0 ? { screenshotIds: failedScreenshotIds } : {}),
    })

    if (!result) {
      // Remove items we added on failure
      setTranslatingItems(prev => {
        const newSet = new Set(prev)
        screenshotIdsToCheck.forEach(id => newSet.delete(`${id}_${locale}`))
        return newSet
      })
      setRetryingLocale(null)
      setTranslating(false)
      setTranslationTargetLocales([])
    } else {
      // Track this job as active
      setActiveJobIds(prev => new Set([...prev, result.jobId]))
      // Store jobId in sessionStorage for page reload recovery
      sessionStorage.setItem(`translation-job-${projectId}`, result.jobId)
    }
  }

  // Retry all failed screenshots across all locales in one job
  const handleRetryAllFailed = async () => {
    const allFailedLocales = Object.keys(failedLocales)
    if (allFailedLocales.length === 0) return

    // Collect all unique failed screenshot IDs across all locales
    const allFailedScreenshotIds = new Set<string>()
    allFailedLocales.forEach(locale => {
      const info = failedLocales[locale]
      info.screenshotIds.forEach(id => allFailedScreenshotIds.add(id))
    })

    const screenshotIdsArray = Array.from(allFailedScreenshotIds)

    // Check for conflicts
    const conflicts = getTranslationConflicts(screenshotIdsArray, allFailedLocales)
    if (conflicts.length > 0) {
      showSuccess('Translation already in progress for some of these screenshots')
      return
    }

    setRetryingLocale('all')
    setError(null)

    // Clear notification tracking for all locales
    allFailedLocales.forEach(locale => notifiedLocalesRef.current.delete(locale))

    // Clear all failed locales
    setFailedLocales({})

    // Track all retrying screenshots
    setTranslatingItems(prev => {
      const newSet = new Set(prev)
      allFailedLocales.forEach(locale => {
        screenshotIdsArray.forEach(id => newSet.add(`${id}_${locale}`))
      })
      return newSet
    })

    // Set up tracking
    // Clear any pending completion cleanup from a previous job
    completedJobIdRef.current = null
    setTranslating(true)
    setTranslationTargetLocales(allFailedLocales)

    // Start translation job for all failed screenshots across all locales
    const result = await startTranslationJob({
      projectId,
      targetLocales: allFailedLocales,
      translateInAppText,
      screenshotIds: screenshotIdsArray,
    })

    if (!result) {
      // Remove items we added on failure
      setTranslatingItems(prev => {
        const newSet = new Set(prev)
        allFailedLocales.forEach(locale => {
          screenshotIdsArray.forEach(id => newSet.delete(`${id}_${locale}`))
        })
        return newSet
      })
      setRetryingLocale(null)
      setTranslating(false)
      setTranslationTargetLocales([])
    } else {
      // Track this job as active
      setActiveJobIds(prev => new Set([...prev, result.jobId]))
      // Store jobId in sessionStorage for page reload recovery
      sessionStorage.setItem(`translation-job-${projectId}`, result.jobId)
    }
  }

  // Calculate total failed screenshots across all locales
  const totalFailedCount = useMemo(() => {
    return Object.values(failedLocales).reduce((sum, info) => sum + info.count, 0)
  }, [failedLocales])

  const failedLocaleCount = Object.keys(failedLocales).length

  // Delete screenshot set for current locale
  const handleDeleteSet = async (displayType: string) => {
    setDeleting(true)
    setError(null)

    const currentLocale = selectedLocale || project?.primaryLocale || 'en-US'

    try {
      const response = await fetch('/api/screenshots/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          displayType,
          locale: currentLocale,
        }),
      })

      if (!response.ok) {
        const text = await response.text()
        let errorMessage = `Delete failed (${response.status})`
        try {
          const data = JSON.parse(text)
          errorMessage = data.error || errorMessage
        } catch {}
        throw new Error(errorMessage)
      }

      const data = await response.json()

      const isPrimary = currentLocale === project?.primaryLocale
      if (isPrimary) {
        showSuccess(`Deleted ${data.screenshotsDeleted} screenshots. Push to ${storeName} to sync.`)
      } else {
        showSuccess(`Deleted ${data.screenshotsDeleted} translated screenshots for ${currentLocale}. Push to ${storeName} to sync.`)
      }

      setDeleteConfirmOpen(null)
      await loadScreenshots(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete screenshot set')
    } finally {
      setDeleting(false)
    }
  }

  // Handle file upload
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files) return

    Array.from(files).forEach((file) => {
      const reader = new FileReader()
      reader.onload = (ev) => {
        const url = ev.target?.result as string
        setRawImages((prev) => [...prev, { url, headline: '' }])
      }
      reader.readAsDataURL(file)
    })

    // Reset input
    e.target.value = ''
  }

  // Validate image dimensions against device type
  const validateImageDimensions = (file: File, deviceType: ScreenshotDisplayType): Promise<{ valid: boolean; width: number; height: number }> => {
    return new Promise((resolve) => {
      const img = new window.Image()
      img.onload = () => {
        const { width: reqW, height: reqH } = SCREENSHOT_DISPLAY_TYPES[deviceType]
        // Accept exact match in portrait or landscape orientation
        const valid =
          (img.width === reqW && img.height === reqH) ||
          (img.width === reqH && img.height === reqW)
        resolve({ valid, width: img.width, height: img.height })
        URL.revokeObjectURL(img.src)
      }
      img.onerror = () => {
        resolve({ valid: false, width: 0, height: 0 })
        URL.revokeObjectURL(img.src)
      }
      img.src = URL.createObjectURL(file)
    })
  }

  // Handle direct upload of finished marketing screenshots
  const handleDirectUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0 || !uploadTargetDevice || !projectId) return

    e.target.value = ''
    setUploadingDirect(true)
    setError(null)

    try {
      const deviceType = uploadTargetDevice as ScreenshotDisplayType
      const deviceInfo = SCREENSHOT_DISPLAY_TYPES[deviceType]

      // Validate all images before uploading
      const validatedFiles: File[] = []
      const rejected: string[] = []

      for (const file of Array.from(files)) {
        const result = await validateImageDimensions(file, deviceType)
        if (result.valid) {
          validatedFiles.push(file)
        } else {
          rejected.push(
            `${file.name} (${result.width}x${result.height})`
          )
        }
      }

      if (validatedFiles.length === 0) {
        throw new Error(
          `None of the images match the required ${deviceInfo.width}x${deviceInfo.height} dimensions for ${deviceInfo.name}. Rejected: ${rejected.join(', ')}`
        )
      }

      if (rejected.length > 0) {
        setError(
          `Skipped ${rejected.length} image${rejected.length === 1 ? '' : 's'} with wrong dimensions (need ${deviceInfo.width}x${deviceInfo.height}): ${rejected.join(', ')}`
        )
      }

      const formData = new FormData()
      formData.append('projectId', projectId as string)
      validatedFiles.forEach(f => formData.append('files', f))

      const uploadRes = await fetch('/api/screenshots/upload-images', {
        method: 'POST',
        body: formData,
      })
      const uploadData = await uploadRes.json()
      if (!uploadData.success) {
        throw new Error(uploadData.error || 'Upload failed')
      }

      const existingScreenshots = screenshotSets[deviceType]?.screenshots || []
      const startPosition = existingScreenshots.length

      const newScreenshots = uploadData.results.map((r: { url: string; key: string; filename: string }, i: number) => ({
        id: `upload-${Date.now()}-${i}`,
        position: startPosition + i,
        rawImageUrl: null,
        rawImageKey: null,
        marketingImageUrl: r.url,
        marketingImageKey: r.key,
        headline: '',
        generatedWith: null,
        styleSource: null,
      }))

      setScreenshotSets(prev => {
        const existing = prev[deviceType]
        return {
          ...prev,
          [deviceType]: existing
            ? { ...existing, screenshots: [...existingScreenshots, ...newScreenshots] }
            : {
                id: deviceType,
                displayType: deviceType as ScreenshotDisplayType,
                locale: selectedLocale,
                screenshots: newScreenshots,
                styleConfig: null,
                syncStatus: 'local_changes' as ScreenshotSyncStatus,
                lastPulledAt: null,
                lastPushedAt: null,
                createdAt: null as any,
                updatedAt: null as any,
                createdBy: '',
              },
        }
      })
      setHasChanges(true)
      showSuccess(`Uploaded ${newScreenshots.length} screenshot${newScreenshots.length === 1 ? '' : 's'}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploadingDirect(false)
      setUploadTargetDevice(null)
    }
  }

  // Delete screenshot
  const handleDeleteScreenshot = (deviceType: string, screenshotId: string) => {
    setScreenshotSets((prev) => {
      const set = prev[deviceType]
      if (!set) return prev
      return {
        ...prev,
        [deviceType]: {
          ...set,
          screenshots: set.screenshots.filter((s) => s.id !== screenshotId),
        },
      }
    })
    setHasChanges(true)
  }

  // Show confirmation for retranslating a device set
  const handleRetranslateDeviceSet = (deviceType: string) => {
    if (!selectedLocale || selectedLocale === project?.primaryLocale) return

    const set = screenshotSets[deviceType]
    if (!set?.screenshots?.length) return

    setTranslateConfirm({
      type: 'deviceSet',
      deviceType,
      screenshotCount: set.screenshots.length,
      isNewTranslation: false,
    })
  }

  // Show confirmation for retranslating a single screenshot
  const handleRetranslateScreenshot = (deviceType: string, screenshotId: string) => {
    if (!selectedLocale || selectedLocale === project?.primaryLocale) return

    setTranslateConfirm({
      type: 'screenshot',
      deviceType,
      screenshotId,
      isNewTranslation: false,
    })
  }

  // Show confirmation for translating a new (untranslated) screenshot
  const handleTranslateScreenshot = (deviceType: string, screenshotId: string) => {
    if (!selectedLocale || selectedLocale === project?.primaryLocale) return

    setTranslateConfirm({
      type: 'screenshot',
      deviceType,
      screenshotId,
      isNewTranslation: true,
    })
  }

  // Execute translation after confirmation
  const executeTranslation = async () => {
    if (!translateConfirm || !selectedLocale) return

    const { type, deviceType, screenshotId } = translateConfirm

    const screenshotIds = type === 'deviceSet'
      ? screenshotSets[deviceType]?.screenshots?.map(s => s.id) || []
      : screenshotId ? [screenshotId] : []

    // Check for conflicts with already-running translations
    const conflicts = getTranslationConflicts(screenshotIds, [selectedLocale])
    if (conflicts.length > 0) {
      setTranslateConfirm(null)
      showSuccess(`Translation already in progress for ${getLocaleName(selectedLocale)}`)
      return
    }

    // Track what's being translated - add to existing set to allow concurrent translations
    setTranslatingItems(prev => {
      const newSet = new Set(prev)
      screenshotIds.forEach(id => newSet.add(`${id}_${selectedLocale}`))
      return newSet
    })

    setTranslateConfirm(null)
    // Clear any pending completion cleanup from a previous job
    completedJobIdRef.current = null
    setTranslating(true)
    setTranslationTargetLocales(prev => [...new Set([...prev, selectedLocale])])
    notifiedLocalesRef.current.clear()

    const result = await startTranslationJob({
      projectId,
      targetLocales: [selectedLocale],
      displayTypes: [deviceType],
      screenshotIds,
      translateInAppText: true,
    })

    if (!result) {
      // Remove the items we just added on failure
      setTranslatingItems(prev => {
        const newSet = new Set(prev)
        screenshotIds.forEach(id => newSet.delete(`${id}_${selectedLocale}`))
        return newSet
      })
      // Only reset translating state if no other items are being translated
      setTranslatingItems(prev => {
        if (prev.size === 0) {
          setTranslating(false)
          setTranslationTargetLocales([])
        }
        return prev
      })
    } else {
      // Track this job as active
      setActiveJobIds(prev => new Set([...prev, result.jobId]))
      // Store jobId in sessionStorage for page reload recovery
      sessionStorage.setItem(`translation-job-${projectId}`, result.jobId)
    }
  }

  // Drag and drop handlers
  const handleDragStart = (e: React.DragEvent, deviceType: string, index: number) => {
    setDraggedItem({ deviceType, index })
    e.dataTransfer.effectAllowed = 'move'
    // Add a slight delay to show the drag ghost
    const target = e.currentTarget as HTMLElement
    target.style.opacity = '0.5'
  }

  const handleDragEnd = (e: React.DragEvent) => {
    const target = e.currentTarget as HTMLElement
    target.style.opacity = '1'
    setDraggedItem(null)
    setDragOverIndex(null)
  }

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverIndex(index)
  }

  const handleDragLeave = () => {
    setDragOverIndex(null)
  }

  const handleDrop = (e: React.DragEvent, deviceType: string, dropIndex: number) => {
    e.preventDefault()
    if (!draggedItem || draggedItem.deviceType !== deviceType) {
      setDraggedItem(null)
      setDragOverIndex(null)
      return
    }

    const { index: dragIndex } = draggedItem
    if (dragIndex === dropIndex) {
      setDraggedItem(null)
      setDragOverIndex(null)
      return
    }

    setScreenshotSets((prev) => {
      const set = prev[deviceType]
      if (!set) return prev

      const screenshots = [...set.screenshots]
      const [removed] = screenshots.splice(dragIndex, 1)
      screenshots.splice(dropIndex, 0, removed)

      // Update position values
      const updatedScreenshots = screenshots.map((s, i) => ({
        ...s,
        position: i,
      }))

      return {
        ...prev,
        [deviceType]: {
          ...set,
          screenshots: updatedScreenshots,
        },
      }
    })

    setHasChanges(true)
    setDraggedItem(null)
    setDragOverIndex(null)
  }

  // Save changes
  const handleSave = async () => {
    setSaving(true)
    setError(null)

    try {
      const response = await fetch('/api/screenshots/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          screenshotSets,
          source: 'upload',
        }),
      })

      if (!response.ok) {
        const text = await response.text()
        let errorMessage = `Save failed (${response.status})`
        try {
          const data = JSON.parse(text)
          errorMessage = data.error || errorMessage
        } catch {}
        throw new Error(errorMessage)
      }

      showSuccess('Changes saved')
      setHasChanges(false)
      if (project) {
        setProject({ ...project, screenshotSyncStatus: 'local_changes' })
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save changes')
    } finally {
      setSaving(false)
    }
  }

  // Toggle device section expansion
  const toggleDeviceExpanded = (deviceType: string) => {
    setExpandedDevices((prev) => {
      const next = new Set(prev)
      if (next.has(deviceType)) {
        next.delete(deviceType)
      } else {
        next.add(deviceType)
      }
      return next
    })
  }

  // Get screenshot count for a device type
  const getScreenshotCount = (deviceType: string): number => {
    return screenshotSets[deviceType]?.screenshots?.length || 0
  }

  const isPrimaryLocale = selectedLocale === project?.primaryLocale
  const isReadOnly = !isPrimaryLocale && !localeHasTranslations(selectedLocale)

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-6 h-6 animate-spin text-neutral-400" />
      </div>
    )
  }

  if (error && !project) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px]">
        <p className="text-red-400 mb-4">{error}</p>
        <button onClick={() => loadScreenshots()} className="px-4 py-2 rounded-xl bg-white/[0.05] text-white hover:bg-white/[0.1]">
          Try Again
        </button>
      </div>
    )
  }

  return (
    <div className="h-full">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-white">Screenshots</h1>
          <p className="text-sm text-neutral-400">Manage app store screenshots for all languages</p>
        </div>
        <div className="flex items-center gap-3">
          {hasChanges && (
            <span className="flex items-center gap-1.5 text-xs text-amber-400">
              <AlertCircle className="w-3.5 h-3.5" />
              Unsaved changes
            </span>
          )}
          <button
            onClick={handleSave}
            disabled={saving || !hasChanges}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium
                     bg-white/[0.05] text-white border border-white/[0.08]
                     hover:bg-white/[0.08] disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save
          </button>
        </div>
      </div>

      {/* Top Status Bar - 2 Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        {/* Sync Status Card */}
        <div className="rounded-2xl bg-white/[0.02] border border-white/[0.08] p-5">
          <div className="text-[10px] uppercase tracking-wider text-neutral-500 mb-3">Sync Status</div>
          <SyncStatusBadge status={project?.screenshotSyncStatus || 'never_synced'} />
        </div>

        {/* Actions Card */}
        <div className="rounded-2xl bg-white/[0.02] border border-white/[0.08] p-5">
          <div className="text-[10px] uppercase tracking-wider text-neutral-500 mb-3">Actions</div>
          <div className="flex flex-col gap-2">
            <button
              onClick={handlePull}
              disabled={pulling || pushing || !hasStoreConnection}
              className="flex flex-col items-center justify-center gap-1 px-4 py-2.5 rounded-xl text-sm font-medium
                       bg-white/[0.05] text-white border border-white/[0.08]
                       hover:bg-white/[0.08] disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              <span className="flex items-center gap-2">
                {pulling ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <RefreshCw className="w-4 h-4" />
                )}
                {pulling ? 'Pulling...' : `Pull from ${storeName}`}
              </span>
              {pulling && pullProgress && (
                <span className="text-xs text-neutral-400 font-normal">{pullProgress}</span>
              )}
            </button>
            <button
              onClick={handlePushClick}
              disabled={pushing || pulling || hasChanges || !hasStoreConnection}
              title={!hasStoreConnection ? `Connect to ${storeConnectName} first` : hasChanges ? 'Save changes first' : ''}
              className="flex flex-col items-center justify-center gap-1 px-4 py-2.5 rounded-xl text-sm font-medium
                       bg-gradient-to-r from-purple-500 to-blue-500 text-white
                       hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              <span className="flex items-center gap-2">
                {pushing ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <RefreshCw className="w-4 h-4" />
                )}
                {pushing ? 'Pushing...' : `Push to ${storeName}`}
              </span>
            </button>
            <button
              onClick={() => setImportModalOpen(true)}
              className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium
                       bg-white/[0.05] text-white border border-white/[0.08]
                       hover:bg-white/[0.08] transition-all"
            >
              <Download className="w-4 h-4" />
              Import from MCP
            </button>
            {project?.linkedProjectId && (
              <button
                onClick={handleSyncFromLinked}
                disabled={syncingFromLinked}
                className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium
                         bg-purple-500/10 text-purple-400 border border-purple-500/20
                         hover:bg-purple-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                {syncingFromLinked ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Link2 className="w-4 h-4" />
                )}
                {syncingFromLinked
                  ? 'Importing...'
                  : `Import from ${linkedProjectName || (project.storeType === 'ios' ? 'Android' : 'iOS')} project`}
              </button>
            )}
          </div>

          {/* Progress indicator when pulling */}
          {pulling && (
            <div className="mt-3 pt-3 border-t border-white/[0.05]">
              <div className="h-1.5 bg-white/[0.05] rounded-full overflow-hidden">
                <div className="h-full bg-gradient-to-r from-purple-500 to-blue-500 rounded-full animate-pulse" style={{ width: '100%' }} />
              </div>
              <p className="text-xs text-neutral-500 mt-2 text-center">
                {pullProgress || 'Please wait...'}
              </p>
            </div>
          )}

          {/* Progress indicator when pushing */}
          {(pushing || isPushPolling) && pushJob && (
            <div
              className="mt-3 pt-3 border-t border-white/[0.05] cursor-pointer hover:bg-white/[0.02] -mx-3 px-3 py-2 rounded-lg transition-colors"
              onClick={() => setShowPushProgressDialog(true)}
              title="Click to view details"
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <CloudUpload className="w-4 h-4 text-purple-400 animate-pulse" />
                  <span className="text-sm font-medium text-white">
                    {pushJob.status === 'pending' ? 'Starting push...' : `Pushing to ${storeName}`}
                  </span>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    handleCancelPush()
                  }}
                  className="text-xs text-neutral-400 hover:text-red-400 transition-colors flex items-center gap-1"
                >
                  <X className="w-3 h-3" />
                  Cancel
                </button>
              </div>

              {/* Status message from server */}
              {pushJob.statusMessage && (
                <p className="text-xs text-purple-300 mb-2 truncate">
                  {pushJob.statusMessage}
                </p>
              )}

              <div className="h-2 bg-white/[0.05] rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-purple-500 to-blue-500 rounded-full transition-all duration-500"
                  style={{
                    width: pushJob.progress.totalScreenshots > 0
                      ? `${Math.round((pushJob.progress.currentScreenshots / pushJob.progress.totalScreenshots) * 100)}%`
                      : '0%'
                  }}
                />
              </div>
              <div className="flex justify-between items-center mt-2">
                <p className="text-xs text-neutral-500">
                  {pushJob.progress.currentScreenshots} / {pushJob.progress.totalScreenshots} screenshots
                </p>
                {pushJob.progress.totalScreenshots > 0 && (
                  <p className="text-xs text-purple-400 font-medium">
                    {Math.round((pushJob.progress.currentScreenshots / pushJob.progress.totalScreenshots) * 100)}%
                  </p>
                )}
              </div>
              {pushJob.results.length > 0 && (
                <div className="flex items-center gap-3 mt-2 text-xs">
                  {pushJob.results.filter(r => r.success).length > 0 && (
                    <span className="flex items-center gap-1 text-green-400">
                      <CheckCircle2 className="w-3 h-3" />
                      {pushJob.results.filter(r => r.success).length} success
                    </span>
                  )}
                  {pushJob.results.filter(r => !r.success).length > 0 && (
                    <span className="flex items-center gap-1 text-red-400">
                      <AlertCircle className="w-3 h-3" />
                      {pushJob.results.filter(r => !r.success).length} failed
                    </span>
                  )}
                </div>
              )}

              {/* Click hint */}
              <p className="text-[10px] text-neutral-600 mt-2 text-center">Click for details</p>
            </div>
          )}
        </div>
      </div>

      {/* Success/Error Messages */}
      {successMessage && (
        <div className="mb-4 p-3 rounded-xl bg-green-500/10 border border-green-500/20 text-green-400 text-sm flex items-center gap-2">
          <Check className="w-4 h-4" />
          {successMessage}
        </div>
      )}
      {error && (
        <div className="mb-4 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm flex items-center gap-2">
          <X className="w-4 h-4" />
          {error}
          <button onClick={() => setError(null)} className="ml-auto">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Language Sidebar */}
        <div className="lg:col-span-1">
          <div className="rounded-2xl bg-white/[0.02] border border-white/[0.08] overflow-hidden sticky top-6">
            {/* Header with count */}
            <div className="px-4 py-3 border-b border-white/[0.08] flex items-center justify-between">
              <span className="text-sm font-medium text-white">Languages</span>
              <span className="px-2 py-0.5 rounded-full bg-white/[0.08] text-xs text-neutral-400">
                {project?.enabledLocales?.length || 0}
              </span>
            </div>

            {/* Manage Languages Link */}
            <div className="px-4 py-2.5 border-b border-white/[0.08]">
              <a
                href={`/projects/${projectId}/metadata`}
                className="flex items-center justify-center gap-2 text-xs text-neutral-500 hover:text-neutral-300 transition-colors"
              >
                <Globe className="w-3.5 h-3.5" />
                Manage languages in Metadata
              </a>
            </div>

            {/* Translation Status Header */}
            {translating && translationTargetLocales.length > 0 && (
              <div className="px-4 py-3 border-b border-white/[0.08] bg-purple-500/5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Loader2 className="w-4 h-4 text-purple-400 animate-spin" />
                    <span className="text-xs text-purple-300">
                      Translating to {translationTargetLocales.length} language{translationTargetLocales.length !== 1 ? 's' : ''}...
                    </span>
                  </div>
                  <button
                    onClick={() => setCancelConfirmOpen(true)}
                    className="px-2 py-1 rounded-lg text-xs font-medium text-red-400 hover:text-red-300 hover:bg-red-500/10 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
                {/* Overall progress bar */}
                <div className="mt-2 h-1 bg-white/[0.05] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-purple-500 to-pink-500 transition-all duration-300"
                    style={{
                      width: translationJob
                        ? `${Math.round((translationJob.progress.current / Math.max(translationJob.progress.total, 1)) * 100)}%`
                        : '0%',
                    }}
                  />
                </div>
                <p className="mt-1 text-[10px] text-neutral-500">
                  {translationJob?.progress.current || 0} / {translationJob?.progress.total || 0} screenshots
                </p>
              </div>
            )}

            {/* Locale List */}
            <div className="max-h-[calc(100vh-480px)] min-h-[300px] overflow-y-auto scrollbar-dark">
              {project?.enabledLocales
                ?.slice()
                .sort((a, b) => {
                  if (a === project.primaryLocale) return -1
                  if (b === project.primaryLocale) return 1
                  return getLocaleName(a).localeCompare(getLocaleName(b))
                })
                .map((locale) => {
                  const isPrimary = locale === project.primaryLocale
                  const isSelected = locale === selectedLocale
                  const hasOwnScreenshots = localeHasTranslations(locale)
                  const syncStatus = getLocaleSyncStatus(locale)
                  const localeProgress = translating
                    ? getLocaleProgress(locale, translationJob, translationTargetLocales)
                    : null
                  const failedInfo = failedLocales[locale]
                  const isBeingRetried = retryingLocale === locale
                  const isBeingTranslated = translationTargetLocales.includes(locale) && !localeProgress

                  return (
                    <div
                      key={locale}
                      onClick={() => setSelectedLocale(locale)}
                      className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-all border-l-2 cursor-pointer ${
                        isSelected
                          ? 'bg-purple-500/10 border-l-purple-500'
                          : failedInfo && !isBeingRetried
                            ? 'border-l-red-500/50 hover:bg-red-500/5'
                            : 'border-l-transparent hover:bg-white/[0.03]'
                      }`}
                    >
                      <span className="text-xl">{getLocaleFlag(locale)}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span
                            className={`text-sm font-medium truncate ${
                              isSelected ? 'text-white' : 'text-neutral-300'
                            }`}
                          >
                            {getLocaleName(locale)}
                          </span>
                          {isPrimary && <Star className="w-3 h-3 text-amber-400" />}
                        </div>

                        {/* Sync status indicator */}
                        {!isPrimary && !localeProgress && !isBeingTranslated && !failedInfo && syncStatus === 'needs_translation' && (
                          <div className="mt-1">
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-neutral-500/20 text-neutral-400 text-[10px] font-medium">
                              <Globe className="w-2.5 h-2.5" />
                              Untranslated
                            </span>
                          </div>
                        )}
                        {!isPrimary && !localeProgress && !isBeingTranslated && !failedInfo && syncStatus === 'needs_sync' && (
                          <div className="mt-1">
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-400 text-[10px] font-medium">
                              <RefreshCw className="w-2.5 h-2.5" />
                              Needs sync
                            </span>
                          </div>
                        )}

                        {/* Translation progress indicator */}
                        {localeProgress && (
                          <div className="mt-1.5">
                            <div className="flex items-center gap-1.5">
                              {/* Progress bar */}
                              <div className="flex-1 h-1 bg-white/[0.08] rounded-full overflow-hidden">
                                <div
                                  className={`h-full transition-all duration-300 ${
                                    localeProgress.isComplete
                                      ? localeProgress.failCount > 0
                                        ? 'bg-amber-500'
                                        : 'bg-green-500'
                                      : localeProgress.isProcessing
                                        ? 'bg-gradient-to-r from-purple-500 to-pink-500 animate-pulse'
                                        : localeProgress.isPending
                                          ? 'bg-neutral-600'
                                          : 'bg-purple-500'
                                  }`}
                                  style={{
                                    width: localeProgress.isComplete
                                      ? '100%'
                                      : `${Math.round(((localeProgress.successCount + localeProgress.failCount) / Math.max(localeProgress.total, 1)) * 100)}%`,
                                  }}
                                />
                              </div>

                              {/* Status indicator */}
                              {localeProgress.isComplete ? (
                                localeProgress.failCount > 0 ? (
                                  <AlertTriangle className="w-3 h-3 text-amber-400 flex-shrink-0" />
                                ) : (
                                  <CheckCircle2 className="w-3 h-3 text-green-400 flex-shrink-0" />
                                )
                              ) : localeProgress.isProcessing ? (
                                <Loader2 className="w-3 h-3 text-purple-400 animate-spin flex-shrink-0" />
                              ) : localeProgress.isPending ? (
                                <Clock className="w-3 h-3 text-neutral-500 flex-shrink-0" />
                              ) : null}
                            </div>

                            {/* Progress text */}
                            <p className="text-[10px] text-neutral-500 mt-0.5">
                              {localeProgress.isComplete ? (
                                localeProgress.failCount > 0 ? (
                                  <span className="text-amber-400">
                                    {localeProgress.successCount}/{localeProgress.total} ({localeProgress.failCount} failed)
                                  </span>
                                ) : (
                                  <span className="text-green-400">Complete</span>
                                )
                              ) : localeProgress.isProcessing ? (
                                <span className="text-purple-300">Processing...</span>
                              ) : localeProgress.isPending ? (
                                <span>Pending</span>
                              ) : (
                                <span>{localeProgress.successCount + localeProgress.failCount}/{localeProgress.total}</span>
                              )}
                            </p>
                          </div>
                        )}

                        {/* Failed translation with retry */}
                        {!localeProgress && failedInfo && !isBeingRetried && (
                          <div className="mt-1.5">
                            <div className="flex items-center gap-1.5">
                              <AlertCircle className="w-3 h-3 text-red-400 flex-shrink-0" />
                              <span className="text-[10px] text-red-400">
                                {failedInfo.count} failed
                              </span>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  handleRetryLocale(locale)
                                }}
                                disabled={translating}
                                className="ml-auto flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors disabled:opacity-50"
                              >
                                <RefreshCw className="w-2.5 h-2.5" />
                                Retry
                              </button>
                            </div>
                          </div>
                        )}

                        {/* Translating state (waiting for progress data) */}
                        {!localeProgress && isBeingTranslated && !failedInfo && (
                          <div className="mt-1.5 flex items-center gap-1.5">
                            <Loader2 className="w-3 h-3 text-purple-400 animate-spin flex-shrink-0" />
                            <span className="text-[10px] text-purple-300">Translating...</span>
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
            </div>
          </div>
        </div>

        {/* Main Content */}
        <div className="lg:col-span-3">
          <div className="rounded-2xl bg-white/[0.02] border border-white/[0.08] p-6">
            {/* Language Header */}
            {selectedLocale && (
              <div className="flex items-center justify-between mb-6 pb-4 border-b border-white/[0.08]">
                <div className="flex items-center gap-3">
                  <span className="text-2xl">{getLocaleFlag(selectedLocale)}</span>
                  <div>
                    <h2 className="text-lg font-semibold text-white">{getLocaleName(selectedLocale)}</h2>
                    <p className="text-xs text-neutral-500">{selectedLocale}</p>
                  </div>
                  {isPrimaryLocale && (
                    <span className="px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 text-xs font-medium border border-amber-500/20">
                      Primary
                    </span>
                  )}
                </div>
{isPrimaryLocale && (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setShowTranslationHelp(true)}
                      className="p-2 rounded-xl text-neutral-400 hover:text-white hover:bg-white/[0.05] transition-colors"
                      title="How screenshot translation works"
                    >
                      <HelpCircle className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => setTranslateModalOpen(true)}
                      disabled={translating || Object.keys(screenshotSets).length === 0 || (project?.enabledLocales?.length || 0) <= 1}
                      className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium
                               bg-gradient-to-r from-purple-500 to-pink-500 text-white
                               hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                      title={(project?.enabledLocales?.length || 0) <= 1 ? 'Add more languages first' : ''}
                    >
                      <Languages className="w-4 h-4" />
                      Translate
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Translating Notice */}
            {selectedLocale && !isPrimaryLocale && translationTargetLocales.includes(selectedLocale) && (
              <div className="mb-4 p-4 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-start gap-3">
                <div className="relative mt-0.5">
                  <Languages className="w-5 h-5 text-purple-400 flex-shrink-0" />
                  <div className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-purple-500 rounded-full animate-pulse" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium text-purple-400">Translating Screenshots...</p>
                  <p className="text-xs text-neutral-400 mt-1">
                    AI is currently translating screenshots to {getLocaleName(selectedLocale)}. This may take a few minutes.
                  </p>
                  {translationJob && (() => {
                    // Calculate locale-specific progress
                    const localeProgress = getLocaleProgress(selectedLocale, translationJob, translationTargetLocales)
                    if (!localeProgress) return null
                    const current = localeProgress.successCount + localeProgress.failCount
                    const total = localeProgress.total
                    const percent = total > 0 ? Math.round((current / total) * 100) : 0
                    return (
                      <div className="mt-3">
                        <div className="flex items-center justify-between text-[10px] text-neutral-500 mb-1">
                          <span>Progress</span>
                          <span>{current} / {total}</span>
                        </div>
                        <div className="h-1.5 bg-white/[0.08] rounded-full overflow-hidden">
                          <div
                            className="h-full bg-gradient-to-r from-purple-500 to-pink-500 transition-all duration-300"
                            style={{ width: `${percent}%` }}
                          />
                        </div>
                      </div>
                    )
                  })()}
                </div>
              </div>
            )}

            {/* Failed Translation Notice */}
            {selectedLocale && !isPrimaryLocale && failedLocales[selectedLocale] && !translationTargetLocales.includes(selectedLocale) && (
              <div className="mb-4 p-4 rounded-xl bg-red-500/10 border border-red-500/20 flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-red-400">Translation Failed</p>
                  <p className="text-xs text-neutral-400 mt-1">
                    {failedLocales[selectedLocale].count} screenshot{failedLocales[selectedLocale].count !== 1 ? 's' : ''} failed to translate to {getLocaleName(selectedLocale)}.
                  </p>
                  <button
                    onClick={() => handleRetryLocale(selectedLocale)}
                    disabled={translating}
                    className="mt-3 flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors disabled:opacity-50"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    Retry Translation
                  </button>
                </div>
              </div>
            )}

            {/* Using Primary Notice */}
            {selectedLocale && !isPrimaryLocale && !localeHasTranslations(selectedLocale) && !translationTargetLocales.includes(selectedLocale) && !failedLocales[selectedLocale] && (
              <div className="mb-4 p-4 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-start gap-3">
                <Languages className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-blue-400">Using Primary Language Screenshots</p>
                  <p className="text-xs text-neutral-400 mt-1">
                    {getLocaleName(selectedLocale)} doesn't have its own screenshots yet. It's currently using screenshots from {getLocaleName(project?.primaryLocale || '')}.
                    Switch to {getLocaleName(project?.primaryLocale || '')} and use the Translate button to generate localized versions.
                  </p>
                </div>
              </div>
            )}

            {/* Resumable Jobs Banner */}
            {isPrimaryLocale && resumableJobs.length > 0 && !translating && (
              <div className="mb-4 p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium text-amber-400">Incomplete Translations</p>
                    <button
                      onClick={() => setIncompleteJobsModalOpen(true)}
                      className="text-xs text-amber-400 hover:text-amber-300 underline"
                    >
                      View all ({resumableJobs.length})
                    </button>
                  </div>
                  <p className="text-xs text-neutral-400 mt-1">
                    {resumableJobs.length} translation job{resumableJobs.length !== 1 ? 's' : ''} didn't complete fully. Resume or dismiss them.
                  </p>
                  <div className="mt-3 space-y-2">
                    {resumableJobs.slice(0, 2).map((job) => {
                      const pending = job.progress.total - job.successCount - job.failCount
                      return (
                        <div key={job.jobId} className="flex items-center justify-between p-2 rounded-lg bg-white/[0.03]">
                          <div className="flex items-center gap-2 text-xs">
                            <span className="text-neutral-400">
                              {job.config.targetLocales.slice(0, 2).map(l => getLocaleName(l)).join(', ')}
                              {job.config.targetLocales.length > 2 && ` +${job.config.targetLocales.length - 2}`}
                            </span>
                            <span className="text-neutral-500">•</span>
                            <span className="text-green-400">{job.successCount} done</span>
                            {job.failCount > 0 && (
                              <>
                                <span className="text-neutral-500">•</span>
                                <span className="text-red-400">{job.failCount} failed</span>
                              </>
                            )}
                            {pending > 0 && (
                              <>
                                <span className="text-neutral-500">•</span>
                                <span className="text-amber-400">{pending} left</span>
                              </>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => deleteResumableJob(job.jobId)}
                              className="p-1 rounded text-neutral-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                              title="Dismiss"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={async () => {
                                // Clear any pending completion cleanup from a previous job
                                completedJobIdRef.current = null
                                setTranslating(true)
                                setTranslationTargetLocales(job.config.targetLocales)
                                const result = await resumeTranslationJob(job.jobId)
                                if (!result) {
                                  setTranslating(false)
                                  setTranslationTargetLocales([])
                                } else if (result.alreadyComplete) {
                                  showSuccess('All screenshots already translated!')
                                  setTranslating(false)
                                  setTranslationTargetLocales([])
                                  refreshResumableJobs()
                                }
                              }}
                              className="px-3 py-1 rounded-lg text-xs font-medium bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 transition-colors"
                            >
                              Resume
                            </button>
                          </div>
                        </div>
                      )
                    })}
                    {resumableJobs.length > 2 && (
                      <button
                        onClick={() => setIncompleteJobsModalOpen(true)}
                        className="w-full py-2 text-xs text-neutral-400 hover:text-white transition-colors"
                      >
                        +{resumableJobs.length - 2} more incomplete job{resumableJobs.length - 2 !== 1 ? 's' : ''}...
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Retry All Failed Banner - shows on primary locale when any locale has failures */}
            {isPrimaryLocale && failedLocaleCount > 0 && !translating && (
              <div className="mb-4 p-4 rounded-xl bg-red-500/10 border border-red-500/20 flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium text-red-400">Failed Translations</p>
                    <span className="text-xs text-neutral-400">
                      {failedLocaleCount} locale{failedLocaleCount !== 1 ? 's' : ''}
                    </span>
                  </div>
                  <p className="text-xs text-neutral-400 mt-1">
                    {totalFailedCount} screenshot{totalFailedCount !== 1 ? 's' : ''} failed across {Object.keys(failedLocales).map(l => getLocaleName(l)).join(', ')}.
                  </p>
                  <button
                    onClick={handleRetryAllFailed}
                    disabled={retryingLocale === 'all'}
                    className="mt-3 flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors disabled:opacity-50"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${retryingLocale === 'all' ? 'animate-spin' : ''}`} />
                    {retryingLocale === 'all' ? 'Retrying...' : 'Retry All Failed'}
                  </button>
                </div>
              </div>
            )}

            {/* Feature Graphic Section (Android only) */}
            {isAndroid && (
              <div className="rounded-2xl bg-white/[0.02] border border-green-500/20 overflow-hidden mb-4">
                {/* Section Header */}
                <div className="px-5 py-4 border-b border-white/[0.06] bg-green-500/5">
                  <div className="flex items-center gap-3">
                    <LayoutTemplate className="w-5 h-5 text-green-400" />
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-semibold text-white">Feature Graphic</h3>
                        <span className="text-xs text-neutral-400">1024 × 500 · Landscape</span>
                        {featureGraphicSet?.screenshots?.length ? (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                            <CheckCircle2 className="w-3 h-3 inline mr-0.5" />
                            Complete
                          </span>
                        ) : (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-500/10 text-red-400 border border-red-500/20">
                            Required
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-neutral-400 mt-0.5">
                        Displayed prominently above screenshots in the Play Store listing. One per locale.
                      </p>
                    </div>
                    {featureGraphicSet?.syncStatus && (
                      <SyncStatusBadge status={featureGraphicSet.syncStatus} />
                    )}
                  </div>
                </div>

                {/* Feature Graphic Content */}
                <div className="p-5">
                  {featureGraphicSet?.screenshots?.[0] ? (
                    <div className="space-y-3">
                      {/* Landscape preview */}
                      <div className="relative group" style={{ maxWidth: '640px' }}>
                        <div className="relative w-full rounded-xl overflow-hidden" style={{ aspectRatio: '1024/500' }}>
                          <OptimizedImage
                            src={featureGraphicSet.screenshots[0].marketingImageUrl}
                            alt="Feature Graphic"
                            className="w-full h-full object-cover absolute inset-0"
                          />
                        </div>
                        {/* Hover overlay with actions */}
                        <div className="absolute inset-0 flex items-center justify-center gap-3 opacity-0 group-hover:opacity-100 transition-opacity bg-black/40 rounded-xl">
                          <button
                            onClick={() => {
                              setEditingScreenshot({
                                deviceType: 'PLAY_FEATURE_GRAPHIC',
                                screenshot: featureGraphicSet!.screenshots[0],
                                locale: selectedLocale,
                                isTranslated: false,
                                rawImageUrl: featureGraphicSet!.screenshots[0].rawImageUrl,
                              })
                              setEditModalOpen(true)
                            }}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-purple-500/20 text-purple-300 hover:bg-purple-500/30 text-xs font-medium"
                            title="Edit with AI"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                            Edit
                          </button>
                          <button
                            onClick={() => {
                              setEditingScreenshot({
                                deviceType: 'PLAY_FEATURE_GRAPHIC',
                                screenshot: featureGraphicSet!.screenshots[0],
                                locale: selectedLocale,
                                isTranslated: false,
                                rawImageUrl: featureGraphicSet!.screenshots[0].rawImageUrl,
                                initialPrompt: 'Adjust the headline and subtitle text to fit better within the banner. Fix any text overflow, truncation, or insufficient margins. Ensure proper spacing and readability.',
                              })
                              setEditModalOpen(true)
                            }}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 text-xs font-medium"
                            title="Fix text fitting"
                          >
                            <Type className="w-3.5 h-3.5" />
                            Fix Text
                          </button>
                          <button
                            onClick={() => {
                              // Delete the feature graphic
                              setScreenshotSets(prev => {
                                const updated = { ...prev }
                                delete updated['PLAY_FEATURE_GRAPHIC']
                                return updated
                              })
                              setHasChanges(true)
                            }}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/20 text-red-300 hover:bg-red-500/30 text-xs font-medium"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            Delete
                          </button>
                          <button
                            onClick={() => {
                              // Pre-populate headline from existing feature graphic
                              setFgHeadline(featureGraphicSet?.screenshots?.[0]?.headline || '')
                              // Clear existing, show form for regeneration
                              setScreenshotSets(prev => {
                                const updated = { ...prev }
                                delete updated['PLAY_FEATURE_GRAPHIC']
                                return updated
                              })
                              setFgShowForm(true)
                              setHasChanges(true)
                            }}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-purple-500/20 text-purple-300 hover:bg-purple-500/30 text-xs font-medium"
                          >
                            <Sparkles className="w-3.5 h-3.5" />
                            Regenerate
                          </button>
                        </div>
                      </div>
                      {featureGraphicSet.screenshots[0].headline && (
                        <p className="text-xs text-neutral-400">
                          Headline: &quot;{featureGraphicSet.screenshots[0].headline}&quot;
                        </p>
                      )}
                    </div>
                  ) : (
                    /* Empty state / Generate form */
                    <div className="border-2 border-dashed border-white/[0.10] rounded-xl p-8">
                      {fgShowForm ? (
                        /* Inline generation form */
                        <div className="max-w-md mx-auto space-y-4">
                          <div className="text-center mb-2">
                            <Sparkles className="w-6 h-6 text-purple-400 mx-auto mb-1" />
                            <h4 className="text-sm font-semibold text-white">Generate Feature Graphic</h4>
                            <p className="text-xs text-neutral-400">Enter a short marketing tagline for your banner</p>
                          </div>
                          <input
                            type="text"
                            value={fgHeadline}
                            onChange={(e) => setFgHeadline(e.target.value)}
                            placeholder="e.g. Track your fitness journey"
                            maxLength={60}
                            className="w-full px-3 py-2 rounded-lg bg-white/[0.05] border border-white/[0.10] text-sm text-white placeholder:text-neutral-500 focus:outline-none focus:ring-1 focus:ring-purple-500/50"
                          />
                          <div className="flex items-center justify-center gap-3">
                            <button
                              onClick={async () => {
                                if (!fgHeadline.trim()) return
                                setFgGenerating(true)
                                setError(null)
                                try {
                                  const response = await fetch('/api/screenshots/generate', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({
                                      projectId,
                                      displayType: 'PLAY_FEATURE_GRAPHIC',
                                      headline: fgHeadline.trim(),
                                      rawImages: [],
                                      styleConfig: { type: 'category', category: appMetadata?.category || 'utilities' },
                                      locale: selectedLocale || project?.primaryLocale || 'en-US',
                                      appMetadata,
                                    }),
                                  })
                                  const data = await response.json()
                                  if (!response.ok || !data.success) throw new Error(data.error || 'Generation failed')
                                  setScreenshotSets(prev => ({ ...prev, 'PLAY_FEATURE_GRAPHIC': data.screenshotSet }))
                                  setHasChanges(true)
                                  setFgShowForm(false)
                                  setFgHeadline('')
                                  showSuccess('Feature graphic generated!')
                                } catch (err) {
                                  setError(err instanceof Error ? err.message : 'Failed to generate feature graphic')
                                } finally {
                                  setFgGenerating(false)
                                }
                              }}
                              disabled={!fgHeadline.trim() || fgGenerating}
                              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-purple-500/20 text-purple-400 hover:bg-purple-500/30 text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              {fgGenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                              {fgGenerating ? 'Generating...' : 'Generate'}
                            </button>
                            <button
                              onClick={() => { setFgShowForm(false); setFgHeadline('') }}
                              className="px-4 py-2 rounded-xl bg-white/[0.05] text-neutral-400 hover:bg-white/[0.08] text-sm font-medium transition-colors"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        /* Initial empty state */
                        <div className="text-center">
                          <LayoutTemplate className="w-8 h-8 text-neutral-500 mx-auto mb-3" />
                          <p className="text-sm text-neutral-400 mb-1">
                            No feature graphic yet
                          </p>
                          <p className="text-xs text-neutral-500 mb-4">
                            A standalone promotional banner — no screenshot required. Just provide a tagline.
                          </p>
                          <div className="flex items-center justify-center gap-3">
                            <button
                              onClick={() => setFgShowForm(true)}
                              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-purple-500/20 text-purple-400 hover:bg-purple-500/30 text-sm font-medium transition-colors"
                            >
                              <Sparkles className="w-4 h-4" />
                              Generate with AI
                            </button>
                            <label className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/[0.05] text-neutral-300 hover:bg-white/[0.08] text-sm font-medium transition-colors cursor-pointer">
                              <Upload className="w-4 h-4" />
                              Upload
                          <input
                            type="file"
                            accept="image/png,image/jpeg,image/webp"
                            className="hidden"
                            onChange={async (e) => {
                              const file = e.target.files?.[0]
                              if (!file) return
                              try {
                                const formData = new FormData()
                                formData.append('projectId', projectId as string)
                                formData.append('files', file)
                                const uploadRes = await fetch('/api/screenshots/upload-images', {
                                  method: 'POST',
                                  body: formData,
                                })
                                const uploadData = await uploadRes.json()
                                if (!uploadData.success) throw new Error(uploadData.error || 'Upload failed')

                                const r = uploadData.results[0]
                                setScreenshotSets(prev => ({
                                  ...prev,
                                  'PLAY_FEATURE_GRAPHIC': {
                                    id: 'PLAY_FEATURE_GRAPHIC',
                                    displayType: 'PLAY_FEATURE_GRAPHIC' as ScreenshotDisplayType,
                                    locale: selectedLocale || project?.primaryLocale || 'en-US',
                                    screenshots: [{
                                      id: `fg-upload-${Date.now()}`,
                                      position: 0,
                                      rawImageUrl: null,
                                      rawImageKey: null,
                                      marketingImageUrl: r.url,
                                      marketingImageKey: r.key,
                                      headline: '',
                                      generatedWith: null,
                                      styleSource: null,
                                      createdAt: null as any,
                                      updatedAt: null as any,
                                    }],
                                    styleConfig: null,
                                    syncStatus: 'local_changes' as ScreenshotSyncStatus,
                                    lastPulledAt: null,
                                    lastPushedAt: null,
                                    createdAt: null as any,
                                    updatedAt: null as any,
                                    createdBy: '',
                                  },
                                }))
                                setHasChanges(true)
                                showSuccess('Feature graphic uploaded')
                              } catch (err) {
                                setError(err instanceof Error ? err.message : 'Upload failed')
                              }
                              e.target.value = '' // reset input
                            }}
                          />
                        </label>
                      </div>
                    </div>
                  )}
                </div>
                  )}
                </div>
              </div>
            )}

            {/* Device Types Content */}
            <div className="space-y-4">
            {storeDisplayTypes
              .sort(([aType], [bType]) => {
                const aHasScreenshots = (screenshotSets[aType]?.screenshots?.length || 0) > 0
                const bHasScreenshots = (screenshotSets[bType]?.screenshots?.length || 0) > 0
                if (aHasScreenshots && !bHasScreenshots) return -1
                if (!aHasScreenshots && bHasScreenshots) return 1
                return 0
              })
              .map(([deviceType, info]) => {
              const isExpanded = expandedDevices.has(deviceType)
              // Use getScreenshotsForLocale to get locale-specific screenshots
              const screenshots = getScreenshotsForLocale(deviceType)
              const hasScreenshots = screenshots.length > 0
              // Calculate translation status for this device type
              const translatedCount = screenshots.filter((s: any) => s.isLocalized).length
              const pendingCount = screenshots.filter((s: any) => s.isPendingTranslation).length
              const isFullyTranslated = !isPrimaryLocale && hasScreenshots && pendingCount === 0
              const isPartiallyTranslated = !isPrimaryLocale && hasScreenshots && translatedCount > 0 && pendingCount > 0
              const isNotTranslated = !isPrimaryLocale && hasScreenshots && translatedCount === 0

              return (
                <div
                  key={deviceType}
                  className="rounded-2xl bg-white/[0.02] border border-white/[0.08] overflow-hidden"
                >
                  {/* Device Header */}
                  <div
                    onClick={() => toggleDeviceExpanded(deviceType)}
                    className="px-5 py-4 flex items-center justify-between cursor-pointer hover:bg-white/[0.02] transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-neutral-400">{DEVICE_ICONS[deviceType]}</span>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-white">{info.name}</span>
                          {/* Show translation status badge for non-primary locales */}
                          {isFullyTranslated && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                              ✓ Translated
                            </span>
                          )}
                          {isPartiallyTranslated && (
                            <button
                              onClick={() => setTranslateModalOpen(true)}
                              className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20 hover:bg-amber-500/20 hover:border-amber-500/40 transition-colors cursor-pointer"
                            >
                              {translatedCount}/{screenshots.length} translated
                            </button>
                          )}
                          {isNotTranslated && (
                            <button
                              onClick={() => setTranslateModalOpen(true)}
                              className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20 hover:bg-amber-500/20 hover:border-amber-500/40 transition-colors cursor-pointer"
                            >
                              Translate
                            </button>
                          )}
                          {/* Show requirement status badge */}
                          {(() => {
                            // Find if there's a fallback for this device type
                            const fallbackDevice = storeDisplayTypes.find(
                              ([_, d]) => d.fallbackFor === deviceType
                            )
                            const fallbackHasScreenshots = fallbackDevice
                              ? (screenshotSets[fallbackDevice[0]]?.screenshots?.length || 0) > 0
                              : false

                            // Check if the primary (if this is a fallback) has screenshots
                            const primaryHasScreenshots = info.fallbackFor
                              ? (screenshotSets[info.fallbackFor]?.screenshots?.length || 0) > 0
                              : false

                            // For 'required' types: required unless fallback is provided
                            if (info.requirement === 'required') {
                              if (hasScreenshots) {
                                return (
                                  <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                                    ✓ Complete
                                  </span>
                                )
                              }
                              if (fallbackDevice && fallbackHasScreenshots) {
                                return (
                                  <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-neutral-500/10 text-neutral-500 border border-neutral-500/20">
                                    Optional ({fallbackDevice[1].name} provided)
                                  </span>
                                )
                              }
                              return (
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20">
                                  {fallbackDevice
                                    ? `Required if ${fallbackDevice[1].name} not provided`
                                    : 'Required'}
                                </span>
                              )
                            }

                            // For 'fallback' types: required only if primary is not provided
                            if (info.requirement === 'fallback' && info.fallbackFor) {
                              const primaryName = SCREENSHOT_DISPLAY_TYPES[info.fallbackFor].name
                              if (hasScreenshots) {
                                return (
                                  <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                                    ✓ Complete
                                  </span>
                                )
                              }
                              if (primaryHasScreenshots) {
                                return (
                                  <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-neutral-500/10 text-neutral-500 border border-neutral-500/20">
                                    Optional ({primaryName} provided)
                                  </span>
                                )
                              }
                              return (
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20">
                                  Required if {primaryName} not provided
                                </span>
                              )
                            }

                            // For 'optional' types
                            if (info.requirement === 'optional') {
                              if (hasScreenshots) {
                                return (
                                  <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                                    ✓ Complete
                                  </span>
                                )
                              }
                              return (
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-neutral-500/10 text-neutral-500 border border-neutral-500/20">
                                  Optional
                                </span>
                              )
                            }

                            return null
                          })()}
                        </div>
                        <span className="text-xs text-neutral-500">
                          {info.width}×{info.height}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      {hasScreenshots && (() => {
                        // Check if this locale has translated screenshots
                        const hasLocalizedScreenshots = screenshots.some((s: any) => s.isLocalized)
                        return (
                          <>
                            <span className="px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 text-xs">
                              {screenshots.length} / 10
                            </span>
                            {/* Retranslate button for non-primary locales with translations */}
                            {!isPrimaryLocale && hasLocalizedScreenshots && !screenshots.some((s: any) => isScreenshotTranslating(s.id, selectedLocale)) && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  handleRetranslateDeviceSet(deviceType)
                                }}
                                className="p-1.5 rounded-lg text-neutral-500 hover:text-purple-400 hover:bg-purple-500/10 transition-colors"
                                title="Retranslate this device set"
                              >
                                <Languages className="w-4 h-4" />
                              </button>
                            )}
                            {/* Delete button - only for primary locale */}
                            {isPrimaryLocale && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setDeleteConfirmOpen(deviceType)
                                }}
                                className="p-1.5 rounded-lg text-neutral-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                                title="Delete all screenshots for this device"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            )}
                          </>
                        )
                      })()}
                      {isExpanded ? (
                        <ChevronDown className="w-4 h-4 text-neutral-400" />
                      ) : (
                        <ChevronRight className="w-4 h-4 text-neutral-400" />
                      )}
                    </div>
                  </div>

                  {/* Screenshots Grid (when expanded) */}
                  {isExpanded && (
                    <div className="px-5 pb-5 pt-2 border-t border-white/[0.05]">
                      {hasScreenshots ? (
                        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                          {screenshots.map((screenshot, index) => (
                            <div
                              key={`${screenshot.id}-${selectedLocale}`}
                              draggable={isPrimaryLocale}
                              onDragStart={(e) => isPrimaryLocale && handleDragStart(e, deviceType, index)}
                              onDragEnd={handleDragEnd}
                              onDragOver={(e) => isPrimaryLocale && handleDragOver(e, index)}
                              onDragLeave={handleDragLeave}
                              onDrop={(e) => isPrimaryLocale && handleDrop(e, deviceType, index)}
                              className={`group relative bg-white/[0.03] rounded-xl overflow-hidden border transition-all ${
                                isPrimaryLocale ? 'cursor-grab active:cursor-grabbing' : 'cursor-default'
                              } ${
                                dragOverIndex === index && draggedItem?.deviceType === deviceType
                                  ? 'border-purple-500 ring-2 ring-purple-500/30'
                                  : 'border-white/[0.08]'
                              }`}
                              style={{ aspectRatio: `${info.width} / ${info.height}` }}
                            >
                              <OptimizedImage
                                key={screenshot.marketingImageUrl}
                                src={screenshot.marketingImageUrl}
                                alt={`Screenshot ${index + 1}`}
                                useThumbnail={true}
                                className="w-full h-full pointer-events-none"
                              />

                              {/* Drag handle - visible on hover (only for primary locale) */}
                              {isPrimaryLocale && (
                                <div className="absolute top-2 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity">
                                  <div className="px-2 py-1 bg-black/70 rounded-full flex items-center gap-1">
                                    <GripVertical className="w-3 h-3 text-white/70" />
                                    <span className="text-[10px] text-white/70">Drag</span>
                                  </div>
                                </div>
                              )}

                              {/* Overlay with actions */}
                              <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-wrap items-center justify-center content-center gap-x-1.5 gap-y-1 p-2 pointer-events-none group-hover:pointer-events-auto">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    setPreviewImage(screenshot.marketingImageUrl)
                                  }}
                                  className="p-2 bg-white/20 rounded-lg hover:bg-white/30 transition-colors"
                                  title="Preview"
                                >
                                  <Eye className="w-4 h-4 text-white" />
                                </button>
                                {/* Edit button - only show for primary locale or translated screenshots */}
                                {(isPrimaryLocale || (screenshot as any).isLocalized) && (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      // Get primary screenshot for context if editing translated
                                      const primaryScreenshot = screenshotSets[deviceType]?.screenshots?.find(s => s.id === screenshot.id)
                                      setEditingScreenshot({
                                        deviceType,
                                        screenshot,
                                        locale: selectedLocale,
                                        isTranslated: !isPrimaryLocale && !!(screenshot as any).isLocalized,
                                        rawImageUrl: primaryScreenshot?.rawImageUrl,
                                        primaryImageUrl: isPrimaryLocale ? undefined : primaryScreenshot?.marketingImageUrl,
                                      })
                                      setEditModalOpen(true)
                                    }}
                                    className="p-2 bg-purple-500/20 rounded-lg hover:bg-purple-500/30 transition-colors"
                                    title="Edit with AI"
                                  >
                                    <Pencil className="w-4 h-4 text-purple-400" />
                                  </button>
                                )}
                                {/* Fix Text button - quick action to fix text fitting issues */}
                                {(screenshot.marketingImageUrl || (screenshot as any).isLocalized) && (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      const primaryScreenshot = screenshotSets[deviceType]?.screenshots?.find(s => s.id === screenshot.id)
                                      setEditingScreenshot({
                                        deviceType,
                                        screenshot,
                                        locale: selectedLocale,
                                        isTranslated: !isPrimaryLocale && !!(screenshot as any).isLocalized,
                                        rawImageUrl: primaryScreenshot?.rawImageUrl,
                                        primaryImageUrl: isPrimaryLocale ? undefined : primaryScreenshot?.marketingImageUrl,
                                        initialPrompt: 'Adjust the headline and subtitle text to fit better within the screenshot. Fix any text overflow, truncation, or insufficient margins. Ensure proper spacing and readability.',
                                      })
                                      setEditModalOpen(true)
                                    }}
                                    className="p-2 bg-amber-500/20 rounded-lg hover:bg-amber-500/30 transition-colors"
                                    title="Fix text fitting"
                                  >
                                    <Type className="w-4 h-4 text-amber-400" />
                                  </button>
                                )}
                                {/* Retranslate button - only for translated screenshots */}
                                {!isPrimaryLocale && (screenshot as any).isLocalized && !isScreenshotTranslating(screenshot.id, selectedLocale) && (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      handleRetranslateScreenshot(deviceType, screenshot.id)
                                    }}
                                    className="p-2 bg-purple-500/20 rounded-lg hover:bg-purple-500/30 transition-colors"
                                    title="Retranslate this screenshot"
                                  >
                                    <Languages className="w-4 h-4 text-purple-400" />
                                  </button>
                                )}
                                {/* Delete button - only for primary locale */}
                                {isPrimaryLocale && (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      handleDeleteScreenshot(deviceType, screenshot.id)
                                    }}
                                    className="p-2 bg-red-500/20 rounded-lg hover:bg-red-500/30 transition-colors"
                                    title="Delete"
                                  >
                                    <Trash2 className="w-4 h-4 text-red-400" />
                                  </button>
                                )}
                              </div>

                              {/* Position badge */}
                              <div className="absolute bottom-2 left-2 px-2 py-0.5 bg-black/60 rounded text-xs text-white/80">
                                {index + 1}
                              </div>

                              {/* AI generated badge */}
                              {screenshot.generatedWith === 'gemini' && (
                                <div className="absolute top-2 right-2 p-1 bg-purple-500/80 rounded">
                                  <Sparkles className="w-3 h-3 text-white" />
                                </div>
                              )}

                              {/* Out-of-sync indicator - shows when source was updated after translation */}
                              {!isPrimaryLocale && (screenshot as any).isLocalized && (screenshot as any).isOutOfSync && !isScreenshotTranslating(screenshot.id, selectedLocale) && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    handleRetranslateScreenshot(deviceType, screenshot.id)
                                  }}
                                  className="absolute inset-0 bg-orange-500/10 border-2 border-orange-500/30 rounded-xl hover:bg-orange-500/20 hover:border-orange-500/50 transition-all cursor-pointer group"
                                >
                                  <div className="absolute top-2 left-2 px-2 py-1 bg-orange-500/90 group-hover:bg-orange-500 rounded-lg flex items-center gap-1.5 transition-colors">
                                    <AlertTriangle className="w-3 h-3 text-white" />
                                    <span className="text-[10px] font-medium text-white">Source updated</span>
                                  </div>
                                </button>
                              )}

                              {/* Translating indicator - shows when this specific screenshot is being translated for THIS locale */}
                              {/* Also shows for untranslated screenshots when a translation job is active and targeting this locale */}
                              {(isScreenshotTranslating(screenshot.id, selectedLocale) ||
                                (translating && (screenshot as any).isPendingTranslation && translationTargetLocales.includes(selectedLocale))) && (
                                <div className="absolute inset-0 bg-blue-500/20 border-2 border-blue-500/50 rounded-xl flex items-center justify-center">
                                  <div className="flex flex-col items-center gap-2">
                                    <Loader2 className="w-6 h-6 text-blue-400 animate-spin" />
                                    <span className="text-xs font-medium text-blue-300 bg-black/50 px-2 py-1 rounded">Translating...</span>
                                  </div>
                                </div>
                              )}

                              {/* Pending translation indicator - clickable to translate (hidden when a translation job is active) */}
                              {!isPrimaryLocale && (screenshot as any).isPendingTranslation && !isScreenshotTranslating(screenshot.id, selectedLocale) && !translating && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    handleTranslateScreenshot(deviceType, screenshot.id)
                                  }}
                                  className="absolute inset-0 bg-purple-500/10 border-2 border-purple-500/30 rounded-xl hover:bg-purple-500/20 hover:border-purple-500/50 transition-all cursor-pointer group"
                                >
                                  <div className="absolute top-2 left-2 px-2 py-1 bg-purple-500/90 group-hover:bg-purple-500 rounded-lg flex items-center gap-1.5 transition-colors">
                                    <Languages className="w-3 h-3 text-white" />
                                    <span className="text-[10px] font-medium text-white">Click to translate</span>
                                  </div>
                                </button>
                              )}
                            </div>
                          ))}

                          {/* Add more button (only for primary locale) */}
                          {!isReadOnly && isPrimaryLocale && screenshots.length < 10 && (
                            <div
                              className="bg-white/[0.02] rounded-xl border border-dashed border-white/[0.15] flex flex-col items-center justify-center gap-3 hover:bg-white/[0.05] hover:border-white/[0.25] transition-all"
                              style={{ aspectRatio: `${info.width} / ${info.height}` }}
                            >
                              <button
                                onClick={() => {
                                  setWizardDeviceType(deviceType as ScreenshotDisplayType)
                                  setWizardOpen(true)
                                }}
                                className="flex flex-col items-center gap-1 text-neutral-500 hover:text-purple-400 transition-colors"
                              >
                                <Sparkles className="w-4 h-4" />
                                <span className="text-[10px]">Generate</span>
                              </button>
                              <button
                                onClick={() => {
                                  setUploadTargetDevice(deviceType)
                                  directUploadRef.current?.click()
                                }}
                                disabled={uploadingDirect}
                                className="flex flex-col items-center gap-1 text-neutral-500 hover:text-white transition-colors"
                              >
                                {uploadingDirect && uploadTargetDevice === deviceType ? (
                                  <Loader2 className="w-4 h-4 animate-spin" />
                                ) : (
                                  <Upload className="w-4 h-4" />
                                )}
                                <span className="text-[10px]">Upload</span>
                              </button>
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="flex flex-col items-center justify-center py-10 text-center">
                          <div className="w-12 h-12 rounded-xl bg-white/[0.03] border border-white/[0.08] flex items-center justify-center mb-3">
                            <Image className="w-6 h-6 text-neutral-500" />
                          </div>
                          <p className="text-neutral-500 mb-4 text-sm">No screenshots for this device</p>
                          {!isReadOnly && (
                            <div className="flex gap-2">
                              {project?.appStoreAppId && (
                                <button
                                  onClick={handlePull}
                                  disabled={pulling}
                                  className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium
                                           bg-white/[0.05] text-white border border-white/[0.1]
                                           hover:bg-white/[0.08] disabled:opacity-50 transition-all"
                                >
                                  {pulling ? (
                                    <Loader2 className="w-3 h-3 animate-spin" />
                                  ) : (
                                    <CloudDownload className="w-3 h-3" />
                                  )}
                                  Pull
                                </button>
                              )}
                              {/* Generate button only for primary locale */}
                              {isPrimaryLocale && (
                                <button
                                  onClick={() => {
                                    setWizardDeviceType(deviceType as ScreenshotDisplayType)
                                    setWizardOpen(true)
                                  }}
                                  className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium
                                           bg-purple-500/10 text-purple-400 border border-purple-500/20
                                           hover:bg-purple-500/20 transition-all"
                                >
                                  <Sparkles className="w-3 h-3" />
                                  Generate
                                </button>
                              )}
                              {/* Import from MCP button */}
                              {isPrimaryLocale && (
                                <button
                                  onClick={() => setImportModalOpen(true)}
                                  className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium
                                           bg-blue-500/10 text-blue-400 border border-blue-500/20
                                           hover:bg-blue-500/20 transition-all"
                                >
                                  <Download className="w-3 h-3" />
                                  Import
                                </button>
                              )}
                              {/* Direct upload button */}
                              <button
                                onClick={() => {
                                  setUploadTargetDevice(deviceType)
                                  directUploadRef.current?.click()
                                }}
                                disabled={uploadingDirect}
                                className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium
                                         bg-white/[0.05] text-white border border-white/[0.1]
                                         hover:bg-white/[0.08] disabled:opacity-50 transition-all"
                              >
                                {uploadingDirect && uploadTargetDevice === deviceType ? (
                                  <Loader2 className="w-3 h-3 animate-spin" />
                                ) : (
                                  <Upload className="w-3 h-3" />
                                )}
                                Upload
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
            </div>
          </div>
        </div>
      </div>

      {/* Hidden file input for direct upload */}
      <input
        ref={directUploadRef}
        type="file"
        accept="image/*"
        multiple
        onChange={handleDirectUpload}
        className="hidden"
      />

      {/* Generate Modal */}
      {generateModalOpen && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="bg-[#0a0a0a] border border-white/[0.08] rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-white/[0.08]">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-white">Generate Screenshots with AI</h2>
                <button onClick={() => setGenerateModalOpen(false)} className="text-neutral-400 hover:text-white">
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="p-6 space-y-6">
              {/* Device Type Selection */}
              <div>
                <label className="block text-sm font-medium text-white mb-2">Device Type</label>
                <select
                  value={selectedDeviceForGenerate}
                  onChange={(e) => setSelectedDeviceForGenerate(e.target.value)}
                  className="w-full px-3 py-2 bg-white/[0.03] border border-white/[0.08] rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-purple-500/50"
                >
                  <option value="">Select a device type...</option>
                  {storeDisplayTypes.map(([type, info]) => (
                    <option key={type} value={type}>
                      {info.name} ({info.width}×{info.height})
                    </option>
                  ))}
                </select>
              </div>

              {/* Raw images upload */}
              <div>
                <label className="block text-sm font-medium text-white mb-2">Raw Screenshots</label>
                <p className="text-sm text-neutral-500 mb-3">
                  Upload your raw app screenshots. AI will transform them into marketing screenshots.
                </p>

                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={handleFileUpload}
                  className="hidden"
                />

                <div className="grid grid-cols-4 gap-3">
                  {rawImages.map((img, index) => {
                    const deviceInfo = selectedDeviceForGenerate
                      ? SCREENSHOT_DISPLAY_TYPES[selectedDeviceForGenerate as ScreenshotDisplayType]
                      : null
                    return (
                      <div
                        key={index}
                        className="relative bg-white/[0.03] rounded-lg overflow-hidden border border-white/[0.08]"
                        style={{ aspectRatio: deviceInfo ? `${deviceInfo.width} / ${deviceInfo.height}` : '9 / 19.5' }}
                      >
                        <img src={img.url} alt="" className="w-full h-full object-cover" />
                        <button
                          onClick={() => setRawImages(rawImages.filter((_, i) => i !== index))}
                          className="absolute top-1 right-1 p-1 bg-red-500/80 rounded"
                        >
                          <X className="w-3 h-3 text-white" />
                        </button>
                      </div>
                    )
                  })}

                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="bg-white/[0.02] rounded-lg border border-dashed border-white/[0.15] flex flex-col items-center justify-center gap-1 hover:bg-white/[0.05] transition-colors"
                    style={{
                      aspectRatio: selectedDeviceForGenerate && SCREENSHOT_DISPLAY_TYPES[selectedDeviceForGenerate as ScreenshotDisplayType]
                        ? `${SCREENSHOT_DISPLAY_TYPES[selectedDeviceForGenerate as ScreenshotDisplayType].width} / ${SCREENSHOT_DISPLAY_TYPES[selectedDeviceForGenerate as ScreenshotDisplayType].height}`
                        : '9 / 19.5'
                    }}
                  >
                    <Upload className="w-5 h-5 text-neutral-500" />
                    <span className="text-xs text-neutral-500">Upload</span>
                  </button>
                </div>
              </div>

              {/* Headlines */}
              {rawImages.length > 0 && (
                <div>
                  <label className="block text-sm font-medium text-white mb-2">Headlines</label>
                  <div className="space-y-2">
                    {rawImages.map((img, index) => (
                      <div key={index} className="flex items-center gap-3">
                        <span className="text-sm text-neutral-500 w-6">{index + 1}.</span>
                        <input
                          type="text"
                          value={img.headline}
                          onChange={(e) => {
                            const updated = [...rawImages]
                            updated[index].headline = e.target.value
                            setRawImages(updated)
                          }}
                          placeholder="Enter headline text..."
                          className="flex-1 px-3 py-2 bg-white/[0.03] border border-white/[0.08] rounded-lg text-white placeholder:text-neutral-600 focus:outline-none focus:ring-2 focus:ring-purple-500/50"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Style selection */}
              <div>
                <label className="block text-sm font-medium text-white mb-2">Style</label>
                <div className="flex gap-3">
                  <button
                    onClick={() => setStyleType('category')}
                    className={`flex-1 p-4 rounded-xl border transition-colors ${
                      styleType === 'category'
                        ? 'bg-purple-500/10 border-purple-500/30'
                        : 'bg-white/[0.02] border-white/[0.08] hover:bg-white/[0.05]'
                    }`}
                  >
                    <div className="text-left">
                      <div className="font-medium text-white">Category Style</div>
                      <div className="text-sm text-neutral-500">Use a predefined style based on app category</div>
                    </div>
                  </button>
                  <button
                    onClick={() => setStyleType('reference')}
                    className={`flex-1 p-4 rounded-xl border transition-colors ${
                      styleType === 'reference'
                        ? 'bg-purple-500/10 border-purple-500/30'
                        : 'bg-white/[0.02] border-white/[0.08] hover:bg-white/[0.05]'
                    }`}
                  >
                    <div className="text-left">
                      <div className="font-medium text-white">Reference Image</div>
                      <div className="text-sm text-neutral-500">Copy style from an existing screenshot</div>
                    </div>
                  </button>
                </div>

                {styleType === 'category' && (
                  <select
                    value={selectedCategory}
                    onChange={(e) => setSelectedCategory(e.target.value)}
                    className="mt-3 w-full px-3 py-2 bg-white/[0.03] border border-white/[0.08] rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-purple-500/50"
                  >
                    <option value="health_fitness">Health & Fitness</option>
                    <option value="productivity">Productivity</option>
                    <option value="social">Social</option>
                    <option value="games">Games</option>
                    <option value="education">Education</option>
                    <option value="finance">Finance</option>
                    <option value="entertainment">Entertainment</option>
                  </select>
                )}

                {styleType === 'reference' && (
                  <input
                    type="url"
                    value={referenceImageUrl}
                    onChange={(e) => setReferenceImageUrl(e.target.value)}
                    placeholder="Enter reference image URL..."
                    className="mt-3 w-full px-3 py-2 bg-white/[0.03] border border-white/[0.08] rounded-lg text-white placeholder:text-neutral-600 focus:outline-none focus:ring-2 focus:ring-purple-500/50"
                  />
                )}
              </div>
            </div>

            <div className="p-6 border-t border-white/[0.08] flex justify-end gap-3">
              <button
                onClick={() => setGenerateModalOpen(false)}
                className="px-4 py-2.5 rounded-xl text-sm font-medium bg-white/[0.05] text-white hover:bg-white/[0.08] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleGenerate}
                disabled={generating || rawImages.length === 0 || !selectedDeviceForGenerate}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium bg-purple-500 hover:bg-purple-600 text-white transition-colors disabled:opacity-50"
              >
                {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                Generate {rawImages.length} Screenshot{rawImages.length !== 1 ? 's' : ''}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Translate Modal */}
      {translateModalOpen && (() => {
        const availableLocales = (project?.enabledLocales || [])
          .filter(l => l !== project?.primaryLocale)
          .sort((a, b) => getLocaleName(a).localeCompare(getLocaleName(b)))
        const allSelected = availableLocales.length > 0 && availableLocales.every(l => targetLocales.includes(l))
        const someSelected = targetLocales.length > 0 && !allSelected

        // If translating, show progress view
        if (translating && translationJob) {
          const progressPercent = translationJob.progress.total > 0
            ? Math.round((translationJob.progress.current / translationJob.progress.total) * 100)
            : 0
          const successCount = translationJob.results.filter(r => r.success).length
          const failCount = translationJob.results.filter(r => !r.success).length
          const statusText = translationJob.status === 'pending'
            ? 'Starting translation...'
            : translationJob.status === 'processing'
            ? `Processing ${translationJob.progress.currentLocale ? getLocaleName(translationJob.progress.currentLocale) : ''}...`
            : 'Finalizing...'

          return (
            <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
              <div className="bg-[#0a0a0a] border border-white/[0.08] rounded-2xl max-w-lg w-full">
                <div className="p-6 border-b border-white/[0.08]">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500/20 to-pink-500/20 flex items-center justify-center">
                      <Languages className="w-5 h-5 text-purple-400 animate-pulse" />
                    </div>
                    <div>
                      <h2 className="text-lg font-semibold text-white">Translating Screenshots</h2>
                      <p className="text-sm text-neutral-500">
                        {translationJob.progress.currentLocale ? getLocaleName(translationJob.progress.currentLocale) : 'Preparing...'}
                        {translationJob.isChained && translationJob.chainLength && translationJob.chainLength > 1 && (
                          <span className="ml-2 text-amber-400/70">
                            (segment {translationJob.chainLength})
                          </span>
                        )}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="p-6 space-y-5">
                  {/* Progress bar */}
                  <div>
                    <div className="flex justify-between text-sm mb-2">
                      <span className="text-neutral-400">{statusText}</span>
                      <span className="text-white font-medium tabular-nums">{progressPercent}%</span>
                    </div>
                    <div className="h-3 bg-white/[0.05] rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-purple-500 to-pink-500 rounded-full transition-all duration-500 ease-out relative"
                        style={{ width: `${progressPercent}%` }}
                      >
                        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent animate-shimmer" />
                      </div>
                    </div>
                    <div className="flex justify-between text-xs text-neutral-500 mt-2">
                      <span>{translationJob.progress.current} of {translationJob.progress.total} screenshots</span>
                      <span className="flex items-center gap-3">
                        {successCount > 0 && (
                          <span className="flex items-center gap-1 text-green-400">
                            <CheckCircle2 className="w-3 h-3" />
                            {successCount}
                          </span>
                        )}
                        {failCount > 0 && (
                          <span className="flex items-center gap-1 text-red-400">
                            <AlertCircle className="w-3 h-3" />
                            {failCount}
                          </span>
                        )}
                      </span>
                    </div>
                  </div>

                  {/* Recent results */}
                  {translationJob.results.length > 0 && (
                    <div className="max-h-40 overflow-y-auto space-y-1.5 scrollbar-dark">
                      {translationJob.results.slice(-5).reverse().map((result, i) => (
                        <div
                          key={i}
                          className={`flex items-center gap-2 p-2.5 rounded-lg text-sm ${
                            result.success
                              ? 'bg-green-500/10 text-green-400'
                              : 'bg-red-500/10 text-red-400'
                          }`}
                        >
                          {result.success ? (
                            <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
                          ) : (
                            <AlertCircle className="w-4 h-4 flex-shrink-0" />
                          )}
                          <span className="truncate">
                            {LOCALE_FLAGS[result.locale] || '🌐'} {getLocaleName(result.locale)}
                            {result.error && `: ${result.error}`}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Background job notice */}
                  <div className="flex items-start gap-3 p-3 rounded-xl bg-blue-500/10 border border-blue-500/20">
                    <Info className="w-4 h-4 text-blue-400 flex-shrink-0 mt-0.5" />
                    <p className="text-xs text-neutral-400">
                      Translation is running in the background. You can close this dialog and track progress in the <strong className="text-blue-400">Languages sidebar</strong>. The translation will continue even if you navigate away.
                    </p>
                  </div>

                  {/* AI notice */}
                  <div className="flex items-start gap-3 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20">
                    <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                    <p className="text-xs text-neutral-400">
                      AI is generating translated screenshots. This may take a few minutes.
                    </p>
                  </div>

                  {/* Action buttons */}
                  <div className="flex gap-3">
                    <button
                      onClick={() => {
                        setTranslateModalOpen(false)
                      }}
                      className="flex-1 py-2.5 rounded-xl text-sm font-medium bg-gradient-to-r from-purple-500 to-pink-500 text-white hover:from-purple-600 hover:to-pink-600 transition-colors flex items-center justify-center gap-2"
                    >
                      <X className="w-4 h-4" />
                      Close & Continue in Background
                    </button>
                    <button
                      onClick={handleCancelTranslation}
                      className="py-2.5 px-4 rounded-xl text-sm font-medium bg-white/[0.05] text-neutral-400 hover:text-red-400 hover:bg-red-500/10 transition-colors border border-white/[0.08] flex items-center justify-center gap-2"
                    >
                      <Pause className="w-4 h-4" />
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )
        }

        return (
          <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
            <div className="bg-[#0a0a0a] border border-white/[0.08] rounded-2xl max-w-lg w-full">
              <div className="p-6 border-b border-white/[0.08]">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-semibold text-white">Translate Screenshots</h2>
                    <p className="text-sm text-neutral-500 mt-1">
                      From {getLocaleFlag(project?.primaryLocale || 'en-US')} {getLocaleName(project?.primaryLocale || 'en-US')}
                    </p>
                  </div>
                  <button onClick={() => { setTranslateModalOpen(false); setSyncOnlyMode(false) }} className="text-neutral-400 hover:text-white">
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>

              <div className="p-6">
                <p className="text-neutral-500 mb-4 text-sm">
                  AI will recreate your screenshots with text translated to the selected languages.
                </p>

                {/* Quick selection buttons */}
                <div className="flex items-center gap-2 mb-2">
                  <label className="flex items-center gap-3 p-2.5 flex-1 bg-white/[0.03] rounded-lg cursor-pointer border border-white/[0.08]">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      ref={(el) => { if (el) el.indeterminate = someSelected }}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setTargetLocales(availableLocales)
                        } else {
                          setTargetLocales([])
                        }
                      }}
                      className="rounded border-white/20 bg-white/[0.03] text-purple-500 focus:ring-purple-500/50"
                    />
                    <span className="text-white text-sm font-medium">Select All ({availableLocales.length})</span>
                  </label>
                  {(() => {
                    const needsSyncLocales = availableLocales.filter(locale => {
                      const status = getLocaleSyncStatus(locale)
                      return status === 'needs_translation' || status === 'needs_sync'
                    })
                    if (needsSyncLocales.length === 0) return null
                    return (
                      <button
                        type="button"
                        onClick={() => {
                          setTargetLocales(needsSyncLocales)
                          setSyncOnlyMode(true)
                        }}
                        className="flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20 hover:bg-amber-500/20 transition-colors whitespace-nowrap"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        Needs sync ({needsSyncLocales.length})
                      </button>
                    )
                  })()}
                </div>

                <div className="max-h-64 overflow-y-auto space-y-1 scrollbar-dark">
                  {availableLocales.map((locale) => {
                    const syncStatus = getLocaleSyncStatus(locale)
                    return (
                      <label
                        key={locale}
                        className="flex items-center gap-3 p-2.5 hover:bg-white/[0.03] rounded-lg cursor-pointer transition-colors"
                      >
                        <input
                          type="checkbox"
                          checked={targetLocales.includes(locale)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setTargetLocales([...targetLocales, locale])
                            } else {
                              setTargetLocales(targetLocales.filter((l) => l !== locale))
                            }
                          }}
                          className="rounded border-white/20 bg-white/[0.03] text-purple-500 focus:ring-purple-500/50"
                        />
                        <span className="text-lg">{LOCALE_FLAGS[locale] || '🌐'}</span>
                        <span className="text-white text-sm flex-1">{LOCALE_NAMES[locale] || locale}</span>
                        {syncStatus === 'needs_translation' && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-neutral-500/10 text-neutral-400 border border-neutral-500/20">
                            <Globe className="w-2.5 h-2.5" />
                            Untranslated
                          </span>
                        )}
                        {syncStatus === 'needs_sync' && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20">
                            <RefreshCw className="w-2.5 h-2.5" />
                            Needs sync
                          </span>
                        )}
                        {syncStatus === 'synced' && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-green-500/10 text-green-400 border border-green-500/20">
                            <CheckCircle2 className="w-2.5 h-2.5" />
                            Synced
                          </span>
                        )}
                      </label>
                    )
                  })}
                </div>

                {/* Translate in-app text toggle */}
                <div className="mt-4 p-3 rounded-xl bg-white/[0.03] border border-white/[0.08]">
                  <label className="flex items-start gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={translateInAppText}
                      onChange={(e) => setTranslateInAppText(e.target.checked)}
                      className="mt-0.5 rounded border-white/20 bg-white/[0.03] text-purple-500 focus:ring-purple-500/50"
                    />
                    <div className="flex-1">
                      <span className="text-white text-sm font-medium">Translate in-app text</span>
                      <p className="text-xs text-neutral-500 mt-1">
                        AI will also attempt to translate text visible within the app UI in screenshots.
                      </p>
                    </div>
                  </label>
                  {translateInAppText && (
                    <div className="mt-2 flex items-start gap-2 p-2 rounded-lg bg-amber-500/10 border border-amber-500/20">
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-400 flex-shrink-0 mt-0.5" />
                      <p className="text-[11px] text-amber-300/80">
                        Experimental: In-app text translation may not be accurate and could affect image quality. Best for simple UI text.
                      </p>
                    </div>
                  )}
                </div>

                {/* Sync only mode toggle */}
                <div className="mt-3 p-3 rounded-xl bg-white/[0.03] border border-white/[0.08]">
                  <label className="flex items-start gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={syncOnlyMode}
                      onChange={(e) => setSyncOnlyMode(e.target.checked)}
                      className="mt-0.5 rounded border-white/20 bg-white/[0.03] text-purple-500 focus:ring-purple-500/50"
                    />
                    <div className="flex-1">
                      <span className="text-white text-sm font-medium">Only translate screenshots that need syncing</span>
                      <p className="text-xs text-neutral-500 mt-1">
                        Skip screenshots that are already translated and up-to-date. This saves time and credits.
                      </p>
                    </div>
                  </label>
                  {syncOnlyMode && (
                    <div className="mt-2 flex items-start gap-2 p-2 rounded-lg bg-blue-500/10 border border-blue-500/20">
                      <RefreshCw className="w-3.5 h-3.5 text-blue-400 flex-shrink-0 mt-0.5" />
                      <p className="text-[11px] text-blue-300/80">
                        {(() => {
                          const totalNeedingSync = new Set<string>()
                          targetLocales.forEach((locale: string) => {
                            getScreenshotsNeedingSync(locale).forEach((id: string) => totalNeedingSync.add(id))
                          })
                          const count = totalNeedingSync.size
                          if (targetLocales.length === 0) return 'Select languages to see how many screenshots need syncing.'
                          if (count === 0) return 'All screenshots are already synced for the selected languages.'
                          return `${count} screenshot${count !== 1 ? 's' : ''} will be translated (others are already synced).`
                        })()}
                      </p>
                    </div>
                  )}
                </div>
              </div>

              <div className="p-6 border-t border-white/[0.08] flex justify-end gap-3">
                <button
                  onClick={() => {
                    setTranslateModalOpen(false)
                    setTargetLocales([])
                    setSyncOnlyMode(false)
                  }}
                  className="px-4 py-2.5 rounded-xl text-sm font-medium bg-white/[0.05] text-white hover:bg-white/[0.08] transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => handleTranslate()}
                  disabled={translating || targetLocales.length === 0}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium bg-gradient-to-r from-purple-500 to-pink-500 text-white hover:opacity-90 transition-colors disabled:opacity-50"
                >
                  {translating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                  Translate to {targetLocales.length} Language{targetLocales.length !== 1 ? 's' : ''}
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* How Screenshot Translation Works Dialog */}
      {showTranslationHelp && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={() => setShowTranslationHelp(false)} />
          <div className="relative w-full max-w-lg rounded-2xl bg-neutral-900 border border-white/[0.1] shadow-2xl">
            {/* Header */}
            <div className="p-5 text-center border-b border-white/[0.06]">
              <div className="inline-flex p-3 rounded-2xl bg-gradient-to-br from-purple-500/20 to-pink-500/20 mb-3">
                <Sparkles className="w-6 h-6 text-purple-400" />
              </div>
              <h3 className="text-lg font-semibold text-white">Screenshot Translation</h3>
              <p className="text-sm text-neutral-500 mt-1">AI recreates your screenshots in other languages</p>
            </div>

            {/* Content */}
            <div className="p-5 space-y-5">
              {/* How it works */}
              <div className="space-y-3">
                <div className="flex items-start gap-3">
                  <div className="w-7 h-7 rounded-full bg-purple-500/20 flex items-center justify-center flex-shrink-0">
                    <span className="text-xs font-semibold text-purple-400">1</span>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-white">Detect & Extract</p>
                    <p className="text-xs text-neutral-400 mt-0.5">AI analyzes your primary screenshots to identify marketing text, headlines, and captions</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <div className="w-7 h-7 rounded-full bg-purple-500/20 flex items-center justify-center flex-shrink-0">
                    <span className="text-xs font-semibold text-purple-400">2</span>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-white">Translate & Localize</p>
                    <p className="text-xs text-neutral-400 mt-0.5">Text is translated using ASO-optimized keywords that local users actually search for</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <div className="w-7 h-7 rounded-full bg-purple-500/20 flex items-center justify-center flex-shrink-0">
                    <span className="text-xs font-semibold text-purple-400">3</span>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-white">Regenerate</p>
                    <p className="text-xs text-neutral-400 mt-0.5">New screenshots are generated with translated text while preserving your design, fonts, and layout</p>
                  </div>
                </div>
              </div>

              {/* Features row */}
              <div className="flex gap-3">
                <div className="flex-1 p-3 rounded-xl bg-white/[0.03] border border-white/[0.06]">
                  <div className="flex items-center gap-2 mb-1">
                    <Wand2 className="w-3.5 h-3.5 text-blue-400" />
                    <span className="text-xs font-medium text-white">Style Preserved</span>
                  </div>
                  <p className="text-[11px] text-neutral-500">Same design across all languages</p>
                </div>
                <div className="flex-1 p-3 rounded-xl bg-white/[0.03] border border-white/[0.06]">
                  <div className="flex items-center gap-2 mb-1">
                    <Globe className="w-3.5 h-3.5 text-emerald-400" />
                    <span className="text-xs font-medium text-white">Market-Specific</span>
                  </div>
                  <p className="text-[11px] text-neutral-500">Keywords tailored per region</p>
                </div>
              </div>

              {/* AI Warning */}
              <div className="flex items-start gap-3 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20">
                <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-medium text-amber-400">AI-Powered Generation</p>
                  <p className="text-[11px] text-neutral-400 mt-0.5">Please review all generated screenshots before publishing. AI may occasionally need adjustments for text placement or translation nuances.</p>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-white/[0.06]">
              <button
                onClick={() => setShowTranslationHelp(false)}
                className="w-full py-2.5 rounded-xl text-sm font-medium bg-white/[0.05] text-white hover:bg-white/[0.08] transition-colors"
              >
                Got it
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Preview Modal */}
      {previewImage && (
        <div
          className="fixed inset-0 bg-black/90 flex items-center justify-center z-50 p-4"
          onClick={() => setPreviewImage(null)}
        >
          <div className="relative max-w-md w-full" onClick={(e) => e.stopPropagation()}>
            <img src={previewImage} alt="Screenshot preview" className="w-full rounded-2xl" />
            <button
              onClick={() => setPreviewImage(null)}
              className="absolute top-4 right-4 p-2 bg-black/60 rounded-full hover:bg-black/80 transition-colors"
            >
              <X className="w-5 h-5 text-white" />
            </button>
          </div>
        </div>
      )}

      {/* Screenshot Edit Modal */}
      {editModalOpen && editingScreenshot && (
        <ScreenshotEditModal
          isOpen={editModalOpen}
          projectId={projectId}
          deviceType={editingScreenshot.deviceType}
          screenshot={{
            ...editingScreenshot.screenshot,
            rawImageUrl: editingScreenshot.rawImageUrl,
          }}
          locale={editingScreenshot.locale}
          isTranslated={editingScreenshot.isTranslated}
          primaryImageUrl={editingScreenshot.primaryImageUrl}
          sourceLocale={project?.primaryLocale || 'en-US'}
          initialPrompt={editingScreenshot.initialPrompt}
          allScreenshots={Object.entries(screenshotSets).flatMap(([, set]) =>
            (set.screenshots || []).map(s => ({
              id: s.id,
              marketingImageUrl: s.marketingImageUrl,
              rawImageUrl: s.rawImageUrl,
              headline: s.headline,
            }))
          )}
          onClose={() => {
            setEditModalOpen(false)
            setEditingScreenshot(null)
          }}
          onSave={async () => {
            // Reload screenshots to reflect the changes
            await loadScreenshots(false, true)
            showSuccess('Screenshot updated successfully')
            setEditModalOpen(false)
            setEditingScreenshot(null)
          }}
        />
      )}

      {/* Cancel Translation Confirmation Modal */}
      {cancelConfirmOpen && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="bg-[#0a0a0a] border border-white/[0.08] rounded-2xl max-w-md w-full">
            <div className="p-6 border-b border-white/[0.08]">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-white">Cancel Translation?</h2>
                <button
                  onClick={() => setCancelConfirmOpen(false)}
                  className="text-neutral-400 hover:text-white"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
                  <Pause className="w-5 h-5 text-amber-400" />
                </div>
                <div>
                  <p className="text-white font-medium">Stop translation?</p>
                  <p className="text-sm text-neutral-500">
                    {translationJob?.results.filter(r => r.success).length || 0} screenshots translated so far
                  </p>
                </div>
              </div>

              <p className="text-sm text-neutral-400 mb-4">
                The translation job will be cancelled. Screenshots that have already been translated will be saved.
              </p>

              {(translationJob?.results.filter(r => r.success).length || 0) > 0 && (
                <div className="bg-green-500/5 border border-green-500/20 rounded-xl p-3 mb-4">
                  <p className="text-xs text-green-400">
                    {translationJob?.results.filter(r => r.success).length} screenshots have been successfully translated and will be kept.
                  </p>
                </div>
              )}
            </div>

            <div className="p-6 border-t border-white/[0.08] flex justify-end gap-3">
              <button
                onClick={() => setCancelConfirmOpen(false)}
                className="px-4 py-2.5 rounded-xl text-sm font-medium bg-white/[0.05] text-white hover:bg-white/[0.08] transition-colors"
              >
                Continue Translation
              </button>
              <button
                onClick={handleCancelTranslation}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium bg-red-500 hover:bg-red-600 text-white transition-colors"
              >
                <X className="w-4 h-4" />
                Cancel Translation
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteConfirmOpen && (() => {
        const currentLocale = selectedLocale || project?.primaryLocale || 'en-US'
        const isPrimaryLocale = currentLocale === project?.primaryLocale
        const deviceName = SCREENSHOT_DISPLAY_TYPES[deleteConfirmOpen as ScreenshotDisplayType]?.name || deleteConfirmOpen
        const screenshotCount = screenshotSets[deleteConfirmOpen]?.screenshots?.length || 0

        return (
          <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
            <div className="bg-[#0a0a0a] border border-white/[0.08] rounded-2xl max-w-md w-full">
              <div className="p-6 border-b border-white/[0.08]">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-white">
                    Delete {isPrimaryLocale ? 'Screenshots' : 'Translated Screenshots'}
                  </h2>
                  <button
                    onClick={() => setDeleteConfirmOpen(null)}
                    className="text-neutral-400 hover:text-white"
                    disabled={deleting}
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>

              <div className="p-6">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center justify-center">
                    <AlertTriangle className="w-5 h-5 text-red-400" />
                  </div>
                  <div>
                    <p className="text-white font-medium">
                      Delete {deviceName} for {currentLocale}?
                    </p>
                    <p className="text-sm text-neutral-500">
                      {screenshotCount} {isPrimaryLocale ? 'screenshots' : 'translated screenshots'} will be deleted
                    </p>
                  </div>
                </div>

                <p className="text-sm text-neutral-400 mb-4">
                  {isPrimaryLocale ? (
                    <>This will delete all screenshots for this device type, including any translations.</>
                  ) : (
                    <>This will only delete the {currentLocale} translations for this device type. Primary screenshots will not be affected.</>
                  )}
                </p>

                <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-3 mb-3">
                  <p className="text-xs text-amber-400">
                    Screenshots will only be deleted locally. Push to {storeConnectName} to sync changes.
                  </p>
                </div>

                <div className="bg-red-500/5 border border-red-500/20 rounded-xl p-3">
                  <p className="text-xs text-red-400">
                    This action cannot be undone.
                  </p>
                </div>
              </div>

              <div className="p-6 border-t border-white/[0.08] flex justify-end gap-3">
                <button
                  onClick={() => setDeleteConfirmOpen(null)}
                  disabled={deleting}
                  className="px-4 py-2.5 rounded-xl text-sm font-medium bg-white/[0.05] text-white hover:bg-white/[0.08] transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={() => handleDeleteSet(deleteConfirmOpen)}
                  disabled={deleting}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium bg-red-500 hover:bg-red-600 text-white transition-colors disabled:opacity-50"
                >
                  {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                  {deleting ? 'Deleting...' : 'Delete Screenshots'}
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* Translate/Retranslate Confirmation Modal */}
      {translateConfirm && (() => {
        const deviceName = SCREENSHOT_DISPLAY_TYPES[translateConfirm.deviceType as ScreenshotDisplayType]?.name || translateConfirm.deviceType
        const localeName = LOCALE_NAMES[selectedLocale] || selectedLocale
        const localeFlag = LOCALE_FLAGS[selectedLocale] || '🌐'
        const isDeviceSet = translateConfirm.type === 'deviceSet'
        const itemCount = isDeviceSet ? translateConfirm.screenshotCount || 0 : 1
        const isNew = translateConfirm.isNewTranslation

        return (
          <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
            <div className="bg-[#0a0a0a] border border-white/[0.08] rounded-2xl max-w-md w-full">
              <div className="p-6 border-b border-white/[0.08]">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-white">
                    {isNew ? 'Translate' : 'Retranslate'} {isDeviceSet ? 'Device Set' : 'Screenshot'}
                  </h2>
                  <button
                    onClick={() => setTranslateConfirm(null)}
                    className="text-neutral-400 hover:text-white"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>

              <div className="p-6">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center">
                    <Languages className="w-5 h-5 text-purple-400" />
                  </div>
                  <div>
                    <p className="text-white font-medium">
                      {isNew
                        ? (isDeviceSet ? `Translate all ${deviceName}?` : `Translate this screenshot?`)
                        : (isDeviceSet ? `Retranslate all ${deviceName}?` : `Retranslate this screenshot?`)
                      }
                    </p>
                    <p className="text-sm text-neutral-500">
                      {localeFlag} {localeName} • {itemCount} screenshot{itemCount !== 1 ? 's' : ''}
                    </p>
                  </div>
                </div>

                <p className="text-sm text-neutral-400 mb-4">
                  {isNew ? (
                    isDeviceSet ? (
                      <>This will generate translated versions of all {itemCount} screenshots for {deviceName} in {localeName}.</>
                    ) : (
                      <>This will generate a translated version of this screenshot for {localeName}.</>
                    )
                  ) : (
                    isDeviceSet ? (
                      <>This will regenerate all {itemCount} translated screenshots for {deviceName} in {localeName}. Existing translations will be replaced.</>
                    ) : (
                      <>This will regenerate the translation for this screenshot in {localeName}. The existing translation will be replaced.</>
                    )
                  )}
                </p>

                <div className="bg-blue-500/5 border border-blue-500/20 rounded-xl p-3">
                  <p className="text-xs text-blue-400">
                    Translation uses AI to localize marketing text and adapt the screenshot for the target locale.
                  </p>
                </div>
              </div>

              <div className="p-6 border-t border-white/[0.08] flex justify-end gap-3">
                <button
                  onClick={() => setTranslateConfirm(null)}
                  className="px-4 py-2.5 rounded-xl text-sm font-medium bg-white/[0.05] text-white hover:bg-white/[0.08] transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={executeTranslation}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium bg-purple-500 hover:bg-purple-600 text-white transition-colors"
                >
                  <Languages className="w-4 h-4" />
                  {isNew ? 'Translate' : 'Retranslate'}
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* Push Confirmation Modal */}
      {pushConfirmOpen && (() => {
        const displayTypesToPush = Object.keys(screenshotSets).filter(dt => screenshotSets[dt]?.screenshots?.length > 0)
        const totalScreenshots = displayTypesToPush.reduce((sum, dt) => sum + (screenshotSets[dt]?.screenshots?.length || 0), 0)
        const allLocales = project?.enabledLocales || []
        const currentLocale = selectedLocale || project?.primaryLocale

        // Sort locales alphabetically by display name, with current locale at top
        const sortedLocales = [...allLocales].sort((a, b) => {
          // Current locale always comes first
          if (a === currentLocale) return -1
          if (b === currentLocale) return 1
          // Then sort alphabetically by display name
          const nameA = LOCALE_NAMES[a] || a
          const nameB = LOCALE_NAMES[b] || b
          return nameA.localeCompare(nameB)
        })

        const hasTranslations = localizedScreenshots && Object.keys(localizedScreenshots).length > 0

        const toggleLocale = (locale: string) => {
          setSelectedPushLocales(prev =>
            prev.includes(locale)
              ? prev.filter(l => l !== locale)
              : [...prev, locale]
          )
        }

        const selectAllLocales = () => setSelectedPushLocales(allLocales)
        const deselectAllLocales = () => setSelectedPushLocales([])

        return (
          <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
            <div className="bg-[#0a0a0a] border border-white/[0.08] rounded-2xl max-w-lg w-full max-h-[90vh] flex flex-col">
              <div className="p-6 border-b border-white/[0.08]">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-white">Push to {storeConnectName}</h2>
                  <button
                    onClick={() => setPushConfirmOpen(false)}
                    className="text-neutral-400 hover:text-white"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>

              <div className="p-6 overflow-y-auto flex-1">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
                    <AlertTriangle className="w-5 h-5 text-amber-400" />
                  </div>
                  <div>
                    <p className="text-white font-medium">
                      Overwrite {storeName} Screenshots?
                    </p>
                    <p className="text-sm text-neutral-500">
                      {totalScreenshots} screenshots across {displayTypesToPush.length} device type{displayTypesToPush.length !== 1 ? 's' : ''}
                    </p>
                  </div>
                </div>

                <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-3 mb-4">
                  <p className="text-sm text-amber-400 font-medium mb-2">This will replace existing screenshots:</p>
                  <ul className="text-xs text-amber-400/80 space-y-1">
                    <li>• Screenshots on {storeConnectName} will be <strong>deleted and replaced</strong></li>
                    <li>• Device types: {displayTypesToPush.map(dt => SCREENSHOT_DISPLAY_TYPES[dt as ScreenshotDisplayType]?.name || dt).join(', ')}</li>
                  </ul>
                </div>

                {/* Locale Selection */}
                {allLocales.length > 0 && (
                  <div className="mb-4">
                    <div className="flex items-center justify-between mb-3">
                      <p className="text-sm font-medium text-white">Select Languages to Push</p>
                      <div className="flex gap-2">
                        <button
                          onClick={selectAllLocales}
                          className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
                        >
                          Select All
                        </button>
                        <span className="text-neutral-600">|</span>
                        <button
                          onClick={deselectAllLocales}
                          className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
                        >
                          Deselect All
                        </button>
                      </div>
                    </div>
                    <div className="bg-white/[0.02] border border-white/[0.08] rounded-xl p-3 max-h-48 overflow-y-auto">
                      <div className="flex flex-col gap-1">
                        {sortedLocales.map((locale: string) => (
                          <label
                            key={locale}
                            className={`flex items-center gap-2 p-2 rounded-lg cursor-pointer transition-colors ${
                              selectedPushLocales.includes(locale)
                                ? 'bg-blue-500/10 border border-blue-500/30'
                                : 'hover:bg-white/[0.05] border border-transparent'
                            } ${locale === currentLocale ? 'ring-1 ring-purple-500/50' : ''}`}
                          >
                            <input
                              type="checkbox"
                              checked={selectedPushLocales.includes(locale)}
                              onChange={() => toggleLocale(locale)}
                              className="w-4 h-4 rounded border-white/20 bg-white/5 text-blue-500 focus:ring-blue-500 focus:ring-offset-0"
                            />
                            <span className="text-base">{LOCALE_FLAGS[locale] || '🌐'}</span>
                            <span className="text-sm text-white truncate">
                              {LOCALE_NAMES[locale] || locale}
                              {locale === currentLocale && <span className="text-purple-400 ml-1">(current)</span>}
                            </span>
                          </label>
                        ))}
                      </div>
                    </div>
                    <p className="text-xs text-neutral-500 mt-2">
                      {selectedPushLocales.length} of {allLocales.length} language{allLocales.length !== 1 ? 's' : ''} selected
                    </p>
                  </div>
                )}

                <p className="text-sm text-neutral-400">
                  Make sure your screenshots look correct before pushing. You can always pull from {storeConnectName} to restore previous screenshots.
                </p>
              </div>

              <div className="p-6 border-t border-white/[0.08] flex justify-end gap-3">
                <button
                  onClick={() => setPushConfirmOpen(false)}
                  className="px-4 py-2.5 rounded-xl text-sm font-medium bg-white/[0.05] text-white hover:bg-white/[0.08] transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handlePush}
                  disabled={selectedPushLocales.length === 0}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium bg-gradient-to-r from-purple-500 to-blue-500 text-white hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <RefreshCw className="w-4 h-4" />
                  Push {selectedPushLocales.length} Language{selectedPushLocales.length !== 1 ? 's' : ''}
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* Push Progress Dialog */}
      {showPushProgressDialog && pushProgressDetails && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            onClick={() => {
              // Allow dismiss by clicking backdrop
              setShowPushProgressDialog(false)
              // Don't clear job data so they can reopen if needed
            }}
          />
          <div className="relative w-full max-w-md mx-4 rounded-2xl bg-neutral-900 border border-white/[0.1] shadow-2xl">
            {/* Dismiss button */}
            <button
              onClick={() => {
                setShowPushProgressDialog(false)
              }}
              className="absolute top-4 right-4 p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-white/10 transition-colors z-10"
              title="Minimize (job continues in background)"
            >
              <X className="w-4 h-4" />
            </button>

            <div className="p-6">
              {/* Header */}
              <div className="flex items-center gap-3 mb-6 pr-8">
                <div className={`p-3 rounded-xl flex-shrink-0 ${
                  pushProgressDetails.step === 'error' ? 'bg-red-500/10' :
                  pushProgressDetails.step === 'complete' ? 'bg-green-500/10' : 'bg-purple-500/10'
                }`}>
                  {pushProgressDetails.step === 'error' ? (
                    <AlertCircle className="w-6 h-6 text-red-400" />
                  ) : pushProgressDetails.step === 'complete' ? (
                    <Check className="w-6 h-6 text-green-400" />
                  ) : (
                    <CloudUpload className="w-6 h-6 text-purple-400" />
                  )}
                </div>
                <div className="min-w-0">
                  <h3 className="text-lg font-semibold text-white">
                    {pushProgressDetails.step === 'error' ? 'Push Failed' :
                     pushProgressDetails.step === 'complete' ? 'Push Complete' : `Pushing to ${storeConnectName}`}
                  </h3>
                  <p className="text-sm text-neutral-400 truncate">{pushProgressDetails.message}</p>
                </div>
              </div>

              {/* Progress Steps */}
              <div className="space-y-3 mb-6">
                {(['connecting', 'uploading', 'complete'] as const).map((step, idx) => {
                  const steps = ['connecting', 'uploading', 'complete'] as const
                  const currentStep = pushProgressDetails.step === 'error' ? 'connecting' : pushProgressDetails.step
                  const currentIdx = steps.indexOf(currentStep as typeof steps[number])
                  const isActive = step === pushProgressDetails.step
                  const isComplete = idx < currentIdx || pushProgressDetails.step === 'complete'
                  const stepLabels = {
                    connecting: `Connecting to ${storeConnectName}`,
                    uploading: `Uploading ${pushProgressDetails.total || 0} screenshots`,
                    complete: 'Complete'
                  }
                  return (
                    <div key={step} className="flex items-center gap-3">
                      <div className={`w-6 h-6 rounded-full flex items-center justify-center ${
                        isComplete ? 'bg-green-500' :
                        isActive ? 'bg-purple-500' : 'bg-white/10'
                      }`}>
                        {isComplete ? (
                          <Check className="w-3.5 h-3.5 text-white" />
                        ) : isActive ? (
                          <Loader2 className="w-3.5 h-3.5 text-white animate-spin" />
                        ) : (
                          <span className="text-xs text-neutral-500">{idx + 1}</span>
                        )}
                      </div>
                      <span className={`text-sm ${
                        isComplete ? 'text-green-400' :
                        isActive ? 'text-white' : 'text-neutral-500'
                      }`}>
                        {stepLabels[step]}
                      </span>
                    </div>
                  )
                })}
              </div>

              {/* Progress Bar (during uploading) */}
              {pushProgressDetails.step === 'uploading' && pushProgressDetails.total && pushProgressDetails.total > 0 && (
                <div className="mb-6">
                  {/* Current batch indicator */}
                  {pushProgressDetails.currentBatch && pushProgressDetails.currentBatch.length > 0 ? (
                    <div className="mb-3">
                      <div className="flex items-center gap-1 flex-wrap">
                        {pushProgressDetails.currentBatch.map((task, i) => (
                          <span
                            key={i}
                            className="inline-flex items-center gap-1 px-2 py-1 bg-white/10 rounded text-xs"
                          >
                            <span className="text-neutral-300">
                              {SCREENSHOT_DISPLAY_TYPES[task.displayType as ScreenshotDisplayType]?.name || task.displayType}
                            </span>
                            <span className="text-neutral-500">({getLocaleName(task.locale)})</span>
                          </span>
                        ))}
                      </div>
                      <span className="text-xs text-purple-400 mt-1 block">
                        ⚡ Uploading {pushProgressDetails.currentBatch.length} device/locale combinations in parallel
                      </span>
                    </div>
                  ) : pushProgressDetails.currentTask && (
                    <div className="mb-3">
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-white">
                          {SCREENSHOT_DISPLAY_TYPES[pushProgressDetails.currentTask.displayType as ScreenshotDisplayType]?.name || pushProgressDetails.currentTask.displayType}
                        </span>
                        <span className="text-xs text-neutral-500">({getLocaleName(pushProgressDetails.currentTask.locale)})</span>
                      </div>
                      {/* Granular screenshot progress */}
                      {pushProgressDetails.currentScreenshot && pushProgressDetails.totalScreenshots && (
                        <div className="mt-2">
                          <div className="flex items-center gap-2 text-xs">
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                              pushProgressDetails.currentStep === 'fetching' ? 'bg-blue-500/20 text-blue-400' :
                              pushProgressDetails.currentStep === 'processing' ? 'bg-yellow-500/20 text-yellow-400' :
                              pushProgressDetails.currentStep === 'uploading' ? 'bg-purple-500/20 text-purple-400' :
                              pushProgressDetails.currentStep === 'committing' ? 'bg-green-500/20 text-green-400' :
                              'bg-white/10 text-neutral-400'
                            }`}>
                              {pushProgressDetails.currentStep === 'fetching' ? 'Downloading' :
                               pushProgressDetails.currentStep === 'processing' ? 'Processing' :
                               pushProgressDetails.currentStep === 'uploading' ? 'Uploading' :
                               pushProgressDetails.currentStep === 'committing' ? 'Finalizing' : 'Working'}
                            </span>
                            <span className="text-neutral-400">
                              Screenshot {pushProgressDetails.currentScreenshot}/{pushProgressDetails.totalScreenshots}
                            </span>
                          </div>
                          {/* Screenshot-level progress bar */}
                          <div className="h-1 bg-white/5 rounded-full overflow-hidden mt-1.5">
                            <div
                              className="h-full bg-white/30 transition-all duration-200 ease-out"
                              style={{ width: `${(pushProgressDetails.currentScreenshot / pushProgressDetails.totalScreenshots) * 100}%` }}
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Progress bar */}
                  <div className="h-2 bg-white/10 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-purple-500 to-pink-500 transition-all duration-300 ease-out"
                      style={{ width: `${((pushProgressDetails.current || 0) / pushProgressDetails.total) * 100}%` }}
                    />
                  </div>

                  {/* Progress text */}
                  <div className="flex items-center justify-between mt-2">
                    <span className="text-xs text-neutral-400">
                      {pushProgressDetails.current || 0} of {pushProgressDetails.total} screenshots
                    </span>
                    <span className="text-xs text-neutral-400">
                      {Math.round(((pushProgressDetails.current || 0) / pushProgressDetails.total) * 100)}%
                    </span>
                  </div>
                </div>
              )}

              {/* Error Message with Failed Upload Details */}
              {pushProgressDetails.step === 'error' && pushProgressDetails.error && (
                <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 mb-6">
                  <p className="text-sm text-red-400 font-medium mb-3">{pushProgressDetails.error}</p>
                  {/* Show which uploads failed */}
                  {pushProgressDetails.results && pushProgressDetails.results.filter(r => !r.success).length > 0 && (
                    <div className="space-y-2 mt-3 pt-3 border-t border-red-500/20 max-h-32 overflow-y-auto">
                      <p className="text-xs text-neutral-400 mb-2">Failed uploads:</p>
                      {pushProgressDetails.results.filter(r => !r.success).map((result, idx) => (
                        <div key={idx} className="flex items-start gap-2 text-xs">
                          <span className="text-white">
                            {SCREENSHOT_DISPLAY_TYPES[result.displayType as ScreenshotDisplayType]?.name || result.displayType}
                          </span>
                          <span className="text-neutral-500">({getLocaleName(result.locale)})</span>
                          {result.error && (
                            <p className="text-red-400/80 mt-0.5 truncate">{result.error}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Results Summary */}
              {pushProgressDetails.step === 'complete' && pushProgressDetails.stats && (
                <div className="space-y-3 mb-6">
                  {/* Version info */}
                  {pushProgressDetails.versionInfo && (
                    <div className="p-3 rounded-xl bg-white/[0.02] border border-white/[0.08]">
                      <p className="text-xs text-neutral-400 mb-1">{project?.storeType === 'android' ? 'Play Store' : 'App Store Version'}</p>
                      <p className="text-sm text-white">
                        {pushProgressDetails.versionInfo.version} ({pushProgressDetails.versionInfo.state})
                      </p>
                    </div>
                  )}

                  {/* Stats */}
                  <div className="grid grid-cols-3 gap-3">
                    <div className="p-3 rounded-xl bg-green-500/10 border border-green-500/20">
                      <p className="text-2xl font-bold text-green-400">
                        {pushProgressDetails.stats.success}
                      </p>
                      <p className="text-xs text-neutral-400">Sets OK</p>
                    </div>
                    <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20">
                      <p className="text-2xl font-bold text-red-400">
                        {pushProgressDetails.stats.failed}
                      </p>
                      <p className="text-xs text-neutral-400">Sets Failed</p>
                    </div>
                    <div className="p-3 rounded-xl bg-purple-500/10 border border-purple-500/20">
                      <p className="text-2xl font-bold text-purple-400">
                        {pushProgressDetails.stats.screenshotsUploaded}
                      </p>
                      <p className="text-xs text-neutral-400">Screenshots</p>
                    </div>
                  </div>

                  {/* Failed sets list */}
                  {pushProgressDetails.results && pushProgressDetails.results.some(r => !r.success) && (
                    <div className="p-3 rounded-xl bg-white/[0.02] border border-white/[0.08] max-h-32 overflow-y-auto">
                      <p className="text-xs font-medium text-neutral-400 mb-2">Failed sets:</p>
                      <div className="space-y-1">
                        {pushProgressDetails.results.filter(r => !r.success).map((r, idx) => (
                          <div key={idx} className="flex items-center justify-between text-xs">
                            <span className="text-white">
                              {SCREENSHOT_DISPLAY_TYPES[r.displayType as ScreenshotDisplayType]?.name || r.displayType} ({getLocaleName(r.locale)})
                            </span>
                            <span className="text-red-400 truncate max-w-[150px]">{r.error || 'Failed'}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Action Buttons */}
              {(pushProgressDetails.step === 'connecting' || pushProgressDetails.step === 'uploading') && (
                <button
                  onClick={handleCancelPush}
                  className="w-full py-3 rounded-xl text-sm font-medium bg-white/[0.05] text-white hover:bg-white/[0.08] transition-colors"
                >
                  Cancel
                </button>
              )}

              {(pushProgressDetails.step === 'complete' || pushProgressDetails.step === 'error') && (
                <button
                  onClick={() => {
                    setShowPushProgressDialog(false)
                    setPushProgressDetails(null)
                    clearPushJob()
                  }}
                  className="w-full py-3 rounded-xl text-sm font-medium bg-white/[0.05] text-white hover:bg-white/[0.08] transition-colors"
                >
                  Close
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Incomplete Jobs Modal */}
      {incompleteJobsModalOpen && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="bg-[#0a0a0a] border border-white/[0.08] rounded-2xl max-w-2xl w-full max-h-[80vh] flex flex-col">
            <div className="p-6 border-b border-white/[0.08] flex-shrink-0">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
                    <AlertTriangle className="w-5 h-5 text-amber-400" />
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold text-white">Incomplete Translation Jobs</h2>
                    <p className="text-sm text-neutral-500">{resumableJobs.length} job{resumableJobs.length !== 1 ? 's' : ''} with remaining screenshots</p>
                  </div>
                </div>
                <button
                  onClick={() => setIncompleteJobsModalOpen(false)}
                  className="text-neutral-400 hover:text-white"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="p-6 overflow-y-auto flex-1 space-y-3">
              {resumableJobs.length === 0 ? (
                <div className="text-center py-8 text-neutral-500">
                  <CheckCircle2 className="w-12 h-12 mx-auto mb-3 opacity-50" />
                  <p>No incomplete jobs</p>
                </div>
              ) : (
                resumableJobs.map((job) => {
                  const pending = job.progress.total - job.successCount - job.failCount
                  const completedPercent = job.progress.total > 0
                    ? Math.round((job.successCount / job.progress.total) * 100)
                    : 0

                  return (
                    <div
                      key={job.jobId}
                      className="p-4 rounded-xl bg-white/[0.03] border border-white/[0.08] hover:border-white/[0.15] transition-colors"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-2">
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${
                              job.status === 'failed'
                                ? 'bg-red-500/10 text-red-400'
                                : 'bg-amber-500/10 text-amber-400'
                            }`}>
                              {job.status === 'failed' ? (
                                <>
                                  <AlertCircle className="w-3 h-3" />
                                  Failed
                                </>
                              ) : (
                                <>
                                  <AlertTriangle className="w-3 h-3" />
                                  Incomplete
                                </>
                              )}
                            </span>
                            <span className="text-xs text-neutral-500">
                              {new Date(job.createdAt).toLocaleDateString()} {new Date(job.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>

                          <div className="mb-2">
                            <p className="text-sm text-white font-medium mb-1">
                              {job.config.targetLocales.map(l => getLocaleName(l)).join(', ')}
                            </p>
                            <p className="text-xs text-neutral-500">
                              {job.config.displayTypes.map(dt => SCREENSHOT_DISPLAY_TYPES[dt as ScreenshotDisplayType]?.name || dt).join(', ')}
                            </p>
                          </div>

                          {/* Progress bar */}
                          <div className="mb-2">
                            <div className="flex justify-between text-xs mb-1">
                              <span className="text-neutral-400">{completedPercent}% complete</span>
                              <span className="text-neutral-500">{job.successCount}/{job.progress.total}</span>
                            </div>
                            <div className="h-1.5 bg-white/[0.05] rounded-full overflow-hidden">
                              <div
                                className="h-full bg-gradient-to-r from-green-500 to-emerald-500 rounded-full"
                                style={{ width: `${completedPercent}%` }}
                              />
                            </div>
                          </div>

                          <div className="flex items-center gap-3 text-xs">
                            <span className="flex items-center gap-1 text-green-400">
                              <CheckCircle2 className="w-3 h-3" />
                              {job.successCount} completed
                            </span>
                            {job.failCount > 0 && (
                              <span className="flex items-center gap-1 text-red-400">
                                <AlertCircle className="w-3 h-3" />
                                {job.failCount} failed
                              </span>
                            )}
                            {pending > 0 && (
                              <span className="flex items-center gap-1 text-amber-400">
                                <Clock className="w-3 h-3" />
                                {pending} remaining
                              </span>
                            )}
                          </div>

                          {job.error && (
                            <p className="mt-2 text-xs text-red-400 bg-red-500/10 rounded-lg p-2">
                              {job.error}
                            </p>
                          )}
                        </div>

                        <div className="flex flex-col gap-2 flex-shrink-0">
                          <button
                            onClick={async () => {
                              setIncompleteJobsModalOpen(false)
                              // Clear any pending completion cleanup from a previous job
                              completedJobIdRef.current = null
                              setTranslating(true)
                              setTranslationTargetLocales(job.config.targetLocales)
                              const result = await resumeTranslationJob(job.jobId)
                              if (!result) {
                                setTranslating(false)
                                setTranslationTargetLocales([])
                              } else if (result.alreadyComplete) {
                                showSuccess('All screenshots already translated!')
                                setTranslating(false)
                                setTranslationTargetLocales([])
                                refreshResumableJobs()
                              } else {
                                setTranslateModalOpen(true)
                                refreshResumableJobs()
                              }
                            }}
                            className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium bg-purple-500 hover:bg-purple-600 text-white transition-colors"
                          >
                            <RefreshCw className="w-4 h-4" />
                            Resume
                          </button>
                          <button
                            onClick={async () => {
                              const deleted = await deleteResumableJob(job.jobId)
                              if (deleted) {
                                showSuccess('Job dismissed')
                              }
                            }}
                            className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium bg-white/[0.05] hover:bg-white/[0.08] text-neutral-400 hover:text-white transition-colors"
                          >
                            <X className="w-4 h-4" />
                            Dismiss
                          </button>
                        </div>
                      </div>
                    </div>
                  )
                })
              )}
            </div>

            <div className="p-4 border-t border-white/[0.08] flex-shrink-0">
              <button
                onClick={() => setIncompleteJobsModalOpen(false)}
                className="w-full py-2.5 rounded-xl text-sm font-medium bg-white/[0.05] text-white hover:bg-white/[0.08] transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Screenshot Generation Wizard */}
      {wizardOpen && wizardDeviceType && (
        <ScreenshotWizard
          projectId={projectId}
          displayType={wizardDeviceType}
          existingScreenshotUrl={
            // Use first screenshot from any device type as style reference
            Object.values(screenshotSets).find(set => set.screenshots?.length > 0)?.screenshots[0]?.marketingImageUrl
          }
          appMetadata={appMetadata || { name: project?.name || 'App', description: '' }}
          onComplete={() => {
            setWizardOpen(false)
            setWizardDeviceType(null)
            setHasChanges(true)
            loadScreenshots(false)
            showSuccess('Screenshots generated successfully!')
          }}
          onCancel={() => {
            setWizardOpen(false)
            setWizardDeviceType(null)
          }}
        />
      )}

      {importModalOpen && project && (
        <ImportMcpScreenshotsModal
          projectId={projectId}
          primaryLocale={project.primaryLocale}
          existingScreenshotSets={screenshotSets}
          onImportComplete={() => {
            setImportModalOpen(false)
            setHasChanges(true)
            loadScreenshots(false)
            showSuccess('MCP screenshots imported successfully!')
          }}
          onClose={() => setImportModalOpen(false)}
        />
      )}
    </div>
  )
}
