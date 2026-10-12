import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchAppStoreArtwork, toFullSizeArtwork } from '@/lib/services/app-store-artwork'

afterEach(() => vi.unstubAllGlobals())

describe('App Store artwork', () => {
  it('rewrites Apple CDN artwork to a 1024 px PNG', () => {
    expect(toFullSizeArtwork('https://is1-ssl.mzstatic.com/image/thumb/Purple221/v4/aa/AppIcon.png/512x512bb.jpg'))
      .toBe('https://is1-ssl.mzstatic.com/image/thumb/Purple221/v4/aa/AppIcon.png/1024x1024bb.png')
  })

  it('returns the live store icon and tries other storefronts when the app is not in the US store', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ resultCount: 0, results: [] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ results: [{ artworkUrl512: 'https://is1-ssl.mzstatic.com/x/512x512bb.jpg' }] })))
    vi.stubGlobal('fetch', fetchMock)
    await expect(fetchAppStoreArtwork('1439007580')).resolves.toBe('https://is1-ssl.mzstatic.com/x/1024x1024bb.png')
    expect(fetchMock.mock.calls[0][0]).toContain('country=us')
    expect(fetchMock.mock.calls[1][0]).toContain('country=gb')
  })

  it('returns null for unreleased apps and rejects non-numeric ids without a request', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ results: [] })))
    vi.stubGlobal('fetch', fetchMock)
    await expect(fetchAppStoreArtwork('1439007580')).resolves.toBeNull()
    await expect(fetchAppStoreArtwork('../x')).resolves.toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })
})
