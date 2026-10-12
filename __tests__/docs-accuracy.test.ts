import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { docsNavigation } from '@/lib/docs/navigation'
import { REMOVED_DOCS_REDIRECTS } from '@/lib/docs/redirects'
import { PUBLIC_LAUNCH_TOOL_NAMES } from '@/lib/mcp/public-capabilities'
import { PUBLIC_TOOL_NAME_BY_INTERNAL } from '@/lib/mcp/public-tool-names'

const DOCS_ROOT = resolve(process.cwd(), 'app/(docs)/docs')

function pageFile(href: string): string {
  const path = href.split('#')[0].replace(/^\/docs\/?/, '')
  return join(DOCS_ROOT, path, 'page.tsx')
}

function docsSources(dir = DOCS_ROOT): string[] {
  return readdirSync(dir).flatMap(entry => {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) return docsSources(full)
    return full.endsWith('.tsx') ? [full] : []
  })
}

const publicSources = () => [
  ...docsSources().filter(file => !/\/mcp\/(create-|iap-|list-iap|revenuecat|set-iap|sync-iap|sync-to-revenuecat|update-iap)/.test(file)),
  resolve(process.cwd(), 'components/docs/docs-footer.tsx'),
  resolve(process.cwd(), 'components/docs/docs-navbar.tsx'),
]

describe('public docs describe only what exists', () => {
  it('every sidebar entry points to a real docs page', () => {
    for (const section of docsNavigation) {
      for (const item of section.items) {
        for (const entry of [item, ...(item.items ?? [])]) {
          expect(existsSync(pageFile(entry.href)), entry.href).toBe(true)
        }
      }
    }
  })

  it('does not advertise the nonexistent REST host, CLI, SDKs or dead links', () => {
    for (const file of publicSources()) {
      const text = readFileSync(file, 'utf8')
      expect(text, file).not.toContain('api.applistingagent.com')
      expect(text, file).not.toContain('@applistingagent/cli')
      expect(text, file).not.toMatch(/href=["']\/(help|blog|about)["']/)
      expect(text, file).not.toMatch(/href=["']\/docs\/(api|cli|sdks)\b/)
      expect(text, file).not.toContain('github.com/ruvix/applistingagent')
    }
  })

  it('removed docs pages redirect to a page that exists', () => {
    for (const [source, destination] of REMOVED_DOCS_REDIRECTS) {
      expect(existsSync(pageFile(source.replace('/:path*', ''))), source).toBe(false)
      expect(existsSync(pageFile(destination)), destination).toBe(true)
    }
  })

  it('names MCP tools in the overview by their public names', () => {
    const overview = readFileSync(join(DOCS_ROOT, 'mcp/page.tsx'), 'utf8')
    const publicNames = new Set(
      [...PUBLIC_LAUNCH_TOOL_NAMES].map(name => PUBLIC_TOOL_NAME_BY_INTERNAL[name] ?? name)
    )
    const listed = [...overview.matchAll(/name: '([a-z_]+)'/g)].map(match => match[1])
    expect(listed.length).toBeGreaterThan(0)
    for (const name of listed) expect(publicNames.has(name), name).toBe(true)
    for (const legacy of Object.keys(PUBLIC_TOOL_NAME_BY_INTERNAL)) {
      expect(overview, legacy).not.toMatch(new RegExp(`\\b${legacy}\\b`))
    }
  })
})
