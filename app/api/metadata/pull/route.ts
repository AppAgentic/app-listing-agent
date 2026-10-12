import { NextRequest } from 'next/server'
import { z } from 'zod'
import { authenticateRequest, errorResponse, unauthorizedResponse } from '@/lib/api/auth'
import { getProjectContext, hasContextPermission, getAccountContext, AccountContext } from '@/lib/org/context'
import { getSession } from '@/lib/auth/session'
import { AppStoreHelper } from '@/lib/services/appstore'
import { PlayStoreHelper } from '@/lib/services/playstore'
import { decryptAppStoreCredentials, decryptPlayStoreCredentials } from '@/lib/crypto/credentials'
import { adminDb } from '@/lib/firebase/admin'
import { logAuditEvent, AuditAction } from '@/lib/org/audit'
import { Timestamp } from 'firebase-admin/firestore'
import type { LocalizedMetadata, MetadataHistoryEntry } from '@/lib/firebase/firestore'

const requestSchema = z.object({
  projectId: z.string(),
  store: z.enum(['appstore', 'playstore']).default('appstore'),
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
  const { context, error } = await getAuthContext(request)
  if (!context) {
    return unauthorizedResponse(error)
  }

  const { userId } = context

  // Parse request
  let body
  try {
    body = requestSchema.parse(await request.json())
  } catch (error) {
    return errorResponse('Invalid request body')
  }

  const { projectId, store } = body

  // Get project context
  const projectContext = await getProjectContext(userId, projectId)
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
        .doc(userId)
        .collection('projects')
        .doc(projectId)

  // Get account-level credentials
  const accountCredentialsPath = projectContext.type === 'organization' && projectContext.orgId
    ? adminDb.collection('organizations').doc(projectContext.orgId).collection('credentials')
    : adminDb.collection('users').doc(userId).collection('credentials')

  const credentialsDoc = await accountCredentialsPath.doc(store).get()
  if (!credentialsDoc.exists) {
    return errorResponse(`${store === 'appstore' ? 'App Store' : 'Play Store'} credentials not configured. Go to Settings to add your credentials.`, 400)
  }

  const encryptedCreds = credentialsDoc.data()!

  // Get the project document to get the actual app ID
  const projectDoc = await basePath.get()
  if (!projectDoc.exists) {
    return errorResponse('Project not found', 404)
  }
  const projectData = projectDoc.data()!

  if (store === 'appstore') {
    const appId = projectData.appStoreAppId
    if (!appId) {
      return errorResponse('App Store App ID not configured for this project. Edit the project to add the App ID.', 400)
    }

    try {
      const credentials = await decryptAppStoreCredentials({
        encryptedData: encryptedCreds.encryptedData,
        encryptedDek: encryptedCreds.encryptedDek,
        keyVersion: encryptedCreds.keyVersion,
      })

      // Override the appId from account-level credentials with the project's actual app ID
      const helper = new AppStoreHelper({ ...credentials, appId })
      const result = await helper.pullLocalizations(userId)

    if (!result.success) {
      return errorResponse(result.error || 'Failed to pull from App Store', 500)
    }

    // Save localizations to Firestore
    const batch = adminDb.batch()
    const metadataCollection = basePath.collection('metadata')

    for (const localization of result.localizations) {
      const docRef = metadataCollection.doc(localization.locale)
      batch.set(docRef, {
        ...localization,
        lastModifiedAt: Timestamp.now(),
        lastModifiedBy: userId,
      })
    }

    // Create history entry
    const historyRef = basePath.collection('metadataHistory').doc()
    const historyEntry: MetadataHistoryEntry = {
      id: historyRef.id,
      locales: result.localizations.reduce((acc, loc) => {
        acc[loc.locale] = loc
        return acc
      }, {} as { [locale: string]: LocalizedMetadata }),
      version: 1, // Will be incremented by getting current max
      label: null,
      source: 'pull',
      sourceDetails: `Pulled from App Store Connect (version ${result.versionInfo?.versionString})`,
      changesSummary: {
        localesModified: result.localizations.map(l => l.locale),
        fieldsModified: ['all'],
        description: `Initial pull of ${result.localizations.length} locales from App Store Connect`,
      },
      createdAt: Timestamp.now() as any,
      createdBy: userId,
    }

    // Get next version number
    const existingHistory = await basePath
      .collection('metadataHistory')
      .orderBy('version', 'desc')
      .limit(1)
      .get()

    if (!existingHistory.empty) {
      historyEntry.version = (existingHistory.docs[0].data().version || 0) + 1
    }

    batch.set(historyRef, historyEntry)

    // Update project with version info
    batch.update(basePath, {
      appStoreVersionState: result.versionInfo?.state || null,
      appStoreVersionId: result.versionInfo?.id || null,
      appStoreVersionNumber: result.versionInfo?.versionString || null,
      lastPulledAt: Timestamp.now(),
      syncStatus: 'synced',
      enabledLocales: result.localizations.map(l => l.locale),
      updatedAt: Timestamp.now(),
    })

    await batch.commit()

    // Log audit event
    if (projectContext.type === 'organization' && projectContext.orgId) {
      await logAuditEvent({
        orgId: projectContext.orgId,
        action: AuditAction.PROJECT_UPDATED,
        userId: userId,
        resourceType: 'project',
        resourceId: projectId,
        metadata: {
          action: 'metadata_pull',
          store: 'appstore',
          localesCount: result.localizations.length,
          versionString: result.versionInfo?.versionString,
        },
      })
    }

    return Response.json({
      success: true,
      versionInfo: result.versionInfo,
      localesCount: result.localizations.length,
      locales: result.localizations.map(l => l.locale),
      historyVersion: historyEntry.version,
    })
    } catch (error) {
      console.error('Pull from App Store failed:', error)
      return errorResponse(
        error instanceof Error ? error.message : 'Failed to pull from App Store',
        500
      )
    }
  } else {
    // Play Store pull
    const packageName = projectData.playStorePackage
    if (!packageName) {
      return errorResponse('Play Store Package Name not configured for this project. Edit the project to add the Package Name.', 400)
    }

    try {
      const credentials = await decryptPlayStoreCredentials({
      encryptedData: encryptedCreds.encryptedData,
      encryptedDek: encryptedCreds.encryptedDek,
      keyVersion: encryptedCreds.keyVersion,
    })

    // Override the packageName from account-level credentials with the project's actual package name
    const helper = new PlayStoreHelper({ ...credentials, packageName })
    const result = await helper.getListings()

    if (!result.success || !result.metadata) {
      return errorResponse(result.error || 'Failed to pull from Play Store', 500)
    }

    // Map Play Store metadata to LocalizedMetadata format
    const localizations: LocalizedMetadata[] = result.metadata.map(m => ({
      locale: m.locale,
      name: m.title, // Play Store title → name
      subtitle: '', // Not available in Play Store
      description: m.fullDescription, // Play Store fullDescription → description
      keywords: '', // Not available in Play Store
      whatsNew: '', // Not available in Play Store
      shortDescription: m.shortDescription,
      fullDescription: m.fullDescription,
      privacyUrl: null,
      marketingUrl: null,
      supportUrl: null,
      promotionalText: null,
      sourceHash: '',
      lastModifiedAt: Timestamp.now() as any,
      lastModifiedBy: userId,
    }))

    // Save localizations to Firestore
    const batch = adminDb.batch()
    const metadataCollection = basePath.collection('metadata')

    for (const localization of localizations) {
      const docRef = metadataCollection.doc(localization.locale)
      batch.set(docRef, {
        ...localization,
        lastModifiedAt: Timestamp.now(),
        lastModifiedBy: userId,
      })
    }

    // Create history entry
    const historyRef = basePath.collection('metadataHistory').doc()
    const historyEntry: MetadataHistoryEntry = {
      id: historyRef.id,
      locales: localizations.reduce((acc, loc) => {
        acc[loc.locale] = loc
        return acc
      }, {} as { [locale: string]: LocalizedMetadata }),
      version: 1,
      label: null,
      source: 'pull',
      sourceDetails: `Pulled from Google Play Console`,
      changesSummary: {
        localesModified: localizations.map(l => l.locale),
        fieldsModified: ['all'],
        description: `Initial pull of ${localizations.length} locales from Google Play Console`,
      },
      createdAt: Timestamp.now() as any,
      createdBy: userId,
    }

    // Get next version number
    const existingHistory = await basePath
      .collection('metadataHistory')
      .orderBy('version', 'desc')
      .limit(1)
      .get()

    if (!existingHistory.empty) {
      historyEntry.version = (existingHistory.docs[0].data().version || 0) + 1
    }

    batch.set(historyRef, historyEntry)

    // Update project
    batch.update(basePath, {
      lastPulledAt: Timestamp.now(),
      syncStatus: 'synced',
      enabledLocales: localizations.map(l => l.locale),
      updatedAt: Timestamp.now(),
    })

    await batch.commit()

    // Log audit event
    if (projectContext.type === 'organization' && projectContext.orgId) {
      await logAuditEvent({
        orgId: projectContext.orgId,
        action: AuditAction.PROJECT_UPDATED,
        userId: userId,
        resourceType: 'project',
        resourceId: projectId,
        metadata: {
          action: 'metadata_pull',
          store: 'playstore',
          localesCount: localizations.length,
        },
      })
    }

    return Response.json({
      success: true,
      localesCount: localizations.length,
      locales: localizations.map(l => l.locale),
      historyVersion: historyEntry.version,
    })
    } catch (error) {
      console.error('Pull from Play Store failed:', error)
      return errorResponse(
        error instanceof Error ? error.message : 'Failed to pull from Play Store',
        500
      )
    }
  }
}
