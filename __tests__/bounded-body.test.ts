import { eventSchema } from '@/lib/api/concierge-event-input'
import { describe, expect, it } from 'vitest'
import { readBoundedJson, readBoundedText, RequestBodyLimitError } from '@/lib/api/bounded-body'
import { startJobSchema, iapTranslateSchema } from '@/lib/api/translation-input'
import { readBoundedMCPRequest, MAX_MCP_REQUEST_BYTES } from '@/lib/mcp/request-security'

function streamed(chunks: Uint8Array[], length?: string) {
  let pulled = 0
  let cancelled = false
  const body = new ReadableStream({
    pull(controller) {
      if (pulled < chunks.length) controller.enqueue(chunks[pulled++])
      else controller.close()
    },
    cancel() { cancelled = true },
  }, { highWaterMark: 0 })
  const request = new Request('https://example.test/api', {
    method: 'POST', body, duplex: 'half',
    headers: length ? { 'content-length': length } : {},
  } as RequestInit)
  return { request, pulled: () => pulled, cancelled: () => cancelled }
}
const bytes = (text: string) => new TextEncoder().encode(text)

describe('streamed request bounds', () => {
  it.each([undefined, '1'])('stops at the first over-limit chunk with Content-Length %s', async length => {
    const input = streamed([bytes('1234'), bytes('5'), bytes('never consumed')], length)
    await expect(readBoundedText(input.request, 4)).rejects.toBeInstanceOf(RequestBodyLimitError)
    expect(input.pulled()).toBe(2)
    expect(input.cancelled()).toBe(true)
  })
  it('rejects an oversized declaration before pulling the stream', async () => {
    const input = streamed([bytes('{}')], '5')
    await expect(readBoundedText(input.request, 4)).rejects.toBeInstanceOf(RequestBodyLimitError)
    expect(input.pulled()).toBe(0)
  })
  it('accepts the exact byte boundary including split multibyte UTF-8', async () => {
    const content = bytes('"é"')
    const input = streamed([content.slice(0, 2), content.slice(2)])
    expect(await readBoundedJson(input.request, 4)).toBe('é')
  })
  it('bounds collections before schema validation', async () => {
    const input = streamed([bytes(JSON.stringify({ values: Array(1025).fill(0) }))])
    await expect(readBoundedJson(input.request)).rejects.toThrow('Too many collection entries')
  })
  it('keeps inline image capacity', async () => {
    const value = 'a'.repeat(2 * 1024 * 1024)
    const input = streamed([bytes(JSON.stringify({ image: value }))])
    expect(await readBoundedJson(input.request)).toEqual({ image: value })
  })
  it('enforces the MCP limit on streamed bodies without a truthful header', async () => {
    const input = streamed([new Uint8Array(MAX_MCP_REQUEST_BYTES), bytes('x'), bytes('unread')], '1')
    expect((await readBoundedMCPRequest(input.request)).error?.status).toBe(413)
    expect(input.pulled()).toBe(2)
    expect(input.cancelled()).toBe(true)
  })
})

describe('translation input capacity', () => {
  const locales = Array.from({ length: 200 }, (_, i) => `locale-${i}`)
  it('accepts all supported store locales and a large screenshot selection', () => {
    expect(iapTranslateSchema.safeParse({ projectId: 'p', iapId: 'i', targetLocales: locales }).success).toBe(true)
    expect(startJobSchema.safeParse({ projectId: 'p', targetLocales: locales, screenshotIds: Array(500).fill('id') }).success).toBe(true)
  })
  it('preserves a full locale/screenshot matrix through the actual reader and schema', async () => {
    const value = { projectId: 'p', targetLocales: locales,
      screenshotIdsByLocale: Object.fromEntries(locales.map(locale => [locale, Array(500).fill('id')])) }
    const input = streamed([bytes(JSON.stringify(value))])
    expect(startJobSchema.safeParse(await readBoundedJson(input.request, 1024 * 1024, 125_000)).success).toBe(true)
  })
  it('rejects just-over-limit locales, screenshots, maps and instructions', () => {
    expect(iapTranslateSchema.safeParse({ projectId: 'p', iapId: 'i', targetLocales: [...locales, 'extra'] }).success).toBe(false)
    const base = { projectId: 'p', targetLocales: ['en-US'] }
    expect(startJobSchema.safeParse({ ...base, screenshotIds: Array(501).fill('id') }).success).toBe(false)
    expect(startJobSchema.safeParse({ ...base, screenshotIdsByLocale: { en: Array(501).fill('id') } }).success).toBe(false)
    expect(startJobSchema.safeParse({ ...base, screenshotIdsByLocale: Object.fromEntries(Array.from({ length: 201 }, (_, i) => [i, []])) }).success).toBe(false)
    expect(startJobSchema.safeParse({ ...base, perScreenshotInstructions: Object.fromEntries(Array.from({ length: 501 }, (_, i) => [i, 'short'])) }).success).toBe(false)
  })
})

it('caps public event metadata at 32 entries', async () => {
  const metadata = Object.fromEntries(Array.from({ length: 32 }, (_, i) => [`key${i}`, 'value']))
  const input = { name: 'page_view', metadata }
  // Use a real allowed event name from the schema without relying on provider calls.
  const name = eventSchema.shape.name.options[0]
  expect(eventSchema.safeParse({ ...input, name }).success).toBe(true)
  expect(eventSchema.safeParse({ ...input, name, metadata: { ...metadata, extra: 'value' } }).success).toBe(false)
})
