import { initializeApp, getApps, cert, App } from 'firebase-admin/app'
import { getAuth, Auth } from 'firebase-admin/auth'
import { getFirestore, Firestore } from 'firebase-admin/firestore'

// Check if we're in build phase (Next.js sets this during build)
const isBuildPhase = process.env.NEXT_PHASE === 'phase-production-build'
const isTestEnvironment = process.env.NODE_ENV === 'test'
const useExplicitDevMocks = process.env.NODE_ENV === 'development'
  && process.env.FIREBASE_ADMIN_USE_MOCKS === 'true'
const shouldUseMocks = isTestEnvironment || useExplicitDevMocks

let initializationError: unknown = null

function getFirebaseAdminApp(): App | null {
  // Unit tests and explicitly opted-in local development may use deterministic
  // mocks. Production can never opt into this path.
  if (shouldUseMocks || isBuildPhase) {
    return null
  }

  // Return existing app if already initialized
  if (getApps().length > 0) {
    return getApps()[0]
  }

  // Check for explicit credentials (local development)
  const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID
  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL
  const privateKeyRaw = process.env.FIREBASE_ADMIN_PRIVATE_KEY

  // If explicit credentials are provided, use them (local dev)
  if (projectId && clientEmail && privateKeyRaw) {
    // Parse the private key - it may be base64 encoded or have escaped newlines
    let privateKey = privateKeyRaw

    // Handle base64 encoded key
    if (privateKey.startsWith('LS0t')) {
      privateKey = Buffer.from(privateKey, 'base64').toString('utf8')
    }

    // Handle escaped newlines
    privateKey = privateKey.replace(/\\n/g, '\n')

    return initializeApp({
      credential: cert({
        projectId,
        clientEmail,
        privateKey,
      }),
    })
  }

  // On Firebase App Hosting / Google Cloud environments:
  // Use Application Default Credentials (ADC) - no explicit credentials needed.
  // Local dev can also provide FIREBASE_ADMIN_PROJECT_ID alongside ADC so the
  // AppAgentic service account targets the App Listing Agent Firebase project.
  try {
    return initializeApp(projectId ? { projectId } : undefined)
  } catch (error) {
    initializationError = error
    console.error('Firebase Admin initialization failed; admin services are unavailable.')
    return null
  }
}

const adminApp = getFirebaseAdminApp()

// Create mock implementations for dev bypass mode
const mockAuth = {
  verifyIdToken: async () => ({ uid: 'dev-user-123', email: 'dev@example.com' }),
  verifySessionCookie: async () => ({ uid: 'dev-user-123', email: 'dev@example.com' }),
  createSessionCookie: async () => 'mock-session-cookie',
  createUser: async () => ({ uid: 'dev-user-123' }),
} as unknown as Auth

// Recursive mock that supports any depth of collection/doc chaining
const createMockCollection = (collectionName = ''): any => ({
  add: async () => createMockDoc(),
  doc: () => createMockDoc(collectionName !== 'deletedAccounts'),
  where: () => ({
    limit: () => ({
      get: async () => ({ empty: true, docs: [] }),
    }),
    get: async () => ({ empty: true, docs: [] }),
  }),
  orderBy: () => ({
    get: async () => ({ docs: [] }),
  }),
  get: async () => ({ docs: [] }),
})

const createMockDoc = (exists = true): any => ({
  get: async () => ({
    exists,
    data: () => ({
      email: 'dev@example.com',
      displayName: 'Dev User',
      plan: 'business',
      planLimits: { translations: -1, screenshots: -1, apps: -1, teamMembers: 5 },
      apiKey: 'asc_dev_mock_key',
      organizationId: null,
    }),
    id: 'dev-user-123',
  }),
  set: async () => {},
  update: async () => {},
  collection: (collectionName: string) => createMockCollection(collectionName),
})

const mockFirestore = {
  collection: (collectionName: string) => createMockCollection(collectionName),
} as unknown as Firestore

function unavailableService<T extends object>(serviceName: string): T {
  const reason = initializationError instanceof Error
    ? initializationError.message
    : isBuildPhase
      ? 'Firebase Admin services cannot be used while the production bundle is being built.'
      : 'Firebase Admin could not be initialized.'

  return new Proxy({} as T, {
    get() {
      throw new Error(`${serviceName} unavailable: ${reason}`)
    },
  })
}

export const adminAuth = adminApp
  ? getAuth(adminApp)
  : shouldUseMocks
    ? mockAuth
    : unavailableService<Auth>('Firebase Admin Auth')
export const adminDb = adminApp
  ? getFirestore(adminApp)
  : shouldUseMocks
    ? mockFirestore
    : unavailableService<Firestore>('Firebase Admin Firestore')
export { adminApp }
