import { describe, expect, it } from 'vitest'
import { measureMetadataFields } from '@/lib/mcp/metadata-field-lengths'

describe('metadata length units and store limits', () => {
  it('counts combining marks, whitespace and astral characters without rewriting input', () => {
    expect(measureMetadataFields('appstore', { title: ' e\u0301🧭 ' }).title).toEqual({ characterCount: 5, limit: 30, withinLimit: true })
  })
  it('reports exact Play boundaries and omits unsupported fields', () => {
    expect(measureMetadataFields('playstore', { title: 'a'.repeat(31), shortDescription: 'b'.repeat(80), fullDescription: 'c'.repeat(4001), subtitle: 'not supported' })).toEqual({
      title: { characterCount: 31, limit: 30, withinLimit: false },
      shortDescription: { characterCount: 80, limit: 80, withinLimit: true },
      fullDescription: { characterCount: 4001, limit: 4000, withinLimit: false },
    })
  })
})
