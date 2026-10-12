import { describe, expect, it } from 'vitest'
import type { AccountContext } from '@/lib/org/context'
import { canAgentPolicyInvoke, canAgentPolicyListTool } from '@/lib/mcp/agent-policy'

function context(mode?: 'read_only' | 'draft_with_approval' | 'publish_with_approval'): AccountContext {
  return {
    type: 'personal',
    userId: 'user-1',
    user: {
      email: 'user@example.com',
      plan: 'pro',
      planLimits: {} as never,
      organizationId: null,
      apiKey: 'redacted',
      createdAt: {} as never,
      updatedAt: {} as never,
      ...(mode ? { agentOnboarding: { policy: { mode } } } : {}),
    } as AccountContext['user'],
  }
}

describe('MCP agent operating policy enforcement', () => {
  it('keeps legacy accounts unchanged when no policy is set', () => {
    expect(canAgentPolicyInvoke(context(), 'update_metadata', {})).toBe(true)
    expect(canAgentPolicyInvoke(context(), 'upload_appstore_metadata', {})).toBe(true)
  })

  it('limits read-only mode to read-only tools while preserving human policy changes', () => {
    const readOnly = context('read_only')
    expect(canAgentPolicyListTool(readOnly, 'read_metadata')).toBe(true)
    expect(canAgentPolicyInvoke(readOnly, 'read_metadata', {})).toBe(true)
    expect(canAgentPolicyListTool(readOnly, 'update_metadata')).toBe(false)
    expect(canAgentPolicyInvoke(readOnly, 'update_metadata', {})).toBe(false)
    expect(canAgentPolicyInvoke(readOnly, 'internal_unknown_tool', {})).toBe(false)
    expect(canAgentPolicyInvoke(readOnly, 'set_agent_policy', { mode: 'draft_with_approval' })).toBe(true)
  })

  it('allows drafts but blocks live publish in draft mode', () => {
    const draft = context('draft_with_approval')
    expect(canAgentPolicyListTool(draft, 'upload_appstore_metadata')).toBe(true)
    expect(canAgentPolicyListTool(draft, 'sync_custom_product_pages')).toBe(true)
    expect(canAgentPolicyInvoke(draft, 'update_metadata', {})).toBe(true)
    expect(canAgentPolicyInvoke(draft, 'update_legal_document', {})).toBe(false)
    expect(canAgentPolicyInvoke(draft, 'update_legal_document', { dryRun: true })).toBe(false)
    expect(canAgentPolicyInvoke(draft, 'upload_appstore_metadata', { dryRun: true })).toBe(true)
    expect(canAgentPolicyInvoke(draft, 'upload_appstore_metadata', { dryRun: false })).toBe(false)
    expect(canAgentPolicyInvoke(draft, 'sync_custom_product_pages', { direction: 'push' })).toBe(false)
    expect(canAgentPolicyInvoke(draft, 'sync_custom_product_pages', { direction: 'pull' })).toBe(true)
  })

  it('allows publish mode while dispatch still owns durable approval', () => {
    expect(canAgentPolicyInvoke(
      context('publish_with_approval'),
      'sync_custom_store_listings',
      { direction: 'push', confirmed: true },
    )).toBe(true)
  })
})
