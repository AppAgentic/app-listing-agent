'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ArrowRight, Check, Globe2, Loader2, Sparkles, TriangleAlert } from 'lucide-react'
import { TrackedFunnelLink } from '@/components/concierge/booking-link'
import { trackEvent } from '@/lib/analytics/client'
import type { AuditIssue, ListingAuditReport } from '@/lib/listing-audit/types'

const STEPS = ['Reading your public listing', 'Checking 8 big non-English markets', 'Reviewing your copy']

const SEVERITY: Record<AuditIssue['severity'], { label: string; className: string }> = {
  high: { label: 'High impact', className: 'border-rose-400/30 bg-rose-400/10 text-rose-200' },
  medium: { label: 'Medium', className: 'border-amber-300/30 bg-amber-300/10 text-amber-100' },
  low: { label: 'Low', className: 'border-white/15 bg-white/[0.06] text-white/70' },
}

function band(score: number): 'low' | 'mid' | 'high' {
  return score < 60 ? 'low' : score < 85 ? 'mid' : 'high'
}

function ScoreRing({ score }: { score: number }) {
  const radius = 44
  const circumference = 2 * Math.PI * radius
  const color = score < 60 ? '#fb7185' : score < 85 ? '#fcd34d' : '#34d399'
  return (
    <div className="relative h-28 w-28 flex-shrink-0">
      <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
        <circle cx="50" cy="50" r={radius} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="8" />
        <circle
          cx="50"
          cy="50"
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - score / 100)}
          style={{ transition: 'stroke-dashoffset 900ms ease-out' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-brand text-3xl font-bold text-white">{score}</span>
        <span className="text-[11px] uppercase tracking-[0.18em] text-white/45">/ 100</span>
      </div>
    </div>
  )
}

export function ListingAudit() {
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [step, setStep] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [report, setReport] = useState<ListingAuditReport | null>(null)
  const resultRef = useRef<HTMLDivElement>(null)

  async function run(target: string) {
    if (!target.trim() || loading) return
    setLoading(true)
    setError(null)
    setReport(null)
    setStep(0)
    const timer = window.setInterval(() => setStep(value => Math.min(value + 1, STEPS.length - 1)), 2200)
    try {
      const response = await fetch('/api/public/listing-audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: target }),
      })
      const data = (await response.json().catch(() => ({}))) as { report?: ListingAuditReport; cached?: boolean; message?: string }
      if (!response.ok || !data.report) {
        setError(data.message ?? (response.status === 429 ? 'You’ve run a lot of audits. Try again in a little while.' : 'Something went wrong. Please try again.'))
        return
      }
      setReport(data.report)
      trackEvent('listing_audit_completed', {
        props: { store: data.report.listing.store, score_band: band(data.report.score), cached: Boolean(data.cached) },
      })
      const share = new URL(window.location.href)
      share.searchParams.set('url', target.trim())
      window.history.replaceState(null, '', share.toString())
      window.setTimeout(() => resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
    } catch {
      setError('We couldn’t reach the audit service. Check your connection and try again.')
    } finally {
      window.clearInterval(timer)
      setLoading(false)
    }
  }

  useEffect(() => {
    const shared = new URL(window.location.href).searchParams.get('url')
    if (shared) {
      setUrl(shared)
      void run(shared)
    }
    // Run once for a shared link.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    void run(url)
  }

  const localized = report?.markets.filter(market => market.available && market.localized).length ?? 0
  const availableMarkets = report?.markets.filter(market => market.available).length ?? 0

  return (
    <div className="w-full">
      <form onSubmit={onSubmit} className="mx-auto flex w-full max-w-2xl flex-col gap-3 sm:flex-row">
        <label htmlFor="audit-url" className="sr-only">App Store or Google Play link</label>
        <input
          id="audit-url"
          type="text"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          value={url}
          onChange={event => setUrl(event.target.value)}
          placeholder="Paste an App Store or Google Play link"
          className="min-w-0 flex-1 rounded-full border border-white/15 bg-white/[0.04] px-5 py-3.5 text-[15px] text-white placeholder:text-white/35 focus:border-purple-300/60 focus:outline-none focus:ring-4 focus:ring-purple-500/15"
        />
        <button
          type="submit"
          disabled={loading || !url.trim()}
          className="inline-flex items-center justify-center gap-2 rounded-full bg-white px-7 py-3.5 text-[15px] font-bold text-black transition-all hover:bg-neutral-200 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
          {loading ? 'Auditing…' : 'Audit my listing'}
        </button>
      </form>
      <p className="mt-3 text-center text-[13px] text-white/40">
        Free, no sign-up. Example: apps.apple.com/us/app/…/id123456789
      </p>

      {loading ? (
        <ol className="mx-auto mt-10 max-w-md space-y-3" aria-live="polite">
          {STEPS.map((label, index) => (
            <li key={label} className={`flex items-center gap-3 text-[14px] ${index <= step ? 'text-white/85' : 'text-white/30'}`}>
              {index < step ? (
                <Check className="h-4 w-4 text-emerald-300" aria-hidden="true" />
              ) : index === step ? (
                <Loader2 className="h-4 w-4 animate-spin text-purple-300" aria-hidden="true" />
              ) : (
                <span className="h-4 w-4 rounded-full border border-white/20" aria-hidden="true" />
              )}
              {label}
            </li>
          ))}
        </ol>
      ) : null}

      {error ? (
        <p role="alert" className="mx-auto mt-8 max-w-2xl rounded-2xl border border-rose-400/25 bg-rose-400/10 px-5 py-4 text-center text-[14px] text-rose-100">
          {error}
        </p>
      ) : null}

      {report ? (
        <div ref={resultRef} className="mx-auto mt-14 max-w-3xl scroll-mt-24 space-y-6 text-left">
          <section className="flex flex-col gap-6 rounded-3xl border border-white/10 bg-white/[0.03] p-6 sm:flex-row sm:items-center sm:p-8">
            <ScoreRing score={report.score} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-3">
                {report.listing.iconUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={report.listing.iconUrl} alt="" width={44} height={44} className="h-11 w-11 rounded-xl" />
                ) : null}
                <div className="min-w-0">
                  <h2 className="truncate font-brand text-xl font-bold text-white">{report.listing.title}</h2>
                  <p className="truncate text-[13px] text-white/45">
                    {report.listing.store === 'ios' ? 'App Store' : 'Google Play'}
                    {report.listing.developer ? ` · ${report.listing.developer}` : ''}
                  </p>
                </div>
              </div>
              <p className="mt-4 text-[15px] leading-relaxed text-white/70">
                {report.issues.length === 0
                  ? 'Strong public listing. Connect your store to audit the fields that aren’t public (subtitle, keywords, promotional text).'
                  : `${report.issues.length} thing${report.issues.length === 1 ? '' : 's'} holding this listing back${report.issues.some(issue => issue.severity === 'high') ? ', including high-impact ones' : ''}. Each comes with how your AI agent fixes it.`}
              </p>
            </div>
          </section>

          {report.issues.length > 0 ? (
            <section className="space-y-3">
              {report.issues.map(issue => (
                <article key={issue.id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${SEVERITY[issue.severity].className}`}>
                      {SEVERITY[issue.severity].label}
                    </span>
                    <h3 className="font-semibold text-white">{issue.title}</h3>
                  </div>
                  <p className="mt-2 text-[14px] leading-relaxed text-white/60">{issue.detail}</p>
                  {issue.fix ? (
                    <p className="mt-3 flex gap-2 text-[14px] leading-relaxed text-purple-100/90">
                      <Sparkles className="mt-0.5 h-4 w-4 flex-shrink-0 text-purple-300" aria-hidden="true" />
                      <span><span className="font-semibold">With App Listing Agent:</span> {issue.fix}</span>
                    </p>
                  ) : null}
                </article>
              ))}
            </section>
          ) : null}

          {availableMarkets > 0 ? (
            <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
              <h3 className="flex items-center gap-2 font-semibold text-white">
                <Globe2 className="h-4 w-4 text-purple-300" aria-hidden="true" />
                Translated listing in {localized} of {availableMarkets} large markets
              </h3>
              <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {report.markets.map(market => (
                  <div key={market.market} className="rounded-xl border border-white/[0.08] bg-black/20 px-3 py-2">
                    <div className="text-[13px] font-medium text-white/85">{market.label}</div>
                    <div className={`text-[12px] ${!market.available ? 'text-white/35' : market.localized ? 'text-emerald-300' : 'text-rose-300'}`}>
                      {!market.available ? 'Not available' : market.localized ? 'Translated' : 'English only'}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {report.aiReview ? (
            <section className="rounded-2xl border border-purple-300/20 bg-purple-500/[0.06] p-5">
              <h3 className="flex items-center gap-2 font-semibold text-white">
                <Sparkles className="h-4 w-4 text-purple-300" aria-hidden="true" />
                AI copy review
              </h3>
              <p className="mt-1 text-[12px] text-white/40">Generated automatically from the listing text. Treat it as suggestions, not facts.</p>
              <p className="mt-2 text-[14px] leading-relaxed text-white/70">{report.aiReview.verdict}</p>
              <ul className="mt-4 space-y-3">
                {report.aiReview.suggestions.map(suggestion => (
                  <li key={suggestion.title} className="text-[14px] leading-relaxed">
                    <span className="font-semibold text-white">{suggestion.title}.</span>{' '}
                    <span className="text-white/60">{suggestion.detail}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {report.strengths.length > 0 ? (
            <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
              <h3 className="font-semibold text-white">What’s already working</h3>
              <ul className="mt-3 space-y-2">
                {report.strengths.map(strength => (
                  <li key={strength.id} className="flex gap-2 text-[14px] text-white/65">
                    <Check className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-300" aria-hidden="true" />
                    {strength.title}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {report.notChecked.length > 0 ? (
            <section className="flex gap-3 rounded-2xl border border-white/[0.08] px-5 py-4 text-[13px] leading-relaxed text-white/50">
              <TriangleAlert className="mt-0.5 h-4 w-4 flex-shrink-0 text-white/40" aria-hidden="true" />
              <div>
                <span className="font-semibold text-white/70">Not checked from the public page:</span> {report.notChecked.join('; ')}.
              </div>
            </section>
          ) : null}

          <section className="rounded-3xl border border-purple-300/25 bg-gradient-to-b from-purple-500/[0.14] to-purple-500/[0.04] p-7 text-center sm:p-10">
            <h3 className="font-brand text-2xl font-bold text-white sm:text-3xl">Let your AI agent fix this</h3>
            <p className="mx-auto mt-3 max-w-xl text-[15px] leading-relaxed text-white/65">
              Connect Claude Code, Codex, Cursor or ChatGPT to App Listing Agent. It prepares the translations,
              screenshots and copy, checks them against the store rules and publishes to both stores.
            </p>
            <div className="mt-7 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <TrackedFunnelLink
                href="/login?mode=signup&source=audit"
                source="audit_self_service"
                className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-white px-7 py-3.5 text-[15px] font-bold text-black transition-all hover:bg-neutral-200 active:scale-[0.98] sm:w-auto"
              >
                Start 7-day free trial <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </TrackedFunnelLink>
              <TrackedFunnelLink
                href="/book?source=audit"
                source="audit_guided"
                className="w-full rounded-full border border-purple-400/25 bg-purple-400/[0.08] px-7 py-3.5 text-[15px] font-bold text-purple-100 transition-all hover:border-purple-300/40 hover:bg-purple-400/[0.14] sm:w-auto"
              >
                Book a setup call
              </TrackedFunnelLink>
            </div>
          </section>

          <div className="text-center">
            <button
              type="button"
              onClick={() => {
                setReport(null)
                setUrl('')
                window.history.replaceState(null, '', '/audit')
                window.scrollTo({ top: 0, behavior: 'smooth' })
              }}
              className="text-[13px] font-medium text-white/45 transition-colors hover:text-white"
            >
              Audit another app
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
