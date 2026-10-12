import { NextRequest } from 'next/server'
import crypto from 'crypto'
import { z } from 'zod'
import { authenticateRequest, errorResponse, unauthorizedResponse } from '@/lib/api/auth'
import { getProjectContext, hasContextPermission, getAccountContext, AccountContext } from '@/lib/org/context'
import { getSession } from '@/lib/auth/session'
import { adminDb } from '@/lib/firebase/admin'
import { createReservationErrorResponse, refundUsage, reserveUsage, settleUsage } from '@/lib/api/usage'
import { logAuditEvent, AuditAction } from '@/lib/org/audit'
import { uploadFromUrl } from '@/lib/services/r2'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { AI_MODELS, getImageCreditWeight } from '@/lib/billing/catalog'
import { generateGeminiImageWithDirectFallback } from '@/lib/services/gemini-direct'

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)
const IMAGE_MODEL = AI_MODELS.imageDefault

const requestSchema = z.object({
  projectId: z.string(),
  displayType: z.string(),
  screenshotId: z.string(),
  rawImageUrl: z.string(),
  headline: z.string(),
  variantCount: z.number().min(2).max(4).default(3),
})

// Helper to get auth context
async function getAuthContext(request: NextRequest): Promise<{ context: AccountContext | null; error?: string }> {
  const authHeader = request.headers.get('Authorization')
  if (authHeader) {
    const auth = await authenticateRequest(request)
    if (auth.authenticated && auth.context) {
      return { context: auth.context }
    }
    return { context: null, error: auth.error }
  }

  const session = await getSession()
  if (session) {
    const context = await getAccountContext(session.userId)
    if (context) {
      return { context }
    }
    return { context: null, error: 'User not found' }
  }

  return { context: null, error: 'Authentication required' }
}

// Generate a single variant
async function generateVariant(
  rawImageUrl: string,
  headline: string,
  variationStyle: string
): Promise<{ success: boolean; url?: string; error?: string }> {
  try {
    // Fetch the raw image
    const response = await fetch(rawImageUrl)
    if (!response.ok) {
      throw new Error(`Failed to fetch image: ${response.statusText}`)
    }
    const imageBuffer = Buffer.from(await response.arrayBuffer())

    const prompt = `Create a professional App Store marketing screenshot with this variation style: ${variationStyle}

The screenshot should:
1. Use the provided app screenshot as the main visual
2. Add the headline text: "${headline}"
3. Apply the variation style for colors and decorative elements
4. Keep it professional and App Store appropriate
5. Maintain high quality suitable for 1290x2796 resolution

Generate a polished marketing screenshot.`

    const model = genAI.getGenerativeModel({
      model: IMAGE_MODEL,
      generationConfig: {
        responseModalities: ['TEXT', 'IMAGE'],
      } as Record<string, unknown>,
    })

    const contents = [{
      role: 'user' as const,
      parts: [
        { inlineData: { mimeType: 'image/png', data: imageBuffer.toString('base64') } },
        { text: prompt },
      ],
    }]
    const generated = await generateGeminiImageWithDirectFallback({
      model: IMAGE_MODEL,
      contents,
      generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
      generatePrimary: async () => {
        const result = await model.generateContent(contents[0].parts)
        const parts = result.response.candidates?.[0]?.content?.parts
        const imagePart = parts?.find(part => (part as { inlineData?: { data?: string } }).inlineData?.data)
        const data = (imagePart as { inlineData?: { data?: string } } | undefined)?.inlineData?.data
        return data ? Buffer.from(data, 'base64') : null
      },
    })
    const generatedImage = generated.image

    if (!generatedImage) {
      return { success: false, error: 'No image generated' }
    }

    const dataUrl = `data:image/png;base64,${generatedImage.toString('base64')}`
    return { success: true, url: dataUrl }
  } catch (error) {
    console.error('Variant generation error:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Generation failed',
    }
  }
}

const VARIATION_STYLES = [
  'vibrant gradients with warm colors (orange to pink), rounded decorative elements',
  'cool tones gradient (blue to purple), geometric shapes and lines',
  'minimal and clean with subtle shadows, monochrome accents',
  'bold and dynamic with high contrast colors, angular design elements',
]

export async function POST(request: NextRequest) {
  // Authenticate
  const { context: authContext, error: authError } = await getAuthContext(request)
  if (!authContext) {
    return unauthorizedResponse(authError)
  }

  // Parse request
  let body
  try {
    body = requestSchema.parse(await request.json())
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(`Validation error: ${error.errors.map(e => e.message).join(', ')}`)
    }
    return errorResponse('Invalid request body')
  }

  const { projectId, displayType, screenshotId, rawImageUrl, headline, variantCount } = body

  // Get project context
  const projectContext = await getProjectContext(authContext.userId, projectId)
  if (!projectContext) {
    return errorResponse('Project not found', 404)
  }

  // Check permission
  if (!hasContextPermission(projectContext, 'canCreateProjects')) {
    return errorResponse('Permission denied', 403)
  }

  const creditWeight = getImageCreditWeight('gemini', AI_MODELS.imageDefault, '1K')
  const operationId = request.headers.get('idempotency-key') || crypto.randomUUID()
  const reservation = await reserveUsage(authContext, {
    operationId,
    usageType: 'screenshots',
    units: variantCount * creditWeight,
    metadata: { route: '/api/screenshots/generate-variants', projectId, model: AI_MODELS.imageDefault },
  })
  if (!reservation.allowed) return createReservationErrorResponse(reservation)
  if (reservation.replayed) return errorResponse('This variant operation was already processed', 409)

  try {
    const variants: Array<{
      id: string
      marketingImageUrl: string
      marketingImageKey: string
      styleVariation: string
    }> = []

    // Generate variants with rate limiting
    for (let i = 0; i < variantCount; i++) {
      const variationStyle = VARIATION_STYLES[i % VARIATION_STYLES.length]

      // Rate limiting between generations
      if (i > 0) {
        await new Promise(resolve => setTimeout(resolve, 2000))
      }

      const result = await generateVariant(rawImageUrl, headline, variationStyle)

      if (result.success && result.url) {
        // Upload to R2
        const uploaded = await uploadFromUrl({
          userId: projectContext.type === 'organization' ? undefined : authContext.userId,
          orgId: projectContext.orgId || undefined,
          projectId,
          category: 'generated',
          filename: `variant-${displayType}-${screenshotId}-${i}-${Date.now()}.png`,
          sourceUrl: result.url,
        })

        variants.push({
          id: `variant-${screenshotId}-${i}`,
          marketingImageUrl: uploaded.url,
          marketingImageKey: uploaded.key,
          styleVariation: variationStyle.split(',')[0], // Use first part as label
        })
      }
    }

    if (variants.length === 0) {
      await refundUsage(authContext, operationId, 'screenshots')
      return errorResponse('Failed to generate any variants')
    }

    await settleUsage(authContext, operationId, 'screenshots', variants.length * creditWeight)

    // Log audit event
    if (projectContext.type === 'organization' && projectContext.orgId) {
      await logAuditEvent({
        orgId: projectContext.orgId,
        action: AuditAction.PROJECT_UPDATED,
        userId: authContext.userId,
        resourceType: 'project',
        resourceId: projectId,
        metadata: {
          action: 'screenshots_generate_variants',
          displayType,
          screenshotId,
          variantsGenerated: variants.length,
        },
      })
    }

    return Response.json({
      success: true,
      variants,
      creditsUsed: variants.length * creditWeight,
    })
  } catch (error) {
    await refundUsage(authContext, operationId, 'screenshots')
    console.error('Error generating variants:', error)
    return errorResponse(
      error instanceof Error ? error.message : 'Failed to generate variants',
      500
    )
  }
}
