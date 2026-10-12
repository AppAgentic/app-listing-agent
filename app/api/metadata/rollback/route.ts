import { NextRequest } from 'next/server'
import { z } from 'zod'
import { authenticateRequest, errorResponse, unauthorizedResponse } from '@/lib/api/auth'
import { getProjectContext, hasContextPermission } from '@/lib/org/context'
import { adminDb } from '@/lib/firebase/admin'
import { logAuditEvent, AuditAction } from '@/lib/org/audit'
import { Timestamp } from 'firebase-admin/firestore'
import type { LocalizedMetadata, MetadataHistoryEntry } from '@/lib/firebase/firestore'

const requestSchema = z.object({
  projectId: z.string(),
  historyId: z.string(),
})

export async function POST(request: NextRequest) {
  // Authenticate
  const auth = await authenticateRequest(request)
  if (!auth.authenticated || !auth.context) {
    return unauthorizedResponse(auth.error)
  }

  // Parse request
  let body
  try {
    body = requestSchema.parse(await request.json())
  } catch (error) {
    return errorResponse('Invalid request body')
  }

  const { projectId, historyId } = body

  // Get project context
  const projectContext = await getProjectContext(auth.context.userId, projectId)
  if (!projectContext) {
    return errorResponse('Project not found', 404)
  }

  // Check permission
  if (!hasContextPermission(projectContext, 'canCreateProjects')) {
    return errorResponse('Permission denied', 403)
  }

  // Get base path for this project
  const basePath = projectContext.type === 'organization' && projectContext.orgId
    ? adminDb
        .collection('organizations')
        .doc(projectContext.orgId)
        .collection('projects')
        .doc(projectId)
    : adminDb
        .collection('users')
        .doc(auth.context.userId)
        .collection('projects')
        .doc(projectId)

  // Get the history entry to rollback to
  const historyDoc = await basePath.collection('metadataHistory').doc(historyId).get()
  if (!historyDoc.exists) {
    return errorResponse('History entry not found', 404)
  }

  const historyEntry = historyDoc.data() as MetadataHistoryEntry
  const rollbackLocales = historyEntry.locales

  if (!rollbackLocales || Object.keys(rollbackLocales).length === 0) {
    return errorResponse('History entry has no locales data', 400)
  }

  const batch = adminDb.batch()
  const metadataCollection = basePath.collection('metadata')
  const now = Timestamp.now()

  // Restore each locale from the history entry
  for (const [locale, metadata] of Object.entries(rollbackLocales)) {
    const docRef = metadataCollection.doc(locale)
    batch.set(docRef, {
      ...metadata,
      lastModifiedAt: now,
      lastModifiedBy: auth.context.userId,
    })
  }

  // Get current metadata for the new history entry
  const currentSnapshot = await metadataCollection.get()
  const allMetadata: { [locale: string]: LocalizedMetadata } = {}

  // Start with rollback data
  for (const [locale, metadata] of Object.entries(rollbackLocales)) {
    allMetadata[locale] = {
      ...metadata,
      lastModifiedAt: now as any,
      lastModifiedBy: auth.context.userId,
    } as LocalizedMetadata
  }

  // Add any locales that weren't in the rollback
  for (const doc of currentSnapshot.docs) {
    if (!allMetadata[doc.id]) {
      allMetadata[doc.id] = doc.data() as LocalizedMetadata
    }
  }

  // Get next version number
  const existingHistory = await basePath
    .collection('metadataHistory')
    .orderBy('version', 'desc')
    .limit(1)
    .get()

  const newVersion = existingHistory.empty ? 1 : (existingHistory.docs[0].data().version || 0) + 1

  // Create new history entry for the rollback
  const newHistoryRef = basePath.collection('metadataHistory').doc()
  const newHistoryEntry: MetadataHistoryEntry = {
    id: newHistoryRef.id,
    locales: allMetadata,
    version: newVersion,
    label: null,
    source: 'rollback',
    sourceDetails: `Rolled back to version ${historyEntry.version}`,
    changesSummary: {
      localesModified: Object.keys(rollbackLocales),
      fieldsModified: ['all'],
      description: `Rolled back ${Object.keys(rollbackLocales).length} locales to version ${historyEntry.version}`,
    },
    createdAt: now as any,
    createdBy: auth.context.userId,
  }

  batch.set(newHistoryRef, newHistoryEntry)

  // Update project sync status
  batch.update(basePath, {
    syncStatus: 'local_changes',
    updatedAt: now,
  })

  await batch.commit()

  // Log audit event
  if (projectContext.type === 'organization' && projectContext.orgId) {
    await logAuditEvent({
      orgId: projectContext.orgId,
      action: AuditAction.PROJECT_UPDATED,
      userId: auth.context.userId,
      resourceType: 'project',
      resourceId: projectId,
      metadata: {
        action: 'metadata_rollback',
        rolledBackToVersion: historyEntry.version,
        newVersion,
        localesAffected: Object.keys(rollbackLocales).length,
      },
    })
  }

  return Response.json({
    success: true,
    rolledBackToVersion: historyEntry.version,
    newVersion,
    localesRestored: Object.keys(rollbackLocales).length,
  })
}
