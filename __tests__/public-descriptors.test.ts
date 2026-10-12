import { describe, expect, it } from 'vitest'
import { TOOL_DEFINITIONS, decoratePublicToolDefinition } from '@/lib/mcp/server'
import { PUBLIC_CAPABILITIES } from '@/lib/mcp/public-capabilities'
import { PUBLIC_TOOL_DESCRIPTIONS } from '@/lib/mcp/public-descriptors'
import { PUBLIC_TOOL_NAME_BY_INTERNAL, publicToolTitle, toInternalToolName, toPublicToolName } from '@/lib/mcp/public-tool-names'

const publicNames = PUBLIC_CAPABILITIES.map(capability => capability.name)
const decorated = publicNames.map(name => decoratePublicToolDefinition(TOOL_DEFINITIONS.find(tool => tool.name === name)!))

// Directory review (OpenAI 2026-09-21): no instructions to the model, no comparative or
// preferential wording, no other tools' names, no internal vendor/infrastructure names.
const BANNED = [
  /\bstart here\b/i, /\balways\b/i, /\bnever\b/i, /\bmust\b/i, /\bonly use\b/i, /\bIMPORTANT\b/, /\bCAUTION\b/,
  /\bunlike\b/i, /\bsimpler\b/i, /\bbetter\b/i, /\bbest\b/i, /\bofficial\b/i, /\brecommended\b/i, /\bprefer/i,
  /\buse this\b/i, /\buse when\b/i, /\bcall (with|this|first)\b/i,
  /\bgemini\b/i, /\bnano banana\b/i, /\bkie\b/i, /\bfal\b/i, /\bR2\b/, /\bfirestore\b/i, /\bopenai\b/i,
]

function collectDescriptions(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) value.forEach(item => collectDescriptions(item, out))
  else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (key === 'description' && typeof child === 'string') out.push(child)
      else collectDescriptions(child, out)
    }
  }
  return out
}

describe('public tool names', () => {
  it('are unique, snake_case verbs without unclear abbreviations', () => {
    const names = decorated.map(tool => tool.name)
    expect(new Set(names).size).toBe(names.length)
    for (const name of names) {
      expect(name).toMatch(/^[a-z]+(_[a-z]+)+$/)
      expect(name).not.toMatch(/(^|_)(cpp|csl|config|appstore|playstore)(_|$)/)
    }
  })

  it('round-trips public and legacy names to the same internal handler', () => {
    for (const [internal, publicName] of Object.entries(PUBLIC_TOOL_NAME_BY_INTERNAL)) {
      expect(publicNames).toContain(internal)
      expect(toPublicToolName(internal)).toBe(publicName)
      expect(toInternalToolName(publicName)).toBe(internal)
      expect(toInternalToolName(internal)).toBe(internal)
    }
    expect(toInternalToolName('toString')).toBe('toString')
  })

  it('titles use product spelling', () => {
    expect(publicToolTitle('upload_appstore_metadata')).toBe('Upload App Store Metadata')
    expect(publicToolTitle('upload_csl_icon')).toBe('Set Custom Store Listing Icon')
  })
})

describe('public tool descriptions', () => {
  it('cover exactly the public catalog', () => {
    expect(Object.keys(PUBLIC_TOOL_DESCRIPTIONS).sort()).toEqual([...publicNames].sort())
    for (const tool of decorated) expect(tool.description).toBe(PUBLIC_TOOL_DESCRIPTIONS[toInternalToolName(tool.name)])
  })

  it('contain no directive, comparative or vendor wording, in tool or parameter descriptions', () => {
    const allToolNames = new Set([...publicNames, ...decorated.map(tool => tool.name)])
    const offenders: string[] = []
    for (const tool of decorated) {
      const texts = [tool.description, ...collectDescriptions(tool.inputSchema)]
      for (const text of texts) {
        for (const pattern of BANNED) if (pattern.test(text)) offenders.push(`${tool.name}: ${pattern} in "${text}"`)
        for (const other of allToolNames) {
          if (other !== tool.name && new RegExp(`\\b${other}\\b`).test(text)) offenders.push(`${tool.name}: names ${other}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })
})
