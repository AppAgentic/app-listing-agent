import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { ArrowRight, ShieldCheck } from 'lucide-react'
import { describeOAuthError } from '@/lib/auth/oauth-error'

export const metadata: Metadata = {
  title: 'Connection failed | App Listing Agent',
  robots: { index: false, follow: false },
}

type SearchParams = Record<string, string | string[] | undefined>

export default async function OAuthErrorPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const view = describeOAuthError(await searchParams)

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#070807] px-6 py-16 text-[#f4f4ef] selection:bg-violet-600 selection:text-white">
      <div className="w-full max-w-md">
        <Link href="/" className="inline-flex items-center gap-3 text-sm font-semibold tracking-tight">
          <Image src="/copilot-icon.png" width={36} height={36} alt="" className="h-9 w-9 object-contain" />
          App Listing Agent
        </Link>

        <p className="mt-10 font-mono text-xs uppercase tracking-[0.22em] text-violet-400">Connection failed</p>
        <h1 tabIndex={-1} autoFocus className="mt-4 text-balance text-3xl font-semibold tracking-tight outline-none sm:text-4xl">
          {view.title}
        </h1>
        <p className="mt-5 text-pretty leading-7 text-white/70">{view.explanation}</p>
        <p className="mt-3 text-pretty leading-7 text-white/70">{view.whatToDo}</p>

        <p className="mt-6 flex items-start gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm leading-6 text-white/60">
          <ShieldCheck className="mt-0.5 h-4 w-4 flex-none text-violet-400" aria-hidden="true" />
          <span>Nothing was shared. No store credentials or project access were granted to the agent.</span>
        </p>

        <div className="mt-8 flex flex-wrap items-center gap-3">
          {view.primary && (
            <Link
              href={view.primary.href}
              className="inline-flex min-h-11 items-center gap-2 rounded-full bg-violet-600 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-violet-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-400"
            >
              {view.primary.label}
            </Link>
          )}
          <Link
            href="/docs/mcp"
            className="inline-flex min-h-11 items-center gap-2 rounded-full border border-white/20 px-5 py-3 text-sm font-medium text-white/85 transition-colors hover:border-white/45 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-400"
          >
            Setup guide <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>

        <p className="mt-10 font-mono text-[11px] text-white/35">
          Error: {view.code}
          <span className="sr-only">. </span>
          <span aria-hidden="true"> · </span>
          <Link href="/contact" className="underline decoration-white/20 underline-offset-4 hover:text-white/60">Contact support</Link>
        </p>
      </div>
    </main>
  )
}
