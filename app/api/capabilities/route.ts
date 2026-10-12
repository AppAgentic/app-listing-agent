import { getPublicCapabilityManifest } from '@/lib/mcp/capability-manifest'

// OAuth configuration is supplied as an App Hosting runtime secret, so this
// manifest must not be frozen during the build phase.
export const dynamic = 'force-dynamic'

export function GET() {
  return Response.json(getPublicCapabilityManifest(), {
    headers: {
      'Cache-Control': 'public, max-age=300, s-maxage=3600',
      'Access-Control-Allow-Origin': '*',
    },
  })
}
