'use client'

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import {
  ArrowRight,
  Bot,
  Building2,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clipboard,
  Loader2,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react'
import { readPurchaseIntent, safeLocalReturnTo } from '@/lib/billing/intent'
import { TrialStep } from '@/components/onboarding/trial-step'
import Starfield from '@/components/Starfield'
import { trackEvent } from '@/lib/analytics/client'
import { appOrigin } from '@/lib/routing/app-url'

// Client bundle: NEXT_PUBLIC_APP_URL must be read literally so Next inlines it at build time.
const APP_ORIGIN = appOrigin({ NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL })

type Stage = 'workspace' | 'trial' | 'activating' | 'connect' | 'connected'

interface PairingData {
  code: string
  expiresAt: string
  exchangeUrl: string
}

interface AgentState {
  status: 'not_connected' | 'pairing' | 'connected' | 'complete'
  currentStep: string
}

function OnboardingContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const returnTo = safeLocalReturnTo(searchParams.get('returnTo'))
  const intent = readPurchaseIntent(searchParams)
  const trialIntent = intent && intent.plan !== 'enterprise' ? intent : null
  const checkoutCanceled = searchParams.get('checkout') === 'canceled'
  const checkoutComplete = searchParams.get('checkout') === 'complete'
  const [trial, setTrial] = useState<{ offered: boolean; days: number }>({ offered: false, days: 7 })
  // Self-hosted installs have no billing, so onboarding has no plan step.
  const [selfHosted, setSelfHosted] = useState(false)
  // Hard paywall: agent connection and the dashboard need product access, so the plan step comes first.
  const [path, setPath] = useState<'agent' | 'dashboard'>('agent')

  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [pairingLoading, setPairingLoading] = useState(false)
  const [stage, setStage] = useState<Stage>('workspace')
  const [workspaceName, setWorkspaceName] = useState('')
  const [pairing, setPairing] = useState<PairingData | null>(null)
  const [copied, setCopied] = useState(false)
  const [showPrompt, setShowPrompt] = useState(false)
  const [error, setError] = useState('')
  const [activationDelayed, setActivationDelayed] = useState(false)

  const pairingPrompt = useMemo(() => pairing ? `Connect yourself to my App Listing Agent workspace.

1. Exchange this single-use pairing code by POSTing {"code":"${pairing.code}"} to ${APP_ORIGIN}${pairing.exchangeUrl}.
2. Store the returned API key in your secret store as ASC_API_KEY. Do not print, repeat, or commit it.
3. Configure the remote MCP server at ${APP_ORIGIN}/api/mcp with Authorization: Bearer <ASC_API_KEY>.
4. Call get_onboarding_status and continue the setup conversation there.
5. Ask whether my app (a) already exists in App Store Connect or Play Console, even if it is unpublished, or (b) has not been created in either console yet.
6. If it exists, discover/import it (for Google Play, ask only for the package name). If it does not exist yet, create a local pre-store project with storeRecordStatus "not_created" and continue without requiring a public store URL or ID. Later, use attach_onboarding_store_record when its ASC/Play record is created.

Ask me only for information you cannot discover. Never ask me to paste App Store Connect or Google Play private credentials into chat; use the secure browser handoff returned by App Listing Agent.` : '', [pairing])

  const createPairing = useCallback(async () => {
    setPairingLoading(true)
    setError('')
    try {
      const response = await fetch('/api/onboarding/pairing', { method: 'POST' })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Failed to create pairing code')
      setPairing(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create pairing code')
    } finally {
      setPairingLoading(false)
    }
  }, [])

  /** Where onboarding goes once the workspace has product access. */
  const continueWithAccess = useCallback(async (data: { onboardingCompleted?: boolean; agentOnboarding?: AgentState }) => {
    const agentState = data.agentOnboarding
    if (data.onboardingCompleted) {
      router.push(returnTo)
    } else if (agentState?.status === 'connected' || agentState?.status === 'complete') {
      setStage('connected')
    } else if (agentState?.currentStep === 'connect_agent' || agentState?.status === 'pairing') {
      setStage('connect')
      await createPairing()
    }
  }, [createPairing, returnTo, router])

  useEffect(() => {
    const load = async () => {
      try {
        const response = await fetch('/api/onboarding')
        if (!response.ok) {
          // Keep the chosen plan through signup so onboarding can end in its trial checkout.
          const here = `/onboarding${window.location.search}`
          router.push(`/login?mode=signup&returnTo=${encodeURIComponent(here)}`)
          return
        }
        const data = await response.json()
        setTrial({ offered: data.trial?.offered === true, days: Number(data.trial?.days) || 7 })
        setSelfHosted(data.selfHosted === true)
        if (data.workspaceName) setWorkspaceName(data.workspaceName)
        else if (data.displayName) setWorkspaceName(`${data.displayName}'s Workspace`)
        else if (data.email) setWorkspaceName(`${data.email.split('@')[0]}'s Workspace`)
        if (data.onboardingCompleted) setPath('dashboard')

        if (data.access?.allowed) {
          await continueWithAccess(data)
          return
        }
        // No product access. A subscription needing a payment fix, or a teammate whose owner must pay, is
        // handled on the billing page; everyone else chooses a plan once the workspace exists.
        if (data.access?.recoverable || data.access?.ownerMustPay) {
          router.push(`/billing?reason=${data.access.recoverable ? 'payment_failed' : 'subscription_required'}`)
          return
        }
        const workspaceSaved = Boolean(data.workspaceName) || data.onboardingCompleted ||
          data.agentOnboarding?.currentStep === 'connect_agent'
        if (checkoutComplete) setStage('activating')
        else if (workspaceSaved) setStage('trial')
      } catch {
        router.push(`/login?returnTo=${encodeURIComponent(returnTo)}`)
      } finally {
        setLoading(false)
      }
    }
    void load()
  }, [checkoutComplete, continueWithAccess, returnTo, router])

  // Returning from Stripe Checkout: wait for the verified webhook to grant access, then continue.
  useEffect(() => {
    if (stage !== 'activating') return
    const startedAt = Date.now()
    const timer = window.setInterval(async () => {
      const response = await fetch('/api/onboarding', { cache: 'no-store' })
      if (!response.ok) return
      const data = await response.json()
      if (data.access?.allowed) {
        window.clearInterval(timer)
        await continueWithAccess(data)
      } else if (Date.now() - startedAt > 60_000) {
        setActivationDelayed(true)
      }
    }, 2500)
    return () => window.clearInterval(timer)
  }, [continueWithAccess, stage])

  const connectedTracked = useRef(false)
  const completedTracked = useRef(false)
  useEffect(() => {
    if (stage !== 'connected' || connectedTracked.current) return
    connectedTracked.current = true
    trackEvent('onboarding_step', { step: 2, props: { choice: 'connected' } })
  }, [stage])

  useEffect(() => {
    if (stage !== 'connect' && stage !== 'connected') return
    const interval = window.setInterval(async () => {
      const response = await fetch('/api/onboarding/pairing')
      if (!response.ok) return
      const data = await response.json()
      if (data.onboarding?.status === 'connected') setStage('connected')
      if (data.onboarding?.status === 'complete') {
        if (!completedTracked.current) trackEvent('onboarding_completed', { props: { steps: 2 } })
        completedTracked.current = true
        router.push(returnTo)
      }
    }, 2500)
    return () => window.clearInterval(interval)
  }, [returnTo, router, stage])

  const saveWorkspace = async (completeManually = false) => {
    if (workspaceName.trim().length < 2) {
      setError('Workspace name must be at least 2 characters')
      return
    }
    setSubmitting(true)
    setError('')
    try {
      const response = await fetch('/api/onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceName, completeManually }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Failed to save workspace')
      trackEvent('onboarding_step', { step: 1, props: { choice: completeManually ? 'dashboard' : 'agent' } })
      if (completeManually) trackEvent('onboarding_completed', { props: { steps: 1 } })
      setPath(completeManually ? 'dashboard' : 'agent')
      const state = await fetch('/api/onboarding', { cache: 'no-store' }).then(r => (r.ok ? r.json() : null))
      if (state?.access?.allowed) {
        await continueWithAccess(state)
        return
      }
      if (state?.access?.recoverable || state?.access?.ownerMustPay) {
        router.push(`/billing?reason=${state.access.recoverable ? 'payment_failed' : 'subscription_required'}`)
        return
      }
      if (state?.trial) setTrial({ offered: state.trial.offered === true, days: Number(state.trial.days) || 7 })
      setStage('trial')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setSubmitting(false)
    }
  }

  const copyPrompt = async () => {
    await navigator.clipboard.writeText(pairingPrompt)
    trackEvent('setup_prompt_copied')
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1800)
  }

  if (loading) {
    return <div className="min-h-screen bg-black flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-neutral-400" /></div>
  }

  return (
    <div className="min-h-screen bg-black flex flex-col items-center justify-center px-4 py-10 relative">
      <Starfield mode="warp" transitionDuration={0} />
      <div className="w-full max-w-2xl relative z-10">
        <Link href="/" className="flex items-center justify-center gap-2 mb-8">
          <Image src="/copilot-icon.png" alt="App Listing Agent" width={32} height={32} className="w-8 h-8" unoptimized />
          <span className="text-xl font-bold text-white font-brand tracking-tight">App Listing Agent</span>
        </Link>

        <div className="flex items-center justify-center gap-2 mb-5" aria-label="Onboarding progress">
          {(selfHosted
            ? (path === 'agent' ? ['Workspace', 'Connect agent', 'First audit'] : ['Workspace'])
            : (path === 'agent' ? ['Workspace', trial.offered ? 'Free trial' : 'Plan', 'Connect agent', 'First audit'] : ['Workspace', trial.offered ? 'Free trial' : 'Plan'])).map((label, index, labels) => {
            const paidActiveIndex = stage === 'workspace' ? 0 : stage === 'trial' || stage === 'activating' ? 1 : stage === 'connect' ? 2 : 3
            const activeIndex = selfHosted ? Math.max(0, paidActiveIndex - 1) : paidActiveIndex
            return (
              <div key={label} className="flex items-center gap-2">
                <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold border ${index <= activeIndex ? 'bg-purple-500/20 border-purple-400/40 text-purple-200' : 'bg-white/[0.03] border-white/10 text-neutral-600'}`}>
                  {index < activeIndex ? <Check className="w-3.5 h-3.5" /> : index + 1}
                </span>
                <span className={`hidden sm:inline text-xs ${index <= activeIndex ? 'text-neutral-300' : 'text-neutral-600'}`}>{label}</span>
                {index < labels.length - 1 && <span className="w-8 h-px bg-white/10" />}
              </div>
            )
          })}
        </div>

        <div className="bg-black/80 backdrop-blur-xl border border-white/10 rounded-2xl p-7 sm:p-9">
          {stage === 'workspace' && (
            <>
              <div className="w-12 h-12 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center mx-auto mb-6"><Building2 className="w-6 h-6 text-purple-400" /></div>
              <h1 className="text-2xl font-bold text-white text-center mb-2">Create your workspace</h1>
              <p className="text-neutral-400 text-center mb-8">Your agent will use this workspace to prepare and ship your store presence.</p>
              <label htmlFor="workspace" className="block text-sm font-medium text-neutral-300 mb-2">Workspace name</label>
              <input id="workspace" value={workspaceName} onChange={event => setWorkspaceName(event.target.value)} maxLength={50} autoFocus className="w-full px-4 py-3 bg-black border border-white/10 rounded-xl text-white placeholder-neutral-500 focus:outline-none focus:border-purple-500" placeholder="My Workspace" />
              <button onClick={() => void saveWorkspace(false)} disabled={submitting} className="mt-6 w-full flex items-center justify-center gap-2 px-4 py-3 bg-purple-600 text-white rounded-xl font-medium hover:bg-purple-700 disabled:opacity-60">
                {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Bot className="w-4 h-4" />}
                Connect my agent
                {!submitting && <ArrowRight className="w-4 h-4" />}
              </button>
              <button onClick={() => void saveWorkspace(true)} disabled={submitting} className="mt-3 w-full text-sm text-neutral-500 hover:text-neutral-300">Use the dashboard without an agent</button>
            </>
          )}

          {stage === 'connect' && (
            <>
              <div className="w-12 h-12 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center mx-auto mb-6"><Bot className="w-6 h-6 text-purple-400" /></div>
              <h1 className="text-2xl font-bold text-white text-center mb-2">Continue in your agent</h1>
              <p className="text-neutral-400 text-center mb-7">Paste the secure setup prompt into Codex, Claude Code, Cursor, or another agent with terminal access.</p>

              {pairingLoading && <div className="py-10 flex items-center justify-center gap-3 text-neutral-400"><Loader2 className="w-5 h-5 animate-spin" /> Creating a single-use code…</div>}
              {pairing && (
                <>
                  <div className="p-5 rounded-xl bg-white/[0.03] border border-white/[0.1]">
                    <p className="text-xs uppercase tracking-[0.18em] text-neutral-500 text-center mb-2">Single-use pairing code</p>
                    <p className="font-mono text-2xl sm:text-3xl tracking-[0.16em] text-white text-center">{pairing.code}</p>
                    <p className="text-xs text-neutral-500 text-center mt-3">Expires {new Date(pairing.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                  </div>
                  <button onClick={() => void copyPrompt()} className="mt-4 w-full flex items-center justify-center gap-2 px-4 py-3 bg-white text-black rounded-xl font-semibold hover:bg-neutral-200">
                    {copied ? <Check className="w-4 h-4" /> : <Clipboard className="w-4 h-4" />}
                    {copied ? 'Setup prompt copied' : 'Copy full setup prompt'}
                  </button>
                  <button
                    onClick={() => setShowPrompt(current => !current)}
                    aria-expanded={showPrompt}
                    className="mt-3 w-full flex items-center justify-center gap-2 text-sm text-neutral-400 hover:text-white"
                  >
                    {showPrompt ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    {showPrompt ? 'Hide setup prompt' : 'View setup prompt'}
                  </button>
                  {showPrompt && (
                    <div className="mt-3 rounded-xl border border-white/[0.1] bg-black/70 overflow-hidden">
                      <div className="px-4 py-3 border-b border-white/[0.08]">
                        <p className="text-xs uppercase tracking-[0.16em] text-neutral-500">Setup prompt</p>
                      </div>
                      <pre className="px-4 py-4 max-h-52 overflow-auto whitespace-pre-wrap break-words text-xs leading-relaxed text-neutral-300 font-mono">{pairingPrompt}</pre>
                    </div>
                  )}
                  <button onClick={() => void createPairing()} className="mt-3 w-full flex items-center justify-center gap-2 text-sm text-neutral-500 hover:text-neutral-300"><RefreshCw className="w-3.5 h-3.5" /> Generate a new code</button>
                </>
              )}

              <div className="grid sm:grid-cols-2 gap-3 mt-7">
                <div className="p-4 rounded-xl bg-white/[0.02] border border-white/[0.08] flex gap-3"><LockKeyhole className="w-5 h-5 text-emerald-400 shrink-0" /><p className="text-xs leading-relaxed text-neutral-400">The code expires in 15 minutes and works once. Your permanent key is delivered only to the agent.</p></div>
                <div className="p-4 rounded-xl bg-white/[0.02] border border-white/[0.08] flex gap-3"><ShieldCheck className="w-5 h-5 text-blue-400 shrink-0" /><p className="text-xs leading-relaxed text-neutral-400">Publishing still requires your approval. Store private keys stay in the secure browser flow.</p></div>
              </div>
            </>
          )}

          {stage === 'connected' && (
            <div className="text-center py-3">
              <div className="w-14 h-14 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mx-auto mb-6"><CheckCircle2 className="w-7 h-7 text-emerald-400" /></div>
              <h1 className="text-2xl font-bold text-white mb-2">Your agent is connected</h1>
              <p className="text-neutral-400 max-w-md mx-auto">Continue in the agent conversation. It will ask which app you want to get store-ready, guide secure store connection, and produce your first readiness audit.</p>
              <div className="mt-7 flex items-center justify-center gap-2 text-sm text-neutral-500"><Loader2 className="w-4 h-4 animate-spin" /> Waiting for the first audit to complete…</div>
            </div>
          )}

          {stage === 'trial' && (
            <TrialStep
              trialDays={trial.offered ? trial.days : 0}
              initialPlan={trialIntent?.plan === 'enterprise' ? undefined : trialIntent?.plan}
              initialInterval={trialIntent?.interval}
              canceled={checkoutCanceled}
            />
          )}

          {stage === 'activating' && (
            <div className="text-center py-3" role="status">
              <div className="w-14 h-14 rounded-2xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center mx-auto mb-6"><Loader2 className="w-7 h-7 animate-spin text-purple-300" /></div>
              <h1 className="text-2xl font-bold text-white mb-2">Confirming your subscription</h1>
              <p className="text-neutral-400 max-w-md mx-auto">
                {activationDelayed
                  ? 'This is taking longer than usual. Keep this page open, or check the billing page before starting another checkout.'
                  : 'Stripe is confirming your trial. This page continues automatically.'}
              </p>
              {activationDelayed && <Link href="/billing" className="mt-6 inline-flex text-sm font-semibold text-purple-300 underline underline-offset-4">Open billing</Link>}
            </div>
          )}

          {error && <div className="mt-5 p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm">{error}</div>}
        </div>
      </div>
    </div>
  )
}

export default function OnboardingPage() {
  return <Suspense fallback={<div className="min-h-screen bg-black flex items-center justify-center"><Loader2 className="w-5 h-5 animate-spin text-neutral-400" /></div>}><OnboardingContent /></Suspense>
}
