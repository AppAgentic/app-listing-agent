import { adminDb } from '../firebase/admin'
import { Timestamp } from 'firebase-admin/firestore'
import { AuditLogEntry } from '../firebase/firestore'

export enum AuditAction {
  // Projects
  PROJECT_CREATED = 'project.created',
  PROJECT_UPDATED = 'project.updated',
  PROJECT_DELETED = 'project.deleted',

  // Members
  MEMBER_ADDED = 'member.added',
  MEMBER_UPDATED = 'member.updated',
  MEMBER_REMOVED = 'member.removed',
  MEMBER_INVITED = 'member.invited',
  INVITE_REVOKED = 'member.invite_revoked',

  // Credentials
  CREDENTIALS_ADDED = 'credentials.added',
  CREDENTIALS_UPDATED = 'credentials.updated',
  CREDENTIALS_DELETED = 'credentials.deleted',
  CREDENTIALS_ACCESSED = 'credentials.accessed',

  // Settings
  SETTINGS_CHANGED = 'settings.changed',

  // Operations
  TRANSLATION_RUN = 'translation.run',
  UPLOAD_RUN = 'upload.run',
  SCREENSHOT_GENERATED = 'screenshot.generated',
  ICON_GENERATED = 'icon.generated'
}

export interface LogAuditEventParams {
  orgId: string
  action: AuditAction
  userId: string
  resourceType: 'project' | 'member' | 'credentials' | 'settings'
  resourceId: string
  metadata?: Record<string, unknown>
  ipAddress?: string
}

/**
 * Log an audit event
 */
export async function logAuditEvent(params: LogAuditEventParams): Promise<string> {
  const {
    orgId,
    action,
    userId,
    resourceType,
    resourceId,
    metadata = {},
    ipAddress = 'unknown'
  } = params

  // Get user email for logging
  let userEmail = 'unknown'
  try {
    const userDoc = await adminDb.collection('users').doc(userId).get()
    if (userDoc.exists) {
      userEmail = userDoc.data()?.email || 'unknown'
    }
  } catch {
    // Ignore errors getting email
  }

  const logEntry = {
    action,
    userId,
    userEmail,
    resourceType,
    resourceId,
    metadata,
    ipAddress,
    timestamp: Timestamp.now()
  } as unknown as AuditLogEntry

  const docRef = await adminDb
    .collection('organizations')
    .doc(orgId)
    .collection('auditLog')
    .add(logEntry)

  return docRef.id
}

export interface AuditLogFilter {
  userId?: string
  resourceType?: 'project' | 'member' | 'credentials' | 'settings'
  action?: AuditAction
  startDate?: Date
  endDate?: Date
}

export interface AuditLogEntryWithId extends AuditLogEntry {
  id: string
}

/**
 * Get audit log entries with optional filtering
 */
export async function getAuditLog(
  orgId: string,
  options: {
    limit?: number
    offset?: number
    filter?: AuditLogFilter
  } = {}
): Promise<AuditLogEntryWithId[]> {
  const { limit = 50, offset = 0, filter } = options

  let query = adminDb
    .collection('organizations')
    .doc(orgId)
    .collection('auditLog')
    .orderBy('timestamp', 'desc')

  if (filter?.userId) {
    query = query.where('userId', '==', filter.userId)
  }

  if (filter?.resourceType) {
    query = query.where('resourceType', '==', filter.resourceType)
  }

  if (filter?.action) {
    query = query.where('action', '==', filter.action)
  }

  if (filter?.startDate) {
    query = query.where('timestamp', '>=', Timestamp.fromDate(filter.startDate))
  }

  if (filter?.endDate) {
    query = query.where('timestamp', '<=', Timestamp.fromDate(filter.endDate))
  }

  // Apply pagination
  const snapshot = await query.limit(limit + offset).get()

  return snapshot.docs.slice(offset, offset + limit).map(doc => ({
    id: doc.id,
    ...doc.data() as AuditLogEntry
  }))
}

/**
 * Get audit log entry count
 */
export async function getAuditLogCount(
  orgId: string,
  filter?: AuditLogFilter
): Promise<number> {
  let query = adminDb
    .collection('organizations')
    .doc(orgId)
    .collection('auditLog') as FirebaseFirestore.Query

  if (filter?.userId) {
    query = query.where('userId', '==', filter.userId)
  }

  if (filter?.resourceType) {
    query = query.where('resourceType', '==', filter.resourceType)
  }

  if (filter?.action) {
    query = query.where('action', '==', filter.action)
  }

  const snapshot = await query.count().get()
  return snapshot.data().count
}

/**
 * Delete old audit log entries (for retention policy)
 */
export async function cleanupOldAuditLogs(
  orgId: string,
  retentionDays: number
): Promise<number> {
  const cutoffDate = new Date()
  cutoffDate.setDate(cutoffDate.getDate() - retentionDays)

  const oldLogs = await adminDb
    .collection('organizations')
    .doc(orgId)
    .collection('auditLog')
    .where('timestamp', '<', Timestamp.fromDate(cutoffDate))
    .limit(500) // Process in batches
    .get()

  if (oldLogs.empty) {
    return 0
  }

  const batch = adminDb.batch()
  for (const doc of oldLogs.docs) {
    batch.delete(doc.ref)
  }

  await batch.commit()
  return oldLogs.size
}

/**
 * Export audit log to JSON
 */
export async function exportAuditLog(
  orgId: string,
  filter?: AuditLogFilter
): Promise<AuditLogEntryWithId[]> {
  // Get all matching entries (up to 10000)
  return getAuditLog(orgId, { limit: 10000, filter })
}

/**
 * Get recent activity summary for dashboard
 */
export async function getRecentActivitySummary(
  orgId: string,
  days: number = 7
): Promise<{
  totalEvents: number
  byAction: Record<string, number>
  byUser: Record<string, number>
}> {
  const startDate = new Date()
  startDate.setDate(startDate.getDate() - days)

  const logs = await getAuditLog(orgId, {
    limit: 1000,
    filter: { startDate }
  })

  const byAction: Record<string, number> = {}
  const byUser: Record<string, number> = {}

  for (const log of logs) {
    byAction[log.action] = (byAction[log.action] || 0) + 1
    byUser[log.userEmail] = (byUser[log.userEmail] || 0) + 1
  }

  return {
    totalEvents: logs.length,
    byAction,
    byUser
  }
}
