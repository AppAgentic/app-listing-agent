import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppStoreHelper } from '@/lib/services/appstore'

describe('AppStoreHelper Custom Product Pages', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('creates a custom product page from the latest app store version template', async () => {
    const helper = new AppStoreHelper({
      appId: '1234567890',
      issuerId: 'issuer-id',
      keyId: 'key-id',
      privateKey: '-----BEGIN PRIVATE KEY-----\nmock\n-----END PRIVATE KEY-----',
    })
    const requests: Array<{ method: string; url: string; body?: any }> = []

    ;(helper as any).makeApiRequest = vi.fn(async (method: string, url: string, body?: any) => {
      requests.push({ method, url, body })
      if (method === 'GET' && url === 'https://api.appstoreconnect.apple.com/v1/apps/1234567890/appStoreVersions') {
        return new Response(JSON.stringify({
          data: [
            {
              id: 'app-version-older',
              attributes: { createdDate: '2026-01-01T00:00:00Z' },
            },
            {
              id: 'app-version-latest',
              attributes: { createdDate: '2026-05-19T00:00:00Z' },
            },
          ],
        }), { status: 200 })
      }
      if (method === 'GET' && url === 'https://api.appstoreconnect.apple.com/v1/appStoreVersions/app-version-latest/appStoreVersionLocalizations?limit=200') {
        return new Response(JSON.stringify({
          data: [
            { id: 'version-loc-en', attributes: { locale: 'en-US' } },
            { id: 'version-loc-de', attributes: { locale: 'de-DE' } },
          ],
        }), { status: 200 })
      }

      return new Response(JSON.stringify({
        data: {
          type: 'appCustomProductPages',
          id: 'cpp-123',
          attributes: {
            name: 'Wave 1B',
            url: 'https://apps.apple.com/app/custom-product-page/cpp-123',
            state: 'PREPARE_FOR_SUBMISSION',
          },
          relationships: {
            appCustomProductPageVersions: {
              data: [{ type: 'appCustomProductPageVersions', id: 'version-123' }],
            },
          },
        },
        included: [
          {
            type: 'appCustomProductPageVersions',
            id: 'version-123',
            attributes: { state: 'PREPARE_FOR_SUBMISSION' },
            relationships: {
              appCustomProductPageLocalizations: {
                data: [{ type: 'appCustomProductPageLocalizations', id: 'loc-123' }],
              },
            },
          },
          {
            type: 'appCustomProductPageLocalizations',
            id: 'loc-123',
            attributes: { locale: 'en-US', promotionalText: 'Track every set.' },
          },
        ],
      }), { status: 201 })
    })

    const result = await helper.createCustomProductPage('Wave 1B', {
      locale: 'en-US',
      promotionalText: 'Track every set.',
    })

    expect(requests).toHaveLength(3)
    expect(requests[2].method).toBe('POST')
    expect(requests[2].url).toBe('https://api.appstoreconnect.apple.com/v1/appCustomProductPages')
    expect(requests[2].body.data).toMatchObject({
      type: 'appCustomProductPages',
      attributes: { name: 'Wave 1B' },
      relationships: {
        app: { data: { type: 'apps', id: '1234567890' } },
        appCustomProductPageVersions: {
          data: [{ type: 'appCustomProductPageVersions', id: '${new-appCustomProductPageVersion-id}' }],
        },
        appStoreVersionTemplate: {
          data: { type: 'appStoreVersions', id: 'app-version-latest' },
        },
      },
    })
    expect(requests[2].body.included).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'appCustomProductPageVersions',
        id: '${new-appCustomProductPageVersion-id}',
        relationships: {
          appCustomProductPage: {},
          appCustomProductPageLocalizations: {
            data: [
              { type: 'appCustomProductPageLocalizations', id: '${new-appCustomProductPageLocalization-en-US-id}' },
              { type: 'appCustomProductPageLocalizations', id: '${new-appCustomProductPageLocalization-de-DE-id}' },
            ],
          },
        },
      }),
      expect.objectContaining({
        type: 'appCustomProductPageLocalizations',
        id: '${new-appCustomProductPageLocalization-en-US-id}',
        attributes: { locale: 'en-US', promotionalText: 'Track every set.' },
      }),
      expect.objectContaining({
        type: 'appCustomProductPageLocalizations',
        id: '${new-appCustomProductPageLocalization-de-DE-id}',
        attributes: { locale: 'de-DE', promotionalText: '' },
      }),
    ]))
    expect(result).toMatchObject({
      id: 'cpp-123',
      versionId: 'version-123',
      versionState: 'PREPARE_FOR_SUBMISSION',
      localizationId: 'loc-123',
      localizationLocale: 'en-US',
    })
  })

  it('retries a server-side create failure when no CPP was created by Apple', async () => {
    vi.useFakeTimers()

    const helper = new AppStoreHelper({
      appId: '1234567890',
      issuerId: 'issuer-id',
      keyId: 'key-id',
      privateKey: '-----BEGIN PRIVATE KEY-----\nmock\n-----END PRIVATE KEY-----',
    })
    const requests: Array<{ method: string; url: string; body?: any }> = []
    let postAttempts = 0

    ;(helper as any).makeApiRequest = vi.fn(async (method: string, url: string, body?: any) => {
      requests.push({ method, url, body })
      if (method === 'GET' && url === 'https://api.appstoreconnect.apple.com/v1/apps/1234567890/appStoreVersions') {
        return new Response(JSON.stringify({
          data: [{ id: 'app-version-latest', attributes: { createdDate: '2026-05-19T00:00:00Z' } }],
        }), { status: 200 })
      }
      if (method === 'GET' && url === 'https://api.appstoreconnect.apple.com/v1/appStoreVersions/app-version-latest/appStoreVersionLocalizations?limit=200') {
        return new Response(JSON.stringify({
          data: [{ id: 'version-loc-en', attributes: { locale: 'en-US' } }],
        }), { status: 200 })
      }
      if (method === 'GET' && url === 'https://api.appstoreconnect.apple.com/v1/apps/1234567890/appCustomProductPages?limit=200') {
        return new Response(JSON.stringify({ data: [] }), { status: 200 })
      }
      if (method === 'POST' && url === 'https://api.appstoreconnect.apple.com/v1/appCustomProductPages') {
        postAttempts++
        if (postAttempts === 1) {
          return new Response(JSON.stringify({
            errors: [{ status: '500', code: 'UNEXPECTED_ERROR', title: 'An unexpected error occurred.' }],
          }), { status: 500 })
        }
        return new Response(JSON.stringify({
          data: {
            type: 'appCustomProductPages',
            id: 'cpp-retry',
            attributes: { name: 'Retry CPP', url: null, state: 'PREPARE_FOR_SUBMISSION' },
            relationships: {
              appCustomProductPageVersions: {
                data: [{ type: 'appCustomProductPageVersions', id: 'version-retry' }],
              },
            },
          },
          included: [
            {
              type: 'appCustomProductPageVersions',
              id: 'version-retry',
              relationships: {
                appCustomProductPageLocalizations: {
                  data: [{ type: 'appCustomProductPageLocalizations', id: 'loc-retry' }],
                },
              },
            },
            {
              type: 'appCustomProductPageLocalizations',
              id: 'loc-retry',
              attributes: { locale: 'en-US' },
            },
          ],
        }), { status: 201 })
      }

      return new Response(JSON.stringify({ errors: [{ detail: 'unexpected request' }] }), { status: 500 })
    })

    const resultPromise = helper.createCustomProductPage('Retry CPP', { locale: 'en-US' })
    await vi.advanceTimersByTimeAsync(3000)
    const result = await resultPromise

    expect(result).toMatchObject({
      id: 'cpp-retry',
      versionId: 'version-retry',
      localizationId: 'loc-retry',
    })
    expect(requests.filter(request => request.method === 'POST')).toHaveLength(2)
    expect(requests.filter(request => request.url === 'https://api.appstoreconnect.apple.com/v1/apps/1234567890/appCustomProductPages?limit=200')).toHaveLength(2)
  })

  it('paginates Custom Product Page lists for name reconciliation', async () => {
    const helper = new AppStoreHelper({
      appId: '1234567890',
      issuerId: 'issuer-id',
      keyId: 'key-id',
      privateKey: '-----BEGIN PRIVATE KEY-----\nmock\n-----END PRIVATE KEY-----',
    })

    ;(helper as any).makeApiRequest = vi.fn(async (_method: string, url: string) => {
      if (url === 'https://api.appstoreconnect.apple.com/v1/apps/1234567890/appCustomProductPages?limit=200') {
        return new Response(JSON.stringify({
          data: [
            { id: 'cpp-1', attributes: { name: 'First', url: null, state: 'PREPARE_FOR_SUBMISSION' } },
          ],
          links: { next: 'https://api.appstoreconnect.apple.com/v1/apps/1234567890/appCustomProductPages?page=2' },
        }), { status: 200 })
      }
      if (url === 'https://api.appstoreconnect.apple.com/v1/apps/1234567890/appCustomProductPages?page=2') {
        return new Response(JSON.stringify({
          data: [
            { id: 'cpp-2', attributes: { name: 'Second', url: 'https://example.com', state: 'READY_FOR_SALE' } },
          ],
        }), { status: 200 })
      }
      return new Response(JSON.stringify({ errors: [{ detail: 'unexpected request' }] }), { status: 500 })
    })

    await expect(helper.listCustomProductPages()).resolves.toEqual([
      { id: 'cpp-1', name: 'First', url: null, state: 'PREPARE_FOR_SUBMISSION' },
      { id: 'cpp-2', name: 'Second', url: 'https://example.com', state: 'READY_FOR_SALE' },
    ])
  })

  it('prunes copied template screenshot sets that are not in the intended CPP display buckets', async () => {
    const helper = new AppStoreHelper({
      appId: '1234567890',
      issuerId: 'issuer-id',
      keyId: 'key-id',
      privateKey: '-----BEGIN PRIVATE KEY-----\nmock\n-----END PRIVATE KEY-----',
    })
    const requests: Array<{ method: string; url: string; body?: any }> = []

    ;(helper as any).makeApiRequest = vi.fn(async (method: string, url: string, body?: any) => {
      requests.push({ method, url, body })
      if (method === 'GET' && url === 'https://api.appstoreconnect.apple.com/v1/appCustomProductPageLocalizations/loc-123/appScreenshotSets') {
        return new Response(JSON.stringify({
          data: [
            {
              id: 'old-65',
              attributes: { screenshotDisplayType: 'APP_IPHONE_65' },
              relationships: { appScreenshots: { data: [{ id: 'old-a' }] } },
            },
            {
              id: 'new-67',
              attributes: { screenshotDisplayType: 'APP_IPHONE_67' },
              relationships: { appScreenshots: { data: [{ id: 'new-a' }, { id: 'new-b' }, { id: 'new-c' }] } },
            },
            {
              id: 'old-55',
              attributes: { screenshotDisplayType: 'APP_IPHONE_55' },
              relationships: { appScreenshots: { data: [{ id: 'old-b' }] } },
            },
          ],
        }), { status: 200 })
      }
      if (method === 'DELETE' && url.startsWith('https://api.appstoreconnect.apple.com/v1/appScreenshotSets/old-')) {
        return new Response(null, { status: 204 })
      }

      return new Response(JSON.stringify({ errors: [{ detail: 'unexpected request' }] }), { status: 500 })
    })

    const result = await helper.pruneCPPScreenshotSets('loc-123', ['APP_IPHONE_67'])

    expect(result).toEqual({
      success: true,
      deletedSetIds: ['old-65', 'old-55'],
      preservedSetIds: ['new-67'],
    })
    expect(requests.filter(request => request.method === 'DELETE').map(request => request.url)).toEqual([
      'https://api.appstoreconnect.apple.com/v1/appScreenshotSets/old-65',
      'https://api.appstoreconnect.apple.com/v1/appScreenshotSets/old-55',
    ])
  })
})
