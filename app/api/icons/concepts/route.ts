import { NextRequest } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth/session'
import { getProjectContext, hasContextPermission } from '@/lib/org/context'
import { rateLimit, RATE_LIMITS } from '@/lib/api/rate-limit'
import { APP_CATEGORIES } from '@/lib/constants'
import { generateIconConcepts } from '@/lib/services/icon-concepts'
const schema = z.object({
  projectId: z.string(), count: z.number().int().min(1).max(4).default(4),
  metadata: z.object({ title: z.string().max(10000), subtitle: z.string().max(1000).optional(), description: z.string().max(10000).optional(), keywords: z.string().max(1000).optional(), category: z.enum(APP_CATEGORIES).optional() }),
  colors: z.object({ primary: z.string().regex(/^#[\da-f]{6}$/i), secondary: z.string().regex(/^#[\da-f]{6}$/i).optional() }).optional(),
})
export async function POST(request: NextRequest) {
  const session = await getSession()
  if (!session) return Response.json({ error: 'Authentication required' }, { status: 401 })
  if (!(await rateLimit(request, RATE_LIMITS.ai, { userId: session.userId })).success) return Response.json({ error: 'Rate limit exceeded' }, { status: 429 })
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return Response.json({ error: 'Invalid concept request' }, { status: 400 })
  const { projectId, metadata, count, colors } = parsed.data
  const context = await getProjectContext(session.userId, projectId)
  if (!context || !hasContextPermission(context, 'canCreateProjects')) return Response.json({ error: 'Permission denied' }, { status: 403 })
  return Response.json({ concepts: await generateIconConcepts(metadata, count, colors) })
}
