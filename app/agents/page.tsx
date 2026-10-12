import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { ArrowRight, Bot, Braces, Check, LockKeyhole } from 'lucide-react'
import { PUBLIC_CAPABILITIES } from '@/lib/mcp/public-capabilities'
import { TrackedFunnelLink } from '@/components/concierge/booking-link'
import { pageMetadata } from '@/lib/seo/site'

export const metadata: Metadata = pageMetadata({
  title: 'For AI agents',
  description: 'Discover, connect, and safely operate App Store Connect and Google Play through App Listing Agent.',
  path: '/agents',
})

const groups = [
  ['Onboard', 'Connect live, unpublished, or pre-store apps and produce a readiness audit.'],
  ['Create', 'Draft metadata, screenshots, icons, legal copy, and campaign-specific store pages.'],
  ['Ship', 'Preview changes, request human approval, then publish through scoped store credentials.'],
] as const

export default function AgentsPage() {
  return (
    <main className="min-h-screen bg-[#070807] text-[#f4f4ef] selection:bg-violet-600 selection:text-white">
      <nav className="mx-auto flex max-w-7xl items-center justify-between px-6 py-6 lg:px-10">
        <Link href="/" className="flex items-center gap-3 text-sm font-semibold tracking-tight">
          <Image src="/copilot-icon.png" width={38} height={38} alt="" className="h-9 w-9 object-contain" />
          App Listing Agent
        </Link>
        <div className="flex items-center gap-5 text-sm text-white/65">
          <Link href="/docs/mcp" className="transition-colors hover:text-white">Docs</Link>
          <Link href="/use-cases/app-store-connect-mcp-server" className="transition-colors hover:text-white">MCP use case</Link>
          <TrackedFunnelLink source="agents_nav" href="/login?mode=signup&source=agents_nav" className="rounded-full border border-white/20 px-4 py-2 text-white transition-colors hover:border-white/45">Connect</TrackedFunnelLink>
        </div>
      </nav>

      <section className="relative mx-auto grid min-h-[72svh] max-w-7xl content-center overflow-hidden px-6 py-24 lg:px-10">
        <div className="pointer-events-none absolute right-[-12%] top-[8%] h-[32rem] w-[32rem] rounded-full border border-violet-500/25 bg-violet-500/[0.06] blur-sm" />
        <p className="mb-7 flex items-center gap-2 font-mono text-xs uppercase tracking-[0.22em] text-violet-400">
          <Bot className="h-4 w-4" /> Built for agents. Governed by people.
        </p>
        <h1 className="max-w-5xl font-[family-name:var(--font-brand)] text-6xl font-medium leading-[0.94] tracking-[-0.055em] sm:text-7xl lg:text-[7.4rem]">
          Take an app from draft to store.
        </h1>
        <p className="mt-9 max-w-2xl text-lg leading-8 text-white/58 sm:text-xl">
          A discoverable, project-scoped operating layer for App Store Connect and Google Play—with explicit approval before anything goes live.
        </p>
        <div className="mt-10 flex flex-wrap gap-3">
          <TrackedFunnelLink source="agents_hero" href="/login?mode=signup&source=agents_hero" className="group inline-flex items-center gap-3 rounded-full bg-violet-600 px-6 py-3.5 text-sm font-semibold text-white hover:bg-violet-500 transition-transform hover:-translate-y-0.5">
            Pair your agent <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
          </TrackedFunnelLink>
          <a href="/.well-known/applistingagent-capabilities" className="inline-flex items-center gap-3 rounded-full border border-white/20 px-6 py-3.5 font-mono text-xs text-white/75 transition-colors hover:border-white/45 hover:text-white">
            <Braces className="h-4 w-4" /> Capability manifest
          </a>
        </div>
      </section>

      <section className="border-y border-white/10 bg-white/[0.025]">
        <div className="mx-auto grid max-w-7xl divide-y divide-white/10 px-6 lg:grid-cols-3 lg:divide-x lg:divide-y-0 lg:px-10">
          {groups.map(([title, copy], index) => (
            <article key={title} className="py-12 lg:px-10 lg:first:pl-0">
              <span className="font-mono text-xs text-violet-400">0{index + 1}</span>
              <h2 className="mt-8 text-2xl font-semibold tracking-tight">{title}</h2>
              <p className="mt-3 max-w-sm leading-7 text-white/52">{copy}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="claude" aria-labelledby="claude-heading" className="mx-auto max-w-7xl scroll-mt-8 px-6 py-20 lg:px-10">
        <p className="font-mono text-xs uppercase tracking-[0.22em] text-violet-400">Connect with Claude</p>
        <h2 id="claude-heading" className="mt-5 text-4xl font-medium tracking-tight">Prepare your listing with Claude.</h2>
        <p className="mt-6 max-w-3xl leading-7 text-white/70">
          Review launch readiness, draft and translate listing text, and view or organize existing screenshots and icons.
          Review the exact text before saving. Live store updates require a connected store and your approval in App Listing Agent.
          The Claude connector does not generate or edit images with AI.
        </p>
        <ol className="mt-8 max-w-3xl list-decimal space-y-4 pl-6 leading-7 text-white/80">
          <li>Create an App Listing Agent account or sign in, and select an existing app project. An app without a store record can still have a local draft.</li>
          <li>In Claude, open Settings → Connectors and add a custom connector named App Listing Agent.</li>
          <li>Enter this remote MCP server URL:
            <code className="mt-2 block break-all rounded-lg border border-white/15 bg-white/5 p-4 text-sm text-white">https://applistingagent.com/api/mcp/claude</code>
          </li>
          <li>Connect and complete the App Listing Agent sign-in. Choose the app and access level you want Claude to use. Keep passwords and store credentials in the secure sign-in flow.</li>
          <li>Start a new Claude conversation with the connector enabled. Ask: “Show my app’s launch readiness. Do not publish anything.”</li>
        </ol>
        <p className="mt-6 max-w-3xl leading-7 text-white/70">
          To localize a listing, ask for a preview of the app name and subtitle in your chosen language, then approve the fields you want saved.
          Translation and other AI text checks may use your plan allowance. To review artwork without generating anything, ask: “Show my app’s saved screenshots.”
        </p>
        <p className="mt-4 max-w-3xl leading-7 text-white/70">
          If the app or permissions are incorrect, reconnect and choose the intended project. You can revoke OAuth agent access in App Listing Agent Settings;
          this revokes all OAuth agent connections for your account. Contact <Link href="/contact" className="underline underline-offset-4">support</Link> if a connection needs help.
        </p>
        <p className="mt-4 max-w-3xl leading-7 text-white/70">
          For ChatGPT and other agents, follow the existing <Link href="/docs/mcp" className="underline underline-offset-4">MCP setup guide</Link>.
          The Claude connection has its own URL and available tools.
        </p>
      </section>

      <section className="mx-auto grid max-w-7xl gap-16 px-6 py-28 lg:grid-cols-[0.8fr_1.2fr] lg:px-10 lg:py-40">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.22em] text-violet-400">Public contract</p>
          <h2 className="mt-6 max-w-md text-4xl font-medium tracking-[-0.035em] sm:text-5xl">Clear capabilities for each connection.</h2>
          <p className="mt-6 max-w-md leading-7 text-white/52">The public capability manifest describes the full integration. The tools available to a connection depend on its setup, selected project and permissions. Claude supports listing text and existing artwork.</p>
        </div>
        <div className="border-t border-white/15">
          {[
            ['Full integration tools', `${PUBLIC_CAPABILITIES.length}`],
            ['Credential handling', 'Secure handoff only'],
            ['Publishing', 'Human approval'],
            ['Project boundary', 'Enforced'],
            ['External content', 'Untrusted data'],
          ].map(([label, value]) => (
            <div key={label} className="flex items-center justify-between border-b border-white/10 py-6">
              <span className="text-white/48">{label}</span>
              <span className="flex items-center gap-2 text-sm font-medium"><Check className="h-4 w-4 text-violet-400" />{value}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="border-t border-white/10 px-6 py-24 lg:px-10">
        <div className="mx-auto flex max-w-7xl flex-col justify-between gap-10 lg:flex-row lg:items-end">
          <div>
            <LockKeyhole className="h-7 w-7 text-violet-400" />
            <h2 className="mt-6 max-w-2xl text-4xl font-medium tracking-[-0.04em] sm:text-6xl">Your agent gets a job. Not the keys to everything.</h2>
          </div>
          <div className="max-w-sm">
            <p className="leading-7 text-white/52">Start with a one-time pairing code or scoped OAuth. Grant only the project and abilities the agent needs. Store content is treated as untrusted data, and every live-store change waits for your approval.</p>
            <Link href="/docs/mcp" className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-violet-400">Read the agent setup guide <ArrowRight className="h-4 w-4" /></Link>
          </div>
        </div>
      </section>
    </main>
  )
}
