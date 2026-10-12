// Kept outside next.config.ts: Firebase App Hosting rewrites next.config.ts at build
// time and drops its named exports, so tests can't import from it.
const REMOVED_MCP_TOOL_DOC_SLUGS = [
  'metadata-tools',
  'screenshot-tools',
  'icon-tools',
  'utility-tools',
  'translate-metadata',
  'update-metadata',
  'upload-appstore',
  'upload-playstore',
  'sync-stores',
  'generate-screenshot',
  'generate-screenshot-set',
  'suggest-headlines',
  'generate-icon',
  'generate-icon-variations',
  'fetch-appstore-icon',
  'resize-icon',
  'list-locales',
  'validate-config',
  'update-legal-document',
]

export const REMOVED_DOCS_REDIRECTS: ReadonlyArray<readonly [string, string]> = [
  ['/docs/api', '/docs/authentication'],
  ['/docs/api/:path*', '/docs/authentication'],
  ['/docs/cli', '/docs/mcp'],
  ['/docs/cli/:path*', '/docs/mcp'],
  ['/docs/sdks', '/docs/mcp'],
  ['/docs/sdks/:path*', '/docs/mcp'],
  ['/docs/guides/ci-cd', '/docs/mcp'],
  ['/docs/guides/workflows', '/docs/mcp'],
  ...REMOVED_MCP_TOOL_DOC_SLUGS.map(slug => [`/docs/mcp/${slug}`, '/docs/mcp/tools'] as const),
]
