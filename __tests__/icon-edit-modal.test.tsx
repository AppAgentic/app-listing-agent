import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { IconEditModal } from '@/components/icon-edit-modal'
import type { GeneratedIconData } from '@/lib/hooks/useIconGenerator'

const icon = {
  id: 'original',
  originalUrl: '/original.png',
} as GeneratedIconData
function Harness() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button onClick={() => setOpen(true)}>Edit my icon</button>
      <IconEditModal
        isOpen={open}
        onClose={() => setOpen(false)}
        onSave={async () => {}}
        icon={icon}
        projectId="project"
      />
    </>
  )
}
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})
function openEditor() {
  render(<Harness />)
  const trigger = screen.getByRole('button', { name: 'Edit my icon' })
  trigger.focus()
  fireEvent.click(trigger)
  return trigger
}
describe('icon editor', () => {
  it('opens a labelled dialog, traps focus, closes with Escape and restores focus, then reopens', async () => {
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    const trigger = openEditor()
    const dialog = await screen.findByRole('dialog', { name: 'Edit icon' })
    expect(dialog.contains(document.activeElement)).toBe(true)
    trigger.focus()
    expect(dialog.contains(document.activeElement)).toBe(true)
    const cancel = screen.getByRole('button', { name: 'Cancel' })
    cancel.focus()
    fireEvent.keyDown(cancel, { key: 'Tab' })
    expect(dialog.contains(document.activeElement)).toBe(true)
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(trigger))
    fireEvent.click(trigger)
    expect(
      await screen.findByRole('dialog', { name: 'Edit icon' }),
    ).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Close editor' }))
    await waitFor(() => expect(document.activeElement).toBe(trigger))
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('shows catalog cost and comparison, generates and saves the selected platform exports', async () => {
    let resolveGeneration!: (value: Response) => void
    const fetcher = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            resolveGeneration = resolve
          }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true })))
    vi.stubGlobal('fetch', fetcher)
    openEditor()
    expect(
      await screen.findByText('6 credits per generation · 3 each'),
    ).toBeTruthy()
    expect(
      screen.getByRole('region', { name: 'Before and after' }),
    ).toBeTruthy()
    fireEvent.change(screen.getByLabelText('What would you like to change?'), {
      target: { value: 'Simplify the outline' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Generate variations/ }))
    expect(await screen.findByLabelText('Loading variations')).toBeTruthy()
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({
      projectId: 'project',
      iconId: 'original',
      prompt: 'Simplify the outline',
      variationCount: 2,
    })
    resolveGeneration(
      new Response(
        JSON.stringify({
          creditsUsed: 6,
          variations: [
            {
              id: 'a',
              imageUrl: '/a.png',
              iosUrl: '/ios.png',
              androidUrl: '/android.png',
            },
            { id: 'b', imageUrl: '/b.png' },
          ],
        }),
      ),
    )
    await screen.findByText('Choose a variation')
    expect(screen.queryByLabelText('Loading variations')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2))
    expect(fetcher.mock.calls[1][0]).toBe('/api/icons/edit/save')
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toMatchObject({
      selectedImageUrl: '/a.png',
      selectedIosUrl: '/ios.png',
      selectedAndroidUrl: '/android.png',
      discardUrls: ['/b.png'],
    })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })
})
