import { redirect } from 'next/navigation'
import { getAccountContext } from '@/lib/org/context'
import { getProductAccess } from './access'
import { isUnpaidPagePath } from './paywall-routes'

/**
 * Hard paywall for product pages. Unpaid accounts go to the onboarding trial step; an account whose
 * subscription needs a payment fix, or a teammate whose owner must pay, goes to the billing page.
 */
export async function requireProductAccessForPage(userId: string, returnTo: string): Promise<void> {
  const path = returnTo.split('?')[0]
  if (isUnpaidPagePath(path)) return
  const context = await getAccountContext(userId)
  const access = context ? getProductAccess(context) : null
  if (access?.allowed) return
  if (access?.recoverable) redirect('/billing?reason=payment_failed')
  if (access?.ownerMustPay) redirect('/billing?reason=subscription_required')
  redirect(`/onboarding?returnTo=${encodeURIComponent(returnTo)}`)
}
