import { NextRequest } from 'next/server'
import { isNotModified, markdownEtag, renderAllDocsMarkdown, revalidatingTextHeaders, selfOrigins } from '@/lib/docs/agent-markdown'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  let body
  try {
    body = await renderAllDocsMarkdown(selfOrigins(request.nextUrl.origin))
  } catch (error) {
    console.error('llms_full_render_failed', { error: error instanceof Error ? error.message : String(error) })
    return new Response('Temporarily unavailable\n', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Retry-After': '30', 'Cache-Control': 'no-store' },
    })
  }
  const etag = markdownEtag(body)
  const headers = revalidatingTextHeaders('text/plain; charset=utf-8', etag)
  if (isNotModified(request.headers.get('if-none-match'), etag)) return new Response(null, { status: 304, headers })
  return new Response(body, { headers })
}
