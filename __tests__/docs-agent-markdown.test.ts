import { describe, expect, it } from 'vitest'
import { docsHtmlToMarkdown } from '@/lib/docs/html-to-markdown'
import { isNotModified, markdownEtag } from '@/lib/docs/agent-markdown'
import {
  PUBLIC_DOCS_PAGES,
  docsMarkdownUrl,
  docsPathFromMarkdownPath,
  isPublicDocsPath,
  prefersMarkdown,
} from '@/lib/docs/public-pages'
import { GET as llmsTxt } from '@/app/llms.txt/route'
import { PUBLIC_DOCS_PATHS } from '@/lib/docs/public-paths'

describe('public docs pages', () => {
  it('every sidebar page has a description for llms.txt', () => {
    expect(PUBLIC_DOCS_PAGES.length).toBeGreaterThan(5)
    for (const page of PUBLIC_DOCS_PAGES) expect(page.description, page.href).not.toBe('')
  })

  it('next.config cache headers cover exactly the sidebar pages', () => {
    expect([...PUBLIC_DOCS_PATHS].sort()).toEqual(PUBLIC_DOCS_PAGES.map(page => page.href).sort())
  })

  it('maps .md URLs back to docs pages and rejects everything else', () => {
    expect(docsPathFromMarkdownPath('/docs.md')).toBe('/docs')
    expect(docsPathFromMarkdownPath('/docs/mcp.md')).toBe('/docs/mcp')
    expect(docsPathFromMarkdownPath('/docs/mcp/index.md')).toBe('/docs/mcp')
    expect(docsPathFromMarkdownPath('/docs/mcp/tools.md')).toBe('/docs/mcp/tools')
    expect(docsPathFromMarkdownPath('/docs/nope.md')).toBeNull()
    expect(docsPathFromMarkdownPath('/pricing.md')).toBeNull()
    expect(docsPathFromMarkdownPath('/docs/mcp')).toBeNull()
    expect(isPublicDocsPath('/docs/authentication')).toBe(true)
    expect(isPublicDocsPath('/dashboard')).toBe(false)
  })

  it('only serves markdown when Accept ranks it at least as high as HTML', () => {
    expect(prefersMarkdown('text/markdown')).toBe(true)
    expect(prefersMarkdown('text/markdown, text/html;q=0.9')).toBe(true)
    expect(prefersMarkdown('text/html,application/xhtml+xml,*/*;q=0.8')).toBe(false)
    expect(prefersMarkdown('text/html, text/markdown;q=0.5')).toBe(false)
    expect(prefersMarkdown('text/markdown;q=0')).toBe(false)
    expect(prefersMarkdown(null)).toBe(false)
  })
})

describe('llms.txt', () => {
  it('lists the .md version of every docs page and keeps the agent endpoints first', async () => {
    const body = await llmsTxt().text()
    for (const page of PUBLIC_DOCS_PAGES) expect(body).toContain(`(${docsMarkdownUrl(page.href)})`)
    expect(body.indexOf('## Agent endpoints')).toBeLessThan(body.indexOf('## Docs'))
    expect(body).not.toMatch(/—/)
  })
})

describe('docsHtmlToMarkdown', () => {
  const html = `<!doctype html><html><head><title>Quick Start | Docs</title>
    <meta name="description" content="Start here."></head><body>
    <nav><a href="/docs">Sidebar link</a></nav>
    <article>
      <h1>Quick Start</h1>
      <p>Connect your <strong>agent</strong> via <a href="/docs/mcp">MCP</a>.</p>
      <div data-callout="info" role="alert"><svg></svg><div><p data-callout-title="">Note</p><div><p>Uses allowance.</p></div></div></div>
      <div data-code-block="" data-code-title="Endpoint"><pre><code>https://applistingagent.com/api/mcp</code></pre></div>
      <ul><li>One</li><li>Two</li></ul>
      <button>Copy</button>
    </article></body></html>`

  it('converts only the article, keeps links absolute and adds the preamble after the H1', () => {
    const { title, description, markdown } = docsHtmlToMarkdown(html, 'https://applistingagent.com/docs/getting-started', ['> Preamble'])
    expect(title).toBe('Quick Start | Docs')
    expect(description).toBe('Start here.')
    expect(markdown.startsWith('# Quick Start\n\n> Preamble')).toBe(true)
    expect(markdown).toContain('[MCP](https://applistingagent.com/docs/mcp)')
    expect(markdown).toContain('**agent**')
    expect(markdown).toContain('> **Note**')
    expect(markdown).toContain('```\nhttps://applistingagent.com/api/mcp\n```')
    expect(markdown).toContain('- One\n- Two')
    expect(markdown).not.toContain('Sidebar link')
    expect(markdown).not.toContain('Copy')
  })
})

describe('markdown ETags', () => {
  it('is stable per body and honours If-None-Match lists and weak tags', () => {
    const etag = markdownEtag('# A\n')
    expect(markdownEtag('# A\n')).toBe(etag)
    expect(markdownEtag('# B\n')).not.toBe(etag)
    expect(isNotModified(`"x", W/${etag}`, etag)).toBe(true)
    expect(isNotModified(null, etag)).toBe(false)
  })
})
