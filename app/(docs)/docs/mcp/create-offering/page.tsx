import { Metadata } from 'next'
import { CodeBlock, Callout, PrevNextNav } from '@/components/docs'

export const metadata: Metadata = {
  title: 'create_offering_with_products',
  description: 'MCP tool to create a complete RevenueCat offering with entitlements and packages.'
}

export default function CreateOfferingPage() {
  return (
    <article className="prose prose-invert max-w-none">
      <h1 className="text-3xl font-bold text-white mb-4">create_offering_with_products</h1>
      <p className="text-xl text-white/60 mb-10 leading-relaxed">
        Create a complete RevenueCat offering with entitlement and packages in one call.
        The fastest way to set up your RevenueCat paywall.
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
              <td className="px-4 py-3"><code className="text-purple-400">offeringKey</code></td>
              <td className="px-4 py-3"><code className="text-amber-400">string</code></td>
              <td className="px-4 py-3"><span className="text-red-400">Yes</span></td>
              <td className="px-4 py-3">Offering identifier (e.g., &quot;default&quot;)</td>
            </tr>
            <tr className="border-b border-white/[0.05]">
              <td className="px-4 py-3"><code className="text-purple-400">offeringName</code></td>
              <td className="px-4 py-3"><code className="text-amber-400">string</code></td>
              <td className="px-4 py-3"><span className="text-red-400">Yes</span></td>
              <td className="px-4 py-3">Offering display name</td>
            </tr>
            <tr className="border-b border-white/[0.05]">
              <td className="px-4 py-3"><code className="text-purple-400">entitlementKey</code></td>
              <td className="px-4 py-3"><code className="text-amber-400">string</code></td>
              <td className="px-4 py-3"><span className="text-red-400">Yes</span></td>
              <td className="px-4 py-3">Entitlement identifier (e.g., &quot;premium&quot;)</td>
            </tr>
            <tr className="border-b border-white/[0.05]">
              <td className="px-4 py-3"><code className="text-purple-400">entitlementName</code></td>
              <td className="px-4 py-3"><code className="text-amber-400">string</code></td>
              <td className="px-4 py-3"><span className="text-red-400">Yes</span></td>
              <td className="px-4 py-3">Entitlement display name</td>
            </tr>
            <tr className="border-b border-white/[0.05]">
              <td className="px-4 py-3"><code className="text-purple-400">products</code></td>
              <td className="px-4 py-3"><code className="text-amber-400">array</code></td>
              <td className="px-4 py-3"><span className="text-red-400">Yes</span></td>
              <td className="px-4 py-3">Products to include (see below)</td>
            </tr>
            <tr>
              <td className="px-4 py-3"><code className="text-purple-400">setAsCurrent</code></td>
              <td className="px-4 py-3"><code className="text-amber-400">boolean</code></td>
              <td className="px-4 py-3"><span className="text-white/40">No</span></td>
              <td className="px-4 py-3">Set as current/default offering (default: true)</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h3 className="text-lg font-semibold text-white mt-6 mb-3">Product Object</h3>
      <div className="overflow-x-auto rounded-lg border border-white/[0.08]">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/[0.08] bg-white/[0.02]">
              <th className="px-4 py-3 text-left font-medium text-white/60">Field</th>
              <th className="px-4 py-3 text-left font-medium text-white/60">Type</th>
              <th className="px-4 py-3 text-left font-medium text-white/60">Description</th>
            </tr>
          </thead>
          <tbody className="text-white/70">
            <tr className="border-b border-white/[0.05]">
              <td className="px-4 py-3"><code className="text-purple-400">productId</code></td>
              <td className="px-4 py-3"><code className="text-amber-400">string</code></td>
              <td className="px-4 py-3">RevenueCat product ID</td>
            </tr>
            <tr className="border-b border-white/[0.05]">
              <td className="px-4 py-3"><code className="text-purple-400">packageKey</code></td>
              <td className="px-4 py-3"><code className="text-amber-400">string</code></td>
              <td className="px-4 py-3">Package identifier (e.g., &quot;$rc_monthly&quot;)</td>
            </tr>
            <tr>
              <td className="px-4 py-3"><code className="text-purple-400">packageName</code></td>
              <td className="px-4 py-3"><code className="text-amber-400">string</code></td>
              <td className="px-4 py-3">Package display name</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2 id="example" className="text-2xl font-bold text-white border-b border-white/[0.08] pb-3 mt-12">
        Example Usage
      </h2>
      <CodeBlock
        code={`"Create a default offering with monthly and annual subscriptions"

"Set up RevenueCat with a premium entitlement and my products"

"Create an offering with monthly at $9.99 and annual at $79.99"`}
        language="text"
        title="Natural Language Prompts"
      />

      <h2 id="response" className="text-2xl font-bold text-white border-b border-white/[0.08] pb-3 mt-12">
        Response
      </h2>
      <CodeBlock
        code={`{
  "success": true,
  "entitlement": {
    "id": "ent_abc123",
    "lookup_key": "premium",
    "display_name": "Premium Access"
  },
  "offering": {
    "id": "off_xyz789",
    "lookup_key": "default",
    "display_name": "Default Offering",
    "is_current": true,
    "packages": [
      {
        "lookup_key": "$rc_monthly",
        "display_name": "Monthly",
        "product_id": "prod_monthly"
      },
      {
        "lookup_key": "$rc_annual",
        "display_name": "Annual",
        "product_id": "prod_annual"
      }
    ]
  }
}`}
        language="json"
      />

      <Callout type="tip" title="Standard Package Keys">
        <p>
          Use RevenueCat&apos;s standard package keys for automatic SDK handling:
          <code>$rc_monthly</code>, <code>$rc_annual</code>, <code>$rc_weekly</code>,
          <code>$rc_lifetime</code>.
        </p>
      </Callout>

      <PrevNextNav />
    </article>
  )
}
