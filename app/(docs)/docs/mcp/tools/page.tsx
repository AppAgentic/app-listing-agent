import { Metadata } from 'next'
import { Callout, PrevNextNav } from '@/components/docs'
import { getPublicCapabilityManifest } from '@/lib/mcp/capability-manifest'
import type { PublicCapabilityCategory } from '@/lib/mcp/public-capabilities'
import { toPublicToolName } from '@/lib/mcp/public-tool-names'
import { pageMetadata } from '@/lib/seo/site'

export const metadata: Metadata = pageMetadata({
  title: 'Tool reference',
  description: 'Every public App Listing Agent MCP tool with its description, parameters, required key scope and approval rule.',
  path: '/docs/mcp/tools',
  socialTitle: 'Tool reference | App Listing Agent Docs',
})

// Generated from the same definitions the MCP server advertises in tools/list,
// so names, descriptions and parameters cannot drift from the live server.

const CATEGORY_LABELS: Record<PublicCapabilityCategory, string> = {
  onboarding: 'Onboarding and readiness',
  metadata: 'Metadata',
  screenshots: 'Screenshots and graphics',
  utilities: 'Utilities',
  icons: 'Icons',
  legal: 'Legal documents',
  'custom-pages': 'Custom product pages and custom store listings',
  'campaign-content': 'Campaign text',
}

const APPROVAL_LABELS = {
  none: 'Not needed (read-only)',
  policy: 'Follows your approval policy',
  always: 'Always needs your approval',
} as const

const COST_LABELS = {
  none: 'No usage charge',
  'metered-ai': 'Uses plan allowance (AI)',
  'store-operation': 'Store operation',
} as const

interface SchemaProperty {
  type?: string | string[]
  description?: string
  enum?: unknown[]
  items?: { type?: string; enum?: unknown[] }
  default?: unknown
}

interface InputSchema {
  properties?: Record<string, SchemaProperty>
  required?: string[]
}

function typeLabel(property: SchemaProperty): string {
  const base = Array.isArray(property.type) ? property.type.join(' | ') : property.type ?? 'any'
  if (base === 'array' && property.items?.type) return `${property.items.type}[]`
  return base
}

function allowedValues(property: SchemaProperty): unknown[] | undefined {
  return property.enum ?? property.items?.enum
}

export default function MCPToolReferencePage() {
  const { capabilities } = getPublicCapabilityManifest()
  const categories = Object.keys(CATEGORY_LABELS) as PublicCapabilityCategory[]

  return (
    <article className="prose prose-invert max-w-none">
      <h1 className="text-3xl font-bold text-white mb-4">Tool reference</h1>
      <p className="text-xl text-white/60 mb-10 leading-relaxed">
        The {capabilities.length} tools a standard App Listing Agent account can use over MCP. This page is
        generated from the same definitions the server returns from <code>tools/list</code>.
      </p>

      <Callout type="info" title="What your agent actually sees">
        <p>
          Tool discovery is filtered by the connection. A scoped API key only lists tools its scopes allow, and the
          Claude connector endpoint (<code>/api/mcp/claude</code>) does not include the AI image generation, image editing and
          screenshot translation tools.
        </p>
      </Callout>

      {categories.map(category => {
        const tools = capabilities.filter(tool => tool.category === category)
        if (tools.length === 0) return null
        return (
          <section key={category}>
            <h2 id={category} className="text-2xl font-bold text-white border-b border-white/[0.08] pb-3 mt-12">
              {CATEGORY_LABELS[category]}
            </h2>
            {tools.map(tool => {
              const publicName = toPublicToolName(tool.name)
              const schema = tool.inputSchema as InputSchema
              const properties = Object.entries(schema.properties ?? {})
              const required = new Set(schema.required ?? [])
              return (
                <div key={tool.name} className="mt-10">
                  <h3 id={publicName} className="text-lg font-semibold text-white mb-2">
                    <code className="text-purple-400">{publicName}</code>
                  </h3>
                  <p className="text-white/70 leading-relaxed">{tool.description}</p>
                  <div className="not-prose mt-3 flex flex-wrap gap-2 text-xs">
                    <span className="rounded-full bg-white/[0.06] px-3 py-1 text-white/60">
                      Key scope: <code>{tool.requiredScope}</code>
                    </span>
                    <span className="rounded-full bg-white/[0.06] px-3 py-1 text-white/60">
                      Approval: {APPROVAL_LABELS[tool.approval]}
                    </span>
                    <span className="rounded-full bg-white/[0.06] px-3 py-1 text-white/60">
                      {COST_LABELS[tool.cost]}
                    </span>
                  </div>
                  {properties.length > 0 && (
                    <div className="overflow-x-auto rounded-lg border border-white/[0.08] mt-4">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-white/[0.08] bg-white/[0.02]">
                            <th className="px-4 py-3 text-left font-medium text-white/60">Parameter</th>
                            <th className="px-4 py-3 text-left font-medium text-white/60">Type</th>
                            <th className="px-4 py-3 text-left font-medium text-white/60">Required</th>
                            <th className="px-4 py-3 text-left font-medium text-white/60">Description</th>
                          </tr>
                        </thead>
                        <tbody className="text-white/70">
                          {properties.map(([name, property]) => {
                            const values = allowedValues(property)
                            return (
                              <tr key={name} className="border-b border-white/[0.05] last:border-0">
                                <td className="px-4 py-3 align-top"><code className="text-purple-400">{name}</code></td>
                                <td className="px-4 py-3 align-top"><code className="text-amber-400">{typeLabel(property)}</code></td>
                                <td className="px-4 py-3 align-top">
                                  {required.has(name)
                                    ? <span className="text-white">Yes</span>
                                    : <span className="text-white/40">No</span>}
                                </td>
                                <td className="px-4 py-3 align-top">
                                  {property.description}
                                  {values && values.length > 0 && (
                                    <span className="block mt-1 text-white/50">
                                      One of: {values.map(value => String(value)).join(', ')}
                                    </span>
                                  )}
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )
            })}
          </section>
        )
      })}

      <PrevNextNav />
    </article>
  )
}
