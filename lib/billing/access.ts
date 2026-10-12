import { hasInternalIntegrationAccess } from '@/lib/features/internal-integrations'
import type { AccountContext } from '@/lib/org/context'
import { appOrigin } from '@/lib/routing/app-url'
import { isSelfHosted } from '@/lib/selfhost/config'
import { hasExistingSubscription } from './account'
import { isVerifiedPaidEntitlement } from './entitlements'
import { validReviewGrant } from './review-grant'

/**
 * Hard paywall (product decision, 2026-09-17): there is no free tier. The product requires a trialing, active or
 * payment-retrying Stripe subscription. The only other ways in are explicit, auditable comp entitlements:
 * - `comp_internal`: the internal/comp allowlist (`INTERNAL_INTEGRATION_ALLOWED_USER_IDS` / `_ORG_IDS` /
 *   `_EMAILS` / `_DOMAINS` in apphosting.yaml, version-controlled). Covers the internal Solo accounts.
 * - `review_grant`: a valid, month-bounded, server-issued store/app reviewer grant (`billing.reviewGrant`).
 * - `self_hosted`: an open-source self-hosted install (`SELF_HOSTED=true`, see lib/selfhost/config.ts).
 *   Billing is off there, so every signed-in account has access. Never true on our live deployment.
 */
export type ProductAccessReason = 'subscription' | 'comp_internal' | 'review_grant' | 'self_hosted'

export interface ProductAccess {
  allowed: boolean
  reason: ProductAccessReason | null
  /** A subscription exists but needs a payment fix (portal) rather than a new checkout. */
  recoverable: boolean
  /** The caller belongs to an organization it does not own, so only the owner can pay. */
  ownerMustPay: boolean
}

export function getProductAccess(context: AccountContext, now = new Date()): ProductAccess {
  const organization = context.type === 'organization' ? context.organization : undefined
  const account = organization ?? context.user
  const ownerMustPay = Boolean(organization && organization.ownerId !== context.userId)
  if (isSelfHosted()) return { allowed: true, reason: 'self_hosted', recoverable: false, ownerMustPay: false }
  if (hasInternalIntegrationAccess(context)) return { allowed: true, reason: 'comp_internal', recoverable: false, ownerMustPay }
  if (isVerifiedPaidEntitlement(account.billing)) return { allowed: true, reason: 'subscription', recoverable: false, ownerMustPay }
  if (context.type === 'personal' && !context.user.organizationId &&
      validReviewGrant(context.user.billing?.reviewGrant, context.userId, now)) {
    return { allowed: true, reason: 'review_grant', recoverable: false, ownerMustPay }
  }
  return { allowed: false, reason: null, recoverable: hasExistingSubscription(account), ownerMustPay }
}

export const PAYMENT_REQUIRED_CODE = 'payment_required'

/** App-owned, agent-actionable payment-required payload for REST and MCP. Never a raw provider URL. */
export function paymentRequiredPayload(access: Pick<ProductAccess, 'recoverable' | 'ownerMustPay'>, origin = appOrigin()) {
  const reason = access.recoverable ? 'payment_failed' : 'subscription_required'
  const billingUrl = `${origin}/billing?reason=${reason}`
  return {
    success: false,
    code: PAYMENT_REQUIRED_CODE,
    error: access.recoverable
      ? 'The App Listing Agent subscription for this workspace needs a payment update before it can be used.'
      : 'App Listing Agent requires an active subscription. New workspaces start with a 7-day free trial.',
    billingUrl,
    nextStep: access.ownerMustPay
      ? `Ask the workspace owner to open ${billingUrl} and start or fix the subscription, then retry this request.`
      : `Ask the user to open ${billingUrl} in a browser signed in to App Listing Agent, ${access.recoverable ? 'update the payment method' : 'start a plan (7-day free trial for new workspaces)'}, then retry this request.`,
  }
}
