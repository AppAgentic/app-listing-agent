import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useIconGenerator } from '@/lib/hooks/useIconGenerator'
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
it('imports a reference without presenting it as a saved generated result', async () => {
  const saved = { id: 'saved', originalUrl: '/saved.png', style: '3d', timestamp: 1 }
  vi.stubGlobal('fetch', vi.fn(async (url: string) => Response.json(url === '/api/icons/list' ? { success: true, icons: [saved] } : { success: true, originalUrl: '/reference.png', ios: '/ios.png', android: '/android.png' })))
  const { result } = renderHook(() => useIconGenerator({ projectId: 'fixture' }))
  await waitFor(() => expect(result.current.loading).toBe(false))
  await act(async () => { expect((await result.current.fetchFromAppStore('123'))?.originalUrl).toBe('/reference.png') })
  expect(result.current.icons).toHaveLength(1)
  expect(result.current.icons[0]).toMatchObject({ id: 'saved', style: 'tactile-3d' })
})
it('keeps the generation flag active until every concurrent request settles', async () => {
  const pending: Array<(response: Response) => void> = []
  vi.stubGlobal('fetch', vi.fn((url: string) => url === '/api/icons/list' ? Promise.resolve(Response.json({ success: true, icons: [] })) : new Promise<Response>(resolve => pending.push(resolve))))
  const { result } = renderHook(() => useIconGenerator({ projectId: 'fixture' }))
  await waitFor(() => expect(result.current.loading).toBe(false))
  let first!: ReturnType<typeof result.current.generateIcon>, second!: ReturnType<typeof result.current.generateIcon>
  act(() => { first = result.current.generateIcon({ source: { type: 'prompt', prompt: 'A mountain path' } }); second = result.current.generateIcon({ source: { type: 'prompt', prompt: 'A rising flame' } }) })
  expect(result.current.generating).toBe(true)
  await act(async () => { pending[0](Response.json({ success: true, id: 'one', originalUrl: '/one.png' })); await first })
  expect(result.current.generating).toBe(true)
  await act(async () => { pending[1](Response.json({ success: true, id: 'two', originalUrl: '/two.png' })); await second })
  expect(result.current.generating).toBe(false)
  expect(result.current.icons).toHaveLength(2)
})
