import { getWorkOSConfig } from '@/lib/auth/workos'
import { appUrl } from '@/lib/routing/app-url'

export async function GET() {
  const config = getWorkOSConfig()
  if (!config) {
    // No OAuth provider (e.g. a self-hosted install without WorkOS): 404 tells MCP
    // clients there is no OAuth here, so they fall back to bearer API keys.
    return Response.json({ error: 'OAuth is not configured' }, { status: 404 })
  }

  const oauthResponse = await fetch(new URL('/.well-known/oauth-authorization-server', config.issuer), {
    cache: 'no-store',
  })
  if (!oauthResponse.ok) {
    return Response.json({ error: 'Authorization metadata unavailable' }, { status: 502 })
  }

  const oauthMetadata = await oauthResponse.json() as Record<string, unknown>

  // Keep WorkOS as the canonical issuer and registration/token provider, but
  // serve UserInfo from the resource server. Standalone Connect access tokens
  // are resource-bound and WorkOS's OIDC UserInfo endpoint does not accept
  // them, while App Listing Agent can validate the same signed token and resolve
  // the verified Firebase identity that was handed to WorkOS.
  const metadata = {
    ...oauthMetadata,
    userinfo_endpoint: appUrl('/oauth/userinfo'),
  }

  return Response.json(metadata, {
    headers: {
      'Cache-Control': 'public, max-age=300, s-maxage=3600',
      'Access-Control-Allow-Origin': '*',
    },
  })
}
