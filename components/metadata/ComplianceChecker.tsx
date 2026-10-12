'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import {
  Shield,
  ShieldCheck,
  ShieldAlert,
  AlertTriangle,
  AlertCircle,
  Info,
  Wand2,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Sparkles,
  Loader2,
  Brain,
  FileText,
} from 'lucide-react'
import type { LocalizedMetadata } from '@/lib/firebase/firestore'

interface ComplianceIssue {
  id: string
  field: string
  severity: 'error' | 'warning' | 'info'
  message: string
  detail: string
  fixPrompt?: string
  guideline?: string
  // Actionable fields for legal document issues
  actionType?: 'create_privacy_policy' | 'publish_privacy_policy' | 'create_terms' | 'publish_terms'
  actionUrl?: string
  actionLabel?: string
}

interface ComplianceCheckerProps {
  metadata: LocalizedMetadata
  projectId: string
  locale: string
  storeType?: 'ios' | 'android'
  onFix: (field: keyof LocalizedMetadata, value: string | null) => void
  className?: string
}

const SEVERITY_CONFIG = {
  error: {
    icon: AlertCircle,
    bgColor: 'bg-red-500/10',
    borderColor: 'border-red-500/20',
    textColor: 'text-red-400',
    badgeBg: 'bg-red-500/20',
    label: 'Error',
  },
  warning: {
    icon: AlertTriangle,
    bgColor: 'bg-yellow-500/10',
    borderColor: 'border-yellow-500/20',
    textColor: 'text-yellow-400',
    badgeBg: 'bg-yellow-500/20',
    label: 'Warning',
  },
  info: {
    icon: Info,
    bgColor: 'bg-blue-500/10',
    borderColor: 'border-blue-500/20',
    textColor: 'text-blue-400',
    badgeBg: 'bg-blue-500/20',
    label: 'Info',
  },
}

const FIELD_LABELS: Record<string, string> = {
  name: 'App Name',
  subtitle: 'Subtitle',
  keywords: 'Keywords',
  description: 'Description',
  whatsNew: "What's New",
  promotionalText: 'Promotional Text',
  privacyUrl: 'Privacy URL',
  supportUrl: 'Support URL',
  marketingUrl: 'Marketing URL',
  shortDescription: 'Short Description',
  fullDescription: 'Full Description',
}

const GUIDELINE_LINKS: Record<string, string> = {
  '2.3': 'https://developer.apple.com/app-store/review/guidelines/#accurate-metadata',
  '2.3.1': 'https://developer.apple.com/app-store/review/guidelines/#accurate-metadata',
  '2.3.2': 'https://developer.apple.com/app-store/review/guidelines/#accurate-metadata',
  '2.3.7': 'https://developer.apple.com/app-store/review/guidelines/#accurate-metadata',
  '3.1.2': 'https://developer.apple.com/app-store/review/guidelines/#subscriptions',
  '5.1.1': 'https://developer.apple.com/app-store/review/guidelines/#privacy',
}

export function ComplianceChecker({ metadata, projectId, locale, storeType = 'ios', onFix, className = '' }: ComplianceCheckerProps) {
  const [isExpanded, setIsExpanded] = useState(true)
  const [fixingIssue, setFixingIssue] = useState<string | null>(null)
  const [fixAllInProgress, setFixAllInProgress] = useState(false)
  const [isRunningCheck, setIsRunningCheck] = useState(false)
  const [issues, setIssues] = useState<ComplianceIssue[] | null>(null)
  const [checkError, setCheckError] = useState<string | null>(null)

  // Group issues by severity
  const groupedIssues = useMemo(() => {
    const groups = {
      error: [] as ComplianceIssue[],
      warning: [] as ComplianceIssue[],
      info: [] as ComplianceIssue[],
    }

    if (!issues) return groups

    for (const issue of issues) {
      groups[issue.severity].push(issue)
    }

    return groups
  }, [issues])

  const runComplianceCheck = async () => {
    setIsRunningCheck(true)
    setCheckError(null)

    try {
      const metadataPayload = storeType === 'android'
        ? {
            name: metadata.name || '',
            shortDescription: metadata.shortDescription || '',
            fullDescription: metadata.fullDescription || '',
          }
        : {
            name: metadata.name || '',
            subtitle: metadata.subtitle || '',
            keywords: metadata.keywords || '',
            description: metadata.description || '',
            whatsNew: metadata.whatsNew || '',
            promotionalText: metadata.promotionalText || '',
            privacyUrl: metadata.privacyUrl,
          }

      const response = await fetch('/api/ai/compliance-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          locale,
          storeType,
          metadata: metadataPayload,
        }),
      })

      if (!response.ok) {
        throw new Error('Compliance check failed')
      }

      const data = await response.json()
      if (data.success) {
        setIssues(data.issues || [])
      } else {
        throw new Error(data.error || 'Compliance check failed')
      }
    } catch (error) {
      console.error('Compliance check failed:', error)
      setCheckError(error instanceof Error ? error.message : 'Compliance check failed')
    } finally {
      setIsRunningCheck(false)
    }
  }

  const handleFix = async (issue: ComplianceIssue) => {
    if (!issue.fixPrompt) return

    setFixingIssue(issue.id)

    try {
      const currentValue = (metadata as unknown as Record<string, string | null>)[issue.field] || ''

      const response = await fetch('/api/ai/enhance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          field: issue.field,
          currentValue,
          locale,
          prompt: issue.fixPrompt,
        }),
      })

      if (!response.ok) {
        throw new Error('Failed to fix issue')
      }

      const data = await response.json()
      if (data.success && data.enhanced) {
        onFix(issue.field as keyof LocalizedMetadata, data.enhanced)
        // Remove the fixed issue from the list
        setIssues(prev => prev?.filter(i => i.id !== issue.id) || null)
      }
    } catch (error) {
      console.error('Failed to fix issue:', error)
    } finally {
      setFixingIssue(null)
    }
  }

  const handleFixAll = async () => {
    if (!issues) return
    const fixableIssues = issues.filter(i => i.fixPrompt)
    if (fixableIssues.length === 0) return

    setFixAllInProgress(true)

    for (const issue of fixableIssues) {
      setFixingIssue(issue.id)

      try {
        const currentValue = (metadata as unknown as Record<string, string | null>)[issue.field] || ''

        const response = await fetch('/api/ai/enhance', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectId,
            field: issue.field,
            currentValue,
            locale,
            prompt: issue.fixPrompt,
          }),
        })

        if (response.ok) {
          const data = await response.json()
          if (data.success && data.enhanced) {
            onFix(issue.field as keyof LocalizedMetadata, data.enhanced)
            await new Promise(resolve => setTimeout(resolve, 300))
          }
        }
      } catch (error) {
        console.error('Failed to fix issue:', error)
      }
    }

    // Re-run check after fixing all
    setFixingIssue(null)
    setFixAllInProgress(false)
    await runComplianceCheck()
  }

  const fixableCount = issues?.filter(i => i.fixPrompt).length || 0
  const errorCount = groupedIssues.error.length
  const warningCount = groupedIssues.warning.length

  // Calculate score (only when we have results)
  const score = useMemo(() => {
    if (!issues) return null
    const infoCount = groupedIssues.info.length
    const deductions = (errorCount * 15) + (warningCount * 5) + (infoCount * 1)
    return Math.max(0, 100 - deductions)
  }, [issues, errorCount, warningCount, groupedIssues.info.length])

  // Determine overall status
  const storeName = storeType === 'android' ? 'Play Store' : 'App Store'
  const getStatusConfig = () => {
    if (!issues) {
      return {
        icon: Shield,
        color: 'text-neutral-400',
        bgColor: 'bg-white/[0.02]',
        borderColor: 'border-white/[0.08]',
        label: `${storeName} Compliance Check`,
        description: `Check your metadata against ${storeType === 'android' ? 'Google Play' : 'Apple App Store'} guidelines`,
      }
    }
    if (errorCount > 0) {
      return {
        icon: ShieldAlert,
        color: 'text-red-400',
        bgColor: 'bg-red-500/10',
        borderColor: 'border-red-500/20',
        label: 'Issues Found',
        description: `${errorCount} error${errorCount > 1 ? 's' : ''} will likely cause rejection`,
      }
    }
    if (warningCount > 0) {
      return {
        icon: Shield,
        color: 'text-yellow-400',
        bgColor: 'bg-yellow-500/10',
        borderColor: 'border-yellow-500/20',
        label: 'Warnings',
        description: `${warningCount} warning${warningCount > 1 ? 's' : ''} may affect review`,
      }
    }
    return {
      icon: ShieldCheck,
      color: 'text-green-400',
      bgColor: 'bg-green-500/10',
      borderColor: 'border-green-500/20',
      label: 'Compliant',
      description: `Metadata looks good for ${storeName} submission`,
    }
  }

  const status = getStatusConfig()
  const StatusIcon = status.icon

  return (
    <div className={`rounded-2xl border ${status.borderColor} ${status.bgColor} overflow-hidden ${className}`}>
      {/* Header */}
      <div className="w-full px-5 py-4 flex items-center justify-between">
        <div
          className="flex items-center gap-3 cursor-pointer hover:opacity-80 transition-opacity flex-1"
          onClick={() => setIsExpanded(!isExpanded)}
        >
          <StatusIcon className={`w-5 h-5 ${status.color}`} />
          <div className="text-left">
            <div className="flex items-center gap-2">
              <span className={`text-[14px] font-semibold ${status.color}`}>
                {status.label}
              </span>
              {score !== null && (
                <span className="text-[12px] text-neutral-500">
                  Score: {score}/100
                </span>
              )}
            </div>
            <p className="text-[12px] text-neutral-400">
              {status.description}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Check Button */}
          <button
            onClick={() => runComplianceCheck()}
            disabled={isRunningCheck}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-[13px] font-medium
                     bg-gradient-to-r from-purple-500 to-blue-500 text-white
                     hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            title="Run AI-powered compliance analysis"
          >
            {isRunningCheck ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Brain className="w-4 h-4" />
            )}
            {isRunningCheck ? 'Checking...' : issues ? 'Re-check' : 'Check Compliance'}
          </button>

          {fixableCount > 0 && (
            <button
              onClick={() => handleFixAll()}
              disabled={fixingIssue !== null || fixAllInProgress}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-[13px] font-medium
                       bg-purple-500/20 text-purple-400 hover:bg-purple-500/30
                       disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {fixAllInProgress ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Sparkles className="w-4 h-4" />
              )}
              {fixAllInProgress ? 'Fixing...' : `Fix All (${fixableCount})`}
            </button>
          )}
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="p-1 hover:bg-white/[0.05] rounded-lg transition-colors"
          >
            {isExpanded ? (
              <ChevronUp className="w-4 h-4 text-neutral-500" />
            ) : (
              <ChevronDown className="w-4 h-4 text-neutral-500" />
            )}
          </button>
        </div>
      </div>

      {/* Check Error */}
      {checkError && (
        <div className="px-5 py-2 border-t border-white/[0.05] bg-red-500/10">
          <p className="text-[12px] text-red-400">Check failed: {checkError}</p>
        </div>
      )}

      {/* Issues List */}
      {isExpanded && issues && issues.length > 0 && (
        <div className="border-t border-white/[0.05]">
          {/* Errors */}
          {groupedIssues.error.length > 0 && (
            <IssueGroup
              title="Errors"
              issues={groupedIssues.error}
              severity="error"
              onFix={handleFix}
              fixingIssue={fixingIssue}
            />
          )}

          {/* Warnings */}
          {groupedIssues.warning.length > 0 && (
            <IssueGroup
              title="Warnings"
              issues={groupedIssues.warning}
              severity="warning"
              onFix={handleFix}
              fixingIssue={fixingIssue}
            />
          )}

          {/* Info */}
          {groupedIssues.info.length > 0 && (
            <IssueGroup
              title="Suggestions"
              issues={groupedIssues.info}
              severity="info"
              onFix={handleFix}
              fixingIssue={fixingIssue}
            />
          )}
        </div>
      )}

      {/* All Clear Message */}
      {isExpanded && issues && issues.length === 0 && (
        <div className="px-5 py-4 border-t border-white/[0.05]">
          <div className="flex items-center justify-center gap-2 text-[13px] text-green-400">
            <ShieldCheck className="w-4 h-4" />
            No compliance issues found - ready for {storeName} submission!
          </div>
        </div>
      )}

      {/* Initial State - No check run yet */}
      {isExpanded && !issues && !isRunningCheck && (
        <div className="px-5 py-6 border-t border-white/[0.05]">
          <div className="flex flex-col items-center justify-center gap-3 text-center">
            <div className="p-3 rounded-full bg-purple-500/10">
              <Brain className="w-6 h-6 text-purple-400" />
            </div>
            <div>
              <p className="text-[13px] text-neutral-300 font-medium">
                AI-Powered Compliance Analysis
              </p>
              <p className="text-[12px] text-neutral-500 mt-1">
                Checks for guideline violations, unverifiable claims, pricing info, and more
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

interface IssueGroupProps {
  title: string
  issues: ComplianceIssue[]
  severity: 'error' | 'warning' | 'info'
  onFix: (issue: ComplianceIssue) => void
  fixingIssue: string | null
}

function IssueGroup({ title, issues, severity, onFix, fixingIssue }: IssueGroupProps) {
  const config = SEVERITY_CONFIG[severity]

  return (
    <div className="px-5 py-3">
      <div className="flex items-center gap-2 mb-2">
        <span className={`text-[11px] font-semibold uppercase tracking-wider ${config.textColor}`}>
          {title} ({issues.length})
        </span>
      </div>
      <div className="space-y-2">
        {issues.map((issue) => (
          <IssueCard
            key={issue.id}
            issue={issue}
            onFix={onFix}
            isFixing={fixingIssue === issue.id}
          />
        ))}
      </div>
    </div>
  )
}

interface IssueCardProps {
  issue: ComplianceIssue
  onFix: (issue: ComplianceIssue) => void
  isFixing: boolean
}

function IssueCard({ issue, onFix, isFixing }: IssueCardProps) {
  const config = SEVERITY_CONFIG[issue.severity]
  const Icon = config.icon
  const guidelineLink = issue.guideline ? GUIDELINE_LINKS[issue.guideline] : null

  // Check if this is an actionable legal document issue
  const isActionableIssue = issue.actionType && issue.actionUrl && issue.actionLabel

  return (
    <div className={`p-3 rounded-xl ${config.bgColor} border ${config.borderColor}`}>
      <div className="flex items-start gap-3">
        <Icon className={`w-4 h-4 mt-0.5 flex-shrink-0 ${config.textColor}`} />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-[13px] font-medium ${config.textColor}`}>
              {issue.message}
            </span>
            <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-white/[0.05] text-neutral-400">
              {FIELD_LABELS[issue.field] || issue.field}
            </span>
            {issue.guideline && (
              <a
                href={guidelineLink || '#'}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-[10px] text-neutral-500 hover:text-neutral-300 transition-colors"
              >
                Guideline {issue.guideline}
                <ExternalLink className="w-2.5 h-2.5" />
              </a>
            )}
          </div>

          <p className="text-[12px] text-neutral-400 mt-1">
            {issue.detail}
          </p>
        </div>

        {/* Actionable link button for legal document issues */}
        {isActionableIssue && (
          <Link
            href={issue.actionUrl!}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium
                     flex-shrink-0 transition-all
                     bg-blue-500/20 text-blue-400 hover:bg-blue-500/30"
          >
            <FileText className="w-3 h-3" />
            {issue.actionLabel}
          </Link>
        )}

        {/* AI fix button for regular issues */}
        {!isActionableIssue && issue.fixPrompt && (
          <button
            onClick={() => onFix(issue)}
            disabled={isFixing}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium
                     flex-shrink-0 transition-all
                     ${isFixing
                       ? 'bg-purple-500/30 text-purple-300 cursor-wait'
                       : 'bg-purple-500/20 text-purple-400 hover:bg-purple-500/30'
                     }`}
          >
            {isFixing ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <Wand2 className="w-3 h-3" />
            )}
            {isFixing ? 'Fixing...' : 'Fix'}
          </button>
        )}
      </div>
    </div>
  )
}
