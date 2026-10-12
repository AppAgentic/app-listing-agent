import { describe, expect, it } from 'vitest'
import { buildApprovalArgumentSummary } from '@/lib/mcp/approval-preview'

describe('agent task approval previews', () => {
  it('shows the exact requested policy mode without echoing unrelated input', () => {
    expect(buildApprovalArgumentSummary('set_agent_policy', {
      mode: 'publish_with_approval',
      privateKey: 'must-not-appear',
    })).toEqual({ requestedMode: 'publish_with_approval' })
  })

  it('shows the bounded custom-page push selectors', () => {
    expect(buildApprovalArgumentSummary('sync_custom_product_pages', {
      direction: 'push',
      pageIds: ['page-1'],
      locales: ['en-US'],
      pushAll: false,
      force: true,
    })).toEqual({
      direction: 'push',
      pageIds: ['page-1'],
      locales: ['en-US'],
      pushAll: false,
      force: true,
    })
  })
})
