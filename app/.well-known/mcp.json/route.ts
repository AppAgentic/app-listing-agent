import { getWorkOSConfig } from '@/lib/auth/workos'
import { appOrigin, appUrl } from '@/lib/routing/app-url'

// URLs follow this deployment's NEXT_PUBLIC_APP_URL and OAuth is advertised only
// when WorkOS is configured, so both are read per request, not frozen at build.
export const dynamic = 'force-dynamic'

export function GET() {
  const authentication = getWorkOSConfig()
    ? {
        type: 'oauth2',
        protectedResourceMetadata: appUrl('/.well-known/oauth-protected-resource/api/mcp'),
        instructions: 'Connect through App Listing Agent onboarding or the OAuth flow. Never paste store credentials or pairing codes into an AI conversation.',
      }
    : {
        type: 'bearer',
        instructions: 'Connect through App Listing Agent onboarding (pairing) or a scoped API key sent as Authorization: Bearer. Never paste store credentials or pairing codes into an AI conversation.',
      }

  return Response.json({
    name: 'App Listing Agent',
    description: 'Project-scoped App Store Connect and Google Play operations for AI agents, with secure credentials and human-approved publishing.',
    transport: {
      type: 'streamable-http',
      url: appUrl('/api/mcp'),
    },
    authentication,
    website: appOrigin(),
    documentation: appUrl('/agents'),
    capabilities: appUrl('/.well-known/applistingagent-capabilities'),
    registry: 'com.applistingagent/applistingagent',
  }, {
    headers: {
      'Cache-Control': 'public, max-age=3600, s-maxage=86400',
      'Access-Control-Allow-Origin': '*',
    },
  })
}
