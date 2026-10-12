import { Metadata } from 'next'
import { Callout, CodeBlock, PrevNextNav } from '@/components/docs'
import { pageMetadata } from '@/lib/seo/site'

export const metadata: Metadata = pageMetadata({
  title: 'Connect an AI agent',
  description: 'Connect ChatGPT, Claude, Codex, Cursor, or another remote-MCP client to App Listing Agent.',
  path: '/docs/mcp/installation',
  socialTitle: 'Connect an AI agent | App Listing Agent Docs',
})

export default function MCPInstallationPage() {
  return (
    <article className="prose prose-invert max-w-none">
      <h1 className="mb-4 text-3xl font-bold text-white">Connect an AI agent</h1>
      <p className="mb-10 text-xl leading-relaxed text-white/60">
        App Listing Agent is a hosted remote MCP server. There is no package to install
        and no local process to keep running.
      </p>

      <h2 id="endpoint" className="mt-10 border-b border-white/[0.08] pb-3 text-2xl font-bold text-white">
        Remote MCP endpoint
      </h2>
      <CodeBlock
        code="https://applistingagent.com/api/mcp"
        language="text"
        title="HTTPS · Streamable HTTP"
      />
      <p className="mt-6 leading-relaxed text-white/70">
        Add that URL in ChatGPT, Claude, Codex, Cursor, or another client that supports
        remote MCP servers. When OAuth is offered, choose <strong>Connect</strong> and
        sign in to App Listing Agent in the browser. You will select one app workspace and
        the least authority the agent needs.
      </p>

      <h2 id="pairing" className="mt-12 border-b border-white/[0.08] pb-3 text-2xl font-bold text-white">
        Secure one-time pairing
      </h2>
      <p className="mt-6 leading-relaxed text-white/70">
        From a new App Listing Agent workspace, choose the agent-guided setup path. The
        product creates a single-use pairing code that expires after 15 minutes. Paste
        the provided setup prompt into your agent; it exchanges the code for a scoped
        key and never asks you to put App Store Connect or Google Play private
        credentials in chat.
      </p>
      <Callout type="warning" title="Keep credentials out of chat">
        <p>
          Store private keys, Google service-account JSON, API keys, and pairing codes
          belong only in App Listing Agent&apos;s secure browser handoff or your local secret
          store. App Listing Agent will never ask an agent to reveal them.
        </p>
      </Callout>

      <h2 id="api-key" className="mt-12 border-b border-white/[0.08] pb-3 text-2xl font-bold text-white">
        Existing API-key connections
      </h2>
      <p className="mt-6 leading-relaxed text-white/70">
        Existing accounts can continue to configure a remote client with a scoped
        App Listing Agent key. Keep the key in the client&apos;s secret store rather than in a
        repository or shared configuration file.
      </p>
      <CodeBlock
        code={`{
  "mcpServers": {
    "applistingagent": {
      "url": "https://applistingagent.com/api/mcp",
      "headers": {
        "Authorization": "Bearer <ASC_API_KEY>"
      }
    }
  }
}`}
        language="json"
        title="Generic remote MCP configuration"
      />

      <h2 id="verify" className="mt-12 border-b border-white/[0.08] pb-3 text-2xl font-bold text-white">
        Verify the connection
      </h2>
      <p className="mt-6 leading-relaxed text-white/70">Ask your agent:</p>
      <CodeBlock
        code="Show my App Listing Agent onboarding status and the next safe action."
        language="text"
      />
      <p className="mt-4 leading-relaxed text-white/70">
        A normal end-user account exposes 55 reviewed launch tools. The exact list is
        filtered by the connection&apos;s scope; internal billing, support, analytics,
        experiments, Firebase administration, RevenueCat, and AppStoreSpy tools are not
        available to ordinary users.
      </p>

      <h2 id="troubleshooting" className="mt-12 border-b border-white/[0.08] pb-3 text-2xl font-bold text-white">
        Troubleshooting
      </h2>
      <div className="mt-6 space-y-6">
        <div>
          <h3 className="mb-2 text-lg font-semibold text-white">The client asks you to sign in</h3>
          <p className="leading-relaxed text-white/70">
            Complete the browser authorization and select the intended app workspace.
            The client should reconnect automatically after consent.
          </p>
        </div>
        <div>
          <h3 className="mb-2 text-lg font-semibold text-white">A tool is missing</h3>
          <p className="leading-relaxed text-white/70">
            Tool discovery is scope-aware. Reconnect with the required authority, or use
            the dashboard if the operation is intentionally human-only.
          </p>
        </div>
        <div>
          <h3 className="mb-2 text-lg font-semibold text-white">The server returns 429</h3>
          <p className="leading-relaxed text-white/70">
            Respect the Retry-After header before retrying. Reuse the same idempotency key
            for a retryable write so a network retry cannot duplicate work.
          </p>
        </div>
      </div>

      <PrevNextNav />
    </article>
  )
}
