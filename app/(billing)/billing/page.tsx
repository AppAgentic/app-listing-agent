import { Suspense } from 'react'
import BillingClient, {
  BillingLoading,
} from '@/components/billing/billing-client'

export default function BillingPage() {
  return (
    <Suspense fallback={<BillingLoading />}>
      <BillingClient />
    </Suspense>
  )
}
