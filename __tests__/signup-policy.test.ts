import { afterEach, describe, expect, it, vi } from 'vitest'
import { decideSignupEligibility, emailHash, isWaitlistModeEnabled } from '@/lib/auth/signup-policy'

const base = {
  existingUser: false,
  duplicateEmail: false,
  deletedAccount: false,
  waitlistMode: true,
  internalEmail: false,
  validInvite: false,
  waitlistStatus: null,
}

describe('signup policy', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('allows existing users through the waitlist gate', () => {
    expect(decideSignupEligibility({ ...base, existingUser: true })).toMatchObject({ allowed: true, reason: 'existing_user' })
  })

  it('denies an unapproved public signup', () => {
    expect(decideSignupEligibility(base)).toEqual({ allowed: false, reason: 'not_invited', existingUser: false })
  })

  it.each(['approved', 'invited', 'converted'])('allows %s waitlist records', status => {
    expect(decideSignupEligibility({ ...base, waitlistStatus: status }).allowed).toBe(true)
  })

  it('allows a valid invite but denies a mere pending waitlist record', () => {
    expect(decideSignupEligibility({ ...base, validInvite: true }).reason).toBe('valid_invite')
    expect(decideSignupEligibility({ ...base, waitlistStatus: 'pending' }).allowed).toBe(false)
  })

  it('does not let deleted accounts reuse an old approval', () => {
    expect(decideSignupEligibility({ ...base, deletedAccount: true, waitlistStatus: 'approved' }).reason).toBe('deleted_account')
    expect(decideSignupEligibility({ ...base, existingUser: true, deletedAccount: true }).reason).toBe('deleted_account')
  })

  it('uses a stable non-PII identifier for deletion markers', () => {
    expect(emailHash(' User@Example.com ')).toBe(emailHash('user@example.com'))
    expect(emailHash('user@example.com')).not.toContain('user')
  })

  it('uses the server-owned access mode for public signup', () => {
    vi.stubEnv('SIGNUP_ACCESS_MODE', 'public')
    vi.stubEnv('NEXT_PUBLIC_WAITLIST_MODE', 'true')
    expect(isWaitlistModeEnabled()).toBe(false)

    vi.stubEnv('SIGNUP_ACCESS_MODE', 'invite_only')
    vi.stubEnv('NEXT_PUBLIC_WAITLIST_MODE', 'false')
    expect(isWaitlistModeEnabled()).toBe(true)
  })
})
