import { afterEach, describe, expect, it, vi } from 'vitest'
import { GET } from '@/app/.well-known/openai-apps-challenge/route'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('OpenAI app domain verification', () => {
  it('fails closed until the submission token is configured', async () => {
    vi.stubEnv('OPENAI_APPS_CHALLENGE', '')
    const response = GET()

    expect(response.status).toBe(404)
    expect(response.headers.get('cache-control')).toBe('no-store')
    await expect(response.text()).resolves.not.toContain('undefined')
  })

  it('serves the exact configured token as plain text without caching', async () => {
    vi.stubEnv('OPENAI_APPS_CHALLENGE', 'openai-domain-proof-123')
    const response = GET()

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/plain')
    expect(response.headers.get('cache-control')).toBe('no-store')
    await expect(response.text()).resolves.toBe('openai-domain-proof-123')
  })
})
