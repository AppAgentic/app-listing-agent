import { Metadata } from 'next'
import Link from 'next/link'
import { ArrowRight, Book, Code, Cpu, Zap, Shield, Globe, Clock, Rocket, Palette, Camera } from 'lucide-react'
import { PrevNextNav } from '@/components/docs/prev-next-nav'
import { pageMetadata } from '@/lib/seo/site'

export const metadata: Metadata = pageMetadata({
  title: 'Documentation overview',
  description: 'Ship your app faster. Automate the last mile of app development with App Listing Agent.',
  path: '/docs',
  socialTitle: 'Documentation overview | App Listing Agent Docs',
})

const features = [
  {
    icon: Globe,
    title: 'Multi-Store Support',
    description: 'Manage both App Store Connect and Google Play Console from a single platform.'
  },
  {
    icon: Zap,
    title: 'AI Translation',
    description: 'Translate listing text into the locales App Store Connect and Google Play support.'
  },
  {
    icon: Camera,
    title: 'AI Screenshot Studio',
    description: 'Generate professional marketing screenshots from raw simulator captures.'
  },
  {
    icon: Palette,
    title: 'AI Icon Generator',
    description: 'Create app icons from a description or your listing, saved in iOS and Android sizes.'
  },
  {
    icon: Cpu,
    title: 'MCP Integration',
    description: 'Connect ChatGPT, Claude, Codex, Cursor and other MCP clients to your store workspace.'
  },
  {
    icon: Shield,
    title: 'Secure by Design',
    description: 'Store credentials are encrypted and entered in the browser, never in chat. Publishing needs your approval.'
  }
]

const quickLinks = [
  {
    title: 'Quick Start',
    description: 'Create a workspace and run your first readiness audit',
    href: '/docs/getting-started',
    icon: Zap
  },
  {
    title: 'Connect an AI agent',
    description: 'OAuth, one-time pairing or a scoped API key',
    href: '/docs/mcp/installation',
    icon: Cpu
  },
  {
    title: 'MCP Server',
    description: 'How agents work with App Listing Agent',
    href: '/docs/mcp',
    icon: Book
  },
  {
    title: 'Tool reference',
    description: 'All 55 MCP tools with their parameters',
    href: '/docs/mcp/tools',
    icon: Code
  }
]

export default function DocsIntroPage() {
  return (
    <article className="prose prose-invert max-w-none">
      {/* Hero */}
      <div className="not-prose mb-12">
        <div className="flex items-center gap-2 mb-4">
          <Rocket className="h-8 w-8 text-purple-400" />
          <span className="rounded-full bg-purple-500/20 px-3 py-1 text-sm text-purple-400">
            Ship Faster
          </span>
        </div>
        <h1 className="text-4xl font-bold text-white mb-4">
          App Listing Agent Documentation
        </h1>
        <p className="text-xl text-white/60 max-w-2xl">
          Automate the last mile of app development. Go from code complete to
          live on the stores faster than ever.
        </p>
      </div>

      {/* Quick Links */}
      <div className="not-prose grid gap-4 sm:grid-cols-2 mb-12">
        {quickLinks.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="group flex items-start gap-4 rounded-xl border border-white/[0.08] bg-white/[0.02] p-4 hover:bg-white/[0.05] transition-colors"
          >
            <div className="rounded-lg bg-purple-500/20 p-2">
              <link.icon className="h-5 w-5 text-purple-400" />
            </div>
            <div className="flex-1">
              <h3 className="font-medium text-white group-hover:text-purple-400 transition-colors">
                {link.title}
              </h3>
              <p className="text-sm text-white/50">{link.description}</p>
            </div>
            <ArrowRight className="h-5 w-5 text-white/30 group-hover:text-purple-400 transition-colors" />
          </Link>
        ))}
      </div>

      {/* The Last Mile Problem */}
      <div className="not-prose rounded-xl border border-purple-500/20 bg-purple-500/5 p-6 mb-12">
        <div className="flex items-start gap-4">
          <div className="rounded-lg bg-purple-500/20 p-2 shrink-0">
            <Clock className="h-6 w-6 text-purple-400" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-white mb-2">The Last Mile Problem</h3>
            <p className="text-white/70 leading-relaxed mb-4">
              Tools like Claude Code have made building apps faster than ever. But the final 20%
              often takes the longest: crafting compelling descriptions, optimizing for ASO,
              generating screenshots for every device size, translating metadata into many languages,
              creating localized screenshots, and designing app icons.
            </p>
            <p className="text-white/70 leading-relaxed">
              <strong className="text-white">App Listing Agent handles the last mile.</strong> Automate
              the tedious parts of app store management so you can ship faster and focus on what
              matters—building great products.
            </p>
          </div>
        </div>
      </div>

      {/* What is App Listing Agent */}
      <h2 id="what-is-applistingagent" className="text-2xl font-bold text-white border-b border-white/[0.08] pb-3 mt-12">
        What is App Listing Agent?
      </h2>
      <p className="text-white/70 mt-6 leading-relaxed">
        App Listing Agent is a workspace for preparing and shipping your app&apos;s listing on the
        App Store and Google Play. You can use it in two ways:
      </p>
      <ul className="text-white/70 mt-4 space-y-3">
        <li className="leading-relaxed">
          <strong className="text-white">MCP Server</strong> - 55 reviewed tools for onboarding and safe store operations with AI assistants
        </li>
        <li className="leading-relaxed">
          <strong className="text-white">Web Dashboard</strong> - Manage projects, credentials, approvals and assets in the browser
        </li>
      </ul>

      {/* Features */}
      <h2 id="key-features" className="text-2xl font-bold text-white border-b border-white/[0.08] pb-3 mt-14">
        Key Features
      </h2>
      <div className="not-prose grid gap-4 sm:grid-cols-2 mt-6">
        {features.map((feature) => (
          <div
            key={feature.title}
            className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-5"
          >
            <feature.icon className="h-6 w-6 text-purple-400 mb-3" />
            <h3 className="font-medium text-white mb-2">{feature.title}</h3>
            <p className="text-sm text-white/50 leading-relaxed">{feature.description}</p>
          </div>
        ))}
      </div>

      {/* Use Cases */}
      <h2 id="use-cases" className="text-2xl font-bold text-white border-b border-white/[0.08] pb-3 mt-14">
        Use Cases
      </h2>
      <div className="space-y-6 text-white/70 mt-6">
        <div>
          <h3 className="text-lg font-medium text-white mb-2">Launch readiness</h3>
          <p className="leading-relaxed">
            Run a read-only audit that lists what blocks your listing from launch and the next
            safe step for each blocker.
          </p>
        </div>
        <div>
          <h3 className="text-lg font-medium text-white mb-2">Localization</h3>
          <p className="leading-relaxed">
            Translate listing text and screenshot headlines into more locales, review the drafts,
            then upload them to the stores after you approve.
          </p>
        </div>
        <div>
          <h3 className="text-lg font-medium text-white mb-2">Agent-driven store work</h3>
          <p className="leading-relaxed">
            Ask your agent in plain language to draft descriptions, create screenshots and icons, or
            prepare custom product pages. Anything that changes a live listing waits for your approval.
          </p>
        </div>
      </div>

      {/* Getting Started */}
      <h2 id="getting-started" className="text-2xl font-bold text-white border-b border-white/[0.08] pb-3 mt-14">
        Getting Started
      </h2>
      <p className="text-white/70 mt-6 leading-relaxed">
        Ready to ship faster? Get started in minutes:
      </p>
      <ol className="text-white/70 mt-4 space-y-3">
        <li className="leading-relaxed">
          <Link href="/docs/getting-started" className="text-purple-400 hover:text-purple-300">
            Quick Start Guide
          </Link>{' '}
          — Create a workspace and choose your app
        </li>
        <li className="leading-relaxed">
          <Link href="/docs/mcp/installation" className="text-purple-400 hover:text-purple-300">
            Connect an AI agent
          </Link>{' '}
          — Pair your agent or add the MCP endpoint
        </li>
        <li className="leading-relaxed">
          <Link href="/docs/authentication" className="text-purple-400 hover:text-purple-300">
            Connect your stores
          </Link>{' '}
          — Add App Store Connect and Google Play credentials in the browser
        </li>
      </ol>

      {/* CTA */}
      <div className="not-prose mt-10 rounded-xl border border-white/[0.08] bg-gradient-to-r from-purple-500/10 to-transparent p-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold text-white">Ready to release faster?</h3>
            <p className="text-white/60 mt-1">
              Get from code complete to live on the stores in record time.
            </p>
          </div>
          <Link
            href="/docs/getting-started"
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-purple-500 px-5 py-2.5 text-sm font-medium text-white hover:bg-purple-400 transition-colors shrink-0"
          >
            Get Started
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>

      <PrevNextNav />
    </article>
  )
}
