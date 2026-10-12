import type { MetadataRoute } from 'next'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: ['/', '/agents', '/docs/', '/llms.txt', '/.well-known/'],
      disallow: ['/dashboard/', '/api/concierge/internal/', '/search'],
    },
    sitemap: 'https://applistingagent.com/sitemap.xml',
  }
}

