import React from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BillingSubscription } from '@/components/billing/types'
const mocks = vi.hoisted(() => {
  process.env.NEXT_PUBLIC_BILLING_CHECKOUT_ENABLED = 'true'
  return { params: new URLSearchParams(), followLocation: false }
})
vi.mock('next/navigation', () => ({ useSearchParams: () => mocks.followLocation ? new URLSearchParams(window.location.search) : mocks.params }))
vi.mock('@/lib/marketing/attribution', () => ({ readStoredMarketingAttribution: () => ({}) }))
import BillingClient from '@/components/billing/billing-client'

const free: BillingSubscription = {
  plan: 'free', status: 'free', renewsAt: null, cancelledAt: null, billingInterval: null,
  cancelAtPeriodEnd: false, hasExistingSubscription: false, canManageBilling: true,
}
const active: BillingSubscription = { ...free, plan: 'pro', status: 'active', hasExistingSubscription: true, subscriptionId: 'sub_test000001', billingInterval: 'annual' }
let subscription: BillingSubscription
let subscriptionStatus: number
let usageStatus: number
let request: ReturnType<typeof vi.fn>
const json = (body: unknown, status = 200) => Promise.resolve({ ok: status < 400, status, json: async () => body })
async function mount() { await act(async () => { render(<BillingClient />) }) }
const checkoutCalls = () => request.mock.calls.filter(([url]) => String(url).includes('/api/billing/checkout'))

beforeEach(() => {
  vi.useFakeTimers()
  mocks.followLocation = false
  window.history.replaceState(null, '', '/billing?plan=pro&interval=annual')
  mocks.params = new URLSearchParams('plan=pro&interval=annual')
  subscription = { ...free }
  subscriptionStatus = 200
  usageStatus = 200
  request = vi.fn((url: string) => {
    if (url === '/api/subscription') return json(subscriptionStatus === 200 ? subscription : { error: 'unavailable' }, subscriptionStatus)
    if (url === '/api/usage') return json(usageStatus === 200 ? { month: '2026-09' } : { error: 'unavailable' }, usageStatus)
    return json({ error: 'test stops before provider navigation' }, 503)
  })
  vi.stubGlobal('fetch', request)
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals() })

describe('billing client lifecycle', () => {
  it('keeps the selected annual plan and only requests checkout after explicit confirmation', async () => {
    await mount()
    expect(screen.getByRole<HTMLInputElement>('radio', { name: /^Pro / }).checked).toBe(true)
    expect(screen.getByRole<HTMLInputElement>('radio', { name: /^Annual/ }).checked).toBe(true)
    expect(screen.getByText(/\$2,490\.00 USD per year/)).toBeTruthy()
    expect(checkoutCalls()).toHaveLength(0)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Continue to secure checkout/ })) })
    expect(checkoutCalls()).toHaveLength(1)
    expect(JSON.parse(checkoutCalls()[0][1].body)).toMatchObject({ plan: 'pro', interval: 'annual' })
  })
  it('polls a pending return until verified membership activates, with no second checkout', async () => {
    mocks.params.set('checkout', 'complete')
    await mount()
    expect(screen.getByRole('heading', { name: /Confirming your subscription/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Continue to secure checkout/ })).toBeNull()
    subscription = { ...active }
    await act(async () => { await vi.advanceTimersByTimeAsync(2500) })
    expect(screen.getByRole('heading', { name: /Pro is ready/ })).toBeTruthy()
    expect(checkoutCalls()).toHaveLength(0)
    const callsAfterConfirmation = request.mock.calls.length
    await act(async () => { await vi.advanceTimersByTimeAsync(10000) })
    expect(request.mock.calls).toHaveLength(callsAfterConfirmation)
  })
  it('stops waiting after a minute without claiming success or offering another checkout', async () => {
    mocks.params.set('checkout', 'complete')
    await mount()
    await act(async () => { await vi.advanceTimersByTimeAsync(60001) })
    expect(screen.getByRole('heading', { name: /taking longer to confirm/ })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: /ready to use/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Continue to secure checkout/ })).toBeNull()
    expect(checkoutCalls()).toHaveLength(0)
    const callsAtTimeout = request.mock.calls.length
    await act(async () => { await vi.advanceTimersByTimeAsync(10000) })
    expect(request.mock.calls).toHaveLength(callsAtTimeout)
    subscription = { ...active }
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Check payment status/ })) })
    expect(screen.getByRole('heading', { name: /Pro is ready/ })).toBeTruthy()
  })
  it('does not confirm a different paid plan or an unlinked paid record', async () => {
    mocks.params.set('checkout', 'complete')
    subscription = { ...active, plan: 'starter' }
    await mount()
    expect(screen.getByRole('heading', { name: /Confirming/ })).toBeTruthy()
    subscription = { ...active, subscriptionId: null }
    await act(async () => { await vi.advanceTimersByTimeAsync(2500) })
    expect(screen.queryByRole('heading', { name: /ready to use/ })).toBeNull()
  })
  it('shows an API failure instead of inventing a Free subscription or exposing checkout', async () => {
    subscriptionStatus = 500
    await mount()
    expect(screen.getByRole('alert')).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Current plan' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Continue to secure checkout/ })).toBeNull()
    subscriptionStatus = 200
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Try again' })) })
    expect(screen.getByRole('heading', { name: 'Current plan' })).toBeTruthy()
  })
  it('keeps subscription actions available when only usage cannot load', async () => {
    usageStatus = 500
    await mount()
    expect(screen.getByRole('heading', { name: 'Current plan' })).toBeTruthy()
    expect(screen.getByRole('status').textContent).toMatch(/usage/)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: /Continue to secure checkout/ }).disabled).toBe(false)
  })
  it('provides a sign-in return preserving the exact purchase selection on session expiry', async () => {
    subscriptionStatus = 401
    await mount()
    const link = screen.getByRole('link', { name: /Sign in/ })
    expect(new URL(link.getAttribute('href')!, 'https://applistingagent.com').searchParams.get('returnTo')).toBe('/billing?plan=pro&interval=annual')
    expect(screen.queryByRole('button', { name: /checkout/i })).toBeNull()
  })
  it('updates the review when native plan and frequency radios change', async () => {
    await mount()
    fireEvent.click(screen.getByRole<HTMLInputElement>('radio', { name: /^Monthly/ }))
    fireEvent.click(screen.getByRole<HTMLInputElement>('radio', { name: /^Studio / }))
    expect(screen.getByRole<HTMLInputElement>('radio', { name: /^Monthly/ }).checked).toBe(true)
    expect(screen.getByRole<HTMLInputElement>('radio', { name: /^Studio / }).checked).toBe(true)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Continue to secure checkout/ })) })
    expect(JSON.parse(checkoutCalls()[0][1].body)).toMatchObject({ plan: 'business', interval: 'monthly' })
  })
  it('persists changed selection in the native URL and restores it after a fresh mount', async () => {
    mocks.followLocation = true
    window.history.replaceState(null, '', '/billing?plan=pro&interval=annual&reason=team')
    await mount()
    fireEvent.click(screen.getByRole('radio', { name: /^Monthly/ }))
    fireEvent.click(screen.getByRole('radio', { name: /^Studio / }))
    expect(window.location.pathname).toBe('/billing')
    const selected = new URLSearchParams(window.location.search)
    expect(selected.get('plan')).toBe('business')
    expect(selected.get('interval')).toBe('monthly')
    expect(selected.get('reason')).toBe('team')
    expect(checkoutCalls()).toHaveLength(0)
    cleanup()
    await mount()
    expect(screen.getByRole<HTMLInputElement>('radio', { name: /^Monthly/ }).checked).toBe(true)
    expect(screen.getByRole<HTMLInputElement>('radio', { name: /^Studio / }).checked).toBe(true)
    const requestsAfterMount = request.mock.calls.length
    await act(async () => { await vi.advanceTimersByTimeAsync(10000) })
    expect(request.mock.calls).toHaveLength(requestsAfterMount)
  })
  it('clears checkout busy state on persisted pageshow and refreshes before an abandoned checkout retry', async () => {
    const ordinaryRequest = request.getMockImplementation() as (url: string) => Promise<unknown>
    request.mockImplementation((url: string) => url === '/api/billing/checkout' ? new Promise(() => {}) : ordinaryRequest(url))
    await mount()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Continue to secure checkout/ })) })
    expect(screen.getByRole<HTMLButtonElement>('button', { name: /Opening secure checkout/ }).disabled).toBe(true)
    const subscriptionReads = () => request.mock.calls.filter(([url]) => url === '/api/subscription').length
    const beforeReturn = subscriptionReads()
    await act(async () => { window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: false })) })
    expect(subscriptionReads()).toBe(beforeReturn)
    await act(async () => { window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })) })
    expect(subscriptionReads()).toBe(beforeReturn + 1)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: /Continue to secure checkout/ }).disabled).toBe(false)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Continue to secure checkout/ })) })
    expect(checkoutCalls()).toHaveLength(2)
  })
  it('locks plan and frequency changes while confirming payment', async () => {
    mocks.params.set('checkout', 'complete')
    await mount()
    for (const radio of screen.getAllByRole<HTMLInputElement>('radio')) expect(radio.disabled).toBe(true)
    expect(screen.getByRole<HTMLInputElement>('radio', { name: /^Pro / }).checked).toBe(true)
    expect(checkoutCalls()).toHaveLength(0)
  })
  it('removes stale checkout actions if a later subscription refresh fails', async () => {
    await mount()
    expect(screen.getByRole('button', { name: /Continue to secure checkout/ })).toBeTruthy()
    subscriptionStatus = 500
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Refresh' })) })
    expect(screen.getByRole('alert')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Continue to secure checkout/ })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Current plan' })).toBeNull()
    expect(checkoutCalls()).toHaveLength(0)
  })
  it('removes the completed return marker when a confirmed subscriber compares a new plan', async () => {
    mocks.followLocation = true
    window.history.replaceState(null, '', '/billing?checkout=complete&plan=pro&interval=annual')
    subscription = { ...active }
    await mount()
    expect(screen.getByRole('heading', { name: /Pro is ready/ })).toBeTruthy()
    fireEvent.click(screen.getByRole('radio', { name: /^Studio / }))
    expect(new URLSearchParams(window.location.search).has('checkout')).toBe(false)
    expect(screen.queryByRole('heading', { name: /Confirming/ })).toBeNull()
    const requestCount = request.mock.calls.length
    await act(async () => { await vi.advanceTimersByTimeAsync(10000) })
    expect(request.mock.calls).toHaveLength(requestCount)
  })

  it('waits for the selected annual interval even when the expected plan is already active monthly', async () => {
    mocks.params.set('checkout', 'complete')
    subscription = { ...active, billingInterval: 'monthly' }
    await mount()
    expect(screen.getByRole('heading', { name: /Confirming/ })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: /ready to use/ })).toBeNull()
    subscription = { ...active, billingInterval: 'annual' }
    await act(async () => { await vi.advanceTimersByTimeAsync(2500) })
    expect(screen.getByRole('heading', { name: /Pro is ready/ })).toBeTruthy()
    expect(checkoutCalls()).toHaveLength(0)
  })

})
