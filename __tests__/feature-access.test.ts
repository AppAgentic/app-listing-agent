import { afterEach, describe, expect, it, vi } from 'vitest'
import { SANDBOX_STRIPE_ACCOUNT_ID } from '@/lib/stripe/config'

afterEach(() => vi.unstubAllEnvs())
import { canUseScopedApiKeys } from '@/lib/billing/feature-access'
import { getOrganizationTeamMemberLimit, hasAvailableTeamSeat } from '@/lib/org/team-limits'

describe('commercial feature access', () => {
  it('limits scoped API keys to Pro and higher', () => {
    expect(canUseScopedApiKeys('free')).toBe(false)
    expect(canUseScopedApiKeys('starter')).toBe(false)
    expect(canUseScopedApiKeys('pro')).toBe(true)
    expect(canUseScopedApiKeys('business')).toBe(true)
    expect(canUseScopedApiKeys('enterprise')).toBe(true)
  })

  it('enforces bounded team seats and preserves unlimited enterprise seats', () => {
    expect(hasAvailableTeamSeat(4, 5)).toBe(true)
    expect(hasAvailableTeamSeat(5, 5)).toBe(false)
    expect(hasAvailableTeamSeat(500, -1)).toBe(true)
  })

  it('derives team seats only from a verified billing entitlement', () => {
    vi.stubEnv('STRIPE_ACCOUNT_ID', SANDBOX_STRIPE_ACCOUNT_ID)
    vi.stubEnv('STRIPE_LIVEMODE', 'false')
    expect(getOrganizationTeamMemberLimit({ plan: 'business', billing: undefined } as any)).toBe(1)
    const billing = {
      source: 'stripe',
      status: 'active',
      subscriptionId: 'sub_membership1',
      livemode: false,
      providerAccountId: SANDBOX_STRIPE_ACCOUNT_ID,
      plan: 'business',
    }
    expect(getOrganizationTeamMemberLimit({ plan: 'free', billing } as any)).toBe(5)
    // A legacy provider record never grants seats.
    expect(getOrganizationTeamMemberLimit({ plan: 'free', billing: { ...billing, source: 'whop' } } as any)).toBe(1)
  })
})
