import { afterEach, describe, expect, it, vi } from 'vitest'
import { generateIconConcepts, fallbackIconConcepts, parseIconConcepts } from '@/lib/services/icon-concepts'
import { ICON_STYLES, LEGACY_ICON_STYLE_MAP, normalizeIconStyle, isIconStyle } from '@/lib/constants'
import { getIconEngine } from '@/lib/services/icon-engine'
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })
describe('icon concept planning', () => {
  it('keeps fallback concepts distinct and deterministic', () => {
    const metadata = { title: 'Atlas', description: 'Routines and streaks' }
    const concepts = fallbackIconConcepts(metadata)
    expect(new Set(concepts.map(c => c.subject)).size).toBe(4)
    expect(concepts).toEqual(fallbackIconConcepts(metadata))
  })
  it('rejects duplicate, incomplete and malformed text output', () => {
    const one = { subject: 'hill', metaphor: 'growth', colorIdea: 'blue' }
    expect(parseIconConcepts(JSON.stringify([one, one]), 2)).toBeNull()
    expect(parseIconConcepts('{}', 4)).toBeNull()
    expect(parseIconConcepts('no json', 4)).toBeNull()
  })
  it('passes all metadata and colours to Gemini and returns validated concepts', async () => {
    vi.stubEnv('GEMINI_API_KEY','test')
    const metadata = { title: 'Atlas', subtitle: 'Daily wins', description: 'Build routines', keywords: 'habits', category: 'fitness' as const }
    const concepts = fallbackIconConcepts(metadata, 2)
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ concepts }) }] } }] })))
    vi.stubGlobal('fetch',fetcher)
    expect(await generateIconConcepts(metadata, 2, { primary: '#123456' })).toEqual(concepts)
    const body = JSON.parse(fetcher.mock.calls[0][1].body).contents[0].parts[0].text
    for (const value of Object.values(metadata)) expect(body).toContain(value)
    expect(body).toContain('#123456')
  })
  it('falls back on timeout without failing generation', async () => {
    vi.stubEnv('GEMINI_API_KEY','test'); vi.stubGlobal('fetch',vi.fn().mockRejectedValue(new Error('timeout')))
    expect(await generateIconConcepts({ title:'Atlas' })).toEqual(fallbackIconConcepts({ title:'Atlas' }))
  })
  it('accepts every old ID and maps only to the ten current styles', () => {
    expect(ICON_STYLES).toHaveLength(10)
    for (const old of Object.keys(LEGACY_ICON_STYLE_MAP)) {
      expect(isIconStyle(old)).toBe(true)
      expect(ICON_STYLES).toContain(normalizeIconStyle(old as keyof typeof LEGACY_ICON_STYLE_MAP))
    }
    for (const style of ICON_STYLES) expect(normalizeIconStyle(style)).toBe(style)
  })
  it('bills the actual engine at 1K without changing unrelated billing configuration', () => {
    vi.stubEnv('ICON_ENGINE','openai'); expect(getIconEngine()).toMatchObject({ provider:'openai', model:'gpt-image-2.5-flare', resolution:'1K', creditWeight:3 })
    vi.stubEnv('ICON_ENGINE','fal'); expect(getIconEngine()).toMatchObject({ provider:'fal', resolution:'1K', creditWeight:3 })
  })
})
