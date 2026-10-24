import type { MetadataRoute } from 'next'

export default function robots(): MetadataRoute.Robots {
  const disallow = ['/dashboard/', '/api/concierge/internal/', '/search']

  return {
    rules: [{
      userAgent: '*',
      allow: ['/', '/agents', '/docs/', '/llms.txt', '/.well-known/'],
      disallow,
    }, ...[
      'meta-webindexer',
      'meta-externalagent',
      'OAI-SearchBot',
      'ChatGPT-User',
      'PerplexityBot',
      'ClaudeBot',
      'Google-Extended',
    ].map((userAgent) => ({ userAgent, allow: '/', disallow }))],
    sitemap: 'https://applistingagent.com/sitemap.xml',
  }
}
