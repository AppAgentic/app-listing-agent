import Image from 'next/image'
import Link from 'next/link'
import { ArrowRight, Check, ShieldCheck, Sparkles } from 'lucide-react'
import type { DiscoveryPage } from '@/lib/discovery-pages'
import { serializeJsonLd } from '@/lib/seo/json-ld'
import { SITE_URL, WEBSITE_ID } from '@/lib/seo/site'
import { TrackedFunnelLink } from '@/components/concierge/booking-link'

function MetadataReviewProof() {
  const fields = [
    { label: 'Name', value: 'SnoozyBear', limit: '10 / 30' },
    { label: 'Subtitle', value: 'Baby sleep, without the guesswork', limit: '30 / 30' },
    { label: 'Keywords', value: 'baby sleep, nap tracker, newborn', limit: '37 / 100' },
  ]

  return (
    <div className="relative flex aspect-[4/5] flex-col overflow-hidden border border-white/10 bg-[#0b0a10] p-6 sm:p-8">
      <div className="flex items-center justify-between border-b border-white/10 pb-5">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/35">App Store metadata</p>
          <p className="mt-2 text-sm font-semibold text-white">English (U.S.)</p>
        </div>
        <span className="rounded-full border border-lime-200/20 bg-lime-200/[0.06] px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-lime-200/75">4 changes</span>
      </div>

      <div className="flex-1 divide-y divide-white/10">
        {fields.map(field => (
          <div key={field.label} className="py-5">
            <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.16em] text-white/30">
              <span>{field.label}</span><span>{field.limit}</span>
            </div>
            <p className="mt-3 text-sm leading-6 text-white/82 sm:text-base">{field.value}</p>
          </div>
        ))}
      </div>

      <div className="border-t border-white/10 pt-5">
        <div className="flex items-center gap-3 text-sm text-white/60"><Sparkles className="h-4 w-4 text-violet-400" /> Draft prepared from the live listing</div>
        <div className="mt-5 flex items-center justify-between rounded-sm bg-[#f5f1df] px-4 py-3 text-sm font-bold text-black"><span>Review exact changes</span><ArrowRight className="h-4 w-4" /></div>
      </div>
    </div>
  )
}

function ScreenshotTransformProof({ proof }: { proof: Extract<NonNullable<DiscoveryPage['proof']>, { kind: 'screenshot-transform' }> }) {
  return (
    <div className="relative flex aspect-[4/5] flex-col overflow-hidden border border-white/10 bg-[#0b0a10] p-5 sm:p-7">
      <div className="flex items-center justify-between border-b border-white/10 pb-4">
        <div><p className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/35">Screenshot treatment</p><p className="mt-2 text-sm font-semibold">6.9-inch iPhone · English</p></div>
        <Sparkles className="h-5 w-5 text-violet-400" />
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-2 gap-3 py-5">
        <figure className="flex min-h-0 flex-col">
          <figcaption className="mb-3 font-mono text-[10px] uppercase tracking-[0.18em] text-white/35">Source</figcaption>
          <div className="relative min-h-0 flex-1 overflow-hidden bg-black/40"><Image src={proof.sourceImage} alt={proof.sourceAlt} fill priority sizes="20vw" className="object-cover object-top" /></div>
        </figure>
        <figure className="flex min-h-0 flex-col">
          <figcaption className="mb-3 font-mono text-[10px] uppercase tracking-[0.18em] text-lime-200/70">Generated</figcaption>
          <div className="relative min-h-0 flex-1 overflow-hidden bg-black/40"><Image src={proof.resultImage} alt={proof.resultAlt} fill priority sizes="20vw" className="object-cover object-top" /></div>
        </figure>
      </div>
      <div className="flex items-center justify-between border-t border-white/10 pt-4 text-xs text-white/45"><span>Product UI preserved</span><span className="text-white/70">Ready for review</span></div>
    </div>
  )
}

export function DiscoveryPageLayout({ page }: { page: DiscoveryPage }) {
  const canonical = `${SITE_URL}/use-cases/${page.slug}`
  const structuredData = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebPage',
        '@id': `${canonical}#webpage`,
        url: canonical,
        name: page.title,
        description: page.description,
        isPartOf: { '@id': WEBSITE_ID },
        ...(page.sources?.length ? { citation: page.sources.map(source => source.url) } : {}),
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: SITE_URL },
          { '@type': 'ListItem', position: 2, name: 'Use cases', item: `${SITE_URL}/use-cases` },
          { '@type': 'ListItem', position: 3, name: page.eyebrow, item: canonical },
        ],
      },
      {
        '@type': 'FAQPage',
        mainEntity: page.faqs.map(faq => ({
          '@type': 'Question',
          name: faq.question,
          acceptedAnswer: { '@type': 'Answer', text: faq.answer },
        })),
      },
    ],
  }

  return (
    <main className="min-h-screen overflow-hidden bg-[#070807] text-[#f5f1df] selection:bg-violet-500/30">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(structuredData) }} />

      <nav className="mx-auto flex max-w-7xl items-center justify-between px-6 py-6 lg:px-10">
        <Link href="/" aria-label="App Listing Agent home" className="flex shrink-0 items-center gap-3 text-sm font-semibold tracking-tight">
          <Image src="/copilot-icon.png" width={36} height={36} alt="" className="h-9 w-9 object-contain" />
          <span className="hidden sm:inline">App Listing Agent</span>
        </Link>
        <div className="flex items-center gap-4 text-sm text-white/60 sm:gap-5">
          <Link href="/use-cases" className="transition-colors hover:text-white">Use cases</Link>
          <Link href="/agents" className="transition-colors hover:text-white">For agents</Link>
          <TrackedFunnelLink source="discovery_nav" href="/login?mode=signup&source=discovery_nav" className="rounded-full border border-white/15 px-4 py-2 text-white transition-colors hover:border-white/35">Start free trial</TrackedFunnelLink>
        </div>
      </nav>

      <header className="relative mx-auto grid min-h-[72svh] max-w-7xl items-center gap-14 px-6 py-20 lg:grid-cols-[1.06fr_0.94fr] lg:px-10">
        <div className="relative z-10 animate-[fadeUp_.7s_ease-out_both]">
          <p className="font-mono text-xs uppercase tracking-[0.23em] text-lime-200/75">{page.eyebrow}</p>
          <h1 className="mt-7 max-w-4xl font-brand text-5xl font-bold leading-[0.98] tracking-[-0.05em] sm:text-7xl lg:text-[5.8rem]">{page.title}</h1>
          <p className="mt-7 max-w-2xl text-lg leading-8 text-white/52 sm:text-xl">{page.summary}</p>
          <div className="mt-10 flex flex-wrap gap-3">
            <TrackedFunnelLink source="discovery_hero" href="/login?mode=signup&source=discovery_hero" className="group inline-flex items-center gap-3 rounded-full bg-[#f5f1df] px-6 py-3.5 text-sm font-bold text-black transition-transform hover:-translate-y-0.5">
              Connect your app <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
            </TrackedFunnelLink>
            <Link href="/docs/mcp" className="inline-flex items-center rounded-full border border-white/15 px-6 py-3.5 text-sm font-semibold text-white/75 transition-colors hover:border-white/35 hover:text-white">Read MCP docs</Link>
          </div>
        </div>

        <div className="relative animate-[fadeUp_.8s_.12s_ease-out_both]">
          <div className="pointer-events-none absolute -inset-20 rounded-full bg-violet-500/[0.09] blur-3xl" />
          {page.proof?.kind === 'metadata-review' ? (
            <MetadataReviewProof />
          ) : page.proof?.kind === 'screenshot-transform' ? (
            <ScreenshotTransformProof proof={page.proof} />
          ) : (
            <div className="relative flex aspect-[4/5] flex-col justify-between border border-white/10 bg-black/45 p-8 sm:p-10">
              <div className="flex items-center justify-between font-mono text-[11px] uppercase tracking-[0.18em] text-white/35"><span>Remote MCP</span><span className="text-lime-200/70">Discoverable</span></div>
              <div className="space-y-5 font-mono text-sm text-white/60">
                <p className="text-violet-300">applistingagent</p>
                <p className="break-all text-white">https://applistingagent.com/api/mcp</p>
                <div className="h-px bg-white/10" />
                <p>OAuth 2.1 · project scoped</p>
                <p>Dry run · human approval</p>
              </div>
              <ShieldCheck className="h-14 w-14 text-violet-400/70" />
            </div>
          )}
        </div>
      </header>

      <section className="border-y border-white/10 bg-white/[0.02]">
        <div className="mx-auto max-w-7xl px-6 lg:px-10">
          {page.sections.map((section, index) => (
            <article key={section.heading} className="grid gap-8 border-b border-white/10 py-20 last:border-b-0 lg:grid-cols-[0.72fr_1.28fr] lg:gap-20 lg:py-28">
              <div><span className="font-mono text-xs text-violet-400">0{index + 1}</span><h2 className="mt-6 text-3xl font-semibold tracking-[-0.035em] sm:text-5xl">{section.heading}</h2></div>
              <div className="max-w-2xl space-y-6 text-base leading-8 text-white/52 sm:text-lg">
                {section.paragraphs.map(paragraph => <p key={paragraph}>{paragraph}</p>)}
                {section.bullets && <ul className="mt-8 border-t border-white/10">{section.bullets.map(item => <li key={item} className="flex gap-3 border-b border-white/10 py-4 text-white/72"><Check className="mt-1 h-4 w-4 shrink-0 text-lime-200/70" />{item}</li>)}</ul>}
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 py-24 lg:px-10 lg:py-36">
        <p className="font-mono text-xs uppercase tracking-[0.23em] text-lime-200/70">The workflow</p>
        <div className="mt-12 grid border-t border-white/15 md:grid-cols-2 lg:grid-cols-4">
          {page.steps.map((step, index) => (
            <article key={step.title} className="border-b border-white/10 py-8 md:px-6 md:first:pl-0 lg:border-r lg:last:border-r-0">
              <span className="font-mono text-xs text-violet-400">0{index + 1}</span>
              <h2 className="mt-7 text-xl font-semibold">{step.title}</h2>
              <p className="mt-3 text-sm leading-7 text-white/45">{step.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="border-t border-white/10 bg-black/25">
        <div className="mx-auto grid max-w-7xl gap-14 px-6 py-24 lg:grid-cols-[0.72fr_1.28fr] lg:px-10 lg:py-36">
          <div><p className="font-mono text-xs uppercase tracking-[0.23em] text-violet-400">Questions</p><h2 className="mt-6 text-4xl font-semibold tracking-[-0.04em] sm:text-5xl">What teams ask first.</h2></div>
          <dl className="border-t border-white/15">
            {page.faqs.map(faq => <div key={faq.question} className="border-b border-white/10 py-7"><dt className="text-lg font-semibold text-white">{faq.question}</dt><dd className="mt-3 max-w-2xl leading-7 text-white/48">{faq.answer}</dd></div>)}
          </dl>
        </div>
      </section>

      {(page.sources?.length || page.related?.length) ? (
        <section className="border-t border-white/10">
          <div className="mx-auto grid max-w-7xl gap-12 px-6 py-20 text-sm leading-7 text-white/52 lg:grid-cols-2 lg:px-10">
            {page.sources?.length ? (
              <div>
                <h2 className="font-mono text-xs uppercase tracking-[0.23em] text-violet-400">Sources{page.sourcesChecked ? <> · checked <time dateTime={page.sourcesChecked}>{page.sourcesChecked}</time></> : null}</h2>
                <ul className="mt-6 space-y-2">
                  {page.sources.map(source => <li key={source.url}><a href={source.url} rel="noopener" className="text-white/72 underline underline-offset-4 hover:text-white">{source.label}</a></li>)}
                </ul>
              </div>
            ) : null}
            {page.related?.length ? (
              <div>
                <h2 className="font-mono text-xs uppercase tracking-[0.23em] text-violet-400">Related</h2>
                <ul className="mt-6 space-y-2">
                  {page.related.map(item => <li key={item.href}><Link href={item.href} className="text-white/72 underline underline-offset-4 hover:text-white">{item.label}</Link></li>)}
                </ul>
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      <section className="px-6 py-28 text-center lg:py-40">
        <h2 className="mx-auto max-w-4xl text-5xl font-bold tracking-[-0.05em] sm:text-7xl">Give the agent a project. Keep the final say.</h2>
        <p className="mx-auto mt-6 max-w-xl text-lg leading-8 text-white/48">Connect one app, run the first audit, and review every live-store change before it ships.</p>
        <TrackedFunnelLink source="discovery_final" href="/login?mode=signup&source=discovery_final" className="group mt-10 inline-flex items-center gap-3 rounded-full bg-violet-600 px-7 py-4 text-sm font-bold text-white transition-transform hover:-translate-y-0.5 hover:bg-violet-500">Start free trial <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" /></TrackedFunnelLink>
      </section>
    </main>
  )
}
