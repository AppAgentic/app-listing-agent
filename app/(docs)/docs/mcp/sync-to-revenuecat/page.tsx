import { Metadata } from 'next'
import { CodeBlock, Callout, PrevNextNav } from '@/components/docs'

export const metadata: Metadata = {
  title: 'sync_products_to_revenuecat',
  description: 'MCP tool to sync App Store products to RevenueCat.'
}

export default function SyncToRevenueCatPage() {
  return (
    <article className="prose prose-invert max-w-none">
      <h1 className="text-3xl font-bold text-white mb-4">sync_products_to_revenuecat</h1>
      <p className="text-xl text-white/60 mb-10 leading-relaxed">
        Sync your in-app purchases and subscriptions from App Listing Agent to RevenueCat.
      </p>

      <Callout type="warning" title="Setup Required">
        <p>
          This tool requires RevenueCat credentials configured in project settings and
          at least one RevenueCat app created.
        </p>
      </Callout>

      <h2 id="parameters" className="text-2xl font-bold text-white border-b border-white/[0.08] pb-3 mt-10">
        Parameters
      </h2>
      <div className="overflow-x-auto rounded-lg border border-white/[0.08] mt-6">
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
            <tr className="border-b border-white/[0.05]">
              <td className="px-4 py-3"><code className="text-purple-400">projectId</code></td>
              <td className="px-4 py-3"><code className="text-amber-400">string</code></td>
              <td className="px-4 py-3"><span className="text-red-400">Yes</span></td>
              <td className="px-4 py-3">The project ID</td>
            </tr>
            <tr className="border-b border-white/[0.05]">
              <td className="px-4 py-3"><code className="text-purple-400">appId</code></td>
              <td className="px-4 py-3"><code className="text-amber-400">string</code></td>
              <td className="px-4 py-3"><span className="text-red-400">Yes</span></td>
              <td className="px-4 py-3">RevenueCat app ID to sync products to</td>
            </tr>
            <tr>
              <td className="px-4 py-3"><code className="text-purple-400">productIds</code></td>
              <td className="px-4 py-3"><code className="text-amber-400">string[]</code></td>
              <td className="px-4 py-3"><span className="text-white/40">No</span></td>
              <td className="px-4 py-3">Specific product IDs to sync (all if not specified)</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2 id="example" className="text-2xl font-bold text-white border-b border-white/[0.08] pb-3 mt-12">
        Example Usage
      </h2>
      <CodeBlock
        code={`"Sync my subscriptions to RevenueCat"

"Push all products to RevenueCat app app_abc123"

"Sync the premium subscription to RevenueCat"`}
        language="text"
        title="Natural Language Prompts"
      />

      <h2 id="response" className="text-2xl font-bold text-white border-b border-white/[0.08] pb-3 mt-12">
        Response
      </h2>
      <CodeBlock
        code={`{
  "success": true,
  "created": ["com.app.premium_monthly", "com.app.premium_annual"],
  "skipped": ["com.app.coins_100"],
  "errors": [],
  "summary": {
    "total": 3,
    "created": 2,
    "skipped": 1,
    "errors": 0
  }
}`}
        language="json"
      />

      <Callout type="info" title="Skipped Products">
        <p>
          Products that already exist in RevenueCat will be skipped. Consumables may be
          skipped if RevenueCat doesn&apos;t support the specific product type configuration.
        </p>
      </Callout>

      <PrevNextNav />
    </article>
  )
}
