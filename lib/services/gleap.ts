/**
 * Gleap API v3 Service
 * Provides integration with Gleap for customer support: tickets, messages,
 * help center, AI content, sessions, and statistics
 */

const GLEAP_API_BASE = 'https://api.gleap.io/v3'

// ============ Types ============

export type GleapTicketType = 'BUG' | 'FEATURE_REQUEST' | 'INQUIRY'
export type GleapTicketStatus = 'OPEN' | 'DONE' | 'SNOOZED'
export type GleapTicketPriority = 'LOW' | 'MEDIUM' | 'HIGH'

export interface GleapTicket {
  id: string
  type: GleapTicketType
  status: GleapTicketStatus
  priority: GleapTicketPriority
  title?: string
  description?: string
  sessionId?: string
  contact?: {
    name?: string
    email?: string
    userId?: string
  }
  assignedTo?: string
  tags?: string[]
  customData?: Record<string, unknown>
  deviceInfo?: {
    os?: string
    osVersion?: string
    browser?: string
    browserVersion?: string
    deviceModel?: string
    screenSize?: string
    language?: string
    appVersion?: string
    buildNumber?: string
  }
  createdAt?: string
  updatedAt?: string
}

export interface GleapMessage {
  id: string
  ticket: string
  comment: string
  type: 'COMMENT' | 'NOTE' | 'SYSTEM'
  sender?: {
    name?: string
    email?: string
    type?: 'USER' | 'AGENT'
  }
  attachments?: Array<{
    url: string
    name?: string
    type?: string
  }>
  createdAt?: string
}

export interface GleapSession {
  id: string
  gleapId?: string
  userId?: string
  email?: string
  name?: string
  phone?: string
  avatar?: string
  companyId?: string
  companyName?: string
  deviceType?: string
  platform?: string
  lang?: string
  tags?: string[]
  customData?: Record<string, unknown>
  eventData?: Record<string, unknown>
  location?: {
    country?: string
    city?: string
    lat?: number
    lng?: number
  }
  sessions?: number
  value?: number
  feedbackCount?: number
  createdAt?: string
  lastActivity?: string
}

export interface GleapSessionActivity {
  type: string
  data?: Record<string, unknown>
  date?: string
}

export interface GleapCollection {
  id: string
  title: string
  description?: string
  iconUrl?: string
  parent?: string
  targetAudience?: string
  createdAt?: string
}

export interface GleapArticle {
  id: string
  title: string | Record<string, string>
  content?: string | Record<string, string>
  description?: string | Record<string, string>
  collection?: string
  helpcenterCollection?: string
  isDraft?: boolean
  status?: 'published' | 'draft'
  author?: string
  createdAt?: string
  updatedAt?: string
}

export interface GleapStatistic {
  chartType: string
  data: unknown
}

export interface GleapTicketFilters {
  type?: GleapTicketType
  status?: GleapTicketStatus
  priority?: GleapTicketPriority
  sort?: string
  limit?: number
  skip?: number
}

// ============ Helper Class ============

export class GleapHelper {
  private apiToken: string
  private gleapProjectId: string

  constructor(apiToken: string, gleapProjectId: string) {
    if (!apiToken) {
      throw new Error('Gleap API token is required')
    }
    if (!gleapProjectId) {
      throw new Error('Gleap project ID is required')
    }
    this.apiToken = apiToken
    this.gleapProjectId = gleapProjectId
  }

  private async makeRequest<T>(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    endpoint: string,
    body?: Record<string, any>,
    options?: { useProjectScope?: boolean }
  ): Promise<T> {
    // Project-scoped endpoints use https://api.gleap.io/projects/{projectId}/...
    // Standard endpoints use https://api.gleap.io/v3/...
    const baseUrl = options?.useProjectScope
      ? `https://api.gleap.io/projects/${this.gleapProjectId}`
      : GLEAP_API_BASE
    const url = `${baseUrl}${endpoint}`

    const headers: Record<string, string> = {
      'Authorization': `Bearer ${this.apiToken}`,
      'Project': this.gleapProjectId,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    }

    const fetchOptions: RequestInit = {
      method,
      headers,
    }

    if (body && method !== 'GET') {
      fetchOptions.body = JSON.stringify(body)
    }

    console.log(`[Gleap] ${method} ${url}`, body ? JSON.stringify(body) : '')

    const response = await fetch(url, fetchOptions)

    if (!response.ok) {
      const errorText = await response.text()
      const statusText = response.statusText || ''
      console.error(`[Gleap] Error ${response.status} ${statusText} for ${method} ${url}:`, errorText)
      console.error(`[Gleap] Request body was:`, body ? JSON.stringify(body) : 'none')
      let errorMessage = `Gleap API error (${response.status})`
      try {
        const errorJson = JSON.parse(errorText)
        errorMessage = errorJson.message || errorJson.error || errorJson.detail
          || `Gleap API error (${response.status}): ${JSON.stringify(errorJson)}`
      } catch {
        if (errorText.includes('<!doctype html>') || errorText.includes('<html')) {
          errorMessage = `Gleap returned HTML error (${response.status}) - endpoint may not exist. URL: ${url}`
        } else {
          errorMessage = errorText || `Gleap API error (${response.status} ${statusText})`
        }
      }
      throw new Error(errorMessage)
    }

    if (response.status === 204) {
      return {} as T
    }

    return response.json()
  }

  // ============ Tickets ============

  async getTickets(filters?: GleapTicketFilters): Promise<GleapTicket[]> {
    const params = new URLSearchParams()
    if (filters?.type) params.set('type', filters.type)
    if (filters?.status) params.set('status', filters.status)
    if (filters?.priority) params.set('priority', filters.priority)
    if (filters?.sort) params.set('sort', filters.sort)
    if (filters?.limit) params.set('limit', String(filters.limit))
    if (filters?.skip) params.set('skip', String(filters.skip))

    const query = params.toString()
    const result = await this.makeRequest<{ tickets: GleapTicket[] } | GleapTicket[]>(
      'GET',
      `/tickets${query ? `?${query}` : ''}`
    )
    return Array.isArray(result) ? result : result.tickets || []
  }

  async getTicket(ticketId: string): Promise<GleapTicket> {
    return this.makeRequest<GleapTicket>('GET', `/tickets/${ticketId}`)
  }

  async updateTicket(ticketId: string, updates: Partial<Pick<GleapTicket, 'status' | 'priority' | 'assignedTo' | 'tags'>>): Promise<GleapTicket> {
    return this.makeRequest<GleapTicket>('PUT', `/tickets/${ticketId}`, updates as Record<string, any>)
  }

  async archiveTicket(ticketId: string): Promise<void> {
    await this.makeRequest<void>('POST', `/tickets/${ticketId}/archive`)
  }

  async searchTickets(query: string): Promise<GleapTicket[]> {
    const result = await this.makeRequest<{ tickets: GleapTicket[] } | GleapTicket[]>(
      'GET',
      `/tickets/search?query=${encodeURIComponent(query)}`
    )
    return Array.isArray(result) ? result : result.tickets || []
  }

  async getTicketCount(filters?: Pick<GleapTicketFilters, 'type' | 'status' | 'priority'>): Promise<number> {
    const params = new URLSearchParams()
    if (filters?.type) params.set('type', filters.type)
    if (filters?.status) params.set('status', filters.status)
    if (filters?.priority) params.set('priority', filters.priority)

    const query = params.toString()
    const result = await this.makeRequest<{ count: number }>(
      'GET',
      `/tickets/ticketscount${query ? `?${query}` : ''}`
    )
    return result.count
  }

  // ============ Messages ============

  async getMessages(ticketId: string): Promise<GleapMessage[]> {
    const result = await this.makeRequest<{ messages: GleapMessage[] } | GleapMessage[]>(
      'GET',
      `/messages?ticket=${ticketId}`
    )
    return Array.isArray(result) ? result : result.messages || []
  }

  async sendMessage(ticketId: string, comment: string): Promise<GleapMessage> {
    return this.makeRequest<GleapMessage>('POST', '/messages', {
      ticket: ticketId,
      comment,
      type: 'COMMENT',
    })
  }

  async generateDraftReply(ticketId: string): Promise<{ draft: string }> {
    return this.makeRequest<{ draft: string }>(
      'POST',
      `/tickets/${ticketId}/generate-draft-reply`
    )
  }

  // ============ Sessions ============

  async getSession(sessionId: string): Promise<GleapSession> {
    return this.makeRequest<GleapSession>('GET', `/sessions/${sessionId}`)
  }

  async getSessionByUserId(userId: string): Promise<GleapSession> {
    return this.makeRequest<GleapSession>('GET', `/sessions/by-user-id/${userId}`)
  }

  async getSessionActivities(sessionId: string): Promise<GleapSessionActivity[]> {
    const result = await this.makeRequest<{ activities: GleapSessionActivity[] } | GleapSessionActivity[]>(
      'GET',
      `/sessions/${sessionId}/activities`
    )
    return Array.isArray(result) ? result : result.activities || []
  }

  // ============ Help Center ============

  async getCollections(): Promise<GleapCollection[]> {
    const result = await this.makeRequest<{ collections: GleapCollection[] } | GleapCollection[]>(
      'GET',
      '/helpcenter/collections'
    )
    return Array.isArray(result) ? result : result.collections || []
  }

  async getCollection(collectionId: string): Promise<GleapCollection> {
    return this.makeRequest<GleapCollection>('GET', `/helpcenter/collections/${collectionId}`)
  }

  async createCollection(data: { title: string; description?: string; iconUrl?: string; parent?: string }): Promise<GleapCollection> {
    return this.makeRequest<GleapCollection>('POST', '/helpcenter/collections', data)
  }

  async updateCollection(collectionId: string, data: Partial<{ title: string; description: string; iconUrl: string }>): Promise<GleapCollection> {
    return this.makeRequest<GleapCollection>('PUT', `/helpcenter/collections/${collectionId}`, data)
  }

  async deleteCollection(collectionId: string): Promise<void> {
    await this.makeRequest<void>('DELETE', `/helpcenter/collections/${collectionId}`)
  }

  async getArticles(collectionId?: string): Promise<GleapArticle[]> {
    if (!collectionId) {
      // Fetch all collections first, then get articles from each
      const collections = await this.getCollections()
      const allArticles: GleapArticle[] = []
      for (const col of collections) {
        const result = await this.makeRequest<{ articles: GleapArticle[] } | GleapArticle[]>(
          'GET',
          `/helpcenter/collections/${col.id}/articles`
        )
        const articles = Array.isArray(result) ? result : result.articles || []
        allArticles.push(...articles)
      }
      return allArticles
    }
    const result = await this.makeRequest<{ articles: GleapArticle[] } | GleapArticle[]>(
      'GET',
      `/helpcenter/collections/${collectionId}/articles`
    )
    return Array.isArray(result) ? result : result.articles || []
  }

  async getArticle(collectionId: string, articleId: string): Promise<GleapArticle> {
    return this.makeRequest<GleapArticle>('GET', `/helpcenter/collections/${collectionId}/articles/${articleId}`)
  }

  async createArticle(collectionId: string, data: { title: string; content: string; status?: 'published' | 'draft' }): Promise<GleapArticle> {
    // Official Gleap API schema: all fields are plain strings
    const body: Record<string, any> = {
      title: data.title,
      description: data.content.substring(0, 200),
      content: data.content,
      helpcenterCollection: collectionId,
      project: this.gleapProjectId,
      isDraft: data.status === 'draft',
      targetAudience: 'all',
    }
    return this.makeRequest<GleapArticle>('POST', `/helpcenter/collections/${collectionId}/articles`, body)
  }

  async updateArticle(collectionId: string, articleId: string, data: Partial<{ title: string; content: string; status: 'published' | 'draft' }>): Promise<GleapArticle> {
    const body: Record<string, any> = {}
    if (data.title !== undefined) body.title = data.title
    if (data.content !== undefined) body.content = data.content
    if (data.status !== undefined) body.isDraft = data.status === 'draft'
    return this.makeRequest<GleapArticle>('PUT', `/helpcenter/collections/${collectionId}/articles/${articleId}`, body)
  }

  async deleteArticle(collectionId: string, articleId: string): Promise<void> {
    await this.makeRequest<void>('DELETE', `/helpcenter/collections/${collectionId}/articles/${articleId}`)
  }

  async searchArticles(query: string): Promise<GleapArticle[]> {
    const result = await this.makeRequest<{ articles: GleapArticle[] } | GleapArticle[]>(
      'GET',
      `/helpcenter/search?term=${encodeURIComponent(query)}`
    )
    return Array.isArray(result) ? result : result.articles || []
  }

  // ============ AI Content ============

  async pushAIContent(content: { type: string; content: string; title?: string; contentId?: string; batchId?: string; readMoreUrl?: string; readMoreLabel?: string }): Promise<{ id: string }> {
    return this.makeRequest<{ id: string }>('POST', '/aicontent', {
      title: content.title || 'Knowledge Base Content',
      content: content.content,
      contentId: content.contentId || `content-${Date.now()}`,
      type: content.type,
      ...(content.batchId && { batchId: content.batchId }),
      ...(content.readMoreUrl && { readMoreUrl: content.readMoreUrl }),
      ...(content.readMoreLabel && { readMoreLabel: content.readMoreLabel }),
    })
  }

  async getAIContent(contentId: string): Promise<{ id: string; type: string; content: string; batchId?: string }> {
    return this.makeRequest<{ id: string; type: string; content: string; batchId?: string }>(
      'GET',
      `/aicontent/${contentId}`
    )
  }

  async deleteAIContent(contentId: string): Promise<void> {
    await this.makeRequest<void>('DELETE', `/aicontent/${contentId}`)
  }

  async deleteAIContentBatch(batchId: string): Promise<void> {
    await this.makeRequest<void>('DELETE', `/aicontent/batch/${batchId}`)
  }

  // ============ Statistics ============

  async getStatistic(chartType: string, options?: { from?: string; to?: string }): Promise<GleapStatistic> {
    const params = new URLSearchParams({ chartType })
    if (options?.from) params.set('from', options.from)
    if (options?.to) params.set('to', options.to)
    return this.makeRequest<GleapStatistic>('GET', `/statistics/facts?${params.toString()}`)
  }

  async getSupportOverview(): Promise<{
    openTickets: number
    medianFirstResponseTime: unknown
    medianCloseTime: unknown
    conversationRatings: unknown
    newTicketsCount: unknown
    ticketCloseCount: unknown
    warnings?: string[]
  }> {
    // Use allSettled to gracefully handle deprecated or unavailable chart types.
    // Chart type names that previously returned 409 (OPEN_TICKETS_COUNT, MEDIAN_CLOSE_TIME)
    // are fetched with fallback names and individual error tolerance.
    const chartTypes = [
      // Try current names first, with deprecated fallbacks
      { key: 'openTickets', names: ['openTicketsCount', 'OPEN_TICKETS_COUNT'] },
      { key: 'firstResponse', names: ['medianFirstResponseTime', 'MEDIAN_FIRST_RESPONSE_TIME'] },
      { key: 'closeTime', names: ['medianCloseTime', 'MEDIAN_CLOSE_TIME'] },
      { key: 'ratings', names: ['conversationRatings', 'CONVERSATION_RATINGS'] },
      { key: 'newTickets', names: ['newTicketsCount', 'NEW_TICKETS_COUNT'] },
      { key: 'closedTickets', names: ['ticketCloseCount', 'TICKET_CLOSE_COUNT'] },
    ]

    const warnings: string[] = []

    async function fetchWithFallback(helper: GleapHelper, entry: typeof chartTypes[0]): Promise<{ key: string; data: unknown }> {
      for (const name of entry.names) {
        try {
          const stat = await helper.getStatistic(name)
          return { key: entry.key, data: stat.data }
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error)
          // If it's a 409 (deprecated) or 400 (invalid), try the next name
          if (msg.includes('409') || msg.includes('400') || msg.includes('deprecated') || msg.includes('not found')) {
            continue
          }
          // For other errors, stop trying
          throw error
        }
      }
      // All names failed
      warnings.push(`Chart type ${entry.names.join('/')} is unavailable`)
      return { key: entry.key, data: null }
    }

    const results = await Promise.allSettled(
      chartTypes.map(entry => fetchWithFallback(this, entry))
    )

    const data: Record<string, unknown> = {}
    for (const result of results) {
      if (result.status === 'fulfilled') {
        data[result.value.key] = result.value.data
      } else {
        warnings.push(`Failed to fetch metric: ${result.reason?.message || 'unknown error'}`)
      }
    }

    return {
      openTickets: typeof data.openTickets === 'number' ? data.openTickets : 0,
      medianFirstResponseTime: data.firstResponse ?? null,
      medianCloseTime: data.closeTime ?? null,
      conversationRatings: data.ratings ?? null,
      newTicketsCount: data.newTickets ?? null,
      ticketCloseCount: data.closedTickets ?? null,
      ...(warnings.length > 0 ? { warnings } : {}),
    }
  }
}

// ============ Factory Function ============

/**
 * Get Gleap helper for a project
 */
export async function getGleapHelper(
  userId: string,
  projectId: string,
  orgId?: string
): Promise<GleapHelper | null> {
  // Guard against empty strings that cause Firestore "documentPath is not a valid resource path" errors
  if (!userId || !projectId) {
    console.error('[getGleapHelper] Missing userId or projectId:', { userId: !!userId, projectId: !!projectId })
    return null
  }
  if (orgId !== undefined && !orgId) {
    orgId = undefined
  }

  const { isInternalIntegrationUser } = await import('@/lib/features/internal-integrations.server')
  if (!await isInternalIntegrationUser(userId, orgId)) {
    return null
  }

  const { adminDb } = await import('@/lib/firebase/admin')

  const basePath = orgId
    ? adminDb.collection('organizations').doc(orgId).collection('projects').doc(projectId)
    : adminDb.collection('users').doc(userId).collection('projects').doc(projectId)

  const projectDoc = await basePath.get()
  if (!projectDoc.exists) {
    return null
  }

  const projectData = projectDoc.data()
  let gleapApiToken = projectData?.gleapApiToken
  let gleapProjectId = projectData?.gleapProjectId

  // If credentials not found, check linked project (iOS ↔ Android share Gleap)
  const linkedProjId = projectData?.linkedProjectId
  if ((!gleapApiToken || !gleapProjectId) && linkedProjId && typeof linkedProjId === 'string' && linkedProjId.trim()) {
    const linkedBasePath = orgId
      ? adminDb.collection('organizations').doc(orgId).collection('projects').doc(linkedProjId)
      : adminDb.collection('users').doc(userId).collection('projects').doc(linkedProjId)

    const linkedDoc = await linkedBasePath.get()
    if (linkedDoc.exists) {
      const linkedData = linkedDoc.data()
      gleapApiToken = gleapApiToken || linkedData?.gleapApiToken
      gleapProjectId = gleapProjectId || linkedData?.gleapProjectId
    }
  }

  if (!gleapApiToken || !gleapProjectId) {
    return null
  }

  return new GleapHelper(gleapApiToken, gleapProjectId)
}
