import { Metadata } from 'next'
import { CodeBlock, PrevNextNav } from '@/components/docs'

export const metadata: Metadata = {
  title: 'list_iap_products',
  description: 'MCP tool to list all in-app purchases and subscription groups.'
}

export default function ListIAPProductsPage() {
  return (
    <article className="prose prose-invert max-w-none">
      <h1 className="text-3xl font-bold text-white mb-4">list_iap_products</h1>
      <p className="text-xl text-white/60 mb-10 leading-relaxed">
        List all in-app purchases and subscription groups for a project.
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
            <tr>
              <td className="px-4 py-3"><code className="text-purple-400">filter</code></td>
              <td className="px-4 py-3"><code className="text-amber-400">string</code></td>
              <td className="px-4 py-3"><span className="text-white/40">No</span></td>
              <td className="px-4 py-3">&quot;all&quot;, &quot;iaps&quot;, or &quot;subscriptions&quot; (default: all)</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2 id="example" className="text-2xl font-bold text-white border-b border-white/[0.08] pb-3 mt-12">
        Example Usage
      </h2>
      <CodeBlock
        code={`"List all my in-app purchases"

"Show me the subscriptions in this project"

"What IAPs do I have configured?"`}
        language="text"
        title="Natural Language Prompts"
      />

      <h2 id="response" className="text-2xl font-bold text-white border-b border-white/[0.08] pb-3 mt-12">
        Response
      </h2>
      <CodeBlock
        code={`{
  "success": true,
  "iaps": [
    {
      "id": "iap_abc123",
      "productId": "com.app.coins_100",
      "name": "100 Coins",
      "productType": "CONSUMABLE",
      "state": "APPROVED",
      "syncStatus": "synced"
    }
  ],
  "subscriptionGroups": [
    {
      "id": "group_xyz",
      "referenceName": "Premium",
      "subscriptions": [
        {
          "id": "sub_123",
          "productId": "com.app.premium_monthly",
          "name": "Premium Monthly",
          "subscriptionPeriod": "ONE_MONTH",
          "groupLevel": 1
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
