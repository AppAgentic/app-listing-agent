import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import FastlanePage, { generateMetadata } from '@/app/(public)/compare/fastlane/page'
import sitemap from '@/app/sitemap'
import { updatedMonth, withCurrentYear } from '@/lib/seo/title-year'

vi.mock('@/components/concierge/booking-link', () => ({
  BookingLink: ({ source: _source, ...props }: any) => <a {...props} />,
  TrackedFunnelLink: ({ source: _source, ...props }: any) => <a {...props} />,
}))

afterEach(() => vi.useRealTimers())

describe('comparison title year rollover', () => {
  it('rolls title, Open Graph and H1 together without changing editorial dates or URL', () => {
    vi.useFakeTimers()
    for (const [instant, year] of [
      ['2026-12-31T23:59:59Z', '2026'],
      ['2027-01-01T00:00:00Z', '2027'],
    ]) {
      vi.setSystemTime(new Date(instant))
      const metadata = generateMetadata()
      expect(metadata.title).toEqual({ absolute: `App Listing Agent vs fastlane: an honest comparison (${year})` })
      expect(metadata.openGraph?.title).toBe(`App Listing Agent vs fastlane: an honest comparison (${year})`)
      expect(metadata.alternates?.canonical).toBe('/compare/fastlane')
      const html = renderToStaticMarkup(<FastlanePage />)
      expect(html).toContain(`App Listing Agent vs fastlane (${year})</h1>`)
      expect(html).toContain('September 2026</time>')
      expect(html).toContain('"dateModified":"2026-09-28"')
      expect(sitemap().find(entry => entry.url.endsWith('/compare/fastlane'))?.lastModified).toBe('2026-09-28')
    }
  })

  it('uses UTC for both the year and the real updated month', () => {
    expect(withCurrentYear('Comparison', new Date('2027-01-01T00:30:00+01:00'))).toBe('Comparison (2026)')
    expect(updatedMonth('2026-09-28')).toBe('September 2026')
  })
})
