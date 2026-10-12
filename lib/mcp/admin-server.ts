import { adminDb } from '@/lib/firebase/admin'
import { Timestamp } from 'firebase-admin/firestore'
import {
  encryptAppStoreCredentials,
  encryptPlayStoreCredentials,
  encryptFirebaseCredentials,
  AppStoreCredentialsData,
  PlayStoreCredentialsData,
  FirebaseCredentialsData,
} from '@/lib/crypto/credentials'
import type { StoreType, MetadataSyncStatus } from '@/lib/firebase/firestore'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface AdminMCPRequest {
  jsonrpc: '2.0'
  id: string | number
  method: string
  params?: Record<string, unknown>
}

export interface AdminMCPResponse {
  jsonrpc: '2.0'
  id: string | number
  result?: unknown
  error?: {
    code: number
    message: string
    data?: unknown
  }
}

interface AdminToolDefinition {
  name: string
  description: string
  inputSchema: {
    type: 'object'
    properties: Record<string, unknown>
    required?: string[]
  }
}

// ─── Tool Definitions ────────────────────────────────────────────────────────

export const ADMIN_TOOL_DEFINITIONS: AdminToolDefinition[] = [
  {
    name: 'admin_list_projects',
    description: 'List all projects across all organizations and personal accounts. Returns projectId, name, storeType, owner info, and configured integrations.',
    inputSchema: {
      type: 'object',
      properties: {
        storeType: {
          type: 'string',
          enum: ['ios', 'android', 'web'],
          description: 'Optional filter by store type',
        },
        limit: {
          type: 'number',
          description: 'Max number of projects to return (default 100)',
        },
      },
    },
  },
  {
    name: 'admin_create_project',
    description: 'Create a new project under a specific organization or personal user account.',
    inputSchema: {
      type: 'object',
      properties: {
        ownerType: {
          type: 'string',
          enum: ['personal', 'organization'],
          description: 'Whether the project belongs to a personal user or organization',
        },
        ownerId: {
          type: 'string',
          description: 'The userId (for personal) or orgId (for organization)',
        },
        name: {
          type: 'string',
          description: 'Project display name',
        },
        storeType: {
          type: 'string',
          enum: ['ios', 'android', 'web'],
          description: 'Store type for this project',
        },
        appStoreAppId: {
          type: 'string',
          description: 'App Store App ID (iOS only)',
        },
        playStorePackage: {
          type: 'string',
          description: 'Play Store package name (Android only)',
        },
        primaryLocale: {
          type: 'string',
          description: 'Primary locale (default: en-US)',
        },
        enabledLocales: {
          type: 'array',
          items: { type: 'string' },
          description: 'Enabled locales (default: [en-US])',
        },
      },
      required: ['ownerType', 'ownerId', 'name', 'storeType'],
    },
  },
  {
    name: 'admin_configure_project',
    description: 'Update integration configuration fields on an existing project. Requires ownerType + ownerId to locate the project.',
    inputSchema: {
      type: 'object',
      properties: {
        ownerType: {
          type: 'string',
          enum: ['personal', 'organization'],
          description: 'Whether the project belongs to a personal user or organization',
        },
        ownerId: {
          type: 'string',
          description: 'The userId (for personal) or orgId (for organization)',
        },
        projectId: {
          type: 'string',
          description: 'The project ID to configure',
        },
        // Integration fields
        firebaseAppId: { type: 'string', description: 'Firebase App ID' },
        firebaseAnalyticsPropertyId: { type: 'string', description: 'Firebase Analytics Property ID' },
        firebaseProjectId: { type: 'string', description: 'Firebase project ID' },
        gleapApiToken: { type: 'string', description: 'Gleap API token' },
        gleapProjectId: { type: 'string', description: 'Gleap project ID' },
        revenueCatSecretKey: { type: 'string', description: 'RevenueCat secret API key' },
        revenueCatProjectId: { type: 'string', description: 'RevenueCat project ID' },
        vendorNumber: { type: 'string', description: 'App Store vendor number' },
        appStoreAppId: { type: 'string', description: 'App Store App ID' },
        playStorePackage: { type: 'string', description: 'Play Store package name' },
      },
      required: ['ownerType', 'ownerId', 'projectId'],
    },
  },
  {
    name: 'admin_get_project_health',
    description: 'Check integration status for a project — which services are configured and have credentials.',
    inputSchema: {
      type: 'object',
      properties: {
        ownerType: {
          type: 'string',
          enum: ['personal', 'organization'],
          description: 'Whether the project belongs to a personal user or organization',
        },
        ownerId: {
          type: 'string',
          description: 'The userId (for personal) or orgId (for organization)',
        },
        projectId: {
          type: 'string',
          description: 'The project ID to check',
        },
      },
      required: ['ownerType', 'ownerId', 'projectId'],
    },
  },
  {
    name: 'admin_configure_store_credentials',
    description: 'Add encrypted store credentials (App Store Connect, Play Store, or Firebase) to a project. Credentials are encrypted with Cloud KMS envelope encryption.',
    inputSchema: {
      type: 'object',
      properties: {
        ownerType: {
          type: 'string',
          enum: ['personal', 'organization'],
          description: 'Whether the project belongs to a personal user or organization',
        },
        ownerId: {
          type: 'string',
          description: 'The userId (for personal) or orgId (for organization)',
        },
        projectId: {
          type: 'string',
          description: 'The project ID',
        },
        credentialType: {
          type: 'string',
          enum: ['appstore', 'playstore', 'firebase'],
          description: 'Type of credentials to configure',
        },
        // App Store Connect fields
        keyId: { type: 'string', description: 'App Store Connect API Key ID (appstore only)' },
        issuerId: { type: 'string', description: 'App Store Connect Issuer ID (appstore only)' },
        privateKey: { type: 'string', description: 'App Store Connect .p8 private key contents (appstore only)' },
        // Play Store / Firebase fields
        serviceAccountJson: { type: 'string', description: 'Google service account JSON string (playstore/firebase)' },
      },
      required: ['ownerType', 'ownerId', 'projectId', 'credentialType'],
    },
  },
]

// ─── Tool Implementations ────────────────────────────────────────────────────

function getProjectRef(ownerType: string, ownerId: string, projectId?: string) {
  const base = ownerType === 'organization'
    ? adminDb.collection('organizations').doc(ownerId).collection('projects')
    : adminDb.collection('users').doc(ownerId).collection('projects')

  return projectId ? base.doc(projectId) : base
}

async function adminListProjects(params: Record<string, unknown>) {
  const storeTypeFilter = params.storeType as string | undefined
  const limit = (params.limit as number) || 100
  const results: unknown[] = []

  // Query organization projects
  const orgsSnapshot = await adminDb.collection('organizations').get()
  for (const orgDoc of orgsSnapshot.docs) {
    let query = orgDoc.ref.collection('projects').limit(limit - results.length)
    if (storeTypeFilter) {
      query = query.where('storeType', '==', storeTypeFilter)
    }
    const projSnapshot = await query.get()
    for (const projDoc of projSnapshot.docs) {
      const data = projDoc.data()
      results.push({
        projectId: projDoc.id,
        name: data.name,
        storeType: data.storeType,
        ownerType: 'organization',
        ownerId: orgDoc.id,
        ownerName: orgDoc.data().name || orgDoc.id,
        appStoreAppId: data.appStoreAppId || null,
        playStorePackage: data.playStorePackage || null,
        integrations: {
          revenuecat: !!data.revenueCatSecretKey,
          gleap: !!data.gleapApiToken,
          firebase: !!data.firebaseAppId,
        },
        syncStatus: data.syncStatus || 'unknown',
        createdAt: data.createdAt?.toDate?.()?.toISOString() || null,
      })
      if (results.length >= limit) break
    }
    if (results.length >= limit) break
  }

  // Query personal user projects
  if (results.length < limit) {
    const usersSnapshot = await adminDb.collection('users').get()
    for (const userDoc of usersSnapshot.docs) {
      let query = userDoc.ref.collection('projects').limit(limit - results.length)
      if (storeTypeFilter) {
        query = query.where('storeType', '==', storeTypeFilter)
      }
      const projSnapshot = await query.get()
      for (const projDoc of projSnapshot.docs) {
        const data = projDoc.data()
        // Skip if user belongs to org (projects are on the org)
        const userData = userDoc.data()
        if (userData.organizationId) continue

        results.push({
          projectId: projDoc.id,
          name: data.name,
          storeType: data.storeType,
          ownerType: 'personal',
          ownerId: userDoc.id,
          ownerName: userData.displayName || userData.email || userDoc.id,
          appStoreAppId: data.appStoreAppId || null,
          playStorePackage: data.playStorePackage || null,
          integrations: {
            revenuecat: !!data.revenueCatSecretKey,
            gleap: !!data.gleapApiToken,
            firebase: !!data.firebaseAppId,
          },
          syncStatus: data.syncStatus || 'unknown',
          createdAt: data.createdAt?.toDate?.()?.toISOString() || null,
        })
        if (results.length >= limit) break
      }
      if (results.length >= limit) break
    }
  }

  return { success: true, projects: results, total: results.length }
}

async function adminCreateProject(params: Record<string, unknown>) {
  const ownerType = params.ownerType as string
  const ownerId = params.ownerId as string
  const name = params.name as string
  const storeType = params.storeType as StoreType
  const appStoreAppId = (params.appStoreAppId as string) || null
  const playStorePackage = (params.playStorePackage as string) || null
  const primaryLocale = (params.primaryLocale as string) || 'en-US'
  const enabledLocales = (params.enabledLocales as string[]) || ['en-US']

  if (!ownerType || !ownerId || !name || !storeType) {
    return { success: false, error: 'Missing required fields: ownerType, ownerId, name, storeType' }
  }

  // Validate store type / ID consistency
  if (storeType === 'ios' && playStorePackage) {
    return { success: false, error: 'iOS projects cannot have a Play Store package' }
  }
  if (storeType === 'android' && appStoreAppId) {
    return { success: false, error: 'Android projects cannot have an App Store App ID' }
  }

  // Verify owner exists
  const ownerCollection = ownerType === 'organization' ? 'organizations' : 'users'
  const ownerDoc = await adminDb.collection(ownerCollection).doc(ownerId).get()
  if (!ownerDoc.exists) {
    return { success: false, error: `${ownerType} with id ${ownerId} not found` }
  }

  const now = Timestamp.now()
  const projectData = {
    name,
    storeType,
    appStoreAppId: storeType === 'ios' ? appStoreAppId : null,
    playStorePackage: storeType === 'android' ? playStorePackage : null,
    whopApiKey: null,
    whopCompanyId: null,
    whopWebhookSecret: null,
    linkedProjectId: null,
    linkConfiguration: null,
    linkOwner: false,
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
    enabledLocales: enabledLocales.includes(primaryLocale)
      ? enabledLocales
      : [primaryLocale, ...enabledLocales],
    createdBy: 'admin',
    createdAt: now,
    updatedAt: now,
  }

  const ref = getProjectRef(ownerType, ownerId) as FirebaseFirestore.CollectionReference
  const projectRef = await ref.add(projectData)

  return {
    success: true,
    projectId: projectRef.id,
    project: { id: projectRef.id, ...projectData },
  }
}

async function adminConfigureProject(params: Record<string, unknown>) {
  const ownerType = params.ownerType as string
  const ownerId = params.ownerId as string
  const projectId = params.projectId as string

  if (!ownerType || !ownerId || !projectId) {
    return { success: false, error: 'Missing required fields: ownerType, ownerId, projectId' }
  }

  const projectRef = getProjectRef(ownerType, ownerId, projectId) as FirebaseFirestore.DocumentReference
  const projectDoc = await projectRef.get()
  if (!projectDoc.exists) {
    return { success: false, error: 'Project not found' }
  }

  // Build update data from allowed fields
  const allowedFields = [
    'firebaseAppId', 'firebaseAnalyticsPropertyId', 'firebaseProjectId',
    'gleapApiToken', 'gleapProjectId',
    'revenueCatSecretKey', 'revenueCatProjectId',
    'vendorNumber', 'appStoreAppId', 'playStorePackage',
  ]

  const updateData: Record<string, unknown> = { updatedAt: Timestamp.now() }
  const updatedFields: string[] = []

  for (const field of allowedFields) {
    if (params[field] !== undefined) {
      updateData[field] = params[field]
      updatedFields.push(field)
    }
  }

  if (updatedFields.length === 0) {
    return { success: false, error: 'No configuration fields provided to update' }
  }

  await projectRef.update(updateData)

  return { success: true, updatedFields }
}

async function adminGetProjectHealth(params: Record<string, unknown>) {
  const ownerType = params.ownerType as string
  const ownerId = params.ownerId as string
  const projectId = params.projectId as string

  if (!ownerType || !ownerId || !projectId) {
    return { success: false, error: 'Missing required fields: ownerType, ownerId, projectId' }
  }

  const projectRef = getProjectRef(ownerType, ownerId, projectId) as FirebaseFirestore.DocumentReference
  const projectDoc = await projectRef.get()
  if (!projectDoc.exists) {
    return { success: false, error: 'Project not found' }
  }

  const data = projectDoc.data()!

  // Check credentials subcollection
  const credsSnapshot = await projectRef.collection('credentials').get()
  const configuredCreds = new Set(credsSnapshot.docs.map(d => d.id))

  return {
    success: true,
    projectId,
    name: data.name,
    storeType: data.storeType,
    health: {
      appstore: configuredCreds.has('appstore'),
      playstore: configuredCreds.has('playstore'),
      firebase: configuredCreds.has('firebase'),
      gleap: !!data.gleapApiToken && !!data.gleapProjectId,
      revenuecat: !!data.revenueCatSecretKey,
      crashlytics: configuredCreds.has('firebase') && !!data.firebaseAppId,
      analytics: configuredCreds.has('firebase') && !!data.firebaseAnalyticsPropertyId,
    },
    details: {
      appStoreAppId: data.appStoreAppId || null,
      playStorePackage: data.playStorePackage || null,
      firebaseAppId: data.firebaseAppId || null,
      firebaseProjectId: data.firebaseProjectId || null,
      firebaseAnalyticsPropertyId: data.firebaseAnalyticsPropertyId || null,
      gleapProjectId: data.gleapProjectId || null,
      revenueCatProjectId: data.revenueCatProjectId || null,
      vendorNumber: data.vendorNumber || null,
      syncStatus: data.syncStatus || 'unknown',
    },
  }
}

async function adminConfigureStoreCredentials(params: Record<string, unknown>) {
  const ownerType = params.ownerType as string
  const ownerId = params.ownerId as string
  const projectId = params.projectId as string
  const credentialType = params.credentialType as 'appstore' | 'playstore' | 'firebase'

  if (!ownerType || !ownerId || !projectId || !credentialType) {
    return { success: false, error: 'Missing required fields: ownerType, ownerId, projectId, credentialType' }
  }

  const projectRef = getProjectRef(ownerType, ownerId, projectId) as FirebaseFirestore.DocumentReference
  const projectDoc = await projectRef.get()
  if (!projectDoc.exists) {
    return { success: false, error: 'Project not found' }
  }

  const projectData = projectDoc.data()!
  const now = Timestamp.now()

  try {
    switch (credentialType) {
      case 'appstore': {
        const keyId = params.keyId as string
        const issuerId = params.issuerId as string
        const privateKey = params.privateKey as string

        if (!keyId || !issuerId || !privateKey) {
          return { success: false, error: 'App Store credentials require keyId, issuerId, and privateKey' }
        }

        if (!privateKey.includes('BEGIN PRIVATE KEY') || !privateKey.includes('END PRIVATE KEY')) {
          return { success: false, error: 'Invalid private key format. Must be a valid .p8 key.' }
        }

        const appId = projectData.appStoreAppId
        if (!appId) {
          return { success: false, error: 'Project does not have an App Store App ID configured' }
        }

        const credData: AppStoreCredentialsData = { keyId, issuerId, privateKey, appId }
        const encrypted = await encryptAppStoreCredentials(credData)

        await projectRef.collection('credentials').doc('appstore').set({
          store: 'appstore',
          encryptedData: encrypted.encryptedData,
          encryptedDek: encrypted.encryptedDek,
          keyVersion: encrypted.keyVersion,
          addedBy: 'admin',
          createdAt: now,
          updatedAt: now,
        })

        return { success: true, message: 'App Store Connect credentials configured', keyId }
      }

      case 'playstore': {
        const serviceAccountJson = params.serviceAccountJson as string
        if (!serviceAccountJson) {
          return { success: false, error: 'Play Store credentials require serviceAccountJson' }
        }

        let parsed
        try {
          parsed = JSON.parse(serviceAccountJson)
          if (!parsed.client_email || !parsed.private_key) {
            return { success: false, error: 'Invalid service account JSON. Missing client_email or private_key.' }
          }
        } catch {
          return { success: false, error: 'Invalid JSON format for serviceAccountJson' }
        }

        const packageName = projectData.playStorePackage
        if (!packageName) {
          return { success: false, error: 'Project does not have a Play Store package configured' }
        }

        const credData: PlayStoreCredentialsData = { packageName, serviceAccountJson }
        const encrypted = await encryptPlayStoreCredentials(credData)

        await projectRef.collection('credentials').doc('playstore').set({
          store: 'playstore',
          encryptedData: encrypted.encryptedData,
          encryptedDek: encrypted.encryptedDek,
          keyVersion: encrypted.keyVersion,
          clientEmail: parsed.client_email,
          addedBy: 'admin',
          createdAt: now,
          updatedAt: now,
        })

        return { success: true, message: 'Play Store credentials configured', clientEmail: parsed.client_email }
      }

      case 'firebase': {
        const serviceAccountJson = params.serviceAccountJson as string
        if (!serviceAccountJson) {
          return { success: false, error: 'Firebase credentials require serviceAccountJson' }
        }

        let parsed
        try {
          parsed = JSON.parse(serviceAccountJson)
          if (!parsed.client_email || !parsed.private_key) {
            return { success: false, error: 'Invalid service account JSON. Missing client_email or private_key.' }
          }
        } catch {
          return { success: false, error: 'Invalid JSON format for serviceAccountJson' }
        }

        const credData: FirebaseCredentialsData = { serviceAccountJson }
        const encrypted = await encryptFirebaseCredentials(credData)

        await projectRef.collection('credentials').doc('firebase').set({
          store: 'firebase',
          encryptedData: encrypted.encryptedData,
          encryptedDek: encrypted.encryptedDek,
          keyVersion: encrypted.keyVersion,
          serviceAccountEmail: parsed.client_email,
          addedBy: 'admin',
          createdAt: now,
          updatedAt: now,
        })

        return { success: true, message: 'Firebase credentials configured', serviceAccountEmail: parsed.client_email }
      }

      default:
        return { success: false, error: `Unknown credential type: ${credentialType}` }
    }
  } catch (error) {
    console.error('[admin-mcp] Failed to encrypt credentials:', error)
    return { success: false, error: 'Failed to encrypt credentials. Check KMS configuration.' }
  }
}

// ─── Tool Dispatcher ─────────────────────────────────────────────────────────

export async function executeAdminTool(
  toolName: string,
  params: Record<string, unknown>
): Promise<unknown> {
  switch (toolName) {
    case 'admin_list_projects':
      return adminListProjects(params)
    case 'admin_create_project':
      return adminCreateProject(params)
    case 'admin_configure_project':
      return adminConfigureProject(params)
    case 'admin_get_project_health':
      return adminGetProjectHealth(params)
    case 'admin_configure_store_credentials':
      return adminConfigureStoreCredentials(params)
    default:
      return { success: false, error: `Unknown admin tool: ${toolName}` }
  }
}

// ─── MCP Protocol Handler ────────────────────────────────────────────────────

export async function handleAdminMCPRequest(
  request: AdminMCPRequest
): Promise<AdminMCPResponse> {
  const { id, method, params } = request

  try {
    switch (method) {
      case 'initialize':
        return {
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: { tools: {} },
            serverInfo: {
              name: 'applistingagent-admin',
              version: '1.0.0',
            },
          },
        }

      case 'tools/list':
        return {
          jsonrpc: '2.0',
          id,
          result: { tools: ADMIN_TOOL_DEFINITIONS },
        }

      case 'tools/call': {
        const { name, arguments: args } = params as {
          name: string
          arguments: Record<string, unknown>
        }

        const result = await executeAdminTool(name, args || {})

        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [
              {
                type: 'text',
                text: JSON.stringify(result, null, 2),
              },
            ],
          },
        }
      }

      case 'notifications/initialized':
        return { jsonrpc: '2.0', id, result: {} }

      default:
        return {
          jsonrpc: '2.0',
          id,
          error: { code: -32601, message: `Method not found: ${method}` },
        }
    }
  } catch (error) {
    console.error('[admin-mcp] Error handling request:', error)
    return {
      jsonrpc: '2.0',
      id,
      error: {
        code: -32603,
        message: error instanceof Error ? error.message : 'Internal error',
      },
    }
  }
}
