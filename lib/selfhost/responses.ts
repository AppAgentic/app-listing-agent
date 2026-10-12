import { NextResponse } from 'next/server'

/** Billing routes (checkout, portal, reconcile, Stripe webhook) do not exist on a self-hosted install. */
export function selfHostedBillingDisabledResponse(): NextResponse {
  return NextResponse.json(
    { error: 'Billing is disabled on this self-hosted install.', code: 'billing_disabled_self_hosted' },
    { status: 404, headers: { 'Cache-Control': 'no-store' } },
  )
}
