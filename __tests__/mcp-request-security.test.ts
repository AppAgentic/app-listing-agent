import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { NextRequest } from 'next/server'
import {
  MAX_MCP_REQUEST_BYTES,
  buildMCPAuditEvent,
  checkMCPRateLimit,
  readBoundedMCPRequest,
  secureMCPResponse,
} from '@/lib/mcp/request-security'

function request(body: string, headers: Record<string, string> = {}) {
  return new Request('https://applistingagent.com/api/mcp', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': '203.0.113.90',
      ...headers,
    },
    body,
  })
}

describe('MCP request security', () => {
  it('parses a bounded JSON-RPC request', async () => {
    const result = await readBoundedMCPRequest(request(JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
    })))
    expect(result.error).toBeUndefined()
    expect(result.message?.method).toBe('tools/list')
  })

  it('rejects declared and actual bodies above one MiB', async () => {
    const declared = await readBoundedMCPRequest(request('{}', {
      'content-length': String(MAX_MCP_REQUEST_BYTES + 1),
    }))
    expect(declared.error?.status).toBe(413)

    const actual = await readBoundedMCPRequest(request(JSON.stringify({
      value: 'x'.repeat(MAX_MCP_REQUEST_BYTES),
    })))
    expect(actual.error?.status).toBe(413)
  })

  it('rejects pathologically deep JSON structures', async () => {
    let value: Record<string, unknown> = {}
    for (let index = 0; index < 30; index += 1) value = { child: value }
    const result = await readBoundedMCPRequest(request(JSON.stringify(value)))
    expect(result.error?.status).toBe(413)
  })

  it('uses separate per-IP and per-user MCP buckets', async () => {
    const incoming = request('{}', { 'x-forwarded-for': '203.0.113.91' })
    const ip = await checkMCPRateLimit(incoming as NextRequest)
    const user = await checkMCPRateLimit(incoming as NextRequest, 'mcp-security-user')
    expect(ip.allowed).toBe(true)
    expect(user.allowed).toBe(true)
    expect(ip.remaining).toBe(user.remaining)
  })

  it('adds no-store and browser hardening headers', () => {
    const secured = secureMCPResponse(Response.json({ ok: true }))
    expect(secured.headers.get('cache-control')).toBe('no-store')
    expect(secured.headers.get('x-content-type-options')).toBe('nosniff')
    expect(secured.headers.get('referrer-policy')).toBe('no-referrer')
  })

  it('logs only a bounded pseudonymous subject, never the raw user ID', () => {
    const event = buildMCPAuditEvent({
      outcome: 'accepted',
      method: 'tools/call',
      toolName: 'read_metadata',
      userId: 'private-firebase-user-id',
      authMethod: 'workos',
      projectScoped: true,
    })
    expect(event.subject).toHaveLength(20)
    expect(JSON.stringify(event)).not.toContain('private-firebase-user-id')
  })

  it('declares Firestore TTL deletion for durable agent tasks', () => {
    const indexes = JSON.parse(readFileSync('firestore.indexes.json', 'utf8'))
    expect(indexes.fieldOverrides).toContainEqual({
      collectionGroup: 'agentTasks',
      fieldPath: 'expiresAt',
      ttl: true,
      indexes: [],
    })
  })

  it('declares Firestore TTL deletion for global rate-limit buckets', () => {
    const indexes = JSON.parse(readFileSync('firestore.indexes.json', 'utf8'))
    expect(indexes.fieldOverrides).toContainEqual({
      collectionGroup: '_rateLimits',
      fieldPath: 'expiresAt',
      ttl: true,
      indexes: [],
    })
  })
})
