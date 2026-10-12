import { describe, expect, it } from 'vitest'
import {
  conciergeLeadSchema,
  nextLeadStatus,
  nextWaitlistStatus,
  qualifyConciergeLead,
} from '@/lib/concierge'

const baseLead = {
  name: 'Alex Morgan',
  email: 'alex@example.com',
  company: 'Acme Apps',
  appName: 'Acme Mobile',
  appStatus: 'not_created' as const,
  platforms: ['ios'] as const,
  appCount: '1-3' as const,
  launchTiming: 'exploring' as const,
  customerType: 'indie_developer' as const,
  preferredPlan: 'starter' as const,
  preferredAgent: 'codex' as const,
  biggestStoreProblem: 'We need a clearer store launch process.',
  source: 'test',
}

describe('concierge qualification', () => {
  it('sends early exploratory Solo applicants to the assisted async path', () => {
    const lead = conciergeLeadSchema.parse(baseLead)
    expect(qualifyConciergeLead(lead)).toEqual({ qualified: false, score: 0, reasons: [] })
  })

  it('qualifies a near-term Pro app that already exists in a store console', () => {
    const lead = conciergeLeadSchema.parse({
      ...baseLead,
      appStatus: 'store_console',
      launchTiming: 'this_month',
      preferredPlan: 'pro',
    })
    expect(qualifyConciergeLead(lead)).toMatchObject({ qualified: true, score: 8 })
  })

  it('qualifies a multi-app studio even when the app is not created yet', () => {
    const lead = conciergeLeadSchema.parse({
      ...baseLead,
      appCount: '4-10',
      customerType: 'app_studio',
    })
    expect(qualifyConciergeLead(lead)).toMatchObject({ qualified: true, score: 5 })
  })

  it('requires a real problem statement and at least one platform', () => {
    expect(conciergeLeadSchema.safeParse({ ...baseLead, biggestStoreProblem: 'Too slow' }).success).toBe(false)
    expect(conciergeLeadSchema.safeParse({ ...baseLead, platforms: [] }).success).toBe(false)
  })

  it('accepts the persisted OpenAI click reference on an assisted lead', () => {
    const lead = conciergeLeadSchema.parse({
      ...baseLead,
      utm: {
        source: 'chatgpt',
        campaign: 'launch',
        oppref: 'opaque-openai-click',
      },
    })
    expect(lead.utm).toEqual({
      source: 'chatgpt',
      campaign: 'launch',
      oppref: 'opaque-openai-click',
    })
  })

  it('never downgrades a progressed customer when they reapply', () => {
    expect(nextLeadStatus('booked', 'qualified')).toBe('booked')
    expect(nextLeadStatus('activated', 'waitlisted')).toBe('activated')
    expect(nextLeadStatus('paid', 'qualified')).toBe('paid')
    expect(nextWaitlistStatus('approved', 'qualified')).toBe('approved')
    expect(nextWaitlistStatus('pending', 'paid')).toBe('converted')
  })
})
