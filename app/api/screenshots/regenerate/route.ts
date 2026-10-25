import { readBoundedJson, RequestBodyLimitError } from '@/lib/api/bounded-body'
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
import { Timestamp } from 'firebase-admin/firestore'
import { generateGeminiImageWithDirectFallback } from '@/lib/services/gemini-direct'

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)
const IMAGE_MODEL = AI_MODELS.imageDefault

const requestSchema = z.object({
  projectId: z.string(),
  displayType: z.string(),
  screenshotId: z.string(),
  rawImageUrl: z.string(),
  headline: z.string(),
  styleConfig: z.object({
    type: z.enum(['match-existing', 'category', 'reference']),
    referenceImageUrl: z.string().optional(),
    category: z.string().optional(),
    customColors: z.object({
      primary: z.string(),
      secondary: z.string(),
    }).optional(),
  }).optional(),
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

// Generate marketing screenshot
async function generateMarketingScreenshot(
  rawImageUrl: string,
  headline: string,
  styleConfig?: z.infer<typeof requestSchema>['styleConfig']
): Promise<{ success: boolean; url?: string; error?: string }> {
  try {
    // Fetch the raw image
    const response = await fetch(rawImageUrl)
    if (!response.ok) {
      throw new Error(`Failed to fetch image: ${response.statusText}`)
    }
    const imageBuffer = Buffer.from(await response.arrayBuffer())

    // Build style description
    let styleDescription = 'professional marketing style with modern gradients'
    if (styleConfig) {
      if (styleConfig.type === 'category' && styleConfig.category) {
        styleDescription = `${styleConfig.category} app style with appropriate colors and mood`
      } else if (styleConfig.customColors) {
        styleDescription = `gradient from ${styleConfig.customColors.primary} to ${styleConfig.customColors.secondary}`
      }
    }

    const prompt = `Create a professional App Store marketing screenshot.

The screenshot should:
1. Use the provided app screenshot as the main visual
2. Add this headline text prominently: "${headline}"
3. Apply ${styleDescription} for the background and decorative elements
4. Include subtle decorative elements that complement the app
5. Keep it professional and App Store appropriate
6. Maintain high quality suitable for 1290x2796 resolution

Generate a polished marketing screenshot ready for the App Store.`

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
    console.error('Screenshot regeneration error:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Generation failed',
    }
  }
}

export async function POST(request: NextRequest) {
  // Authenticate
  const { context: authContext, error: authError } = await getAuthContext(request)
  if (!authContext) {
    return unauthorizedResponse(authError)
  }

  // Parse request
  let body
  try {
    body = requestSchema.parse(await readBoundedJson(request))
  } catch (error) {
    if (error instanceof RequestBodyLimitError) return Response.json({ error: error.message }, { status: 413 })
    if (error instanceof z.ZodError) {
      return errorResponse(`Validation error: ${error.issues.map(e => e.message).join(', ')}`)
    }
    return errorResponse('Invalid request body')
  }

  const { projectId, displayType, screenshotId, rawImageUrl, headline, styleConfig } = body

  // Get project context
  const projectContext = await getProjectContext(authContext.userId, projectId)
  if (!projectContext) {
    return errorResponse('Project not found', 404)
  }

  // Check permission
  if (!hasContextPermission(projectContext, 'canCreateProjects')) {
    return errorResponse('Permission denied', 403)
  }

  // Get base path for this project
  const basePath = projectContext.type === 'organization' && projectContext.orgId
    ? adminDb
        .collection('organizations')
        .doc(projectContext.orgId)
        .collection('projects')
        .doc(projectId)
    : adminDb
        .collection('users')
        .doc(authContext.userId)
        .collection('projects')
        .doc(projectId)

  const creditWeight = getImageCreditWeight('gemini', AI_MODELS.imageDefault, '1K')
  const operationId = request.headers.get('idempotency-key') || crypto.randomUUID()
  const reservation = await reserveUsage(authContext, {
    operationId,
    usageType: 'screenshots',
    units: creditWeight,
    metadata: { route: '/api/screenshots/regenerate', projectId, model: AI_MODELS.imageDefault },
  })
  if (!reservation.allowed) return createReservationErrorResponse(reservation)
  if (reservation.replayed) return errorResponse('This regeneration was already processed', 409)

  try {
    // Generate the new screenshot
    const result = await generateMarketingScreenshot(rawImageUrl, headline, styleConfig)

    if (!result.success) {
      await refundUsage(authContext, operationId, 'screenshots')
      return errorResponse(result.error || 'Failed to regenerate screenshot')
    }

    // Upload to R2
    const uploaded = await uploadFromUrl({
      userId: projectContext.type === 'organization' ? undefined : authContext.userId,
      orgId: projectContext.orgId || undefined,
      projectId,
      category: 'generated',
      filename: `regenerated-${displayType}-${screenshotId}-${Date.now()}.png`,
      sourceUrl: result.url!,
    })

    const now = Timestamp.now()

    // Update in Firestore if screenshot set exists
    const screenshotSetDoc = await basePath.collection('screenshots').doc(displayType).get()
    if (screenshotSetDoc.exists) {
      const screenshotSet = screenshotSetDoc.data()!
      const updatedScreenshots = screenshotSet.screenshots.map((s: any) => {
        if (s.id === screenshotId) {
          return {
            ...s,
            marketingImageUrl: uploaded.url,
            marketingImageKey: uploaded.key,
            headline,
            updatedAt: now,
          }
        }
        return s
      })

      await basePath.collection('screenshots').doc(displayType).update({
        screenshots: updatedScreenshots,
        updatedAt: now,
        syncStatus: 'local_changes',
      })

      // Update project sync status
      await basePath.update({
        screenshotSyncStatus: 'local_changes',
        updatedAt: now,
      })
    }

    await settleUsage(authContext, operationId, 'screenshots', creditWeight)

    // Log audit event
    if (projectContext.type === 'organization' && projectContext.orgId) {
      await logAuditEvent({
        orgId: projectContext.orgId,
        action: AuditAction.PROJECT_UPDATED,
        userId: authContext.userId,
        resourceType: 'project',
        resourceId: projectId,
        metadata: {
          action: 'screenshot_regenerate',
          displayType,
          screenshotId,
        },
      })
    }

    return Response.json({
      success: true,
      screenshot: {
        id: screenshotId,
        marketingImageUrl: uploaded.url,
        marketingImageKey: uploaded.key,
        headline,
      },
      creditsUsed: creditWeight,
    })
  } catch (error) {
    await refundUsage(authContext, operationId, 'screenshots')
    console.error('Error regenerating screenshot:', error)
    return errorResponse(
      error instanceof Error ? error.message : 'Failed to regenerate screenshot',
      500
    )
  }
}
