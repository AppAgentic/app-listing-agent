import { NextRequest } from 'next/server'
import { verifyAdminApiKey } from '@/lib/mcp/admin-auth'
import {
  handleAdminMCPRequest,
  AdminMCPRequest,
  AdminMCPResponse,
  ADMIN_TOOL_DEFINITIONS,
} from '@/lib/mcp/admin-server'

// Allow up to 5 minutes for long-running admin operations
export const maxDuration = 300

function unauthorizedResponse(message = 'Invalid or missing admin API key') {
  return new Response(JSON.stringify({ error: message }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  })
}

function extractAdminKey(request: NextRequest): string | null {
  // Check X-Admin-Key header first (preferred for admin)
  const adminKeyHeader = request.headers.get('x-admin-key')
  if (adminKeyHeader) return adminKeyHeader

  // Fall back to Authorization: Bearer
  const authHeader = request.headers.get('authorization')
  return authHeader?.replace('Bearer ', '') || null
}

// Handle SSE connection for admin MCP
export async function GET(request: NextRequest) {
  const apiKey = extractAdminKey(request)
  if (!apiKey || !verifyAdminApiKey(apiKey)) {
    return unauthorizedResponse()
  }

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    start(controller) {
      // Keep connection alive
      const keepAlive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': keepalive\n\n'))
        } catch {
          clearInterval(keepAlive)
        }
      }, 30000)

      request.signal.addEventListener('abort', () => {
        clearInterval(keepAlive)
        controller.close()
      })
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}

// Handle admin MCP requests via POST
export async function POST(request: NextRequest) {
  const apiKey = extractAdminKey(request)
  if (!apiKey || !verifyAdminApiKey(apiKey)) {
    return unauthorizedResponse()
  }

  // Parse request body
  let mcpRequest: AdminMCPRequest
  try {
    mcpRequest = await request.json()
  } catch {
    return new Response(
      JSON.stringify({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32700, message: 'Parse error' },
      }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    )
  }

  // Validate JSON-RPC request
  if (mcpRequest.jsonrpc !== '2.0' || !mcpRequest.method) {
    return new Response(
      JSON.stringify({
        jsonrpc: '2.0',
        id: mcpRequest.id ?? null,
        error: { code: -32600, message: 'Invalid Request' },
      }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    )
  }

  if (mcpRequest.method.startsWith('notifications/')) {
    await handleAdminMCPRequest(mcpRequest)
    return new Response(null, { status: 202 })
  }

  const response = await handleAdminMCPRequest(mcpRequest)

  return new Response(JSON.stringify(response), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}
