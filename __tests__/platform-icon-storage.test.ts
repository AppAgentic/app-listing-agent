import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import sharp from 'sharp'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { resizeIconForPlatforms } from '@/lib/services/icon-generator'
import { uploadFile } from '@/lib/services/r2'

// Storage/network boundary only: actual Sharp resize, encoding and uploader run.
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

async function fixture() {
  return sharp({ create: { width: 120, height: 80, channels: 3, background: '#7654ae' } }).png().toBuffer()
}

describe('platform icon storage format', () => {
  it('stores actual iOS1024 and Android512 PNG output with matching names and content types', async () => {
    await resizeIconForPlatforms(await fixture(), { userId: 'test-user', projectId: 'test-project' })
    expect(uploads).toHaveLength(2)
    for (const [index, platform] of ['ios', 'android'].entries()) {
      const uploaded = uploads[index]
      const size = platform === 'ios' ? 1024 : 512
      const bytes = uploaded.Body as Buffer
      expect(uploaded.Key).toMatch(new RegExp('/icons/' + platform + '/icon-' + platform + '-[a-f0-9-]+\\.png$'))
      expect(uploaded.ContentType).toBe('image/png')
      expect(bytes.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      expect(await sharp(bytes).metadata()).toMatchObject({ format: 'png', width: size, height: size })
    }
  })

  it('preserves already encoded platform PNG bytes exactly', async () => {
    const bytes = await fixture()
    await uploadFile({ userId: 'test-user', projectId: 'test-project', category: 'icons', iconSize: 'ios',
      filename: 'prepared.png', contentType: 'image/png', data: bytes })
    expect(uploads[0].Body).toEqual(bytes)
    expect(uploads[0].ContentType).toBe('image/png')
  })

  it('retains JPEG optimization for screenshot categories', async () => {
    const bytes = await fixture()
    for (const category of ['raw', 'reference', 'generated', 'final'] as const) {
      await uploadFile({ userId: 'test-user', projectId: 'test-project', category,
        filename: category + '.png', contentType: 'image/png', data: bytes })
    }
    expect(uploads).toHaveLength(4)
    for (const uploaded of uploads) {
      expect(uploaded.ContentType).toBe('image/jpeg')
      expect(uploaded.Key).toMatch(/\.jpg$/)
      expect(await sharp(uploaded.Body as Buffer).metadata()).toMatchObject({ format: 'jpeg', width: 120, height: 80 })
    }
  })
})

  it('stores original icons as PNG and preserves alpha even with a JPEG filename', async () => {
    const bytes = await sharp({ create: { width: 80, height: 80, channels: 4, background: { r: 20, g: 30, b: 40, alpha: 0.4 } } }).png().toBuffer()
    await uploadFile({ userId: 'test-user', projectId: 'test-project', category: 'icons', filename: 'original.jpg', contentType: 'image/png', data: bytes })
    expect(uploads[0].Key).toMatch(/original\.png$/)
    expect(uploads[0].ContentType).toBe('image/png')
    const stored = await sharp(uploads[0].Body as Buffer).metadata()
    expect(stored).toMatchObject({ format: 'png', hasAlpha: true })
    const raw = await sharp(uploads[0].Body as Buffer).raw().toBuffer()
    expect(raw[3]).toBeGreaterThan(0); expect(raw[3]).toBeLessThan(255)
  })

it('crops a non-square source without stretching its circular subject', async () => {
  const bytes = await sharp(Buffer.from('<svg width="120" height="80"><rect width="120" height="80" fill="black"/><circle cx="60" cy="40" r="20" fill="white"/></svg>')).png().toBuffer()
  await resizeIconForPlatforms(bytes, {userId:'test-user',projectId:'test-project'})
  const {data,info}=await sharp(uploads[0].Body as Buffer).removeAlpha().raw().toBuffer({resolveWithObject:true})
  const horizontal=Array.from({length:1024},(_,x)=>data[(512*1024+x)*info.channels]).filter(v=>v>127).length
  const vertical=Array.from({length:1024},(_,y)=>data[(y*1024+512)*info.channels]).filter(v=>v>127).length
  expect(Math.abs(horizontal-vertical)).toBeLessThan(4)
  expect(horizontal).toBeGreaterThan(500)
})
