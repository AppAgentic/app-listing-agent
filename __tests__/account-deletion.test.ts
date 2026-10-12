import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { assessAccountDeletion } from '@/lib/auth/account-deletion'
import { SANDBOX_STRIPE_ACCOUNT_ID } from '@/lib/stripe/config'

const activeBilling = {
  source: 'stripe',
  status: 'active',
  subscriptionId: 'sub_123456789',
  livemode: false,
  providerAccountId: SANDBOX_STRIPE_ACCOUNT_ID,
  plan: 'pro',
}

beforeEach(() => {
  vi.stubEnv('STRIPE_ACCOUNT_ID', SANDBOX_STRIPE_ACCOUNT_ID)
  vi.stubEnv('STRIPE_LIVEMODE', 'false')
})
afterEach(() => vi.unstubAllEnvs())

describe('account deletion safeguards', () => {
  it('requires an exact, case-insensitive email confirmation', () => {
    expect(assessAccountDeletion({ email: 'owner@example.com', confirmation: 'wrong@example.com' })).toMatchObject({ allowed: false, code: 'confirmation_mismatch' })
    expect(assessAccountDeletion({ email: 'Owner@Example.com', confirmation: 'owner@example.com' }).allowed).toBe(true)
  })

  it('blocks deletion while a personal subscription is active', () => {
    expect(assessAccountDeletion({ email: 'a@b.com', confirmation: 'a@b.com', userBilling: activeBilling })).toMatchObject({ allowed: false, code: 'active_subscription' })
  })

  it('requires an owner to transfer a multi-member organization', () => {
    expect(assessAccountDeletion({
      email: 'a@b.com', confirmation: 'a@b.com', organizationRole: 'owner', organizationMemberCount: 2,
    })).toMatchObject({ allowed: false, code: 'transfer_ownership' })
  })

  it('deletes a sole-owner organization and only detaches a regular member', () => {
    expect(assessAccountDeletion({
      email: 'a@b.com', confirmation: 'a@b.com', organizationRole: 'owner', organizationMemberCount: 1,
    })).toEqual({ allowed: true, deleteOrganization: true })
    expect(assessAccountDeletion({
      email: 'a@b.com', confirmation: 'a@b.com', organizationRole: 'member', organizationMemberCount: 4,
    })).toEqual({ allowed: true, deleteOrganization: false })
  })

  it('blocks an inconsistent organization link for support review', () => {
    expect(assessAccountDeletion({
      email: 'a@b.com', confirmation: 'a@b.com', organizationRole: null, organizationMemberCount: 0,
    })).toMatchObject({ allowed: false, code: 'membership_inconsistent' })
  })
})
