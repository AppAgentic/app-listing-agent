import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth/session'
import { adminDb } from '@/lib/firebase/admin'
import { getBillingAccount, hasExistingSubscription } from '@/lib/billing/account'
import { CheckoutConflict, prepareSubscriptionCheckout } from '@/lib/billing/checkout'
import { recordConciergeEventForUser } from '@/lib/concierge-server'
import { sanitizeMarketingAttribution } from '@/lib/marketing/attribution'
import { BILLING_PLANS, offeredBillingPlans, type PublicBillingPlan } from '@/lib/billing/catalog'
import { isBillingCheckoutEnabled, isPlanPurchasable } from '@/lib/stripe/config'
import { getStripeRuntime, publicAppOrigin } from '@/lib/stripe/runtime'
import { isSelfHosted } from '@/lib/selfhost/config'
import { selfHostedBillingDisabledResponse } from '@/lib/selfhost/responses'

const requestSchema = z.object({
  plan: z.enum(['indie', 'starter', 'pro', 'business']) satisfies z.ZodType<PublicBillingPlan>,
  interval: z.enum(['monthly', 'annual']).default('monthly'),
  attribution: z.unknown().optional(),
  placement: z.enum(['billing', 'onboarding']).optional(),
})

const orList = (items: string[]) => items.length > 1 ? `${items.slice(0, -1).join(', ')} or ${items[items.length - 1]}` : items.join('')

export async function POST(request: NextRequest) {
  if (isSelfHosted()) return selfHostedBillingDisabledResponse()
  const runtime = isBillingCheckoutEnabled() ? getStripeRuntime() : null
  if (!runtime) {
    return NextResponse.json({ error: 'Billing checkout is not available yet' }, { status: 503 })
  }

  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }
  const account = await getBillingAccount(session.userId)
  if (!account) return NextResponse.json({ error: 'Account not found' }, { status: 404 })
  if (!account.canManage) {
    return NextResponse.json({ error: 'Only the workspace owner can change the plan' }, { status: 403 })
  }
  if (session.plan !== 'free' || hasExistingSubscription(account.data) || hasExistingSubscription(account.user)) {
    return NextResponse.json(
      { error: 'Manage or recover your existing subscription to avoid a second subscription.', code: 'existing_subscription' },
      { status: 409 }
    )
  }

  const parsed = requestSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid checkout request' }, { status: 400 })
  }
  // A plan added after launch (Indie) is sellable only once its Stripe prices exist and it is switched on.
  if (!isPlanPurchasable(runtime.config, parsed.data.plan)) {
    const available = offeredBillingPlans().filter(plan => isPlanPurchasable(runtime.config, plan)).map(plan => BILLING_PLANS[plan].name)
    return NextResponse.json(
      {
        error: `The ${BILLING_PLANS[parsed.data.plan].name} plan is not available yet.${available.length ? ` Choose ${orList(available)}.` : ''}`,
        code: 'plan_unavailable',
      },
      { status: 409 }
    )
  }

  try {
    const attribution = sanitizeMarketingAttribution(parsed.data.attribution)
      || sanitizeMarketingAttribution(account.user.marketingAttribution?.lastTouch)
    const checkout = await prepareSubscriptionCheckout({
      db: adminDb,
      stripe: runtime.stripe,
      config: runtime.config,
      accountRef: account.ref,
      actorUserId: session.userId,
      email: session.email,
      plan: parsed.data.plan,
      interval: parsed.data.interval,
      origin: publicAppOrigin(request.nextUrl.origin),
      attribution,
      cancelPath: parsed.data.placement === 'onboarding' ? '/onboarding' : '/billing',
    })
    await recordConciergeEventForUser(session.userId, 'checkout_started', {
      plan: parsed.data.plan,
      interval: parsed.data.interval,
      trial: checkout.trialDays > 0,
      ...(attribution?.source ? { source: attribution.source } : {}),
      ...(attribution?.campaign ? { campaign: attribution.campaign } : {}),
    }).catch(() => { /* Analytics must never strand a prepared checkout. */ })
    return NextResponse.json({ id: checkout.id, purchaseUrl: checkout.purchaseUrl, trialDays: checkout.trialDays })
  } catch (error) {
    if (error instanceof CheckoutConflict) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.code === 'billing_permission_changed' ? 403 : 409 })
    }
    console.error('Failed to create billing checkout')
    return NextResponse.json(
      { error: 'Billing checkout is temporarily unavailable' },
      { status: 503 }
    )
  }
}
