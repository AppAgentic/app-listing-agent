import { z } from 'zod'
import { conciergeEventNames } from '@/lib/concierge'

export const eventSchema = z.object({
  name: z.enum(conciergeEventNames),
  leadId: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  trackingToken: z.string().min(20).max(100).optional(),
  sessionId: z.string().uuid().optional(),
  source: z.string().trim().max(100).optional(),
  metadata: z.record(z.string().max(100), z.union([z.string().max(200), z.number(), z.boolean(), z.null()])).refine(value => Object.keys(value).length <= 32, 'Too many metadata entries').optional(),
})

