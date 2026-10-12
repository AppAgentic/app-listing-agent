import { afterEach, describe, expect, it, vi } from 'vitest'

vi.unmock('@/lib/firebase/admin')

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe('Firebase Admin runtime fallback', () => {
  it('retains deterministic mocks in the test environment', async () => {
    vi.stubEnv('NODE_ENV', 'test')
    vi.stubEnv('NEXT_PHASE', '')

    const { adminApp, adminAuth } = await import('@/lib/firebase/admin')

    expect(adminApp).toBeNull()
    await expect(adminAuth.verifyIdToken('test-token')).resolves.toMatchObject({ uid: 'dev-user-123' })
  })

  it('allows an explicit local-development mock opt-in', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('FIREBASE_ADMIN_USE_MOCKS', 'true')
    vi.stubEnv('NEXT_PHASE', '')

    const { adminApp, adminDb } = await import('@/lib/firebase/admin')

    expect(adminApp).toBeNull()
    await expect(adminDb.collection('projects').get()).resolves.toEqual({ docs: [] })
  })

  it('fails closed instead of exposing mocks in production builds', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('FIREBASE_ADMIN_USE_MOCKS', 'true')
    vi.stubEnv('NEXT_PHASE', 'phase-production-build')

    const { adminApp, adminAuth, adminDb } = await import('@/lib/firebase/admin')

    expect(adminApp).toBeNull()
    expect(() => adminAuth.verifyIdToken).toThrow(/Firebase Admin Auth unavailable/)
    expect(() => adminDb.collection).toThrow(/Firebase Admin Firestore unavailable/)
  })
})
