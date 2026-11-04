import { appOrigin } from '@/lib/routing/app-url'

// Glama connector ownership (https://glama.ai/mcp/schemas/connector.json). Claims the
// com.applistingagent connector and, through the appstorecopilot.com 308, the legacy
// com.appstorecopilot one. Emails must match the Glama account that claims them; if
// Glama issues a `glama_claim_…` token instead, add it as `claim` and keep it published.
// Only our hosted domain claims these listings, never a self-hosted copy.
export const dynamic = 'force-dynamic'

const HOSTED_ORIGIN = 'https://applistingagent.com'

export function GET() {
  if (appOrigin() !== HOSTED_ORIGIN) {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }
  return Response.json({
    $schema: 'https://glama.ai/mcp/schemas/connector.json',
    maintainers: [
      { email: 'hello@applistingagent.com' },
      { email: 'joe@appagentic.dev' },
    ],
  })
}
