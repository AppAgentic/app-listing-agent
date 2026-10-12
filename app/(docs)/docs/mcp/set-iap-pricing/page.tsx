import { Metadata } from 'next'
import { CodeBlock, Callout, PrevNextNav } from '@/components/docs'

export const metadata: Metadata = {
  title: 'set_iap_pricing',
  description: 'MCP tool to set regional pricing for in-app purchases.'
}

export default function SetIAPPricingPage() {
  return (
    <article className="prose prose-invert max-w-none">
      <h1 className="text-3xl font-bold text-white mb-4">set_iap_pricing</h1>
      <p className="text-xl text-white/60 mb-10 leading-relaxed">
        Set regional pricing for an in-app purchase using pricing strategies.
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
              <td className="px-4 py-3"><code className="text-purple-400">iapId</code></td>
              <td className="px-4 py-3"><code className="text-amber-400">string</code></td>
              <td className="px-4 py-3"><span className="text-red-400">Yes</span></td>
              <td className="px-4 py-3">The IAP ID to price</td>
            </tr>
            <tr className="border-b border-white/[0.05]">
              <td className="px-4 py-3"><code className="text-purple-400">basePricePointId</code></td>
              <td className="px-4 py-3"><code className="text-amber-400">string</code></td>
              <td className="px-4 py-3"><span className="text-red-400">Yes</span></td>
              <td className="px-4 py-3">Price value (e.g., &quot;9.99&quot;, &quot;59.99&quot;) or price point ID</td>
            </tr>
            <tr className="border-b border-white/[0.05]">
              <td className="px-4 py-3"><code className="text-purple-400">baseTerritory</code></td>
              <td className="px-4 py-3"><code className="text-amber-400">string</code></td>
              <td className="px-4 py-3"><span className="text-white/40">No</span></td>
              <td className="px-4 py-3">Base territory code (default: &quot;USA&quot;)</td>
            </tr>
            <tr>
              <td className="px-4 py-3"><code className="text-purple-400">strategy</code></td>
              <td className="px-4 py-3"><code className="text-amber-400">string</code></td>
              <td className="px-4 py-3"><span className="text-red-400">Yes</span></td>
              <td className="px-4 py-3">Pricing strategy: equalized, local_optimized, premium, emerging</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2 id="strategies" className="text-2xl font-bold text-white border-b border-white/[0.08] pb-3 mt-12">
        Pricing Strategies
      </h2>
      <div className="overflow-x-auto rounded-lg border border-white/[0.08] mt-6">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/[0.08] bg-white/[0.02]">
              <th className="px-4 py-3 text-left font-medium text-white/60">Strategy</th>
              <th className="px-4 py-3 text-left font-medium text-white/60">Description</th>
            </tr>
          </thead>
          <tbody className="text-white/70">
            <tr className="border-b border-white/[0.05]">
              <td className="px-4 py-3"><code>equalized</code></td>
              <td className="px-4 py-3">Apple&apos;s default equalized prices across regions</td>
            </tr>
            <tr className="border-b border-white/[0.05]">
              <td className="px-4 py-3"><code>local_optimized</code></td>
              <td className="px-4 py-3">Adjusted for local purchasing power</td>
            </tr>
            <tr className="border-b border-white/[0.05]">
              <td className="px-4 py-3"><code>premium</code></td>
              <td className="px-4 py-3">Higher prices in premium markets</td>
            </tr>
            <tr>
              <td className="px-4 py-3"><code>emerging</code></td>
              <td className="px-4 py-3">Lower prices in emerging markets</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2 id="example" className="text-2xl font-bold text-white border-b border-white/[0.08] pb-3 mt-12">
        Example Usage
      </h2>
      <CodeBlock
        code={`"Set the coins IAP price to $0.99"

"Price the premium subscription at tier 6 ($5.99)"

"Use emerging market pricing for the coin pack"`}
        language="text"
        title="Natural Language Prompts"
      />

      <h2 id="response" className="text-2xl font-bold text-white border-b border-white/[0.08] pb-3 mt-12">
        Response
      </h2>
      <CodeBlock
        code={`{
  "success": true,
  "preview": {
    "basePricePointId": "p1",
    "baseTerritory": "USA",
    "basePrice": "$0.99",
    "strategy": "equalized",
    "territories": {
      "USA": "$0.99",
      "GBR": "£0.79",
      "EUR": "€0.99",
      "JPN": "¥120"
    }
  }
}`}
        language="json"
      />

      <Callout type="tip" title="Preview First">
        <p>
          Use <code>preview_iap_pricing</code> to see how prices will look in all territories
          before applying them.
        </p>
      </Callout>

      <PrevNextNav />
    </article>
  )
}
