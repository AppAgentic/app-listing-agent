import { TOOL_DEFINITIONS, decoratePublicToolDefinition } from '@/lib/mcp/server'
import {
  PUBLIC_CAPABILITIES,
  PUBLIC_LAUNCH_TOOL_NAMES,
} from '@/lib/mcp/public-capabilities'
import { getWorkOSConfig } from '@/lib/auth/workos'
import { appOrigin, appUrl } from '@/lib/routing/app-url'

const PUBLIC_TOOL_DEFINITIONS = new Map(
  TOOL_DEFINITIONS
    .filter(tool => PUBLIC_LAUNCH_TOOL_NAMES.has(tool.name))
    .map(tool => [tool.name, tool])
)

export function getPublicCapabilityManifest() {
  const oauthEnabled = Boolean(getWorkOSConfig())
  return {
    schemaVersion: '1.0',
    id: 'applistingagent',
    name: 'App Listing Agent',
    description: 'Agent-native App Store Connect and Google Play launch operations.',
    homepage: appOrigin(),
    documentation: appUrl('/agents'),
    endpoints: {
      mcp: appUrl('/api/mcp'),
      capabilities: appUrl('/.well-known/applistingagent-capabilities'),
      health: appUrl('/api/health'),
    },
    authentication: {
      methods: oauthEnabled
        ? ['oauth_2_1', 'api_key', 'firebase_id_token']
        : ['api_key', 'firebase_id_token'],
      pairing: appUrl('/onboarding'),
      oauth: oauthEnabled,
    },
    safety: {
      publishRequiresApproval: true,
      credentialsAcceptedInChat: false,
      projectScopedAuthority: true,
      internalToolsExcluded: true,
      untrustedContentIsData: true,
    },
    capabilities: PUBLIC_CAPABILITIES.map(policy => {
      const rawTool = PUBLIC_TOOL_DEFINITIONS.get(policy.name)
      if (!rawTool) {
        throw new Error(`Public capability is missing an MCP tool definition: ${policy.name}`)
      }
      const tool = decoratePublicToolDefinition(rawTool)

      return {
        ...policy,
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: tool.annotations,
        securitySchemes: tool.securitySchemes,
      }
    }),
  }
}
