import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
const mocks = vi.hoisted(() => ({
  generate: vi.fn(),
  icons: [] as Array<Record<string, unknown>>,
  upload: vi.fn(),
}))
vi.mock('@/lib/hooks/useIconGenerator', () => ({
  useIconGenerator: () => ({
    icons: mocks.icons,
    loading: false,
    generating: false,
    generatingVariations: false,
    uploading: false,
    fetchingAppStore: false,
    deleting: false,
    error: null,
    generateIcon: mocks.generate,
    generateVariations: vi.fn(),
    uploadReference: mocks.upload,
    fetchFromAppStore: vi.fn(),
    resizeIcon: vi.fn(),
    deleteIcon: vi.fn(),
    downloadIcon: vi.fn(),
    clearError: vi.fn(),
    clearIcons: vi.fn(),
    refreshIcons: vi.fn(),
  }),
}))
vi.mock('@/components/icon-edit-modal', () => ({ IconEditModal: () => null }))
import { IconGenerator } from '@/components/dashboard/icon-generator'
const metadata = {
  title: 'Atlas',
  subtitle: 'Daily momentum',
  description: 'Build routines',
  keywords: 'habits,streaks',
  category: 'productivity',
}
const icon = {
  id: 'saved',
  concept: { subject: 'The summit' },
  style: '3d',
  originalUrl: '/icon.png',
  ios: '/ios.png',
  android: '/android.png',
  timestamp: 1790586000000,
}
beforeEach(() => {
  mocks.icons = []
  mocks.generate.mockResolvedValue(icon)
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ success: true, styles: [] })),
  )
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})
describe('icon workspace', () => {
  it('plans four concepts once and sends listing fields, chosen style and colours', async () => {
    const concepts = Array.from({ length: 4 }, (_, i) => ({
      subject: `subject-${i}`,
      metaphor: `metaphor-${i}`,
      colorIdea: 'blue',
    }))
    const fetcher = vi
      .fn()
      .mockImplementation(async (url: string) =>
        Response.json(
          url === '/api/icons/concepts'
            ? { concepts }
            : { success: true, styles: [] },
        ),
      )
    vi.stubGlobal('fetch', fetcher)
    render(<IconGenerator projectId="p" metadata={metadata} />)
    fireEvent.change(screen.getByLabelText('Brand primary (optional)'), {
      target: { value: '#245cff' },
    })
    fireEvent.change(screen.getByLabelText('Brand secondary (optional)'), {
      target: { value: '#ffbd45' },
    })
    expect(
      screen.getByRole('button', { name: /Generate 2 icons · 6 credits/ }),
    ).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '4' }))
    fireEvent.click(
      screen.getByRole('button', { name: /Generate 4 icons · 12 credits/ }),
    )
    await waitFor(() => expect(mocks.generate).toHaveBeenCalledTimes(4))
    const calls = fetcher.mock.calls.filter(
      (c) => c[0] === '/api/icons/concepts',
    )
    expect(calls).toHaveLength(1)
    expect(JSON.parse(calls[0][1].body)).toMatchObject({
      count: 4,
      colors: { primary: '#245cff', secondary: '#ffbd45' },
      metadata,
    })
    mocks.generate.mock.calls.forEach(([params], i) =>
      expect(params).toMatchObject({
        style: 'liquid-glass',
        concept: concepts[i],
        source: { type: 'metadata', appMetadata: metadata },
      }),
    )
  })
  it('normalizes legacy labels and compares a candidate without replacing the current icon', async () => {
    mocks.icons = [icon]
    render(
      <IconGenerator
        projectId="p"
        metadata={metadata}
        currentIconUrl="/current.png"
        currentIconSource="build"
      />,
    )
    await screen.findByRole('heading', { name: 'The summit' })
    fireEvent.click(screen.getByRole('button', { name: 'Preview The summit' }))
    expect(
      screen.getByAltText('Atlas latest build icon').getAttribute('src'),
    ).toBe('/current.png')
    expect(
      screen
        .getAllByRole('img', { name: 'Atlas icon on home screen' })
        .some((image) => image.getAttribute('src') === '/icon.png'),
    ).toBe(true)
    expect(screen.getAllByText('Tactile 3D object').length).toBeGreaterThan(0)
    expect(screen.queryByText('3d')).toBeNull()
  })
  it('switches modes and skips concepts for a modernisation reference', async () => {
    render(
      <IconGenerator
        projectId="p"
        metadata={metadata}
        currentIconUrl="/current.png"
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /Describe it/ }))
    fireEvent.change(screen.getByLabelText('Describe your icon'), {
      target: { value: 'A brighter mountain' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Modernise my icon/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Use current icon' }))
    fireEvent.click(screen.getByRole('button', { name: /Generate 2 icons/ }))
    await waitFor(() => expect(mocks.generate).toHaveBeenCalledTimes(2))
    expect(mocks.generate.mock.calls[0][0]).toMatchObject({
      source: { type: 'reference', referenceImageUrl: '/current.png' },
    })
    expect(mocks.generate.mock.calls[0][0].concept).toBeUndefined()
    expect(
      vi
        .mocked(fetch)
        .mock.calls.some(([url]) => url === '/api/icons/concepts'),
    ).toBe(false)
  })
  it('keeps failed jobs and retries the original request after the composer changes', async () => {
    mocks.generate.mockResolvedValueOnce(null).mockResolvedValue(icon)
    render(<IconGenerator projectId="p" metadata={metadata} />)
    fireEvent.click(screen.getByRole('button', { name: '1' }))
    fireEvent.click(screen.getByRole('button', { name: /Generate 1 icon/ }))
    const retry = await screen.findByRole('button', { name: /Retry this job/ })
    const original = mocks.generate.mock.calls[0][0]
    fireEvent.change(screen.getByLabelText('App name'), {
      target: { value: 'Changed app' },
    })
    fireEvent.click(retry)
    await waitFor(() => expect(mocks.generate).toHaveBeenCalledTimes(2))
    expect(mocks.generate.mock.calls[1][0]).toEqual(original)
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: /Retry this job/ }),
      ).toBeNull(),
    )
  })
})
