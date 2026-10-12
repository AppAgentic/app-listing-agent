import React from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/analytics/client', () => ({ trackEvent: vi.fn() }))
vi.mock('@/lib/marketing/attribution', () => ({ readStoredMarketingAttribution: () => ({ source: 'google' }) }))
import { TrialStep } from '@/components/onboarding/trial-step'
import { trackEvent } from '@/lib/analytics/client'

let assign: ReturnType<typeof vi.fn>
let fetchMock: ReturnType<typeof vi.fn>
beforeEach(() => {
  assign = vi.fn()
  vi.stubGlobal('location', { ...window.location, assign })
  fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ purchaseUrl: 'https://checkout.stripe.com/c/pay/cs_test_one', trialDays: 7 }) }))
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.clearAllMocks() })

describe('onboarding trial step', () => {
  it('preselects the plan from pricing and starts the trial checkout on Stripe', async () => {
    render(<TrialStep trialDays={7} initialPlan="business" initialInterval="annual" />)
    expect(screen.getByRole('heading', { name: 'Start your 7-day free trial' })).toBeTruthy()
    expect(screen.getByRole('radio', { name: /Studio/ }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByText(/Free for 7 days, then \$5,990\.00 per year/)).toBeTruthy()
    expect(screen.getByText(/Card required/)).toBeTruthy()
    expect(trackEvent).toHaveBeenCalledWith('paywall_viewed', { props: { placement: 'onboarding' } })

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Start 7-day free trial/ })) })
    expect(fetchMock).toHaveBeenCalledWith('/api/billing/checkout', expect.objectContaining({ method: 'POST' }))
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ plan: 'business', interval: 'annual', attribution: { source: 'google' }, placement: 'onboarding' })
    expect(assign).toHaveBeenCalledWith('https://checkout.stripe.com/c/pay/cs_test_one')
  })

  it('refuses a checkout URL that is not Stripe-hosted', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ purchaseUrl: 'https://whop.com/checkout/x' }) })
    render(<TrialStep trialDays={7} />)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Start 7-day free trial/ })) })
    expect(assign).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toBeTruthy()
  })

  it('has no free-plan escape hatch and explains a cancelled checkout', () => {
    render(<TrialStep trialDays={7} canceled />)
    expect(screen.getByText(/nothing was charged/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /free plan/i })).toBeNull()
    expect(document.body.textContent).not.toMatch(/free plan/i)
  })

  it('becomes a paid checkout when the trial was already used', () => {
    render(<TrialStep trialDays={0} initialPlan="pro" />)
    expect(screen.getByRole('heading', { name: 'Choose your plan' })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Continue to secure checkout/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /free trial/i })).toBeNull()
  })

  it('sends an existing subscriber to billing instead of a second checkout', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 409, json: async () => ({ code: 'existing_subscription' }) })
    render(<TrialStep trialDays={7} />)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Start 7-day free trial/ })) })
    expect(assign).toHaveBeenCalledWith('/billing')
  })
})

describe('onboarding trial step: Indie', () => {
  it('lists only Solo, Pro and Studio while Indie is not offered, and ignores an Indie preselection', () => {
    render(<TrialStep trialDays={7} initialPlan="indie" />)
    const plans = screen.getAllByRole('radiogroup', { name: 'Plan' })[0]
    expect(Array.from(plans.querySelectorAll('[role="radio"] p.font-semibold.text-white:not(.tabular-nums)')).map(name => name.firstChild?.textContent)).toEqual(['Solo', 'Pro', 'Studio'])
    expect(screen.queryByRole('radio', { name: /Indie/ })).toBeNull()
    expect(screen.getByRole('radio', { name: /^Pro/ }).getAttribute('aria-checked')).toBe('true')
  })

  it('offers Indie at $49/mo (1 app) and starts its trial checkout when enabled', async () => {
    vi.stubEnv('NEXT_PUBLIC_BILLING_INDIE_ENABLED', 'true')
    render(<TrialStep trialDays={7} initialPlan="indie" initialInterval="monthly" />)
    const indie = screen.getByRole('radio', { name: /Indie/ })
    expect(indie.getAttribute('aria-checked')).toBe('true')
    expect(indie.textContent).toContain('$49')
    expect(indie.textContent).toContain('1 app ·')
    expect(screen.getByText(/Free for 7 days, then \$49\.00 per month/)).toBeTruthy()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Start 7-day free trial/ })) })
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ plan: 'indie', interval: 'monthly', placement: 'onboarding' })
  })
})

