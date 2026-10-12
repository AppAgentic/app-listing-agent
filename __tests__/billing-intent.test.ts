import { afterEach, describe, expect, it, vi } from 'vitest'
import { billingIntentUrl, isBillingDestination, readPurchaseIntent, resolveLoginDestination, safeLocalReturnTo } from '@/lib/billing/intent'

afterEach(() => vi.unstubAllEnvs())

describe('purchase intent through authentication', () => {
  it.each(['starter', 'pro', 'business', 'enterprise'] as const)('retains %s and annual billing through an encoded login return', plan => {
    const destination = billingIntentUrl({ plan, interval: 'annual' })
    const login = new URLSearchParams({ mode: 'signup', returnTo: destination })
    expect(resolveLoginDestination(new URLSearchParams(login.toString()))).toBe(destination)
    expect(readPurchaseIntent(new URLSearchParams(destination.split('?')[1]))).toEqual({ plan, interval: 'annual' })
    expect(isBillingDestination(destination)).toBe(true)
  })
  it('supports legacy pricing links and rejects unknown intervals or prototype keys', () => {
    expect(resolveLoginDestination(new URLSearchParams('plan=pro'))).toBe('/billing?plan=pro&interval=monthly')
    expect(readPurchaseIntent(new URLSearchParams('plan=pro&interval=weekly'))).toBeNull()
    expect(readPurchaseIntent(new URLSearchParams('plan=toString'))).toBeNull()
  })
  it('carries an Indie intent only when the deployment offers Indie', () => {
    expect(readPurchaseIntent(new URLSearchParams('plan=indie&interval=annual'))).toBeNull()
    expect(resolveLoginDestination(new URLSearchParams('plan=indie'))).toBe('/dashboard')
    vi.stubEnv('NEXT_PUBLIC_BILLING_INDIE_ENABLED', 'true')
    expect(readPurchaseIntent(new URLSearchParams('plan=indie&interval=annual'))).toEqual({ plan: 'indie', interval: 'annual' })
    expect(resolveLoginDestination(new URLSearchParams('plan=indie'))).toBe('/billing?plan=indie&interval=monthly')
  })
  it('keeps invitation and OAuth handoffs ahead of purchase intent', () => {
    expect(resolveLoginDestination(new URLSearchParams('invite=abc/def&plan=pro&returnTo=https://evil.example'))).toBe('/invite/abc%2Fdef')
    expect(resolveLoginDestination(new URLSearchParams({ plan: 'pro', returnTo: '/oauth/login?external_auth_id=abc' }))).toBe('/oauth/login?external_auth_id=abc')
  })
  it.each(['https://evil.example', '//evil.example', '/\\evil.example', '/\nevil.example', 'javascript:alert(1)'])('rejects redirect escape %j', destination => {
    expect(safeLocalReturnTo(destination)).toBe('/dashboard')
  })
  it('only exempts the billing route from unrelated onboarding', () => {
    expect(isBillingDestination('/billing-other')).toBe(false)
    expect(isBillingDestination('/billing/../dashboard')).toBe(false)
    expect(isBillingDestination(safeLocalReturnTo('/billing/../dashboard'))).toBe(false)
  })
})
