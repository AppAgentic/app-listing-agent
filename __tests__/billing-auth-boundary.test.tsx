import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ session: vi.fn(), headers: vi.fn() }))
vi.mock('@/lib/auth/session', () => ({ getSession: mocks.session }))
vi.mock('next/headers', () => ({ headers: mocks.headers }))
vi.mock('next/navigation', () => ({ redirect: (destination: string) => { throw new Error(`redirect:${destination}`) } }))
vi.mock('@/components/dashboard/dashboard-shell', () => ({ DashboardShell: ({ children }: any) => children }))
vi.mock('@/lib/features/internal-integrations', () => ({ isInternalIntegrationIdentity: () => false }))
import DashboardLayout from '@/app/(dashboard)/layout'
import BillingLayout from '@/app/(billing)/layout'
import { existsSync } from 'node:fs'
import path from 'node:path'

beforeEach(() => {
  mocks.session.mockResolvedValue({ userId: 'test-user', onboardingCompleted: false })
  mocks.headers.mockResolvedValue(new Headers({ 'x-app-path': '/billing?plan=pro&interval=annual' }))
})
describe('billing authentication boundary', () => {
  it('still requires authentication and preserves the selected plan', async () => {
    mocks.session.mockResolvedValue(null)
    await expect(BillingLayout({ children: null })).rejects.toThrow('redirect:/login?mode=signup&returnTo=%2Fbilling%3Fplan%3Dpro%26interval%3Dannual')
  })
  it('lets authenticated users review billing before unrelated store setup', async () => {
    const result = await BillingLayout({ children: <p>Billing</p> })
    expect(result).toBeTruthy()
  })
  it('continues to require onboarding for other dashboard pages', async () => {
    mocks.headers.mockResolvedValue(new Headers({ 'x-app-path': '/projects?view=all' }))
    await expect(DashboardLayout({ children: null })).rejects.toThrow('redirect:/onboarding?returnTo=%2Fprojects%3Fview%3Dall')
  })
  it('uses the safe dashboard fallback for invalid return locations', async () => {
    mocks.headers.mockResolvedValue(new Headers({ 'x-app-path': '//evil.example' }))
    await expect(DashboardLayout({ children: null })).rejects.toThrow('redirect:/onboarding?returnTo=%2Fdashboard')
  })
  it('never exempts dashboard onboarding based on a billing navigation hint', async () => {
    await expect(DashboardLayout({ children: null })).rejects.toThrow('redirect:/onboarding?returnTo=%2Fbilling%3Fplan%3Dpro%26interval%3Dannual')
  })
  it('mounts billing in a sibling layout boundary rather than caching an exempt dashboard layout', () => {
    expect(existsSync(path.resolve('app/(billing)/billing/page.tsx'))).toBe(true)
    expect(existsSync(path.resolve('app/(billing)/layout.tsx'))).toBe(true)
    expect(existsSync(path.resolve('app/(dashboard)/billing/page.tsx'))).toBe(false)
  })
  it('continues to require a session on ordinary dashboard entry', async () => {
    mocks.session.mockResolvedValue(null)
    mocks.headers.mockResolvedValue(new Headers({ 'x-app-path': '/projects' }))
    await expect(DashboardLayout({ children: null })).rejects.toThrow('redirect:/login?returnTo=%2Fprojects')
  })

})
