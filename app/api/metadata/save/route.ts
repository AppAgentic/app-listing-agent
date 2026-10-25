import { readBoundedJson, RequestBodyLimitError } from '@/lib/api/bounded-body'
import { NextRequest } from 'next/server'
import { z } from 'zod'
import { authenticateRequest, errorResponse, unauthorizedResponse } from '@/lib/api/auth'
import { getProjectContext, hasContextPermission, getAccountContext, AccountContext } from '@/lib/org/context'
import { getSession } from '@/lib/auth/session'
import { adminDb } from '@/lib/firebase/admin'
import { logAuditEvent, AuditAction } from '@/lib/org/audit'
import { Timestamp } from 'firebase-admin/firestore'
import { handleAutoSync } from '@/lib/services/project-sync'
import type { LocalizedMetadata, MetadataHistoryEntry, MetadataSource } from '@/lib/firebase/firestore'

const localizedMetadataSchema = z.object({
  locale: z.string(),
  name: z.string().max(30).optional().default(''),
  subtitle: z.string().max(30).optional().default(''),
  privacyUrl: z.string().nullable().optional(),
  description: z.string().max(4000).optional().default(''),
  keywords: z.string().max(100).optional().default(''),
  whatsNew: z.string().max(4000).nullable().optional().default(''),
  marketingUrl: z.string().nullable().optional(),
  supportUrl: z.string().nullable().optional(),
  promotionalText: z.string().max(170).nullable().optional(),
  shortDescription: z.string().max(80).nullable().optional(),
  fullDescription: z.string().max(4000).nullable().optional(),
})

const requestSchema = z.object({
  projectId: z.string(),
  locales: z.record(z.string(), localizedMetadataSchema),
  source: z.enum(['manual_edit', 'ai_translation', 'rollback']).default('manual_edit'),
  sourceDetails: z.string().optional(),
  label: z.string().optional(),
  createHistoryEntry: z.boolean().default(true),
})

// Helper to get auth context from either API key or session
async function getAuthContext(request: NextRequest): Promise<{ context: AccountContext | null; error?: string }> {
  // First try API key / header-based auth
  const authHeader = request.headers.get('Authorization')
  if (authHeader) {
    const auth = await authenticateRequest(request)
    if (auth.authenticated && auth.context) {
      return { context: auth.context }
    }
    return { context: null, error: auth.error }
  }

  // Fallback to session-based auth (cookie-based)
  const session = await getSession()
  if (session) {
    const context = await getAccountContext(session.userId)
    if (context) {
      return { context }
    }
    return { context: null, error: 'User not found' }
  }

  return { context: null, error: 'Authentication required' }
}

export async function POST(request: NextRequest) {
  // Authenticate (supports both API key and session)
  const { context: authContext, error: authError } = await getAuthContext(request)
  if (!authContext) {
    return unauthorizedResponse(authError)
  }

  // Parse request
  let body
  try {
    body = requestSchema.parse(await readBoundedJson(request))
  } catch (error) {
    if (error instanceof RequestBodyLimitError) return Response.json({ error: error.message }, { status: 413 })
    if (error instanceof z.ZodError) {
      return errorResponse(`Validation error: ${error.issues.map(e => e.message).join(', ')}`)
    }
    return errorResponse('Invalid request body')
  }

  const { projectId, locales, source, sourceDetails, label, createHistoryEntry } = body

  // Get project context
  const projectContext = await getProjectContext(authContext.userId, projectId)
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
        .doc(authContext.userId)
        .collection('projects')
        .doc(projectId)

  try {
  const batch = adminDb.batch()
  const metadataCollection = basePath.collection('metadata')
  const now = Timestamp.now()

  // Get existing metadata for comparison
  const existingSnapshot = await metadataCollection.get()
  const existingMetadata: { [locale: string]: any } = {}
  for (const doc of existingSnapshot.docs) {
    existingMetadata[doc.id] = doc.data()
  }

  // Track what changed
  const localesModified: string[] = []
  const fieldsModified = new Set<string>()

  // Get project's primary locale for sync tracking
  const projectDoc = await basePath.get()
  const projectData = projectDoc.data()
  const primaryLocale = projectData?.primaryLocale || 'en-US'

  // Get primary locale metadata for tracking field hashes when translations are made
  const primaryMetadata = existingMetadata[primaryLocale]

  // Generate field hashes for primary locale (used to detect which fields changed since translation)
  const translatableFields = ['name', 'subtitle', 'description', 'keywords', 'whatsNew', 'promotionalText', 'shortDescription', 'fullDescription']
  const primaryFieldHashes: Record<string, string> = {}
  if (primaryMetadata) {
    for (const field of translatableFields) {
      const value = primaryMetadata[field]
      if (value) {
        primaryFieldHashes[field] = generateFieldHash(value)
      }
    }
  }

  // Update each locale
  for (const [locale, metadata] of Object.entries(locales)) {
    const docRef = metadataCollection.doc(locale)
    const existing = existingMetadata[locale]

    // Check what fields changed
    if (existing) {
      const metadataFields = ['name', 'subtitle', 'description', 'keywords', 'whatsNew', 'promotionalText', 'privacyUrl', 'marketingUrl', 'supportUrl', 'shortDescription', 'fullDescription']
      for (const field of metadataFields) {
        if ((metadata as any)[field] !== existing[field]) {
          fieldsModified.add(field)
        }
      }
    } else {
      fieldsModified.add('all')
    }

    if (!existing || JSON.stringify(metadata) !== JSON.stringify(existing)) {
      localesModified.push(locale)
    }

    // Generate new source hash
    const sourceHash = generateHash(metadata)

    // For AI translations of non-primary locales, store hashes of primary fields at translation time
    const isPrimaryLocale = locale === primaryLocale
    const shouldUpdatePrimaryHashes = source === 'ai_translation' && !isPrimaryLocale

    // Preserve existing primaryFieldHashes unless this is a new AI translation
    const existingPrimaryFieldHashes = existing?.primaryFieldHashes
    const finalPrimaryFieldHashes = shouldUpdatePrimaryHashes && Object.keys(primaryFieldHashes).length > 0
      ? primaryFieldHashes  // New AI translation - use new hashes
      : existingPrimaryFieldHashes  // Manual edit - preserve existing hashes

    batch.set(docRef, {
      ...metadata,
      sourceHash,
      lastModifiedAt: now,
      lastModifiedBy: authContext.userId,
      ...(finalPrimaryFieldHashes && { primaryFieldHashes: finalPrimaryFieldHashes }),
    })
  }

  // Delete any drafts for saved locales
  const draftsCollection = basePath.collection('drafts')
  for (const locale of Object.keys(locales)) {
    batch.delete(draftsCollection.doc(locale))
  }

  // Create history entry if requested and there were changes
  let historyVersion: number | null = null
  if (createHistoryEntry && localesModified.length > 0) {
    // Get all current metadata (including newly saved)
    const allMetadata: { [locale: string]: LocalizedMetadata } = { ...existingMetadata }
    for (const [locale, metadata] of Object.entries(locales)) {
      allMetadata[locale] = {
        ...metadata,
        sourceHash: generateHash(metadata),
        lastModifiedAt: now as any,
        lastModifiedBy: authContext.userId,
      } as LocalizedMetadata
    }

    // Get next version number
    const existingHistory = await basePath
      .collection('metadataHistory')
      .orderBy('version', 'desc')
      .limit(1)
      .get()

    const nextVersion = existingHistory.empty ? 1 : (existingHistory.docs[0].data().version || 0) + 1
    historyVersion = nextVersion

    const historyRef = basePath.collection('metadataHistory').doc()
    const historyEntry: MetadataHistoryEntry = {
      id: historyRef.id,
      locales: allMetadata,
      version: nextVersion,
      label: label || null,
      source: source as MetadataSource,
      ...(sourceDetails && { sourceDetails }),
      changesSummary: {
        localesModified,
        fieldsModified: Array.from(fieldsModified),
        description: generateChangeDescription(source, localesModified, Array.from(fieldsModified)),
      },
      createdAt: now as any,
      createdBy: authContext.userId,
    }

    batch.set(historyRef, historyEntry)
  }

  // Update project sync status
  batch.update(basePath, {
    syncStatus: 'local_changes',
    updatedAt: now,
  })

  await batch.commit()

  // Handle auto-sync to linked project (if configured)
  let autoSyncResult = null
  if (localesModified.length > 0) {
    for (const locale of localesModified) {
      const syncResult = await handleAutoSync(basePath, locale, Array.from(fieldsModified))
      if (syncResult) {
        autoSyncResult = syncResult
      }
    }
  }

  // Log audit event
  if (projectContext.type === 'organization' && projectContext.orgId) {
    await logAuditEvent({
      orgId: projectContext.orgId,
      action: AuditAction.PROJECT_UPDATED,
      userId: authContext.userId,
      resourceType: 'project',
      resourceId: projectId,
      metadata: {
        action: 'metadata_save',
        source,
        localesModified,
        fieldsModified: Array.from(fieldsModified),
        historyVersion,
        autoSynced: autoSyncResult?.success || false,
      },
    })
  }

  return Response.json({
    success: true,
    localesSaved: Object.keys(locales).length,
    localesModified: localesModified.length,
    historyVersion,
    autoSync: autoSyncResult ? {
      triggered: true,
      success: autoSyncResult.success,
      synced: autoSyncResult.synced,
    } : null,
  })
  } catch (error) {
    console.error('Error saving metadata:', error)
    return errorResponse(
      error instanceof Error ? error.message : 'Failed to save metadata',
      500
    )
  }
}

function generateHash(data: Record<string, unknown>): string {
  const str = JSON.stringify(data, Object.keys(data).sort())
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash
  }
  return Math.abs(hash).toString(36)
}

function generateFieldHash(value: string): string {
  let hash = 0
  for (let i = 0; i < value.length; i++) {
    const char = value.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash
  }
  return Math.abs(hash).toString(36)
}

function generateChangeDescription(
  source: string,
  localesModified: string[],
  fieldsModified: string[]
): string {
  const localeCount = localesModified.length
  const localeText = localeCount === 1 ? `${localesModified[0]}` : `${localeCount} locales`

  switch (source) {
    case 'manual_edit':
      return `Manual edit of ${localeText}`
    case 'ai_translation':
      return `AI translation for ${localeText}`
    case 'rollback':
      return `Rollback for ${localeText}`
    default:
      return `Updated ${localeText}`
  }
}
