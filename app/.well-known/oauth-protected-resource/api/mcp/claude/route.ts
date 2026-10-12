import { getWorkOSProtectedResourceMetadata } from '@/lib/auth/workos'

export function GET() {
  const metadata = getWorkOSProtectedResourceMetadata('claude')
  if (!metadata) {
    // No OAuth provider (e.g. a self-hosted install without WorkOS): 404 tells MCP
    // clients there is no OAuth here, so they fall back to bearer API keys.
    return Response.json({ error: 'OAuth is not configured' }, { status: 404 })
  }
  return Response.json(metadata, {
    headers: {
      'Cache-Control': 'public, max-age=300, s-maxage=3600',
      'Access-Control-Allow-Origin': '*',
    },
  })
}

