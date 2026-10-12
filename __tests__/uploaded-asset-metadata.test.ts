import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import sharp from 'sharp'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import type { AccountContext } from '@/lib/org/context'
import { uploadScreenshotAsset } from '@/lib/mcp/tools/generate-screenshots'

vi.mock('@/lib/org/context', () => ({ getProjectContext: vi.fn(async () => ({ type: 'personal' })), hasContextPermission: vi.fn(() => true) }))
vi.mock('@/lib/services/screenshot-generator', () => ({}))
vi.mock('@/lib/api/usage', () => ({}))
vi.mock('@/lib/org/audit', () => ({}))
vi.mock('@/lib/mcp/tools/screenshot-jobs', () => ({}))
vi.mock('@aws-sdk/s3-request-presigner', () => ({ getSignedUrl: vi.fn(async () => 'https://storage.test/asset') }))

const uploads: Array<{ Key?: string; Body?: unknown; ContentType?: string }> = []
beforeEach(() => {
  uploads.length = 0
  vi.stubEnv('R2_ACCESS_KEY_ID', 'test-only')
  vi.stubEnv('R2_SECRET_ACCESS_KEY', 'test-only')
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(S3Client.prototype, 'send').mockImplementation(async command => {
    expect(command).toBeInstanceOf(PutObjectCommand)
    uploads.push((command as PutObjectCommand).input)
    return {} as never
  })
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs() })

describe('stored screenshot upload metadata', () => {
  it.each(['reference', 'raw', 'temp'] as const)('reports actual stored bytes and MIME for %s uploads', async category => {
    const input = await sharp({ create: { width: 1024, height: 500, channels: 3, background: '#7654ae' } }).png().toBuffer()
    const result = await uploadScreenshotAsset({ projectId: 'fixture', category, filename: 'banner.png', dataUrl: 'data:image/png;base64,' + input.toString('base64') }, { userId: 'fixture' } as AccountContext)
    expect(result.success).toBe(true)
    expect(uploads).toHaveLength(1)
    const stored = uploads[0].Body as Buffer
    const optimized = category !== 'temp'
    expect(result.contentType).toBe(optimized ? 'image/jpeg' : 'image/png')
    expect(result.contentType).toBe(uploads[0].ContentType)
    expect(result.sizeBytes).toBe(stored.length)
    expect(result.key).toBe(uploads[0].Key)
    expect(result.key).toMatch(optimized ? /\.jpg$/ : /\.png$/)
    expect(await sharp(stored).metadata()).toMatchObject({ format: optimized ? 'jpeg' : 'png', width: 1024, height: 500 })
    if (optimized) expect(stored.length).not.toBe(input.length)
    else expect(stored).toEqual(input)
  })
})
