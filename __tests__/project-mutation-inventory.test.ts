import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

const MUTATING_ROUTE_FILES = [
  'app/api/custom-product-pages/route.ts',
  'app/api/custom-product-pages/[pageId]/route.ts',
  'app/api/custom-product-pages/[pageId]/localizations/route.ts',
  'app/api/custom-product-pages/[pageId]/screenshots/route.ts',
  'app/api/custom-product-pages/pull/route.ts',
  'app/api/custom-store-listings/route.ts',
  'app/api/custom-store-listings/[listingId]/route.ts',
  'app/api/custom-store-listings/[listingId]/localizations/route.ts',
  'app/api/custom-store-listings/[listingId]/screenshots/route.ts',
  'app/api/custom-store-listings/_helpers.ts',
  'app/api/metadata/draft/route.ts',
  'app/api/projects/[projectId]/link/route.ts',
  'app/api/projects/[projectId]/sync/route.ts',
  'app/api/screenshots/upload-images/route.ts',
  'app/api/support/ai-content/route.ts',
  'app/api/support/ai-content/sync/route.ts',
  'app/api/support/help-center/articles/route.ts',
  'app/api/support/help-center/articles/[articleId]/route.ts',
  'app/api/support/tickets/[ticketId]/messages/route.ts',
  'app/api/support/tickets/[ticketId]/route.ts',
  'app/api/whop-project/checkout/route.ts',
  'app/api/whop-project/products/route.ts',
  'app/api/crashlytics/route.ts',
  'app/api/firebase/auth/route.ts',
  'app/api/firebase/firestore/route.ts',
  'app/api/firebase/remote-config/route.ts',
] as const

describe('server-side project mutation authorization inventory', () => {
  it('keeps every reviewed Admin SDK mutation family behind the shared role guard', () => {
    for (const path of MUTATING_ROUTE_FILES) {
      expect(source(path), path).toContain('getMutableProjectContext')
    }
  })

  it('guards every public custom-page MCP mutation while preserving list access', () => {
    const cpp = source('lib/mcp/tools/custom-product-pages.ts')
    const csl = source('lib/mcp/tools/custom-store-listings.ts')
    const content = source('lib/mcp/tools/custom-page-content.ts')

    expect(cpp.match(/canMutateProject\(projectContext\)/g)).toHaveLength(8)
    expect(csl.match(/canMutateProject\(projectContext\)/g)).toHaveLength(8)
    expect(content.match(/canMutateProject\(projectContext\)/g)).toHaveLength(2)
  })
})
