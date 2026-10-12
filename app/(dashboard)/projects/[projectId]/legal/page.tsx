'use client'

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import {
  FileText,
  Shield,
  ScrollText,
  Save,
  Loader2,
  Copy,
  Check,
  ExternalLink,
  Eye,
  EyeOff,
  Sparkles,
  Upload,
  AlertCircle,
  Clock,
  ArrowUpRight,
} from 'lucide-react'
import { PolicyWizard, PolicyType } from '@/components/legal/policy-wizard'

interface LegalDocumentState {
  draftContent: string
  publishedContent: string | null
  isPublished: boolean
  lastPublishedAt: string | null
  hasUnsavedChanges: boolean
}

const initialDocState: LegalDocumentState = {
  draftContent: '',
  publishedContent: null,
  isPublished: false,
  lastPublishedAt: null,
  hasUnsavedChanges: false,
}

export default function LegalPage() {
  const params = useParams()
  const projectId = params.projectId as string

  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const [privacyDoc, setPrivacyDoc] = useState<LegalDocumentState>(initialDocState)
  const [termsDoc, setTermsDoc] = useState<LegalDocumentState>(initialDocState)
  const [publicSlug, setPublicSlug] = useState<string | null>(null)
  const [publicUrls, setPublicUrls] = useState<{ privacy: string; terms: string } | null>(null)

  const [isSavingPrivacy, setIsSavingPrivacy] = useState(false)
  const [isPublishingPrivacy, setIsPublishingPrivacy] = useState(false)
  const [isSavingTerms, setIsSavingTerms] = useState(false)
  const [isPublishingTerms, setIsPublishingTerms] = useState(false)
  const [isPushingPrivacy, setIsPushingPrivacy] = useState(false)
  const [isPushingTerms, setIsPushingTerms] = useState(false)
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null)

  const [showPrivacyPreview, setShowPrivacyPreview] = useState(false)
  const [showTermsPreview, setShowTermsPreview] = useState(false)

  const [wizardOpen, setWizardOpen] = useState<PolicyType | null>(null)
  const [projectName, setProjectName] = useState<string>('')
  const [userEmail, setUserEmail] = useState<string>('')
  const [websiteUrl, setWebsiteUrl] = useState<string>('')

  const baseUrl = typeof window !== 'undefined' ? window.location.origin : ''

  // Fetch existing legal documents and project info
  useEffect(() => {
    async function fetchData() {
      try {
        // Fetch legal documents
        const response = await fetch(`/api/legal?projectId=${projectId}`)
        if (!response.ok) {
          throw new Error('Failed to fetch legal documents')
        }
        const response_data = await response.json()
        // successResponse wraps in { success, data }, so unwrap it
        const data = response_data.data || response_data

        // Debug: log API response
        console.log('[Legal] API Response:', {
          hasPrivacy: !!data.documents?.privacy_policy,
          hasTerms: !!data.documents?.terms_of_service,
          privacyContentLength: data.documents?.privacy_policy?.draftContent?.length || 0,
          debug: data._debug
        })

        if (data.documents?.privacy_policy) {
          const doc = data.documents.privacy_policy
          setPrivacyDoc({
            draftContent: doc.draftContent ?? doc.content ?? '',
            publishedContent: doc.publishedContent ?? (doc.isPublished ? doc.content : null) ?? null,
            isPublished: doc.isPublished || false,
            lastPublishedAt: doc.lastPublishedAt || null,
            hasUnsavedChanges: false,
          })
        }
        if (data.documents?.terms_of_service) {
          const doc = data.documents.terms_of_service
          setTermsDoc({
            draftContent: doc.draftContent ?? doc.content ?? '',
            publishedContent: doc.publishedContent ?? (doc.isPublished ? doc.content : null) ?? null,
            isPublished: doc.isPublished || false,
            lastPublishedAt: doc.lastPublishedAt || null,
            hasUnsavedChanges: false,
          })
        }
        setPublicSlug(data.publicSlug || null)
        if (data.publicUrls) {
          setPublicUrls(data.publicUrls)
        }

        // Fetch project details
        const projectRes = await fetch(`/api/projects/${projectId}`)
        if (projectRes.ok) {
          const projectData = await projectRes.json()
          setProjectName(projectData.name || '')
          setWebsiteUrl(projectData.marketingUrl || projectData.supportUrl || '')
        }

        // Fetch user session for email
        const sessionRes = await fetch('/api/auth/session')
        if (sessionRes.ok) {
          const sessionData = await sessionRes.json()
          setUserEmail(sessionData.email || '')
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'An error occurred')
      } finally {
        setIsLoading(false)
      }
    }

    fetchData()
  }, [projectId])

  const handleContentChange = (type: 'privacy_policy' | 'terms_of_service', content: string) => {
    if (type === 'privacy_policy') {
      setPrivacyDoc(prev => ({
        ...prev,
        draftContent: content,
        hasUnsavedChanges: true,
      }))
    } else {
      setTermsDoc(prev => ({
        ...prev,
        draftContent: content,
        hasUnsavedChanges: true,
      }))
    }
  }

  const handleSaveDraft = async (type: 'privacy_policy' | 'terms_of_service') => {
    const doc = type === 'privacy_policy' ? privacyDoc : termsDoc
    const setIsSaving = type === 'privacy_policy' ? setIsSavingPrivacy : setIsSavingTerms
    const setDoc = type === 'privacy_policy' ? setPrivacyDoc : setTermsDoc

    if (!doc.draftContent.trim()) {
      setError('Please enter some content before saving')
      return
    }

    setIsSaving(true)
    setError(null)
    setSuccess(null)

    try {
      const response = await fetch('/api/legal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          type,
          content: doc.draftContent,
          action: 'save_draft',
        }),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || `Failed to save draft (${response.status})`)
      }

      const response_data = await response.json()
      const data = response_data.data || response_data
      console.log('[Legal] POST Response:', data._debug)
      setPublicSlug(data.publicSlug)
      if (data.publicUrls) {
        setPublicUrls(data.publicUrls)
      }
      setDoc(prev => ({ ...prev, hasUnsavedChanges: false }))
      setSuccess(`Draft saved!`)
      setTimeout(() => setSuccess(null), 3000)
    } catch (err) {
      console.error('Save draft error:', err)
      setError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setIsSaving(false)
    }
  }

  const handlePublish = async (type: 'privacy_policy' | 'terms_of_service') => {
    const doc = type === 'privacy_policy' ? privacyDoc : termsDoc
    const setIsPublishing = type === 'privacy_policy' ? setIsPublishingPrivacy : setIsPublishingTerms
    const setDoc = type === 'privacy_policy' ? setPrivacyDoc : setTermsDoc

    if (!doc.draftContent.trim()) {
      setError('Cannot publish empty content')
      return
    }

    setIsPublishing(true)
    setError(null)
    setSuccess(null)

    try {
      const response = await fetch('/api/legal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          type,
          content: doc.draftContent,
          action: 'publish',
        }),
      })

      if (!response.ok) {
        throw new Error('Failed to publish')
      }

      const response_data = await response.json()
      const data = response_data.data || response_data  // Unwrap successResponse wrapper
      setPublicSlug(data.publicSlug)
      // Update publicUrls with the returned URL
      if (data.publicSlug) {
        const urlType = type === 'privacy_policy' ? 'privacy' : 'terms'
        const newUrl = data.publicUrl || `${baseUrl}/legal/${data.publicSlug}/${urlType}`
        setPublicUrls(prev => ({
          privacy: urlType === 'privacy' ? newUrl : (prev?.privacy || ''),
          terms: urlType === 'terms' ? newUrl : (prev?.terms || ''),
        }))
      }
      setDoc(prev => ({
        ...prev,
        publishedContent: prev.draftContent,
        isPublished: true,
        lastPublishedAt: new Date().toISOString(),
        hasUnsavedChanges: false,
      }))
      setSuccess(`${type === 'privacy_policy' ? 'Privacy Policy' : 'Terms of Service'} published!`)
      setTimeout(() => setSuccess(null), 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to publish')
    } finally {
      setIsPublishing(false)
    }
  }

  const copyUrl = async (type: 'privacy' | 'terms') => {
    const url = publicUrls?.[type] || (publicSlug ? `${baseUrl}/legal/${publicSlug}/${type}` : null)
    if (!url) return

    await navigator.clipboard.writeText(url)
    setCopiedUrl(type)
    setTimeout(() => setCopiedUrl(null), 2000)
  }

  const handlePushToAppStore = async (type: 'privacy_policy' | 'terms_of_service') => {
    const setIsPushing = type === 'privacy_policy' ? setIsPushingPrivacy : setIsPushingTerms

    setIsPushing(true)
    setError(null)
    setSuccess(null)

    try {
      const response = await fetch('/api/legal/push-to-appstore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          type,
        }),
      })

      const responseData = await response.json()
      const data = responseData.data || responseData

      if (!response.ok) {
        throw new Error(data.error || 'Failed to push to App Store Connect')
      }

      if (data.success) {
        setSuccess(data.message || `${type === 'privacy_policy' ? 'Privacy policy' : 'Terms of service'} URL pushed to App Store Connect!`)
        setTimeout(() => setSuccess(null), 5000)
      } else {
        throw new Error(data.message || 'Failed to push to App Store Connect')
      }
    } catch (err) {
      console.error('Push to App Store error:', err)
      setError(err instanceof Error ? err.message : 'Failed to push to App Store Connect')
    } finally {
      setIsPushing(false)
    }
  }

  const handleWizardGenerate = (content: string) => {
    if (wizardOpen === 'privacy_policy') {
      setPrivacyDoc(prev => ({ ...prev, draftContent: content, hasUnsavedChanges: true }))
    } else if (wizardOpen === 'terms_of_service') {
      setTermsDoc(prev => ({ ...prev, draftContent: content, hasUnsavedChanges: true }))
    }
    setWizardOpen(null)
    setSuccess(`${wizardOpen === 'privacy_policy' ? 'Privacy Policy' : 'Terms of Service'} generated! Review and publish when ready.`)
    setTimeout(() => setSuccess(null), 5000)
  }

  const renderMarkdown = (content: string): string => {
    return content
      .replace(/^### (.*$)/gim, '<h3 class="text-lg font-semibold mt-4 mb-2">$1</h3>')
      .replace(/^## (.*$)/gim, '<h2 class="text-xl font-semibold mt-6 mb-3">$1</h2>')
      .replace(/^# (.*$)/gim, '<h1 class="text-2xl font-bold mt-6 mb-4">$1</h1>')
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" class="text-blue-400 hover:underline">$1</a>')
      .replace(/^\s*[-*]\s+(.*$)/gim, '<li class="ml-4">$1</li>')
      .replace(/\n\n/g, '</p><p class="mb-3">')
      .replace(/\n/g, '<br>')
  }

  const hasUnpublishedChanges = (doc: LegalDocumentState) => {
    if (!doc.isPublished) return doc.draftContent.trim().length > 0
    return doc.draftContent !== doc.publishedContent
  }

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return null
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-6 h-6 animate-spin text-purple-400" />
      </div>
    )
  }

  const renderDocumentSection = (
    type: 'privacy_policy' | 'terms_of_service',
    doc: LegalDocumentState,
    icon: React.ReactNode,
    title: string,
    isPurple: boolean, // Use boolean flag instead of dynamic class strings
    showPreview: boolean,
    setShowPreview: (v: boolean) => void,
    isSaving: boolean,
    isPublishing: boolean,
    isPushing: boolean,
    urlType: 'privacy' | 'terms'
  ) => {
    const unpublishedChanges = hasUnpublishedChanges(doc)

    return (
      <div className="p-6 rounded-2xl bg-white/[0.02] border border-white/[0.08]">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            {icon}
            <h2 className="text-lg font-semibold text-white">{title}</h2>
            {/* Status badges */}
            <div className="flex items-center gap-2">
              {doc.isPublished ? (
                <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-500/20 text-green-400 border border-green-500/30">
                  Published
                </span>
              ) : (
                <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-neutral-500/20 text-neutral-400 border border-neutral-500/30">
                  Draft
                </span>
              )}
              {unpublishedChanges && (
                <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-amber-500/20 text-amber-400 border border-amber-500/30 flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" />
                  Unpublished changes
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setWizardOpen(type)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border transition-colors ${
                isPurple
                  ? 'bg-purple-500/20 text-purple-400 hover:bg-purple-500/30 border-purple-500/30'
                  : 'bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 border-blue-500/30'
              }`}
            >
              <Sparkles className="w-4 h-4" />
              Generate
            </button>
            <button
              onClick={() => setShowPreview(!showPreview)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm
                       bg-white/[0.05] text-neutral-400 hover:text-white hover:bg-white/[0.08]
                       transition-colors"
            >
              {showPreview ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              {showPreview ? 'Edit' : 'Preview'}
            </button>
            <button
              onClick={() => handleSaveDraft(type)}
              disabled={isSaving || !doc.hasUnsavedChanges}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium
                       bg-white/[0.08] text-white hover:bg-white/[0.12]
                       disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              {isSaving ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Save className="w-4 h-4" />
              )}
              Save Draft
            </button>
            <button
              onClick={() => handlePublish(type)}
              disabled={isPublishing || !doc.draftContent.trim()}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium
                       bg-gradient-to-r from-green-500 to-emerald-500 text-white
                       hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              {isPublishing ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Upload className="w-4 h-4" />
              )}
              Publish
            </button>
          </div>
        </div>

        {/* Last published info */}
        {doc.lastPublishedAt && (
          <div className="flex items-center gap-2 mb-3 text-xs text-neutral-500">
            <Clock className="w-3.5 h-3.5" />
            Last published: {formatDate(doc.lastPublishedAt)}
          </div>
        )}

        {/* Public URL */}
        {(() => {
          const currentUrl = publicUrls?.[urlType] || (publicSlug ? `${baseUrl}/legal/${publicSlug}/${urlType}` : null)
          const hasUrl = doc.isPublished && currentUrl

          return (
            <div className={`flex items-center gap-2 mb-4 p-3 rounded-lg ${
              hasUrl
                ? 'bg-green-500/10 border border-green-500/20'
                : 'bg-white/[0.03] border border-white/[0.06]'
            }`}>
              <span className={`text-sm font-medium whitespace-nowrap ${hasUrl ? 'text-green-400' : 'text-neutral-500'}`}>
                App Store URL:
              </span>
              {hasUrl ? (
                <>
                  <code className="text-sm text-green-300 flex-1 truncate">
                    {currentUrl}
                  </code>
                  <button
                    onClick={() => copyUrl(urlType)}
                    className="p-1.5 rounded-lg hover:bg-white/[0.05] text-green-400 hover:text-green-300 transition-colors"
                    title="Copy URL for App Store Connect"
                  >
                    {copiedUrl === urlType ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  </button>
                  <a
                    href={currentUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-1.5 rounded-lg hover:bg-white/[0.05] text-green-400 hover:text-green-300 transition-colors"
                    title="Preview public page"
                  >
                    <ExternalLink className="w-4 h-4" />
                  </a>
                  {/* Only show Push to App Store for privacy policy - ASC doesn't have a terms URL field */}
                  {type === 'privacy_policy' && (
                    <button
                      onClick={() => handlePushToAppStore(type)}
                      disabled={isPushing}
                      className="flex items-center gap-1.5 px-3 py-1 ml-2 rounded-lg text-xs font-medium
                               bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 border border-blue-500/30
                               disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                      title="Push URL to App Store Connect"
                    >
                      {isPushing ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <ArrowUpRight className="w-3.5 h-3.5" />
                      )}
                      Push to App Store
                    </button>
                  )}
                </>
              ) : (
                <span className="text-sm text-neutral-500 italic">Publish to generate public URL</span>
              )}
            </div>
          )
        })()}

        {/* Editor/Preview */}
        {showPreview ? (
          <div
            className="min-h-[300px] p-4 rounded-xl bg-white/[0.03] border border-white/[0.06] text-neutral-300 prose prose-invert prose-sm max-w-none"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(doc.draftContent) || '<p class="text-neutral-500">No content yet...</p>' }}
          />
        ) : (
          <textarea
            value={doc.draftContent}
            onChange={(e) => handleContentChange(type, e.target.value)}
            placeholder={type === 'privacy_policy'
              ? "# Privacy Policy\n\nEnter your privacy policy here using Markdown formatting...\n\n## Information We Collect\n\nWe collect information you provide directly to us..."
              : "# Terms of Service\n\nEnter your terms of service here using Markdown formatting...\n\n## Acceptance of Terms\n\nBy accessing and using this application, you accept and agree to be bound by..."
            }
            className="w-full min-h-[300px] p-4 rounded-xl bg-white/[0.03] border border-white/[0.06]
                     text-white placeholder:text-neutral-600 focus:outline-none focus:border-purple-500/50
                     font-mono text-sm resize-y"
          />
        )}
        <p className="text-xs text-neutral-500 mt-2">
          Supports Markdown formatting. Save drafts as you work, then publish when ready.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white flex items-center gap-3">
          <FileText className="w-7 h-7 text-purple-400" />
          Legal Documents
        </h1>
        <p className="text-neutral-400 mt-1">
          Create your privacy policy and terms of service, then publish to get public URLs for App Store Connect
        </p>
      </div>

      {/* MCP Integration Note */}
      <div className="p-4 rounded-xl bg-gradient-to-br from-purple-500/10 to-blue-500/10 border border-purple-500/20">
        <div className="flex items-start gap-3">
          <Sparkles className="w-5 h-5 text-purple-400 mt-0.5 flex-shrink-0" />
          <div>
            <h3 className="text-sm font-medium text-white mb-1">
              AI-Powered Generation
            </h3>
            <p className="text-sm text-neutral-400 leading-relaxed">
              Use the <span className="text-purple-400 font-medium">Generate</span> button below, or generate policies automatically with{' '}
              <span className="text-purple-400">Claude Code</span>,{' '}
              <span className="text-purple-400">Cursor</span>, or any MCP-compatible AI IDE using the{' '}
              <code className="px-1.5 py-0.5 rounded bg-white/[0.1] text-purple-300 text-xs font-mono">
                update_legal_document
              </code>{' '}
              tool. Your AI assistant can analyze your app&apos;s code to understand what data you collect, which SDKs you use, and generate accurate, customized policies automatically.{' '}
              <a
                href="/docs/mcp"
                className="inline-flex items-center gap-1 text-purple-400 hover:text-purple-300 transition-colors"
              >
                Learn more
                <ExternalLink className="w-3 h-3" />
              </a>
            </p>
          </div>
        </div>
      </div>

      {/* Alerts */}
      {error && (
        <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400">
          {error}
        </div>
      )}

      {success && (
        <div className="p-4 rounded-xl bg-green-500/10 border border-green-500/20 text-green-400 flex items-center gap-2">
          <Check className="w-4 h-4" />
          {success}
        </div>
      )}

      {/* Privacy Policy Section */}
      {renderDocumentSection(
        'privacy_policy',
        privacyDoc,
        <Shield className="w-5 h-5 text-purple-400" />,
        'Privacy Policy',
        true, // isPurple
        showPrivacyPreview,
        setShowPrivacyPreview,
        isSavingPrivacy,
        isPublishingPrivacy,
        isPushingPrivacy,
        'privacy'
      )}

      {/* Terms of Service Section */}
      {renderDocumentSection(
        'terms_of_service',
        termsDoc,
        <ScrollText className="w-5 h-5 text-blue-400" />,
        'Terms of Service',
        false, // isPurple (blue instead)
        showTermsPreview,
        setShowTermsPreview,
        isSavingTerms,
        isPublishingTerms,
        isPushingTerms,
        'terms'
      )}

      {/* Policy Wizard Modal */}
      {wizardOpen && (
        <PolicyWizard
          policyType={wizardOpen}
          projectName={projectName}
          contactEmail={userEmail}
          websiteUrl={websiteUrl}
          onGenerate={handleWizardGenerate}
          onCancel={() => setWizardOpen(null)}
        />
      )}
    </div>
  )
}
