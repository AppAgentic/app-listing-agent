import { describe, expect, it, vi } from 'vitest'

vi.unmock('@/lib/firebase/admin')

describe('Firebase Admin development mocks', () => {
  it('does not mark every email as a deleted account', async () => {
    const { adminDb } = await import('@/lib/firebase/admin')
    const deletedAccount = await adminDb.collection('deletedAccounts').doc('new-email-hash').get()
    const user = await adminDb.collection('users').doc('dev-user-123').get()

    expect(deletedAccount.exists).toBe(false)
    expect(user.exists).toBe(true)
  })
})
