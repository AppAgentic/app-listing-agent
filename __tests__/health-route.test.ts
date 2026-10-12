import { beforeEach, describe, expect, it, vi } from 'vitest'

const get = vi.fn()

vi.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: () => ({
      doc: () => ({ get }),
    }),
  },
}))

import { GET } from '@/app/api/health/route'

describe('GET /api/health', () => {
  beforeEach(() => {
    get.mockReset()
  })

  it('reports healthy only after Firestore responds', async () => {
    get.mockResolvedValueOnce({ exists: false })

    const response = await GET()
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(body.status).toBe('ok')
    expect(body.checks).toEqual({ app: 'ok', firestore: 'ok' })
  })

  it('returns a sanitized 503 when Firestore is unavailable', async () => {
    get.mockRejectedValueOnce(new Error('secret database detail'))

    const response = await GET()
    const body = await response.json()

    expect(response.status).toBe(503)
    expect(body.status).toBe('unavailable')
    expect(body.checks.firestore).toBe('error')
    expect(JSON.stringify(body)).not.toContain('secret database detail')
  })
})
