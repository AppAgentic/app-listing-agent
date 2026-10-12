import React from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import PricingSection from '@/components/PricingSection'

vi.mock('@/components/concierge/booking-link', () => ({
  BookingLink: ({ source: _source, ...props }: any) => <a {...props} />,
  TrackedFunnelLink: ({ source: _source, ...props }: any) => <a {...props} />,
}))
afterEach(() => { cleanup(); vi.unstubAllEnvs() })

describe('pricing to onboarding trial', () => {
  it('carries the chosen annual plan into onboarding, which ends in the trial checkout', () => {
    render(<PricingSection />)
    const links = screen.getAllByRole('link', { name: 'Start 7-day free trial' })
    expect(links).toHaveLength(3)
    const url = new URL(links[1].getAttribute('href')!, 'https://applistingagent.com')
    expect(url.pathname).toBe('/onboarding')
    expect(url.searchParams.get('interval')).toBe('annual')
    expect(url.searchParams.get('plan')).toBe('pro')
    expect(screen.getByText('$2,490 billed annually')).toBeTruthy()
    // Studio annual is self-serve now.
    const studio = new URL(links[2].getAttribute('href')!, 'https://applistingagent.com')
    expect(studio.searchParams.get('plan')).toBe('business')
    expect(studio.searchParams.get('interval')).toBe('annual')
    expect(screen.queryByRole('link', { name: 'Arrange Studio annual' })).toBeNull()
  })
  it('updates both display and purchase destination when switching to monthly', () => {
    render(<PricingSection />)
    fireEvent.click(screen.getByRole('switch', { name: 'Annual billing' }))
    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('false')
    const link = screen.getAllByRole('link', { name: 'Start 7-day free trial' })[2]
    const url = new URL(link.getAttribute('href')!, 'https://applistingagent.com')
    expect(url.pathname).toBe('/onboarding')
    expect(url.searchParams.get('plan')).toBe('business')
    expect(url.searchParams.get('interval')).toBe('monthly')
    expect(within(link.parentElement!).getByText('$599')).toBeTruthy()
    expect(screen.queryByText('$5,990 billed annually')).toBeNull()
    expect(screen.getByRole('link', { name: 'Discuss Enterprise' }).getAttribute('href')).toContain('/book?')
  })
})

describe('Indie on the pricing cards', () => {
  it('is hidden until the deployment offers it, leaving the existing cards unchanged', () => {
    render(<PricingSection />)
    expect(screen.queryByRole('heading', { name: 'Indie' })).toBeNull()
    expect(screen.getAllByRole('heading', { level: 3 }).map(heading => heading.textContent)).toEqual(['Solo', 'Pro', 'Studio', 'Enterprise'])
  })
  it('shows Indie first, from the catalog, and starts its trial through onboarding', () => {
    vi.stubEnv('NEXT_PUBLIC_BILLING_INDIE_ENABLED', 'true')
    render(<PricingSection />)
    expect(screen.getAllByRole('heading', { level: 3 }).map(heading => heading.textContent)).toEqual(['Indie', 'Solo', 'Pro', 'Studio', 'Enterprise'])
    const links = screen.getAllByRole('link', { name: 'Start 7-day free trial' })
    expect(links).toHaveLength(4)
    const card = links[0].parentElement!
    expect(within(card).getByText('$490 billed annually')).toBeTruthy()
    expect(within(card).getByText('1 app')).toBeTruthy()
    expect(within(card).getByText('50 translations/mo')).toBeTruthy()
    expect(within(card).getByText('10 screenshot credits/mo')).toBeTruthy()
    expect(within(card).getByText('3 icon credits/mo')).toBeTruthy()
    expect(within(card).getByText('1 team member')).toBeTruthy()
    const url = new URL(links[0].getAttribute('href')!, 'https://applistingagent.com')
    expect(url.pathname).toBe('/onboarding')
    expect(url.searchParams.get('plan')).toBe('indie')
    expect(url.searchParams.get('interval')).toBe('annual')
    fireEvent.click(screen.getByRole('switch', { name: 'Annual billing' }))
    expect(within(links[0].parentElement!).getByText('$49')).toBeTruthy()
  })
})

