import { Metadata } from 'next'
import { CodeBlock, Callout, PrevNextNav } from '@/components/docs'

export const metadata: Metadata = {
  title: 'create_iap_product',
  description: 'MCP tool to create a new in-app purchase.'
}

export default function CreateIAPProductPage() {
  return (
    <article className="prose prose-invert max-w-none">
      <h1 className="text-3xl font-bold text-white mb-4">create_iap_product</h1>
      <p className="text-xl text-white/60 mb-10 leading-relaxed">
        Create a new in-app purchase product (consumable, non-consumable, or non-renewing subscription).
      </p>

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
              <td className="px-4 py-3"><code className="text-purple-400">productId</code></td>
              <td className="px-4 py-3"><code className="text-amber-400">string</code></td>
              <td className="px-4 py-3"><span className="text-red-400">Yes</span></td>
              <td className="px-4 py-3">Unique product ID (e.g., com.app.coins_100)</td>
            </tr>
            <tr className="border-b border-white/[0.05]">
              <td className="px-4 py-3"><code className="text-purple-400">name</code></td>
              <td className="px-4 py-3"><code className="text-amber-400">string</code></td>
              <td className="px-4 py-3"><span className="text-red-400">Yes</span></td>
              <td className="px-4 py-3">Reference name for App Store Connect</td>
            </tr>
            <tr className="border-b border-white/[0.05]">
              <td className="px-4 py-3"><code className="text-purple-400">productType</code></td>
              <td className="px-4 py-3"><code className="text-amber-400">string</code></td>
              <td className="px-4 py-3"><span className="text-red-400">Yes</span></td>
              <td className="px-4 py-3">CONSUMABLE, NON_CONSUMABLE, or NON_RENEWING_SUBSCRIPTION</td>
            </tr>
            <tr className="border-b border-white/[0.05]">
              <td className="px-4 py-3"><code className="text-purple-400">familyShareable</code></td>
              <td className="px-4 py-3"><code className="text-amber-400">boolean</code></td>
              <td className="px-4 py-3"><span className="text-white/40">No</span></td>
              <td className="px-4 py-3">Enable family sharing (default: false)</td>
            </tr>
            <tr className="border-b border-white/[0.05]">
              <td className="px-4 py-3"><code className="text-purple-400">localizations</code></td>
              <td className="px-4 py-3"><code className="text-amber-400">array</code></td>
              <td className="px-4 py-3"><span className="text-white/40">No</span></td>
              <td className="px-4 py-3">Display names and descriptions per locale</td>
            </tr>
            <tr>
              <td className="px-4 py-3"><code className="text-purple-400">pushToStore</code></td>
              <td className="px-4 py-3"><code className="text-amber-400">boolean</code></td>
              <td className="px-4 py-3"><span className="text-white/40">No</span></td>
              <td className="px-4 py-3">Immediately push to App Store Connect (default: false)</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2 id="example" className="text-2xl font-bold text-white border-b border-white/[0.08] pb-3 mt-12">
        Example Usage
      </h2>
      <CodeBlock
        code={`"Create a consumable IAP for 100 coins at $0.99"

"Add a non-consumable 'Remove Ads' purchase"

"Create a season pass as a non-renewing subscription"`}
        language="text"
        title="Natural Language Prompts"
      />

      <h2 id="response" className="text-2xl font-bold text-white border-b border-white/[0.08] pb-3 mt-12">
        Response
      </h2>
      <CodeBlock
        code={`{
  "success": true,
  "iap": {
    "id": "iap_abc123",
    "productId": "com.app.coins_100",
    "name": "100 Coins",
    "productType": "CONSUMABLE",
    "syncStatus": "pending_creation"
  }
}`}
        language="json"
      />

      <Callout type="info" title="Sync Status">
        <p>
          Products are created locally first with <code>pending_creation</code> status.
          Use <code>sync_iap_products</code> to push to App Store Connect, or set <code>pushToStore: true</code>.
        </p>
      </Callout>

      <PrevNextNav />
    </article>
  )
}
