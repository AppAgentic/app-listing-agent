import { NextRequest, after } from 'next/server'
import { getProjectContext } from '@/lib/org/context'
import { handleMCPRequest, MCPRequest } from '@/lib/mcp/server'
import { authenticateRequest } from '@/lib/api/auth'
import {
  validateMCPGetRequest,
  validateMCPPostRequest,
} from '@/lib/mcp/http-transport'
import {
  getWorkOSAuthorizationChallenge,
  resolveWorkOSProjectScope,
} from '@/lib/auth/workos'
import {
  checkMCPRateLimit,
  logMCPAuditEvent,
  readBoundedMCPRequest,
  secureMCPResponse,
} from '@/lib/mcp/request-security'

import type { ConnectorProfile } from '@/lib/mcp/connector-profile'

// Extract and validate projectId from query params
async function getProjectIdFromRequest(
  request: NextRequest,
  userId: string,
  enforcedProjectId?: string
): Promise<{ projectId: string | null; error: string | null }> {
  const requestedProjectId = request.nextUrl.searchParams.get('projectId')
  const selection = resolveWorkOSProjectScope(requestedProjectId, enforcedProjectId)
  if (selection.error) return selection
  const projectId = selection.projectId

  if (!projectId) {
    return { projectId: null, error: null }
  }

  // Validate that user has access to this project
  const projectContext = await getProjectContext(userId, projectId)
  if (!projectContext) {
    return { projectId: null, error: 'Invalid projectId or access denied' }
  }

  return { projectId, error: null }
}

// Handle SSE connection for MCP
export async function handleMCPGet(request: NextRequest, connectorProfile?: ConnectorProfile) {
  const ipRateLimit = await checkMCPRateLimit(request)
  if (ipRateLimit.response) {
    logMCPAuditEvent({ outcome: 'rate_limited', method: 'GET' })
    return ipRateLimit.response
  }

  const transportError = validateMCPGetRequest(request)
  if (transportError) return secureMCPResponse(transportError, ipRateLimit)

  const auth = await authenticateRequest(request, connectorProfile)
  if (!auth.authenticated || !auth.context) {
    logMCPAuditEvent({ outcome: 'auth_rejected', method: 'GET' })
    const challenge = getWorkOSAuthorizationChallenge(connectorProfile)
    return secureMCPResponse(new Response(JSON.stringify({ error: 'Invalid API key' }), {
      status: 401,
      headers: {
        'Content-Type': 'application/json',
        ...(challenge ? { 'WWW-Authenticate': challenge } : {}),
      }
    }), ipRateLimit)
  }

  const userRateLimit = await checkMCPRateLimit(request, auth.context.userId)
  if (userRateLimit.response) {
    logMCPAuditEvent({ outcome: 'rate_limited', method: 'GET', userId: auth.context.userId, authMethod: auth.authMethod })
    return userRateLimit.response
  }
  logMCPAuditEvent({ outcome: 'accepted', method: 'GET', userId: auth.context.userId, authMethod: auth.authMethod })

  // Create SSE stream
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

      // Clean up on close
      request.signal.addEventListener('abort', () => {
        clearInterval(keepAlive)
        controller.close()
      })
    }
  })

  return secureMCPResponse(new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    }
  }), userRateLimit)
}

// Handle MCP requests via POST
export async function handleMCPPost(request: NextRequest, connectorProfile?: ConnectorProfile) {
  const ipRateLimit = await checkMCPRateLimit(request)
  if (ipRateLimit.response) {
    logMCPAuditEvent({ outcome: 'rate_limited', method: 'POST' })
    return ipRateLimit.response
  }

  const bounded = await readBoundedMCPRequest(request)
  if (bounded.error) {
    logMCPAuditEvent({ outcome: 'rejected', method: 'POST' })
    return bounded.error
  }
  const mcpRequest = bounded.message as MCPRequest

  // Validate JSON-RPC request
  if (mcpRequest.jsonrpc !== '2.0' || !mcpRequest.method) {
    return secureMCPResponse(new Response(JSON.stringify({
      jsonrpc: '2.0',
      id: mcpRequest.id ?? null,
      error: { code: -32600, message: 'Invalid Request' }
    }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    }), ipRateLimit)
  }

  const transportError = validateMCPPostRequest(request, mcpRequest)
  if (transportError) return secureMCPResponse(transportError, ipRateLimit)

  const auth = await authenticateRequest(request, connectorProfile)
  if (!auth.authenticated || !auth.context) {
    logMCPAuditEvent({ outcome: 'auth_rejected', method: mcpRequest.method })
    const challenge = getWorkOSAuthorizationChallenge(connectorProfile)
    return secureMCPResponse(new Response(JSON.stringify({ error: 'Invalid API key' }), {
      status: 401,
      headers: {
        'Content-Type': 'application/json',
        ...(challenge ? { 'WWW-Authenticate': challenge } : {}),
      }
    }), ipRateLimit)
  }

  const userRateLimit = await checkMCPRateLimit(request, auth.context.userId)
  if (userRateLimit.response) {
    logMCPAuditEvent({
      outcome: 'rate_limited',
      method: mcpRequest.method,
      toolName: typeof mcpRequest.params?.name === 'string' ? mcpRequest.params.name : undefined,
      userId: auth.context.userId,
      authMethod: auth.authMethod,
    })
    return userRateLimit.response
  }

  // Get optional projectId from query params (scopes all tool calls to this project)
  const { projectId: defaultProjectId, error: projectError } = await getProjectIdFromRequest(
    request,
    auth.context.userId,
    auth.oauthProjectId
  )

  if (projectError) {
    logMCPAuditEvent({
      outcome: 'rejected',
      method: mcpRequest.method,
      userId: auth.context.userId,
      authMethod: auth.authMethod,
      projectScoped: Boolean(auth.oauthProjectId),
    })
    return secureMCPResponse(new Response(JSON.stringify({ error: projectError }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' }
    }), userRateLimit)
  }

  if (mcpRequest.method.startsWith('notifications/')) {
    await handleMCPRequest(mcpRequest, auth.context, defaultProjectId, {
      connectorProfile,
      apiKeyScopes: auth.apiKeyScopes,
      projectScopeLocked: Boolean(auth.oauthProjectId),
    })
    return secureMCPResponse(new Response(null, { status: 202 }), userRateLimit)
  }

  // Handle the MCP request with optional default projectId
  const { response, deferredWork } = await handleMCPRequest(mcpRequest, auth.context, defaultProjectId, {
    connectorProfile,
    apiKeyScopes: auth.apiKeyScopes,
    projectScopeLocked: Boolean(auth.oauthProjectId),
  })
  logMCPAuditEvent({
    outcome: response.error ? 'rejected' : 'accepted',
    method: mcpRequest.method,
    toolName: typeof mcpRequest.params?.name === 'string' ? mcpRequest.params.name : undefined,
    userId: auth.context.userId,
    authMethod: auth.authMethod,
    projectScoped: Boolean(defaultProjectId),
  })

  // Schedule background work (e.g. async screenshot generation) to run after response is sent
  if (deferredWork) {
    after(deferredWork)
  }

  return secureMCPResponse(new Response(JSON.stringify(response), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  }), userRateLimit)
}
