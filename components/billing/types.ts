import type { UserPlan } from '@/lib/billing/catalog'

export interface UsageItem {
  used: number
  reserved?: number
  limit: number
}
export interface BillingUsage {
  translations: UsageItem
  screenshots: UsageItem
  icons: UsageItem
  uploads: UsageItem
  apps: UsageItem
  month: string
}
export interface BillingSubscription {
  plan: UserPlan
  status: string
  renewsAt: string | null
  trialEndsAt?: string | null
  cancelledAt: string | null
  billingInterval: 'monthly' | 'annual' | null
  cancelAtPeriodEnd: boolean
  hasExistingSubscription: boolean
  canManageBilling: boolean
  canOpenPortal?: boolean
  subscriptionId?: string | null
  trialEligible?: boolean
  trialDays?: number
}
export type ActivationState = 'none' | 'pending' | 'confirmed' | 'delayed'
