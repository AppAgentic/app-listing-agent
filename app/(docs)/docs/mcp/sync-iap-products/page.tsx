import { Metadata } from 'next'
import { CodeBlock, Callout, PrevNextNav } from '@/components/docs'

export const metadata: Metadata = {
  title: 'sync_iap_products',
  description: 'MCP tool to sync in-app purchases with App Store Connect.'
}

export default function SyncIAPProductsPage() {
  return (
    <article className="prose prose-invert max-w-none">
      <h1 className="text-3xl font-bold text-white mb-4">sync_iap_products</h1>
      <p className="text-xl text-white/60 mb-10 leading-relaxed">
        Sync in-app purchases between App Listing Agent and App Store Connect (push or pull).
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
              <td className="px-4 py-3"><code className="text-purple-400">direction</code></td>
              <td className="px-4 py-3"><code className="text-amber-400">string</code></td>
              <td className="px-4 py-3"><span className="text-red-400">Yes</span></td>
              <td className="px-4 py-3">&quot;push&quot; (to App Store) or &quot;pull&quot; (from App Store)</td>
            </tr>
            <tr className="border-b border-white/[0.05]">
              <td className="px-4 py-3"><code className="text-purple-400">iapIds</code></td>
              <td className="px-4 py-3"><code className="text-amber-400">string[]</code></td>
              <td className="px-4 py-3"><span className="text-white/40">No</span></td>
              <td className="px-4 py-3">Specific IAP IDs to sync</td>
            </tr>
            <tr className="border-b border-white/[0.05]">
              <td className="px-4 py-3"><code className="text-purple-400">subscriptionIds</code></td>
              <td className="px-4 py-3"><code className="text-amber-400">string[]</code></td>
              <td className="px-4 py-3"><span className="text-white/40">No</span></td>
              <td className="px-4 py-3">Specific subscription IDs to sync</td>
            </tr>
            <tr>
              <td className="px-4 py-3"><code className="text-purple-400">pushAll</code></td>
              <td className="px-4 py-3"><code className="text-amber-400">boolean</code></td>
              <td className="px-4 py-3"><span className="text-white/40">No</span></td>
              <td className="px-4 py-3">Push all pending products (default: false)</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2 id="example" className="text-2xl font-bold text-white border-b border-white/[0.08] pb-3 mt-12">
        Example Usage
      </h2>
      <CodeBlock
        code={`"Push my IAPs to App Store Connect"

"Pull existing in-app purchases from the App Store"

"Sync the premium subscription to App Store Connect"`}
        language="text"
        title="Natural Language Prompts"
      />

      <h2 id="response" className="text-2xl font-bold text-white border-b border-white/[0.08] pb-3 mt-12">
        Response
      </h2>
      <CodeBlock
        code={`{
  "success": true,
  "summary": {
    "created": ["com.app.coins_100", "com.app.premium_monthly"],
    "updated": ["com.app.remove_ads"],
    "errors": []
  }
}`}
        language="json"
      />

      <Callout type="warning" title="Validation">
        <p>
          When pushing, products are validated for required fields (localizations, pricing).
          If validation fails, you&apos;ll receive suggested actions to fix each issue.
        </p>
      </Callout>

      <h2 id="validation" className="text-2xl font-bold text-white border-b border-white/[0.08] pb-3 mt-12">
        Validation Response
      </h2>
      <CodeBlock
        code={`{
  "success": false,
  "validationFailed": true,
  "validationMessage": "2 products are missing required fields",
  "validationIssues": [
    {
      "id": "iap_abc123",
      "productId": "com.app.coins_100",
      "type": "iap",
      "missingFields": ["Pricing", "Localizations"],
      "suggestedActions": [
        {
          "tool": "setIAPPricing",
          "description": "Set a base price for the IAP"
        },
        {
          "tool": "translateIAPProduct",
          "description": "Add localizations"
        }
      ]
    }
  ]
}`}
        language="json"
      />

      <PrevNextNav />
    </article>
  )
}
