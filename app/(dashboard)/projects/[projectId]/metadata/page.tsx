'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams } from 'next/navigation'
import {
  Globe,
  Plus,
  Trash2,
  Sparkles,
  Save,
  Check,
  X,
  Loader2,
  Star,
  Languages,
  ChevronRight,
  AlertCircle,
  Wand2,
  Cloud,
  CloudDownload,
  CloudUpload,
  CheckCircle2,
  Clock,
  AlertTriangle,
  RefreshCw,
  HelpCircle,
  Zap,
  Target,
  FileText,
  Gauge,
} from 'lucide-react'
import { APPSTORE_LOCALES, LOCALE_NAMES, LOCALE_FLAGS } from '@/lib/constants'
import type { LocalizedMetadata, MetadataSyncStatus } from '@/lib/firebase/firestore'
import { hasInvalidAppStoreCharacters, stripEmojis } from '@/lib/services/translator'
import { ComplianceChecker } from '@/components/metadata/ComplianceChecker'

// Character sets for different language scripts for the decode effect
const SCRIPT_CHARACTERS: Record<string, string> = {
  // Cyrillic (Russian, Ukrainian, Bulgarian, etc.)
  cyrillic: 'АБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯабвгдежзийклмнопрстуфхцчшщъыьэюя',
  // Japanese (mix of hiragana, katakana, and some kanji)
  japanese: 'あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをんアイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン',
  // Chinese (common characters)
  chinese: '的一是不了在人有我他这中大来上国个到说们为子和你地出道也时年得就那要下以生会自着去之过家学对可她里后小么心多天而能好都然没日于起还发成事只作当想看文无开手十用主行方又如前所本见经头面公同三已老从动两长知民样现分将外但身些与高意进把法此实回二理美点月明其种声全工己话儿者向情部正名定女问力机给等几很业最间新什打便位低被张海四员书光体做决真求反处形望次期使白政相信定门目接报',
  // Korean
  korean: 'ㄱㄴㄷㄹㅁㅂㅅㅇㅈㅊㅋㅌㅍㅎㅏㅑㅓㅕㅗㅛㅜㅠㅡㅣ가나다라마바사아자차카타파하거너더러머버서어저처커터퍼허고노도로모보소오조초코토포호구누두루무부수우주추쿠투푸후',
  // Thai
  thai: 'กขฃคฅฆงจฉชซฌญฎฏฐฑฒณดตถทธนบปผฝพฟภมยรฤลฦวศษสหฬอฮฯะัาำิีึืุูเแโใไๅๆ็่้๊๋์',
  // Arabic
  arabic: 'ءآأؤإئابةتثجحخدذرزسشصضطظعغفقكلمنهوي',
  // Hebrew
  hebrew: 'אבגדהוזחטיכלמנסעפצקרשת',
  // Greek
  greek: 'ΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩαβγδεζηθικλμνξοπρστυφχψω',
  // Vietnamese (Latin with diacritics)
  vietnamese: 'ăâđêôơưàáảãạèéẻẽẹìíỉĩịòóỏõọùúủũụỳýỷỹỵABCDEFGHIJKLMNOPQRSTUVWXYZ',
  // Latin (default for most European languages)
  latin: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789',
}

// Map locales to their script type
function getScriptForLocale(locale: string): string {
  const localePrefix = locale.split('-')[0].toLowerCase()

  const scriptMap: Record<string, string> = {
    // Cyrillic
    'ru': 'cyrillic', 'uk': 'cyrillic', 'bg': 'cyrillic', 'sr': 'cyrillic', 'mk': 'cyrillic',
    // Japanese
    'ja': 'japanese',
    // Chinese
    'zh': 'chinese', 'cmn': 'chinese',
    // Korean
    'ko': 'korean',
    // Thai
    'th': 'thai',
    // Arabic
    'ar': 'arabic',
    // Hebrew
    'he': 'hebrew', 'iw': 'hebrew',
    // Greek
    'el': 'greek',
    // Vietnamese
    'vi': 'vietnamese',
  }

  return scriptMap[localePrefix] || 'latin'
}

// Get random character from the appropriate script
function getRandomChar(locale: string): string {
  const script = getScriptForLocale(locale)
  const chars = SCRIPT_CHARACTERS[script] || SCRIPT_CHARACTERS.latin
  return chars[Math.floor(Math.random() * chars.length)]
}

// Generate scrambled text with progressive reveal
function scrambleText(finalText: string, progress: number, locale: string): string {
  if (!finalText) return ''

  const revealedCount = Math.floor(finalText.length * progress)
  let result = ''

  for (let i = 0; i < finalText.length; i++) {
    if (i < revealedCount) {
      // Character is revealed
      result += finalText[i]
    } else if (finalText[i] === ' ' || finalText[i] === '\n') {
      // Preserve whitespace
      result += finalText[i]
    } else {
      // Scramble this character
      result += getRandomChar(locale)
    }
  }

  return result
}

// Generate fully scrambled placeholder text
function generateScrambledPlaceholder(length: number, locale: string): string {
  let result = ''
  for (let i = 0; i < length; i++) {
    result += getRandomChar(locale)
  }
  return result
}

// Hook for continuous scrambling (during API call)
function useScrambleWhileLoading(
  isScrambling: boolean,
  locale: string,
  placeholderLength: number = 20
): string {
  const [displayText, setDisplayText] = useState('')
  const animationRef = useRef<number | null>(null)

  useEffect(() => {
    if (!isScrambling) {
      setDisplayText('')
      return
    }

    const scrambleInterval = 100 // How fast scramble updates (slower = more visible)

    const animate = () => {
      // Generate new random scrambled text each frame
      setDisplayText(generateScrambledPlaceholder(placeholderLength, locale))
      animationRef.current = window.setTimeout(animate, scrambleInterval)
    }

    animate()

    return () => {
      if (animationRef.current) {
        clearTimeout(animationRef.current)
      }
    }
  }, [isScrambling, locale, placeholderLength])

  return displayText
}

// Hook for decode animation (after translation returns)
function useTextDecode(
  finalText: string,
  locale: string,
  isDecoding: boolean,
  onComplete?: () => void
): { displayText: string; isAnimating: boolean } {
  const [displayText, setDisplayText] = useState('')
  const [isAnimating, setIsAnimating] = useState(false)
  const animationRef = useRef<number | null>(null)
  const startTimeRef = useRef<number>(0)

  useEffect(() => {
    if (!isDecoding || !finalText) {
      if (!isDecoding) setDisplayText('')
      return
    }

    setIsAnimating(true)
    startTimeRef.current = Date.now()

    // Duration scales with text length, min 600ms, max 2000ms
    const duration = Math.min(2000, Math.max(600, finalText.length * 12))
    const scrambleInterval = 40 // How fast the scramble updates

    const animate = () => {
      const elapsed = Date.now() - startTimeRef.current
      const progress = Math.min(1, elapsed / duration)

      // Easing function for smoother reveal
      const easedProgress = 1 - Math.pow(1 - progress, 3)

      setDisplayText(scrambleText(finalText, easedProgress, locale))

      if (progress < 1) {
        animationRef.current = window.setTimeout(animate, scrambleInterval)
      } else {
        setDisplayText(finalText)
        setIsAnimating(false)
        onComplete?.()
      }
    }

    // Start with fully scrambled version of final text
    setDisplayText(scrambleText(finalText, 0, locale))
    animationRef.current = window.setTimeout(animate, scrambleInterval)

    return () => {
      if (animationRef.current) {
        clearTimeout(animationRef.current)
      }
    }
  }, [isDecoding, finalText, locale, onComplete])

  return { displayText, isAnimating }
}

// Decoding input field component - shows scramble animation over the input
function DecodingField({
  value,
  decodingValue,
  locale,
  isDecoding,
  isScrambling,
  placeholder,
  multiline,
  maxLength,
  onChange,
  className,
}: {
  value: string
  decodingValue?: string
  locale: string
  isDecoding: boolean
  isScrambling: boolean
  placeholder: string
  multiline: boolean
  maxLength: number
  onChange: (value: string) => void
  className: string
}) {
  // Get current value length to determine scramble length
  const currentLength = value?.length || 15
  const scrambleLength = Math.max(currentLength, multiline ? 100 : 20)

  // Scrambling during API call
  const scrambledText = useScrambleWhileLoading(isScrambling && !isDecoding, locale, scrambleLength)

  // Decoding after API returns
  const { displayText: decodedText, isAnimating: isDecodingAnimating } = useTextDecode(
    decodingValue || '',
    locale,
    isDecoding
  )

  // Phase 1: Scrambling while waiting for API
  if (isScrambling && !isDecoding) {
    return (
      <div className="relative">
        {multiline ? (
          <div
            className={`${className} ai-scrambling-field whitespace-pre-wrap overflow-hidden`}
            style={{ minHeight: '300px' }}
          >
            {scrambledText}
          </div>
        ) : (
          <div className={`${className} ai-scrambling-field overflow-hidden`}>
            {scrambledText}
          </div>
        )}
      </div>
    )
  }

  // Phase 2: Decoding/revealing the translated text
  if (isDecoding && isDecodingAnimating) {
    return (
      <div className="relative">
        {multiline ? (
          <div
            className={`${className} ai-decoding-field whitespace-pre-wrap overflow-hidden`}
            style={{ minHeight: '300px' }}
          >
            {decodedText}
          </div>
        ) : (
          <div className={`${className} ai-decoding-field overflow-hidden`}>
            {decodedText}
          </div>
        )}
      </div>
    )
  }

  // Normal input mode
  if (multiline) {
    return (
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={4}
        className={className}
      />
    )
  }

  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={className}
    />
  )
}

interface ProjectData {
  name: string
  primaryLocale: string
  enabledLocales: string[]
  storeType: 'ios' | 'android'
  appStoreAppId: string | null
  playStorePackage: string | null
  syncStatus: MetadataSyncStatus
  lastPulledAt: string | null
  lastPushedAt: string | null
  appStoreVersionState: string | null
  appStoreVersionNumber: string | null
}

const EMPTY_METADATA: LocalizedMetadata = {
  locale: '',
  name: '',
  subtitle: '',
  description: '',
  keywords: '',
  whatsNew: '',
  promotionalText: null,
  privacyUrl: null,
  marketingUrl: null,
  supportUrl: null,
  shortDescription: null,
  fullDescription: null,
  sourceHash: '',
  lastModifiedAt: null as any,
  lastModifiedBy: null as any,
}

const IOS_METADATA_FIELDS = [
  { key: 'name', label: 'App Name', placeholder: 'Your app name', multiline: false, maxLength: 30, helperText: 'Max 30 characters' },
  { key: 'subtitle', label: 'Subtitle', placeholder: 'Brief tagline', multiline: false, maxLength: 30, helperText: 'Max 30 characters' },
  { key: 'keywords', label: 'Keywords', placeholder: 'keyword1,keyword2,keyword3', multiline: false, maxLength: 100, helperText: 'Max 100 characters, comma-separated' },
  { key: 'description', label: 'Description', placeholder: 'Full app description...', multiline: true, maxLength: 4000, helperText: 'Max 4000 characters' },
  { key: 'whatsNew', label: "What's New", placeholder: 'Release notes...', multiline: true, maxLength: 4000, helperText: 'Max 4000 characters' },
  { key: 'promotionalText', label: 'Promotional Text', placeholder: 'Optional promotional message...', multiline: true, maxLength: 170, helperText: 'Max 170 characters (can update without new version)' },
] as const

const ANDROID_METADATA_FIELDS = [
  { key: 'name', label: 'Title', placeholder: 'Your app title', multiline: false, maxLength: 30, helperText: 'Max 30 characters' },
  { key: 'shortDescription', label: 'Short Description', placeholder: 'Brief app summary...', multiline: false, maxLength: 80, helperText: 'Max 80 characters — shown on Play Store listing' },
  { key: 'fullDescription', label: 'Full Description', placeholder: 'Full app description...', multiline: true, maxLength: 4000, helperText: 'Max 4000 characters' },
] as const

function formatTimeAgo(dateString: string | null): string {
  if (!dateString) return 'Never'
  const date = new Date(dateString)
  if (isNaN(date.getTime())) return 'Never'
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMins < 1) return 'Just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`
  return date.toLocaleDateString()
}

function SyncStatusBadge({ status }: { status: MetadataSyncStatus }) {
  switch (status) {
    case 'synced':
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium bg-green-500/10 text-green-400 border border-green-500/20">
          <CheckCircle2 className="w-3 h-3" />
          Synced with App Store
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
          Conflict Detected
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

export default function MetadataPage() {
  const params = useParams()
  const projectId = params.projectId as string

  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [project, setProject] = useState<ProjectData | null>(null)
  const [metadata, setMetadata] = useState<{ [locale: string]: LocalizedMetadata }>({})
  const [selectedLocale, setSelectedLocale] = useState<string>('')
  const [isSaving, setIsSaving] = useState(false)
  const [isPulling, setIsPulling] = useState(false)
  const [isPushing, setIsPushing] = useState(false)
  const [isTranslating, setIsTranslating] = useState(false)
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  const [showAddLocale, setShowAddLocale] = useState(false)
  const [localeSearch, setLocaleSearch] = useState('')
  const [selectedLocalesToAdd, setSelectedLocalesToAdd] = useState<string[]>([])
  const [aiPrompt, setAiPrompt] = useState<{ field: string; show: boolean }>({ field: '', show: false })
  const [customPrompt, setCustomPrompt] = useState('')
  const [isEnhancing, setIsEnhancing] = useState(false)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [initialMetadata, setInitialMetadata] = useState<{ [locale: string]: LocalizedMetadata }>({})
  const [justTranslatedFields, setJustTranslatedFields] = useState<Set<string>>(new Set())
  const [decodingFields, setDecodingFields] = useState<Record<string, { value: string; locale: string }>>({})
  const [isTranslatingAll, setIsTranslatingAll] = useState(false)
  const [translateAllProgress, setTranslateAllProgress] = useState<{ current: number; total: number } | null>(null)
  const [translatingLocales, setTranslatingLocales] = useState<Set<string>>(new Set()) // Currently being translated
  const [justTranslatedLocales, setJustTranslatedLocales] = useState<Set<string>>(new Set()) // Just finished translating
  const [skippedLocales, setSkippedLocales] = useState<Set<string>>(new Set()) // Skipped (already up-to-date)

  // Auto-save
  const [isAutoSaving, setIsAutoSaving] = useState(false)
  const autoSaveTimerRef = useRef<NodeJS.Timeout | null>(null)

  // Push abort controller
  const pushAbortControllerRef = useRef<AbortController | null>(null)

  // Confirmation dialogs
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [localeToDelete, setLocaleToDelete] = useState<string | null>(null)

  // Bulk delete state
  const [isBulkSelectMode, setIsBulkSelectMode] = useState(false)
  const [selectedLocalesToDelete, setSelectedLocalesToDelete] = useState<Set<string>>(new Set())
  const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false)
  const [showTranslateModal, setShowTranslateModal] = useState(false)

  // Push/Pull progress dialogs
  const [showPushDialog, setShowPushDialog] = useState(false)
  const [showPullDialog, setShowPullDialog] = useState(false)
  const [pushProgress, setPushProgress] = useState<{
    step: 'connecting' | 'publishing' | 'complete' | 'error'
    message: string
    current?: number
    total?: number
    currentLocale?: string
    currentBatch?: string[] // Locales being uploaded in parallel
    results?: Array<{ locale: string; success: boolean; error?: string }>
    error?: string
  } | null>(null)
  const [pullProgress, setPullProgress] = useState<{
    step: 'connecting' | 'fetching' | 'saving' | 'complete' | 'error'
    message: string
    localesCount?: number
    error?: string
  } | null>(null)
  const [selectedTranslateLocales, setSelectedTranslateLocales] = useState<string[]>([])
  const [showTranslateConfirm, setShowTranslateConfirm] = useState(false)
  const [forceReTranslate, setForceReTranslate] = useState(false)
  const [translationPreview, setTranslationPreview] = useState<{
    locales: Array<{
      locale: string
      fieldsToTranslate: string[]
      fieldsToSkip: string[]
    }>
    totalFields: number
    totalLocales: number
    skippedLocales: number
    // Usage info
    usage?: {
      currentUsed: number
      limit: number
      remaining: number
      willExceedLimit: boolean
    }
  } | null>(null)
  const [showTranslationHelp, setShowTranslationHelp] = useState(false)

  const getLocaleName = (locale: string): string => {
    return (LOCALE_NAMES as Record<string, string>)[locale] || locale
  }

  const getLocaleFlag = (locale: string): string => {
    return (LOCALE_FLAGS as Record<string, string>)[locale] || '🌐'
  }

  // Generate hash for field value (for sync detection)
  const generateFieldHash = (value: string): string => {
    let hash = 0
    for (let i = 0; i < value.length; i++) {
      const char = value.charCodeAt(i)
      hash = ((hash << 5) - hash) + char
      hash = hash & hash
    }
    return Math.abs(hash).toString(36)
  }

  // Get which fields in a locale need syncing with primary
  const getFieldsNeedingSync = useCallback((locale: string): string[] => {
    if (!project || locale === project.primaryLocale) return []

    const primaryMeta = metadata[project.primaryLocale]
    const localeMeta = metadata[locale]

    if (!primaryMeta) return []
    if (!localeMeta) return [] // No translation exists yet - handled separately

    const translatableFields = ['name', 'subtitle', 'description', 'keywords', 'whatsNew', 'promotionalText', 'shortDescription', 'fullDescription']
    const fieldsNeedingSync: string[] = []

    // If no primaryFieldHashes stored (legacy translation), check if fields differ from primary
    // This catches cases where translation exists but we don't have hash tracking yet
    if (!localeMeta.primaryFieldHashes) {
      // For legacy translations, we can't know for sure - return empty
      // The sync status will show based on whether translation exists at all
      return []
    }

    for (const field of translatableFields) {
      const primaryValue = (primaryMeta as any)[field]
      if (!primaryValue) continue // Skip empty fields

      const currentPrimaryHash = generateFieldHash(primaryValue)
      const storedPrimaryHash = localeMeta.primaryFieldHashes[field]

      // If no stored hash for this field but primary has value, it needs sync
      if (!storedPrimaryHash && primaryValue) {
        fieldsNeedingSync.push(field)
        continue
      }

      // If hash doesn't match, primary field has changed since translation
      if (storedPrimaryHash && currentPrimaryHash !== storedPrimaryHash) {
        fieldsNeedingSync.push(field)
      }
    }

    return fieldsNeedingSync
  }, [metadata, project])

  // Check if a locale has sync tracking (primaryFieldHashes)
  const localeHasSyncTracking = useCallback((locale: string): boolean => {
    if (!project || locale === project.primaryLocale) return true
    const localeMeta = metadata[locale]
    return !!(localeMeta?.primaryFieldHashes && Object.keys(localeMeta.primaryFieldHashes).length > 0)
  }, [metadata, project])

  // Get sync status for a locale
  // Returns: 'needs_translation' | 'needs_sync' | 'synced' | 'unknown' | null (for primary)
  const getLocaleSyncStatus = useCallback((locale: string): 'needs_translation' | 'needs_sync' | 'synced' | 'unknown' | null => {
    if (!project || locale === project.primaryLocale) return null

    const localeMeta = metadata[locale]
    const primaryMeta = metadata[project.primaryLocale]

    if (!primaryMeta) return null // No primary metadata yet

    // Check if locale has any translation (store-specific fields)
    const hasTranslation = localeMeta && (
      localeMeta.name ||
      (project.storeType === 'android'
        ? (localeMeta.shortDescription || localeMeta.fullDescription)
        : (localeMeta.subtitle || localeMeta.description || localeMeta.keywords || localeMeta.whatsNew))
    )

    if (!hasTranslation) return 'needs_translation'

    // If no sync tracking data, we don't know if it's in sync
    if (!localeHasSyncTracking(locale)) return 'unknown'

    // Check if any fields need syncing
    const fieldsNeedingSync = getFieldsNeedingSync(locale)
    if (fieldsNeedingSync.length > 0) return 'needs_sync'

    return 'synced'
  }, [metadata, project, getFieldsNeedingSync, localeHasSyncTracking])

  // Fetch project data and metadata
  const fetchData = useCallback(async () => {
    setIsLoading(true)
    setError(null)

    try {
      const response = await fetch(`/api/metadata?projectId=${projectId}`)
      if (!response.ok) throw new Error('Failed to fetch metadata')
      const data = await response.json()

      const projectData: ProjectData = {
        name: data.project.name,
        primaryLocale: data.project.primaryLocale || 'en-US',
        enabledLocales: data.project.enabledLocales || ['en-US'],
        storeType: data.project.storeType || 'ios',
        appStoreAppId: data.project.appStoreAppId || null,
        playStorePackage: data.project.playStorePackage || null,
        syncStatus: data.project.syncStatus || 'never_synced',
        lastPulledAt: data.project.lastPulledAt || null,
        lastPushedAt: data.project.lastPushedAt || null,
        appStoreVersionState: data.project.appStoreVersionState || null,
        appStoreVersionNumber: data.project.appStoreVersionNumber || null,
      }

      setProject(projectData)
      setMetadata(data.metadata || {})
      setInitialMetadata(data.metadata || {})
      setSelectedLocale(projectData.primaryLocale)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setIsLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  // Track unsaved changes
  useEffect(() => {
    setHasUnsavedChanges(JSON.stringify(metadata) !== JSON.stringify(initialMetadata))
  }, [metadata, initialMetadata])

  // Auto-save function (quieter version of handleSave)
  const performAutoSave = useCallback(async () => {
    // Don't auto-save if we're already saving, translating, or no changes
    if (isSaving || isAutoSaving || isTranslating || isTranslatingAll) return
    if (JSON.stringify(metadata) === JSON.stringify(initialMetadata)) return

    setIsAutoSaving(true)
    try {
      const response = await fetch('/api/metadata/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          locales: metadata,
          source: 'manual_edit',
          createHistoryEntry: false, // Don't create history for every auto-save
        }),
      })
      if (response.ok) {
        setInitialMetadata(metadata)
        setHasUnsavedChanges(false)
        // Update sync status locally
        if (project) {
          setProject({ ...project, syncStatus: 'local_changes' })
        }
      }
    } catch {
      // Silently fail for auto-save - user can manually save if needed
    } finally {
      setIsAutoSaving(false)
    }
  }, [metadata, initialMetadata, isSaving, isAutoSaving, isTranslating, isTranslatingAll, projectId, project])

  // Auto-save with debounce
  useEffect(() => {
    // Clear any existing timer
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current)
    }

    // Don't auto-save if no changes or currently in certain states
    if (JSON.stringify(metadata) === JSON.stringify(initialMetadata)) return
    if (isLoading || isSaving || isAutoSaving || isTranslating || isTranslatingAll) return

    // Set up debounced auto-save (2 seconds after last change)
    autoSaveTimerRef.current = setTimeout(() => {
      performAutoSave()
    }, 2000)

    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current)
      }
    }
  }, [metadata, initialMetadata, isLoading, isSaving, isAutoSaving, isTranslating, isTranslatingAll, performAutoSave])

  const currentMetadata = metadata[selectedLocale] || { ...EMPTY_METADATA, locale: selectedLocale }
  const primaryMetadata = project ? metadata[project.primaryLocale] : null
  const isPrimaryLocale = selectedLocale === project?.primaryLocale
  const hasStoreConnection = project?.appStoreAppId || project?.playStorePackage
  const storeName = project?.storeType === 'ios' ? 'App Store' : 'Play Store'

  const updateField = (field: keyof LocalizedMetadata, value: string | null) => {
    setMetadata(prev => ({
      ...prev,
      [selectedLocale]: {
        ...prev[selectedLocale],
        locale: selectedLocale,
        [field]: value,
      },
    }))
  }

  const handleSave = async () => {
    setIsSaving(true)
    setError(null)
    try {
      const response = await fetch('/api/metadata/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          locales: metadata,
          source: 'manual_edit',
          createHistoryEntry: true,
        }),
      })
      if (!response.ok) {
        // Try to parse error response, but handle empty/invalid JSON
        let errorMessage = `Save failed (${response.status})`
        try {
          const text = await response.text()
          if (text) {
            const data = JSON.parse(text)
            errorMessage = data.error || errorMessage
          }
        } catch {
          // Couldn't parse response, use default error message
        }
        throw new Error(errorMessage)
      }
      setInitialMetadata(metadata)
      setHasUnsavedChanges(false)
      // Update sync status locally
      if (project) {
        setProject({ ...project, syncStatus: 'local_changes' })
      }
      showSuccess('Changes saved')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setIsSaving(false)
    }
  }

  const handlePull = async () => {
    if (!hasStoreConnection) return

    setIsPulling(true)
    setShowPullDialog(true)
    setError(null)

    // Step 1: Connecting
    setPullProgress({
      step: 'connecting',
      message: `Connecting to ${storeName}...`,
    })

    try {
      // Small delay for visual feedback
      await new Promise(resolve => setTimeout(resolve, 500))

      // Step 2: Fetching
      setPullProgress({
        step: 'fetching',
        message: `Fetching localizations from ${storeName}...`,
      })

      const response = await fetch('/api/metadata/pull', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          store: project?.storeType === 'ios' ? 'appstore' : 'playstore',
        }),
      })

      if (!response.ok) {
        let errorMessage = `Pull failed (${response.status})`
        try {
          const text = await response.text()
          if (text) {
            const data = JSON.parse(text)
            errorMessage = data.error || errorMessage
          }
        } catch {
          // Couldn't parse response
        }
        throw new Error(errorMessage)
      }

      const data = await response.json()

      // Step 3: Saving
      setPullProgress({
        step: 'saving',
        message: `Saving ${data.localesCount} locales...`,
        localesCount: data.localesCount,
      })

      // Refresh data
      await fetchData()

      // Step 4: Complete
      setPullProgress({
        step: 'complete',
        message: `Successfully pulled ${data.localesCount} locales from ${storeName}`,
        localesCount: data.localesCount,
      })

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to pull metadata'
      setPullProgress({
        step: 'error',
        message: 'Pull failed',
        error: errorMessage,
      })
      setError(errorMessage)
    } finally {
      setIsPulling(false)
    }
  }

  const handlePush = async () => {
    if (!hasStoreConnection || hasUnsavedChanges) return

    const totalLocales = project?.enabledLocales.length || 0

    // Create new abort controller for this push
    pushAbortControllerRef.current = new AbortController()

    setIsPushing(true)
    setShowPushDialog(true)
    setError(null)

    // Step 1: Connecting
    setPushProgress({
      step: 'connecting',
      message: `Connecting to ${storeName}...`,
      total: totalLocales,
      current: 0,
    })

    try {
      const response = await fetch('/api/metadata/publish/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          store: project?.storeType === 'ios' ? 'appstore' : 'playstore',
        }),
        signal: pushAbortControllerRef.current?.signal,
      })

      if (!response.ok) {
        let errorMessage = `Publish failed (${response.status})`
        try {
          const text = await response.text()
          if (text) {
            const data = JSON.parse(text)
            errorMessage = data.error || errorMessage
          }
        } catch {
          // Couldn't parse response
        }
        throw new Error(errorMessage)
      }

      // Read the SSE stream
      const reader = response.body?.getReader()
      if (!reader) throw new Error('No response body')

      const decoder = new TextDecoder()
      let buffer = ''
      const results: Array<{ locale: string; success: boolean; error?: string }> = []

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        let eventType = ''
        for (const line of lines) {
          if (line.startsWith('event: ')) {
            eventType = line.slice(7)
          } else if (line.startsWith('data: ')) {
            const data = JSON.parse(line.slice(6))

            if (eventType === 'start') {
              setPushProgress({
                step: 'publishing',
                message: `Publishing ${data.total} locales to ${storeName}...`,
                current: 0,
                total: data.total,
              })
            } else if (eventType === 'progress') {
              // Track results
              if (data.status === 'success' || data.status === 'failed') {
                results.push({
                  locale: data.locale,
                  success: data.status === 'success',
                  error: data.error,
                })
              }
              setPushProgress(prev => ({
                ...prev!,
                step: 'publishing',
                message: data.status === 'uploading'
                  ? data.batch
                    ? `Uploading ${data.batch.length} locales in parallel...`
                    : `Uploading ${getLocaleName(data.locale)}...`
                  : `Published ${data.current}/${data.total} locales`,
                current: data.current,
                total: data.total,
                currentLocale: data.locale,
                currentBatch: data.batch,
              }))
            } else if (eventType === 'complete') {
              // Refresh data
              await fetchData()

              const hasFailures = data.stats.failed > 0
              setPushProgress({
                step: hasFailures ? 'error' : 'complete',
                message: hasFailures
                  ? `Published with errors: ${data.stats.success}/${data.stats.total} locales succeeded`
                  : `Successfully published ${data.stats.success} locales to ${storeName}`,
                current: data.stats.total,
                total: data.stats.total,
                results: data.results,
                error: hasFailures ? `${data.stats.failed} locale(s) failed` : undefined,
              })
            } else if (eventType === 'error') {
              throw new Error(data.message)
            }
          }
        }
      }

    } catch (err) {
      // Handle cancellation
      if (err instanceof Error && (err.name === 'AbortError' || err.message === 'Cancelled')) {
        setShowPushDialog(false)
        setPushProgress(null)
        return
      }

      const errorMessage = err instanceof Error ? err.message : 'Failed to publish metadata'
      setPushProgress({
        step: 'error',
        message: 'Publish failed',
        error: errorMessage,
      })
      setError(errorMessage)
    } finally {
      setIsPushing(false)
      pushAbortControllerRef.current = null
    }
  }

  const handleCancelPush = () => {
    if (pushAbortControllerRef.current) {
      pushAbortControllerRef.current.abort()
    }
  }

  const handleAddLocale = async (locale: string) => {
    if (!project || project.enabledLocales.includes(locale)) return

    const newEnabledLocales = [...project.enabledLocales, locale]

    try {
      const response = await fetch(`/api/projects/${projectId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ enabledLocales: newEnabledLocales }),
      })
      if (!response.ok) throw new Error('Failed to add locale')

      setProject({ ...project, enabledLocales: newEnabledLocales })
      setMetadata(prev => ({
        ...prev,
        [locale]: { ...EMPTY_METADATA, locale },
      }))
      setSelectedLocale(locale)
      setShowAddLocale(false)
      setLocaleSearch('')
      showSuccess(`Added ${getLocaleName(locale)}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add locale')
    }
  }

  const handleAddMultipleLocales = async () => {
    if (!project || selectedLocalesToAdd.length === 0) return

    const localesToAdd = selectedLocalesToAdd.filter(l => !project.enabledLocales.includes(l))
    if (localesToAdd.length === 0) return

    const newEnabledLocales = [...project.enabledLocales, ...localesToAdd]

    try {
      const response = await fetch(`/api/projects/${projectId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ enabledLocales: newEnabledLocales }),
      })
      if (!response.ok) throw new Error('Failed to add locales')

      setProject({ ...project, enabledLocales: newEnabledLocales })
      setMetadata(prev => {
        const updated = { ...prev }
        localesToAdd.forEach(locale => {
          updated[locale] = { ...EMPTY_METADATA, locale }
        })
        return updated
      })
      setSelectedLocale(localesToAdd[0])
      setShowAddLocale(false)
      setLocaleSearch('')
      setSelectedLocalesToAdd([])
      showSuccess(`Added ${localesToAdd.length} language${localesToAdd.length > 1 ? 's' : ''}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add locales')
    }
  }

  // Show delete confirmation dialog
  const handleRemoveLocale = (locale: string) => {
    if (!project || locale === project.primaryLocale) return
    setLocaleToDelete(locale)
    setShowDeleteConfirm(true)
  }

  // Actually delete the locale after confirmation
  const confirmRemoveLocale = async () => {
    if (!project || !localeToDelete) return

    const locale = localeToDelete
    const newEnabledLocales = project.enabledLocales.filter(l => l !== locale)

    try {
      const response = await fetch(`/api/projects/${projectId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ enabledLocales: newEnabledLocales }),
      })
      if (!response.ok) throw new Error('Failed to remove locale')

      setProject({ ...project, enabledLocales: newEnabledLocales })
      const newMetadata = { ...metadata }
      delete newMetadata[locale]
      setMetadata(newMetadata)

      if (selectedLocale === locale) {
        setSelectedLocale(project.primaryLocale)
      }
      showSuccess(`Removed ${getLocaleName(locale)}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove locale')
    } finally {
      setShowDeleteConfirm(false)
      setLocaleToDelete(null)
    }
  }

  const confirmBulkDeleteLocales = async () => {
    if (!project || selectedLocalesToDelete.size === 0) return

    const localesToRemove = Array.from(selectedLocalesToDelete)
    const newEnabledLocales = project.enabledLocales.filter(l => !localesToRemove.includes(l))

    try {
      const response = await fetch(`/api/projects/${projectId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ enabledLocales: newEnabledLocales }),
      })
      if (!response.ok) throw new Error('Failed to remove locales')

      setProject({ ...project, enabledLocales: newEnabledLocales })
      const newMetadata = { ...metadata }
      for (const locale of localesToRemove) {
        delete newMetadata[locale]
      }
      setMetadata(newMetadata)

      if (selectedLocale && localesToRemove.includes(selectedLocale)) {
        setSelectedLocale(project.primaryLocale)
      }

      showSuccess(`Removed ${localesToRemove.length} language${localesToRemove.length > 1 ? 's' : ''}`)
      setSelectedLocalesToDelete(new Set())
      setIsBulkSelectMode(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove locales')
    } finally {
      setShowBulkDeleteConfirm(false)
    }
  }

  const handleTranslateAll = async () => {
    if (!project || isPrimaryLocale || !primaryMetadata) return

    const startTime = Date.now()
    const MIN_SCRAMBLE_DURATION = 1500 // Minimum time to show scrambling effect (1.5s)

    setIsTranslating(true)
    setError(null)
    setJustTranslatedFields(new Set())
    setDecodingFields({})

    // Generate per-field hashes of current primary content for sync tracking
    const currentFieldHashes = generateFieldHashes(primaryMetadata)

    try {
      // Build metadata object from primary locale (store-specific fields)
      const sourceMetadata: Record<string, string | undefined> = project.storeType === 'android'
        ? {
            title: primaryMetadata.name || undefined,
            shortDescription: primaryMetadata.shortDescription || undefined,
            fullDescription: primaryMetadata.fullDescription || undefined,
          }
        : {
            title: primaryMetadata.name || undefined,
            subtitle: primaryMetadata.subtitle || undefined,
            description: primaryMetadata.description || undefined,
            keywords: primaryMetadata.keywords || undefined,
            whatsNew: primaryMetadata.whatsNew || undefined,
            promotionalText: primaryMetadata.promotionalText || undefined,
          }

      const response = await fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          store: project.storeType === 'ios' ? 'appstore' : 'playstore',
          locales: [selectedLocale],
          force: forceReTranslate,
          metadata: sourceMetadata,
        }),
      })

      if (!response.ok) {
        let errorMessage = `Translation failed (${response.status})`
        try {
          const text = await response.text()
          if (text) {
            const data = JSON.parse(text)
            errorMessage = data.error || errorMessage
          }
        } catch {
          // Couldn't parse response
        }
        throw new Error(errorMessage)
      }

      const data = await response.json()
      const translatedFieldsData = data.translations[selectedLocale]

      // Ensure minimum scrambling duration for visual effect
      const elapsed = Date.now() - startTime
      if (elapsed < MIN_SCRAMBLE_DURATION) {
        await new Promise(resolve => setTimeout(resolve, MIN_SCRAMBLE_DURATION - elapsed))
      }

      if (translatedFieldsData) {
        // Track which fields were translated for animation
        const newlyTranslated = new Set<string>()
        const newDecodingFields: Record<string, { value: string; locale: string }> = {}

        // Set up decoding animation for each translated field
        if (translatedFieldsData.title) {
          newlyTranslated.add('name')
          newDecodingFields['name'] = { value: translatedFieldsData.title, locale: selectedLocale }
        }

        if (project.storeType === 'android') {
          // Android-specific fields
          if (translatedFieldsData.shortDescription) {
            newlyTranslated.add('shortDescription')
            newDecodingFields['shortDescription'] = { value: translatedFieldsData.shortDescription, locale: selectedLocale }
          }
          if (translatedFieldsData.fullDescription) {
            newlyTranslated.add('fullDescription')
            newDecodingFields['fullDescription'] = { value: translatedFieldsData.fullDescription, locale: selectedLocale }
          }
        } else {
          // iOS-specific fields
          if (translatedFieldsData.subtitle) {
            newlyTranslated.add('subtitle')
            newDecodingFields['subtitle'] = { value: translatedFieldsData.subtitle, locale: selectedLocale }
          }
          if (translatedFieldsData.description) {
            newlyTranslated.add('description')
            newDecodingFields['description'] = { value: translatedFieldsData.description, locale: selectedLocale }
          }
          if (translatedFieldsData.keywords) {
            newlyTranslated.add('keywords')
            newDecodingFields['keywords'] = { value: translatedFieldsData.keywords, locale: selectedLocale }
          }
          if (translatedFieldsData.promotionalText) {
            newlyTranslated.add('promotionalText')
            newDecodingFields['promotionalText'] = { value: translatedFieldsData.promotionalText, locale: selectedLocale }
          }
          if (translatedFieldsData.whatsNew) {
            newlyTranslated.add('whatsNew')
            newDecodingFields['whatsNew'] = { value: translatedFieldsData.whatsNew, locale: selectedLocale }
          }
        }

        // Build updated metadata with primaryFieldHashes for sync tracking
        const updatedLocaleData = project.storeType === 'android'
          ? {
              ...metadata[selectedLocale],
              name: translatedFieldsData.title || metadata[selectedLocale]?.name || '',
              shortDescription: translatedFieldsData.shortDescription || metadata[selectedLocale]?.shortDescription || '',
              fullDescription: translatedFieldsData.fullDescription || metadata[selectedLocale]?.fullDescription || '',
              locale: selectedLocale,
              primaryFieldHashes: {
                ...(metadata[selectedLocale] as any)?.primaryFieldHashes,
                ...currentFieldHashes,
              },
            }
          : {
              ...metadata[selectedLocale],
              name: translatedFieldsData.title || metadata[selectedLocale]?.name || '',
              subtitle: translatedFieldsData.subtitle || metadata[selectedLocale]?.subtitle || '',
              description: translatedFieldsData.description || metadata[selectedLocale]?.description || '',
              keywords: translatedFieldsData.keywords || metadata[selectedLocale]?.keywords || '',
              whatsNew: translatedFieldsData.whatsNew || metadata[selectedLocale]?.whatsNew || '',
              promotionalText: translatedFieldsData.promotionalText || metadata[selectedLocale]?.promotionalText || '',
              locale: selectedLocale,
              primaryFieldHashes: {
                ...(metadata[selectedLocale] as any)?.primaryFieldHashes,
                ...currentFieldHashes,
              },
            }

        // Update metadata immediately (the decoding overlay will show the animation)
        setMetadata(prev => ({
          ...prev,
          [selectedLocale]: updatedLocaleData,
        }))

        // Save to server with 'ai_translation' source to persist primaryFieldHashes
        try {
          await fetch('/api/metadata/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              projectId,
              locales: { [selectedLocale]: updatedLocaleData },
              source: 'ai_translation',
              createHistoryEntry: true,
            }),
          })
          // Update initial metadata to prevent auto-save from overwriting with manual_edit source
          setInitialMetadata(prev => ({ ...prev, [selectedLocale]: updatedLocaleData }))
        } catch (saveErr) {
          console.error('Failed to save translation:', saveErr)
        }

        // Trigger decode animation for translated fields
        setDecodingFields(newDecodingFields)
        setJustTranslatedFields(newlyTranslated)

        // Clear the animation state after longest animation completes (2.5s max + buffer)
        setTimeout(() => {
          setDecodingFields({})
          setJustTranslatedFields(new Set())
        }, 3000)
      }
      showSuccess('Translation complete')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Translation failed')
    } finally {
      setIsTranslating(false)
    }
  }

  const handleEnhanceField = async (field: string) => {
    if (!customPrompt.trim()) return

    setIsEnhancing(true)
    setError(null)

    try {
      const currentValue = (currentMetadata as unknown as Record<string, string | null>)[field] || ''
      const response = await fetch('/api/ai/enhance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          field,
          currentValue,
          locale: selectedLocale,
          prompt: customPrompt,
          referenceValue: !isPrimaryLocale && primaryMetadata
            ? (primaryMetadata as unknown as Record<string, string | null>)[field]
            : null,
        }),
      })

      if (!response.ok) {
        let errorMessage = `Enhancement failed (${response.status})`
        try {
          const text = await response.text()
          if (text) {
            const data = JSON.parse(text)
            errorMessage = data.error || errorMessage
          }
        } catch {
          // Couldn't parse response
        }
        throw new Error(errorMessage)
      }

      const data = await response.json()
      updateField(field as keyof LocalizedMetadata, data.enhanced)
      setAiPrompt({ field: '', show: false })
      setCustomPrompt('')
      showSuccess('Field updated')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Enhancement failed')
    } finally {
      setIsEnhancing(false)
    }
  }

  // Field names mapping between metadata and API
  const IOS_FIELD_MAP = {
    name: 'title',
    subtitle: 'subtitle',
    description: 'description',
    keywords: 'keywords',
    whatsNew: 'whatsNew',
    promotionalText: 'promotionalText',
  } as const

  const ANDROID_FIELD_MAP = {
    name: 'title',
    shortDescription: 'shortDescription',
    fullDescription: 'fullDescription',
  } as const

  const FIELD_MAP = project?.storeType === 'android' ? ANDROID_FIELD_MAP : IOS_FIELD_MAP
  type FieldKey = string

  // Generate per-field hashes for the primary metadata (must match backend generateFieldHash)
  const generateFieldHashes = (meta: LocalizedMetadata): Record<string, string> => {
    if (project?.storeType === 'android') {
      return {
        name: generateFieldHash(meta.name || ''),
        shortDescription: generateFieldHash(meta.shortDescription || ''),
        fullDescription: generateFieldHash(meta.fullDescription || ''),
      }
    }
    return {
      name: generateFieldHash(meta.name || ''),
      subtitle: generateFieldHash(meta.subtitle || ''),
      description: generateFieldHash(meta.description || ''),
      keywords: generateFieldHash(meta.keywords || ''),
      whatsNew: generateFieldHash(meta.whatsNew || ''),
      promotionalText: generateFieldHash(meta.promotionalText || ''),
    }
  }

  // Get stored per-field hashes from primaryFieldHashes (hashes of primary locale at translation time)
  const getStoredPrimaryHashes = (localeMetadata: LocalizedMetadata | undefined): Record<string, string> => {
    if (!localeMetadata?.primaryFieldHashes) return {}
    return localeMetadata.primaryFieldHashes
  }

  // Field display names for the preview
  const FIELD_DISPLAY_NAMES: Record<string, string> = project?.storeType === 'android'
    ? {
        name: 'Title',
        shortDescription: 'Short Description',
        fullDescription: 'Full Description',
      }
    : {
        name: 'App Name',
        subtitle: 'Subtitle',
        description: 'Description',
        keywords: 'Keywords',
        whatsNew: "What's New",
        promotionalText: 'Promotional Text',
      }

  // Show translation preview dialog
  const handleShowTranslatePreview = async () => {
    if (!project || !primaryMetadata) return

    const targetLocales = selectedTranslateLocales.length > 0
      ? selectedTranslateLocales
      : project.enabledLocales.filter(l => l !== project.primaryLocale)
    if (targetLocales.length === 0) {
      setError('No languages selected for translation.')
      return
    }

    setShowTranslateModal(false)

    // Generate per-field hashes of current primary content
    const currentFieldHashes = generateFieldHashes(primaryMetadata)

    // Compute which fields need translation for each locale
    const localeDetails: Array<{
      locale: string
      fieldsToTranslate: string[]
      fieldsToSkip: string[]
    }> = []

    let totalFields = 0
    let totalLocalesWithChanges = 0
    let skippedCount = 0

    for (const locale of targetLocales) {
      const localeMetadata = metadata[locale]
      const storedPrimaryHashes = getStoredPrimaryHashes(localeMetadata)

      const fieldsToTranslate: string[] = []
      const fieldsToSkip: string[] = []

      for (const field of Object.keys(FIELD_MAP) as FieldKey[]) {
        const primaryValue = (primaryMetadata as any)[field]
        if (!primaryValue) continue // Skip empty primary fields

        const currentHash = currentFieldHashes[field]
        const storedHash = storedPrimaryHashes[field]
        const targetValue = localeMetadata ? (localeMetadata as any)[field] : ''

        // Force mode: translate all fields regardless of hash match
        if (forceReTranslate || !storedHash || storedHash !== currentHash || !targetValue) {
          fieldsToTranslate.push(field)
        } else {
          fieldsToSkip.push(field)
        }
      }

      if (fieldsToTranslate.length > 0) {
        localeDetails.push({
          locale,
          fieldsToTranslate,
          fieldsToSkip,
        })
        totalFields += fieldsToTranslate.length
        totalLocalesWithChanges++
      } else {
        skippedCount++
      }
    }

    // Fetch current usage to check the hard plan limit.
    let usageInfo: {
      currentUsed: number
      limit: number
      remaining: number
      willExceedLimit: boolean
    } | undefined = undefined
    try {
      const response = await fetch('/api/usage')
      if (response.ok) {
        const data = await response.json()
        const { translations } = data
        const translationsNeeded = totalLocalesWithChanges // 1 translation credit per locale
        const remaining = translations.limit === -1 ? -1 : Math.max(0, translations.limit - translations.used)
        const willExceedLimit = translations.limit !== -1 && translationsNeeded > remaining

        usageInfo = {
          currentUsed: translations.used,
          limit: translations.limit,
          remaining,
          willExceedLimit,
        }
      }
    } catch {
      // Silently fail - usage info is optional
    }

    setTranslationPreview({
      locales: localeDetails,
      totalFields,
      totalLocales: totalLocalesWithChanges,
      skippedLocales: skippedCount,
      usage: usageInfo,
    })
    setShowTranslateConfirm(true)
  }

  // Translate primary language to selected locales (in parallel batches)
  const handleTranslateToAllLanguages = async () => {
    if (!project || !primaryMetadata) return

    const targetLocales = selectedTranslateLocales.length > 0
      ? selectedTranslateLocales
      : project.enabledLocales.filter(l => l !== project.primaryLocale)
    if (targetLocales.length === 0) {
      setError('No languages selected for translation.')
      return
    }

    // Generate per-field hashes of current primary content
    const currentFieldHashes = generateFieldHashes(primaryMetadata)

    setIsTranslatingAll(true)
    setTranslateAllProgress({ current: 0, total: targetLocales.length })
    setTranslatingLocales(new Set())
    setJustTranslatedLocales(new Set())
    setSkippedLocales(new Set())
    setError(null)

    try {
      let successCount = 0
      let failCount = 0
      let skippedCount = 0
      let completedCount = 0
      let totalFieldsTranslated = 0

      // Get which fields need translation for a locale
      const getFieldsToTranslate = (locale: string): FieldKey[] => {
        const localeMetadata = metadata[locale]
        const storedPrimaryHashes = getStoredPrimaryHashes(localeMetadata)

        const fieldsToTranslate: FieldKey[] = []
        for (const field of Object.keys(FIELD_MAP) as FieldKey[]) {
          const primaryValue = (primaryMetadata as any)[field]
          // Translate if: no stored hash, hash mismatch, or field is empty in target
          if (!primaryValue) continue // Skip empty primary fields

          const currentHash = currentFieldHashes[field]
          const storedHash = storedPrimaryHashes[field]
          const targetValue = localeMetadata ? (localeMetadata as any)[field] : ''

          // Force mode: translate all fields regardless of hash match
          if (forceReTranslate || !storedHash || storedHash !== currentHash || !targetValue) {
            fieldsToTranslate.push(field)
          }
        }
        return fieldsToTranslate
      }

      // Process a single locale translation
      const translateLocale = async (locale: string): Promise<'success' | 'failed' | 'skipped'> => {
        const fieldsToTranslate = getFieldsToTranslate(locale)

        // Check if any fields need translation
        if (fieldsToTranslate.length === 0) {
          setSkippedLocales(prev => new Set([...prev, locale]))
          return 'skipped'
        }

        // Mark as currently translating
        setTranslatingLocales(prev => new Set([...prev, locale]))

        try {
          // Build metadata object with only the fields that need translation
          const sourceMetadata: Record<string, string | undefined> = {}
          for (const field of fieldsToTranslate) {
            const apiField = (FIELD_MAP as Record<string, string>)[field]
            sourceMetadata[apiField] = (primaryMetadata as any)[field] || undefined
          }

          const response = await fetch('/api/translate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              projectId,
              store: project.storeType === 'ios' ? 'appstore' : 'playstore',
              locales: [locale],
              force: forceReTranslate,
              metadata: sourceMetadata,
            }),
          })

          // Remove from translating
          setTranslatingLocales(prev => {
            const next = new Set(prev)
            next.delete(locale)
            return next
          })

          if (!response.ok) {
            console.error(`Translation failed for ${locale}`)
            return 'failed'
          }

          const data = await response.json()
          const translatedFieldsData = data.translations[locale]

          if (translatedFieldsData) {
            // Build primaryFieldHashes for all fields (hash of primary content at translation time)
            // This matches what the server stores when source='ai_translation'
            const newPrimaryFieldHashes = { ...currentFieldHashes }

            // Update metadata for this locale with only the translated fields
            setMetadata(prev => {
              const existing = prev[locale] || {}
              const updated: any = {
                ...existing,
                locale: locale,
                // Store primaryFieldHashes (matches server-side storage)
                primaryFieldHashes: {
                  ...(existing as any).primaryFieldHashes,
                  ...newPrimaryFieldHashes,
                },
              }

              // Only update fields that were translated
              if (translatedFieldsData.title && fieldsToTranslate.includes('name')) {
                updated.name = translatedFieldsData.title
              }

              if (project.storeType === 'android') {
                // Android-specific fields
                if (translatedFieldsData.shortDescription && fieldsToTranslate.includes('shortDescription')) {
                  updated.shortDescription = translatedFieldsData.shortDescription
                }
                if (translatedFieldsData.fullDescription && fieldsToTranslate.includes('fullDescription')) {
                  updated.fullDescription = translatedFieldsData.fullDescription
                }
              } else {
                // iOS-specific fields
                if (translatedFieldsData.subtitle && fieldsToTranslate.includes('subtitle')) {
                  updated.subtitle = translatedFieldsData.subtitle
                }
                if (translatedFieldsData.description && fieldsToTranslate.includes('description')) {
                  updated.description = translatedFieldsData.description
                }
                if (translatedFieldsData.keywords && fieldsToTranslate.includes('keywords')) {
                  updated.keywords = translatedFieldsData.keywords
                }
                if (translatedFieldsData.promotionalText && fieldsToTranslate.includes('promotionalText')) {
                  updated.promotionalText = translatedFieldsData.promotionalText
                }
                if (translatedFieldsData.whatsNew && fieldsToTranslate.includes('whatsNew')) {
                  updated.whatsNew = translatedFieldsData.whatsNew
                }
              }

              return { ...prev, [locale]: updated }
            })

            totalFieldsTranslated += fieldsToTranslate.length
            setJustTranslatedLocales(prev => new Set([...prev, locale]))
            return 'success'
          }
          return 'failed'
        } catch (err) {
          console.error(`Translation error for ${locale}:`, err)
          setTranslatingLocales(prev => {
            const next = new Set(prev)
            next.delete(locale)
            return next
          })
          return 'failed'
        }
      }

      // Process in batches of 5 for parallel execution
      const BATCH_SIZE = 5
      for (let i = 0; i < targetLocales.length; i += BATCH_SIZE) {
        const batch = targetLocales.slice(i, i + BATCH_SIZE)

        // Process batch in parallel
        const results = await Promise.all(batch.map(translateLocale))

        // Count results
        results.forEach(result => {
          if (result === 'success') successCount++
          else if (result === 'failed') failCount++
          else if (result === 'skipped') skippedCount++
          completedCount++
        })

        // Update progress after each batch
        setTranslateAllProgress({ current: completedCount, total: targetLocales.length })

        // Small delay between batches to avoid rate limiting
        if (i + BATCH_SIZE < targetLocales.length) {
          await new Promise(resolve => setTimeout(resolve, 500))
        }
      }

      // Save translated metadata with 'ai_translation' source to store primaryFieldHashes
      // This is needed for sync tracking to work correctly
      if (successCount > 0) {
        try {
          // Get the current metadata state (which includes the translations we just added)
          // We need to use a callback to get the latest state
          const currentMetadata = await new Promise<Record<string, any>>(resolve => {
            setMetadata(prev => {
              resolve(prev)
              return prev
            })
          })

          // Get the current skipped locales state
          const currentSkippedLocales = await new Promise<Set<string>>(resolve => {
            setSkippedLocales(prev => {
              resolve(prev)
              return prev
            })
          })

          // Only save the locales that were successfully translated (not skipped)
          const translatedLocalesData: Record<string, any> = {}
          for (const locale of targetLocales) {
            if (currentMetadata[locale] && !currentSkippedLocales.has(locale)) {
              translatedLocalesData[locale] = currentMetadata[locale]
            }
          }

          if (Object.keys(translatedLocalesData).length > 0) {
            await fetch('/api/metadata/save', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                projectId,
                locales: translatedLocalesData,
                source: 'ai_translation',
                createHistoryEntry: true,
              }),
            })
            // Update initial metadata to prevent auto-save from overwriting with manual_edit source
            setInitialMetadata(prev => ({ ...prev, ...translatedLocalesData }))
          }
        } catch (saveErr) {
          console.error('Failed to save translations:', saveErr)
        }
      }

      // Build success message with field-level detail
      let message = ''
      if (skippedCount === targetLocales.length) {
        message = 'All languages already up-to-date'
      } else if (failCount === 0) {
        const fieldsInfo = totalFieldsTranslated > 0 ? ` (${totalFieldsTranslated} fields)` : ''
        message = skippedCount > 0
          ? `Translated ${successCount} languages${fieldsInfo} (${skippedCount} already up-to-date)`
          : `Translated ${successCount} languages${fieldsInfo}`
      } else {
        message = `Translated ${successCount}/${targetLocales.length} languages (${failCount} failed, ${skippedCount} skipped)`
      }
      showSuccess(message)

      // Refresh data from server to ensure sync status is accurate
      // This fetches the authoritative primaryFieldHashes stored by the server
      if (successCount > 0) {
        await fetchData()
      }

      // Clear highlights after a delay
      setTimeout(() => {
        setJustTranslatedLocales(new Set())
        setSkippedLocales(new Set())
      }, 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Translation failed')
    } finally {
      setIsTranslatingAll(false)
      setTranslateAllProgress(null)
      setTranslatingLocales(new Set())
      setSelectedTranslateLocales([])
    }
  }

  const showSuccess = (message: string) => {
    setSuccessMessage(message)
    setTimeout(() => setSuccessMessage(null), 3000)
  }

  const availableLocales = APPSTORE_LOCALES.filter(
    locale => !project?.enabledLocales.includes(locale)
  ).filter(locale => {
    if (!localeSearch) return true
    const name = getLocaleName(locale).toLowerCase()
    return name.includes(localeSearch.toLowerCase()) || locale.toLowerCase().includes(localeSearch.toLowerCase())
  })

  if (isLoading) {
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
        <button onClick={fetchData} className="px-4 py-2 rounded-xl bg-white/[0.05] text-white hover:bg-white/[0.1]">
          Try Again
        </button>
      </div>
    )
  }

  return (
    <div className="h-full">
      {/* Header */}
      <div className="flex flex-col gap-4 mb-6">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-xl font-bold text-white">Metadata</h1>
            <p className="text-sm text-neutral-400">Manage app store listings for all languages</p>
          </div>
          <div className="flex items-center gap-3">
            {isAutoSaving ? (
              <span className="flex items-center gap-1.5 text-xs text-neutral-400">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Saving...
              </span>
            ) : hasUnsavedChanges ? (
              <span className="flex items-center gap-1.5 text-xs text-amber-400">
                <AlertCircle className="w-3.5 h-3.5" />
                Unsaved changes
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-xs text-neutral-500">
                <Check className="w-3.5 h-3.5" />
                Saved
              </span>
            )}
            <button
              onClick={handleSave}
              disabled={isSaving || isAutoSaving || !hasUnsavedChanges}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium
                       bg-white/[0.1] text-white border border-white/[0.15]
                       hover:bg-white/[0.15] disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Save
            </button>
          </div>
        </div>

        {/* Sync Status Bar */}
        {hasStoreConnection ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {/* Sync Status Card */}
            <div className="rounded-xl bg-white/[0.02] border border-white/[0.08] p-4">
              <div className="text-[10px] uppercase tracking-wider text-neutral-500 mb-2">Sync Status</div>
              <SyncStatusBadge status={project?.syncStatus || 'never_synced'} />
            </div>

            {/* Version Card (iOS only) or Placeholder */}
            {project?.storeType === 'ios' ? (
              <div className="rounded-xl bg-white/[0.02] border border-white/[0.08] p-4">
                <div className="text-[10px] uppercase tracking-wider text-neutral-500 mb-2">App Store Version</div>
                <div className="flex items-center gap-2">
                  <span className="text-xl font-semibold text-white">{project.appStoreVersionNumber || '—'}</span>
                  {project.appStoreVersionState && (
                    <span className={`px-2 py-0.5 rounded text-[10px] font-medium uppercase tracking-wide ${
                      ['PREPARE_FOR_SUBMISSION', 'METADATA_REJECTED', 'DEVELOPER_REJECTED'].includes(project.appStoreVersionState)
                        ? 'bg-green-500/10 text-green-400 border border-green-500/20'
                        : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                    }`}>
                      {project.appStoreVersionState.replace(/_/g, ' ')}
                    </span>
                  )}
                </div>
                <div className="mt-2 text-xs text-neutral-500">
                  {['PREPARE_FOR_SUBMISSION', 'METADATA_REJECTED', 'DEVELOPER_REJECTED'].includes(project.appStoreVersionState || '')
                    ? 'Ready for metadata updates'
                    : 'Version in review or processing'}
                </div>
              </div>
            ) : (
              <div className="rounded-xl bg-white/[0.02] border border-white/[0.08] p-4">
                <div className="text-[10px] uppercase tracking-wider text-neutral-500 mb-2">Play Store</div>
                <div className="text-sm text-neutral-400">
                  {project?.playStorePackage || 'Package not configured'}
                </div>
              </div>
            )}

            {/* Emoji Issues Warning */}
            {project?.storeType === 'ios' && (() => {
              const localesWithEmojiIssues = Object.entries(metadata).filter(([, meta]) =>
                (meta?.name && hasInvalidAppStoreCharacters(meta.name)) ||
                (meta?.subtitle && hasInvalidAppStoreCharacters(meta.subtitle))
              )
              if (localesWithEmojiIssues.length === 0) return null

              return (
                <div className="rounded-xl bg-amber-500/10 border border-amber-500/20 p-4">
                  <div className="flex items-start gap-3">
                    <AlertCircle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-amber-300">
                        {localesWithEmojiIssues.length} locale{localesWithEmojiIssues.length > 1 ? 's' : ''} with invalid characters
                      </p>
                      <p className="text-xs text-amber-400/70 mt-1">
                        App Store doesn&apos;t allow emojis in name/subtitle fields
                      </p>
                      <div className="flex flex-wrap gap-1 mt-2">
                        {localesWithEmojiIssues.slice(0, 5).map(([locale]) => (
                          <span key={locale} className="text-xs text-amber-300/70">
                            {getLocaleFlag(locale)}
                          </span>
                        ))}
                        {localesWithEmojiIssues.length > 5 && (
                          <span className="text-xs text-amber-300/70">+{localesWithEmojiIssues.length - 5} more</span>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={() => {
                        // Fix all locales with emoji issues
                        const updates: Record<string, LocalizedMetadata> = {}
                        localesWithEmojiIssues.forEach(([locale, meta]) => {
                          updates[locale] = {
                            ...meta,
                            name: meta?.name ? stripEmojis(meta.name) : meta?.name,
                            subtitle: meta?.subtitle ? stripEmojis(meta.subtitle) : meta?.subtitle,
                          } as LocalizedMetadata
                        })
                        setMetadata(prev => ({ ...prev, ...updates }))
                        setHasUnsavedChanges(true)
                      }}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium
                               bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 transition-colors whitespace-nowrap"
                    >
                      <Wand2 className="w-3.5 h-3.5" />
                      Fix All
                    </button>
                  </div>
                </div>
              )
            })()}

            {/* Actions Card */}
            <div className="rounded-xl bg-white/[0.02] border border-white/[0.08] p-4">
              <div className="text-[10px] uppercase tracking-wider text-neutral-500 mb-2">Actions</div>
              <div className="flex flex-col gap-2">
                <button
                  onClick={handlePull}
                  disabled={isPulling || isPushing}
                  className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium
                           bg-white/[0.05] text-white border border-white/[0.1]
                           hover:bg-white/[0.08] disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                >
                  {isPulling ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <CloudDownload className="w-4 h-4" />
                  )}
                  Pull from {storeName}
                </button>
                <button
                  onClick={handlePush}
                  disabled={isPushing || isPulling || hasUnsavedChanges || project?.syncStatus === 'synced'}
                  title={hasUnsavedChanges ? 'Save changes first' : project?.syncStatus === 'synced' ? 'Already synced' : ''}
                  className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium
                           bg-gradient-to-r from-purple-500 to-blue-500 text-white
                           hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                >
                  {isPushing ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <CloudUpload className="w-4 h-4" />
                  )}
                  Push to {storeName}
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="rounded-xl bg-white/[0.02] border border-white/[0.08] p-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <SyncStatusBadge status={project?.syncStatus || 'never_synced'} />
              <div className="flex items-center gap-2 text-xs text-neutral-500">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>Connect to {project?.storeType === 'ios' ? 'App Store Connect' : 'Google Play'} in project settings</span>
              </div>
            </div>
          </div>
        )}
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
        {/* Locale Sidebar */}
        <div className="lg:col-span-1">
          <div className="rounded-2xl bg-white/[0.02] border border-white/[0.08] overflow-hidden sticky top-6">
            {/* Header with count */}
            <div className="px-4 py-3 border-b border-white/[0.08] flex items-center justify-between">
              <span className="text-sm font-medium text-white">Languages</span>
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 rounded-full bg-white/[0.08] text-xs text-neutral-400">
                  {project?.enabledLocales.length || 0}
                </span>
                {(project?.enabledLocales.length || 0) > 1 && (
                  <button
                    onClick={() => {
                      setIsBulkSelectMode(prev => !prev)
                      setSelectedLocalesToDelete(new Set())
                    }}
                    className={`text-xs px-2 py-0.5 rounded-full transition-colors ${
                      isBulkSelectMode
                        ? 'bg-purple-500/20 text-purple-400 border border-purple-500/30'
                        : 'text-neutral-500 hover:text-neutral-300'
                    }`}
                  >
                    {isBulkSelectMode ? 'Cancel' : 'Select'}
                  </button>
                )}
              </div>
            </div>
            {/* Add Language / Bulk Delete Button */}
            <div className="p-3 border-b border-white/[0.08]">
              {isBulkSelectMode && selectedLocalesToDelete.size > 0 ? (
                <button
                  onClick={() => setShowBulkDeleteConfirm(true)}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl
                           bg-red-500/10 border border-red-500/20 text-red-400 text-sm font-medium
                           hover:bg-red-500/20 transition-all"
                >
                  <Trash2 className="w-4 h-4" />
                  Delete {selectedLocalesToDelete.size} Language{selectedLocalesToDelete.size > 1 ? 's' : ''}
                </button>
              ) : (
                <button
                  onClick={() => setShowAddLocale(true)}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl
                           bg-white/[0.05] border border-white/[0.08] text-white text-sm font-medium
                           hover:bg-white/[0.08] hover:border-white/[0.15] transition-all"
                >
                  <Plus className="w-4 h-4" />
                  Add Language
                </button>
              )}
            </div>

            {/* Locale List */}
            <div className="max-h-[calc(100vh-350px)] min-h-[400px] overflow-y-auto scrollbar-dark">
              {project?.enabledLocales
                .slice()
                .sort((a, b) => {
                  // Primary locale first, then alphabetically by name
                  if (a === project.primaryLocale) return -1
                  if (b === project.primaryLocale) return 1
                  return getLocaleName(a).localeCompare(getLocaleName(b))
                })
                .map(locale => {
                const isPrimary = locale === project.primaryLocale
                const isSelected = locale === selectedLocale
                const isCurrentlyTranslating = translatingLocales.has(locale)
                const wasJustTranslated = justTranslatedLocales.has(locale)
                const wasSkipped = skippedLocales.has(locale)
                const syncStatus = getLocaleSyncStatus(locale)
                const fieldsNeedingSync = getFieldsNeedingSync(locale)

                const isChecked = selectedLocalesToDelete.has(locale)

                return (
                  <div
                    key={locale}
                    onClick={() => {
                      if (isBulkSelectMode && !isPrimary) {
                        setSelectedLocalesToDelete(prev => {
                          const next = new Set(prev)
                          if (next.has(locale)) next.delete(locale)
                          else next.add(locale)
                          return next
                        })
                      } else {
                        setSelectedLocale(locale)
                      }
                    }}
                    className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-all border-l-2 cursor-pointer ${
                      isBulkSelectMode && isChecked
                        ? 'bg-red-500/10 border-l-red-500'
                        : isSelected && !isBulkSelectMode
                        ? 'bg-purple-500/10 border-l-purple-500'
                        : isCurrentlyTranslating
                        ? 'bg-blue-500/10 border-l-blue-500 animate-pulse'
                        : wasJustTranslated
                        ? 'bg-green-500/10 border-l-green-500'
                        : wasSkipped
                        ? 'bg-neutral-500/5 border-l-neutral-500'
                        : 'border-l-transparent hover:bg-white/[0.03]'
                    }`}
                  >
                    <span className="text-xl relative">
                      {getLocaleFlag(locale)}
                      {isCurrentlyTranslating && (
                        <span className="absolute -top-1 -right-1 w-3 h-3">
                          <Loader2 className="w-3 h-3 text-blue-400 animate-spin" />
                        </span>
                      )}
                      {wasJustTranslated && (
                        <span className="absolute -top-1 -right-1 w-3 h-3 bg-green-500 rounded-full flex items-center justify-center">
                          <Check className="w-2 h-2 text-white" />
                        </span>
                      )}
                      {wasSkipped && (
                        <span className="absolute -top-1 -right-1 w-3 h-3 bg-neutral-600 rounded-full flex items-center justify-center">
                          <span className="text-[8px] text-white">✓</span>
                        </span>
                      )}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`text-sm font-medium truncate ${
                          isSelected ? 'text-white'
                          : isCurrentlyTranslating ? 'text-blue-300'
                          : wasJustTranslated ? 'text-green-300'
                          : 'text-neutral-300'
                        }`}>
                          {getLocaleName(locale)}
                        </span>
                        {isPrimary && <Star className="w-3 h-3 text-amber-400" />}
                        {isCurrentlyTranslating && (
                          <span className="text-[10px] text-blue-400 font-medium">Translating...</span>
                        )}
                        {wasJustTranslated && (
                          <span className="text-[10px] text-green-400 font-medium">Done</span>
                        )}
                        {wasSkipped && (
                          <span className="text-[10px] text-neutral-500 font-medium">Up-to-date</span>
                        )}
                      </div>
                      {/* Sync status indicator */}
                      {!isPrimary && !isCurrentlyTranslating && !wasJustTranslated && !wasSkipped && syncStatus === 'needs_translation' && (
                        <div className="mt-1">
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-neutral-500/20 text-neutral-400 text-[10px] font-medium">
                            <Globe className="w-2.5 h-2.5" />
                            Untranslated
                          </span>
                        </div>
                      )}
                      {!isPrimary && !isCurrentlyTranslating && !wasJustTranslated && !wasSkipped && syncStatus === 'needs_sync' && (
                        <div className="mt-1">
                          <span
                            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-400 text-[10px] font-medium"
                            title={`Fields changed: ${fieldsNeedingSync.join(', ')}`}
                          >
                            <RefreshCw className="w-2.5 h-2.5" />
                            Needs sync
                          </span>
                        </div>
                      )}
                      {!isPrimary && !isCurrentlyTranslating && !wasJustTranslated && !wasSkipped && syncStatus === 'unknown' && (
                        <div className="mt-1">
                          <span
                            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-blue-500/20 text-blue-400 text-[10px] font-medium"
                            title="Re-translate to enable sync tracking"
                          >
                            <HelpCircle className="w-2.5 h-2.5" />
                            Sync unknown
                          </span>
                        </div>
                      )}
                      {/* Translation progress indicator - only show during active translation */}
                      {isCurrentlyTranslating && (
                        <div className="mt-1.5">
                          <div className="flex-1 h-1 bg-white/[0.1] rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full bg-gradient-to-r from-purple-500 to-pink-500 animate-pulse"
                              style={{ width: '60%' }}
                            />
                          </div>
                        </div>
                      )}
                    </div>
                    {!isPrimary && !isCurrentlyTranslating && (
                      isBulkSelectMode ? (
                        <div
                          onClick={(e) => e.stopPropagation()}
                          className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 transition-colors ${
                            isChecked
                              ? 'bg-red-500 border-red-500'
                              : 'border-white/20 bg-white/[0.05]'
                          }`}
                        >
                          {isChecked && <Check className="w-2.5 h-2.5 text-white" />}
                        </div>
                      ) : (
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            handleRemoveLocale(locale)
                          }}
                          className="p-1 rounded hover:bg-red-500/20 text-neutral-500 hover:text-red-400 transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        {/* Main Editor */}
        <div className="lg:col-span-3">
          <div className="rounded-2xl bg-white/[0.02] border border-white/[0.08] p-6">
            {/* Locale Header */}
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

              {isPrimaryLocale ? (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setShowTranslationHelp(true)}
                    className="p-2 rounded-xl text-neutral-400 hover:text-white hover:bg-white/[0.05] transition-colors"
                    title="How translation works"
                  >
                    <HelpCircle className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setShowTranslateModal(true)}
                    disabled={isTranslatingAll || (project?.enabledLocales.length || 0) <= 1}
                    className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium
                             bg-gradient-to-r from-purple-500 to-pink-500 text-white
                             hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                    title={(project?.enabledLocales.length || 0) <= 1 ? 'Add more languages first' : ''}
                  >
                    {isTranslatingAll ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        {translateAllProgress && (
                          <span>{translateAllProgress.current}/{translateAllProgress.total}</span>
                        )}
                      </>
                    ) : (
                      <>
                        <Languages className="w-4 h-4" />
                        Translate
                      </>
                    )}
                  </button>
                </div>
              ) : (
                <button
                  onClick={handleTranslateAll}
                  disabled={isTranslating}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium
                           bg-gradient-to-r from-blue-500 to-cyan-500 text-white
                           hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                >
                  {isTranslating ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Languages className="w-4 h-4" />
                  )}
                  Auto-translate from {getLocaleName(project?.primaryLocale || 'en-US')}
                </button>
              )}
            </div>

            {/* Compliance Checker */}
            <ComplianceChecker
              metadata={currentMetadata}
              projectId={projectId}
              locale={selectedLocale}
              storeType={project?.storeType || 'ios'}
              onFix={(field, value) => {
                updateField(field as keyof LocalizedMetadata, value)
              }}
              className="mb-6"
            />

            {/* Metadata Fields */}
            <div className="space-y-6">
              {(project?.storeType === 'android' ? ANDROID_METADATA_FIELDS : IOS_METADATA_FIELDS).map(({ key, label, placeholder, multiline, maxLength, helperText }) => {
                const value = (currentMetadata as unknown as Record<string, string | null>)[key] || ''
                const primaryValue = primaryMetadata && !isPrimaryLocale
                  ? (primaryMetadata as unknown as Record<string, string | null>)[key] || ''
                  : null
                const showAiPrompt = aiPrompt.show && aiPrompt.field === key
                const charCount = typeof value === 'string' ? value.length : 0

                return (
                  <div key={key} className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-sm font-medium text-neutral-300">{label}</label>
                      <div className="flex items-center gap-2">
                        <span className={`text-xs ${charCount > maxLength ? 'text-red-400' : 'text-neutral-500'}`}>
                          {charCount}/{maxLength}
                        </span>
                        <button
                          onClick={() => setAiPrompt({ field: key, show: !showAiPrompt })}
                          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${
                            showAiPrompt
                              ? 'bg-purple-500/20 text-purple-400 border border-purple-500/30'
                              : 'bg-white/[0.03] text-neutral-400 hover:text-white hover:bg-white/[0.05]'
                          }`}
                        >
                          <Wand2 className="w-3 h-3" />
                          AI Assist
                        </button>
                      </div>
                    </div>

                    {/* Reference text from primary locale */}
                    {primaryValue && (
                      <div className="p-3 rounded-lg bg-white/[0.02] border border-white/[0.05]">
                        <p className="text-[10px] text-neutral-500 uppercase tracking-wider mb-1">
                          {getLocaleName(project?.primaryLocale || 'en-US')} (reference)
                        </p>
                        <p className="text-xs text-neutral-400 whitespace-pre-wrap line-clamp-3">{primaryValue}</p>
                      </div>
                    )}

                    {/* AI Prompt Input */}
                    {showAiPrompt && (
                      <div className="p-3 rounded-xl bg-purple-500/5 border border-purple-500/20 space-y-3">
                        <div className="flex items-start gap-2">
                          <Sparkles className="w-4 h-4 text-purple-400 mt-0.5" />
                          <div className="flex-1">
                            <p className="text-xs text-purple-300 mb-2">
                              Describe how you want to modify this field:
                            </p>
                            <input
                              type="text"
                              value={customPrompt}
                              onChange={(e) => setCustomPrompt(e.target.value)}
                              placeholder="e.g., Make it more professional, Add emojis, Shorten it..."
                              className="w-full px-3 py-2 rounded-lg bg-white/[0.05] border border-white/[0.1]
                                       text-sm text-white placeholder:text-neutral-500
                                       focus:outline-none focus:border-purple-500/50"
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' && customPrompt.trim()) {
                                  handleEnhanceField(key)
                                }
                              }}
                            />
                          </div>
                        </div>
                        <div className="flex justify-end gap-2">
                          <button
                            onClick={() => {
                              setAiPrompt({ field: '', show: false })
                              setCustomPrompt('')
                            }}
                            className="px-3 py-1.5 rounded-lg text-xs text-neutral-400 hover:text-white transition-colors"
                          >
                            Cancel
                          </button>
                          <button
                            onClick={() => handleEnhanceField(key)}
                            disabled={!customPrompt.trim() || isEnhancing}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium
                                     bg-purple-500 text-white hover:bg-purple-600
                                     disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                          >
                            {isEnhancing ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              <Sparkles className="w-3 h-3" />
                            )}
                            Apply
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Input Field */}
                    <DecodingField
                      value={value}
                      decodingValue={decodingFields[key]?.value}
                      locale={decodingFields[key]?.locale || selectedLocale}
                      isDecoding={!!decodingFields[key]}
                      placeholder={placeholder}
                      multiline={multiline}
                      maxLength={maxLength}
                      onChange={(v) => updateField(key as keyof LocalizedMetadata, v || null)}
                      className={`w-full px-4 py-3 rounded-xl bg-white/[0.03] border
                               ${(key === 'name' || key === 'subtitle') && project?.storeType === 'ios' && value && hasInvalidAppStoreCharacters(value)
                                 ? 'border-amber-500/50'
                                 : 'border-white/[0.08]'}
                               text-white placeholder:text-neutral-600 focus:outline-none focus:border-purple-500/50
                               hover:border-white/[0.15] transition-colors text-sm
                               ${multiline ? 'resize-y min-h-[300px] scrollbar-dark' : ''}
                               ${justTranslatedFields.has(key) ? 'ai-glow-fade-out' : ''}`}
                      isScrambling={isTranslating && !isPrimaryLocale}
                    />

                    {/* Emoji Warning for name/subtitle on iOS */}
                    {(key === 'name' || key === 'subtitle') && project?.storeType === 'ios' && value && hasInvalidAppStoreCharacters(value) && (
                      <div className="flex items-center justify-between p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20">
                        <div className="flex items-center gap-2">
                          <AlertCircle className="w-4 h-4 text-amber-400 flex-shrink-0" />
                          <p className="text-xs text-amber-300">
                            App Store doesn&apos;t allow emojis in {key === 'name' ? 'app name' : 'subtitle'}
                          </p>
                        </div>
                        <button
                          onClick={() => {
                            const cleanedValue = stripEmojis(value)
                            updateField(key as keyof LocalizedMetadata, cleanedValue || null)
                          }}
                          className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium
                                   bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 transition-colors"
                        >
                          <Wand2 className="w-3 h-3" />
                          Fix
                        </button>
                      </div>
                    )}

                    {helperText && (
                      <p className="text-[11px] text-neutral-500">{helperText}</p>
                    )}
                  </div>
                )
              })}

              {/* URLs Section - iOS only (Play Store manages URLs in Play Console directly) */}
              {project?.storeType === 'ios' && (
              <div className="pt-6 border-t border-white/[0.08]">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-medium text-neutral-300">URLs</h3>
                  {!isPrimaryLocale && primaryMetadata?.supportUrl && (
                    <span className="text-[11px] text-neutral-500">
                      Inherited from {getLocaleName(project?.primaryLocale || 'en-US')}
                    </span>
                  )}
                </div>
                {isPrimaryLocale ? (
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-neutral-300">
                        Support URL <span className="text-red-400">*</span>
                      </label>
                      <input
                        type="url"
                        value={currentMetadata.supportUrl || ''}
                        onChange={(e) => updateField('supportUrl', e.target.value || null)}
                        placeholder="https://example.com/support"
                        disabled={!selectedLocale}
                        className="w-full px-4 py-3 rounded-xl bg-white/[0.03] border border-white/[0.08]
                                 text-white placeholder:text-neutral-600 focus:outline-none focus:border-purple-500/50
                                 hover:border-white/[0.15] transition-colors text-sm
                                 disabled:opacity-50 disabled:cursor-not-allowed"
                      />
                      <p className="text-[11px] text-neutral-500">Required for App Store submission. Used for all languages.</p>
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-neutral-300">Marketing URL</label>
                      <input
                        type="url"
                        value={currentMetadata.marketingUrl || ''}
                        onChange={(e) => updateField('marketingUrl', e.target.value || null)}
                        placeholder="https://example.com"
                        disabled={!selectedLocale}
                        className="w-full px-4 py-3 rounded-xl bg-white/[0.03] border border-white/[0.08]
                                 text-white placeholder:text-neutral-600 focus:outline-none focus:border-purple-500/50
                                 hover:border-white/[0.15] transition-colors text-sm
                                 disabled:opacity-50 disabled:cursor-not-allowed"
                      />
                      <p className="text-[11px] text-neutral-500">Optional landing page. Used for all languages.</p>
                    </div>
                  </div>
                ) : (
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-neutral-300">Support URL</label>
                      <div className="px-4 py-3 rounded-xl bg-white/[0.02] border border-white/[0.05] text-sm text-neutral-400">
                        {primaryMetadata?.supportUrl || <span className="text-neutral-600">Not set in primary language</span>}
                      </div>
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-neutral-300">Marketing URL</label>
                      <div className="px-4 py-3 rounded-xl bg-white/[0.02] border border-white/[0.05] text-sm text-neutral-400">
                        {primaryMetadata?.marketingUrl || <span className="text-neutral-600">Not set</span>}
                      </div>
                    </div>
                  </div>
                )}
              </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Add Locale Modal */}
      {showAddLocale && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={() => {
            setShowAddLocale(false)
            setSelectedLocalesToAdd([])
            setLocaleSearch('')
          }} />
          <div className="relative w-full max-w-lg mx-4 rounded-2xl bg-neutral-900 border border-white/[0.1] shadow-2xl max-h-[85vh] flex flex-col">
            <div className="p-4 border-b border-white/[0.08] flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-white">Add Languages</h3>
                <p className="text-xs text-neutral-500 mt-0.5">Select one or more languages to add</p>
              </div>
              <button onClick={() => {
                setShowAddLocale(false)
                setSelectedLocalesToAdd([])
                setLocaleSearch('')
              }} className="p-1 rounded-lg hover:bg-white/[0.05]">
                <X className="w-5 h-5 text-neutral-400" />
              </button>
            </div>

            {/* Quick Select Groups */}
            <div className="p-4 border-b border-white/[0.08] space-y-3">
              <p className="text-xs font-medium text-neutral-400">Quick Select</p>
              <div className="flex flex-wrap gap-2">
                {[
                  { label: 'Top Markets', locales: ['en-US', 'en-GB', 'de-DE', 'fr-FR', 'ja', 'zh-Hans', 'ko', 'es-ES', 'pt-BR'] },
                  { label: 'European', locales: ['de-DE', 'fr-FR', 'es-ES', 'it', 'nl-NL', 'pl', 'pt-PT', 'sv', 'da', 'fi', 'no'] },
                  { label: 'Asian', locales: ['ja', 'ko', 'zh-Hans', 'zh-Hant', 'th', 'vi', 'id', 'ms'] },
                  { label: 'South Asian', locales: ['hi', 'bn-BD', 'gu-IN', 'kn-IN', 'ml-IN', 'mr-IN', 'or-IN', 'pa-IN', 'ta-IN', 'te-IN', 'ur-PK'] },
                  { label: 'Americas', locales: ['en-US', 'en-CA', 'fr-CA', 'es-MX', 'pt-BR'] },
                ].map(group => {
                  const availableInGroup = group.locales.filter(l =>
                    !project?.enabledLocales.includes(l) && APPSTORE_LOCALES.includes(l as typeof APPSTORE_LOCALES[number])
                  )
                  if (availableInGroup.length === 0) return null
                  const allSelected = availableInGroup.every(l => selectedLocalesToAdd.includes(l))
                  return (
                    <button
                      key={group.label}
                      onClick={() => {
                        if (allSelected) {
                          setSelectedLocalesToAdd(prev => prev.filter(l => !availableInGroup.includes(l)))
                        } else {
                          setSelectedLocalesToAdd(prev => [...new Set([...prev, ...availableInGroup])])
                        }
                      }}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                        allSelected
                          ? 'bg-purple-500/20 text-purple-400 border border-purple-500/30'
                          : 'bg-white/[0.03] text-neutral-400 border border-white/[0.08] hover:bg-white/[0.05] hover:text-white'
                      }`}
                    >
                      {group.label} ({availableInGroup.length})
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="p-4 flex-1 overflow-hidden flex flex-col">
              {/* Search */}
              <div className="relative mb-3">
                <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-500" />
                <input
                  type="text"
                  value={localeSearch}
                  onChange={(e) => setLocaleSearch(e.target.value)}
                  placeholder="Search languages..."
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-white/[0.03] border border-white/[0.08]
                           text-sm text-white placeholder:text-neutral-500 focus:outline-none focus:border-purple-500/50"
                  autoFocus
                />
              </div>

              {/* Select All */}
              {availableLocales.length > 0 && (
                <button
                  onClick={() => {
                    const allAvailable = availableLocales
                    const allSelected = allAvailable.every(l => selectedLocalesToAdd.includes(l))
                    if (allSelected) {
                      setSelectedLocalesToAdd([])
                    } else {
                      setSelectedLocalesToAdd(allAvailable)
                    }
                  }}
                  className="flex items-center gap-2 px-3 py-2 mb-2 rounded-lg hover:bg-white/[0.03] transition-colors"
                >
                  <div className={`w-4 h-4 rounded border flex items-center justify-center transition-all ${
                    availableLocales.every(l => selectedLocalesToAdd.includes(l))
                      ? 'bg-purple-500 border-purple-500'
                      : selectedLocalesToAdd.some(l => (availableLocales as string[]).includes(l))
                        ? 'bg-purple-500/50 border-purple-500'
                        : 'border-neutral-600'
                  }`}>
                    {(availableLocales.every(l => selectedLocalesToAdd.includes(l)) ||
                      selectedLocalesToAdd.some(l => (availableLocales as string[]).includes(l))) && (
                      <Check className="w-3 h-3 text-white" />
                    )}
                  </div>
                  <span className="text-sm text-neutral-300">
                    Select all ({availableLocales.length} available)
                  </span>
                </button>
              )}

              {/* Language List */}
              <div className="flex-1 overflow-y-auto scrollbar-dark space-y-1">
                {availableLocales.length === 0 ? (
                  <p className="text-center text-neutral-500 py-8 text-sm">
                    {localeSearch ? 'No languages found' : 'All languages already added'}
                  </p>
                ) : (
                  availableLocales.map(locale => {
                    const isSelected = selectedLocalesToAdd.includes(locale)
                    return (
                      <button
                        key={locale}
                        onClick={() => {
                          setSelectedLocalesToAdd(prev =>
                            isSelected ? prev.filter(l => l !== locale) : [...prev, locale]
                          )
                        }}
                        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-colors ${
                          isSelected
                            ? 'bg-purple-500/10 border border-purple-500/30'
                            : 'hover:bg-white/[0.05] border border-transparent'
                        }`}
                      >
                        <div className={`w-4 h-4 rounded border flex items-center justify-center transition-all ${
                          isSelected ? 'bg-purple-500 border-purple-500' : 'border-neutral-600'
                        }`}>
                          {isSelected && <Check className="w-3 h-3 text-white" />}
                        </div>
                        <span className="text-xl">{getLocaleFlag(locale)}</span>
                        <div className="flex-1">
                          <p className="text-sm font-medium text-white">{getLocaleName(locale)}</p>
                          <p className="text-xs text-neutral-500">{locale}</p>
                        </div>
                      </button>
                    )
                  })
                )}
              </div>
            </div>

            {/* Footer with Add Button */}
            <div className="p-4 border-t border-white/[0.08] flex items-center justify-between">
              <span className="text-sm text-neutral-400">
                {selectedLocalesToAdd.length} selected
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    setShowAddLocale(false)
                    setSelectedLocalesToAdd([])
                    setLocaleSearch('')
                  }}
                  className="px-4 py-2 rounded-xl text-sm font-medium text-neutral-400 hover:text-white hover:bg-white/[0.05] transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleAddMultipleLocales}
                  disabled={selectedLocalesToAdd.length === 0}
                  className="px-4 py-2 rounded-xl text-sm font-medium bg-purple-500 text-white hover:bg-purple-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Add {selectedLocalesToAdd.length > 0 ? `${selectedLocalesToAdd.length} Language${selectedLocalesToAdd.length > 1 ? 's' : ''}` : 'Languages'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete Language Confirmation Dialog */}
      {showDeleteConfirm && localeToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={() => {
            setShowDeleteConfirm(false)
            setLocaleToDelete(null)
          }} />
          <div className="relative w-full max-w-md mx-4 rounded-2xl bg-neutral-900 border border-white/[0.1] shadow-2xl">
            <div className="p-4 border-b border-white/[0.08] flex items-center gap-3">
              <div className="p-2 rounded-xl bg-red-500/10">
                <AlertTriangle className="w-5 h-5 text-red-400" />
              </div>
              <h3 className="text-lg font-semibold text-white">Remove Language</h3>
            </div>
            <div className="p-6">
              <div className="flex items-center gap-3 mb-4">
                <span className="text-3xl">{getLocaleFlag(localeToDelete)}</span>
                <div>
                  <p className="text-white font-medium">{getLocaleName(localeToDelete)}</p>
                  <p className="text-sm text-neutral-500">{localeToDelete}</p>
                </div>
              </div>
              <p className="text-neutral-400 text-sm mb-2">
                This will permanently remove this language and all its metadata:
              </p>
              <ul className="text-sm text-neutral-500 space-y-1 mb-4 ml-4">
                {metadata[localeToDelete]?.name && (
                  <li className="flex items-center gap-2">
                    <span className="w-1 h-1 rounded-full bg-neutral-600" />
                    App Name: <span className="text-neutral-400 truncate max-w-[200px]">{metadata[localeToDelete].name}</span>
                  </li>
                )}
                {metadata[localeToDelete]?.subtitle && (
                  <li className="flex items-center gap-2">
                    <span className="w-1 h-1 rounded-full bg-neutral-600" />
                    Subtitle: <span className="text-neutral-400 truncate max-w-[200px]">{metadata[localeToDelete].subtitle}</span>
                  </li>
                )}
                {metadata[localeToDelete]?.description && (
                  <li className="flex items-center gap-2">
                    <span className="w-1 h-1 rounded-full bg-neutral-600" />
                    Description: <span className="text-neutral-400">{metadata[localeToDelete].description.length} characters</span>
                  </li>
                )}
                {metadata[localeToDelete]?.keywords && (
                  <li className="flex items-center gap-2">
                    <span className="w-1 h-1 rounded-full bg-neutral-600" />
                    Keywords: <span className="text-neutral-400">{metadata[localeToDelete].keywords.split(',').length} keywords</span>
                  </li>
                )}
              </ul>
              <p className="text-red-400/80 text-xs">
                This action cannot be undone.
              </p>
            </div>
            <div className="p-4 border-t border-white/[0.08] flex justify-end gap-3">
              <button
                onClick={() => {
                  setShowDeleteConfirm(false)
                  setLocaleToDelete(null)
                }}
                className="px-4 py-2 rounded-xl text-sm font-medium text-neutral-400 hover:text-white hover:bg-white/[0.05] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirmRemoveLocale}
                className="px-4 py-2 rounded-xl text-sm font-medium bg-red-500 text-white hover:bg-red-600 transition-colors"
              >
                Remove Language
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Delete Confirmation Dialog */}
      {showBulkDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={() => setShowBulkDeleteConfirm(false)} />
          <div className="relative w-full max-w-md mx-4 rounded-2xl bg-neutral-900 border border-white/[0.1] shadow-2xl">
            <div className="p-4 border-b border-white/[0.08] flex items-center gap-3">
              <div className="p-2 rounded-xl bg-red-500/10">
                <AlertTriangle className="w-5 h-5 text-red-400" />
              </div>
              <h3 className="text-lg font-semibold text-white">Remove {selectedLocalesToDelete.size} Language{selectedLocalesToDelete.size > 1 ? 's' : ''}</h3>
            </div>
            <div className="p-6">
              <div className="flex flex-wrap gap-2 mb-4">
                {Array.from(selectedLocalesToDelete).map(locale => (
                  <div key={locale} className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/[0.05] border border-white/[0.08]">
                    <span className="text-base">{getLocaleFlag(locale)}</span>
                    <span className="text-sm text-neutral-300">{getLocaleName(locale)}</span>
                  </div>
                ))}
              </div>
              <p className="text-sm text-neutral-400 mb-2">
                All metadata for these languages will be removed from this project.
              </p>
              <p className="text-red-400/80 text-xs">This action cannot be undone.</p>
            </div>
            <div className="p-4 border-t border-white/[0.08] flex justify-end gap-3">
              <button
                onClick={() => setShowBulkDeleteConfirm(false)}
                className="px-4 py-2 rounded-xl text-sm font-medium text-neutral-400 hover:text-white hover:bg-white/[0.05] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirmBulkDeleteLocales}
                className="px-4 py-2 rounded-xl text-sm font-medium bg-red-500 text-white hover:bg-red-600 transition-colors"
              >
                Remove {selectedLocalesToDelete.size} Language{selectedLocalesToDelete.size > 1 ? 's' : ''}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Translate to All Confirmation Dialog */}
      {showTranslateConfirm && translationPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={() => {
            setShowTranslateConfirm(false)
            setTranslationPreview(null)
          }} />
          <div className="relative w-full max-w-2xl mx-4 rounded-2xl bg-neutral-900 border border-white/[0.1] shadow-2xl max-h-[80vh] flex flex-col">
            <div className="p-4 border-b border-white/[0.08] flex items-center gap-3">
              <div className="p-2 rounded-xl bg-purple-500/10">
                <Languages className="w-5 h-5 text-purple-400" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-white">Translate to All Languages</h3>
                <p className="text-sm text-neutral-500">Review what will be translated</p>
              </div>
            </div>

            <div className="p-6 overflow-y-auto scrollbar-dark flex-1">
              {/* Force Mode Indicator */}
              {forceReTranslate && (
                <div className="mb-4 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center gap-2">
                  <RefreshCw className="w-4 h-4 text-amber-400" />
                  <span className="text-sm text-amber-300">Force mode: All fields will be re-translated</span>
                  <button
                    onClick={() => {
                      setForceReTranslate(false)
                      setShowTranslateConfirm(false)
                      setTimeout(() => handleShowTranslatePreview(), 100)
                    }}
                    className="ml-auto text-xs text-amber-400 hover:text-amber-300 underline"
                  >
                    Cancel force mode
                  </button>
                </div>
              )}

              {/* Summary Stats */}
              <div className="grid grid-cols-3 gap-4 mb-6">
                <div className="p-4 rounded-xl bg-purple-500/10 border border-purple-500/20">
                  <p className="text-2xl font-bold text-purple-400">{translationPreview.totalLocales}</p>
                  <p className="text-xs text-neutral-400">Languages to update</p>
                </div>
                <div className="p-4 rounded-xl bg-blue-500/10 border border-blue-500/20">
                  <p className="text-2xl font-bold text-blue-400">{translationPreview.totalFields}</p>
                  <p className="text-xs text-neutral-400">Fields to translate</p>
                </div>
                <div className="p-4 rounded-xl bg-neutral-500/10 border border-neutral-500/20">
                  <p className="text-2xl font-bold text-neutral-400">{translationPreview.skippedLocales}</p>
                  <p className="text-xs text-neutral-400">Already up-to-date</p>
                </div>
              </div>

              {/* Usage Warning */}
              {translationPreview.usage && translationPreview.totalLocales > 0 && (
                <div className={`p-4 rounded-xl mb-6 ${
                  translationPreview.usage.willExceedLimit
                    ? 'bg-amber-500/10 border border-amber-500/30'
                    : translationPreview.usage.limit !== -1 && translationPreview.usage.remaining <= translationPreview.totalLocales * 2
                    ? 'bg-amber-500/5 border border-amber-500/20'
                    : 'bg-white/[0.02] border border-white/[0.05]'
                }`}>
                  <div className="flex items-start gap-3">
                    {translationPreview.usage.willExceedLimit ? (
                      <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
                    ) : (
                      <Zap className="w-5 h-5 text-purple-400 flex-shrink-0 mt-0.5" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-medium ${translationPreview.usage.willExceedLimit ? 'text-amber-300' : 'text-white'}`}>
                        {translationPreview.usage.willExceedLimit
                          ? 'Not enough translation credits'
                          : 'Translation credits'}
                      </p>
                      <div className="mt-2 space-y-1.5">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-neutral-400">Current usage</span>
                          <span className="text-neutral-300">
                            {translationPreview.usage.currentUsed} / {translationPreview.usage.limit === -1 ? '∞' : translationPreview.usage.limit}
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-neutral-400">This operation</span>
                          <span className="text-neutral-300">+{translationPreview.totalLocales} credits</span>
                        </div>
                        {translationPreview.usage.willExceedLimit && (
                          <p className="text-xs text-amber-400 mt-2">
                            Choose fewer languages or upgrade before starting this translation.
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {translationPreview.totalLocales === 0 ? (
                <div className="text-center py-8">
                  <CheckCircle2 className="w-12 h-12 text-green-400 mx-auto mb-3" />
                  <p className="text-white font-medium">All languages are up-to-date!</p>
                  <p className="text-sm text-neutral-500 mt-1">No translations needed.</p>
                  <button
                    onClick={() => {
                      setForceReTranslate(true)
                      setShowTranslateConfirm(false)
                      // Re-open with force mode after a brief delay
                      setTimeout(() => handleShowTranslatePreview(), 100)
                    }}
                    className="mt-4 px-4 py-2 rounded-lg bg-purple-500/20 border border-purple-500/30 text-purple-300 text-sm font-medium hover:bg-purple-500/30 transition-colors"
                  >
                    Force Re-translate All
                  </button>
                </div>
              ) : (
                <>
                  {/* Breakdown by language */}
                  <p className="text-sm font-medium text-neutral-400 mb-3">Fields to be overwritten:</p>
                  <div className="space-y-2 max-h-[300px] overflow-y-auto scrollbar-dark">
                    {translationPreview.locales.map(({ locale, fieldsToTranslate, fieldsToSkip }) => (
                      <div
                        key={locale}
                        className="p-3 rounded-xl bg-white/[0.02] border border-white/[0.05] hover:border-white/[0.1] transition-colors"
                      >
                        <div className="flex items-center gap-3 mb-2">
                          <span className="text-xl">{getLocaleFlag(locale)}</span>
                          <div className="flex-1">
                            <p className="text-sm font-medium text-white">{getLocaleName(locale)}</p>
                            <p className="text-xs text-neutral-500">{locale}</p>
                          </div>
                          <span className="px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-400 text-xs">
                            {fieldsToTranslate.length} field{fieldsToTranslate.length !== 1 ? 's' : ''}
                          </span>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {fieldsToTranslate.map(field => (
                            <span
                              key={field}
                              className="px-2 py-0.5 rounded-md bg-purple-500/20 text-purple-300 text-xs"
                            >
                              {FIELD_DISPLAY_NAMES[field] || field}
                            </span>
                          ))}
                          {fieldsToSkip.map(field => (
                            <span
                              key={field}
                              className="px-2 py-0.5 rounded-md bg-neutral-500/20 text-neutral-500 text-xs line-through"
                            >
                              {FIELD_DISPLAY_NAMES[field] || field}
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>

                  <p className="text-amber-400/80 text-xs mt-4 flex items-center gap-2">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    Existing translations for the highlighted fields will be overwritten.
                  </p>
                </>
              )}
            </div>

            <div className="p-4 border-t border-white/[0.08] flex justify-end gap-3">
              <button
                onClick={() => {
                  setShowTranslateConfirm(false)
                  setTranslationPreview(null)
                  setForceReTranslate(false)
                }}
                className="px-4 py-2 rounded-xl text-sm font-medium text-neutral-400 hover:text-white hover:bg-white/[0.05] transition-colors"
              >
                Cancel
              </button>
              {translationPreview.totalLocales > 0 && (
                <button
                  onClick={() => {
                    setShowTranslateConfirm(false)
                    setTranslationPreview(null)
                    handleTranslateToAllLanguages()
                    // Reset force mode after starting translation
                    setTimeout(() => setForceReTranslate(false), 100)
                  }}
                  className="px-4 py-2 rounded-xl text-sm font-medium bg-gradient-to-r from-purple-500 to-pink-500 text-white hover:opacity-90 transition-all"
                >
                  {forceReTranslate ? 'Force ' : ''}Translate {translationPreview.totalFields} Fields
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Translate Language Selection Modal */}
      {showTranslateModal && (() => {
        const availableLocales = (project?.enabledLocales || [])
          .filter(l => l !== project?.primaryLocale)
          .sort((a, b) => getLocaleName(a).localeCompare(getLocaleName(b)))
        const allSelected = availableLocales.length > 0 && availableLocales.every(l => selectedTranslateLocales.includes(l))
        const someSelected = selectedTranslateLocales.length > 0 && !allSelected

        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center">
            <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={() => {
              setShowTranslateModal(false)
              setSelectedTranslateLocales([])
              setForceReTranslate(false)
            }} />
            <div className="relative w-full max-w-lg mx-4 rounded-2xl bg-neutral-900 border border-white/[0.1] shadow-2xl">
              <div className="p-6 border-b border-white/[0.08]">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-semibold text-white">Translate Metadata</h2>
                    <p className="text-sm text-neutral-500 mt-1">
                      From {getLocaleFlag(project?.primaryLocale || 'en-US')} {getLocaleName(project?.primaryLocale || 'en-US')}
                    </p>
                  </div>
                  <button onClick={() => {
                    setShowTranslateModal(false)
                    setSelectedTranslateLocales([])
                    setForceReTranslate(false)
                  }} className="text-neutral-400 hover:text-white">
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>

              <div className="p-6">
                <p className="text-neutral-500 mb-4 text-sm">
                  Select which languages to translate your metadata to. Only changed fields will be updated.
                </p>

                {/* Quick select buttons */}
                <div className="flex items-center gap-2 mb-3">
                  {/* Select All */}
                  <label className="flex items-center gap-3 p-2.5 bg-white/[0.03] rounded-lg cursor-pointer border border-white/[0.08] flex-1">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      ref={(el) => { if (el) el.indeterminate = someSelected }}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedTranslateLocales(availableLocales)
                        } else {
                          setSelectedTranslateLocales([])
                        }
                      }}
                      className="rounded border-white/20 bg-white/[0.03] text-purple-500 focus:ring-purple-500/50"
                    />
                    <span className="text-white text-sm font-medium">Select All ({availableLocales.length})</span>
                  </label>

                  {/* Needs sync quick select */}
                  {(() => {
                    const needsSyncLocales = availableLocales.filter(locale => {
                      const status = getLocaleSyncStatus(locale)
                      return status === 'needs_translation' || status === 'needs_sync' || status === 'unknown'
                    })
                    if (needsSyncLocales.length === 0) return null
                    return (
                      <button
                        type="button"
                        onClick={() => setSelectedTranslateLocales(needsSyncLocales)}
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
                    const fieldsNeedingSync = getFieldsNeedingSync(locale)
                    return (
                      <label
                        key={locale}
                        className="flex items-center gap-3 p-2.5 hover:bg-white/[0.03] rounded-lg cursor-pointer transition-colors"
                      >
                        <input
                          type="checkbox"
                          checked={selectedTranslateLocales.includes(locale)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedTranslateLocales([...selectedTranslateLocales, locale])
                            } else {
                              setSelectedTranslateLocales(selectedTranslateLocales.filter((l) => l !== locale))
                            }
                          }}
                          className="rounded border-white/20 bg-white/[0.03] text-purple-500 focus:ring-purple-500/50"
                        />
                        <span className="text-lg">{getLocaleFlag(locale)}</span>
                        <span className="text-white text-sm flex-1">{getLocaleName(locale)}</span>
                        {syncStatus === 'needs_translation' && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-neutral-500/10 text-neutral-400 border border-neutral-500/20">
                            <Globe className="w-2.5 h-2.5" />
                            Untranslated
                          </span>
                        )}
                        {syncStatus === 'needs_sync' && (
                          <span
                            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20"
                            title={`Fields: ${fieldsNeedingSync.join(', ')}`}
                          >
                            <RefreshCw className="w-2.5 h-2.5" />
                            Needs sync
                          </span>
                        )}
                        {syncStatus === 'unknown' && (
                          <span
                            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-500/10 text-blue-400 border border-blue-500/20"
                            title="Re-translate to enable sync tracking"
                          >
                            <HelpCircle className="w-2.5 h-2.5" />
                            Sync unknown
                          </span>
                        )}
                      </label>
                    )
                  })}
                </div>
              </div>

              <div className="px-6 pb-4">
                <label className="flex items-start gap-3 p-3 rounded-xl bg-white/[0.02] border border-white/[0.06] cursor-pointer hover:bg-white/[0.04] transition-colors">
                  <input
                    type="checkbox"
                    checked={forceReTranslate}
                    onChange={(e) => setForceReTranslate(e.target.checked)}
                    className="mt-0.5 rounded border-white/20 bg-white/[0.03] text-purple-500 focus:ring-purple-500/50"
                  />
                  <div>
                    <span className="text-sm font-medium text-white">Force re-translate all fields</span>
                    <p className="text-xs text-neutral-500 mt-0.5">
                      Re-translate everything, even fields that haven't changed. Useful if you want fresh translations.
                    </p>
                  </div>
                </label>
              </div>

              <div className="p-6 border-t border-white/[0.08] flex justify-end gap-3">
                <button
                  onClick={() => {
                    setShowTranslateModal(false)
                    setSelectedTranslateLocales([])
                    setForceReTranslate(false)
                  }}
                  className="px-4 py-2.5 rounded-xl text-sm font-medium bg-white/[0.05] text-white hover:bg-white/[0.08] transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleShowTranslatePreview}
                  disabled={selectedTranslateLocales.length === 0}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium bg-gradient-to-r from-purple-500 to-pink-500 text-white hover:opacity-90 transition-colors disabled:opacity-50"
                >
                  <Languages className="w-4 h-4" />
                  {forceReTranslate ? 'Force Translate' : 'Continue'} with {selectedTranslateLocales.length} Language{selectedTranslateLocales.length !== 1 ? 's' : ''}
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* How Translation Works Dialog */}
      {showTranslationHelp && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={() => setShowTranslationHelp(false)} />
          <div className="relative w-full max-w-lg rounded-2xl bg-neutral-900 border border-white/[0.1] shadow-2xl">
            {/* Header */}
            <div className="p-5 text-center border-b border-white/[0.06]">
              <div className="inline-flex p-3 rounded-2xl bg-gradient-to-br from-purple-500/20 to-blue-500/20 mb-3">
                <Languages className="w-6 h-6 text-purple-400" />
              </div>
              <h3 className="text-lg font-semibold text-white">Metadata Translation</h3>
              <p className="text-sm text-neutral-500 mt-1">ASO-optimized translations for each market</p>
            </div>

            {/* Content */}
            <div className="p-5 space-y-5">
              {/* Key features */}
              <div className="space-y-3">
                <div className="flex items-start gap-3">
                  <div className="w-7 h-7 rounded-full bg-purple-500/20 flex items-center justify-center flex-shrink-0">
                    <Target className="w-3.5 h-3.5 text-purple-400" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-white">ASO-Optimized Keywords</p>
                    <p className="text-xs text-neutral-400 mt-0.5">Not word-for-word — uses keywords that local users actually search for in each market</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <div className="w-7 h-7 rounded-full bg-blue-500/20 flex items-center justify-center flex-shrink-0">
                    <Zap className="w-3.5 h-3.5 text-blue-400" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-white">Smart Change Tracking</p>
                    <p className="text-xs text-neutral-400 mt-0.5">Only changed fields get re-translated. Edit your title? Only titles update across languages</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <div className="w-7 h-7 rounded-full bg-emerald-500/20 flex items-center justify-center flex-shrink-0">
                    <Globe className="w-3.5 h-3.5 text-emerald-400" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-white">Regional Variants</p>
                    <p className="text-xs text-neutral-400 mt-0.5">English variants (UK, AU, CA) get localized spelling — colour, favourite, centre — not translated</p>
                  </div>
                </div>
              </div>

              {/* Features row */}
              <div className="flex gap-3">
                <div className="flex-1 p-3 rounded-xl bg-white/[0.03] border border-white/[0.06]">
                  <div className="flex items-center gap-2 mb-1">
                    <Gauge className="w-3.5 h-3.5 text-amber-400" />
                    <span className="text-xs font-medium text-white">Batch Processing</span>
                  </div>
                  <p className="text-[11px] text-neutral-500">5 languages translated in parallel</p>
                </div>
                <div className="flex-1 p-3 rounded-xl bg-white/[0.03] border border-white/[0.06]">
                  <div className="flex items-center gap-2 mb-1">
                    <CheckCircle2 className="w-3.5 h-3.5 text-green-400" />
                    <span className="text-xs font-medium text-white">Skip Detection</span>
                  </div>
                  <p className="text-[11px] text-neutral-500">Up-to-date languages skipped</p>
                </div>
              </div>

              {/* AI Warning */}
              <div className="flex items-start gap-3 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20">
                <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-medium text-amber-400">AI-Powered Translation</p>
                  <p className="text-[11px] text-neutral-400 mt-0.5">Review translations before publishing. You can edit any field after translation to fine-tune the results.</p>
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

      {/* Pull Progress Dialog */}
      {showPullDialog && pullProgress && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" />
          <div className="relative w-full max-w-md mx-4 rounded-2xl bg-neutral-900 border border-white/[0.1] shadow-2xl">
            <div className="p-6">
              {/* Header */}
              <div className="flex items-center gap-3 mb-6">
                <div className={`p-3 rounded-xl ${
                  pullProgress.step === 'error' ? 'bg-red-500/10' :
                  pullProgress.step === 'complete' ? 'bg-green-500/10' : 'bg-blue-500/10'
                }`}>
                  {pullProgress.step === 'error' ? (
                    <AlertCircle className="w-6 h-6 text-red-400" />
                  ) : pullProgress.step === 'complete' ? (
                    <Check className="w-6 h-6 text-green-400" />
                  ) : (
                    <CloudDownload className="w-6 h-6 text-blue-400" />
                  )}
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-white">
                    {pullProgress.step === 'error' ? 'Pull Failed' :
                     pullProgress.step === 'complete' ? 'Pull Complete' : `Pulling from ${storeName}`}
                  </h3>
                  <p className="text-sm text-neutral-400">{pullProgress.message}</p>
                </div>
              </div>

              {/* Progress Steps */}
              <div className="space-y-3 mb-6">
                {(['connecting', 'fetching', 'saving', 'complete'] as const).map((step, idx) => {
                  const steps = ['connecting', 'fetching', 'saving', 'complete'] as const
                  const currentStep = pullProgress.step === 'error' ? 'connecting' : pullProgress.step
                  const currentIdx = steps.indexOf(currentStep as typeof steps[number])
                  const isActive = step === pullProgress.step
                  const isComplete = idx < currentIdx || pullProgress.step === 'complete'
                  const isError = pullProgress.step === 'error'
                  const stepLabels = {
                    connecting: `Connecting to ${storeName}`,
                    fetching: 'Fetching localizations',
                    saving: 'Saving to database',
                    complete: 'Complete'
                  }
                  return (
                    <div key={step} className="flex items-center gap-3">
                      <div className={`w-6 h-6 rounded-full flex items-center justify-center ${
                        isComplete ? 'bg-green-500' :
                        isActive ? 'bg-blue-500' : 'bg-white/10'
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

              {/* Error Message */}
              {pullProgress.step === 'error' && pullProgress.error && (
                <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 mb-6">
                  <p className="text-sm text-red-400">{pullProgress.error}</p>
                </div>
              )}

              {/* Success Stats */}
              {pullProgress.step === 'complete' && pullProgress.localesCount && (
                <div className="p-4 rounded-xl bg-green-500/10 border border-green-500/20 mb-6">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-neutral-400">Locales pulled</span>
                    <span className="text-lg font-semibold text-green-400">{pullProgress.localesCount}</span>
                  </div>
                </div>
              )}

              {/* Close Button */}
              {(pullProgress.step === 'complete' || pullProgress.step === 'error') && (
                <button
                  onClick={() => {
                    setShowPullDialog(false)
                    setPullProgress(null)
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

      {/* Push Progress Dialog */}
      {showPushDialog && pushProgress && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" />
          <div className="relative w-full max-w-md mx-4 rounded-2xl bg-neutral-900 border border-white/[0.1] shadow-2xl">
            <div className="p-6">
              {/* Header */}
              <div className="flex items-center gap-3 mb-6">
                <div className={`p-3 rounded-xl ${
                  pushProgress.step === 'error' ? 'bg-red-500/10' :
                  pushProgress.step === 'complete' ? 'bg-green-500/10' : 'bg-purple-500/10'
                }`}>
                  {pushProgress.step === 'error' ? (
                    <AlertCircle className="w-6 h-6 text-red-400" />
                  ) : pushProgress.step === 'complete' ? (
                    <Check className="w-6 h-6 text-green-400" />
                  ) : (
                    <CloudUpload className="w-6 h-6 text-purple-400" />
                  )}
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-white">
                    {pushProgress.step === 'error' ? 'Publish Failed' :
                     pushProgress.step === 'complete' ? 'Publish Complete' : `Publishing to ${storeName}`}
                  </h3>
                  <p className="text-sm text-neutral-400">{pushProgress.message}</p>
                </div>
              </div>

              {/* Progress Steps */}
              <div className="space-y-3 mb-6">
                {(['connecting', 'publishing', 'complete'] as const).map((step, idx) => {
                  const steps = ['connecting', 'publishing', 'complete'] as const
                  const currentStep = pushProgress.step === 'error' ? 'connecting' : pushProgress.step
                  const currentIdx = steps.indexOf(currentStep as typeof steps[number])
                  const isActive = step === pushProgress.step
                  const isComplete = idx < currentIdx || pushProgress.step === 'complete'
                  const isError = pushProgress.step === 'error'
                  const stepLabels = {
                    connecting: `Connecting to ${storeName}`,
                    publishing: `Publishing ${pushProgress.total || 0} locales`,
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

              {/* Progress Bar (during publishing) */}
              {pushProgress.step === 'publishing' && pushProgress.total && pushProgress.total > 0 && (
                <div className="mb-6">
                  {/* Current batch or locale indicator */}
                  {pushProgress.currentBatch && pushProgress.currentBatch.length > 0 ? (
                    <div className="mb-3">
                      <div className="flex items-center gap-1 flex-wrap">
                        {pushProgress.currentBatch.map(locale => (
                          <span
                            key={locale}
                            className="inline-flex items-center gap-1 px-2 py-1 bg-white/10 rounded text-xs"
                          >
                            <span>{getLocaleFlag(locale)}</span>
                            <span className="text-neutral-300">{getLocaleName(locale)}</span>
                          </span>
                        ))}
                      </div>
                      <span className="text-xs text-purple-400 mt-1 block">
                        ⚡ Uploading {pushProgress.currentBatch.length} locales in parallel
                      </span>
                    </div>
                  ) : pushProgress.currentLocale && (
                    <div className="flex items-center gap-2 mb-3">
                      <span className="text-lg">{getLocaleFlag(pushProgress.currentLocale)}</span>
                      <span className="text-sm text-white">{getLocaleName(pushProgress.currentLocale)}</span>
                    </div>
                  )}

                  {/* Progress bar */}
                  <div className="h-2 bg-white/10 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-purple-500 to-pink-500 transition-all duration-300 ease-out"
                      style={{ width: `${((pushProgress.current || 0) / pushProgress.total) * 100}%` }}
                    />
                  </div>

                  {/* Progress text */}
                  <div className="flex items-center justify-between mt-2">
                    <span className="text-xs text-neutral-400">
                      {pushProgress.current || 0} of {pushProgress.total} locales
                    </span>
                    <span className="text-xs text-neutral-400">
                      {Math.round(((pushProgress.current || 0) / pushProgress.total) * 100)}%
                    </span>
                  </div>
                </div>
              )}

              {/* Error Message with Failed Locales Details */}
              {pushProgress.step === 'error' && pushProgress.error && (
                <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 mb-6">
                  <p className="text-sm text-red-400 font-medium mb-3">{pushProgress.error}</p>
                  {/* Show which locales failed */}
                  {pushProgress.results && pushProgress.results.filter(r => !r.success).length > 0 && (
                    <div className="space-y-2 mt-3 pt-3 border-t border-red-500/20">
                      <p className="text-xs text-neutral-400 mb-2">Failed locales:</p>
                      {pushProgress.results.filter(r => !r.success).map(result => (
                        <div key={result.locale} className="flex items-start gap-2 text-xs">
                          <span>{getLocaleFlag(result.locale)}</span>
                          <div>
                            <span className="text-white">{getLocaleName(result.locale)}</span>
                            {result.error && (
                              <p className="text-red-400/80 mt-0.5">{result.error}</p>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Results Summary */}
              {pushProgress.step === 'complete' && pushProgress.results && (
                <div className="space-y-3 mb-6">
                  {/* Stats */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="p-3 rounded-xl bg-green-500/10 border border-green-500/20">
                      <p className="text-2xl font-bold text-green-400">
                        {pushProgress.results.filter(r => r.success).length}
                      </p>
                      <p className="text-xs text-neutral-400">Succeeded</p>
                    </div>
                    <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20">
                      <p className="text-2xl font-bold text-red-400">
                        {pushProgress.results.filter(r => !r.success).length}
                      </p>
                      <p className="text-xs text-neutral-400">Failed</p>
                    </div>
                  </div>

                  {/* Failed locales list */}
                  {pushProgress.results.some(r => !r.success) && (
                    <div className="p-3 rounded-xl bg-white/[0.02] border border-white/[0.08] max-h-32 overflow-y-auto">
                      <p className="text-xs font-medium text-neutral-400 mb-2">Failed locales:</p>
                      <div className="space-y-1">
                        {pushProgress.results.filter(r => !r.success).map(r => (
                          <div key={r.locale} className="flex items-center justify-between text-xs">
                            <span className="text-white">{getLocaleFlag(r.locale)} {getLocaleName(r.locale)}</span>
                            <span className="text-red-400 truncate max-w-[200px]">{r.error || 'Failed'}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Cancel Button (during operation) */}
              {(pushProgress.step === 'connecting' || pushProgress.step === 'publishing') && (
                <button
                  onClick={handleCancelPush}
                  className="w-full py-3 rounded-xl text-sm font-medium bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 transition-colors"
                >
                  Cancel
                </button>
              )}

              {/* Close Button (after completion) */}
              {(pushProgress.step === 'complete' || pushProgress.step === 'error') && (
                <button
                  onClick={() => {
                    setShowPushDialog(false)
                    setPushProgress(null)
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
    </div>
  )
}
