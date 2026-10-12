import React from 'react'
import { cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const navigation = vi.hoisted(() => ({ pathname: '/' }))
vi.mock('next/navigation', () => ({ usePathname: () => navigation.pathname }))

import { ProductAnalytics } from '@/components/analytics/product-analytics'
import { forgetAnalyticsIdentity, trackFunnelCta } from '@/lib/analytics/client'
import { VISITOR_STORAGE_KEY, parseClientEvent } from '@/lib/analytics/events'
import { MARKETING_ATTRIBUTION_STORAGE_KEY } from '@/lib/marketing/attribution'

const bodies = () => vi.mocked(fetch).mock.calls
  .filter(call => call[0] === '/api/public/events')
  .map(call => JSON.parse(String((call[1] as RequestInit).body)))

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  navigation.pathname = '/'
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })))
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('browser product analytics', () => {
  it('tracks on first page load without consent', async () => {
    localStorage.setItem(MARKETING_ATTRIBUTION_STORAGE_KEY, JSON.stringify({ source: 'Meta', fbclid: 'click-secret' }))
    render(<ProductAnalytics />)
    await waitFor(() => expect(bodies()).toHaveLength(1))
    const [body] = bodies()
    const init = vi.mocked(fetch).mock.calls[0][1] as RequestInit
    expect(init).toMatchObject({ method: 'POST', credentials: 'same-origin', keepalive: true })
    expect(body).toMatchObject({ v: 1, event: 'page_view', surface: 'home', source: 'meta' })
    expect(body.visitor_id).toBe(localStorage.getItem(VISITOR_STORAGE_KEY))
    expect(parseClientEvent(body)).not.toBeNull()
    expect(JSON.stringify(body)).not.toContain('click-secret')
  })

  it('sends a page_view per route change with ids-free surfaces and keeps the visitor id', async () => {
    const view = render(<ProductAnalytics />)
    navigation.pathname = '/projects/proj_secret_1/screenshots'
    view.rerender(<ProductAnalytics />)
    await waitFor(() => expect(bodies()).toHaveLength(2))
    const [first, second] = bodies()
    expect(second.surface).toBe('project_screenshots')
    expect(second.visitor_id).toBe(first.visitor_id)
    expect(JSON.stringify(bodies())).not.toContain('proj_secret_1')
  })

  it('maps existing funnel CTAs to allow-listed events and forgets ids after account deletion', () => {
    trackFunnelCta('hero_self_service', '/login?mode=signup&source=hero')
    trackFunnelCta('nav', '/book?source=nav')
    trackFunnelCta('pricing_pro_self_service', '/onboarding?plan=pro&interval=annual&reason=pricing')
    trackFunnelCta('unrelated_source', '/somewhere')
    const sent = bodies()
    expect(sent.map(body => [body.event, body.props])).toEqual([
      ['signup_cta_clicked', { placement: 'hero' }],
      ['booking_cta_clicked', { placement: 'nav' }],
      ['plan_selected', { plan: 'pro', placement: 'pricing', interval: 'year' }],
    ])
    for (const body of sent) expect(parseClientEvent(body)).not.toBeNull()
    forgetAnalyticsIdentity()
    expect(localStorage.getItem(VISITOR_STORAGE_KEY)).toBeNull()
  })
})
