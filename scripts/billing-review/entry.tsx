import React from 'react'
import { createRoot } from 'react-dom/client'
import BillingClient from '../../components/billing/billing-client'
import { BILLING_PLANS } from '../../lib/billing/catalog'
window.addEventListener('error', e => { (window as any).__fixtureError = e.message })
const scenario = new URLSearchParams(location.search).get('scenario') || 'free'
const paid = ['paid', 'success'].includes(scenario)
const plan = paid ? 'pro' : 'free'
const limits = BILLING_PLANS[plan].limits
const subscription = { plan, status: scenario === 'past_due' ? 'past_due' : 'active', renewsAt: paid ? '2026-10-07T00:00:00.000Z' : null, cancelledAt: null, billingInterval: scenario === 'success' ? 'annual' : paid ? 'monthly' : null, cancelAtPeriodEnd: false, hasExistingSubscription: paid || scenario === 'past_due', canManageBilling: scenario !== 'nonowner', canOpenPortal: paid || scenario === 'past_due', trialEligible: scenario === 'free', trialDays: 7, subscriptionId: paid || scenario === 'past_due' ? 'sub_fixture' : null }
const usage = { month: '2026-09', ...Object.fromEntries(['translations', 'screenshots', 'icons', 'uploads', 'apps'].map(key => [key, { used: key === 'apps' ? 1 : 0, reserved: 0, limit: limits[(key === 'uploads' ? 'publishing' : key) as keyof typeof limits] }])) }
;(window as any).__fixtureRequests = []
window.fetch = async (input, init) => {
  const path = String(input)
  ;(window as any).__fixtureRequests.push({ path, method: init?.method || 'GET', body: init?.body || null })
  if (path === '/api/subscription') return new Response(JSON.stringify(subscription))
  if (path === '/api/usage') return new Response(JSON.stringify(usage))
  return new Response(JSON.stringify({ error: 'Fixture intercepted; no checkout or provider request sent.' }), {status: 503})
}
document.addEventListener('click', e => { const anchor = (e.target as Element).closest('a'); if (anchor && !anchor.getAttribute('href')?.startsWith('#')) { e.preventDefault(); (window as any).__fixtureNavigation = anchor.getAttribute('href') } }, true)
createRoot(document.getElementById('root')!).render(<><aside className="fixture-sidebar"><b>App Listing Agent</b><p>Demo workspace</p><nav>Overview<br/>My apps<br/>Store tools<br/>Team<br/><strong>Plans & billing</strong><br/>Settings</nav></aside><div className="fixture-main"><div className="fixture-label">LOCAL REVIEW · Fixture account · Provider requests blocked</div><main><BillingClient /></main></div></>)
