import { adminDb } from '@/lib/firebase/admin'
import { decryptAppStoreCredentials, decryptPlayStoreCredentials } from '@/lib/crypto/credentials'
import { AccountContext, getProjectContext, hasContextPermission } from '@/lib/org/context'
import { getFirebaseServiceAccountJson } from '@/lib/services/crashlytics'
import { hasInternalIntegrationAccess } from '@/lib/features/internal-integrations'

export interface ValidateConfigParams {
  projectId: string
}

export interface ValidateConfigResult {
  success: boolean
  project?: {
    id: string
    name: string
    appStoreAppId?: string
    playStorePackage?: string
  }
  credentials: {
    appstore: {
      configured: boolean
      valid?: boolean
      error?: string
    }
    playstore: {
      configured: boolean
      valid?: boolean
      error?: string
    }
    firebase?: {
      serviceAccountConfigured: boolean
      firebaseAppId?: string
      analyticsPropertyId?: string
      crashlyticsAvailable?: boolean
      analyticsAvailable: boolean
      error?: string
    }
    gleap?: {
      configured: boolean
      hasApiToken: boolean
      hasProjectId: boolean
    }
  }
  metadata?: {
    hasTitle: boolean
    hasSubtitle: boolean
    hasDescription: boolean
    hasKeywords: boolean
  }
  error?: string
}

export async function validateConfig(
  params: ValidateConfigParams,
  context: AccountContext
): Promise<ValidateConfigResult> {
  const { projectId } = params

  // Validate project access
  const projectContext = await getProjectContext(context.userId, projectId)
  if (!projectContext) {
    return {
      success: false,
      error: 'Project not found',
      credentials: {
        appstore: { configured: false },
        playstore: { configured: false }
      }
    }
  }

  if (!hasContextPermission(projectContext, 'canCreateProjects')) {
    return {
      success: false,
      error: 'Permission denied',
      credentials: {
        appstore: { configured: false },
        playstore: { configured: false }
      }
    }
  }

  const project = projectContext.project
  const internalIntegrationsEnabled = hasInternalIntegrationAccess(context)
  const basePath = projectContext.type === 'organization' && projectContext.orgId
    ? `organizations/${projectContext.orgId}/projects/${projectId}`
    : `users/${context.userId}/projects/${projectId}`

  // Check App Store credentials
  const appstoreCredRef = adminDb.doc(`${basePath}/credentials/appstore`)
  const appstoreCredDoc = await appstoreCredRef.get()
  let appstoreStatus: ValidateConfigResult['credentials']['appstore'] = {
    configured: false
  }

  if (appstoreCredDoc.exists) {
    appstoreStatus.configured = true
    try {
      const encryptedCreds = appstoreCredDoc.data()!
      await decryptAppStoreCredentials({
        encryptedData: encryptedCreds.encryptedData,
        encryptedDek: encryptedCreds.encryptedDek,
        keyVersion: encryptedCreds.keyVersion
      })
      appstoreStatus.valid = true
    } catch (error) {
      appstoreStatus.valid = false
      appstoreStatus.error = error instanceof Error ? error.message : 'Decryption failed'
    }
  }

  // Check Play Store credentials
  const playstoreCredRef = adminDb.doc(`${basePath}/credentials/playstore`)
  const playstoreCredDoc = await playstoreCredRef.get()
  let playstoreStatus: ValidateConfigResult['credentials']['playstore'] = {
    configured: false
  }

  if (playstoreCredDoc.exists) {
    playstoreStatus.configured = true
    try {
      const encryptedCreds = playstoreCredDoc.data()!
      await decryptPlayStoreCredentials({
        encryptedData: encryptedCreds.encryptedData,
        encryptedDek: encryptedCreds.encryptedDek,
        keyVersion: encryptedCreds.keyVersion
      })
      playstoreStatus.valid = true
    } catch (error) {
      playstoreStatus.valid = false
      playstoreStatus.error = error instanceof Error ? error.message : 'Decryption failed'
    }
  }

  // Firebase is intentionally omitted from public launch responses.
  let firebaseStatus: ValidateConfigResult['credentials']['firebase'] | undefined
  if (internalIntegrationsEnabled) {
    const firebaseAppId = project.firebaseAppId || undefined
    const analyticsPropertyId = project.firebaseAnalyticsPropertyId || undefined
    let serviceAccountConfigured = false
    try {
      const sa = await getFirebaseServiceAccountJson(
        context.userId,
        projectId,
        projectContext.orgId
      )
      serviceAccountConfigured = !!sa
    } catch {
      // Silently handle — will show as not configured
    }

    firebaseStatus = {
      serviceAccountConfigured,
      ...(firebaseAppId ? { firebaseAppId } : {}),
      ...(analyticsPropertyId ? { analyticsPropertyId } : {}),
      crashlyticsAvailable: serviceAccountConfigured && !!firebaseAppId,
      analyticsAvailable: serviceAccountConfigured && !!analyticsPropertyId,
      ...(!serviceAccountConfigured && !firebaseAppId && !analyticsPropertyId
        ? { error: 'No Firebase configuration found. Add Firebase App ID and/or GA4 Property ID in project settings, and upload a Firebase service account.' }
        : !serviceAccountConfigured
          ? { error: 'Firebase service account not configured. Upload a Google service account JSON in project settings.' }
          : {}),
    }
  }

  // Check Gleap credentials
  const gleapStatus = internalIntegrationsEnabled
    ? {
        configured: !!(project as any).gleapApiToken && !!(project as any).gleapProjectId,
        hasApiToken: !!(project as any).gleapApiToken,
        hasProjectId: !!(project as any).gleapProjectId,
      }
    : undefined

  return {
    success: true,
    project: {
      id: projectId,
      name: project.name,
      appStoreAppId: project.appStoreAppId || undefined,
      playStorePackage: project.playStorePackage || undefined
    },
    credentials: {
      appstore: appstoreStatus,
      playstore: playstoreStatus,
      ...(firebaseStatus ? { firebase: firebaseStatus } : {}),
      ...(gleapStatus ? { gleap: gleapStatus } : {}),
    },
    metadata: {
      hasTitle: !!project.metadata?.title,
      hasSubtitle: !!project.metadata?.subtitle,
      hasDescription: !!project.metadata?.description,
      hasKeywords: !!project.metadata?.keywords
    }
  }
}
