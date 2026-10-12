'use client'

import { useMemo, useState } from 'react'
import {
  ArrowUpRight,
  Bot,
  CalendarCheck2,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Copy,
  Filter,
  Loader2,
  Mail,
  Store,
  UserCheck,
  Users,
} from 'lucide-react'
import { conciergeLeadStatuses, type ConciergeLeadStatus } from '@/lib/concierge'

export interface SetupLead {
  id: string
  name: string
  email: string
  company: string
  appName: string
  appStatus: string
  platforms: string[]
  appCount: string
  launchTiming: string
  customerType: string
  preferredPlan: string
  preferredAgent: string
  biggestStoreProblem: string
  status: string
  qualificationScore: number
  qualificationReasons: string[]
  operatorNotes: string
  source: string
  createdAt: string
  scheduledAt: string | null
}
const callChecklist = `APPLISTINGAGENT SETUP — 30 MINUTES

0–5 min  Confirm the app, launch goal, and success criteria
5–15 min Approve account access and connect or stage one app
15–25 min Pair the customer's agent and run the readiness audit
25–30 min Review priorities, choose a plan, and agree the next action

Never ask the customer to paste private store credentials into notes or chat.`

const statusColor: Record<string, string> = {
  qualified: 'border-lime-300/25 bg-lime-300/[0.08] text-lime-200',
  booked: 'border-sky-300/25 bg-sky-300/[0.08] text-sky-200',
  attended: 'border-violet-300/25 bg-violet-300/[0.08] text-violet-200',
  approved: 'border-amber-300/25 bg-amber-300/[0.08] text-amber-200',
  activated: 'border-emerald-300/25 bg-emerald-300/[0.08] text-emerald-200',
  paid: 'border-emerald-300/25 bg-emerald-300/[0.08] text-emerald-200',
  waitlisted: 'border-white/10 bg-white/[0.04] text-white/45',
  closed: 'border-red-300/20 bg-red-300/[0.06] text-red-200',
}

export function SetupCallQueue({ initialLeads }: { initialLeads: SetupLead[] }) {
  const [leads, setLeads] = useState(initialLeads)
  const [filter, setFilter] = useState('active')
  const [selectedId, setSelectedId] = useState(initialLeads[0]?.id || '')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [notes, setNotes] = useState(initialLeads[0]?.operatorNotes || '')

  const filtered = useMemo(() => leads.filter(lead => {
    if (filter === 'all') return true
    if (filter === 'active') return !['paid', 'closed', 'waitlisted'].includes(lead.status)
    return lead.status === filter
  }), [filter, leads])
  const selected = leads.find(lead => lead.id === selectedId) || filtered[0] || null

  const counts = {
    qualified: leads.filter(lead => lead.status === 'qualified').length,
    booked: leads.filter(lead => lead.status === 'booked').length,
    attended: leads.filter(lead => ['attended', 'approved', 'activated', 'paid'].includes(lead.status)).length,
    paid: leads.filter(lead => lead.status === 'paid').length,
  }

  const selectLead = (lead: SetupLead) => {
    setSelectedId(lead.id)
    setNotes(lead.operatorNotes)
    setMessage('')
  }

  const updateLead = async (status: ConciergeLeadStatus) => {
    if (!selected) return
    setSaving(true)
    setMessage('')
    try {
      const response = await fetch('/api/concierge/internal/leads', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadId: selected.id, status, notes }),
      })
      if (!response.ok) throw new Error('Update failed')
      setLeads(current => current.map(lead => lead.id === selected.id ? { ...lead, status, operatorNotes: notes } : lead))
      setMessage(status === 'approved' ? 'Access approved. This email can now create an account.' : `Lead moved to ${status}.`)
    } catch {
      setMessage('Could not update this lead.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mx-auto max-w-[90rem]">
      <div className="mb-8 flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
        <div><p className="mb-2 font-mono text-[11px] uppercase tracking-[0.2em] text-lime-300/65">Internal concierge desk</p><h1 className="text-3xl font-semibold tracking-tight text-white">Setup calls</h1><p className="mt-2 text-sm text-white/40">Qualify, prepare, activate, and learn from every assisted customer.</p></div>
        <button onClick={() => void navigator.clipboard.writeText(callChecklist)} className="flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white/65 transition hover:bg-white/[0.08] hover:text-white"><Copy className="h-4 w-4" /> Copy 30-minute checklist</button>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-px overflow-hidden border border-white/[0.08] bg-white/[0.08] lg:grid-cols-4">
        {[[Users, 'Qualified', counts.qualified], [CalendarCheck2, 'Booked', counts.booked], [UserCheck, 'Attended+', counts.attended], [CheckCircle2, 'Paid', counts.paid]].map(([Icon, label, value]) => {
          const StatIcon = Icon as typeof Users
          return <div key={label as string} className="bg-[#080908] p-5"><StatIcon className="mb-4 h-4 w-4 text-white/35" /><p className="text-2xl font-semibold text-white">{value as number}</p><p className="mt-1 text-xs uppercase tracking-[0.14em] text-white/30">{label as string}</p></div>
        })}
      </div>

      <div className="grid min-h-[620px] overflow-hidden border border-white/[0.08] bg-[#080908] lg:grid-cols-[0.78fr_1.22fr]">
        <div className="border-b border-white/[0.08] lg:border-b-0 lg:border-r">
          <div className="flex items-center gap-3 border-b border-white/[0.08] p-4"><Filter className="h-4 w-4 text-white/30" /><select value={filter} onChange={event => setFilter(event.target.value)} className="w-full bg-transparent text-sm text-white/60 outline-none"><option value="active">Active pipeline</option><option value="qualified">Qualified</option><option value="booked">Booked</option><option value="waitlisted">Waitlisted</option><option value="paid">Paid</option><option value="all">All leads</option></select><ChevronDown className="h-4 w-4 text-white/25" /></div>
          <div className="max-h-[560px] overflow-y-auto">
            {filtered.map(lead => (
              <button key={lead.id} onClick={() => selectLead(lead)} className={`w-full border-b border-white/[0.06] p-5 text-left transition ${selected?.id === lead.id ? 'bg-white/[0.065]' : 'hover:bg-white/[0.03]'}`}>
                <div className="flex items-start justify-between gap-3"><div><p className="font-medium text-white">{lead.name}</p><p className="mt-1 text-sm text-white/35">{lead.appName}{lead.company ? ` · ${lead.company}` : ''}</p></div><span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.1em] ${statusColor[lead.status] || statusColor.waitlisted}`}>{lead.status}</span></div>
                <div className="mt-4 flex items-center justify-between text-xs text-white/28"><span>{lead.preferredPlan} · score {lead.qualificationScore}</span><span>{new Date(lead.createdAt).toLocaleDateString()}</span></div>
              </button>
            ))}
            {!filtered.length && <p className="p-8 text-center text-sm text-white/30">No leads in this view.</p>}
          </div>
        </div>

        {selected ? (
          <div className="p-6 sm:p-8">
            <div className="flex flex-col justify-between gap-5 border-b border-white/[0.08] pb-7 sm:flex-row sm:items-start">
              <div><div className="flex items-center gap-3"><h2 className="text-2xl font-semibold text-white">{selected.name}</h2><span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.1em] ${statusColor[selected.status] || statusColor.waitlisted}`}>{selected.status}</span></div><p className="mt-2 text-sm text-white/38">{selected.email}{selected.company ? ` · ${selected.company}` : ''}</p></div>
              <a href={`mailto:${selected.email}`} className="flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-sm text-white/55 hover:text-white"><Mail className="h-4 w-4" /> Email <ArrowUpRight className="h-3.5 w-3.5" /></a>
            </div>

            <div className="grid gap-px border-b border-white/[0.08] bg-white/[0.07] py-px sm:grid-cols-3">
              {[[Store, 'App', selected.appName], [Bot, 'Agent', selected.preferredAgent], [Clock3, 'Timing', selected.launchTiming.replaceAll('_', ' ')]].map(([Icon, label, value]) => { const DetailIcon = Icon as typeof Store; return <div key={label as string} className="bg-[#080908] py-6 sm:px-5"><DetailIcon className="mb-3 h-4 w-4 text-lime-200/55" /><p className="text-[10px] uppercase tracking-[0.16em] text-white/25">{label as string}</p><p className="mt-1.5 text-sm capitalize text-white/65">{value as string}</p></div> })}
            </div>

            <div className="grid gap-8 py-7 lg:grid-cols-2">
              <div><p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/28">Preparation brief</p><p className="mt-4 text-sm leading-relaxed text-white/62">{selected.biggestStoreProblem}</p><div className="mt-5 flex flex-wrap gap-2">{selected.qualificationReasons.map(reason => <span key={reason} className="border border-lime-200/15 bg-lime-200/[0.04] px-2.5 py-1.5 text-xs text-lime-100/55">{reason}</span>)}</div></div>
              <div><label className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/28">Operator notes</label><textarea value={notes} onChange={event => setNotes(event.target.value)} className="mt-4 min-h-36 w-full resize-y border border-white/[0.08] bg-white/[0.025] p-4 text-sm leading-relaxed text-white outline-none focus:border-white/20" placeholder="No credentials. Record goals, objections, outcome, and the next action." /></div>
            </div>

            <div className="border-t border-white/[0.08] pt-6"><p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/28">Move customer</p><div className="flex flex-wrap gap-2">{conciergeLeadStatuses.filter(status => !['applied', 'waitlisted'].includes(status)).map(status => <button key={status} disabled={saving || selected.status === status} onClick={() => void updateLead(status)} className="rounded-lg border border-white/10 bg-white/[0.035] px-3 py-2 text-xs capitalize text-white/55 transition hover:bg-white/[0.08] hover:text-white disabled:opacity-25">{saving && selected.status !== status ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : status}</button>)}</div>{message && <p className={`mt-4 text-sm ${message.startsWith('Could') ? 'text-red-300' : 'text-lime-200/70'}`}>{message}</p>}</div>
          </div>
        ) : <div className="flex items-center justify-center p-10 text-sm text-white/30">Select a lead to prepare the call.</div>}
      </div>
    </div>
  )
}
