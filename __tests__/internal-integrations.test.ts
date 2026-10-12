import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AccountContext } from '@/lib/org/context'
import {
  hasInternalIntegrationAccess,
  INTERNAL_INTEGRATION_TOOL_NAMES,
  PUBLIC_LAUNCH_TOOL_NAMES,
  isInternalCompanyEmail,
  isInternalIntegrationIdentity,
  isInternalIntegrationTool,
  isInternalOnlyPath,
  isPublicLaunchTool,
  canApiKeyAccessTool,
  canApiKeyAccessApiPath,
  stripInternalProjectFields,
} from '@/lib/features/internal-integrations'
import { toPublicToolName } from '@/lib/mcp/public-tool-names'
import { handleMCPRequest } from '@/lib/mcp/server'

function makeContext(userId: string, email = 'user@example.com'): AccountContext {
  return {
    type: 'personal',
    userId,
    user: {
      email,
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

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('internal integration access', () => {
  it('fails closed when no allowlist is configured', () => {
    expect(isInternalIntegrationIdentity({
      userId: 'internal-looking-user',
      orgId: 'internal-looking-org',
      email: 'owner@internal-company.test',
    })).toBe(false)
  })

  it('allows exact configured user and organization IDs', () => {
    vi.stubEnv('INTERNAL_INTEGRATION_ALLOWED_USER_IDS', ' user-one,USER-TWO ')
    vi.stubEnv('INTERNAL_INTEGRATION_ALLOWED_ORG_IDS', 'org-one')

    expect(isInternalIntegrationIdentity({ userId: 'user-one' })).toBe(true)
    expect(isInternalIntegrationIdentity({ userId: 'user-two' })).toBe(true)
    expect(isInternalIntegrationIdentity({ orgId: 'ORG-ONE' })).toBe(true)
    expect(isInternalIntegrationIdentity({ userId: 'user' })).toBe(false)
  })

  it('only allows email addresses and domains when explicitly configured', () => {
    vi.stubEnv('INTERNAL_INTEGRATION_ALLOWED_EMAILS', 'owner@example.com')
    vi.stubEnv('INTERNAL_INTEGRATION_ALLOWED_DOMAINS', 'company.test')

    expect(isInternalCompanyEmail('OWNER@example.com')).toBe(true)
    expect(isInternalCompanyEmail('member@company.test')).toBe(true)
    expect(isInternalCompanyEmail('member@sub.company.test')).toBe(false)
    expect(isInternalCompanyEmail('owner@example.com.attacker.test')).toBe(false)
  })

  it('uses the stable account principal for MCP contexts', () => {
    vi.stubEnv('INTERNAL_INTEGRATION_ALLOWED_USER_IDS', 'allowed-user')

    expect(hasInternalIntegrationAccess(makeContext('allowed-user'))).toBe(true)
    expect(hasInternalIntegrationAccess(makeContext('other-user'))).toBe(false)
  })

  it('does not grant an organization member access through another allowlisted user', () => {
    vi.stubEnv('INTERNAL_INTEGRATION_ALLOWED_USER_IDS', 'company-owner')

    expect(isInternalIntegrationIdentity({
      userId: 'public-team-member',
      orgId: 'shared-organization',
    })).toBe(false)
  })
})

describe('internal MCP tools', () => {
  it('keeps the provider-specific internal tool classification intact', () => {
    expect(INTERNAL_INTEGRATION_TOOL_NAMES).toHaveLength(51)
    expect(new Set(INTERNAL_INTEGRATION_TOOL_NAMES).size).toBe(51)
    for (const toolName of INTERNAL_INTEGRATION_TOOL_NAMES) {
      expect(isInternalIntegrationTool(toolName)).toBe(true)
    }
    expect(isInternalIntegrationTool('list_iap_products')).toBe(false)
  })

  it('defines a focused, fail-closed 55-tool public launch surface', () => {
    expect(PUBLIC_LAUNCH_TOOL_NAMES.size).toBe(55)
    expect(isPublicLaunchTool('get_onboarding_status')).toBe(true)
    expect(isPublicLaunchTool('create_onboarding_project')).toBe(true)
    expect(isPublicLaunchTool('attach_onboarding_store_record')).toBe(true)
    expect(isPublicLaunchTool('complete_onboarding')).toBe(true)
    expect(isPublicLaunchTool('translate_metadata')).toBe(true)
    expect(isPublicLaunchTool('generate_screenshot')).toBe(true)
    expect(isPublicLaunchTool('create_custom_product_page')).toBe(true)
    expect(isPublicLaunchTool('list_iap_products')).toBe(false)
    expect(isPublicLaunchTool('firebase_set_document')).toBe(false)
    expect(isPublicLaunchTool('some_future_tool')).toBe(false)
  })

  it('maps public tools onto enforceable API-key scopes', () => {
    expect(canApiKeyAccessTool(['read'], 'read_metadata')).toBe(true)
    expect(canApiKeyAccessTool(['read'], 'get_onboarding_status')).toBe(true)
    expect(canApiKeyAccessTool(['read'], 'run_store_readiness_audit')).toBe(false)
    expect(canApiKeyAccessTool(['write'], 'run_store_readiness_audit')).toBe(true)
    expect(canApiKeyAccessTool(['read'], 'attach_onboarding_store_record')).toBe(false)
    expect(canApiKeyAccessTool(['write'], 'attach_onboarding_store_record')).toBe(true)
    expect(canApiKeyAccessTool(['read'], 'complete_onboarding')).toBe(false)
    expect(canApiKeyAccessTool(['read'], 'update_metadata')).toBe(false)
    expect(canApiKeyAccessTool(['translate'], 'translate_metadata')).toBe(true)
    expect(canApiKeyAccessTool(['screenshots'], 'generate_screenshot')).toBe(true)
    expect(canApiKeyAccessTool(['publish'], 'upload_appstore_metadata')).toBe(true)
    expect(canApiKeyAccessTool(['all'], 'firebase_set_document')).toBe(true)
  })

  it('maps REST methods and workflows onto enforceable API-key scopes', () => {
    expect(canApiKeyAccessApiPath(['read'], '/api/metadata', 'GET')).toBe(true)
    expect(canApiKeyAccessApiPath(['read'], '/api/metadata', 'POST')).toBe(false)
    expect(canApiKeyAccessApiPath(['translate'], '/api/translate', 'POST')).toBe(true)
    expect(canApiKeyAccessApiPath(['screenshots'], '/api/screenshots/generate', 'POST')).toBe(true)
    expect(canApiKeyAccessApiPath(['screenshots'], '/api/screenshots/push', 'POST')).toBe(false)
    expect(canApiKeyAccessApiPath(['publish'], '/api/screenshots/push', 'POST')).toBe(true)
    expect(canApiKeyAccessApiPath(['write'], '/api/custom-product-pages', 'POST')).toBe(true)
  })

  it('exposes exactly the reviewed launch tools in public MCP discovery', async () => {
    const { response } = await handleMCPRequest({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
    }, makeContext('public-user'))

    const toolNames = ((response.result as { tools: Array<{ name: string }> }).tools)
      .map(tool => tool.name)

    expect(new Set(toolNames)).toEqual(new Set([...PUBLIC_LAUNCH_TOOL_NAMES].map(toPublicToolName)))
    expect(toolNames).not.toContain('list_iap_products')
    expect(toolNames).not.toContain('firebase_set_document')
    expect(toolNames).not.toContain('whop_create_checkout')
    expect(toolNames).not.toContain('create_store_experiment')
  })

  it('keeps internal tools in discovery for an allowlisted account', async () => {
    vi.stubEnv('INTERNAL_INTEGRATION_ALLOWED_USER_IDS', 'internal-user')

    const { response } = await handleMCPRequest({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
    }, makeContext('internal-user'))

    const toolNames = ((response.result as { tools: Array<{ name: string }> }).tools)
      .map(tool => tool.name)

    for (const toolName of INTERNAL_INTEGRATION_TOOL_NAMES) {
      expect(toolNames).toContain(toolName)
    }
  })

  it('filters public discovery and direct execution by API-key scope', async () => {
    const context = makeContext('public-user')
    const { response: listResponse } = await handleMCPRequest({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
    }, context, null, { apiKeyScopes: ['read'] })

    const toolNames = ((listResponse.result as { tools: Array<{ name: string }> }).tools)
      .map(tool => tool.name)
    expect(toolNames).toContain('read_metadata')
    expect(toolNames).not.toContain('update_metadata')

    const { response: callResponse } = await handleMCPRequest({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'update_metadata',
        arguments: { projectId: 'project-one' },
      },
    }, context, null, { apiKeyScopes: ['read'] })

    // A public tool outside this connection's scope explains the permission
    // boundary (hosts may hold a broader scanned catalog) and changes nothing.
    expect(callResponse.error).toBeUndefined()
    expect(callResponse.result).toMatchObject({
      isError: true,
      structuredContent: { success: false, permissionRequired: 'write', changed: false },
    })

    const { response: publishResponse } = await handleMCPRequest({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'upload_app_store_metadata', arguments: { projectId: 'project-one', locales: ['en-US'], dryRun: true } },
    }, context, null, { apiKeyScopes: ['read', 'write'] })
    expect(publishResponse.result).toMatchObject({
      isError: true,
      structuredContent: { permissionRequired: 'publish', changed: false },
    })
    expect(JSON.stringify(publishResponse.result)).toContain('cannot publish or upload to a store')
  })

  it.each([
    'list_gleap_tickets',
    'firebase_set_document',
    'create_iap_product',
    'whop_create_checkout',
    'create_store_experiment',
    'delete_custom_product_page',
  ])('rejects a direct public call to hidden tool %s before dispatch', async (name) => {
    const { response } = await handleMCPRequest({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name,
        arguments: { projectId: 'project-one' },
      },
    }, makeContext('public-user'))

    expect(response.error).toEqual({
      code: -32601,
      message: `Tool not found: ${name}`,
    })
  })
})

describe('internal route and project-field gates', () => {
  it('classifies internal pages, APIs, docs, and destructive store-page deletes', () => {
    expect(isInternalOnlyPath('/projects/app/iap')).toBe(true)
    expect(isInternalOnlyPath('/projects/app/analytics')).toBe(true)
    expect(isInternalOnlyPath('/projects/app/support')).toBe(true)
    expect(isInternalOnlyPath('/projects/app/purchases')).toBe(true)
    expect(isInternalOnlyPath('/setup-calls')).toBe(true)
    expect(isInternalOnlyPath('/api/concierge/internal/leads', 'PATCH')).toBe(true)
    expect(isInternalOnlyPath('/api/concierge/leads', 'POST')).toBe(false)
    expect(isInternalOnlyPath('/api/concierge/booking-webhook', 'POST')).toBe(false)
    expect(isInternalOnlyPath('/search')).toBe(true)
    expect(isInternalOnlyPath('/search/apps')).toBe(true)
    expect(isInternalOnlyPath('/team')).toBe(false)
    expect(isInternalOnlyPath('/invite/invite-one')).toBe(false)
    expect(isInternalOnlyPath('/api/org/members', 'GET')).toBe(false)
    expect(isInternalOnlyPath('/api/firebase/firestore', 'POST')).toBe(true)
    expect(isInternalOnlyPath('/api/appstore', 'GET')).toBe(true)
    expect(isInternalOnlyPath('/api/appstore', 'POST')).toBe(true)
    expect(isInternalOnlyPath('/api/playstore-iap', 'GET')).toBe(true)
    expect(isInternalOnlyPath('/api/custom-product-pages/page-one', 'DELETE')).toBe(true)
    expect(isInternalOnlyPath('/docs/mcp/iap-tools')).toBe(true)
    expect(isInternalOnlyPath('/projects/app/screenshots')).toBe(false)
    expect(isInternalOnlyPath('/api/custom-product-pages/page-one', 'PATCH')).toBe(false)
    expect(isInternalOnlyPath('/api/whop-project/webhook', 'POST')).toBe(false)
  })

  it('strips all internal provider fields from public project payloads', () => {
    const project = stripInternalProjectFields({
      id: 'project-one',
      name: 'Public App',
      revenueCatSecretKey: 'secret',
      gleapApiToken: 'token',
      whopApiKey: 'key',
      firebaseAnalyticsPropertyId: '123',
      firebaseProjectId: 'firebase-project',
    })

    expect(project).toEqual({ id: 'project-one', name: 'Public App' })
  })
})
