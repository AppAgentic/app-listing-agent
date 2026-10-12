import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppStoreHelper } from '@/lib/services/appstore'

const ASC = 'https://api.appstoreconnect.apple.com'

function helperWith(handler: (method: string, url: string, body?: any) => Response) {
  const helper = new AppStoreHelper({ appId: '1', issuerId: 'i', keyId: 'k', privateKey: 'p' })
  const calls: Array<{ method: string; url: string; body?: any }> = []
  ;(helper as any).makeApiRequest = vi.fn(async (method: string, url: string, body?: any) => {
    calls.push({ method, url, body })
    return handler(method, url, body)
  })
  return { helper, calls }
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

describe('setSubscriptionAvailability (API 4.4 plan availability)', () => {
  afterEach(() => vi.restoreAllMocks())

  it('creates upfront plan availability when none exists', async () => {
    const { helper, calls } = helperWith((method, url) => {
      if (url === `${ASC}/v1/subscriptions/sub1/planAvailabilities`) return json({ data: [] })
      if (method === 'POST' && url === `${ASC}/v1/subscriptionPlanAvailabilities`) return json({ data: { id: 'pa1' } }, 201)
      throw new Error(`unexpected ${method} ${url}`)
    })
    const result = await helper.setSubscriptionAvailability('sub1', true, ['USA', 'GBR'])
    expect(result).toEqual({ success: true, territories: ['USA', 'GBR'] })
    const post = calls.find(c => c.method === 'POST')!
    expect(post.body.data.attributes).toEqual({ planType: 'UPFRONT', availableInNewTerritories: true })
    expect(post.body.data.relationships.availableTerritories.data).toEqual([
      { type: 'territories', id: 'USA' },
      { type: 'territories', id: 'GBR' },
    ])
    expect(calls.some(c => c.url.endsWith('/v1/subscriptionAvailabilities'))).toBe(false)
  })

  it('keeps an existing upfront plan availability without writing', async () => {
    const { helper, calls } = helperWith((method, url) => {
      if (url === `${ASC}/v1/subscriptions/sub1/planAvailabilities`) {
        return json({ data: [{ id: 'pa1', attributes: { planType: 'UPFRONT', availableInNewTerritories: true } }] })
      }
      throw new Error(`unexpected ${method} ${url}`)
    })
    expect((await helper.setSubscriptionAvailability('sub1', true, ['USA'])).success).toBe(true)
    expect(calls.filter(c => c.method !== 'GET')).toEqual([])
  })

  it('falls back to the deprecated endpoint when the plan call fails', async () => {
    const { helper, calls } = helperWith((method, url) => {
      if (url === `${ASC}/v1/subscriptions/sub1/planAvailabilities`) return json({ data: [] })
      if (url === `${ASC}/v1/subscriptionPlanAvailabilities`) return json({ errors: [{ status: '500' }] }, 500)
      if (url === `${ASC}/v1/subscriptionAvailabilities`) return json({ data: { id: 'a1' } }, 201)
      throw new Error(`unexpected ${method} ${url}`)
    })
    expect((await helper.setSubscriptionAvailability('sub1', true, ['USA'])).success).toBe(true)
    expect(calls.map(c => `${c.method} ${c.url.replace(ASC, '')}`)).toEqual([
      'GET /v1/subscriptions/sub1/planAvailabilities',
      'POST /v1/subscriptionPlanAvailabilities',
      'POST /v1/subscriptionAvailabilities',
    ])
  })
})
