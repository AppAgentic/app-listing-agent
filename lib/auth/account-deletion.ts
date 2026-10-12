import { isVerifiedPaidEntitlement } from '@/lib/billing/entitlements'

export type AccountDeletionAssessment =
  | { allowed: true; deleteOrganization: boolean }
  | { allowed: false; code: 'confirmation_mismatch' | 'active_subscription' | 'transfer_ownership' | 'membership_inconsistent'; message: string }

export function assessAccountDeletion(input: {
  email: string
  confirmation: string
  userBilling?: any
  organizationBilling?: any
  organizationRole?: string | null
  organizationMemberCount?: number
}): AccountDeletionAssessment {
  if (input.confirmation.trim().toLowerCase() !== input.email.trim().toLowerCase()) {
    return {
      allowed: false,
      code: 'confirmation_mismatch',
      message: 'Type your account email exactly to confirm deletion.',
    }
  }

  if (isVerifiedPaidEntitlement(input.userBilling)) {
    return {
      allowed: false,
      code: 'active_subscription',
      message: 'Cancel your active subscription before deleting your account.',
    }
  }

  if (input.organizationRole === null) {
    return {
      allowed: false,
      code: 'membership_inconsistent',
      message: 'Your organization membership needs support review before this account can be deleted.',
    }
  }

  if (input.organizationRole === 'owner') {
    if ((input.organizationMemberCount || 0) > 1) {
      return {
        allowed: false,
        code: 'transfer_ownership',
        message: 'Transfer organization ownership or remove the other members before deleting your account.',
      }
    }
    if (isVerifiedPaidEntitlement(input.organizationBilling)) {
      return {
        allowed: false,
        code: 'active_subscription',
        message: 'Cancel the organization subscription before deleting the owner account.',
      }
    }
    return { allowed: true, deleteOrganization: true }
  }

  return { allowed: true, deleteOrganization: false }
}
