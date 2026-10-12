import type { NextRequest } from 'next/server'
import type { MCPRequest } from '@/lib/mcp/server'
import { appOrigin } from '@/lib/routing/app-url'

export const MCP_PROTOCOL_VERSIONS = [
  '2025-11-25',
  '2025-06-18',
  '2025-03-26',
  '2024-11-05',
] as const

export type MCPProtocolVersion = (typeof MCP_PROTOCOL_VERSIONS)[number]
export const LATEST_STABLE_MCP_PROTOCOL_VERSION: MCPProtocolVersion = '2025-11-25'

const SUPPORTED_PROTOCOL_VERSIONS = new Set<string>(MCP_PROTOCOL_VERSIONS)
const DEFAULT_ALLOWED_ORIGINS = new Set([
  'https://applistingagent.com',
  'https://www.applistingagent.com',
])

function jsonRpcTransportError(status: number, message: string): Response {
  return Response.json({
    jsonrpc: '2.0',
    id: null,
    error: { code: -32600, message },
  }, { status })
}

function configuredAllowedOrigins(): Set<string> {
  const origins = new Set(DEFAULT_ALLOWED_ORIGINS)
  // This deployment's own origin (NEXT_PUBLIC_APP_URL; the hosted origin when unset).
  origins.add(appOrigin())
  for (const value of (process.env.MCP_ALLOWED_ORIGINS ?? '').split(',')) {
    const origin = value.trim()
    if (origin) origins.add(origin)
  }
  if (process.env.NODE_ENV !== 'production') {
    origins.add('http://localhost:3100')
    origins.add('http://localhost:3105')
    origins.add('http://localhost:3108')
    origins.add('http://127.0.0.1:3100')
    origins.add('http://127.0.0.1:3105')
    origins.add('http://127.0.0.1:3108')
  }
  return origins
}

export function isAllowedMCPOrigin(origin: string | null): boolean {
  if (!origin) return true
  try {
    return configuredAllowedOrigins().has(new URL(origin).origin)
  } catch {
    return false
  }
}

export function negotiateMCPProtocolVersion(requested?: unknown): MCPProtocolVersion {
  if (typeof requested === 'string' && SUPPORTED_PROTOCOL_VERSIONS.has(requested)) {
    return requested as MCPProtocolVersion
  }
  return LATEST_STABLE_MCP_PROTOCOL_VERSION
}

function isModernProtocol(version?: string | null): boolean {
  return !!version && version !== '2024-11-05'
}

export function validateMCPGetRequest(request: NextRequest): Response | null {
  if (!isAllowedMCPOrigin(request.headers.get('origin'))) {
    return jsonRpcTransportError(403, 'Forbidden origin')
  }

  const accept = request.headers.get('accept')?.toLowerCase() ?? ''
  if (!accept.includes('text/event-stream') && !accept.includes('*/*')) {
    return new Response(null, { status: 405, headers: { Allow: 'POST, GET' } })
  }

  const protocolVersion = request.headers.get('mcp-protocol-version')
  if (protocolVersion && !SUPPORTED_PROTOCOL_VERSIONS.has(protocolVersion)) {
    return jsonRpcTransportError(400, `Unsupported MCP protocol version: ${protocolVersion}`)
  }

  return null
}

export function validateMCPPostRequest(
  request: NextRequest,
  message: MCPRequest
): Response | null {
  if (!isAllowedMCPOrigin(request.headers.get('origin'))) {
    return jsonRpcTransportError(403, 'Forbidden origin')
  }

  const contentType = request.headers.get('content-type')?.toLowerCase() ?? ''
  if (!contentType.includes('application/json')) {
    return jsonRpcTransportError(415, 'Content-Type must be application/json')
  }

  const headerVersion = request.headers.get('mcp-protocol-version')
  if (headerVersion && !SUPPORTED_PROTOCOL_VERSIONS.has(headerVersion)) {
    return jsonRpcTransportError(400, `Unsupported MCP protocol version: ${headerVersion}`)
  }

  const requestedVersion = message.method === 'initialize'
    ? message.params?.protocolVersion
    : headerVersion
  const accept = request.headers.get('accept')?.toLowerCase() ?? ''
  if (
    isModernProtocol(typeof requestedVersion === 'string' ? requestedVersion : null) &&
    !accept.includes('*/*') &&
    !(accept.includes('application/json') && accept.includes('text/event-stream'))
  ) {
    return jsonRpcTransportError(
      406,
      'Modern MCP clients must accept both application/json and text/event-stream'
    )
  }

  const methodHeader = request.headers.get('mcp-method')
  if (methodHeader && methodHeader !== message.method) {
    return jsonRpcTransportError(400, 'Mcp-Method header does not match the JSON-RPC method')
  }

  const bodyName = typeof message.params?.name === 'string'
    ? message.params.name
    : typeof message.params?.uri === 'string'
      ? message.params.uri
      : null
  const nameHeader = request.headers.get('mcp-name')
  if (nameHeader && nameHeader !== bodyName) {
    return jsonRpcTransportError(400, 'Mcp-Name header does not match the JSON-RPC target')
  }

  return null
}

