import { adminDb } from '@/lib/firebase/admin'
import { isInternalCompanyEmail } from '@/lib/features/internal-integrations'
import { createHash } from 'crypto'

const ELIGIBLE_WAITLIST_STATUSES = new Set(['approved', 'invited', 'converted'])

export type SignupEligibilityReason =
  | 'existing_user'
  | 'waitlist_disabled'
  | 'internal_allowlist'
  | 'valid_invite'
  | 'approved_waitlist'
  | 'deleted_account'
  | 'not_invited'

export interface SignupEligibility {
  allowed: boolean
  reason: SignupEligibilityReason
  existingUser: boolean
}

export function decideSignupEligibility(input: {
  existingUser: boolean
  duplicateEmail: boolean
  deletedAccount: boolean
  waitlistMode: boolean
  internalEmail: boolean
  validInvite: boolean
  waitlistStatus?: string | null
}): SignupEligibility {
  if (input.deletedAccount) return { allowed: false, reason: 'deleted_account', existingUser: false }
  if (input.existingUser) return { allowed: true, reason: 'existing_user', existingUser: true }
  if (input.duplicateEmail) return { allowed: false, reason: 'not_invited', existingUser: false }
  if (!input.waitlistMode) return { allowed: true, reason: 'waitlist_disabled', existingUser: false }
  if (input.internalEmail) return { allowed: true, reason: 'internal_allowlist', existingUser: false }
  if (input.validInvite) return { allowed: true, reason: 'valid_invite', existingUser: false }
  if (input.waitlistStatus && ELIGIBLE_WAITLIST_STATUSES.has(input.waitlistStatus)) {
    return { allowed: true, reason: 'approved_waitlist', existingUser: false }
  }
  return { allowed: false, reason: 'not_invited', existingUser: false }
}

export function isWaitlistModeEnabled(): boolean {
  if (process.env.SIGNUP_ACCESS_MODE === 'public') return false
  if (process.env.SIGNUP_ACCESS_MODE === 'invite_only') return true
  return process.env.NEXT_PUBLIC_WAITLIST_MODE !== 'false'
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

function inviteIsUsable(invite: { email: string; status: string; expiresAt: { toDate(): Date } }, email: string): boolean {
  return invite.email.trim().toLowerCase() === email
    && invite.status === 'pending'
    && invite.expiresAt.toDate().getTime() > Date.now()
}

/**
 * Server-side source of truth for creating an App Listing Agent account.
 * Public clients may choose which UI to show, but they cannot grant access.
 */
export async function checkSignupEligibility(input: {
  email: string
  firebaseUid?: string
  inviteToken?: string | null
}): Promise<SignupEligibility> {
  const email = normalizeEmail(input.email)
  let existingUser = false

  if (input.firebaseUid) {
    const user = await adminDb.collection('users').doc(input.firebaseUid).get()
    existingUser = user.exists
  }

  // Prevent a second Firebase identity from claiming an existing workspace.
  const sameEmailUser = await adminDb.collection('users').where('email', '==', email).limit(1).get()
  const duplicateEmail = !sameEmailUser.empty

  const deletedAccount = await adminDb.collection('deletedAccounts').doc(emailHash(email)).get()

  if (existingUser || deletedAccount.exists) return decideSignupEligibility({
    existingUser,
    duplicateEmail,
    deletedAccount: deletedAccount.exists,
    waitlistMode: isWaitlistModeEnabled(),
    internalEmail: false,
    validInvite: false,
  })

  let validInvite = false
  if (input.inviteToken) {
    const { findInviteByToken } = await import('@/lib/org/invites')
    const result = await findInviteByToken(input.inviteToken)
    validInvite = Boolean(result && inviteIsUsable(result.invite, email))
  }

  const waitlist = await adminDb.collection('waitlist').where('email', '==', email).limit(1).get()
  const status = waitlist.empty ? null : waitlist.docs[0].data().status
  return decideSignupEligibility({
    existingUser,
    duplicateEmail,
    deletedAccount: deletedAccount.exists,
    waitlistMode: isWaitlistModeEnabled(),
    // Reuse the existing server-only company allowlist. No browser-visible
    // bypass key or new secret is needed for staff accounts.
    internalEmail: isInternalCompanyEmail(email),
    validInvite,
    waitlistStatus: typeof status === 'string' ? status : null,
  })
}

export function emailHash(email: string): string {
  return createHash('sha256').update(normalizeEmail(email)).digest('hex')
}
