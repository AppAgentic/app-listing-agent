import { NextRequest } from 'next/server'
import { z } from 'zod'
import { randomUUID } from 'crypto'
import { getSession } from '@/lib/auth/session'
import { getAccountContext } from '@/lib/org/context'
import { createReservationErrorResponse, refundUsage, reserveUsage, settleUsage } from '@/lib/api/usage'
import { renderIconImage, getIconEngine } from '@/lib/services/icon-engine'
import { uploadFile } from '@/lib/services/r2'
import { ICON_CONSTRAINTS } from '@/lib/services/icon-prompt'
import { ICON_STYLES } from '@/lib/constants'
import { ICON_STYLE_LABELS, getStyleInstructions } from '@/lib/services/icon-styles'
import { isAllowedImageUrl } from '@/lib/api/ssrf-protection'

const experimentSchema = z.object({
  prompt: z.string().min(10),
  referenceImageUrl: z.string().url().optional(),
  resolution: z.literal('1K').default('1K'),
})

export async function POST(request: NextRequest) {
  // Require authentication
  const session = await getSession()
  if (!session) {
    return Response.json({ error: 'Authentication required' }, { status: 401 })
  }
  const accountContext = await getAccountContext(session.userId)
  if (!accountContext) {
    return Response.json({ error: 'Account not found' }, { status: 404 })
  }

  // Parse request
  let body
  try {
    body = experimentSchema.parse(await request.json())
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json({ error: error.errors.map(e => e.message).join(', ') }, { status: 400 })
    }
    return Response.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { prompt, referenceImageUrl } = body
  if (referenceImageUrl && !isAllowedImageUrl(referenceImageUrl)) return Response.json({ error: 'Invalid reference URL' }, { status: 400 })
  const operationId = `icon-experiment:${request.headers.get('idempotency-key') || randomUUID()}`
  const creditWeight = getIconEngine().creditWeight
  const reservation = await reserveUsage(accountContext, {
    operationId,
    usageType: 'icons',
    units: creditWeight,
    metadata: { route: 'icon-experiment', provider: getIconEngine().provider, model: getIconEngine().model },
  })
  if (!reservation.allowed) return createReservationErrorResponse(reservation)
  if (reservation.replayed) {
    return Response.json({ error: 'This icon experiment has already been processed' }, { status: 409 })
  }

  try {
    const started = Date.now()
    const promptUsed = `${prompt}\n${ICON_CONSTRAINTS}`
    const data = await renderIconImage(promptUsed, referenceImageUrl ? [referenceImageUrl] : [])
    const uploaded = await uploadFile({ userId: session.userId, projectId: 'icon-experiments', category: 'icons', filename: `${randomUUID()}.png`, data, contentType: 'image/png' })
    await settleUsage(accountContext, operationId, 'icons', creditWeight)

    return Response.json({
      success: true,
      image: {
        url: uploaded.url, width: 1024, height: 1024,
      },
      inferenceTime: (Date.now() - started) / 1000,
      promptUsed,
    })
  } catch (error) {
    await refundUsage(accountContext, operationId, 'icons')
    console.error('[icon-experiment] Error:', error)
    return Response.json(
      { error: error instanceof Error ? error.message : 'Failed to generate icon' },
      { status: 500 }
    )
  }
}

/**
 * GET endpoint to list available preset prompts for experimentation
 */
export async function GET() {
  const presets = Object.fromEntries(ICON_STYLES.map(style => [style, {
    name: ICON_STYLE_LABELS[style],
    prompt: `${getStyleInstructions(style)}\n${ICON_CONSTRAINTS}`,
    description: getStyleInstructions(style),
  }]))
  return Response.json({ presets })
}
