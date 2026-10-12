import { vi } from 'vitest'

// Mock Next.js request
vi.mock('next/server', () => ({
  NextResponse: class MockNextResponse extends Response {
    static json(body: unknown, init?: ResponseInit) {
      return new Response(JSON.stringify(body), {
        ...init,
        headers: {
          'Content-Type': 'application/json',
          ...Object.fromEntries(new Headers(init?.headers).entries()),
        },
      })
    }
  },
  NextRequest: class MockNextRequest {
    headers: Map<string, string>
    url: string

    constructor(url: string, init?: { headers?: Record<string, string> }) {
      this.url = url
      this.headers = new Map(Object.entries(init?.headers || {}))
    }
  }
}))

// Mock Firebase Admin (for tests that don't need actual Firebase)
vi.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: vi.fn(() => ({
      doc: vi.fn(() => ({
        get: vi.fn(),
        set: vi.fn(),
        update: vi.fn(),
        collection: vi.fn()
      })),
      where: vi.fn(() => ({
        limit: vi.fn(() => ({
          get: vi.fn()
        }))
      }))
    }))
  },
  adminAuth: {
    verifyIdToken: vi.fn(),
    getUser: vi.fn()
  }
}))
