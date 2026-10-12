import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, act } from '@testing-library/react'
import { IconAllowance } from '@/components/dashboard/icon-allowance'
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
it('shows remaining credits after reservations and refreshes after icon operations', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json({ icons: { used: 9, reserved: 6, limit: 30 } }),
    )
    .mockResolvedValueOnce(
      Response.json({ icons: { used: 18, reserved: 0, limit: 30 } }),
    )
  vi.stubGlobal('fetch', fetcher)
  render(<IconAllowance />)
  await screen.findByText('15')
  act(() => window.dispatchEvent(new Event('icons:usage-changed')))
  await screen.findByText('12')
})
it('omits an unavailable allowance instead of inventing one', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(Response.json({}, { status: 401 })),
  )
  const { container } = render(<IconAllowance />)
  await waitFor(() => expect(fetch).toHaveBeenCalled())
  expect(container.textContent).toBe('')
})
