import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  redactSensitiveMCPText,
  sanitizeMCPPublicOutput,
} from '@/lib/mcp/public-output'

describe('MCP public output redaction', () => {
  it.each([
    ['icon', 'lib/mcp/tools/generate-icon.ts', 2],
    ['screenshot', 'lib/mcp/tools/generate-screenshots.ts', 3],
  ] as const)('serializes the reachable %s allowance denials without purchase directions', (kind, path, expectedBranches) => {
    // Exercise the actual quota response objects, rather than a duplicate fixture
    // that could silently diverge from the reachable public handlers.
    const source = readFileSync(path, 'utf8')
    const branches = [...source.matchAll(/return\s+(\{\s*success: false,\s*error: 'This feature requires a paid plan\.[\s\S]*?upgradeUrl: '\/billing',?\s*\})/g)]
    expect(branches).toHaveLength(expectedBranches)
    for (const [, literal] of branches) {
      const raw = Function(`return (${literal})`)()
      const output = JSON.parse(JSON.stringify(sanitizeMCPPublicOutput(raw)))
      expect(output).toEqual({
        success: false,
        error: `Insufficient ${kind} generation allowance. This request did not start generation or consume credits.`,
      })
      expect(raw.upgradeUrl).toBe('/billing')
      expect(raw.requiresUpgrade).toBe(true)
    }
  })

  it('preserves unrelated customer content and ordinary quota details', () => {
    const unrelated = {
      success: true,
      metadata: { description: 'Upgrade to Pro', upgradeUrl: '/billing' },
      results: [{ success: false, error: 'Icon limit exceeded. Remaining: 0' }],
    }
    expect(sanitizeMCPPublicOutput(unrelated)).toEqual(unrelated)
  })

  it('redacts secrets, signed query values, tokens, and email from errors', () => {
    const value = redactSensitiveMCPText(
      'Bearer abc.def.ghi for owner@example.com failed at https://example.com/a?token=secret-value&ok=1 using asc_live_abcdefghijklmnop'
    )
    expect(value).not.toContain('abc.def.ghi')
    expect(value).not.toContain('owner@example.com')
    expect(value).not.toContain('secret-value')
    expect(value).not.toContain('asc_live_abcdefghijklmnop')
    expect(value).toContain('ok=1')
  })

  it('redacts PEM private-key blocks', () => {
    const value = redactSensitiveMCPText('Failed: -----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY-----')
    expect(value).toBe('Failed: [redacted-private-key]')
  })

  it('redacts nested provider errors without breaking successful asset URLs', () => {
    const asset = 'https://assets.example.com/image.png?signature=needed-for-rendering'
    const sanitized = sanitizeMCPPublicOutput({
      success: false,
      asset,
      provider: { errorMessage: 'Failed with ?api_key=private-value' },
    }) as Record<string, any>
    expect(sanitized.asset).toBe(asset)
    expect(sanitized.provider.errorMessage).not.toContain('private-value')
  })

  it('preserves non-plain objects for their normal serializers', () => {
    const createdAt = new Date('2026-08-27T12:00:00.000Z')
    const sanitized = sanitizeMCPPublicOutput({ createdAt }) as Record<string, unknown>
    expect(sanitized.createdAt).toBe(createdAt)
  })
})
