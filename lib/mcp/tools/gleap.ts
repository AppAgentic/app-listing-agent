/**
 * Gleap MCP Tools
 * Provides MCP tools for customer support: tickets, messages, sessions,
 * help center, AI knowledge, and statistics
 */

import { AccountContext, getProjectContext } from '@/lib/org/context'
import {
  getGleapHelper,
  type GleapTicket,
  type GleapTicketType,
  type GleapTicketStatus,
  type GleapTicketPriority,
  type GleapMessage,
  type GleapSession,
  type GleapSessionActivity,
  type GleapArticle,
  type GleapCollection,
} from '@/lib/services/gleap'

// ============ Shared Helper ============

async function getHelper(context: AccountContext, projectId: string) {
  const projectContext = await getProjectContext(context.userId, projectId)
  if (!projectContext) {
    return { error: 'Project not found' as const }
  }

  const helper = await getGleapHelper(context.userId, projectId, projectContext.orgId)
  if (!helper) {
    return { error: 'Gleap not configured for this project. Add Gleap API token and project ID in project settings.' as const }
  }

  return { helper }
}

// ============ List Tickets ============

export interface ListGleapTicketsParams {
  projectId: string
  type?: GleapTicketType
  status?: GleapTicketStatus
  priority?: GleapTicketPriority
  sort?: string
  limit?: number
  skip?: number
}

export interface ListGleapTicketsResult {
  success: boolean
  tickets?: GleapTicket[]
  error?: string
}

export async function listGleapTickets(
  params: ListGleapTicketsParams,
  context: AccountContext
): Promise<ListGleapTicketsResult> {
  const { projectId, ...filters } = params
  const result = await getHelper(context, projectId)
  if ('error' in result) return { success: false, error: result.error }

  try {
    const tickets = await result.helper.getTickets(filters)
    return { success: true, tickets }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to list tickets' }
  }
}

// ============ Get Ticket ============

export interface GetGleapTicketParams {
  projectId: string
  ticketId: string
}

export interface GetGleapTicketResult {
  success: boolean
  ticket?: GleapTicket
  error?: string
}

export async function getGleapTicket(
  params: GetGleapTicketParams,
  context: AccountContext
): Promise<GetGleapTicketResult> {
  const { projectId, ticketId } = params
  const result = await getHelper(context, projectId)
  if ('error' in result) return { success: false, error: result.error }

  try {
    const ticket = await result.helper.getTicket(ticketId)
    return { success: true, ticket }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to get ticket' }
  }
}

// ============ Search Tickets ============

export interface SearchGleapTicketsParams {
  projectId: string
  query: string
}

export interface SearchGleapTicketsResult {
  success: boolean
  tickets?: GleapTicket[]
  error?: string
}

export async function searchGleapTickets(
  params: SearchGleapTicketsParams,
  context: AccountContext
): Promise<SearchGleapTicketsResult> {
  const { projectId, query } = params
  const result = await getHelper(context, projectId)
  if ('error' in result) return { success: false, error: result.error }

  try {
    const tickets = await result.helper.searchTickets(query)
    return { success: true, tickets }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to search tickets' }
  }
}

// ============ Get Messages ============

export interface GetGleapMessagesParams {
  projectId: string
  ticketId: string
}

export interface GetGleapMessagesResult {
  success: boolean
  messages?: GleapMessage[]
  error?: string
}

export async function getGleapMessages(
  params: GetGleapMessagesParams,
  context: AccountContext
): Promise<GetGleapMessagesResult> {
  const { projectId, ticketId } = params
  const result = await getHelper(context, projectId)
  if ('error' in result) return { success: false, error: result.error }

  try {
    const messages = await result.helper.getMessages(ticketId)
    return { success: true, messages }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to get messages' }
  }
}

// ============ Draft Reply ============

export interface DraftGleapReplyParams {
  projectId: string
  ticketId: string
}

export interface DraftGleapReplyResult {
  success: boolean
  draft?: string
  ticketId?: string
  confirmationRequired?: true
  error?: string
}

export async function draftGleapReply(
  params: DraftGleapReplyParams,
  context: AccountContext
): Promise<DraftGleapReplyResult> {
  const { projectId, ticketId } = params
  const result = await getHelper(context, projectId)
  if ('error' in result) return { success: false, error: result.error }

  try {
    const draftResult = await result.helper.generateDraftReply(ticketId)
    return {
      success: true,
      draft: draftResult.draft,
      ticketId,
      confirmationRequired: true,
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to generate draft reply' }
  }
}

// ============ Send Reply ============

export interface SendGleapReplyParams {
  projectId: string
  ticketId: string
  message: string
}

export interface SendGleapReplyResult {
  success: boolean
  messageId?: string
  error?: string
}

export async function sendGleapReply(
  params: SendGleapReplyParams,
  context: AccountContext
): Promise<SendGleapReplyResult> {
  const { projectId, ticketId, message } = params
  const result = await getHelper(context, projectId)
  if ('error' in result) return { success: false, error: result.error }

  try {
    const sent = await result.helper.sendMessage(ticketId, message)
    return { success: true, messageId: sent.id }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to send reply' }
  }
}

// ============ Update Ticket ============

export interface UpdateGleapTicketParams {
  projectId: string
  ticketId: string
  status?: GleapTicketStatus
  priority?: GleapTicketPriority
  assignedTo?: string
  tags?: string[]
}

export interface UpdateGleapTicketResult {
  success: boolean
  ticket?: GleapTicket
  error?: string
}

export async function updateGleapTicket(
  params: UpdateGleapTicketParams,
  context: AccountContext
): Promise<UpdateGleapTicketResult> {
  const { projectId, ticketId, ...updates } = params
  const result = await getHelper(context, projectId)
  if ('error' in result) return { success: false, error: result.error }

  try {
    const ticket = await result.helper.updateTicket(ticketId, updates)
    return { success: true, ticket }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to update ticket' }
  }
}

// ============ Get Session ============

export interface GetGleapSessionParams {
  projectId: string
  sessionId?: string
  userId?: string
}

export interface GetGleapSessionResult {
  success: boolean
  session?: GleapSession
  error?: string
}

export async function getGleapSession(
  params: GetGleapSessionParams,
  context: AccountContext
): Promise<GetGleapSessionResult> {
  const { projectId, sessionId, userId } = params

  if (!sessionId && !userId) {
    return { success: false, error: 'Either sessionId or userId is required' }
  }

  const result = await getHelper(context, projectId)
  if ('error' in result) return { success: false, error: result.error }

  try {
    const session = sessionId
      ? await result.helper.getSession(sessionId)
      : await result.helper.getSessionByUserId(userId!)
    return { success: true, session }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to get session' }
  }
}

// ============ Get Session Activities ============

export interface GetGleapSessionActivitiesParams {
  projectId: string
  sessionId: string
}

export interface GetGleapSessionActivitiesResult {
  success: boolean
  activities?: GleapSessionActivity[]
  error?: string
}

export async function getGleapSessionActivities(
  params: GetGleapSessionActivitiesParams,
  context: AccountContext
): Promise<GetGleapSessionActivitiesResult> {
  const { projectId, sessionId } = params
  const result = await getHelper(context, projectId)
  if ('error' in result) return { success: false, error: result.error }

  try {
    const activities = await result.helper.getSessionActivities(sessionId)
    return { success: true, activities }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to get session activities' }
  }
}

// ============ Create Help Collection ============

export interface CreateGleapCollectionParams {
  projectId: string
  title: string
  description?: string
  iconUrl?: string
  parent?: string
}

export interface CreateGleapCollectionResult {
  success: boolean
  collection?: GleapCollection
  error?: string
}

export async function createGleapCollection(
  params: CreateGleapCollectionParams,
  context: AccountContext
): Promise<CreateGleapCollectionResult> {
  const { projectId, title, description, iconUrl, parent } = params
  const result = await getHelper(context, projectId)
  if ('error' in result) return { success: false, error: result.error }

  try {
    const collection = await result.helper.createCollection({ title, description, iconUrl, parent })
    return { success: true, collection }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to create collection' }
  }
}

// ============ Delete Help Collection ============

export interface DeleteGleapCollectionParams {
  projectId: string
  collectionId: string
}

export interface DeleteGleapCollectionResult {
  success: boolean
  error?: string
}

export async function deleteGleapCollection(
  params: DeleteGleapCollectionParams,
  context: AccountContext
): Promise<DeleteGleapCollectionResult> {
  const { projectId, collectionId } = params
  const result = await getHelper(context, projectId)
  if ('error' in result) return { success: false, error: result.error }

  try {
    await result.helper.deleteCollection(collectionId)
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to delete collection' }
  }
}

// ============ Delete Help Article ============

export interface DeleteGleapHelpArticleParams {
  projectId: string
  collectionId: string
  articleId: string
}

export interface DeleteGleapHelpArticleResult {
  success: boolean
  error?: string
}

export async function deleteGleapHelpArticle(
  params: DeleteGleapHelpArticleParams,
  context: AccountContext
): Promise<DeleteGleapHelpArticleResult> {
  const { projectId, collectionId, articleId } = params
  const result = await getHelper(context, projectId)
  if ('error' in result) return { success: false, error: result.error }

  try {
    await result.helper.deleteArticle(collectionId, articleId)
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to delete article' }
  }
}

// ============ Search Help Articles ============

export interface SearchGleapHelpArticlesParams {
  projectId: string
  query: string
}

export interface SearchGleapHelpArticlesResult {
  success: boolean
  articles?: GleapArticle[]
  error?: string
}

export async function searchGleapHelpArticles(
  params: SearchGleapHelpArticlesParams,
  context: AccountContext
): Promise<SearchGleapHelpArticlesResult> {
  const { projectId, query } = params
  const result = await getHelper(context, projectId)
  if ('error' in result) return { success: false, error: result.error }

  try {
    const articles = await result.helper.searchArticles(query)
    return { success: true, articles }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to search articles' }
  }
}

// ============ List Help Articles ============

export interface ListGleapHelpArticlesParams {
  projectId: string
  collectionId?: string
}

export interface ListGleapHelpArticlesResult {
  success: boolean
  articles?: GleapArticle[]
  collections?: GleapCollection[]
  error?: string
}

export async function listGleapHelpArticles(
  params: ListGleapHelpArticlesParams,
  context: AccountContext
): Promise<ListGleapHelpArticlesResult> {
  const { projectId, collectionId } = params
  const result = await getHelper(context, projectId)
  if ('error' in result) return { success: false, error: result.error }

  try {
    const [articles, collections] = await Promise.all([
      result.helper.getArticles(collectionId),
      result.helper.getCollections(),
    ])
    return { success: true, articles, collections }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to list help articles' }
  }
}

// ============ Create Help Article ============

export interface CreateGleapHelpArticleParams {
  projectId: string
  title: string
  content: string
  collectionId?: string
  status?: 'published' | 'draft'
}

export interface CreateGleapHelpArticleResult {
  success: boolean
  article?: GleapArticle
  error?: string
}

export async function createGleapHelpArticle(
  params: CreateGleapHelpArticleParams,
  context: AccountContext
): Promise<CreateGleapHelpArticleResult> {
  const { projectId, title, content, collectionId, status } = params
  const result = await getHelper(context, projectId)
  if ('error' in result) return { success: false, error: result.error }

  if (!collectionId) {
    return { success: false, error: 'collectionId is required to create an article' }
  }

  try {
    const article = await result.helper.createArticle(collectionId, {
      title,
      content,
      status: status || 'published',
    })
    return { success: true, article }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to create help article' }
  }
}

// ============ Update Help Article ============

export interface UpdateGleapHelpArticleParams {
  projectId: string
  collectionId: string
  articleId: string
  title?: string
  content?: string
  status?: 'published' | 'draft'
}

export interface UpdateGleapHelpArticleResult {
  success: boolean
  article?: GleapArticle
  error?: string
}

export async function updateGleapHelpArticle(
  params: UpdateGleapHelpArticleParams,
  context: AccountContext
): Promise<UpdateGleapHelpArticleResult> {
  const { projectId, collectionId, articleId, ...updates } = params
  const result = await getHelper(context, projectId)
  if ('error' in result) return { success: false, error: result.error }

  try {
    const article = await result.helper.updateArticle(collectionId, articleId, updates)
    return { success: true, article }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to update help article' }
  }
}

// ============ Sync AI Knowledge ============

export interface SyncGleapAIKnowledgeParams {
  projectId: string
  content: string
  type: 'text' | 'file' | 'product'
  batchId?: string
}

export interface SyncGleapAIKnowledgeResult {
  success: boolean
  contentId?: string
  error?: string
}

export async function syncGleapAIKnowledge(
  params: SyncGleapAIKnowledgeParams,
  context: AccountContext
): Promise<SyncGleapAIKnowledgeResult> {
  const { projectId, content, type, batchId } = params
  const result = await getHelper(context, projectId)
  if ('error' in result) return { success: false, error: result.error }

  try {
    const aiContent = await result.helper.pushAIContent({ type, content, batchId })
    return { success: true, contentId: aiContent.id }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to sync AI knowledge' }
  }
}

// ============ Get Statistics ============

export type GleapMetricType =
  | 'NEW_TICKETS_COUNT'
  | 'TICKET_CLOSE_COUNT'
  | 'MEDIAN_FIRST_RESPONSE_TIME'
  | 'MEDIAN_CLOSE_TIME'
  | 'CONVERSATION_RATINGS'
  | 'OPEN_TICKETS_COUNT'
  // Newer Gleap API chart type names (case-sensitive)
  | 'newTicketsCount'
  | 'ticketCloseCount'
  | 'medianFirstResponseTime'
  | 'medianCloseTime'
  | 'conversationRatings'
  | 'openTicketsCount'

export interface GetGleapStatisticsParams {
  projectId: string
  metric: GleapMetricType
}

export interface GetGleapStatisticsResult {
  success: boolean
  metric?: string
  data?: unknown
  error?: string
}

export async function getGleapStatistics(
  params: GetGleapStatisticsParams,
  context: AccountContext
): Promise<GetGleapStatisticsResult> {
  const { projectId, metric } = params
  const result = await getHelper(context, projectId)
  if ('error' in result) return { success: false, error: result.error }

  try {
    const stat = await result.helper.getStatistic(metric)
    return { success: true, metric, data: stat.data }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to get statistics' }
  }
}

// ============ Get Support Overview ============

export interface GetGleapSupportOverviewParams {
  projectId: string
}

export interface GetGleapSupportOverviewResult {
  success: boolean
  overview?: {
    openTickets: number
    medianFirstResponseTime: unknown
    medianCloseTime: unknown
    conversationRatings: unknown
    newTicketsCount: unknown
    ticketCloseCount: unknown
    warnings?: string[]
  }
  error?: string
}

export async function getGleapSupportOverview(
  params: GetGleapSupportOverviewParams,
  context: AccountContext
): Promise<GetGleapSupportOverviewResult> {
  const { projectId } = params
  const result = await getHelper(context, projectId)
  if ('error' in result) return { success: false, error: result.error }

  try {
    const overview = await result.helper.getSupportOverview()
    return { success: true, overview }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to get support overview' }
  }
}
