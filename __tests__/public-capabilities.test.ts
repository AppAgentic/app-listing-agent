import { describe, expect, it } from 'vitest'
import {
  ANNOTATION_CLASSIFICATION,
  PUBLIC_CAPABILITIES,
  PUBLIC_LAUNCH_TOOL_NAMES,
  getPublicCapability,
  requiresDurableApprovalInvocation,
} from '@/lib/mcp/public-capabilities'
import { getPublicCapabilityManifest } from '@/lib/mcp/capability-manifest'
import { TOOL_DEFINITIONS, decoratePublicToolDefinition } from '@/lib/mcp/server'

describe('public capability contract', () => {
  it('covers every reviewed public tool exactly once', () => {
    const names = PUBLIC_CAPABILITIES.map(capability => capability.name)
    expect(names).toHaveLength(55)
    expect(new Set(names).size).toBe(55)
    expect(new Set(names)).toEqual(PUBLIC_LAUNCH_TOOL_NAMES)
  })

  it('has a real MCP definition for every public capability', () => {
    const mcpNames = new Set(TOOL_DEFINITIONS.map(tool => tool.name))
    for (const capability of PUBLIC_CAPABILITIES) {
      expect(mcpNames.has(capability.name), capability.name).toBe(true)
    }
  })

  it('marks reads and external publishing accurately', () => {
    expect(getPublicCapability('read_metadata')).toMatchObject({
      requiredScope: 'read',
      readOnly: true,
      destructive: false,
      openWorld: false,
      untrustedData: true,
      approval: 'none',
    })
    expect(getPublicCapability('check_screenshot_job')).toMatchObject({
      requiredScope: 'screenshots',
      readOnly: true,
    })
    expect(getPublicCapability('upload_appstore_metadata')).toMatchObject({
      requiredScope: 'publish',
      readOnly: false,
      destructive: true,
      openWorld: true,
      approval: 'always',
    })
    expect(getPublicCapability('sync_stores')).toMatchObject({
      requiredScope: 'publish',
      destructive: true,
      openWorld: true,
      approval: 'always',
    })

    // Reads the user's own Play Console (bounded private account) and replaces
    // the local graphic sets.
    expect(getPublicCapability('pull_play_store_graphics')).toMatchObject({
      requiredScope: 'screenshots',
      readOnly: false,
      openWorld: false,
      destructive: true,
    })
    expect(getPublicCapability('fetch_appstore_icon')).toMatchObject({
      requiredScope: 'write',
      readOnly: false,
      openWorld: true,
    })

    for (const name of [
      'upload_screenshot_asset',
      'import_screenshots',
      'resize_icon',
    ]) {
      expect(getPublicCapability(name), name).toMatchObject({
        openWorld: true,
      })
    }

    for (const name of [
      'sync_custom_product_pages',
      'sync_custom_store_listings',
    ]) {
      expect(getPublicCapability(name), name).toMatchObject({
        requiredScope: 'publish',
        readOnly: false,
        openWorld: true,
        destructive: true,
        approval: 'always',
      })
    }

    expect(getPublicCapability('set_agent_policy')).toMatchObject({
      requiredScope: 'write',
      approval: 'always',
    })
  })

  it('requires publish authority and approval for immediately public legal documents', () => {
    expect(getPublicCapability('update_legal_document')).toMatchObject({
      requiredScope: 'publish', risk: 'publish', approval: 'always',
      readOnly: false, destructive: true, openWorld: true, cost: 'none',
    })
    for (const args of [{}, { dryRun: true }, { confirmed: true }]) {
      expect(requiresDurableApprovalInvocation('update_legal_document', args)).toBe(true)
    }
    const definition = decoratePublicToolDefinition(TOOL_DEFINITIONS.find(tool => tool.name === 'update_legal_document')!)
    expect(definition.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true, openWorldHint: true })
    expect(definition._meta).toMatchObject({ 'applistingagent/scope': 'publish', 'applistingagent/approval': 'always' })
  })

  it('requires durable approval for live conditional pushes and policy changes', () => {
    expect(requiresDurableApprovalInvocation('sync_custom_product_pages', { direction: 'pull' })).toBe(false)
    expect(requiresDurableApprovalInvocation('sync_custom_product_pages', { direction: 'push', confirmed: true })).toBe(true)
    expect(requiresDurableApprovalInvocation('sync_custom_product_pages', { direction: 'Push', confirmed: true })).toBe(true)
    expect(requiresDurableApprovalInvocation('sync_custom_product_pages', { confirmed: true })).toBe(true)
    expect(requiresDurableApprovalInvocation('sync_custom_store_listings', { direction: 'push', confirmed: true })).toBe(true)
    expect(requiresDurableApprovalInvocation('upload_appstore_metadata', { dryRun: true })).toBe(false)
    expect(requiresDurableApprovalInvocation('upload_appstore_metadata', { dryRun: false })).toBe(true)
    expect(requiresDurableApprovalInvocation('set_agent_policy', { mode: 'publish_with_approval' })).toBe(true)
    expect(requiresDurableApprovalInvocation('set_agent_policy', { mode: 'publish_with_approval', dryRun: true })).toBe(true)
    expect(requiresDurableApprovalInvocation('push_legal_to_appstore', { dryRun: true })).toBe(true)
  })

  it('adds scanner-readable annotations to public tool discovery', () => {
    const source = TOOL_DEFINITIONS.find(tool => tool.name === 'upload_playstore_metadata')!
    const decorated = decoratePublicToolDefinition(source)

    expect(decorated.name).toBe('upload_google_play_metadata')
    expect(decorated.title).toBe('Upload Google Play Metadata')
    expect(decorated.annotations).toEqual({
      title: 'Upload Google Play Metadata',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    })
    expect(decorated._meta).toMatchObject({
      'applistingagent/scope': 'publish',
      'applistingagent/approval': 'always',
    })
    expect(decorated.execution).toEqual({ taskSupport: 'optional' })

    const readTool = decoratePublicToolDefinition(
      TOOL_DEFINITIONS.find(tool => tool.name === 'read_metadata')!
    )
    expect(readTool.execution).toEqual({ taskSupport: 'forbidden' })
    expect(readTool._meta).toMatchObject({
      'applistingagent/untrusted-data': true,
    })
  })

  it('publishes an output schema for every public tool', () => {
    for (const capability of PUBLIC_CAPABILITIES) {
      const source = TOOL_DEFINITIONS.find(tool => tool.name === capability.name)!
      const decorated = decoratePublicToolDefinition(source)

      expect(decorated.outputSchema, capability.name).toMatchObject({
        type: 'object',
      })
    }

    const readinessTool = decoratePublicToolDefinition(
      TOOL_DEFINITIONS.find(tool => tool.name === 'render_readiness_workspace')!
    )
    expect(readinessTool.outputSchema?.required).toEqual([
      'project',
      'ready',
      'blockers',
      'approvalBoundary',
      'nextAction',
    ])
  })

  it('publishes a machine-readable manifest without internal tools', () => {
    const manifest = getPublicCapabilityManifest()
    const names = manifest.capabilities.map(capability => capability.name)

    expect(manifest.endpoints.mcp).toBe('https://applistingagent.com/api/mcp')
    expect(manifest.safety.publishRequiresApproval).toBe(true)
    expect(names).toHaveLength(55)
    expect(names).not.toContain('list_gleap_tickets')
    expect(names).not.toContain('firebase_set_document')
    expect(names).not.toContain('search_appstore')
  })
})

describe('annotation hints are classified per tool', () => {
  const { DESTRUCTIVE_TOOLS, NON_DESTRUCTIVE_TOOLS, OPEN_WORLD_TOOLS, CLOSED_WORLD_TOOLS } = ANNOTATION_CLASSIFICATION

  it('puts every public tool in exactly one destructive and one open-world bucket', () => {
    for (const name of PUBLIC_LAUNCH_TOOL_NAMES) {
      expect(DESTRUCTIVE_TOOLS.has(name) !== NON_DESTRUCTIVE_TOOLS.has(name), `${name} destructive bucket`).toBe(true)
      expect(OPEN_WORLD_TOOLS.has(name) !== CLOSED_WORLD_TOOLS.has(name), `${name} open-world bucket`).toBe(true)
    }
    for (const name of [...DESTRUCTIVE_TOOLS, ...NON_DESTRUCTIVE_TOOLS, ...OPEN_WORLD_TOOLS, ...CLOSED_WORLD_TOOLS]) {
      expect(PUBLIC_LAUNCH_TOOL_NAMES.has(name), `${name} is public`).toBe(true)
    }
  })

  it('advertises explicit booleans and never a destructive read', () => {
    for (const capability of PUBLIC_CAPABILITIES) {
      expect(typeof capability.readOnly, capability.name).toBe('boolean')
      expect(typeof capability.destructive, capability.name).toBe('boolean')
      expect(typeof capability.openWorld, capability.name).toBe('boolean')
      if (capability.readOnly) expect(capability.destructive, capability.name).toBe(false)
    }
  })

  it('marks overwriting draft edits as destructive and private-workspace tools as closed-world', () => {
    for (const name of ['update_metadata', 'translate_metadata', 'edit_screenshot', 'import_screenshots', 'update_cpp_localization', 'upload_csl_icon']) {
      expect(getPublicCapability(name)?.destructive, name).toBe(true)
    }
    for (const name of ['read_metadata', 'get_screenshots', 'list_custom_product_pages', 'translate_metadata', 'run_store_readiness_audit']) {
      expect(getPublicCapability(name)?.openWorld, name).toBe(false)
    }
    for (const name of ['create_custom_product_page', 'upload_cpp_screenshot', 'generate_screenshot']) {
      expect(getPublicCapability(name)?.destructive, name).toBe(false)
    }
  })
})
