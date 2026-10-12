'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { useSelectedProject } from '@/hooks/useSelectedProject'
import {
  Headset,
  Bug,
  Lightbulb,
  HelpCircle,
  MessageSquare,
  Clock,
  Star,
  TrendingUp,
  ChevronRight,
  X,
  Send,
  Sparkles,
  Loader2,
  Search,
  BookOpen,
  Brain,
  RefreshCw,
  Settings,
  Monitor,
  Globe,
  Smartphone,
  Activity,
  Network,
  Terminal,
  Database,
} from 'lucide-react'

type Tab = 'overview' | 'help-center' | 'ai-knowledge'
type TicketFilter = 'ALL' | 'BUG' | 'FEATURE_REQUEST' | 'INQUIRY'

interface Ticket {
  id: string
  type: string
  status: string
  priority: string
  title?: string
  description?: string
  sessionId?: string
  contact?: { name?: string; email?: string; userId?: string }
  assignedTo?: string
  tags?: string[]
  deviceInfo?: {
    os?: string; osVersion?: string; browser?: string; browserVersion?: string
    deviceModel?: string; screenSize?: string; language?: string; appVersion?: string
  }
  customData?: Record<string, unknown>
  createdAt?: string
}

interface Message {
  id: string
  comment: string
  type: string
  sender?: { name?: string; email?: string; type?: string }
  createdAt?: string
}

interface Article {
  id: string
  title: string
  content?: string
  collection?: string
  status?: string
  createdAt?: string
}

interface Collection {
  id: string
  title: string
  description?: string
}

interface SessionActivity {
  type: string
  data?: Record<string, unknown>
  date?: string
}

export default function SupportPage() {
  const params = useParams()
  const projectId = params.projectId as string
  const { selectedProject } = useSelectedProject()
  const isWeb = selectedProject?.storeType === 'web'

  const [activeTab, setActiveTab] = useState<Tab>('overview')
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isConfigured, setIsConfigured] = useState(false)

  // Overview state
  const [overview, setOverview] = useState<any>(null)
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [ticketFilter, setTicketFilter] = useState<TicketFilter>('ALL')
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [replyText, setReplyText] = useState('')
  const [sendingReply, setSendingReply] = useState(false)
  const [sessionActivities, setSessionActivities] = useState<SessionActivity[]>([])
  const [loadingActivities, setLoadingActivities] = useState(false)

  // Help Center state
  const [collections, setCollections] = useState<Collection[]>([])
  const [articles, setArticles] = useState<Article[]>([])
  const [selectedCollection, setSelectedCollection] = useState<string | null>(null)
  const [loadingArticles, setLoadingArticles] = useState(false)

  // AI Knowledge state
  const [syncingAI, setSyncingAI] = useState(false)
  const [aiSyncResult, setAiSyncResult] = useState<string | null>(null)

  const fetchOverview = useCallback(async () => {
    try {
      const res = await fetch(`/api/support/overview?projectId=${projectId}`)
      if (res.ok) {
        const data = await res.json()
        setOverview(data)
        setIsConfigured(true)
      } else if (res.status === 400) {
        setIsConfigured(false)
      }
    } catch {
      setError('Failed to load support overview')
    }
  }, [projectId])

  const fetchTickets = useCallback(async () => {
    try {
      const typeParam = ticketFilter !== 'ALL' ? `&type=${ticketFilter}` : ''
      const res = await fetch(`/api/support/tickets?projectId=${projectId}${typeParam}&limit=50`)
      if (res.ok) {
        const data = await res.json()
        setTickets(data.tickets || [])
      }
    } catch {
      // Tickets may not load if not configured
    }
  }, [projectId, ticketFilter])

  useEffect(() => {
    async function init() {
      setIsLoading(true)
      await fetchOverview()
      await fetchTickets()
      setIsLoading(false)
    }
    init()
  }, [fetchOverview, fetchTickets])

  const openTicket = async (ticket: Ticket) => {
    setSelectedTicket(ticket)
    setMessages([])
    setSessionActivities([])
    setLoadingMessages(true)

    try {
      const res = await fetch(`/api/support/tickets/${ticket.id}/messages?projectId=${projectId}`)
      if (res.ok) {
        const data = await res.json()
        setMessages(data.messages || [])
      }
    } catch { /* ignore */ }
    setLoadingMessages(false)

    // Load session activities if sessionId exists
    if (ticket.sessionId) {
      setLoadingActivities(true)
      try {
        const res = await fetch(`/api/support/sessions/${ticket.sessionId}/activities?projectId=${projectId}`)
        if (res.ok) {
          const data = await res.json()
          setSessionActivities(data.activities || [])
        }
      } catch { /* ignore */ }
      setLoadingActivities(false)
    }
  }

  const handleSendReply = async () => {
    if (!selectedTicket || !replyText.trim()) return
    setSendingReply(true)
    try {
      const res = await fetch(`/api/support/tickets/${selectedTicket.id}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, message: replyText }),
      })
      if (res.ok) {
        setReplyText('')
        // Refresh messages
        const msgRes = await fetch(`/api/support/tickets/${selectedTicket.id}/messages?projectId=${projectId}`)
        if (msgRes.ok) {
          const data = await msgRes.json()
          setMessages(data.messages || [])
        }
      }
    } catch { /* ignore */ }
    setSendingReply(false)
  }

  const fetchHelpCenter = async () => {
    setLoadingArticles(true)
    try {
      const [colRes, artRes] = await Promise.all([
        fetch(`/api/support/help-center/collections?projectId=${projectId}`),
        fetch(`/api/support/help-center/articles?projectId=${projectId}${selectedCollection ? `&collectionId=${selectedCollection}` : ''}`),
      ])
      if (colRes.ok) {
        const data = await colRes.json()
        setCollections(data.collections || [])
      }
      if (artRes.ok) {
        const data = await artRes.json()
        setArticles(data.articles || [])
      }
    } catch { /* ignore */ }
    setLoadingArticles(false)
  }

  const handleSyncAI = async () => {
    setSyncingAI(true)
    setAiSyncResult(null)
    try {
      const res = await fetch('/api/support/ai-content/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId }),
      })
      const data = await res.json()
      if (res.ok) {
        setAiSyncResult(`Synced ${data.fieldsSync} fields to Gleap AI`)
      } else {
        setAiSyncResult(data.error || 'Failed to sync')
      }
    } catch {
      setAiSyncResult('Failed to sync')
    }
    setSyncingAI(false)
  }

  const typeIcon = (type: string) => {
    switch (type) {
      case 'BUG': return <Bug className="w-3.5 h-3.5 text-red-400" />
      case 'FEATURE_REQUEST': return <Lightbulb className="w-3.5 h-3.5 text-amber-400" />
      default: return <HelpCircle className="w-3.5 h-3.5 text-blue-400" />
    }
  }

  const typeBadge = (type: string) => {
    const colors: Record<string, string> = {
      BUG: 'bg-red-500/10 text-red-400 border-red-500/20',
      FEATURE_REQUEST: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
      INQUIRY: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
    }
    return colors[type] || colors.INQUIRY
  }

  const statusBadge = (status: string) => {
    const colors: Record<string, string> = {
      OPEN: 'bg-green-500/10 text-green-400 border-green-500/20',
      DONE: 'bg-neutral-500/10 text-neutral-400 border-neutral-500/20',
      SNOOZED: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
    }
    return colors[status] || colors.OPEN
  }

  const priorityDot = (priority: string) => {
    const colors: Record<string, string> = { HIGH: 'bg-red-400', MEDIUM: 'bg-amber-400', LOW: 'bg-green-400' }
    return colors[priority] || 'bg-neutral-400'
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-6 h-6 animate-spin text-neutral-400" />
      </div>
    )
  }

  if (!isConfigured) {
    return (
      <div className="max-w-2xl mx-auto px-6 py-20">
        <div className="text-center space-y-4">
          <Headset className="w-12 h-12 text-teal-400 mx-auto" />
          <h2 className="text-xl font-semibold text-white">Set up Gleap Support</h2>
          <p className="text-neutral-400">
            Connect your Gleap account to view support tickets, manage your help center,
            and train the AI bot.
          </p>
          <Link
            href={`/projects/${projectId}/settings`}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium
                     bg-gradient-to-r from-teal-500 to-emerald-500 text-white
                     hover:opacity-90 transition-all"
          >
            <Settings className="w-4 h-4" />
            Configure in Settings
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-7xl mx-auto px-6 py-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Headset className="w-6 h-6 text-teal-400" />
          <h1 className="text-2xl font-bold text-white">Support</h1>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 rounded-xl bg-white/[0.03] border border-white/[0.06] w-fit">
        {([
          { id: 'overview' as Tab, label: 'Overview', icon: MessageSquare },
          { id: 'help-center' as Tab, label: 'Help Center', icon: BookOpen },
          { id: 'ai-knowledge' as Tab, label: 'AI Knowledge', icon: Brain },
        ]).map(tab => (
          <button
            key={tab.id}
            onClick={() => {
              setActiveTab(tab.id)
              if (tab.id === 'help-center') fetchHelpCenter()
            }}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all
              ${activeTab === tab.id
                ? 'bg-white/[0.08] text-white'
                : 'text-neutral-400 hover:text-white hover:bg-white/[0.04]'
              }`}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab 1: Overview */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          {/* Stats Cards */}
          {overview && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="p-4 rounded-xl bg-white/[0.02] border border-white/[0.08]">
                <div className="flex items-center gap-2 mb-1">
                  <MessageSquare className="w-4 h-4 text-teal-400" />
                  <span className="text-xs text-neutral-400">Open Tickets</span>
                </div>
                <p className="text-2xl font-bold text-white">{overview.openTickets ?? '-'}</p>
              </div>
              <div className="p-4 rounded-xl bg-white/[0.02] border border-white/[0.08]">
                <div className="flex items-center gap-2 mb-1">
                  <Clock className="w-4 h-4 text-blue-400" />
                  <span className="text-xs text-neutral-400">Avg Response Time</span>
                </div>
                <p className="text-2xl font-bold text-white">
                  {typeof overview.medianFirstResponseTime === 'number'
                    ? `${Math.round(overview.medianFirstResponseTime / 60)}m`
                    : '-'}
                </p>
              </div>
              <div className="p-4 rounded-xl bg-white/[0.02] border border-white/[0.08]">
                <div className="flex items-center gap-2 mb-1">
                  <Star className="w-4 h-4 text-amber-400" />
                  <span className="text-xs text-neutral-400">CSAT</span>
                </div>
                <p className="text-2xl font-bold text-white">
                  {typeof overview.conversationRatings === 'number'
                    ? `${overview.conversationRatings}%`
                    : '-'}
                </p>
              </div>
              <div className="p-4 rounded-xl bg-white/[0.02] border border-white/[0.08]">
                <div className="flex items-center gap-2 mb-1">
                  <TrendingUp className="w-4 h-4 text-green-400" />
                  <span className="text-xs text-neutral-400">New Tickets</span>
                </div>
                <p className="text-2xl font-bold text-white">
                  {typeof overview.newTicketsCount === 'number' ? overview.newTicketsCount : '-'}
                </p>
              </div>
            </div>
          )}

          {/* Filter Tabs */}
          <div className="flex gap-2">
            {(['ALL', 'BUG', 'FEATURE_REQUEST', 'INQUIRY'] as TicketFilter[]).map(filter => (
              <button
                key={filter}
                onClick={() => setTicketFilter(filter)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all
                  ${ticketFilter === filter
                    ? 'bg-teal-500/20 text-teal-300 border border-teal-500/30'
                    : 'text-neutral-400 hover:text-white bg-white/[0.03] border border-white/[0.06]'
                  }`}
              >
                {filter === 'ALL' ? 'All' : filter === 'BUG' ? 'Bugs' : filter === 'FEATURE_REQUEST' ? 'Features' : 'Inquiries'}
              </button>
            ))}
          </div>

          {/* Ticket List */}
          <div className="space-y-2">
            {tickets.length === 0 ? (
              <div className="text-center py-12 text-neutral-500">No tickets found</div>
            ) : (
              tickets.map(ticket => (
                <button
                  key={ticket.id}
                  onClick={() => openTicket(ticket)}
                  className="w-full flex items-center gap-4 p-4 rounded-xl bg-white/[0.02] border border-white/[0.08]
                           hover:bg-white/[0.04] transition-all text-left"
                >
                  {typeIcon(ticket.type)}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-white truncate">
                      {ticket.title || ticket.description?.slice(0, 80) || `Ticket #${ticket.id.slice(-6)}`}
                    </p>
                    <p className="text-xs text-neutral-500">
                      {ticket.contact?.name || ticket.contact?.email || 'Unknown'}
                      {ticket.createdAt && ` · ${new Date(ticket.createdAt).toLocaleDateString()}`}
                    </p>
                  </div>
                  <span className={`px-2 py-0.5 rounded-md text-[10px] font-medium border ${typeBadge(ticket.type)}`}>
                    {ticket.type === 'FEATURE_REQUEST' ? 'FEATURE' : ticket.type}
                  </span>
                  <span className={`px-2 py-0.5 rounded-md text-[10px] font-medium border ${statusBadge(ticket.status)}`}>
                    {ticket.status}
                  </span>
                  <div className={`w-2 h-2 rounded-full ${priorityDot(ticket.priority)}`} />
                  <ChevronRight className="w-4 h-4 text-neutral-600" />
                </button>
              ))
            )}
          </div>
        </div>
      )}

      {/* Tab 2: Help Center */}
      {activeTab === 'help-center' && (
        <div className="grid grid-cols-12 gap-6">
          {/* Collections sidebar */}
          <div className="col-span-3 space-y-2">
            <h3 className="text-sm font-medium text-neutral-400 mb-3">Collections</h3>
            <button
              onClick={() => { setSelectedCollection(null); fetchHelpCenter() }}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-all
                ${!selectedCollection ? 'bg-teal-500/20 text-teal-300' : 'text-neutral-400 hover:text-white hover:bg-white/[0.04]'}`}
            >
              All Articles
            </button>
            {collections.map(col => (
              <button
                key={col.id}
                onClick={() => { setSelectedCollection(col.id); fetchHelpCenter() }}
                className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-all
                  ${selectedCollection === col.id ? 'bg-teal-500/20 text-teal-300' : 'text-neutral-400 hover:text-white hover:bg-white/[0.04]'}`}
              >
                {col.title}
              </button>
            ))}
          </div>

          {/* Articles list */}
          <div className="col-span-9 space-y-2">
            <h3 className="text-sm font-medium text-neutral-400 mb-3">Articles</h3>
            {loadingArticles ? (
              <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-neutral-400" /></div>
            ) : articles.length === 0 ? (
              <div className="text-center py-12 text-neutral-500">No articles found</div>
            ) : (
              articles.map(article => (
                <div key={article.id} className="p-4 rounded-xl bg-white/[0.02] border border-white/[0.08]">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-medium text-white">{article.title}</h4>
                    <span className={`px-2 py-0.5 rounded-md text-[10px] font-medium border
                      ${article.status === 'published'
                        ? 'bg-green-500/10 text-green-400 border-green-500/20'
                        : 'bg-neutral-500/10 text-neutral-400 border-neutral-500/20'
                      }`}>
                      {article.status || 'published'}
                    </span>
                  </div>
                  {article.createdAt && (
                    <p className="text-xs text-neutral-500 mt-1">{new Date(article.createdAt).toLocaleDateString()}</p>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Tab 3: AI Knowledge */}
      {activeTab === 'ai-knowledge' && (
        <div className="space-y-6">
          {!isWeb && (
          <div className="p-6 rounded-xl bg-white/[0.02] border border-white/[0.08] space-y-4">
            <div className="flex items-center gap-3">
              <Brain className="w-5 h-5 text-purple-400" />
              <h3 className="text-lg font-semibold text-white">Sync App Metadata</h3>
            </div>
            <p className="text-sm text-neutral-400">
              Push your app's name, description, keywords, and release notes to Gleap's AI bot (Kai).
              This helps the AI accurately answer customer questions about your app.
            </p>
            <div className="flex items-center gap-3">
              <button
                onClick={handleSyncAI}
                disabled={syncingAI}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium
                         bg-gradient-to-r from-purple-500 to-violet-500 text-white
                         hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                {syncingAI ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> Syncing...</>
                ) : (
                  <><RefreshCw className="w-4 h-4" /> Sync App Metadata</>
                )}
              </button>
              {aiSyncResult && (
                <span className="text-sm text-neutral-400">{aiSyncResult}</span>
              )}
            </div>
          </div>
          )}

          <div className="p-6 rounded-xl bg-white/[0.02] border border-white/[0.08] space-y-4">
            <h3 className="text-sm font-medium text-neutral-400">How AI Knowledge Works</h3>
            <div className="space-y-3">
              {!isWeb && (
              <div className="flex gap-3">
                <div className="w-8 h-8 rounded-lg bg-teal-500/10 flex items-center justify-center flex-shrink-0">
                  <span className="text-xs font-bold text-teal-400">1</span>
                </div>
                <div>
                  <p className="text-sm font-medium text-white">Sync your metadata</p>
                  <p className="text-xs text-neutral-500">Click &quot;Sync App Metadata&quot; to push your latest app info to Gleap</p>
                </div>
              </div>
              )}
              <div className="flex gap-3">
                <div className="w-8 h-8 rounded-lg bg-teal-500/10 flex items-center justify-center flex-shrink-0">
                  <span className="text-xs font-bold text-teal-400">{isWeb ? '1' : '2'}</span>
                </div>
                <div>
                  <p className="text-sm font-medium text-white">Kai learns about your app</p>
                  <p className="text-xs text-neutral-500">Gleap&apos;s AI bot uses this data to answer customer questions accurately</p>
                </div>
              </div>
              <div className="flex gap-3">
                <div className="w-8 h-8 rounded-lg bg-teal-500/10 flex items-center justify-center flex-shrink-0">
                  <span className="text-xs font-bold text-teal-400">{isWeb ? '2' : '3'}</span>
                </div>
                <div>
                  <p className="text-sm font-medium text-white">Use MCP tools to train Kai</p>
                  <p className="text-xs text-neutral-500">Use <code className="px-1 py-0.5 rounded bg-white/[0.05] text-teal-300">sync_gleap_ai_knowledge</code> to push text knowledge, product info, and file references</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Ticket Detail Slide-over */}
      {selectedTicket && (
        <div className="fixed inset-y-0 right-0 w-full max-w-lg bg-[#0a0a0a] border-l border-white/[0.08] z-50 overflow-y-auto">
          <div className="p-6 space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {typeIcon(selectedTicket.type)}
                <span className={`px-2 py-0.5 rounded-md text-[10px] font-medium border ${typeBadge(selectedTicket.type)}`}>
                  {selectedTicket.type === 'FEATURE_REQUEST' ? 'FEATURE' : selectedTicket.type}
                </span>
                <span className={`px-2 py-0.5 rounded-md text-[10px] font-medium border ${statusBadge(selectedTicket.status)}`}>
                  {selectedTicket.status}
                </span>
              </div>
              <button onClick={() => setSelectedTicket(null)} className="p-1.5 rounded-lg hover:bg-white/[0.05] text-neutral-400">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div>
              <h2 className="text-lg font-semibold text-white">
                {selectedTicket.title || `Ticket #${selectedTicket.id.slice(-6)}`}
              </h2>
              {selectedTicket.description && (
                <p className="text-sm text-neutral-400 mt-1">{selectedTicket.description}</p>
              )}
            </div>

            {/* Device & Environment */}
            {selectedTicket.deviceInfo && Object.values(selectedTicket.deviceInfo).some(Boolean) && (
              <details className="group">
                <summary className="flex items-center gap-2 cursor-pointer text-sm font-medium text-neutral-300">
                  <Monitor className="w-4 h-4 text-teal-400" />
                  Device & Environment
                </summary>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  {selectedTicket.deviceInfo.os && (
                    <div className="flex items-center gap-2 text-xs">
                      <Smartphone className="w-3 h-3 text-neutral-500" />
                      <span className="text-neutral-500">OS:</span>
                      <span className="text-white">{selectedTicket.deviceInfo.os} {selectedTicket.deviceInfo.osVersion}</span>
                    </div>
                  )}
                  {selectedTicket.deviceInfo.browser && (
                    <div className="flex items-center gap-2 text-xs">
                      <Globe className="w-3 h-3 text-neutral-500" />
                      <span className="text-neutral-500">Browser:</span>
                      <span className="text-white">{selectedTicket.deviceInfo.browser}</span>
                    </div>
                  )}
                  {selectedTicket.deviceInfo.deviceModel && (
                    <div className="flex items-center gap-2 text-xs">
                      <Monitor className="w-3 h-3 text-neutral-500" />
                      <span className="text-neutral-500">Device:</span>
                      <span className="text-white">{selectedTicket.deviceInfo.deviceModel}</span>
                    </div>
                  )}
                  {selectedTicket.deviceInfo.appVersion && (
                    <div className="flex items-center gap-2 text-xs">
                      <Activity className="w-3 h-3 text-neutral-500" />
                      <span className="text-neutral-500">App:</span>
                      <span className="text-white">v{selectedTicket.deviceInfo.appVersion}</span>
                    </div>
                  )}
                  {selectedTicket.deviceInfo.screenSize && (
                    <div className="flex items-center gap-2 text-xs">
                      <Monitor className="w-3 h-3 text-neutral-500" />
                      <span className="text-neutral-500">Screen:</span>
                      <span className="text-white">{selectedTicket.deviceInfo.screenSize}</span>
                    </div>
                  )}
                  {selectedTicket.deviceInfo.language && (
                    <div className="flex items-center gap-2 text-xs">
                      <Globe className="w-3 h-3 text-neutral-500" />
                      <span className="text-neutral-500">Language:</span>
                      <span className="text-white">{selectedTicket.deviceInfo.language}</span>
                    </div>
                  )}
                </div>
              </details>
            )}

            {/* Custom Data */}
            {selectedTicket.customData && Object.keys(selectedTicket.customData).length > 0 && (
              <details className="group">
                <summary className="flex items-center gap-2 cursor-pointer text-sm font-medium text-neutral-300">
                  <Database className="w-4 h-4 text-purple-400" />
                  Custom Data
                </summary>
                <div className="mt-3 space-y-1">
                  {Object.entries(selectedTicket.customData).map(([key, value]) => (
                    <div key={key} className="flex justify-between text-xs">
                      <span className="text-neutral-500">{key}</span>
                      <span className="text-white">{String(value)}</span>
                    </div>
                  ))}
                </div>
              </details>
            )}

            {/* Activity Log */}
            {sessionActivities.length > 0 && (
              <details className="group">
                <summary className="flex items-center gap-2 cursor-pointer text-sm font-medium text-neutral-300">
                  <Terminal className="w-4 h-4 text-amber-400" />
                  Activity Log ({sessionActivities.length})
                </summary>
                <div className="mt-3 max-h-48 overflow-y-auto space-y-1">
                  {sessionActivities.slice(0, 50).map((activity, i) => (
                    <div key={i} className="flex items-start gap-2 text-xs">
                      <span className="text-neutral-600 w-16 flex-shrink-0">
                        {activity.date ? new Date(activity.date).toLocaleTimeString() : ''}
                      </span>
                      <span className="text-neutral-400">{activity.type}</span>
                      {activity.data && (
                        <span className="text-neutral-600 truncate">{JSON.stringify(activity.data).slice(0, 60)}</span>
                      )}
                    </div>
                  ))}
                </div>
              </details>
            )}

            {loadingActivities && (
              <div className="flex items-center gap-2 text-xs text-neutral-500">
                <Loader2 className="w-3 h-3 animate-spin" /> Loading diagnostics...
              </div>
            )}

            {/* Conversation */}
            <div className="space-y-3">
              <h3 className="text-sm font-medium text-neutral-300 flex items-center gap-2">
                <MessageSquare className="w-4 h-4" />
                Conversation
              </h3>
              {loadingMessages ? (
                <div className="flex justify-center py-4"><Loader2 className="w-4 h-4 animate-spin text-neutral-400" /></div>
              ) : messages.length === 0 ? (
                <p className="text-xs text-neutral-500">No messages yet</p>
              ) : (
                <div className="space-y-3">
                  {messages.map(msg => (
                    <div key={msg.id} className={`p-3 rounded-xl text-sm ${
                      msg.sender?.type === 'AGENT'
                        ? 'bg-teal-500/10 border border-teal-500/20 ml-4'
                        : 'bg-white/[0.03] border border-white/[0.06] mr-4'
                    }`}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-medium text-neutral-400">
                          {msg.sender?.name || (msg.sender?.type === 'AGENT' ? 'Support' : 'Customer')}
                        </span>
                        {msg.createdAt && (
                          <span className="text-[10px] text-neutral-600">{new Date(msg.createdAt).toLocaleString()}</span>
                        )}
                      </div>
                      <p className="text-white whitespace-pre-wrap">{msg.comment}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Reply Input */}
            <div className="space-y-2">
              <textarea
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                placeholder="Type a reply..."
                rows={3}
                className="w-full px-4 py-3 rounded-xl text-sm text-white
                         bg-black/40 border border-white/[0.08]
                         placeholder:text-neutral-600
                         focus:border-teal-500/50 focus:ring-1 focus:ring-teal-500/20
                         focus:outline-none transition-all resize-none"
              />
              <div className="flex gap-2">
                <button
                  onClick={handleSendReply}
                  disabled={!replyText.trim() || sendingReply}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium
                           bg-gradient-to-r from-teal-500 to-emerald-500 text-white
                           hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                >
                  {sendingReply ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  Send
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="fixed bottom-4 right-4 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-sm text-red-300">
          {error}
        </div>
      )}
    </div>
  )
}
