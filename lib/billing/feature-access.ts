import type { UserPlan } from './catalog'

export function canUseScopedApiKeys(plan: UserPlan): boolean {
  return plan === 'pro' || plan === 'business' || plan === 'enterprise'
}
