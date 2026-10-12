import type { MetadataRoute } from 'next'
import { sitemapEntries } from '@/lib/seo/pages'

// lastModified comes from per-page dates in lib/seo/pages.ts and
// lib/discovery-pages.ts, updated only when a page's content changes.
export default function sitemap(): MetadataRoute.Sitemap {
  return sitemapEntries()
}
