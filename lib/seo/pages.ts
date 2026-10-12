import { DISCOVERY_PAGES } from '@/lib/discovery-pages'
import { SITE_URL } from '@/lib/seo/site'

/**
 * Registry of indexable public pages, used by app/sitemap.ts.
 *
 * `updated` is the date the page's visible content last changed in a way a
 * reader would notice (YYYY-MM-DD). Change it in the same commit as the
 * content, never on a schedule, and never to `new Date()` (fake freshness).
 * Pure wording tweaks (e.g. the 2026-09-24 "App Listing Agent" spacing pass)
 * and link/metadata-only edits do not count; the 2026-09-23 rename did.
 * Pages that are noindex (/book, /login, dashboards, customer legal pages)
 * must not be listed here.
 */
export type IndexedPage = {
  path: string
  updated: string
  priority: number
}

export const INDEXED_PAGES: readonly IndexedPage[] = [
  { path: '/', updated: '2026-09-23', priority: 1 },
  { path: '/pricing', updated: '2026-09-24', priority: 0.9 },
  { path: '/agents', updated: '2026-09-23', priority: 0.9 },
  { path: '/use-cases', updated: '2026-09-23', priority: 0.9 },
  { path: '/audit', updated: '2026-09-25', priority: 0.8 },
  { path: '/compare/fastlane', updated: '2026-09-28', priority: 0.8 },
  { path: '/appstore-copilot', updated: '2026-09-28', priority: 0.7 },
  { path: '/docs', updated: '2026-09-24', priority: 0.7 },
  { path: '/docs/getting-started', updated: '2026-09-24', priority: 0.7 },
  { path: '/docs/mcp', updated: '2026-09-24', priority: 0.7 },
  { path: '/docs/mcp/installation', updated: '2026-09-23', priority: 0.7 },
  { path: '/docs/mcp/tools', updated: '2026-09-24', priority: 0.6 },
  { path: '/docs/authentication', updated: '2026-09-24', priority: 0.6 },
  { path: '/docs/guides/best-practices', updated: '2026-09-24', priority: 0.5 },
  { path: '/changelog', updated: '2026-09-28', priority: 0.5 },
  { path: '/contact', updated: '2026-09-28', priority: 0.4 },
  { path: '/privacy', updated: '2026-09-24', priority: 0.3 },
  { path: '/terms', updated: '2026-09-24', priority: 0.3 },
]

export function sitemapEntries() {
  const pages = [
    ...INDEXED_PAGES,
    ...DISCOVERY_PAGES.map(page => ({
      path: `/use-cases/${page.slug}`,
      updated: page.updated,
      priority: 0.85,
    })),
  ]
  return pages.map(page => ({
    url: page.path === '/' ? SITE_URL : `${SITE_URL}${page.path}`,
    lastModified: page.updated,
    priority: page.priority,
  }))
}
