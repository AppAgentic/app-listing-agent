import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { getSession } from '@/lib/auth/session'
import { adminDb } from '@/lib/firebase/admin'
import { boundStripeCustomerId, getBillingAccount } from '@/lib/billing/account'
import { getStripeRuntime, publicAppOrigin } from '@/lib/stripe/runtime'
import { isSelfHosted } from '@/lib/selfhost/config'
import { selfHostedBillingDisabledResponse } from '@/lib/selfhost/responses'

/** Opens the Stripe customer portal (explicit configuration) for the account's own bound customer. */
export async function POST(request: NextRequest) {
  if (isSelfHosted()) return selfHostedBillingDisabledResponse()
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  const account = await getBillingAccount(session.userId)
  if (!account) return NextResponse.json({ error: 'Account not found' }, { status: 404 })
  if (!account.canManage) {
    return NextResponse.json({ error: 'Only the workspace owner can manage billing' }, { status: 403 })
  }
  const runtime = getStripeRuntime()
  if (!runtime) {
    return NextResponse.json({ error: 'Billing management is temporarily unavailable. Please try again.' }, { status: 503 })
  }
  // An organization created by a paying owner keeps the owner's personal Stripe customer.
  const customerId = boundStripeCustomerId(account.data, runtime.config.livemode, runtime.config.accountId)
    ?? boundStripeCustomerId(account.user, runtime.config.livemode, runtime.config.accountId)
  if (!customerId) {
    return NextResponse.json({ error: 'We could not find your billing portal. Contact support for help.' }, { status: 404 })
  }
  try {
    // The reverse index must still point at this account; a customer is never shared between accounts.
    const index = (await adminDb.collection('billingCustomers').doc(customerId).get()).data()
    if (![account.ref.path, `users/${session.userId}`].includes(index?.accountPath)) {
      return NextResponse.json({ error: 'We could not find your billing portal. Contact support for help.' }, { status: 404 })
    }
    const portal = await runtime.stripe.createPortalSession({
      customerId,
      configurationId: runtime.config.portalConfigurationId,
      returnUrl: `${publicAppOrigin(request.nextUrl.origin)}/billing`,
      idempotencyKey: `asc-portal-${randomUUID()}`,
    })
    const url = new URL(portal.url)
    if (url.protocol !== 'https:' || url.hostname !== 'billing.stripe.com') throw new Error('Invalid portal URL')
    return NextResponse.json({ manageUrl: url.href })
  } catch {
    return NextResponse.json({ error: 'Billing management is temporarily unavailable. Please try again.' }, { status: 503 })
  }
}
