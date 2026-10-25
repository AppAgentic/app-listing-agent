import { NextRequest } from 'next/server'
import { isNotModified, renderDocsMarkdown, revalidatingTextHeaders, selfOrigins } from '@/lib/docs/agent-markdown'
import { isPublicDocsPath } from '@/lib/docs/public-pages'
import { SITE_URL } from '@/lib/seo/site'

// Markdown twin of each public docs page. Reached through the proxy: `/docs/<page>.md`, or
// `/docs/<page>` with `Accept: text/markdown`.

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest, { params }: { params: Promise<{ slug?: string[] }> }) {
  const { slug = [] } = await params
  const path = ['/docs', ...slug].join('/')
  if (!isPublicDocsPath(path)) {
    return new Response('Not Found\n', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
  }

  let rendered
  try {
    rendered = await renderDocsMarkdown(path, selfOrigins(request.nextUrl.origin))
  } catch (error) {
    console.error('docs_markdown_render_failed', { path, error: error instanceof Error ? error.message : String(error) })
    return new Response('Markdown version temporarily unavailable\n', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Retry-After': '30', 'Cache-Control': 'no-store' },
    })
  }

  const headers = {
    ...revalidatingTextHeaders('text/markdown; charset=utf-8', rendered.etag),
    Link: `<${SITE_URL}${path}>; rel="canonical"`,
  }
  if (isNotModified(request.headers.get('if-none-match'), rendered.etag)) {
    return new Response(null, { status: 304, headers })
  }
  return new Response(rendered.markdown, { headers })
}
