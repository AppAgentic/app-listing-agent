import { readBoundedText, RequestBodyLimitError } from '@/lib/api/bounded-body'
import type { NextRequest } from 'next/server'
import type { MCPRequest } from '@/lib/mcp/server'
import type { RateLimitResult } from '@/lib/api/rate-limit'
import { createHash } from 'node:crypto'
import {
  addRateLimitHeaders,
  rateLimitResponse,
  withRateLimit,
} from '@/lib/api/rate-limit'

export const MAX_MCP_REQUEST_BYTES = 1024 * 1024
export const MCP_RATE_LIMIT = { windowMs: 60_000, maxRequests: 120 } as const

export interface MCPAuditInput {
  outcome: 'accepted' | 'rejected' | 'rate_limited' | 'auth_rejected'
  method?: string
  toolName?: string
  userId?: string
  authMethod?: string
  projectScoped?: boolean
}

export function buildMCPAuditEvent(input: MCPAuditInput) {
  return {
    event: 'mcp_security',
    outcome: input.outcome,
    ...(input.method ? { method: input.method.slice(0, 80) } : {}),
    ...(input.toolName ? { toolName: input.toolName.slice(0, 120) } : {}),
    ...(input.userId
      ? { subject: createHash('sha256').update(input.userId).digest('hex').slice(0, 20) }
      : {}),
    ...(input.authMethod ? { authMethod: input.authMethod } : {}),
    ...(input.projectScoped !== undefined ? { projectScoped: input.projectScoped } : {}),
  }
}

export function logMCPAuditEvent(input: MCPAuditInput): void {
  console.info(JSON.stringify(buildMCPAuditEvent(input)))
}

const MAX_JSON_DEPTH = 24
const MAX_JSON_NODES = 20_000
const MAX_STRING_LENGTH = 300_000

function jsonRpcError(status: number, code: number, message: string): Response {
  return secureMCPResponse(Response.json({
    jsonrpc: '2.0',
    id: null,
    error: { code, message },
  }, { status }))
}

function withinStructuralLimits(value: unknown): boolean {
  let nodes = 0
  const stack: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }]

  while (stack.length > 0) {
    const entry = stack.pop()!
    nodes += 1
    if (nodes > MAX_JSON_NODES || entry.depth > MAX_JSON_DEPTH) return false
    if (typeof entry.value === 'string' && entry.value.length > MAX_STRING_LENGTH) return false
    if (!entry.value || typeof entry.value !== 'object') continue
    const children = Array.isArray(entry.value)
      ? entry.value
      : Object.values(entry.value as Record<string, unknown>)
    for (const child of children) stack.push({ value: child, depth: entry.depth + 1 })
  }

  return true
}

export async function readBoundedMCPRequest(
  request: Request
): Promise<{ message?: MCPRequest; error?: Response }> {
  const declaredLength = Number(request.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > MAX_MCP_REQUEST_BYTES) {
    return { error: jsonRpcError(413, -32600, 'MCP request body is too large') }
  }

  let raw: string
  try {
    raw = await readBoundedText(request, MAX_MCP_REQUEST_BYTES)
  } catch (error) {
    return { error: error instanceof RequestBodyLimitError
      ? jsonRpcError(413, -32600, 'MCP request body is too large')
      : jsonRpcError(400, -32700, 'Parse error') }
  }

  let message: unknown
  try {
    message = JSON.parse(raw)
  } catch {
    return { error: jsonRpcError(400, -32700, 'Parse error') }
  }

  if (!withinStructuralLimits(message)) {
    return { error: jsonRpcError(413, -32600, 'MCP request structure exceeds safe limits') }
  }

  return { message: message as MCPRequest }
}

export async function checkMCPRateLimit(
  request: NextRequest,
  userId?: string
): Promise<RateLimitResult & { response?: Response }> {
  const result = await withRateLimit(
    request,
    MCP_RATE_LIMIT,
    userId ? { userId } : undefined,
    'mcp'
  )
  return result.response
    ? { ...result, response: secureMCPResponse(rateLimitResponse(result)) }
    : result
}

export function secureMCPResponse(
  response: Response,
  rateLimit?: RateLimitResult
): Response {
  const headers = new Headers(response.headers)
  headers.set('Cache-Control', 'no-store')
  headers.set('X-Content-Type-Options', 'nosniff')
  headers.set('Referrer-Policy', 'no-referrer')
  const secured = new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
  return rateLimit ? addRateLimitHeaders(secured, rateLimit) : secured
}
