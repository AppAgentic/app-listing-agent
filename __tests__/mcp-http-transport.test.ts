import { describe, expect, it } from 'vitest'
import { NextRequest } from 'next/server'
import type { AccountContext } from '@/lib/org/context'
import { handleMCPRequest } from '@/lib/mcp/server'
import {
  isAllowedMCPOrigin,
  negotiateMCPProtocolVersion,
  validateMCPGetRequest,
  validateMCPPostRequest,
} from '@/lib/mcp/http-transport'

const MODERN_ACCEPT = 'application/json, text/event-stream'

function postRequest(headers: Record<string, string> = {}) {
  return new NextRequest('https://applistingagent.com/api/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: '{}',
  })
}

function context(): AccountContext {
  return {
    type: 'personal',
    userId: 'transport-test-user',
    user: {
      email: 'transport@example.com',
      plan: 'starter',
      planLimits: {
        translations: 0,
        screenshots: 0,
        icons: 0,
        publishing: 0,
        apps: 0,
        teamMembers: 0,
      },
      organizationId: null,
      apiKey: 'test-key',
      createdAt: {} as never,
      updatedAt: {} as never,
    },
  }
}

describe('MCP Streamable HTTP transport', () => {
  it('negotiates current stable and supported legacy protocol versions', () => {
    expect(negotiateMCPProtocolVersion('2025-11-25')).toBe('2025-11-25')
    expect(negotiateMCPProtocolVersion('2025-03-26')).toBe('2025-03-26')
    expect(negotiateMCPProtocolVersion('2024-11-05')).toBe('2024-11-05')
    expect(negotiateMCPProtocolVersion('2099-01-01')).toBe('2025-11-25')
  })

  it('returns the negotiated version from initialize', async () => {
    const { response } = await handleMCPRequest({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-11-25' },
    }, context())

    expect(response.result).toMatchObject({
      protocolVersion: '2025-11-25',
      capabilities: {
        tasks: {
          list: {},
          cancel: {},
          requests: { tools: { call: {} } },
        },
      },
      serverInfo: { name: 'applistingagent', version: '1.1.0' },
    })
  })

  it('does not advertise experimental tasks to legacy protocol clients', async () => {
    const { response } = await handleMCPRequest({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2024-11-05' },
    }, context())

    expect((response.result as { capabilities: Record<string, unknown> }).capabilities.tasks).toBeUndefined()
  })

  it('rejects cross-origin browser traffic before authentication', async () => {
    expect(isAllowedMCPOrigin('https://applistingagent.com')).toBe(true)
    expect(isAllowedMCPOrigin(null)).toBe(true)
    expect(isAllowedMCPOrigin('https://attacker.example')).toBe(false)

    const response = validateMCPPostRequest(
      postRequest({ origin: 'https://attacker.example', accept: MODERN_ACCEPT }),
      { jsonrpc: '2.0', id: 1, method: 'tools/list' }
    )
    expect(response?.status).toBe(403)
  })

  it('requires modern clients to accept JSON and SSE', () => {
    const response = validateMCPPostRequest(
      postRequest({ accept: 'application/json' }),
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2025-11-25' },
      }
    )
    expect(response?.status).toBe(406)

    const accepted = validateMCPPostRequest(
      postRequest({ accept: MODERN_ACCEPT }),
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2025-11-25' },
      }
    )
    expect(accepted).toBeNull()
  })

  it('keeps the 2024 pairing-code clients compatible', () => {
    const response = validateMCPPostRequest(postRequest(), {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2024-11-05' },
    })
    expect(response).toBeNull()
  })

  it('rejects unsupported versions and routing header/body disagreement', () => {
    expect(validateMCPPostRequest(
      postRequest({ 'mcp-protocol-version': '2099-01-01' }),
      { jsonrpc: '2.0', id: 1, method: 'tools/list' }
    )?.status).toBe(400)

    expect(validateMCPPostRequest(
      postRequest({ 'mcp-method': 'resources/list' }),
      { jsonrpc: '2.0', id: 1, method: 'tools/list' }
    )?.status).toBe(400)

    expect(validateMCPPostRequest(
      postRequest({ 'mcp-method': 'tools/call', 'mcp-name': 'read_metadata' }),
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'upload_appstore_metadata' },
      }
    )?.status).toBe(400)
  })

  it('only opens GET streams for SSE-capable clients', () => {
    const rejected = validateMCPGetRequest(new NextRequest(
      'https://applistingagent.com/api/mcp',
      { headers: { accept: 'application/json' } }
    ))
    expect(rejected?.status).toBe(405)

    const accepted = validateMCPGetRequest(new NextRequest(
      'https://applistingagent.com/api/mcp',
      { headers: { accept: 'text/event-stream' } }
    ))
    expect(accepted).toBeNull()
  })
})
