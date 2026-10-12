import type { Metadata } from 'next'
import { Suspense } from 'react'
import { BookingForm } from '@/components/concierge/booking-form'
import { pageMetadata } from '@/lib/seo/site'

// The booking form renders client-side only, so the page is kept out of the
// index (noindex, follow) and out of the sitemap. Links to it still count.
export const metadata: Metadata = pageMetadata({
  title: 'Book your app setup',
  description: 'Bring one app. Leave with your stores connected, your AI agent paired, and a prioritized readiness report.',
  path: '/book',
  robots: { index: false, follow: true },
})
export default function BookPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#070807]" />}>
      <BookingForm />
    </Suspense>
  )
}
