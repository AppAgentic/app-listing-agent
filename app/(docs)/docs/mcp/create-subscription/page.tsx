import { Metadata } from 'next'
import { CodeBlock, Callout, PrevNextNav } from '@/components/docs'

export const metadata: Metadata = {
  title: 'create_subscription',
  description: 'MCP tool to create an auto-renewable subscription.'
}

export default function CreateSubscriptionPage() {
  return (
    <article className="prose prose-invert max-w-none">
      <h1 className="text-3xl font-bold text-white mb-4">create_subscription</h1>
      <p className="text-xl text-white/60 mb-10 leading-relaxed">
        Create an auto-renewable subscription within a subscription group.
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
              <td className="px-4 py-3"><code className="text-purple-400">groupId</code></td>
              <td className="px-4 py-3"><code className="text-amber-400">string</code></td>
              <td className="px-4 py-3"><span className="text-white/40">Conditional</span></td>
              <td className="px-4 py-3">Existing subscription group ID</td>
            </tr>
            <tr className="border-b border-white/[0.05]">
              <td className="px-4 py-3"><code className="text-purple-400">newGroupName</code></td>
              <td className="px-4 py-3"><code className="text-amber-400">string</code></td>
              <td className="px-4 py-3"><span className="text-white/40">Conditional</span></td>
              <td className="px-4 py-3">Create new group with this name</td>
            </tr>
            <tr className="border-b border-white/[0.05]">
              <td className="px-4 py-3"><code className="text-purple-400">productId</code></td>
              <td className="px-4 py-3"><code className="text-amber-400">string</code></td>
              <td className="px-4 py-3"><span className="text-red-400">Yes</span></td>
              <td className="px-4 py-3">Unique product ID</td>
            </tr>
            <tr className="border-b border-white/[0.05]">
              <td className="px-4 py-3"><code className="text-purple-400">name</code></td>
              <td className="px-4 py-3"><code className="text-amber-400">string</code></td>
              <td className="px-4 py-3"><span className="text-red-400">Yes</span></td>
              <td className="px-4 py-3">Reference name</td>
            </tr>
            <tr className="border-b border-white/[0.05]">
              <td className="px-4 py-3"><code className="text-purple-400">subscriptionPeriod</code></td>
              <td className="px-4 py-3"><code className="text-amber-400">string</code></td>
              <td className="px-4 py-3"><span className="text-red-400">Yes</span></td>
              <td className="px-4 py-3">ONE_WEEK, ONE_MONTH, TWO_MONTHS, THREE_MONTHS, SIX_MONTHS, ONE_YEAR</td>
            </tr>
            <tr className="border-b border-white/[0.05]">
              <td className="px-4 py-3"><code className="text-purple-400">groupLevel</code></td>
              <td className="px-4 py-3"><code className="text-amber-400">number</code></td>
              <td className="px-4 py-3"><span className="text-white/40">No</span></td>
              <td className="px-4 py-3">Service level (1 = highest tier, default: 1)</td>
            </tr>
            <tr>
              <td className="px-4 py-3"><code className="text-purple-400">familyShareable</code></td>
              <td className="px-4 py-3"><code className="text-amber-400">boolean</code></td>
              <td className="px-4 py-3"><span className="text-white/40">No</span></td>
              <td className="px-4 py-3">Enable family sharing (default: false)</td>
            </tr>
          </tbody>
        </table>
      </div>

      <Callout type="info" title="Subscription Groups">
        <p>
          Provide either <code>groupId</code> to add to an existing group, or <code>newGroupName</code> to create
          a new subscription group. Users can only have one active subscription per group.
        </p>
      </Callout>

      <h2 id="example" className="text-2xl font-bold text-white border-b border-white/[0.08] pb-3 mt-12">
        Example Usage
      </h2>
      <CodeBlock
        code={`"Create a monthly premium subscription at $9.99"

"Add an annual subscription to the Premium group"

"Create a new Pro subscription group with monthly and yearly options"`}
        language="text"
        title="Natural Language Prompts"
      />

      <h2 id="response" className="text-2xl font-bold text-white border-b border-white/[0.08] pb-3 mt-12">
        Response
      </h2>
      <CodeBlock
        code={`{
  "success": true,
  "group": {
    "id": "group_xyz",
    "referenceName": "Premium",
    "syncStatus": "pending_creation"
  },
  "subscription": {
    "id": "sub_abc123",
    "productId": "com.app.premium_monthly",
    "name": "Premium Monthly",
    "subscriptionPeriod": "ONE_MONTH",
    "groupLevel": 1,
    "syncStatus": "pending_creation"
  }
}`}
        language="json"
      />

      <PrevNextNav />
    </article>
  )
}
