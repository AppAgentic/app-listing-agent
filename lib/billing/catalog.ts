/**
 * Single source of truth for plans, allowances, prices, and AI model costs.
 *
 * Keep this module dependency-free so it can be imported by server and client
 * code without pulling provider SDKs into the browser bundle.
 */

export type UserPlan = 'free' | 'starter' | 'pro' | 'business' | 'enterprise'

/** Plans customers can buy self-serve. Enterprise is arranged with the team. */
export type PublicBillingPlan = 'starter' | 'pro' | 'business'
export type BillingInterval = 'monthly' | 'annual'
export const PUBLIC_BILLING_PLANS: readonly PublicBillingPlan[] = ['starter', 'pro', 'business']
export const BILLING_INTERVALS: readonly BillingInterval[] = ['monthly', 'annual']

/**
 * Free trial on a customer's first subscription (product decision: trials, never a free plan).
 * Card is collected at checkout; the trial is offered once per account per Stripe mode.
 */
export const TRIAL_PERIOD_DAYS = 7

export function isPublicBillingPlan(value: unknown): value is PublicBillingPlan {
  return typeof value === 'string' && (PUBLIC_BILLING_PLANS as readonly string[]).includes(value)
}

export function isBillingInterval(value: unknown): value is BillingInterval {
  return value === 'monthly' || value === 'annual'
}

export type MeteredUsageType =
  | 'translations'
  | 'screenshots'
  | 'icons'
  | 'publishing'
  | 'apps'

export interface PlanLimits {
  translations: number
  screenshots: number
  icons: number
  publishing: number
  apps: number
  teamMembers: number
}

export interface BillingPlanDefinition {
  id: UserPlan
  name: string
  monthlyPriceUsd: number | null
  annualPriceUsd: number | null
  limits: PlanLimits
  public: boolean
}

export const BILLING_PLANS: Record<UserPlan, BillingPlanDefinition> = {
  // Hard paywall: there is no free tier. "free" only means "no paid access" and carries
  // no allowances; product access requires a trialing/active subscription or an explicit comp entitlement.
  free: {
    id: 'free',
    name: 'No plan',
    monthlyPriceUsd: 0,
    annualPriceUsd: 0,
    public: false,
    limits: {
      translations: 0,
      screenshots: 0,
      icons: 0,
      publishing: 0,
      apps: 0,
      teamMembers: 1,
    },
  },
  starter: {
    id: 'starter',
    name: 'Solo',
    monthlyPriceUsd: 99,
    annualPriceUsd: 990,
    public: true,
    limits: {
      translations: 150,
      screenshots: 30,
      icons: 10,
      publishing: -1,
      apps: 3,
      teamMembers: 1,
    },
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    monthlyPriceUsd: 249,
    annualPriceUsd: 2490,
    public: true,
    limits: {
      translations: 750,
      screenshots: 150,
      icons: 50,
      publishing: -1,
      apps: 10,
      teamMembers: 1,
    },
  },
  business: {
    id: 'business',
    name: 'Studio',
    monthlyPriceUsd: 599,
    annualPriceUsd: 5990,
    public: true,
    limits: {
      translations: 3000,
      screenshots: 750,
      icons: 200,
      publishing: -1,
      apps: -1,
      teamMembers: 5,
    },
  },
  enterprise: {
    id: 'enterprise',
    name: 'Enterprise',
    monthlyPriceUsd: null,
    annualPriceUsd: null,
    public: true,
    limits: {
      translations: 10000,
      screenshots: 2000,
      icons: 500,
      publishing: -1,
      apps: -1,
      teamMembers: -1,
    },
  },
}

/**
 * Self-hosted installs (SELF_HOSTED=true) have no billing: every allowance is unlimited. The effective
 * plan reported for them is `enterprise` so plan-gated features (scoped API keys, teams) are available.
 */
export const SELF_HOSTED_PLAN: UserPlan = 'enterprise'
export const SELF_HOSTED_PLAN_LIMITS: PlanLimits = {
  translations: -1,
  screenshots: -1,
  icons: -1,
  publishing: -1,
  apps: -1,
  teamMembers: -1,
}

export const PLAN_LIMITS: Record<UserPlan, PlanLimits> = Object.fromEntries(
  Object.entries(BILLING_PLANS).map(([plan, definition]) => [plan, definition.limits])
) as Record<UserPlan, PlanLimits>

/**
 * Public launch intentionally has no automatic overages. Several image paths
 * cost more than any simple per-unit overage would recover. Limits are hard caps until a reviewed, consented
 * usage-billing product is introduced.
 */
export const OVERAGE_RATES: Record<UserPlan, null> = {
  free: null,
  starter: null,
  pro: null,
  business: null,
  enterprise: null,
}

export function isUserPlan(value: unknown): value is UserPlan {
  return typeof value === 'string' && value in BILLING_PLANS
}

export function normalizeUserPlan(value: unknown): UserPlan {
  return isUserPlan(value) ? value : 'free'
}

export const AI_MODELS = {
  textFast: 'gemini-3.1-flash-lite',
  textQuality: 'gemini-3.5-flash',
  imageDefault: 'gemini-3.1-flash-image',
  imageEconomy: 'gemini-3.1-flash-lite-image',
  imagePremium: 'gemini-3-pro-image',
  openAiImagePremium: 'gpt-image-2.5-flare',
  kieImageDefault: 'nano-banana-2',
  falImageDefault: 'fal-ai/nano-banana-2/edit',
  falImagePremium: 'fal-ai/nano-banana-pro/edit',
} as const

export type ImageProvider = 'gemini' | 'kie' | 'fal' | 'openai'
export type ImageResolution = '0.5K' | '1K' | '2K' | '4K'

export interface ImageModelEconomics {
  provider: ImageProvider
  model: string
  resolution: ImageResolution
  estimatedCostUsd: number
  credits: number
  premium: boolean
}

export const IMAGE_MODEL_ECONOMICS: readonly ImageModelEconomics[] = [
  { provider: 'gemini', model: AI_MODELS.imageEconomy, resolution: '1K', estimatedCostUsd: 0.0336, credits: 1, premium: false },
  { provider: 'gemini', model: AI_MODELS.imageDefault, resolution: '1K', estimatedCostUsd: 0.067, credits: 1, premium: false },
  { provider: 'gemini', model: AI_MODELS.imageDefault, resolution: '2K', estimatedCostUsd: 0.101, credits: 2, premium: false },
  { provider: 'gemini', model: AI_MODELS.imageDefault, resolution: '4K', estimatedCostUsd: 0.151, credits: 3, premium: false },
  { provider: 'kie', model: AI_MODELS.kieImageDefault, resolution: '2K', estimatedCostUsd: 0.06, credits: 1, premium: false },
  { provider: 'fal', model: AI_MODELS.falImageDefault, resolution: '2K', estimatedCostUsd: 0.12, credits: 2, premium: false },
  { provider: 'fal', model: AI_MODELS.falImagePremium, resolution: '1K', estimatedCostUsd: 0.15, credits: 3, premium: true },
  { provider: 'fal', model: AI_MODELS.falImagePremium, resolution: '2K', estimatedCostUsd: 0.15, credits: 3, premium: true },
  { provider: 'openai', model: AI_MODELS.openAiImagePremium, resolution: '1K', estimatedCostUsd: 0.167, credits: 3, premium: true },
] as const

export function getImageCreditWeight(
  provider: ImageProvider,
  model?: string,
  resolution: ImageResolution = '1K'
): number {
  const normalizedModel = model || (
    provider === 'gemini' ? AI_MODELS.imageDefault
      : provider === 'kie' ? AI_MODELS.kieImageDefault
        : provider === 'fal' ? AI_MODELS.falImageDefault
          : AI_MODELS.openAiImagePremium
  )

  const exact = IMAGE_MODEL_ECONOMICS.find(item =>
    item.provider === provider && item.model === normalizedModel && item.resolution === resolution
  )
  if (exact) return exact.credits

  const modelDefault = IMAGE_MODEL_ECONOMICS.find(item =>
    item.provider === provider && item.model === normalizedModel
  )
  if (modelDefault) return modelDefault.credits

  // Unknown provider/model combinations fail expensive, never cheap.
  return 3
}
