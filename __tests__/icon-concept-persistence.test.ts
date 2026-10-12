import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ set: vi.fn(), get: vi.fn() }))
vi.mock('@/lib/api/rate-limit', () => ({
  rateLimit: async () => ({ success: true }),
  RATE_LIMITS: { ai: {}, read: {} },
}))
vi.mock('@/lib/auth/session', () => ({
  getSession: async () => ({ userId: 'fixture-user' }),
}))
vi.mock('@/lib/org/context', () => ({
  getAccountContext: async () => ({ userId: 'fixture-user' }),
  getProjectContext: async () => ({ type: 'personal' }),
  hasContextPermission: () => true,
}))
vi.mock('@/lib/api/auth', () => ({
  authenticateRequest: vi.fn(),
  errorResponse: (error: string, status = 400) =>
    Response.json({ error }, { status }),
  unauthorizedResponse: () => Response.json({}, { status: 401 }),
}))
vi.mock('@/lib/api/usage', () => ({
  reserveUsage: async () => ({ allowed: true }),
  settleUsage: vi.fn(),
  refundUsage: vi.fn(),
  createReservationErrorResponse: vi.fn(),
}))
vi.mock('@/lib/services/icon-generator', () => ({
  generateIcon: async () => ({
    success: true,
    originalUrl: 'https://fixture.test/icon.png',
    ios: 'ios.png',
    android: 'android.png',
  }),
}))
vi.mock('@/lib/services/icon-engine', () => ({
  getIconEngine: () => ({ creditWeight: 3, model: 'fixture' }),
}))
vi.mock('@/lib/org/audit', () => ({ logAuditEvent: vi.fn(), AuditAction: {} }))
vi.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: () => {
      const chain = {
        doc: () => chain,
        collection: () => chain,
        orderBy: () => chain,
        limit: () => chain,
        get: mocks.get,
        set: mocks.set,
      }
      return chain
    },
  },
}))
import { POST as generate } from '@/app/api/icons/generate/route'
import { POST as list } from '@/app/api/icons/list/route'
import type { NextRequest } from 'next/server'
const request = (body: unknown) =>
  new Request('http://localhost/api/icons', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as NextRequest
beforeEach(() => {
  vi.clearAllMocks()
})
describe('icon concept display metadata', () => {
  it('retains the chosen concept through generation, storage and history reload', async () => {
    const concept = {
      subject: 'The glass summit',
      metaphor: 'Daily progress',
      colorIdea: 'Blue and gold',
    }
    const response = await generate(
      request({
        projectId: 'fixture',
        source: { type: 'prompt', prompt: 'A habit tracking mountain' },
        concept,
        style: 'liquid-glass',
      }),
    )
    expect(response.status).toBe(200)
    expect((await response.json()).concept).toEqual(concept)
    expect(mocks.set.mock.calls[0][0].concept).toEqual(concept)
    mocks.get.mockResolvedValue({
      docs: [{ id: 'icon-1', data: () => mocks.set.mock.calls[0][0] }],
    })
    const history = await list(request({ projectId: 'fixture' }))
    expect((await history.json()).icons[0].concept).toEqual(concept)
  })
  it('keeps old history records readable without invented concept names', async () => {
    mocks.get.mockResolvedValue({
      docs: [
        {
          id: 'legacy',
          data: () => ({ style: 'minimalist', originalUrl: 'icon.png' }),
        },
      ],
    })
    const response = await list(request({ projectId: 'fixture' }))
    expect((await response.json()).icons[0]).toMatchObject({
      id: 'legacy',
      concept: null,
      style: 'minimalist',
    })
  })
})
