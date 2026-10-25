import { readBoundedJson, RequestBodyLimitError } from '@/lib/api/bounded-body'
import { NextRequest } from 'next/server'
import { z } from 'zod'
import {
  authenticateRequest,
  errorResponse,
  unauthorizedResponse,
  successResponse,
  validationErrorResponse,
  forbiddenResponse,
} from '@/lib/api/auth'
import { getSession } from '@/lib/auth/session'
import { adminDb } from '@/lib/firebase/admin'
import { Timestamp } from 'firebase-admin/firestore'
import { createReservationErrorResponse, refundUsage, reserveUsage, settleUsage } from '@/lib/api/usage'
import { hasContextPermission, AccountContext, getAccountContext } from '@/lib/org/context'
import type { Project, MetadataSyncStatus, StoreType, LinkConfiguration, SharedMetadataField } from '@/lib/firebase/firestore'
import { randomUUID } from 'node:crypto'

async function getAuthContext(request: NextRequest): Promise<{ context: AccountContext | null; error?: string }> {
  const authHeader = request.headers.get('Authorization')
  if (authHeader) {
    const auth = await authenticateRequest(request)
    if (auth.authenticated && auth.context) {
      return { context: auth.context }
    }
    return { context: null, error: auth.error }
  }

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

const createPairSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  appStoreAppId: z.string().nullable().optional(),
  playStorePackage: z.string().nullable().optional(),
  primaryLocale: z.string().default('en-US'),
  enabledLocales: z.array(z.string()).default(['en-US']),
})

export async function POST(request: NextRequest) {
  const { context, error } = await getAuthContext(request)
  if (!context) {
    return unauthorizedResponse(error)
  }

  if (context.type === 'organization' && !hasContextPermission(context, 'canCreateProjects')) {
    return forbiddenResponse('You do not have permission to create projects in this organization.')
  }

  let body
  try {
    body = createPairSchema.parse(await readBoundedJson(request))
  } catch (error) {
    if (error instanceof RequestBodyLimitError) return Response.json({ error: error.message }, { status: 413 })
    if (error instanceof z.ZodError) {
      return validationErrorResponse(
        error.issues[0]?.message || 'Invalid request body',
        { errors: error.issues }
      )
    }
    return validationErrorResponse('Invalid request body')
  }

  const { name, appStoreAppId, playStorePackage, primaryLocale, enabledLocales } = body

  const operationId = `create-project-pair:${request.headers.get('idempotency-key')?.trim() || randomUUID()}`
  const reservation = await reserveUsage(context, {
    operationId,
    usageType: 'apps',
    units: 2,
    metadata: { route: 'projects/create-pair' },
  })
  if (!reservation.allowed) return createReservationErrorResponse(reservation)
  if (reservation.replayed) return errorResponse('This project-pair operation was already processed', 409)

  const basePath = context.orgId
    ? adminDb.collection('organizations').doc(context.orgId).collection('projects')
    : adminDb.collection('users').doc(context.userId).collection('projects')

  const now = Timestamp.now()

  // Pre-generate document references so we can cross-link in the batch
  const iosRef = basePath.doc()
  const androidRef = basePath.doc()

  const resolvedLocales = enabledLocales.includes(primaryLocale)
    ? enabledLocales
    : [primaryLocale, ...enabledLocales]

  const defaultLinkConfig: LinkConfiguration = {
    syncMode: 'manual',
    shareMetadata: true,
    shareScreenshots: true,
    shareIcons: true,
    sharedMetadataFields: ['name', 'description'] as SharedMetadataField[],
    lastSyncedAt: null,
  }

  const baseProjectData: Omit<Project, 'id' | 'storeType' | 'appStoreAppId' | 'playStorePackage' | 'linkedProjectId' | 'linkOwner'> = {
    name,
    linkConfiguration: defaultLinkConfig,
    metadata: {
      title: '',
      subtitle: '',
      description: '',
      keywords: '',
      whatsNew: '',
    },
    appStoreVersionState: null,
    appStoreVersionId: null,
    appStoreVersionNumber: null,
    lastPulledAt: null,
    lastPushedAt: null,
    syncStatus: 'never_synced' as MetadataSyncStatus,
    primaryLocale,
    enabledLocales: resolvedLocales,
    createdBy: context.userId,
    createdAt: now as unknown as Project['createdAt'],
    updatedAt: now as unknown as Project['updatedAt'],
    whopApiKey: null,
    whopCompanyId: null,
    whopWebhookSecret: null,
  }

  const iosProject: Omit<Project, 'id'> = {
    ...baseProjectData,
    storeType: 'ios' as StoreType,
    appStoreAppId: appStoreAppId || null,
    playStorePackage: null,
    linkedProjectId: androidRef.id,
    linkOwner: true,
  }

  const androidProject: Omit<Project, 'id'> = {
    ...baseProjectData,
    storeType: 'android' as StoreType,
    appStoreAppId: null,
    playStorePackage: playStorePackage || null,
    linkedProjectId: iosRef.id,
    linkOwner: false,
  }

  // Create both projects in a batch
  const batch = adminDb.batch()
  batch.set(iosRef, iosProject)
  batch.set(androidRef, androidProject)
  try {
    await batch.commit()
  } catch (error) {
    await refundUsage(context, operationId, 'apps')
    throw error
  }
  await settleUsage(context, operationId, 'apps', 2)

  return successResponse({
    iosProjectId: iosRef.id,
    androidProjectId: androidRef.id,
    iosProject: { id: iosRef.id, ...iosProject },
    androidProject: { id: androidRef.id, ...androidProject },
  }, 201)
}
