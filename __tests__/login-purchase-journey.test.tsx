import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  params: new URLSearchParams(),
  push: vi.fn(),
  credential: { user: { getIdToken: vi.fn().mockResolvedValue('test-token') } },
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }), useSearchParams: () => mocks.params }))
vi.mock('next/image', () => ({ default: ({ unoptimized: _unoptimized, ...props }: any) => <img {...props} /> }))
vi.mock('@/components/Starfield', () => ({ default: () => null }))
vi.mock('@/lib/firebase/client', () => ({ auth: {} }))
vi.mock('firebase/auth', () => ({
  signInWithEmailAndPassword: vi.fn().mockResolvedValue(mocks.credential),
  createUserWithEmailAndPassword: vi.fn().mockResolvedValue(mocks.credential),
  signInWithPopup: vi.fn().mockResolvedValue(mocks.credential),
  GoogleAuthProvider: vi.fn(), sendPasswordResetEmail: vi.fn(),
}))
vi.mock('@/lib/marketing/attribution', () => ({ resolveMarketingAttribution: () => ({}) }))
vi.mock('@/lib/analytics/client', () => ({ trackEvent: vi.fn() }))
import LoginPage from '@/app/(auth)/login/page'

beforeEach(() => {
  mocks.push.mockClear()
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ onboardingCompleted: false }) }))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

async function createAccount() {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'test@example.com' } })
  fireEvent.change(screen.getByLabelText('Password', { exact: true }), { target: { value: 'test-password' } })
  fireEvent.change(screen.getByLabelText('Confirm Password'), { target: { value: 'test-password' } })
  fireEvent.click(screen.getByRole('button', { name: 'Create account' }))
}

describe('signup with purchase intent', () => {
  it('shows the selection and reaches annual review before store onboarding without a payment call', async () => {
    mocks.params = new URLSearchParams('mode=signup&plan=pro&interval=annual')
    render(<LoginPage />)
    expect(screen.getByText('Pro · Annual billing')).toBeTruthy()
    await createAccount()
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith('/billing?plan=pro&interval=annual'))
    expect(vi.mocked(fetch).mock.calls.map(call => call[0])).toEqual(['/api/auth/signup-eligibility', '/api/auth/session'])
  })
  it('retains the intended destination through onboarding for ordinary signup', async () => {
    mocks.params = new URLSearchParams('mode=signup&returnTo=%2Fprojects')
    render(<LoginPage />)
    await createAccount()
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith('/onboarding?returnTo=%2Fprojects'))
  })
})
