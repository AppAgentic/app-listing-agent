'use client'

import { FormEvent, useEffect, useMemo, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  CalendarDays,
  Check,
  CheckCircle2,
  Clock3,
  Loader2,
  LockKeyhole,
  Store,
} from 'lucide-react'
import { trackConciergeEvent, TrackedFunnelLink } from './booking-link'
import { resolveMarketingAttribution } from '@/lib/marketing/attribution'
import { BILLING_PLANS, offeredBillingPlans } from '@/lib/billing/catalog'

type Platform = 'ios' | 'android'
type Step = 'fit' | 'details' | 'result'

const fieldClass = 'w-full rounded-xl border border-white/[0.1] bg-white/[0.035] px-4 py-3.5 text-[15px] text-white outline-none transition placeholder:text-white/25 focus:border-lime-200/45 focus:bg-white/[0.055]'
const labelClass = 'mb-2 block text-[12px] font-semibold uppercase tracking-[0.14em] text-white/45'

function choiceClass(selected: boolean) {
  return `rounded-xl border px-4 py-3 text-left text-sm transition ${selected
    ? 'border-lime-200/45 bg-lime-200/[0.09] text-lime-50'
    : 'border-white/[0.08] bg-white/[0.025] text-white/55 hover:border-white/20 hover:text-white'}`
}

export function BookingForm() {
  const searchParams = useSearchParams()
  const source = searchParams.get('source') || 'book_page'
  const initialPlan = searchParams.get('plan')
  const [step, setStep] = useState<Step>('fit')
  const [platforms, setPlatforms] = useState<Platform[]>(['ios'])
  const [appStatus, setAppStatus] = useState('store_console')
  const [appCount, setAppCount] = useState('1-3')
  const [launchTiming, setLaunchTiming] = useState('this_month')
  const [customerType, setCustomerType] = useState('indie_developer')
  const [preferredPlan, setPreferredPlan] = useState(
    [...offeredBillingPlans(), 'enterprise'].includes(initialPlan || '') ? initialPlan! : 'unsure'
  )
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<{ disposition: string; bookingUrl: string | null; leadId: string; trackingToken: string } | null>(null)

  useEffect(() => {
    trackConciergeEvent('application_started', source)
  }, [source])

  const stepNumber = step === 'fit' ? 1 : step === 'details' ? 2 : 3
  const progress = `${Math.round((stepNumber / 3) * 100)}%`
  const outcomeTitle = result?.disposition === 'qualified'
    ? result.bookingUrl ? 'You look like a strong fit.' : 'You look like a strong fit.'
    : 'You’re on the early-access list.'

  const togglePlatform = (platform: Platform) => {
    setPlatforms(current => current.includes(platform)
      ? current.length === 1 ? current : current.filter(value => value !== platform)
      : [...current, platform])
  }

  const selectedSummary = useMemo(() => [
    appStatus === 'live' ? 'Live app' : appStatus === 'store_console' ? 'In a store console' : 'Pre-store app',
    platforms.map(value => value === 'ios' ? 'iOS' : 'Android').join(' + '),
    appCount === '1-3' ? '1–3 apps' : `${appCount} apps`,
  ], [appCount, appStatus, platforms])

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSubmitting(true)
    setError('')
    const form = new FormData(event.currentTarget)
    const attribution = resolveMarketingAttribution(searchParams, {
      landingPath: window.location.pathname,
      referrer: document.referrer,
      capturedAt: new Date().toISOString(),
    }, window.localStorage)

    try {
      const response = await fetch('/api/concierge/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.get('name'),
          email: form.get('email'),
          company: form.get('company'),
          appName: form.get('appName'),
          biggestStoreProblem: form.get('biggestStoreProblem'),
          preferredAgent: form.get('preferredAgent'),
          appStatus,
          platforms,
          appCount,
          launchTiming,
          customerType,
          preferredPlan,
          source,
          utm: {
            source: attribution?.source,
            medium: attribution?.medium,
            campaign: attribution?.campaign,
            content: attribution?.content,
            term: attribution?.term,
            fbclid: attribution?.fbclid,
            twclid: attribution?.twclid,
            gclid: attribution?.gclid,
            oppref: attribution?.oppref,
          },
        }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error === 'validation_error' ? 'Please complete every required field.' : 'We could not save your application.')
      setResult(data)
      setStep('result')
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : 'We could not save your application.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#070807] text-[#f5f1df] selection:bg-lime-200/25">
      <div className="pointer-events-none absolute inset-0 opacity-[0.075] [background-image:linear-gradient(rgba(255,255,255,.15)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.15)_1px,transparent_1px)] [background-size:72px_72px]" />
      <div className="pointer-events-none absolute -left-48 top-16 h-[34rem] w-[34rem] rounded-full bg-lime-300/[0.055] blur-[120px]" />
      <div className="pointer-events-none absolute -right-48 bottom-0 h-[30rem] w-[30rem] rounded-full bg-sky-400/[0.05] blur-[120px]" />

      <header className="relative z-10 mx-auto flex max-w-7xl items-center justify-between px-6 py-7 lg:px-10">
        <Link href="/" className="flex items-center gap-3">
          <Image src="/copilot-icon.png" alt="App Listing Agent" width={28} height={28} className="h-7 w-7" unoptimized />
          <span className="font-brand text-[15px] font-bold tracking-tight text-white">App Listing Agent</span>
        </Link>
        <div className="flex items-center gap-4 text-sm">
          <TrackedFunnelLink source="booking_header" href="/login?mode=signup&source=booking_header" className="text-white/45 transition hover:text-white">Want to start now? Create your account</TrackedFunnelLink>
          <Link href="/login" className="hidden text-white/35 transition hover:text-white sm:inline">Log in</Link>
        </div>
      </header>

      <div className="relative z-10 mx-auto grid max-w-7xl gap-12 px-6 pb-20 pt-10 lg:grid-cols-[0.82fr_1.18fr] lg:items-start lg:px-10 lg:pt-20">
        <section className="lg:sticky lg:top-16">
          <p className="mb-6 font-mono text-[11px] uppercase tracking-[0.24em] text-lime-200/70">Concierge launch session · 30 minutes</p>
          <h1 className="max-w-xl text-5xl font-bold leading-[0.94] tracking-[-0.045em] text-[#f5f1df] sm:text-6xl lg:text-7xl">
            Bring one app.<br /><span className="text-white/28">Leave ready.</span>
          </h1>
          <p className="mt-7 max-w-lg text-lg leading-relaxed text-white/48">
            We’ll connect or stage your store presence, pair your AI agent, and produce a prioritized readiness report together.
          </p>

          <div className="mt-10 space-y-3">
            {[
              [Store, 'Connect one app', 'Live, unpublished, or not created in a store yet'],
              [Bot, 'Pair your agent', 'Codex, Claude Code, Cursor, or another terminal agent'],
              [CheckCircle2, 'Leave with a real audit', 'Specific launch blockers and the next best action'],
            ].map(([Icon, title, detail]) => {
              const ItemIcon = Icon as typeof Store
              return (
                <div key={title as string} className="flex gap-4 border-t border-white/[0.08] py-4">
                  <ItemIcon className="mt-0.5 h-5 w-5 shrink-0 text-lime-200/70" />
                  <div><p className="text-sm font-semibold text-white">{title as string}</p><p className="mt-1 text-sm leading-relaxed text-white/38">{detail as string}</p></div>
                </div>
              )
            })}
          </div>

          <div className="mt-8 flex items-center gap-5 text-xs text-white/32">
            <span className="flex items-center gap-2"><Clock3 className="h-4 w-4" /> 30 minutes</span>
            <span className="flex items-center gap-2"><LockKeyhole className="h-4 w-4" /> Secure handoff</span>
          </div>
        </section>

        <section className="border border-white/[0.1] bg-black/35 shadow-[0_36px_100px_rgba(0,0,0,.38)] backdrop-blur-xl">
          <div className="border-b border-white/[0.08] px-6 py-5 sm:px-8">
            <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.16em] text-white/35">
              <span>{step === 'result' ? 'Application complete' : `Step ${stepNumber} of 2`}</span>
              <span>{step === 'fit' ? 'Your app' : step === 'details' ? 'Your details' : 'Next step'}</span>
            </div>
            <div className="mt-4 h-px bg-white/[0.08]"><div className="h-px bg-lime-200/70 transition-all duration-500" style={{ width: progress }} /></div>
          </div>

          {step === 'fit' && (
            <div className="p-6 sm:p-8">
              <h2 className="text-2xl font-semibold tracking-tight text-white">Tell us where the app is today.</h2>
              <p className="mt-2 text-sm leading-relaxed text-white/42">This routes you to the right setup path. Public release is not required.</p>

              <div className="mt-8">
                <span className={labelClass}>Store status</span>
                <div className="grid gap-2 sm:grid-cols-3">
                  {[
                    ['live', 'Already live'],
                    ['store_console', 'In ASC / Play'],
                    ['not_created', 'Not created yet'],
                  ].map(([value, label]) => <button type="button" key={value} onClick={() => setAppStatus(value)} className={choiceClass(appStatus === value)}>{label}</button>)}
                </div>
              </div>

              <div className="mt-6">
                <span className={labelClass}>Platform</span>
                <div className="grid grid-cols-2 gap-2">
                  {([['ios', 'Apple App Store'], ['android', 'Google Play']] as const).map(([value, label]) => (
                    <button type="button" key={value} onClick={() => togglePlatform(value)} className={choiceClass(platforms.includes(value))}>
                      <span className="flex items-center justify-between">{label}{platforms.includes(value) && <Check className="h-4 w-4" />}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="mt-6 grid gap-5 sm:grid-cols-2">
                <label><span className={labelClass}>Apps managed</span><select value={appCount} onChange={event => setAppCount(event.target.value)} className={fieldClass}><option value="1-3">1–3 apps</option><option value="4-10">4–10 apps</option><option value="11-50">11–50 apps</option><option value="50+">50+ apps</option></select></label>
                <label><span className={labelClass}>Launch timing</span><select value={launchTiming} onChange={event => setLaunchTiming(event.target.value)} className={fieldClass}><option value="this_month">This month</option><option value="next_90_days">Next 90 days</option><option value="exploring">Just exploring</option></select></label>
              </div>

              <button type="button" onClick={() => setStep('details')} className="mt-8 flex w-full items-center justify-center gap-2 rounded-xl bg-[#f5f1df] px-5 py-4 text-sm font-bold text-black transition hover:bg-white">
                Continue <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          )}

          {step === 'details' && (
            <form onSubmit={submit} className="p-6 sm:p-8">
              <button type="button" onClick={() => setStep('fit')} className="mb-5 flex items-center gap-2 text-xs text-white/35 transition hover:text-white"><ArrowLeft className="h-3.5 w-3.5" /> Back</button>
              <div className="mb-7 flex flex-wrap gap-2">{selectedSummary.map(item => <span key={item} className="rounded-full border border-white/[0.08] bg-white/[0.03] px-3 py-1.5 text-xs text-white/45">{item}</span>)}</div>
              <div className="grid gap-5 sm:grid-cols-2">
                <label><span className={labelClass}>Your name</span><input className={fieldClass} name="name" autoComplete="name" required minLength={2} placeholder="Alex Morgan" /></label>
                <label><span className={labelClass}>Work email</span><input className={fieldClass} name="email" autoComplete="email" type="email" required placeholder="alex@company.com" /></label>
                <label><span className={labelClass}>Company <span className="normal-case tracking-normal text-white/25">(optional)</span></span><input className={fieldClass} name="company" autoComplete="organization" placeholder="Acme Apps" /></label>
                <label><span className={labelClass}>App name</span><input className={fieldClass} name="appName" required minLength={2} placeholder="Your app" /></label>
                <label><span className={labelClass}>You are</span><select value={customerType} onChange={event => setCustomerType(event.target.value)} className={fieldClass}><option value="indie_developer">Independent developer</option><option value="app_studio">App studio</option><option value="agency">Agency</option><option value="enterprise">Enterprise team</option><option value="other">Other</option></select></label>
                <label><span className={labelClass}>Likely plan</span><select value={preferredPlan} onChange={event => setPreferredPlan(event.target.value)} className={fieldClass}><option value="unsure">Not sure yet</option>{offeredBillingPlans().map(id => <option key={id} value={id}>{BILLING_PLANS[id].name} · ${BILLING_PLANS[id].monthlyPriceUsd!.toLocaleString('en-US')}/mo</option>)}<option value="enterprise">Enterprise</option></select></label>
                <label className="sm:col-span-2"><span className={labelClass}>Preferred agent</span><select name="preferredAgent" defaultValue="codex" className={fieldClass}><option value="codex">Codex</option><option value="claude">Claude Code</option><option value="cursor">Cursor</option><option value="other">Another terminal agent</option><option value="none">I do not use one yet</option></select></label>
                <label className="sm:col-span-2"><span className={labelClass}>What is slowing down your store work?</span><textarea className={`${fieldClass} min-h-28 resize-y`} name="biggestStoreProblem" required minLength={10} placeholder="For example: screenshots and metadata take too long across locales…" /></label>
              </div>
              {error && <p role="alert" className="mt-5 border border-red-400/20 bg-red-400/[0.07] px-4 py-3 text-sm text-red-200">{error}</p>}
              <button disabled={submitting} className="mt-7 flex w-full items-center justify-center gap-2 rounded-xl bg-[#f5f1df] px-5 py-4 text-sm font-bold text-black transition hover:bg-white disabled:opacity-55">
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarDays className="h-4 w-4" />}
                {submitting ? 'Checking fit…' : 'Apply for a setup session'}
              </button>
              <p className="mt-4 text-center text-xs leading-relaxed text-white/25">We use these details only to prepare and route your setup. Never paste store credentials here.</p>
            </form>
          )}

          {step === 'result' && result && (
            <div className="p-8 sm:p-12">
              <div className="flex h-12 w-12 items-center justify-center rounded-full border border-lime-200/25 bg-lime-200/[0.08]"><CheckCircle2 className="h-6 w-6 text-lime-200" /></div>
              <h2 className="mt-7 text-3xl font-semibold tracking-tight text-white">{outcomeTitle}</h2>
              <p className="mt-4 max-w-lg text-[15px] leading-relaxed text-white/45">
                {result.disposition === 'qualified'
                  ? result.bookingUrl
                    ? 'Choose a time that works. We will use your answers to prepare the session before you arrive.'
                    : 'Your application is saved. We are finishing the live calendar connection and will send the setup link when your session is ready to book.'
                  : 'We saved your application for the assisted async path. We will invite the best-fit early users as capacity opens.'}
              </p>
              {result.bookingUrl && (
                <a
                  href={result.bookingUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => trackConciergeEvent('calendar_viewed', source, undefined, { leadId: result.leadId, trackingToken: result.trackingToken })}
                  className="mt-8 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-lime-200 px-5 py-4 text-sm font-bold text-black transition hover:bg-lime-100"
                >
                  Choose your setup time <ArrowRight className="h-4 w-4" />
                </a>
              )}
              <Link href="/" className="mt-4 inline-flex w-full items-center justify-center py-3 text-sm text-white/35 transition hover:text-white">Back to App Listing Agent</Link>
            </div>
          )}
        </section>
      </div>
    </main>
  )
}
