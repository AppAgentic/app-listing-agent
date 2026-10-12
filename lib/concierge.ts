import { z } from 'zod'

export const conciergeLeadSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().email().max(254),
  company: z.string().trim().max(120).optional().default(''),
  appName: z.string().trim().min(2).max(120),
  appStatus: z.enum(['live', 'store_console', 'not_created']),
  platforms: z.array(z.enum(['ios', 'android'])).min(1).max(2),
  appCount: z.enum(['1-3', '4-10', '11-50', '50+']),
  launchTiming: z.enum(['this_month', 'next_90_days', 'exploring']),
  customerType: z.enum(['indie_developer', 'app_studio', 'enterprise', 'agency', 'other']),
  preferredPlan: z.enum(['starter', 'pro', 'business', 'enterprise', 'unsure']),
  preferredAgent: z.enum(['codex', 'claude', 'cursor', 'other', 'none']),
  biggestStoreProblem: z.string().trim().min(10).max(1000),
  source: z.string().trim().max(100).optional().default('direct'),
  utm: z.object({
    source: z.string().trim().max(100).optional(),
    medium: z.string().trim().max(100).optional(),
    campaign: z.string().trim().max(200).optional(),
    content: z.string().trim().max(200).optional(),
    term: z.string().trim().max(200).optional(),
    fbclid: z.string().trim().max(500).optional(),
    twclid: z.string().trim().max(500).optional(),
    gclid: z.string().trim().max(500).optional(),
    oppref: z.string().trim().max(500).optional(),
  }).optional(),
})

export type ConciergeLeadInput = z.infer<typeof conciergeLeadSchema>

export const conciergeLeadStatuses = [
  'applied',
  'qualified',
  'waitlisted',
  'booked',
  'attended',
  'approved',
  'activated',
  'paid',
  'closed',
] as const

export type ConciergeLeadStatus = typeof conciergeLeadStatuses[number]

export const conciergeEventNames = [
  'cta_clicked',
  'application_started',
  'application_submitted',
  'calendar_viewed',
  'booking_confirmed',
  'call_attended',
  'account_approved',
  'agent_paired',
  'first_audit_completed',
  'checkout_started',
  'paid',
  'week_two_active',
] as const

export type ConciergeEventName = typeof conciergeEventNames[number]

export interface QualificationResult {
  qualified: boolean
  score: number
  reasons: string[]
}

export function qualifyConciergeLead(input: ConciergeLeadInput): QualificationResult {
  let score = 0
  const reasons: string[] = []

  const planPoints = {
    starter: 0,
    pro: 3,
    business: 4,
    enterprise: 5,
    unsure: 1,
  }[input.preferredPlan]
  score += planPoints
  if (planPoints >= 3) reasons.push('Pro-or-higher plan intent')

  const appPoints = {
    '1-3': 0,
    '4-10': 3,
    '11-50': 4,
    '50+': 5,
  }[input.appCount]
  score += appPoints
  if (appPoints > 0) reasons.push('Multi-app portfolio')

  if (input.launchTiming === 'this_month') {
    score += 3
    reasons.push('Launching this month')
  } else if (input.launchTiming === 'next_90_days') {
    score += 2
    reasons.push('Launching within 90 days')
  }

  if (input.appStatus !== 'not_created') {
    score += 2
    reasons.push('App already exists in a store console')
  }

  if (['agency', 'app_studio', 'enterprise'].includes(input.customerType)) {
    score += 2
    reasons.push('Studio, agency, or enterprise operator')
  }

  return { qualified: score >= 5, score, reasons }
}

const progressedLeadStatuses = new Set<ConciergeLeadStatus>(['booked', 'attended', 'approved', 'activated', 'paid'])

export function nextLeadStatus(
  previousStatus: unknown,
  disposition: Extract<ConciergeLeadStatus, 'qualified' | 'waitlisted'>,
): ConciergeLeadStatus {
  return typeof previousStatus === 'string' && progressedLeadStatuses.has(previousStatus as ConciergeLeadStatus)
    ? previousStatus as ConciergeLeadStatus
    : disposition
}

export function nextWaitlistStatus(previousStatus: unknown, leadStatus: ConciergeLeadStatus): 'pending' | 'approved' | 'converted' {
  if (previousStatus === 'converted' || leadStatus === 'paid') return 'converted'
  if (previousStatus === 'approved' || ['approved', 'activated'].includes(leadStatus)) return 'approved'
  return 'pending'
}
