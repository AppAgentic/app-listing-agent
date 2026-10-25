import { Metadata } from 'next'
import Link from 'next/link'
import { Cpu, ArrowRight, Terminal, Zap, Shield, Globe } from 'lucide-react'
import { CodeBlock, Callout, PrevNextNav } from '@/components/docs'
import { pageMetadata } from '@/lib/seo/site'

export const metadata: Metadata = pageMetadata({
  title: 'MCP Server',
  description: 'Give MCP-compatible AI agents access to App Listing Agent store-launch tools.',
  path: '/docs/mcp',
  socialTitle: 'MCP Server | App Listing Agent Docs',
})

const mcpTools = [
  {
    name: 'run_store_readiness_audit',
    description: 'Check a project for launch blockers without changing anything',
    href: '/docs/mcp/tools#run_store_readiness_audit'
  },
  {
    name: 'translate_metadata',
    description: 'Translate listing fields into other locales with AI',
    href: '/docs/mcp/tools#translate_metadata'
  },
  {
    name: 'update_metadata',
    description: 'Save listing fields for one locale as a local draft',
    href: '/docs/mcp/tools#update_metadata'
  },
  {
    name: 'upload_app_store_metadata',
    description: 'Upload saved listing fields to App Store Connect (approval required)',
    href: '/docs/mcp/tools#upload_app_store_metadata'
  },
  {
    name: 'upload_google_play_metadata',
    description: 'Upload saved listing fields to Google Play Console (approval required)',
    href: '/docs/mcp/tools#upload_google_play_metadata'
  },
  {
    name: 'upload_metadata_to_both_stores',
    description: 'Upload saved listing fields to both stores (approval required)',
    href: '/docs/mcp/tools#upload_metadata_to_both_stores'
  },
  {
    name: 'generate_screenshot',
    description: 'Create one marketing screenshot from a raw app screenshot',
    href: '/docs/mcp/tools#generate_screenshot'
  },
  {
    name: 'generate_screenshot_set',
    description: 'Create a styled set of marketing screenshots as a background job',
    href: '/docs/mcp/tools#generate_screenshot_set'
  },
  {
    name: 'suggest_headlines',
    description: 'Suggest headline text for an existing screenshot',
    href: '/docs/mcp/tools#suggest_headlines'
  },
  {
    name: 'generate_icon',
    description: 'Create an app icon and save iOS and Android sizes',
    href: '/docs/mcp/tools#generate_icon'
  },
  {
    name: 'list_locales',
    description: 'List the locale codes each store supports',
    href: '/docs/mcp/tools#list_locales'
  },
  {
    name: 'check_project_configuration',
    description: 'List missing store identifiers, credentials or base listing fields',
    href: '/docs/mcp/tools#check_project_configuration'
  }
]

export default function MCPOverviewPage() {
  return (
    <article className="prose prose-invert max-w-none">
      <div className="not-prose mb-8">
        <div className="flex items-center gap-2 mb-4">
          <Cpu className="h-6 w-6 text-purple-400" />
          <span className="rounded-full bg-purple-500/20 px-3 py-1 text-sm text-purple-400" data-md-skip="">
            MCP Server
          </span>
        </div>
        <h1 className="text-3xl font-bold text-white mb-4">MCP Server</h1>
        <p className="text-xl text-white/60">
          Give Codex, Claude Code, Cursor, and other MCP-compatible AI agents the
          tools to prepare and ship your store presence.
        </p>
      </div>

      {/* What is MCP */}
      <h2 id="what-is-mcp" className="text-2xl font-bold text-white border-b border-white/[0.08] pb-3">
        What is MCP?
      </h2>
      <p className="text-white/70">
        The Model Context Protocol (MCP) is an open standard that lets AI agents such as
        ChatGPT, Claude, Codex, and Cursor use external tools and services. Our MCP server
        exposes a focused set of tools for metadata, screenshots, icons,
        localization, legal pages, and campaign-specific store pages.
      </p>

      <div className="not-prose grid gap-4 sm:grid-cols-3 my-8">
        <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4">
          <Zap className="h-6 w-6 text-purple-400 mb-3" />
          <h3 className="font-medium text-white mb-1">Natural Language</h3>
          <p className="text-sm text-white/50">
            Ask your agent to translate your app or generate screenshots
          </p>
        </div>
        <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4">
          <Shield className="h-6 w-6 text-purple-400 mb-3" />
          <h3 className="font-medium text-white mb-1">Secure</h3>
          <p className="text-sm text-white/50">
            Project-scoped OAuth; store credentials never pass through chat
          </p>
        </div>
        <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4">
          <Globe className="h-6 w-6 text-purple-400 mb-3" />
          <h3 className="font-medium text-white mb-1">Focused launch tools</h3>
          <p className="text-sm text-white/50">
            55 reviewed tools for creating and shipping store assets
          </p>
        </div>
      </div>

      {/* Connection */}
      <h2 id="installation" className="text-2xl font-bold text-white border-b border-white/[0.08] pb-3">
        Remote connection
      </h2>
      <p className="text-white/70">
        App Listing Agent is hosted. Add its HTTPS endpoint to a remote-MCP client; no npm package or local process is required.
      </p>
      <CodeBlock
        code="https://applistingagent.com/api/mcp"
        language="text"
        title="Streamable HTTP"
      />

      {/* Configuration */}
      <h2 id="configuration" className="text-2xl font-bold text-white border-b border-white/[0.08] pb-3">
        Configuration
      </h2>
      <p className="text-white/70">
        OAuth-capable clients open a browser authorization flow. Existing scoped API keys can use this generic remote-server configuration:
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
        title="Remote MCP configuration"
      />

      <Callout type="info" title="Use the least authority">
        <p>
          OAuth connections select one app workspace and an authority level. Start with review-only or draft access; publishing always requires a separate human approval.
        </p>
      </Callout>

      {/* Usage */}
      <h2 id="usage" className="text-2xl font-bold text-white border-b border-white/[0.08] pb-3">
        Usage
      </h2>
      <p className="text-white/70">
        Once connected, ask your agent for store work in plain language. Read-only audits
        run immediately; anything that would change a live listing waits for your approval.
      </p>
      <CodeBlock
        code={`User: Is Atlas Habit ready to submit to the App Store?

Agent: I'll run a read-only readiness audit and show the result inline.

[Uses run_store_readiness_audit, then show_readiness_report]

Atlas Habit has 3 blockers. The first one to fix: App Store Connect is
not connected. Drafting can continue safely; publishing will wait for
your approval. Want me to walk through the first blocker?`}
        language="text"
        title="Example Conversation"
      />

      {/* Available Tools */}
      <h2 id="tools" className="text-2xl font-bold text-white border-b border-white/[0.08] pb-3">
        Available Tools
      </h2>
      <p className="text-white/70">
        Standard accounts can use 55 tools organized around the store-launch workflow. A few common ones are
        below; the{' '}
        <Link href="/docs/mcp/tools" className="text-purple-400 hover:text-purple-300">
          tool reference
        </Link>{' '}
        lists every tool with its parameters, required key scope and approval rule.
      </p>

      <h3 className="text-lg font-semibold text-white mt-6 mb-3">Common tools</h3>
      <div className="not-prose grid gap-2">
        {mcpTools.map((tool) => (
          <Link
            key={tool.name}
            href={tool.href}
            className="group flex items-center gap-4 rounded-lg border border-white/[0.08] bg-white/[0.02] px-4 py-3 hover:bg-white/[0.05] transition-colors"
          >
            <Terminal className="h-5 w-5 text-purple-400 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <code className="text-purple-400">{tool.name}</code>
              <p className="text-sm text-white/50 truncate">{tool.description}</p>
            </div>
            <ArrowRight className="h-4 w-4 text-white/30 group-hover:text-purple-400 transition-colors flex-shrink-0" />
          </Link>
        ))}
      </div>

      {/* Security */}
      <h2 id="security" className="text-2xl font-bold text-white border-b border-white/[0.08] pb-3">
        Security
      </h2>
      <p className="text-white/70">
        Every request to the MCP server is:
      </p>
      <ul className="mt-4 list-disc space-y-2 pl-5 text-white/70 marker:text-white/30">
        <li>Authenticated with project-scoped OAuth or a scoped API key</li>
        <li>Encrypted in transit (HTTPS)</li>
        <li>Pseudonymous security telemetry without prompts or credentials</li>
        <li>Rate limited by network and account</li>
      </ul>
      <Callout type="warning" title="Credential security">
        <p>
          Prefer OAuth or the one-time pairing flow. If an existing client uses an API
          key, keep it in that client&apos;s secret store and never commit it to a repository.
        </p>
      </Callout>

      <PrevNextNav />
    </article>
  )
}
