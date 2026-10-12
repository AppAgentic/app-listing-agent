import { Metadata } from 'next'
import Link from 'next/link'
import { CodeBlock, Callout, PrevNextNav } from '@/components/docs'
import { pageMetadata } from '@/lib/seo/site'

export const metadata: Metadata = pageMetadata({
  title: 'Quick Start',
  description: 'Create an App Listing Agent workspace, connect an AI agent and run your first readiness audit.',
  path: '/docs/getting-started',
  socialTitle: 'Quick Start | App Listing Agent Docs',
})

export default function GettingStartedPage() {
  return (
    <article className="prose prose-invert max-w-none">
      <h1 className="text-3xl font-bold text-white mb-4">Quick Start</h1>
      <p className="text-xl text-white/60 mb-10 leading-relaxed">
        Create a workspace, connect your AI agent and get a first readiness audit for your app.
      </p>

      {/* Prerequisites */}
      <h2 id="prerequisites" className="text-2xl font-bold text-white border-b border-white/[0.08] pb-3 mt-10">
        Prerequisites
      </h2>
      <ul className="text-white/70 mt-4 space-y-2">
        <li>An App Listing Agent account</li>
        <li>An AI agent or client that supports remote MCP servers (for example ChatGPT, Claude, Codex or Cursor), or just a browser if you prefer the dashboard</li>
        <li>For store reads and uploads: an App Store Connect API key and/or a Google Play service account (see{' '}
          <Link href="/docs/authentication#store-credentials" className="text-purple-400 hover:text-purple-300">Store credentials</Link>)
        </li>
      </ul>

      {/* Step 1 */}
      <h2 id="step-1-account" className="text-2xl font-bold text-white border-b border-white/[0.08] pb-3 mt-12">
        Step 1: Create your workspace
      </h2>
      <p className="text-white/70 mt-6 leading-relaxed">
        <Link href="/login?mode=signup" className="text-purple-400 hover:text-purple-300">Sign up</Link>, then name
        your workspace. Choose <strong className="text-white">Connect my agent</strong> to continue with an AI agent,
        or <strong className="text-white">Use the dashboard without an agent</strong> to work in the browser.
      </p>

      {/* Step 2 */}
      <h2 id="step-2-connect" className="text-2xl font-bold text-white border-b border-white/[0.08] pb-3 mt-12">
        Step 2: Connect your agent
      </h2>
      <p className="text-white/70 mt-6 leading-relaxed">
        With <em>Connect my agent</em>, App Listing Agent shows a single-use pairing code (valid for 15 minutes) and a
        setup prompt. Copy the prompt into your agent. Alternatively, add the MCP endpoint directly in a client that
        supports OAuth:
      </p>
      <CodeBlock
        code="https://applistingagent.com/api/mcp"
        language="text"
        title="Remote MCP endpoint"
      />
      <p className="text-white/70 leading-relaxed">
        See <Link href="/docs/mcp/installation" className="text-purple-400 hover:text-purple-300">Connect an AI agent</Link>{' '}
        for every option.
      </p>

      {/* Step 3 */}
      <h2 id="step-3-app" className="text-2xl font-bold text-white border-b border-white/[0.08] pb-3 mt-12">
        Step 3: Choose your app and connect the stores
      </h2>
      <p className="text-white/70 mt-6 leading-relaxed">
        Your agent asks which app you want to get store-ready. It can import a live app, attach an existing store
        record, or start a local draft for an app that is not in a store yet. To connect App Store Connect or Google
        Play, the agent gives you a secure browser link; credentials are entered there, never in chat.
      </p>

      {/* Step 4 */}
      <h2 id="step-4-audit" className="text-2xl font-bold text-white border-b border-white/[0.08] pb-3 mt-12">
        Step 4: Run a readiness audit
      </h2>
      <p className="text-white/70 mt-6 leading-relaxed">Ask your agent:</p>
      <CodeBlock
        code="Is my app ready to submit? Show me the blockers and the next safe step."
        language="text"
      />
      <p className="text-white/70 leading-relaxed">
        The audit is read-only. It lists each blocker and whether draft work can continue before it is fixed.
      </p>

      {/* Step 5 */}
      <h2 id="step-5-work" className="text-2xl font-bold text-white border-b border-white/[0.08] pb-3 mt-12">
        Step 5: Draft, localize and publish
      </h2>
      <p className="text-white/70 mt-6 leading-relaxed">
        From here your agent can draft and translate listing text, create screenshots and icons, and prepare legal
        pages and custom store pages. Drafts are saved in App Listing Agent. Uploading to a store or publishing a
        public legal page always waits for your approval in App Listing Agent.
      </p>
      <Callout type="info" title="AI usage">
        <p>
          AI translation, screenshot, icon and text generation use your plan&apos;s allowance.
        </p>
      </Callout>

      {/* Next Steps */}
      <h2 id="next-steps" className="text-2xl font-bold text-white border-b border-white/[0.08] pb-3 mt-12">
        Next Steps
      </h2>
      <ul className="text-white/70 mt-6 space-y-3">
        <li className="leading-relaxed">
          <Link href="/docs/authentication" className="text-purple-400 hover:text-purple-300">Authentication</Link>{' '}
          — API keys, permissions and store credentials
        </li>
        <li className="leading-relaxed">
          <Link href="/docs/mcp/tools" className="text-purple-400 hover:text-purple-300">Tool reference</Link>{' '}
          — every MCP tool with its parameters
        </li>
        <li className="leading-relaxed">
          <Link href="/docs/guides/best-practices" className="text-purple-400 hover:text-purple-300">Best Practices</Link>{' '}
          — listing, screenshot and localization tips
        </li>
      </ul>

      <PrevNextNav />
    </article>
  )
}
