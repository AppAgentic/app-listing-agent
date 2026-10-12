import { afterEach, expect, it, vi } from 'vitest'
vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('NEXT_HTTP_ERROR_FALLBACK;404') } }))
vi.mock('@/app/(dev)/preview/icons/preview', () => ({ IconsPreview: () => null }))
import IconsPreviewPage from '@/app/(dev)/preview/icons/page'
afterEach(() => vi.unstubAllEnvs())
it('refuses the fixture preview in production', () => {
  vi.stubEnv('NODE_ENV', 'production')
  expect(() => IconsPreviewPage()).toThrow('NEXT_HTTP_ERROR_FALLBACK;404')
})
it('renders the fixture preview in development', () => {
  vi.stubEnv('NODE_ENV', 'development')
  expect(IconsPreviewPage()).toBeTruthy()
})
