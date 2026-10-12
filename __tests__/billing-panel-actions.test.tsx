import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BillingPanel, type BillingPanelProps } from '@/components/billing/billing-panel'

const base = (): BillingPanelProps => ({
  subscription: { plan: 'free', status: 'free', renewsAt: null, cancelledAt: null, billingInterval: null, cancelAtPeriodEnd: false, hasExistingSubscription: false, canManageBilling: true },
  usage: null, selectedPlan: 'pro', interval: 'monthly', activation: 'none', busy: null,
  refreshing: false, error: null, checkoutEnabled: true,
  onPlan: vi.fn(), onInterval: vi.fn(), onCheckout: vi.fn(), onManage: vi.fn(), onRefresh: vi.fn(),
})
afterEach(() => { cleanup(); vi.unstubAllEnvs() })

describe('billing action boundaries', () => {
  it.each(['active', 'trialing', 'past_due', 'unresolved'])('offers existing %s members management, never a second checkout', status => {
    const props = base()
    props.subscription = { ...props.subscription, plan: status === 'past_due' ? 'free' : 'pro', status, subscriptionId: 'sub_test000001', hasExistingSubscription: true }
    render(<BillingPanel {...props} />)
    expect(screen.queryByRole('button', { name: /Continue to secure checkout/ })).toBeNull()
    const management = screen.getAllByRole('button', { name: /Manage subscription|Update payment method|Recover subscription|Change plan in billing portal/ })
    expect(management.length).toBeGreaterThan(0)
    fireEvent.click(management[0])
    expect(props.onManage).toHaveBeenCalledOnce()
    expect(props.onCheckout).not.toHaveBeenCalled()
    if (status === 'past_due' || status === 'unresolved') expect(screen.getByText('Payment needs attention')).toBeTruthy()
  })
  it.each(['free', 'active', 'past_due'])('does not offer mutations to nonowners on %s', status => {
    const props = base()
    props.subscription = { ...props.subscription, plan: status === 'active' ? 'pro' : 'free', status, hasExistingSubscription: status !== 'free', canManageBilling: false }
    render(<BillingPanel {...props} />)
    expect(screen.queryByRole('button', { name: /checkout|Manage subscription|Update payment method|Recover subscription|Review changes/i })).toBeNull()
    expect(screen.getByText(/Only the workspace owner/)).toBeTruthy()
  })
  it.each(['pending', 'delayed'] as const)('blocks another checkout while payment is %s', activation => {
    const props = { ...base(), activation }
    render(<BillingPanel {...props} />)
    expect(screen.queryByRole('button', { name: /Continue to secure checkout/ })).toBeNull()
    expect(screen.getByRole('status').textContent).not.toMatch(/ready to use/)
  })
  it('sells Studio annual self-serve with its complete yearly total', () => {
    render(<BillingPanel {...base()} selectedPlan="business" interval="annual" />)
    expect(screen.getByText(/\$5,990\.00 USD per year/)).toBeTruthy()
    expect(screen.queryByRole('link', { name: /Contact sales/ })).toBeNull()
    expect(screen.getByRole('button', { name: /Continue to secure checkout/ })).toBeTruthy()
  })
  it('routes existing members to sales only for Enterprise', () => {
    const props = base()
    props.subscription = { ...props.subscription, plan: 'pro', status: 'active', hasExistingSubscription: true }
    render(<BillingPanel {...props} selectedPlan="enterprise" interval="annual" />)
    expect(screen.getByRole('link', { name: /Contact sales/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Continue to secure checkout/ })).toBeNull()
    cleanup()
    render(<BillingPanel {...props} selectedPlan="business" interval="annual" />)
    expect(screen.getByRole('button', { name: /Change plan in billing portal/ })).toBeTruthy()
  })
  it('offers the free trial to an eligible account with the price that follows', () => {
    const props = base()
    props.subscription = { ...props.subscription, trialEligible: true, trialDays: 7 }
    render(<BillingPanel {...props} />)
    const start = screen.getByRole('button', { name: /Start 7-day free trial/ })
    expect(screen.getByText(/Free for 7 days, then \$249\.00 USD per month/)).toBeTruthy()
    expect(screen.getByText(/A card is required to start the trial/)).toBeTruthy()
    fireEvent.click(start)
    expect(props.onCheckout).toHaveBeenCalledOnce()
  })
  it('shows when a trial ends and that the card is charged then', () => {
    const props = base()
    props.subscription = { ...props.subscription, plan: 'pro', status: 'trialing', billingInterval: 'monthly', trialEndsAt: '2026-09-24T12:00:00.000Z', renewsAt: '2026-09-24T12:00:00.000Z', hasExistingSubscription: true, canOpenPortal: true }
    render(<BillingPanel {...props} />)
    expect(screen.getByText(/Free trial · ends Sep 24, 2026/)).toBeTruthy()
    expect(screen.getByText(/Your card will be charged \$249\.00 per month on Sep 24, 2026 unless you cancel/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Start 7-day free trial/ })).toBeNull()
  })
  it('never mentions Whop', () => {
    const props = base()
    const { container } = render(<BillingPanel {...props} />)
    expect(container.textContent).not.toMatch(/whop/i)
    expect(container.textContent).toMatch(/Stripe/)
  })
  it('keeps checkout disabled when server rollout is not enabled', () => {
    render(<BillingPanel {...base()} checkoutEnabled={false} />)
    expect((screen.getByRole('button', { name: /Checkout temporarily unavailable/ }) as HTMLButtonElement).disabled).toBe(true)
  })
  it('represents reserved usage as committed without reporting more than 100 percent', () => {
    const item = { used: 8, reserved: 4, limit: 10 }
    render(<BillingPanel {...base()} usage={{ month: '2026-09', apps: item, translations: item, icons: item, screenshots: item, uploads: item }} />)
    const progress = screen.getByRole('progressbar', { name: /Connected apps allowance used/ })
    expect(progress.getAttribute('aria-valuenow')).toBe('100')
    expect(progress.getAttribute('aria-valuetext')).toContain('12 of 10, including 4 reserved')
  })
})

describe('billing page plans: Indie', () => {
  it('shows three self-serve plans while Indie is not offered', () => {
    render(<BillingPanel {...base()} />)
    expect(screen.queryByRole('radio', { name: /Indie/ })).toBeNull()
    expect(screen.getByRole('radio', { name: /Solo/ })).toBeTruthy()
  })
  it('sells Indie with its yearly total when offered', () => {
    vi.stubEnv('NEXT_PUBLIC_BILLING_INDIE_ENABLED', 'true')
    const props = base()
    render(<BillingPanel {...props} selectedPlan="indie" interval="annual" />)
    const indie = screen.getByRole('radio', { name: /Indie/ }) as HTMLInputElement
    expect(indie.checked).toBe(true)
    expect(screen.getByText(/\$490\.00 USD per year/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /Continue to secure checkout/ })).toBeTruthy()
  })
  it('keeps an Indie subscriber\'s current plan visible even if Indie is later hidden', () => {
    const props = base()
    props.subscription = { ...props.subscription, plan: 'indie', status: 'trialing', trialEndsAt: '2026-10-19T12:00:00.000Z', billingInterval: 'monthly', hasExistingSubscription: true, subscriptionId: 'sub_indie0000001' }
    render(<BillingPanel {...props} selectedPlan="indie" />)
    expect(screen.getByRole('radio', { name: /Indie/ })).toBeTruthy()
    expect(screen.getByText('Your current plan')).toBeTruthy()
    expect(screen.getByText(/Your card will be charged \$49\.00 per month/)).toBeTruthy()
  })
})

