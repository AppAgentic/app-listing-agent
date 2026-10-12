import { Metadata } from 'next'
import Link from 'next/link'
import { CodeBlock, Callout, PrevNextNav } from '@/components/docs'
import { pageMetadata } from '@/lib/seo/site'

export const metadata: Metadata = pageMetadata({
  title: 'Authentication',
  description: 'How AI agents authenticate with App Listing Agent and how store credentials are connected.',
  path: '/docs/authentication',
  socialTitle: 'Authentication | App Listing Agent Docs',
})

export default function AuthenticationPage() {
  return (
    <article className="prose prose-invert max-w-none">
      <h1 className="text-3xl font-bold text-white mb-4">Authentication</h1>
      <p className="text-xl text-white/60 mb-8">
        How an AI agent connects to App Listing Agent, and how App Store Connect and Google Play credentials are added.
      </p>

      <Callout type="info" title="MCP is the supported programmatic interface">
        <p>
          App Listing Agent does not offer a public REST API, CLI or SDK. Agents and scripts use the
          MCP server at <code>https://applistingagent.com/api/mcp</code>. The routes under{' '}
          <code>/api</code> serve the web dashboard and are not a documented, stable contract.
        </p>
      </Callout>

      {/* Ways to connect */}
      <h2 id="agent-access" className="text-2xl font-bold text-white border-b border-white/[0.08] pb-3">
        Connecting an agent
      </h2>
      <p className="text-white/70">There are three ways to authorize an agent:</p>
      <ul className="text-white/70">
        <li>
          <strong className="text-white">OAuth</strong> — clients that support remote-MCP OAuth open a browser sign-in.
          You choose one app workspace and the authority the agent gets.
        </li>
        <li>
          <strong className="text-white">One-time pairing</strong> — during onboarding, choose <em>Connect my agent</em>.
          App Listing Agent shows a single-use code that expires after 15 minutes and a setup prompt to paste into your
          agent. The agent exchanges the code for a scoped key.
        </li>
        <li>
          <strong className="text-white">Scoped API key</strong> — create a key yourself and add it to your MCP client
          configuration.
        </li>
      </ul>
      <p className="text-white/70">
        Step-by-step instructions are in{' '}
        <Link href="/docs/mcp/installation" className="text-purple-400 hover:text-purple-300">Connect an AI agent</Link>.
      </p>

      {/* API Keys */}
      <h2 id="api-keys" className="text-2xl font-bold text-white border-b border-white/[0.08] pb-3">
        API keys
      </h2>
      <p className="text-white/70">
        API keys are available on the Pro, Studio and Enterprise plans. In an organization, only admins and owners can
        create them.
      </p>

      <h3 id="creating-api-key" className="text-xl font-semibold text-white">
        Creating a key
      </h3>
      <ol className="text-white/70">
        <li>Open <strong className="text-white">Settings</strong> in the dashboard and find <strong className="text-white">Agent &amp; API Keys</strong>.</li>
        <li>Give the key a name and choose its permissions.</li>
        <li>Optionally set an expiry of 1 to 365 days.</li>
        <li>Copy the key when it is shown. It starts with <code>asc_live_</code> and is not shown again.</li>
      </ol>
      <p className="text-white/70">You can revoke a key from the same screen at any time.</p>

      <h3 id="scopes" className="text-xl font-semibold text-white">
        Permissions
      </h3>
      <p className="text-white/70">
        A key only lists and runs the MCP tools its permissions allow. The{' '}
        <Link href="/docs/mcp/tools" className="text-purple-400 hover:text-purple-300">tool reference</Link>{' '}
        shows the permission each tool needs.
      </p>
      <div className="not-prose overflow-x-auto rounded-lg border border-white/[0.08] my-6">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/[0.08] bg-white/[0.02]">
              <th className="px-4 py-3 text-left font-medium text-white/60">Permission</th>
              <th className="px-4 py-3 text-left font-medium text-white/60">Allows</th>
            </tr>
          </thead>
          <tbody className="text-white/70">
            <tr className="border-b border-white/[0.05]">
              <td className="px-4 py-3"><code className="text-purple-400">read</code></td>
              <td className="px-4 py-3">Read project data, metadata, screenshots and legal documents</td>
            </tr>
            <tr className="border-b border-white/[0.05]">
              <td className="px-4 py-3"><code className="text-purple-400">write</code></td>
              <td className="px-4 py-3">Change project data and local drafts</td>
            </tr>
            <tr className="border-b border-white/[0.05]">
              <td className="px-4 py-3"><code className="text-purple-400">translate</code></td>
              <td className="px-4 py-3">Use AI translation</td>
            </tr>
            <tr className="border-b border-white/[0.05]">
              <td className="px-4 py-3"><code className="text-purple-400">screenshots</code></td>
              <td className="px-4 py-3">Create and change screenshots, graphics and icons</td>
            </tr>
            <tr className="border-b border-white/[0.05]">
              <td className="px-4 py-3"><code className="text-purple-400">publish</code></td>
              <td className="px-4 py-3">Request store uploads and public legal-page changes (each still needs your approval)</td>
            </tr>
            <tr>
              <td className="px-4 py-3"><code className="text-purple-400">all</code></td>
              <td className="px-4 py-3">Every tool available to your account</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h3 id="using-api-key" className="text-xl font-semibold text-white">
        Using a key
      </h3>
      <p className="text-white/70">
        Send the key as a bearer token in your MCP client configuration:
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
      <Callout type="warning" title="Keep your key secret">
        <p>
          Store the key in your client&apos;s secret store or an environment variable. Never commit it to a
          repository or paste it into a chat.
        </p>
      </Callout>

      {/* Store Credentials */}
      <h2 id="store-credentials" className="text-2xl font-bold text-white border-b border-white/[0.08] pb-3">
        Store credentials
      </h2>
      <p className="text-white/70">
        Reading from and uploading to the stores needs App Store Connect and/or Google Play credentials. Add them in the
        browser: <strong className="text-white">Settings → Store Credentials</strong>, or the secure link an agent gets
        from <code>get_store_connection_link</code>. They are never entered in chat.
      </p>

      <h3 id="app-store-connect" className="text-xl font-semibold text-white">
        App Store Connect
      </h3>
      <p className="text-white/70">
        You need an App Store Connect API key:
      </p>
      <ul className="text-white/70">
        <li><strong className="text-white">Issuer ID</strong> — shown in Users and Access → Integrations → App Store Connect API</li>
        <li><strong className="text-white">Key ID</strong> — the identifier of your API key</li>
        <li><strong className="text-white">Private key</strong> — the contents of the downloaded <code>.p8</code> file</li>
      </ul>
      <Callout type="info" title="Creating an App Store Connect API key">
        <p>
          In App Store Connect, open Users and Access → Integrations → App Store Connect API and create a team key
          with the Admin or App Manager role.
        </p>
      </Callout>

      <h3 id="google-play-console" className="text-xl font-semibold text-white">
        Google Play Console
      </h3>
      <p className="text-white/70">
        You need a Google Cloud service account with Play Console access:
      </p>
      <ol className="text-white/70">
        <li>Enable the <a href="https://console.cloud.google.com/apis/api/androidpublisher.googleapis.com/" target="_blank" rel="noopener noreferrer" className="text-purple-400 hover:underline">Google Play Android Developer API</a> in Google Cloud Console</li>
        <li>Create a <a href="https://console.cloud.google.com/iam-admin/serviceaccounts" target="_blank" rel="noopener noreferrer" className="text-purple-400 hover:underline">service account</a> (no Google Cloud roles needed)</li>
        <li>Open the account → Keys → Add key → Create new key → JSON, and download it</li>
        <li>In <a href="https://play.google.com/console/users-and-permissions" target="_blank" rel="noopener noreferrer" className="text-purple-400 hover:underline">Google Play Console → Users and permissions</a>, invite the service account email with <strong className="text-white">Admin</strong> access</li>
      </ol>
      <Callout type="warning" title="Activation delay">
        <p>
          New service account credentials can take up to 36 hours to start working with the Google Play Developer API.
        </p>
      </Callout>

      <h3 id="encryption" className="text-xl font-semibold text-white">
        How credentials are stored
      </h3>
      <p className="text-white/70">
        Store credentials are encrypted with AES-256-GCM before they are saved, using a data key that is itself
        encrypted with Google Cloud KMS. They are never stored in plain text and are not returned to agents.
      </p>

      <PrevNextNav />
    </article>
  )
}
