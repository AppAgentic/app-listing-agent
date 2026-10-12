import { SCREENSHOT_WIDGET_URI } from '@/lib/mcp/apps/screenshot-widget'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SANDBOX_STRIPE_ACCOUNT_ID } from '@/lib/stripe/config'
import type { AccountContext } from '@/lib/org/context'
import { handleMCPRequest } from '@/lib/mcp/server'
import {
  READINESS_WIDGET_HTML,
  READINESS_WIDGET_MIME_TYPE,
  READINESS_WIDGET_URI,
  normalizeReadinessWidgetData,
  readReadinessWidgetResource,
} from '@/lib/mcp/apps/readiness-widget'

beforeEach(() => {
  vi.stubEnv('STRIPE_ACCOUNT_ID', SANDBOX_STRIPE_ACCOUNT_ID)
  vi.stubEnv('STRIPE_LIVEMODE', 'false')
})

function context(): AccountContext {
  return {
    type: 'personal',
    userId: 'widget-user',
    user: {
      email: 'widget@example.com',
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
      billing: { source: 'stripe', status: 'trialing', plan: 'starter', subscriptionId: 'sub_widget000001', livemode: false, providerAccountId: SANDBOX_STRIPE_ACCOUNT_ID, updatedAt: {} as never },
      apiKey: 'widget-key',
      createdAt: {} as never,
      updatedAt: {} as never,
    },
  }
}

const readiness = {
  project: {
    id: 'project-one',
    name: 'Launch App',
    storeType: 'ios',
    storeRecordStatus: 'existing',
    syncStatus: 'never_synced',
  },
  ready: false,
  blockers: [{ code: 'missing_title', message: 'The project needs a title.' }],
  approvalBoundary: 'Publishing requires explicit human approval.',
  nextAction: 'Draft the base title.',
}

describe('MCP Apps readiness workspace', () => {
  it('normalizes untrusted model-provided render data into a bounded shape', () => {
    const normalized = normalizeReadinessWidgetData({
      ...readiness,
      project: { ...readiness.project, name: 'A'.repeat(300) },
      blockers: Array.from({ length: 20 }, (_, index) => ({
        code: `blocker_${index}`,
        message: index === 0 ? '<img src=x onerror=alert(1)>' : `Blocker ${index}`,
      })),
    })

    expect(normalized.project.name).toHaveLength(120)
    expect(normalized.blockers).toHaveLength(8)
    expect(normalized.blockers[0].message).toBe('<img src=x onerror=alert(1)>')
    expect(READINESS_WIDGET_HTML).not.toContain('<img src=x onerror=alert(1)>')
    expect(READINESS_WIDGET_HTML).toContain('document.createTextNode(String(blocker.message')
    expect(READINESS_WIDGET_HTML).not.toContain('innerHTML')
  })

  it('publishes a self-contained resource with restrictive CSP metadata', () => {
    const resource = readReadinessWidgetResource().contents[0]
    expect(resource.uri).toBe(READINESS_WIDGET_URI)
    expect(resource.mimeType).toBe(READINESS_WIDGET_MIME_TYPE)
    expect(resource.text).not.toMatch(/<script[^>]+src=/i)
    expect(resource.text).toContain("request('ui/initialize'")
    expect(resource.text).toContain("notify('ui/notifications/initialized')")
    expect(resource.text).toContain("notify('ui/notifications/size-changed'")
    expect(resource.text).toContain('new ResizeObserver(sendSizeChanged)')
    expect(resource._meta.ui.csp).toEqual({ connectDomains: [], resourceDomains: [] })
    expect(resource._meta['openai/widgetCSP']).toMatchObject({
      connect_domains: [],
      resource_domains: [],
      redirect_domains: ['https://applistingagent.com'],
    })
  })

  it('advertises and reads the widget through standard MCP resources', async () => {
    const initialized = await handleMCPRequest({
      jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2025-11-25' },
    }, context())
    expect(initialized.response.result).toMatchObject({
      capabilities: { resources: {} },
      instructions: expect.stringContaining('show_readiness_report'),
    })

    const listed = await handleMCPRequest({
      jsonrpc: '2.0', id: 1, method: 'resources/list',
    }, context())
    expect(listed.response.result).toMatchObject({
      resources: [{ uri: READINESS_WIDGET_URI, mimeType: READINESS_WIDGET_MIME_TYPE }, { uri: SCREENSHOT_WIDGET_URI, mimeType: READINESS_WIDGET_MIME_TYPE }],
    })

    const read = await handleMCPRequest({
      jsonrpc: '2.0', id: 2, method: 'resources/read', params: { uri: READINESS_WIDGET_URI },
    }, context())
    expect(read.response.result).toMatchObject({
      contents: [{ uri: READINESS_WIDGET_URI, mimeType: READINESS_WIDGET_MIME_TYPE }],
    })
  })

  it('attaches the screenshot resource to get_screenshots and serves the declared gallery', async () => {
    const listed = await handleMCPRequest({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, context())
    const tools = (listed.response.result as { tools: Array<Record<string, unknown>> }).tools
    expect(tools.find(tool => tool.name === 'get_screenshots')?._meta).toMatchObject({
      ui: { resourceUri: SCREENSHOT_WIDGET_URI }, 'openai/outputTemplate': SCREENSHOT_WIDGET_URI,
    })
    const read = await handleMCPRequest({ jsonrpc: '2.0', id: 2, method: 'resources/read', params: { uri: SCREENSHOT_WIDGET_URI } }, context())
    expect(read.response.result).toMatchObject({ contents: [{ uri: SCREENSHOT_WIDGET_URI,
      text: expect.stringContaining('Open saved image'),
      _meta: { ui: { csp: { resourceDomains: ['https://screens.appstorecopilot.com'] } } },
    }] })
  })

  it('keeps the render tool decoupled and returns structured content', async () => {
    const listed = await handleMCPRequest({
      jsonrpc: '2.0', id: 1, method: 'tools/list',
    }, context())
    const tools = (listed.response.result as { tools: Array<Record<string, unknown>> }).tools
    const renderTool = tools.find(tool => tool.name === 'show_readiness_report')
    expect(renderTool?._meta).toMatchObject({
      ui: { resourceUri: READINESS_WIDGET_URI, visibility: ['model', 'app'] },
      'openai/outputTemplate': READINESS_WIDGET_URI,
    })

    const called = await handleMCPRequest({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'show_readiness_report', arguments: readiness },
    }, context())
    expect((called.response.result as Record<string, unknown>).structuredContent).toEqual({
      ...readiness,
      blockers: [{ ...readiness.blockers[0], deferrable: false }],
    })
  })

  it('rejects a tool argument that conflicts with an OAuth-locked project', async () => {
    const result = await handleMCPRequest({
      jsonrpc: '2.0',
      id: 9,
      method: 'tools/call',
      params: {
        name: 'read_metadata',
        arguments: { projectId: 'different-project', locale: 'en-US' },
      },
    }, context(), 'locked-project', {
      apiKeyScopes: ['read'],
      projectScopeLocked: true,
    })

    expect(result.response.error).toEqual({
      code: -32602,
      message: 'OAuth token is scoped to another project',
    })
  })

  it('hides account-level onboarding tools from a project-locked token', async () => {
    const result = await handleMCPRequest({
      jsonrpc: '2.0', id: 10, method: 'tools/list',
    }, context(), 'locked-project', {
      apiKeyScopes: ['read', 'write'],
      projectScopeLocked: true,
    })
    const names = (result.response.result as { tools: Array<{ name: string }> }).tools.map(tool => tool.name)

    expect(names).toContain('get_onboarding_status')
    expect(names).not.toContain('list_importable_apps')
    expect(names).not.toContain('create_onboarding_project')
    expect(names).not.toContain('start_store_connection')
    expect(names).not.toContain('set_agent_policy')
  })
})
