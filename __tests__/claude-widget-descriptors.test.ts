import { describe, expect, it } from 'vitest'
import { CLAUDE_TOOL_DESCRIPTIONS, getClaudeToolDescription } from '@/lib/mcp/claude-descriptors'
import { CLAUDE_EXCLUDED_TOOLS } from '@/lib/mcp/connector-profile'
import { PUBLIC_CAPABILITIES } from '@/lib/mcp/public-capabilities'
import { readReadinessWidgetResource } from '@/lib/mcp/apps/readiness-widget'
import { readScreenshotWidgetResource } from '@/lib/mcp/apps/screenshot-widget'

describe('Claude resource metadata', () => {
  for (const [name, read] of [['readiness', readReadinessWidgetResource], ['gallery', readScreenshotWidgetResource]] as const) {
    it(`${name} changes only optional standard domain and leaves subsequent default reads untouched`, () => {
      const original = read()
      const serialized = JSON.stringify(original)
      expect(original.contents[0]._meta.ui.domain).toBe('https://applistingagent.com')
      const expected = JSON.parse(serialized)
      delete expected.contents[0]._meta.ui.domain
      const claude = read('claude')
      expect(claude).toEqual(expected)
      expect(claude.contents[0]._meta['openai/widgetDomain']).toBe('https://applistingagent.com')
      expect(JSON.stringify(read())).toBe(serialized)
      expect(JSON.stringify(original)).toBe(serialized)
    })
  }
})

describe('Claude factual descriptors', () => {
  it('covers exactly the retained public catalog and no excluded generation/status tools', () => {
    const retained = PUBLIC_CAPABILITIES.map(tool => tool.name).filter(name => !CLAUDE_EXCLUDED_TOOLS.has(name))
    expect(retained).toHaveLength(44)
    expect(Object.keys(CLAUDE_TOOL_DESCRIPTIONS).sort()).toEqual(retained.sort())
    for (const name of retained) {
      expect(getClaudeToolDescription(name, 'original')).toBe(CLAUDE_TOOL_DESCRIPTIONS[name])
      expect(CLAUDE_TOOL_DESCRIPTIONS[name]).not.toMatch(/always call|you must|start here|use .* before/i)
    }
  })
  it('preserves fallback descriptions including names inherited from Object.prototype', () => {
    for (const name of ['unknown_tool', 'toString', '__proto__', ...CLAUDE_EXCLUDED_TOOLS]) {
      expect(getClaudeToolDescription(name, 'original exact text')).toBe('original exact text')
    }
  })
  it('keeps translation caching distinct from saving and public legal publishing distinct from drafts', () => {
    expect(CLAUDE_TOOL_DESCRIPTIONS.translate_metadata).toContain('metadataSaved=false')
    expect(CLAUDE_TOOL_DESCRIPTIONS.translate_metadata).toContain('without saving them')
    expect(CLAUDE_TOOL_DESCRIPTIONS.update_metadata).toContain('does not publish to a store')
    expect(CLAUDE_TOOL_DESCRIPTIONS.update_legal_document).toContain('public change, not a draft')
    expect(CLAUDE_TOOL_DESCRIPTIONS.translate_custom_page_content).toContain('apply=true it saves')
    expect(CLAUDE_TOOL_DESCRIPTIONS.get_screenshots).toContain('does not create, edit or publish images')
  })
})
