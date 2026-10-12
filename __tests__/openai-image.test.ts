import { afterEach, describe, expect, it, vi } from 'vitest'
import { generateOpenAIImage } from '@/lib/services/openai-image'
const success = () => new Response(JSON.stringify({ data: [{ b64_json: Buffer.from('png fixture').toString('base64') }], usage: { output_tokens: 100 } }), { headers: { 'x-request-id': 'req-test' } })
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })
describe('OpenAI image transport', () => {
  it('uses the requested model, high 1024 PNG and captures usage/request id', async () => {
    const fetcher = vi.fn().mockResolvedValue(success()); vi.stubGlobal('fetch', fetcher)
    const result = await generateOpenAIImage({ prompt: 'A summit', apiKey: 'test', background: 'transparent' })
    const [url, request] = fetcher.mock.calls[0]
    expect(url).toBe('https://api.openai.com/v1/images/generations')
    expect(JSON.parse(request.body)).toMatchObject({ model: 'gpt-image-2.5-flare', quality: 'high', size: '1024x1024', output_format: 'png', n: 1, background: 'transparent' })
    expect(result).toMatchObject({ requestId: 'req-test', usage: { output_tokens: 100 } })
  })
  it('uploads edit references as multipart files with explicit MIME and no manual boundary', async () => {
    const fetcher = vi.fn().mockResolvedValue(success()); vi.stubGlobal('fetch', fetcher)
    await generateOpenAIImage({ prompt: 'Make it glass', apiKey: 'test', images: [{ data: new Uint8Array([1,2]), mimeType: 'image/png' }] })
    const [url, request] = fetcher.mock.calls[0]
    expect(url).toMatch(/\/edits$/)
    expect(request.headers['Content-Type']).toBeUndefined()
    expect(request.body.getAll('image[]')[0].type).toBe('image/png')
    expect(request.body.get('quality')).toBe('high')
  })
  it.each([500, 502, 400])('does not replay HTTP %s', async status => {
    const fetcher = vi.fn().mockResolvedValue(new Response('error', { status })); vi.stubGlobal('fetch', fetcher)
    await expect(generateOpenAIImage({ prompt: 'test', apiKey: 'test' })).rejects.toThrow('No automatic replay')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('does not replay a timeout or malformed successful response', async () => {
    const fetcher = vi.fn().mockRejectedValueOnce(new Error('timeout')).mockResolvedValueOnce(new Response('{}')); vi.stubGlobal('fetch', fetcher)
    await expect(generateOpenAIImage({ prompt: 'test', apiKey: 'test' })).rejects.toThrow('timeout')
    expect(fetcher).toHaveBeenCalledTimes(1)
    await expect(generateOpenAIImage({ prompt: 'test', apiKey: 'test' })).rejects.toThrow('no image')
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
  it('retries explicit rate-limit rejection only', async () => {
    vi.useFakeTimers()
    const fetcher = vi.fn().mockResolvedValueOnce(new Response('{}', { status: 429, headers: { 'retry-after':'1' } })).mockResolvedValueOnce(success()); vi.stubGlobal('fetch', fetcher)
    const pending = generateOpenAIImage({ prompt: 'test', apiKey: 'test' })
    await vi.runAllTimersAsync(); await pending
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
})
