'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Languages,
  Sparkles,
  Loader2,
  Check,
  AlertCircle,
  Star,
  Globe,
  Info,
  Zap,
  Target,
  RefreshCw,
  ChevronRight,
  X,
} from 'lucide-react'
import { LOCALE_NAMES, LOCALE_FLAGS } from '@/lib/constants'

// Sync status types
export type SyncStatus = 'synced' | 'needs_translation' | 'needs_sync' | 'unknown'

export interface LocaleData {
  locale: string
  [key: string]: any
}

interface TranslationPanelProps {
  // Data
  localizations: LocaleData[]
  primaryLocale: string
  enabledLocales: string[]

  // Field configuration
  fields: {
    key: string
    label: string
    maxLength: number
    multiline?: boolean
    helpText?: string
  }[]

  // Current selection
  selectedLocale: string
  onLocaleSelect: (locale: string) => void

  // Current field values
  fieldValues: Record<string, string>
  onFieldChange: (field: string, value: string) => void

  // Actions
  onSave: () => Promise<void>
  onTranslate: (targetLocales: string[], force: boolean) => Promise<void>

  // State
  isSaving: boolean
  isTranslating: boolean
  hasChanges: boolean

  // Optional
  translateProgress?: { current: number; total: number } | null
  error?: string | null
  success?: string | null
  disabled?: boolean
}

// Character set for scrambling based on locale
const getScrambleChars = (locale: string): string => {
  const lang = locale.split('-')[0]
  switch (lang) {
    case 'ja': return 'あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほ'
    case 'zh': return '的一是不了人我在有他这为之大来以个中上们到说国和地也子时道出而要于就下得可你年生'
    case 'ko': return 'ㄱㄴㄷㄹㅁㅂㅅㅇㅈㅊㅋㅌㅍㅎㅏㅓㅗㅜㅡㅣ'
    case 'th': return 'กขคงจฉชซฌญฎฏฐฑฒณดตถทธนบปผฝพฟภมยรลวศษส'
    case 'ar': return 'ابتثجحخدذرزسشصضطظعغفقكلمنهوي'
    case 'he': return 'אבגדהוזחטיכלמנסעפצקרשת'
    case 'ru': case 'uk': case 'bg': return 'абвгдежзийклмнопрстуфхцчшщъыьэюя'
    case 'el': return 'αβγδεζηθικλμνξοπρστυφχψω'
    default: return 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'
  }
}

// Scramble text hook
function useScrambleText(text: string, isScrambling: boolean, locale: string) {
  const [displayText, setDisplayText] = useState(text)
  const chars = useMemo(() => getScrambleChars(locale), [locale])

  useEffect(() => {
    if (!isScrambling) {
      setDisplayText(text)
      return
    }

    const scramble = () => {
      const scrambled = text.split('').map(char => {
        if (char === ' ' || char === '\n') return char
        return chars[Math.floor(Math.random() * chars.length)]
      }).join('')
      setDisplayText(scrambled)
    }

    const interval = setInterval(scramble, 50)
    return () => clearInterval(interval)
  }, [text, isScrambling, chars])

  return displayText
}

// Decoding text animation hook
function useTextDecode(targetText: string, shouldDecode: boolean, locale: string) {
  const [displayText, setDisplayText] = useState('')
  const [decodedCount, setDecodedCount] = useState(0)
  const chars = useMemo(() => getScrambleChars(locale), [locale])

  useEffect(() => {
    if (!shouldDecode || !targetText) {
      setDisplayText(targetText)
      return
    }

    setDecodedCount(0)
    const totalChars = targetText.length
    const duration = 800 // ms
    const interval = duration / totalChars

    const timer = setInterval(() => {
      setDecodedCount(prev => {
        const next = prev + 1
        if (next >= totalChars) {
          clearInterval(timer)
          return totalChars
        }
        return next
      })
    }, Math.max(interval, 20))

    return () => clearInterval(timer)
  }, [targetText, shouldDecode])

  useEffect(() => {
    if (!targetText) {
      setDisplayText('')
      return
    }

    const decoded = targetText.slice(0, decodedCount)
    const scrambled = targetText.slice(decodedCount).split('').map(char => {
      if (char === ' ' || char === '\n') return char
      return chars[Math.floor(Math.random() * chars.length)]
    }).join('')

    setDisplayText(decoded + scrambled)
  }, [decodedCount, targetText, chars])

  return displayText
}

// Locale status badge
function LocaleStatusBadge({ status }: { status: SyncStatus }) {
  switch (status) {
    case 'synced':
      return (
        <span className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-green-500/10 text-green-400 border border-green-500/20">
          <Check className="w-2.5 h-2.5" />
          Synced
        </span>
      )
    case 'needs_translation':
      return (
        <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20">
          Untranslated
        </span>
      )
    case 'needs_sync':
      return (
        <span className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-purple-500/10 text-purple-400 border border-purple-500/20">
          <RefreshCw className="w-2.5 h-2.5" />
          Needs sync
        </span>
      )
    default:
      return null
  }
}

// Bulk translate modal
function BulkTranslateModal({
  availableLocales,
  localizations,
  primaryLocale,
  getLocaleStatus,
  onTranslate,
  onClose,
  isTranslating,
  progress,
}: {
  availableLocales: string[]
  localizations: LocaleData[]
  primaryLocale: string
  getLocaleStatus: (locale: string) => SyncStatus
  onTranslate: (locales: string[], force: boolean) => void
  onClose: () => void
  isTranslating: boolean
  progress: { current: number; total: number } | null
}) {
  const [selectedLocales, setSelectedLocales] = useState<Set<string>>(new Set())
  const [forceReTranslate, setForceReTranslate] = useState(false)
  const [step, setStep] = useState<'select' | 'confirm'>('select')

  const targetLocales = availableLocales.filter(l => l !== primaryLocale)
  const needsSyncLocales = targetLocales.filter(l => {
    const status = getLocaleStatus(l)
    return status === 'needs_translation' || status === 'needs_sync'
  })

  const toggleLocale = (locale: string) => {
    setSelectedLocales(prev => {
      const next = new Set(prev)
      if (next.has(locale)) next.delete(locale)
      else next.add(locale)
      return next
    })
  }

  const selectAll = () => setSelectedLocales(new Set(targetLocales))
  const selectNeedsSync = () => setSelectedLocales(new Set(needsSyncLocales))
  const clearAll = () => setSelectedLocales(new Set())

  const handleTranslate = () => {
    onTranslate(Array.from(selectedLocales), forceReTranslate)
  }

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[10000] p-4 backdrop-blur-sm">
      <div className="bg-[#1a1a1a] rounded-2xl border border-white/[0.08] w-full max-w-lg shadow-2xl">
        {/* Header */}
        <div className="p-4 border-b border-white/[0.08] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-purple-500/20">
              <Sparkles className="w-5 h-5 text-purple-400" />
            </div>
            <div>
              <h3 className="font-semibold text-white">Bulk Translate</h3>
              <p className="text-xs text-neutral-400">
                {step === 'select' ? 'Select languages to translate' : 'Confirm translation'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-neutral-400 hover:text-white hover:bg-white/[0.05]"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {isTranslating ? (
          <div className="p-8 text-center">
            <Loader2 className="w-10 h-10 animate-spin text-purple-400 mx-auto mb-4" />
            <p className="text-white font-medium mb-2">Translating...</p>
            {progress && (
              <>
                <div className="w-full max-w-xs mx-auto h-2 rounded-full bg-white/[0.05] overflow-hidden mb-2">
                  <div
                    className="h-full bg-gradient-to-r from-purple-500 to-pink-500 transition-all duration-300"
                    style={{ width: `${Math.round((progress.current / progress.total) * 100)}%` }}
                  />
                </div>
                <p className="text-sm text-neutral-400">
                  {progress.current} of {progress.total} languages
                </p>
              </>
            )}
          </div>
        ) : step === 'select' ? (
          <>
            {/* Quick actions */}
            <div className="p-3 border-b border-white/[0.06] flex flex-wrap gap-2">
              <button
                onClick={selectAll}
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-white/[0.05] text-neutral-300 hover:bg-white/[0.08]"
              >
                Select All ({targetLocales.length})
              </button>
              {needsSyncLocales.length > 0 && (
                <button
                  onClick={selectNeedsSync}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium bg-amber-500/10 text-amber-400 hover:bg-amber-500/20"
                >
                  Needs Sync ({needsSyncLocales.length})
                </button>
              )}
              {selectedLocales.size > 0 && (
                <button
                  onClick={clearAll}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium text-neutral-400 hover:text-white"
                >
                  Clear
                </button>
              )}
            </div>

            {/* Locale list */}
            <div className="max-h-[300px] overflow-y-auto p-3">
              <div className="space-y-1">
                {targetLocales.map(locale => {
                  const status = getLocaleStatus(locale)
                  return (
                    <label
                      key={locale}
                      className={`flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-all ${
                        selectedLocales.has(locale)
                          ? 'bg-purple-500/10 border border-purple-500/30'
                          : 'hover:bg-white/[0.03] border border-transparent'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={selectedLocales.has(locale)}
                        onChange={() => toggleLocale(locale)}
                        className="w-4 h-4 rounded border-white/[0.2] bg-white/[0.03] text-purple-500"
                      />
                      <span className="text-lg">{LOCALE_FLAGS[locale] || '🌐'}</span>
                      <span className="flex-1 text-sm text-neutral-200">
                        {LOCALE_NAMES[locale] || locale}
                      </span>
                      <LocaleStatusBadge status={status} />
                    </label>
                  )
                })}
              </div>
            </div>

            {/* Force retranslate option */}
            <div className="px-4 py-3 border-t border-white/[0.06]">
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={forceReTranslate}
                  onChange={e => setForceReTranslate(e.target.checked)}
                  className="mt-0.5 w-4 h-4 rounded border-white/[0.2] bg-white/[0.03] text-purple-500"
                />
                <div>
                  <p className="text-sm text-neutral-200">Force re-translate all</p>
                  <p className="text-xs text-neutral-500">
                    Override existing translations, even if already synced
                  </p>
                </div>
              </label>
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-white/[0.08] flex justify-between items-center">
              <button
                onClick={onClose}
                className="px-4 py-2 rounded-lg text-sm text-neutral-400 hover:text-white"
              >
                Cancel
              </button>
              <button
                onClick={() => setStep('confirm')}
                disabled={selectedLocales.size === 0}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium
                         bg-gradient-to-r from-purple-500 to-pink-500 text-white
                         hover:opacity-90 disabled:opacity-50 transition-all"
              >
                Continue with {selectedLocales.size} language{selectedLocales.size !== 1 ? 's' : ''}
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </>
        ) : (
          <>
            {/* Confirmation view */}
            <div className="p-6">
              <div className="text-center mb-6">
                <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-purple-500/10 mb-4">
                  <Languages className="w-8 h-8 text-purple-400" />
                </div>
                <p className="text-white font-medium">
                  Translate to {selectedLocales.size} language{selectedLocales.size !== 1 ? 's' : ''}
                </p>
                <p className="text-sm text-neutral-400 mt-1">
                  From {LOCALE_FLAGS[primaryLocale]} {LOCALE_NAMES[primaryLocale]}
                </p>
              </div>

              <div className="flex flex-wrap gap-2 justify-center mb-6">
                {Array.from(selectedLocales).slice(0, 10).map(locale => (
                  <span
                    key={locale}
                    className="px-2 py-1 rounded-lg text-sm bg-white/[0.05] border border-white/[0.08]"
                  >
                    {LOCALE_FLAGS[locale]} {LOCALE_NAMES[locale]?.split(' ')[0]}
                  </span>
                ))}
                {selectedLocales.size > 10 && (
                  <span className="px-2 py-1 rounded-lg text-sm bg-white/[0.05] border border-white/[0.08] text-neutral-400">
                    +{selectedLocales.size - 10} more
                  </span>
                )}
              </div>

              {forceReTranslate && (
                <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 text-sm mb-4">
                  <div className="flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 flex-shrink-0" />
                    Existing translations will be overwritten
                  </div>
                </div>
              )}
            </div>

            <div className="p-4 border-t border-white/[0.08] flex justify-between items-center">
              <button
                onClick={() => setStep('select')}
                className="px-4 py-2 rounded-lg text-sm text-neutral-400 hover:text-white"
              >
                Back
              </button>
              <button
                onClick={handleTranslate}
                className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium
                         bg-gradient-to-r from-purple-500 to-pink-500 text-white
                         hover:opacity-90 transition-all"
              >
                <Sparkles className="w-4 h-4" />
                Translate Now
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// How Translation Works help modal
function TranslationHelpModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[10000] p-4 backdrop-blur-sm">
      <div className="bg-[#1a1a1a] rounded-2xl border border-white/[0.08] w-full max-w-lg shadow-2xl">
        <div className="p-4 border-b border-white/[0.08] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Info className="w-5 h-5 text-blue-400" />
            <h3 className="font-semibold text-white">How Translation Works</h3>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-neutral-400 hover:text-white hover:bg-white/[0.05]"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div className="flex gap-3">
            <div className="p-2 rounded-lg bg-purple-500/10 h-fit">
              <Target className="w-5 h-5 text-purple-400" />
            </div>
            <div>
              <h4 className="font-medium text-white mb-1">ASO-Optimized</h4>
              <p className="text-sm text-neutral-400">
                Translations are optimized for each market, using region-specific terminology and keywords.
              </p>
            </div>
          </div>

          <div className="flex gap-3">
            <div className="p-2 rounded-lg bg-blue-500/10 h-fit">
              <Zap className="w-5 h-5 text-blue-400" />
            </div>
            <div>
              <h4 className="font-medium text-white mb-1">Smart Change Tracking</h4>
              <p className="text-sm text-neutral-400">
                Only changed fields are re-translated. Unchanged content is preserved to save time and costs.
              </p>
            </div>
          </div>

          <div className="flex gap-3">
            <div className="p-2 rounded-lg bg-green-500/10 h-fit">
              <Globe className="w-5 h-5 text-green-400" />
            </div>
            <div>
              <h4 className="font-medium text-white mb-1">Regional Variants</h4>
              <p className="text-sm text-neutral-400">
                English variants (UK, AU, CA) get localized spelling. Chinese variants get proper Simplified/Traditional.
              </p>
            </div>
          </div>

          <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20">
            <div className="flex gap-2">
              <AlertCircle className="w-5 h-5 text-amber-400 flex-shrink-0" />
              <div>
                <p className="text-sm text-amber-300 font-medium">Review Before Publishing</p>
                <p className="text-xs text-amber-400/80 mt-1">
                  AI translations should be reviewed before pushing to App Store Connect.
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="p-4 border-t border-white/[0.08]">
          <button
            onClick={onClose}
            className="w-full px-4 py-2 rounded-lg text-sm font-medium bg-white/[0.05] text-white hover:bg-white/[0.08]"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  )
}

// Scrambling field component for translation animation
function ScrambleField({
  value,
  isScrambling,
  locale,
  multiline,
}: {
  value: string
  isScrambling: boolean
  locale: string
  multiline?: boolean
}) {
  const displayText = useScrambleText(value || '', isScrambling, locale)

  if (multiline) {
    return (
      <div className="px-3 py-2 rounded-lg bg-white/[0.02] border border-purple-500/30 text-purple-300 text-sm min-h-[60px] whitespace-pre-wrap">
        {displayText || <span className="text-neutral-500">Translating...</span>}
      </div>
    )
  }

  return (
    <div className="px-3 py-2 rounded-lg bg-white/[0.02] border border-purple-500/30 text-purple-300 text-sm">
      {displayText || <span className="text-neutral-500">Translating...</span>}
    </div>
  )
}

// Main TranslationPanel component
export default function TranslationPanel({
  localizations,
  primaryLocale,
  enabledLocales,
  fields,
  selectedLocale,
  onLocaleSelect,
  fieldValues,
  onFieldChange,
  onSave,
  onTranslate,
  isSaving,
  isTranslating,
  hasChanges,
  translateProgress,
  error,
  success,
  disabled = false,
}: TranslationPanelProps) {
  const [showBulkTranslate, setShowBulkTranslate] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  const [justTranslated, setJustTranslated] = useState(false)

  const availableLocales = enabledLocales.length > 0 ? enabledLocales : [primaryLocale]
  const isPrimarySelected = selectedLocale === primaryLocale
  const primaryData = localizations.find(l => l.locale === primaryLocale)

  // Get sync status for a locale
  const getLocaleStatus = useCallback((locale: string): SyncStatus => {
    if (locale === primaryLocale) return 'synced'
    const loc = localizations.find(l => l.locale === locale)
    if (!loc) return 'needs_translation'

    // Check if at least the first (primary) field has content
    // This handles optional fields like customAppName that may be empty
    const primaryField = fields[0]
    if (!loc[primaryField.key]?.trim()) return 'needs_translation'

    // Could add hash comparison for needs_sync detection
    return 'synced'
  }, [localizations, primaryLocale, fields])

  // Handle bulk translate
  const handleBulkTranslate = async (targetLocales: string[], force: boolean) => {
    await onTranslate(targetLocales, force)
    setShowBulkTranslate(false)
    setJustTranslated(true)
    setTimeout(() => setJustTranslated(false), 1500)
  }

  // Count locales by status
  const statusCounts = useMemo(() => {
    const counts = { synced: 0, needsTranslation: 0, needsSync: 0 }
    availableLocales.forEach(locale => {
      const status = getLocaleStatus(locale)
      if (status === 'synced') counts.synced++
      else if (status === 'needs_translation') counts.needsTranslation++
      else if (status === 'needs_sync') counts.needsSync++
    })
    return counts
  }, [availableLocales, getLocaleStatus])

  return (
    <div className="flex flex-col sm:flex-row h-full overflow-hidden">
      {/* Locale Sidebar */}
      <div className="sm:w-64 flex-shrink-0 border-b sm:border-b-0 sm:border-r border-white/[0.06] flex flex-col overflow-hidden">
        {/* Translate button (only on primary and when not disabled) */}
        {!disabled && isPrimarySelected && primaryData && fields.some(f => primaryData[f.key]) && (
          <div className="p-3 border-b border-white/[0.06] flex-shrink-0">
            <button
              onClick={() => setShowBulkTranslate(true)}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium
                       bg-gradient-to-r from-purple-500 to-pink-500 text-white
                       hover:opacity-90 transition-all"
            >
              <Sparkles className="w-4 h-4" />
              Translate to All Languages
            </button>
            <button
              onClick={() => setShowHelp(true)}
              className="mt-2 w-full flex items-center justify-center gap-1 text-xs text-neutral-500 hover:text-neutral-300"
            >
              <Info className="w-3 h-3" />
              How does this work?
            </button>
          </div>
        )}

        {/* Status summary */}
        <div className="p-3 border-b border-white/[0.06] flex-shrink-0">
          <div className="flex items-center justify-between text-xs">
            <span className="text-neutral-500">Translation Status</span>
            <span className="text-neutral-400">
              {statusCounts.synced}/{availableLocales.length}
            </span>
          </div>
          <div className="mt-2 h-1.5 rounded-full bg-white/[0.05] overflow-hidden flex">
            {statusCounts.synced > 0 && (
              <div
                className="h-full bg-green-500"
                style={{ width: `${(statusCounts.synced / availableLocales.length) * 100}%` }}
              />
            )}
            {statusCounts.needsSync > 0 && (
              <div
                className="h-full bg-purple-500"
                style={{ width: `${(statusCounts.needsSync / availableLocales.length) * 100}%` }}
              />
            )}
            {statusCounts.needsTranslation > 0 && (
              <div
                className="h-full bg-amber-500"
                style={{ width: `${(statusCounts.needsTranslation / availableLocales.length) * 100}%` }}
              />
            )}
          </div>
        </div>

        {/* Locale list - scrolls independently */}
        <div className="flex-1 min-h-0 overflow-y-auto p-2 max-h-[calc(100vh-300px)]">
          <div className="space-y-1">
            {availableLocales.map(locale => {
              const status = getLocaleStatus(locale)
              const isPrimary = locale === primaryLocale
              const isSelected = locale === selectedLocale

              return (
                <button
                  key={locale}
                  onClick={() => onLocaleSelect(locale)}
                  className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-all ${
                    isSelected
                      ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                      : 'text-neutral-400 hover:text-white hover:bg-white/[0.05]'
                  }`}
                >
                  <span className="text-base">{LOCALE_FLAGS[locale] || '🌐'}</span>
                  <span className="flex-1 text-left truncate">
                    {LOCALE_NAMES[locale] || locale}
                  </span>
                  {isPrimary && <Star className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />}
                  {!isPrimary && status === 'synced' && (
                    <Check className="w-3.5 h-3.5 text-green-400 flex-shrink-0" />
                  )}
                  {!isPrimary && status === 'needs_translation' && (
                    <span className="w-2 h-2 rounded-full bg-amber-400 flex-shrink-0" />
                  )}
                  {!isPrimary && status === 'needs_sync' && (
                    <RefreshCw className="w-3.5 h-3.5 text-purple-400 flex-shrink-0" />
                  )}
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {/* Editor area - scrolls independently */}
      <div className="flex-1 min-h-0 p-4 sm:p-6 overflow-y-auto max-h-[calc(100vh-200px)]">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <span className="text-2xl">{LOCALE_FLAGS[selectedLocale] || '🌐'}</span>
          <div>
            <h3 className="font-semibold text-white flex items-center gap-2">
              {LOCALE_NAMES[selectedLocale] || selectedLocale}
              {isPrimarySelected && (
                <span className="px-2 py-0.5 rounded text-xs font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20">
                  Primary
                </span>
              )}
            </h3>
            <p className="text-xs text-neutral-500 font-mono">{selectedLocale}</p>
          </div>
        </div>

        {/* Error/Success alerts */}
        {error && (
          <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm flex items-center gap-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            {error}
          </div>
        )}
        {success && (
          <div className="mb-4 p-3 rounded-lg bg-green-500/10 border border-green-500/20 text-green-400 text-sm flex items-center gap-2">
            <Check className="w-4 h-4 flex-shrink-0" />
            {success}
          </div>
        )}

        {/* Fields */}
        <div className="space-y-5">
          {fields.map(field => {
            const value = fieldValues[field.key] || ''
            const primaryValue = primaryData?.[field.key] || ''
            const charCount = value.length
            const charPercent = (charCount / field.maxLength) * 100

            return (
              <div key={field.key}>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium text-neutral-300">
                    {field.label}
                  </label>
                  <span className={`text-xs tabular-nums ${
                    charPercent > 100 ? 'text-red-400' :
                    charPercent > 90 ? 'text-amber-400' :
                    'text-neutral-500'
                  }`}>
                    {charCount}/{field.maxLength}
                  </span>
                </div>

                {/* Reference text (when not primary) */}
                {!isPrimarySelected && primaryValue && (
                  <div className="mb-2 p-2 rounded-lg bg-white/[0.02] border border-white/[0.06]">
                    <p className="text-[10px] text-neutral-500 uppercase tracking-wider mb-1">
                      {LOCALE_FLAGS[primaryLocale]} Reference
                    </p>
                    <p className="text-xs text-neutral-400">{primaryValue}</p>
                  </div>
                )}

                {/* Show scrambling animation during translation */}
                {isTranslating && !isPrimarySelected ? (
                  <ScrambleField
                    value={value}
                    isScrambling={true}
                    locale={selectedLocale}
                    multiline={field.multiline}
                  />
                ) : field.multiline ? (
                  <textarea
                    value={value}
                    onChange={e => onFieldChange(field.key, e.target.value.slice(0, field.maxLength))}
                    placeholder={field.helpText || `Enter ${field.label.toLowerCase()}`}
                    rows={3}
                    disabled={disabled}
                    className={`w-full px-3 py-2 rounded-lg bg-white/[0.03] border border-white/[0.08] text-white
                             placeholder:text-neutral-600 focus:outline-none focus:border-purple-500/50 resize-none transition-all
                             ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`}
                  />
                ) : (
                  <input
                    type="text"
                    value={value}
                    onChange={e => onFieldChange(field.key, e.target.value.slice(0, field.maxLength))}
                    placeholder={field.helpText || `Enter ${field.label.toLowerCase()}`}
                    disabled={disabled}
                    className={`w-full px-3 py-2 rounded-lg bg-white/[0.03] border border-white/[0.08] text-white
                             placeholder:text-neutral-600 focus:outline-none focus:border-purple-500/50 transition-all
                             ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`}
                  />
                )}

                {/* Character progress bar */}
                <div className="mt-1.5 h-1 rounded-full bg-white/[0.05] overflow-hidden">
                  <div
                    className={`h-full transition-all ${
                      charPercent > 100 ? 'bg-red-500' :
                      charPercent > 90 ? 'bg-amber-500' :
                      charPercent > 75 ? 'bg-yellow-500' :
                      'bg-green-500'
                    }`}
                    style={{ width: `${Math.min(charPercent, 100)}%` }}
                  />
                </div>

                {field.helpText && (
                  <p className="mt-1.5 text-xs text-neutral-500">{field.helpText}</p>
                )}
              </div>
            )
          })}
        </div>

        {/* Save button (hidden when disabled) */}
        {!disabled && (
          <div className="mt-6 flex justify-end">
            <button
              onClick={onSave}
              disabled={isSaving || !hasChanges}
              className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium
                       bg-gradient-to-r from-purple-500 to-blue-500 text-white
                       hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              {isSaving ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Check className="w-4 h-4" />
              )}
              Save Changes
            </button>
          </div>
        )}
      </div>

      {/* Modals */}
      {showBulkTranslate && (
        <BulkTranslateModal
          availableLocales={availableLocales}
          localizations={localizations}
          primaryLocale={primaryLocale}
          getLocaleStatus={getLocaleStatus}
          onTranslate={handleBulkTranslate}
          onClose={() => setShowBulkTranslate(false)}
          isTranslating={isTranslating}
          progress={translateProgress ?? null}
        />
      )}

      {showHelp && (
        <TranslationHelpModal onClose={() => setShowHelp(false)} />
      )}
    </div>
  )
}
