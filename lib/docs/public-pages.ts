import { docsNavigation, type NavItem } from './navigation'
import { SITE_URL } from '@/lib/seo/site'

// The public docs pages (the sidebar), with their markdown twins. Used by the proxy
// (content negotiation and .md URLs), llms.txt, llms-full.txt and the markdown route.

export interface PublicDocsPage {
  title: string
  href: string
  description: string
}

function flatten(items: NavItem[]): NavItem[] {
  return items.flatMap(item => [item, ...flatten(item.items ?? [])])
}

export const PUBLIC_DOCS_PAGES: PublicDocsPage[] = docsNavigation
  .flatMap(section => flatten(section.items))
  .map(item => ({ title: item.title, href: item.href, description: item.description ?? '' }))

const PUBLIC_DOCS_PATHS = new Set(PUBLIC_DOCS_PAGES.map(page => page.href))

export function isPublicDocsPath(pathname: string): boolean {
  return PUBLIC_DOCS_PATHS.has(pathname)
}

export function docsMarkdownUrl(href: string): string {
  return `${SITE_URL}${href}.md`
}

/** `/docs.md` → `/docs`, `/docs/mcp.md` and `/docs/mcp/index.md` → `/docs/mcp`; null when it is not a public docs page. */
export function docsPathFromMarkdownPath(pathname: string): string | null {
  if (!pathname.endsWith('.md')) return null
  const base = pathname.replace(/\/index\.md$/, '').replace(/\.md$/, '')
  return isPublicDocsPath(base) ? base : null
}

/** True when the Accept header ranks text/markdown above text/html (missing q counts as 1). */
export function prefersMarkdown(accept: string | null): boolean {
  if (!accept) return false
  let markdown = -1
  let html = -1
  for (const part of accept.split(',')) {
    const [type, ...params] = part.trim().toLowerCase().split(';')
    const qParam = params.map(param => param.trim()).find(param => param.startsWith('q='))
    const q = qParam ? Number(qParam.slice(2)) : 1
    const weight = Number.isFinite(q) ? q : 0
    if (type.trim() === 'text/markdown' || type.trim() === 'text/x-markdown') markdown = Math.max(markdown, weight)
    if (type.trim() === 'text/html' || type.trim() === 'application/xhtml+xml') html = Math.max(html, weight)
  }
  return markdown > 0 && markdown >= html
}
