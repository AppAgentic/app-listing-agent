import { Metadata } from 'next'
import { CodeBlock, Callout, PrevNextNav } from '@/components/docs'

export const metadata: Metadata = {
  title: 'create_revenuecat_app',
  description: 'MCP tool to create a new app in RevenueCat.'
}

export default function CreateRevenueCatAppPage() {
  return (
    <article className="prose prose-invert max-w-none">
      <h1 className="text-3xl font-bold text-white mb-4">create_revenuecat_app</h1>
      <p className="text-xl text-white/60 mb-10 leading-relaxed">
        Create a new app in RevenueCat for iOS (App Store) or Android (Play Store).
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
              <td className="px-4 py-3"><code className="text-purple-400">name</code></td>
              <td className="px-4 py-3"><code className="text-amber-400">string</code></td>
              <td className="px-4 py-3"><span className="text-red-400">Yes</span></td>
              <td className="px-4 py-3">App name (e.g., &quot;My App (iOS)&quot;)</td>
            </tr>
            <tr className="border-b border-white/[0.05]">
              <td className="px-4 py-3"><code className="text-purple-400">type</code></td>
              <td className="px-4 py-3"><code className="text-amber-400">string</code></td>
              <td className="px-4 py-3"><span className="text-red-400">Yes</span></td>
              <td className="px-4 py-3">&quot;app_store&quot;, &quot;play_store&quot;, or &quot;amazon&quot;</td>
            </tr>
            <tr className="border-b border-white/[0.05]">
              <td className="px-4 py-3"><code className="text-purple-400">bundleId</code></td>
              <td className="px-4 py-3"><code className="text-amber-400">string</code></td>
              <td className="px-4 py-3"><span className="text-white/40">Conditional</span></td>
              <td className="px-4 py-3">iOS bundle identifier (required for app_store)</td>
            </tr>
            <tr>
              <td className="px-4 py-3"><code className="text-purple-400">packageName</code></td>
              <td className="px-4 py-3"><code className="text-amber-400">string</code></td>
              <td className="px-4 py-3"><span className="text-white/40">Conditional</span></td>
              <td className="px-4 py-3">Android package name (required for play_store)</td>
            </tr>
          </tbody>
        </table>
      </div>

      <Callout type="info" title="Automatic Credentials">
        <p>
          For iOS apps, your App Store Connect credentials (private key, key ID, issuer ID) are
          automatically passed to RevenueCat for receipt validation.
        </p>
      </Callout>

      <h2 id="example" className="text-2xl font-bold text-white border-b border-white/[0.08] pb-3 mt-12">
        Example Usage
      </h2>
      <CodeBlock
        code={`"Create a RevenueCat app for iOS"

"Add my Android app to RevenueCat"

"Set up RevenueCat for com.mycompany.myapp"`}
        language="text"
        title="Natural Language Prompts"
      />

      <h2 id="response" className="text-2xl font-bold text-white border-b border-white/[0.08] pb-3 mt-12">
        Response
      </h2>
      <CodeBlock
        code={`{
  "success": true,
  "app": {
    "id": "app_abc123",
    "name": "My App (iOS)",
    "type": "app_store",
    "bundle_id": "com.mycompany.myapp",
    "created_at": "2024-01-15T10:30:00Z"
  }
}`}
        language="json"
      />

      <PrevNextNav />
    </article>
  )
}
