import { createHash, randomBytes } from 'crypto'
import { Timestamp } from 'firebase-admin/firestore'
import jwt from 'jsonwebtoken'
import { adminDb } from '@/lib/firebase/admin'
import { createApiKey } from '@/lib/api/keys'
import { getAccountContext, getProjectsCollection, hasContextPermission, type AccountContext } from '@/lib/org/context'
import type { ApiKeyScope, MetadataSyncStatus, Project, StoreType } from '@/lib/firebase/firestore'
import { decryptAppStoreCredentials } from '@/lib/crypto/credentials'
import { createReservationErrorResponse, refundUsage, reserveUsage, settleUsage } from '@/lib/api/usage'
import { recordConciergeEventForUser } from '@/lib/concierge-server'
import { recordCoreAction } from '@/lib/analytics/runtime'
import { appUrl } from '@/lib/routing/app-url'

export const AGENT_PAIRING_TTL_MINUTES = 15
export const ONBOARDING_AGENT_SCOPES: ApiKeyScope[] = ['read', 'write', 'translate', 'screenshots']

export type AgentPolicyMode = 'read_only' | 'draft_with_approval' | 'publish_with_approval'
export type StoreRecordStatus = 'existing' | 'not_created'
const AGENT_POLICY_MODES: AgentPolicyMode[] = ['read_only', 'draft_with_approval', 'publish_with_approval']

export interface AgentOnboardingState {
  status: 'not_connected' | 'pairing' | 'connected' | 'complete'
  currentStep: 'workspace' | 'connect_agent' | 'choose_app' | 'connect_stores' | 'set_policy' | 'first_audit' | 'complete'
  pairingExpiresAt?: string | null
  connectedAt?: string | null
  completedAt?: string | null
  policy?: {
    mode: AgentPolicyMode
    publishRequiresApproval: true
    destructiveActionsAllowed: false
  }
}

export function validateAgentPairingRecord(
  pairing: { status?: string; expiresAt?: { toMillis(): number } | null },
  now = Date.now(),
): void {
  if (pairing.status !== 'pending') throw new Error('Pairing code has already been used')
  if (!pairing.expiresAt || pairing.expiresAt.toMillis() <= now) throw new Error('Pairing code has expired')
}

export function validateAgentOnboardingCompletion(agentOnboarding: Record<string, unknown>): void {
  const policy = agentOnboarding.policy as Record<string, unknown> | undefined
  if (
    !policy
    || !AGENT_POLICY_MODES.includes(policy.mode as AgentPolicyMode)
    || policy.publishRequiresApproval !== true
    || policy.destructiveActionsAllowed !== false
  ) {
    throw new Error('Set the guarded agent operating policy before completing onboarding')
  }
  if (!agentOnboarding.firstAuditAt) throw new Error('Run the first store-readiness audit before completing onboarding')
}

export function validateOnboardingProjectStoreRecord(input: {
  storeType: string
  storeRecordStatus: StoreRecordStatus
  appStoreAppId?: string | null
  playStorePackage?: string | null
}): void {
  if (input.storeType !== 'ios' && input.storeType !== 'android') throw new Error('Store type must be ios or android')
  if (input.storeRecordStatus !== 'existing' && input.storeRecordStatus !== 'not_created') {
    throw new Error('Store record status must be existing or not_created')
  }
  if (input.storeRecordStatus === 'existing' && input.storeType === 'ios' && !input.appStoreAppId) {
    throw new Error('App Store App ID is required when the app already exists in App Store Connect')
  }
  if (input.storeRecordStatus === 'existing' && input.storeType === 'android' && !input.playStorePackage) {
    throw new Error('Google Play package name is required when the app already exists in Play Console')
  }
  if (input.storeRecordStatus === 'not_created' && (input.appStoreAppId || input.playStorePackage)) {
    throw new Error('A pre-store project must not include a store ID or package name')
  }
  if (input.storeType === 'ios' && input.playStorePackage) throw new Error('An iOS project cannot use a Google Play package name')
  if (input.storeType === 'android' && input.appStoreAppId) throw new Error('An Android project cannot use an App Store App ID')
  if (input.storeType === 'ios' && input.appStoreAppId && !/^\d+$/.test(input.appStoreAppId)) {
    throw new Error('App Store App ID must be numeric')
  }
  if (input.storeType === 'android' && input.playStorePackage && (!input.playStorePackage.includes('.') || /\s/.test(input.playStorePackage))) {
    throw new Error('Google Play package name is invalid')
  }
}

function pairingHash(code: string): string {
  return createHash('sha256').update(code.trim().toUpperCase()).digest('hex')
}

function formatPairingCode(value: string): string {
  return `${value.slice(0, 4)}-${value.slice(4, 8)}-${value.slice(8, 12)}`.toUpperCase()
}

function timestampToIso(value: unknown): string | null {
  if (value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') {
    return value.toDate().toISOString()
  }
  return null
}

export function normalizeAgentOnboardingState(data?: Record<string, unknown>): AgentOnboardingState {
  const raw = (data?.agentOnboarding || {}) as Record<string, unknown>
  const status = raw.status === 'pairing' || raw.status === 'connected' || raw.status === 'complete'
    ? raw.status
    : 'not_connected'
  const currentStep = typeof raw.currentStep === 'string'
    ? raw.currentStep as AgentOnboardingState['currentStep']
    : (status === 'not_connected' ? 'workspace' : status === 'pairing' ? 'connect_agent' : 'choose_app')

  return {
    status,
    currentStep,
    pairingExpiresAt: timestampToIso(raw.pairingExpiresAt),
    connectedAt: timestampToIso(raw.connectedAt),
    completedAt: timestampToIso(raw.completedAt),
    ...(raw.policy ? { policy: raw.policy as AgentOnboardingState['policy'] } : {}),
  }
}

export async function createAgentPairing(userId: string): Promise<{
  code: string
  expiresAt: string
  exchangeUrl: string
  scopes: ApiKeyScope[]
}> {
  const context = await getAccountContext(userId)
  if (!context) throw new Error('User not found')

  const code = formatPairingCode(randomBytes(6).toString('hex'))
  const hash = pairingHash(code)
  const now = Timestamp.now()
  const expiresAt = Timestamp.fromMillis(Date.now() + AGENT_PAIRING_TTL_MINUTES * 60 * 1000)
  const pairingRef = adminDb.collection('agentPairings').doc(hash)
  const userRef = adminDb.collection('users').doc(userId)

  await adminDb.runTransaction(async transaction => {
    const userDoc = await transaction.get(userRef)
    if (!userDoc.exists) throw new Error('User not found')
    const previousHash = userDoc.data()?.agentOnboarding?.pairingHash
    if (typeof previousHash === 'string' && previousHash !== hash) {
      transaction.set(adminDb.collection('agentPairings').doc(previousHash), {
        status: 'superseded',
        supersededAt: now,
      }, { merge: true })
    }
    transaction.set(pairingRef, {
      userId,
      orgId: context.orgId || null,
      status: 'pending',
      scopes: ONBOARDING_AGENT_SCOPES,
      createdAt: now,
      expiresAt,
      consumedAt: null,
      keyId: null,
    })
    transaction.update(userRef, {
      'agentOnboarding.status': 'pairing',
      'agentOnboarding.currentStep': 'connect_agent',
      'agentOnboarding.pairingHash': hash,
      'agentOnboarding.pairingExpiresAt': expiresAt,
      'agentOnboarding.updatedAt': now,
      updatedAt: now,
    })
  })

  return {
    code,
    expiresAt: expiresAt.toDate().toISOString(),
    exchangeUrl: '/api/onboarding/pairing/exchange',
    scopes: ONBOARDING_AGENT_SCOPES,
  }
}

export async function exchangeAgentPairing(code: string): Promise<{
  apiKey: string
  mcpUrl: string
  scopes: ApiKeyScope[]
}> {
  const hash = pairingHash(code)
  const pairingRef = adminDb.collection('agentPairings').doc(hash)
  const pairingDoc = await pairingRef.get()

  if (!pairingDoc.exists) throw new Error('Invalid pairing code')
  const pairing = pairingDoc.data()!
  validateAgentPairingRecord(pairing)

  const context = await getAccountContext(pairing.userId)
  if (!context) throw new Error('Account no longer exists')

  const { key, keyData } = await createApiKey(
    context,
    'Onboarding agent',
    ONBOARDING_AGENT_SCOPES,
    30,
  )

  const consumedAt = Timestamp.now()
  try {
    await adminDb.runTransaction(async transaction => {
      const latest = await transaction.get(pairingRef)
      if (!latest.exists) throw new Error('Invalid pairing code')
      validateAgentPairingRecord(latest.data()!)

      transaction.update(pairingRef, {
        status: 'consumed',
        consumedAt,
        keyId: keyData.id,
      })
      transaction.update(adminDb.collection('users').doc(pairing.userId), {
        'agentOnboarding.status': 'connected',
        'agentOnboarding.currentStep': 'choose_app',
        'agentOnboarding.connectedAt': consumedAt,
        'agentOnboarding.keyId': keyData.id,
        'agentOnboarding.scopes': ONBOARDING_AGENT_SCOPES,
        'agentOnboarding.updatedAt': consumedAt,
        updatedAt: consumedAt,
      })
    })
  } catch (error) {
    const keysRef = context.type === 'organization' && context.orgId
      ? adminDb.collection('organizations').doc(context.orgId).collection('apiKeys')
      : adminDb.collection('users').doc(context.userId).collection('apiKeys')
    await keysRef.doc(keyData.id).update({ revokedAt: Timestamp.now() })
    throw error
  }

  await recordConciergeEventForUser(pairing.userId, 'agent_paired')
  await recordCoreAction(pairing.userId, 'agent_connected')

  return {
    apiKey: key,
    mcpUrl: appUrl('/api/mcp'),
    scopes: ONBOARDING_AGENT_SCOPES,
  }
}

export async function getAgentOnboardingStatus(
  context: AccountContext,
  projectId?: string
): Promise<Record<string, unknown>> {
  const userDoc = await adminDb.collection('users').doc(context.userId).get()
  if (!userDoc.exists) throw new Error('User not found')

  const projectsSnapshot = await getProjectsCollection(context).orderBy('updatedAt', 'desc').get()
  const projects = projectsSnapshot.docs.filter(doc => !projectId || doc.id === projectId).map(doc => {
    const project = doc.data()
    const storeRecordStatus: StoreRecordStatus = project.storeRecordStatus === 'not_created'
      || (project.storeType === 'ios' ? !project.appStoreAppId : !project.playStorePackage)
      ? 'not_created'
      : 'existing'
    return {
      id: doc.id,
      name: project.name,
      storeType: project.storeType,
      appStoreAppId: project.appStoreAppId || null,
      playStorePackage: project.playStorePackage || null,
      storeRecordStatus,
      syncStatus: project.syncStatus || 'never_synced',
    }
  })

  const credentialsRef = context.type === 'organization' && context.orgId
    ? adminDb.collection('organizations').doc(context.orgId).collection('credentials')
    : adminDb.collection('users').doc(context.userId).collection('credentials')
  const [appStoreCredentials, playStoreCredentials] = await Promise.all([
    credentialsRef.doc('appstore').get(),
    credentialsRef.doc('playstore').get(),
  ])

  const state = normalizeAgentOnboardingState(userDoc.data())
  const projectNeedsStoreConnection = projects.some(project => (
    project.storeRecordStatus === 'existing'
    && (project.storeType === 'ios' ? !appStoreCredentials.exists : !playStoreCredentials.exists)
  ))
  const nextAction = projects.length === 0
    ? 'Ask whether the app already exists in App Store Connect or Play Console, even if unpublished. If it does not exist there yet, create a local pre-store project without requiring a store ID.'
    : projectNeedsStoreConnection
      ? 'Open the secure store-connection URL for the user. Do not request store private keys in chat.'
      : state.currentStep === 'set_policy'
        ? 'Confirm the operating policy before proposing any store changes.'
        : 'Run the first store-readiness audit and propose one previewable improvement.'

  return {
    success: true,
    onboarding: state,
    workspaceName: userDoc.data()?.workspaceName || null,
    projects,
    storeConnections: {
      appstore: appStoreCredentials.exists,
      playstore: playStoreCredentials.exists,
    },
    nextAction,
    secureStoreConnectionUrl: appUrl('/onboarding/stores'),
  }
}

export async function setAgentPolicy(context: AccountContext, mode: AgentPolicyMode) {
  if (!AGENT_POLICY_MODES.includes(mode)) throw new Error('Invalid agent operating policy')
  const now = Timestamp.now()
  const policy = {
    mode,
    publishRequiresApproval: true as const,
    destructiveActionsAllowed: false as const,
  }
  await adminDb.collection('users').doc(context.userId).update({
    'agentOnboarding.status': 'connected',
    'agentOnboarding.currentStep': 'first_audit',
    'agentOnboarding.policy': policy,
    'agentOnboarding.updatedAt': now,
    updatedAt: now,
  })
  return { success: true, policy, nextAction: 'Run the first store-readiness audit.' }
}

export async function listImportableApps(context: AccountContext) {
  const credentialsRef = context.type === 'organization' && context.orgId
    ? adminDb.collection('organizations').doc(context.orgId).collection('credentials')
    : adminDb.collection('users').doc(context.userId).collection('credentials')
  const [appStoreDoc, playStoreDoc] = await Promise.all([
    credentialsRef.doc('appstore').get(),
    credentialsRef.doc('playstore').get(),
  ])

  if (!appStoreDoc.exists) {
    return {
      success: true,
      apps: [],
      storeConnections: { appstore: false, playstore: playStoreDoc.exists },
      nextAction: playStoreDoc.exists
        ? 'For a Google Play app, ask for its package name even if it is unpublished. Otherwise ask the user to open the secure App Store connection page.'
        : 'Ask whether the app has been created in either store console. If not, create a local pre-store project; otherwise use the secure connection page. Never request private credentials in chat.',
      secureStoreConnectionUrl: appUrl('/onboarding/stores'),
    }
  }

  const encrypted = appStoreDoc.data()!
  const credentials = await decryptAppStoreCredentials({
    encryptedData: encrypted.encryptedData,
    encryptedDek: encrypted.encryptedDek,
    keyVersion: encrypted.keyVersion,
  })
  const now = Math.floor(Date.now() / 1000)
  const token = jwt.sign({ iss: credentials.issuerId, exp: now + 20 * 60, aud: 'appstoreconnect-v1' }, credentials.privateKey, {
    algorithm: 'ES256',
    header: { alg: 'ES256', kid: credentials.keyId, typ: 'JWT' },
  })
  const response = await fetch('https://api.appstoreconnect.apple.com/v1/apps?limit=100', {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  })
  if (!response.ok) throw new Error('App Store Connect rejected the saved credentials')
  const payload = await response.json()
  const apps = (payload.data || []).map((app: any) => ({
    store: 'appstore',
    appStoreAppId: app.id,
    name: app.attributes.name,
    bundleId: app.attributes.bundleId,
    primaryLocale: app.attributes.primaryLocale || 'en-US',
  }))

  return {
    success: true,
    apps,
    storeConnections: { appstore: true, playstore: playStoreDoc.exists },
    playStoreNote: playStoreDoc.exists
      ? 'Google Play does not provide a reliable list-all-apps API; ask for the package name. This works for apps that exist in Play Console but are not published.'
      : 'Google Play is not connected.',
    publicationNote: 'App Store Connect discovery includes apps that are not yet published on the public App Store.',
    nextAction: apps.length > 0
      ? 'Summarize the matching apps and ask the user to confirm which one to import.'
      : 'Ask for an App Store URL/App ID or Google Play package name.',
  }
}

export async function createOnboardingProject(
  context: AccountContext,
  input: {
    requestId: string
    name: string
    storeType: 'ios' | 'android'
    storeRecordStatus: StoreRecordStatus
    appStoreAppId?: string | null
    playStorePackage?: string | null
    primaryLocale?: string
  },
) {
  if (context.type === 'organization' && !hasContextPermission(context, 'canCreateProjects')) {
    throw new Error('You do not have permission to create projects in this organization')
  }
  const name = input.name.trim()
  const requestId = input.requestId.trim()
  if (!requestId) throw new Error('requestId is required for safe retries')
  if (requestId.length > 128) throw new Error('requestId must be 128 characters or fewer')
  if (!name) throw new Error('Project name is required')
  if (name.length > 100) throw new Error('Project name must be 100 characters or fewer')
  validateOnboardingProjectStoreRecord(input)

  const projectsRef = getProjectsCollection(context)
  const existing = await projectsRef.where('onboardingRequestId', '==', requestId).limit(1).get()
  if (!existing.empty) {
    const projectDoc = existing.docs[0]
    const project = projectDoc.data()
    return {
      success: true,
      replayed: true,
      project: { id: projectDoc.id, ...project },
      nextAction: project.storeRecordStatus === 'not_created'
        ? 'Continue with the agent operating policy and a pre-store readiness audit. After the store-console record is created, call attach_onboarding_store_record.'
        : 'Check store connection status. If credentials are missing, send the secure browser handoff URL.',
    }
  }

  const projectRef = projectsRef.doc()
  const operationId = `agent-onboarding:create-project:${createHash('sha256').update(requestId).digest('hex').slice(0, 24)}`
  const reservation = await reserveUsage(context, {
    operationId,
    usageType: 'apps',
    units: 1,
    metadata: { route: 'agent-onboarding', storeType: input.storeType, projectPath: projectRef.path },
  })
  if (!reservation.allowed) {
    const response = createReservationErrorResponse(reservation)
    const payload = await response.json()
    throw new Error(payload.message || 'App limit reached')
  }

  const now = Timestamp.now()
  const projectData: Omit<Project, 'id'> & { onboardingRequestId: string; storeRecordStatus: StoreRecordStatus } = {
    onboardingRequestId: requestId,
    storeRecordStatus: input.storeRecordStatus,
    name,
    storeType: input.storeType as StoreType,
    appStoreAppId: input.storeType === 'ios' ? input.appStoreAppId || null : null,
    playStorePackage: input.storeType === 'android' ? input.playStorePackage || null : null,
    whopApiKey: null,
    whopCompanyId: null,
    whopWebhookSecret: null,
    linkedProjectId: null,
    linkConfiguration: null,
    linkOwner: false,
    metadata: { title: '', subtitle: '', description: '', keywords: '', whatsNew: '' },
    appStoreVersionState: null,
    appStoreVersionId: null,
    appStoreVersionNumber: null,
    lastPulledAt: null,
    lastPushedAt: null,
    syncStatus: 'never_synced' as MetadataSyncStatus,
    primaryLocale: input.primaryLocale || 'en-US',
    enabledLocales: [input.primaryLocale || 'en-US'],
    createdBy: context.userId,
    createdAt: now as unknown as Project['createdAt'],
    updatedAt: now as unknown as Project['updatedAt'],
  }

  try {
    await projectRef.set(projectData)
    await settleUsage(context, operationId, 'apps', 1)
  } catch (error) {
    await refundUsage(context, operationId, 'apps')
    throw error
  }

  await adminDb.collection('users').doc(context.userId).update({
    'agentOnboarding.status': 'connected',
    'agentOnboarding.currentStep': input.storeRecordStatus === 'existing' ? 'connect_stores' : 'set_policy',
    'agentOnboarding.updatedAt': now,
    updatedAt: now,
  })
  return {
    success: true,
    project: { id: projectRef.id, ...projectData },
    nextAction: input.storeRecordStatus === 'existing'
      ? 'Check store connection status. If credentials are missing, send the secure browser handoff URL.'
      : 'Continue with the agent operating policy and a pre-store readiness audit. After the store-console record is created, call attach_onboarding_store_record.',
  }
}

export async function attachOnboardingStoreRecord(
  context: AccountContext,
  input: { projectId: string; appStoreAppId?: string | null; playStorePackage?: string | null },
) {
  if (context.type === 'organization' && !hasContextPermission(context, 'canCreateProjects')) {
    throw new Error('You do not have permission to update projects in this organization')
  }
  const projectRef = getProjectsCollection(context).doc(input.projectId)
  const projectDoc = await projectRef.get()
  if (!projectDoc.exists) throw new Error('Project not found')
  const project = projectDoc.data()!
  validateOnboardingProjectStoreRecord({
    storeType: project.storeType,
    storeRecordStatus: 'existing',
    appStoreAppId: input.appStoreAppId,
    playStorePackage: input.playStorePackage,
  })

  const currentIdentifier = project.storeType === 'ios' ? project.appStoreAppId : project.playStorePackage
  const nextIdentifier = project.storeType === 'ios' ? input.appStoreAppId : input.playStorePackage
  if (currentIdentifier) {
    if (currentIdentifier !== nextIdentifier) throw new Error('This project is already attached to a different store record')
    return {
      success: true,
      replayed: true,
      projectId: projectDoc.id,
      storeRecordStatus: 'existing' as const,
      nextAction: 'Check store connection status, then import metadata and rerun the readiness audit.',
    }
  }

  const now = Timestamp.now()
  await projectRef.update({
    appStoreAppId: project.storeType === 'ios' ? input.appStoreAppId : null,
    playStorePackage: project.storeType === 'android' ? input.playStorePackage : null,
    storeRecordStatus: 'existing',
    updatedAt: now,
  })
  await adminDb.collection('users').doc(context.userId).update({
    'agentOnboarding.status': 'connected',
    'agentOnboarding.currentStep': 'connect_stores',
    'agentOnboarding.updatedAt': now,
    updatedAt: now,
  })

  return {
    success: true,
    projectId: projectDoc.id,
    storeRecordStatus: 'existing' as const,
    nextAction: 'Check store connection status. If credentials are missing, send the secure browser handoff URL; otherwise import metadata and rerun the readiness audit.',
  }
}

export async function runStoreReadinessAudit(context: AccountContext, projectId?: string) {
  const status = await getAgentOnboardingStatus(context)
  const projects = status.projects as Array<Record<string, any>>
  const projectSummary = projectId ? projects.find(project => project.id === projectId) : projects[0]
  if (!projectSummary) throw new Error('Create or import a project before running the readiness audit')

  const projectDoc = await getProjectsCollection(context).doc(projectSummary.id).get()
  if (!projectDoc.exists) throw new Error('Project not found')
  const project = projectDoc.data()!
  const metadata = project.metadata || {}
  const connections = status.storeConnections as { appstore: boolean; playstore: boolean }
  const storeRecordExists = project.storeRecordStatus !== 'not_created'
    && (project.storeType === 'ios' ? Boolean(project.appStoreAppId) : Boolean(project.playStorePackage))
  const storeConnected = project.storeType === 'ios' ? connections.appstore : connections.playstore
  const blockers = [
    ...(!storeRecordExists ? [{ code: 'store_record_not_created', deferrable: true, message: `The app has not been created in ${project.storeType === 'ios' ? 'App Store Connect' : 'Google Play Console'} yet. You can keep drafting locally.` }] : []),
    ...(storeRecordExists && !storeConnected ? [{ code: 'store_not_connected', message: `${project.storeType === 'ios' ? 'App Store Connect' : 'Google Play'} is not connected.` }] : []),
    ...(!metadata.title ? [{ code: 'missing_title', message: 'No app title yet.' }] : []),
    ...(!metadata.description ? [{ code: 'missing_description', message: 'No app description yet.' }] : []),
    ...(storeRecordExists && project.syncStatus === 'never_synced' ? [{ code: 'never_synced', message: 'Store metadata has not been imported yet.' }] : []),
  ]
  const now = Timestamp.now()
  await adminDb.collection('users').doc(context.userId).update({
    'agentOnboarding.status': 'connected',
    'agentOnboarding.currentStep': 'first_audit',
    'agentOnboarding.firstAuditAt': now,
    'agentOnboarding.updatedAt': now,
    updatedAt: now,
  })
  await recordConciergeEventForUser(context.userId, 'first_audit_completed', {
    projectId: projectSummary.id,
    ready: blockers.length === 0,
    blockerCount: blockers.length,
  })
  await recordCoreAction(context.userId, 'first_audit_completed')

  return {
    success: true,
    project: projectSummary,
    ready: blockers.length === 0,
    blockers,
    approvalBoundary: 'Draft changes are allowed. Publishing requires explicit human approval; destructive actions are unavailable.',
    nextAction: blockers.length > 0
      ? 'Start with the first blocker above. You can keep improving the draft listing in the meantime; nothing is published without your approval.'
      : 'Choose one improvement to preview, such as the subtitle, screenshots, icon, a translation or the privacy policy.',
  }
}

export async function completeAgentOnboarding(context: AccountContext) {
  const userRef = adminDb.collection('users').doc(context.userId)
  const userDoc = await userRef.get()
  const agentOnboarding = userDoc.data()?.agentOnboarding || {}
  validateAgentOnboardingCompletion(agentOnboarding)

  const now = Timestamp.now()
  await userRef.update({
    onboardingCompleted: true,
    'agentOnboarding.status': 'complete',
    'agentOnboarding.currentStep': 'complete',
    'agentOnboarding.completedAt': now,
    'agentOnboarding.updatedAt': now,
    updatedAt: now,
  })
  return {
    success: true,
    dashboardUrl: appUrl('/dashboard'),
    message: 'Agent onboarding is complete. Continue with inspect → propose → preview → approve → publish → verify.',
  }
}
