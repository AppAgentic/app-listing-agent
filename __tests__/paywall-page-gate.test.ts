import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ context: vi.fn() }))
vi.mock('next/navigation', () => ({ redirect: (url: string) => { throw new Error(`REDIRECT ${url}`) } }))
vi.mock('@/lib/org/context', () => ({ getAccountContext: mocks.context }))
import { requireProductAccessForPage } from '@/lib/billing/page-gate'
import { SANDBOX_STRIPE_ACCOUNT_ID } from '@/lib/stripe/config'

const SANDBOX = SANDBOX_STRIPE_ACCOUNT_ID
const ctx = (billing?: Record<string, unknown>) => ({ type: 'personal', userId: 'u1', user: { email: 'u@example.com', organizationId: null, ...(billing ? { billing } : {}) } })

beforeEach(() => { vi.stubEnv('STRIPE_ACCOUNT_ID', SANDBOX); vi.stubEnv('STRIPE_LIVEMODE', 'false') })
afterEach(() => vi.unstubAllEnvs())

describe('dashboard page paywall', () => {
  it('sends an unentitled user to the onboarding trial step, keeping the return path', async () => {
    mocks.context.mockResolvedValue(ctx())
    await expect(requireProductAccessForPage('u1', '/dashboard?tab=apps')).rejects.toThrow('REDIRECT /onboarding?returnTo=%2Fdashboard%3Ftab%3Dapps')
  })
  it('sends a subscription needing a payment fix to billing', async () => {
    mocks.context.mockResolvedValue(ctx({ source: 'stripe', status: 'incomplete', plan: 'free', subscriptionId: 'sub_pagegate0001', livemode: false, providerAccountId: SANDBOX }))
    await expect(requireProductAccessForPage('u1', '/dashboard')).rejects.toThrow('REDIRECT /billing?reason=payment_failed')
  })
  it('allows trialing accounts and keeps settings (account deletion) open', async () => {
    mocks.context.mockResolvedValue(ctx({ source: 'stripe', status: 'trialing', plan: 'pro', subscriptionId: 'sub_pagegate0002', livemode: false, providerAccountId: SANDBOX }))
    await expect(requireProductAccessForPage('u1', '/dashboard')).resolves.toBeUndefined()
    mocks.context.mockResolvedValue(ctx())
    await expect(requireProductAccessForPage('u1', '/settings')).resolves.toBeUndefined()
  })
})
