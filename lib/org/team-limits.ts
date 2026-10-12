import type { Organization } from '@/lib/firebase/firestore'
import { isVerifiedPaidEntitlement } from '@/lib/billing/entitlements'
import { PLAN_LIMITS, SELF_HOSTED_PLAN_LIMITS, normalizeUserPlan } from '@/lib/billing/catalog'
import { isSelfHosted } from '@/lib/selfhost/config'

export function getOrganizationTeamMemberLimit(
  organization: Pick<Organization, 'plan' | 'billing'>,
): number {
  if (isSelfHosted()) return SELF_HOSTED_PLAN_LIMITS.teamMembers
  const plan = isVerifiedPaidEntitlement(organization.billing)
    ? normalizeUserPlan(organization.billing?.plan)
    : 'free'
  return PLAN_LIMITS[plan].teamMembers
}

export function hasAvailableTeamSeat(currentMembers: number, limit: number): boolean {
  return limit === -1 || currentMembers < limit
}
