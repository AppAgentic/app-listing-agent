import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const open = vi.hoisted(() => vi.fn())
vi.mock('@/lib/support/gleap-client', () => ({ supportClient: { open }, SUPPORT_EMAIL: 'support@applistingagent.com' }))
vi.mock('next/navigation', () => ({ usePathname: () => '/billing' }))
import { SupportButton } from '@/components/support/gleap-support'

afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('support entry point', () => {
  it('provides a real subject-specific email fallback before JavaScript is ready', () => {
    render(<SupportButton subject="Billing help">Get billing help</SupportButton>)
    expect(screen.getByRole('link', { name: 'Get billing help' }).getAttribute('href')).toBe('mailto:support@applistingagent.com?subject=Billing%20help')
  })
  it('shows loading feedback and ignores repeated taps until the widget is ready', async () => {
    let resolve!: (opened: boolean) => void
    open.mockReturnValue(new Promise<boolean>(done => { resolve = done }))
    const onOpen = vi.fn()
    render(<SupportButton onOpen={onOpen} />)
    fireEvent.click(screen.getByRole('link'))
    expect(screen.getByText('Opening support…')).toBeTruthy()
    fireEvent.click(screen.getByRole('link'))
    expect(open).toHaveBeenCalledOnce()
    resolve(true)
    await waitFor(() => expect(onOpen).toHaveBeenCalledOnce())
    expect(screen.getByRole('link').getAttribute('aria-busy')).toBe('false')
  })
})
