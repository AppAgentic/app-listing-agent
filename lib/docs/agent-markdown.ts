import { createHash } from 'node:crypto'
import { docsHtmlToMarkdown } from './html-to-markdown'
import { PUBLIC_DOCS_PAGES, docsMarkdownUrl } from './public-pages'
import { SITE_URL } from '@/lib/seo/site'

// Renders the markdown twin of a public docs page by fetching the page's own HTML from this
// server and converting its <article>. Docs pages are static per deploy, so each instance
// keeps the result in memory.

export function docsMarkdownPreamble(pageUrl: string): string[] {
  return [`> Markdown version of ${pageUrl}. Index of every docs page for agents: ${SITE_URL}/llms.txt`]
}

export interface RenderedMarkdown {
  markdown: string
  etag: string
}

const cache = new Map<string, Promise<RenderedMarkdown>>()

/** Loopback first (the server's own port), then the origin the request arrived on. */
export function selfOrigins(requestOrigin: string): string[] {
  const port = process.env.PORT || '3000'
  return [...new Set([`http://127.0.0.1:${port}`, requestOrigin])]
}

async function fetchHtml(path: string, origins: string[]): Promise<string> {
  let lastError: unknown = null
  for (const origin of origins) {
    try {
      const response = await fetch(`${origin}${path}`, {
        headers: { accept: 'text/html' },
        redirect: 'manual',
        signal: AbortSignal.timeout(8000),
        cache: 'no-store',
      })
      if (response.ok) return await response.text()
      lastError = new Error(`HTTP ${response.status} from ${origin}${path}`)
    } catch (error) {
      lastError = error
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Could not render docs page')
}

export function markdownEtag(markdown: string): string {
  return `"${createHash('sha256').update(markdown).digest('base64url').slice(0, 27)}"`
}

async function render(path: string, origins: string[]): Promise<RenderedMarkdown> {
  const html = await fetchHtml(path, origins)
  const { markdown } = docsHtmlToMarkdown(html, `${SITE_URL}${path}`, docsMarkdownPreamble(`${SITE_URL}${path}`))
  return { markdown, etag: markdownEtag(markdown) }
}

export function renderDocsMarkdown(path: string, origins: string[]): Promise<RenderedMarkdown> {
  let pending = cache.get(path)
  if (!pending) {
    pending = render(path, origins)
    cache.set(path, pending)
    pending.catch(() => cache.delete(path))
  }
  return pending
}

export async function renderAllDocsMarkdown(origins: string[]): Promise<string> {
  const pages = await Promise.all(PUBLIC_DOCS_PAGES.map(async page => {
    const { markdown } = await renderDocsMarkdown(page.href, origins)
    return `<!-- Source: ${docsMarkdownUrl(page.href)} -->\n\n${markdown.trim()}`
  }))
  return `# App Listing Agent documentation (full text)\n\n> Every public docs page in one file. Per-page index: ${SITE_URL}/llms.txt\n\n${pages.join('\n\n---\n\n')}\n`
}

/** Cache headers for agent-facing text: always revalidate, so an edited page is seen at once. */
export function revalidatingTextHeaders(contentType: string, etag: string): Record<string, string> {
  return {
    'Content-Type': contentType,
    'Cache-Control': 'public, max-age=0, must-revalidate',
    ETag: etag,
    Vary: 'Accept',
    'Access-Control-Allow-Origin': '*',
    'X-Content-Type-Options': 'nosniff',
  }
}

export function isNotModified(ifNoneMatch: string | null, etag: string): boolean {
  if (!ifNoneMatch) return false
  return ifNoneMatch.split(',').map(value => value.trim().replace(/^W\//, '')).includes(etag)
}
