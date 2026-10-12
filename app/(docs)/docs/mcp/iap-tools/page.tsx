import { Metadata } from 'next'
import Link from 'next/link'
import { ArrowRight, Terminal } from 'lucide-react'
import { Callout, PrevNextNav } from '@/components/docs'

export const metadata: Metadata = {
  title: 'IAP Tools',
  description: 'MCP tools for managing in-app purchases and subscriptions.'
}

const tools = [
  {
    name: 'list_iap_products',
    description: 'List all IAPs and subscription groups for a project',
    href: '/docs/mcp/list-iap-products'
  },
  {
    name: 'create_iap_product',
    description: 'Create a new in-app purchase (consumable, non-consumable, or non-renewing)',
    href: '/docs/mcp/create-iap-product'
  },
  {
    name: 'create_subscription',
    description: 'Create an auto-renewable subscription',
    href: '/docs/mcp/create-subscription'
  },
  {
    name: 'update_iap_product',
    description: 'Update an existing IAP or subscription',
    href: '/docs/mcp/update-iap-product'
  },
  {
    name: 'set_iap_pricing',
    description: 'Set regional pricing for an IAP',
    href: '/docs/mcp/set-iap-pricing'
  },
  {
    name: 'sync_iap_products',
    description: 'Sync IAPs with App Store Connect (push/pull)',
    href: '/docs/mcp/sync-iap-products'
  },
  {
    name: 'IAP Media Tools',
    description: 'Upload review screenshots and promotional images',
    href: '/docs/mcp/iap-media'
  }
]

export default function IAPToolsPage() {
  return (
    <article className="prose prose-invert max-w-none">
      <h1 className="text-3xl font-bold text-white mb-4">IAP Tools</h1>
      <p className="text-xl text-white/60 mb-10 leading-relaxed">
        Create and manage in-app purchases, subscriptions, pricing, and media assets.
      </p>

      <Callout type="info" title="App Store Connect Required">
        <p>
          IAP tools require App Store Connect credentials to be configured in your project settings.
        </p>
      </Callout>

      <h2 id="tools" className="text-2xl font-bold text-white border-b border-white/[0.08] pb-3 mt-10">
        Available Tools
      </h2>
      <div className="not-prose grid gap-2 mt-6">
        {tools.map((tool) => (
          <Link
            key={tool.href}
            href={tool.href}
            className="group flex items-center gap-4 rounded-lg border border-white/[0.08] bg-white/[0.02] px-4 py-3 hover:bg-white/[0.05] transition-colors"
          >
            <Terminal className="h-5 w-5 text-green-400 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <code className="text-green-400">{tool.name}</code>
              <p className="text-sm text-white/50 truncate">{tool.description}</p>
            </div>
            <ArrowRight className="h-4 w-4 text-white/30 group-hover:text-green-400 transition-colors flex-shrink-0" />
          </Link>
        ))}
      </div>

      <h2 id="product-types" className="text-2xl font-bold text-white border-b border-white/[0.08] pb-3 mt-12">
        Product Types
      </h2>
      <div className="overflow-x-auto rounded-lg border border-white/[0.08] mt-6">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/[0.08] bg-white/[0.02]">
              <th className="px-4 py-3 text-left font-medium text-white/60">Type</th>
              <th className="px-4 py-3 text-left font-medium text-white/60">Description</th>
              <th className="px-4 py-3 text-left font-medium text-white/60">Example</th>
            </tr>
          </thead>
          <tbody className="text-white/70">
            <tr className="border-b border-white/[0.05]">
              <td className="px-4 py-3"><code>CONSUMABLE</code></td>
              <td className="px-4 py-3">Can be purchased multiple times</td>
              <td className="px-4 py-3">Coins, gems, lives</td>
            </tr>
            <tr className="border-b border-white/[0.05]">
              <td className="px-4 py-3"><code>NON_CONSUMABLE</code></td>
              <td className="px-4 py-3">Purchased once, permanent</td>
              <td className="px-4 py-3">Premium unlock, ad removal</td>
            </tr>
            <tr className="border-b border-white/[0.05]">
              <td className="px-4 py-3"><code>NON_RENEWING_SUBSCRIPTION</code></td>
              <td className="px-4 py-3">Time-limited, manual renewal</td>
              <td className="px-4 py-3">Season pass</td>
            </tr>
            <tr>
              <td className="px-4 py-3"><code>AUTO_RENEWABLE_SUBSCRIPTION</code></td>
              <td className="px-4 py-3">Recurring subscription</td>
              <td className="px-4 py-3">Monthly premium</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2 id="workflow" className="text-2xl font-bold text-white border-b border-white/[0.08] pb-3 mt-12">
        Typical Workflow
      </h2>
      <ol className="text-white/70 mt-6 space-y-2">
        <li><strong>1. Create:</strong> Use <code>create_iap_product</code> or <code>create_subscription</code></li>
        <li><strong>2. Price:</strong> Use <code>set_iap_pricing</code> to configure regional prices</li>
        <li><strong>3. Media:</strong> Upload review screenshots with IAP Media Tools</li>
        <li><strong>4. Sync:</strong> Use <code>sync_iap_products</code> to push to App Store Connect</li>
      </ol>

      <PrevNextNav />
    </article>
  )
}
