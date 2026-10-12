import { Metadata } from 'next'
import Link from 'next/link'
import { ArrowRight, Terminal } from 'lucide-react'
import { Callout, PrevNextNav } from '@/components/docs'

export const metadata: Metadata = {
  title: 'RevenueCat Tools',
  description: 'MCP tools for RevenueCat integration - apps, products, entitlements, and offerings.'
}

const tools = [
  {
    name: 'list_revenuecat_apps',
    description: 'List all apps in your RevenueCat project',
    href: '/docs/mcp/revenuecat-tools'
  },
  {
    name: 'create_revenuecat_app',
    description: 'Create a new app in RevenueCat',
    href: '/docs/mcp/create-revenuecat-app'
  },
  {
    name: 'list_revenuecat_products',
    description: 'List all products for an app',
    href: '/docs/mcp/revenuecat-tools'
  },
  {
    name: 'create_revenuecat_product',
    description: 'Create a product in RevenueCat',
    href: '/docs/mcp/revenuecat-tools'
  },
  {
    name: 'list_revenuecat_entitlements',
    description: 'List all entitlements',
    href: '/docs/mcp/revenuecat-tools'
  },
  {
    name: 'create_revenuecat_entitlement',
    description: 'Create an entitlement for access control',
    href: '/docs/mcp/revenuecat-tools'
  },
  {
    name: 'list_revenuecat_offerings',
    description: 'List all offerings',
    href: '/docs/mcp/revenuecat-tools'
  },
  {
    name: 'create_revenuecat_offering',
    description: 'Create an offering with packages',
    href: '/docs/mcp/create-offering'
  },
  {
    name: 'create_revenuecat_package',
    description: 'Add a package to an offering',
    href: '/docs/mcp/revenuecat-tools'
  },
  {
    name: 'sync_products_to_revenuecat',
    description: 'Sync App Store products to RevenueCat',
    href: '/docs/mcp/sync-to-revenuecat'
  },
  {
    name: 'create_offering_with_products',
    description: 'Create a complete offering setup in one call',
    href: '/docs/mcp/create-offering'
  }
]

export default function RevenueCatToolsPage() {
  return (
    <article className="prose prose-invert max-w-none">
      <h1 className="text-3xl font-bold text-white mb-4">RevenueCat Tools</h1>
      <p className="text-xl text-white/60 mb-10 leading-relaxed">
        Integrate with RevenueCat to manage cross-platform subscriptions, entitlements, and offerings.
      </p>

      <Callout type="warning" title="Setup Required">
        <p>
          RevenueCat tools require your RevenueCat Secret API Key and Project ID to be configured
          in project settings. Find these in your RevenueCat dashboard under Project Settings → API Keys.
        </p>
      </Callout>

      <h2 id="tools" className="text-2xl font-bold text-white border-b border-white/[0.08] pb-3 mt-10">
        Available Tools
      </h2>
      <div className="not-prose grid gap-2 mt-6">
        {tools.map((tool, idx) => (
          <Link
            key={`${tool.name}-${idx}`}
            href={tool.href}
            className="group flex items-center gap-4 rounded-lg border border-white/[0.08] bg-white/[0.02] px-4 py-3 hover:bg-white/[0.05] transition-colors"
          >
            <Terminal className="h-5 w-5 text-amber-400 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <code className="text-amber-400">{tool.name}</code>
              <p className="text-sm text-white/50 truncate">{tool.description}</p>
            </div>
            <ArrowRight className="h-4 w-4 text-white/30 group-hover:text-amber-400 transition-colors flex-shrink-0" />
          </Link>
        ))}
      </div>

      <h2 id="concepts" className="text-2xl font-bold text-white border-b border-white/[0.08] pb-3 mt-12">
        RevenueCat Concepts
      </h2>
      <div className="overflow-x-auto rounded-lg border border-white/[0.08] mt-6">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/[0.08] bg-white/[0.02]">
              <th className="px-4 py-3 text-left font-medium text-white/60">Concept</th>
              <th className="px-4 py-3 text-left font-medium text-white/60">Description</th>
            </tr>
          </thead>
          <tbody className="text-white/70">
            <tr className="border-b border-white/[0.05]">
              <td className="px-4 py-3"><strong>App</strong></td>
              <td className="px-4 py-3">Your iOS or Android app connected to a store</td>
            </tr>
            <tr className="border-b border-white/[0.05]">
              <td className="px-4 py-3"><strong>Product</strong></td>
              <td className="px-4 py-3">A purchasable item linked to an App Store product ID</td>
            </tr>
            <tr className="border-b border-white/[0.05]">
              <td className="px-4 py-3"><strong>Entitlement</strong></td>
              <td className="px-4 py-3">Access level granted by purchases (e.g., &quot;premium&quot;)</td>
            </tr>
            <tr className="border-b border-white/[0.05]">
              <td className="px-4 py-3"><strong>Offering</strong></td>
              <td className="px-4 py-3">A collection of packages shown to users</td>
            </tr>
            <tr>
              <td className="px-4 py-3"><strong>Package</strong></td>
              <td className="px-4 py-3">A product within an offering (e.g., &quot;$rc_monthly&quot;)</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2 id="workflow" className="text-2xl font-bold text-white border-b border-white/[0.08] pb-3 mt-12">
        Quick Setup Workflow
      </h2>
      <ol className="text-white/70 mt-6 space-y-2">
        <li><strong>1.</strong> Create an app with <code>create_revenuecat_app</code></li>
        <li><strong>2.</strong> Sync products with <code>sync_products_to_revenuecat</code></li>
        <li><strong>3.</strong> Create entitlement with <code>create_revenuecat_entitlement</code></li>
        <li><strong>4.</strong> Create offering with <code>create_offering_with_products</code></li>
      </ol>

      <Callout type="tip" title="One-Step Setup">
        <p>
          Use <code>create_offering_with_products</code> to create an entitlement, offering, and
          packages all in one call.
        </p>
      </Callout>

      <PrevNextNav />
    </article>
  )
}
