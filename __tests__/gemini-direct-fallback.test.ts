import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  generateGeminiImageWithDirectFallback,
  generateGeminiTextWithDirectFallback,
} from '@/lib/services/gemini-direct'

describe('Gemini direct API fallback', () => {
  beforeEach(() => {
    vi.stubEnv('GEMINI_DIRECT_API_KEY', 'fallback-test-key')
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('does not call the fallback when the primary text SDK succeeds', async () => {
    const result = await generateGeminiTextWithDirectFallback({
      model: 'gemini-test',
      prompt: 'Translate me',
      generatePrimary: async () => 'Primary result',
    })

    expect(result).toEqual({ text: 'Primary result', source: 'primary-sdk' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('uses one direct text request with the key in a header after primary failure', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: 'Fallback result' }] } }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))

    const result = await generateGeminiTextWithDirectFallback({
      model: 'gemini-test',
      prompt: 'Translate me',
      generatePrimary: async () => { throw Object.assign(new Error('primary failed'), { status: 400 }) },
    })

    expect(result).toEqual({ text: 'Fallback result', source: 'direct-api' })
    expect(fetch).toHaveBeenCalledTimes(1)
    const [url, init] = vi.mocked(fetch).mock.calls[0]
    expect(String(url)).not.toContain('key=')
    expect(init?.headers).toMatchObject({ 'x-goog-api-key': 'fallback-test-key' })
  })

  it('does not call the fallback after a completed primary image response without image data', async () => {
    const result = await generateGeminiImageWithDirectFallback({
      model: 'gemini-image-test',
      contents: [{ role: 'user', parts: [{ text: 'Create an image' }] }],
      generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
      generatePrimary: async () => null,
    })

    expect(result).toEqual({ image: null, source: 'primary-sdk' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('uses one direct image request after the primary SDK throws', async () => {
    const image = Buffer.from('test-image')
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: image.toString('base64') } }] } }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))

    const result = await generateGeminiImageWithDirectFallback({
      model: 'gemini-image-test',
      contents: [{ role: 'user', parts: [{ text: 'Create an image' }] }],
      generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
      generatePrimary: async () => { throw Object.assign(new Error('primary failed'), { status: 503 }) },
    })

    expect(result.source).toBe('direct-api')
    expect(result.image).toEqual(image)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('returns a sanitized direct API error without response details', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({
      error: {
        code: 403,
        status: 'PERMISSION_DENIED',
        message: 'sensitive provider detail',
        details: [{ reason: 'API_KEY_SERVICE_BLOCKED' }],
      },
    }), { status: 403, headers: { 'Content-Type': 'application/json' } }))

    await expect(generateGeminiTextWithDirectFallback({
      model: 'gemini-test',
      prompt: 'Translate me',
      generatePrimary: async () => { throw new Error('primary failed') },
    })).rejects.toThrow('Gemini direct fallback failed (PERMISSION_DENIED:API_KEY_SERVICE_BLOCKED)')
  })
})
