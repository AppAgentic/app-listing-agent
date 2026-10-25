import { readBoundedJson, RequestBodyLimitError } from '@/lib/api/bounded-body'
import { NextRequest } from 'next/server'
import crypto from 'crypto'
import { z } from 'zod'
import { authenticateRequest, errorResponse, unauthorizedResponse } from '@/lib/api/auth'
import { getProjectContext, hasContextPermission, getAccountContext, AccountContext } from '@/lib/org/context'
import { getSession } from '@/lib/auth/session'
import { adminDb } from '@/lib/firebase/admin'
import { createReservationErrorResponse, refundUsage, reserveUsage, settleUsage } from '@/lib/api/usage'
import { uploadFromUrl } from '@/lib/services/r2'
import { AI_MODELS, getImageCreditWeight } from '@/lib/billing/catalog'

const FAL_API_KEY = process.env.FAL_KEY!
const FAL_MODEL_URL = 'https://fal.run/fal-ai/nano-banana-pro/edit'

const requestSchema = z.object({
  projectId: z.string(),
  displayType: z.string(),
  screenshotId: z.string(),
  locale: z.string().optional(), // If editing a translated screenshot (target locale)
  sourceLocale: z.string().optional(), // Primary language locale (e.g., "en-US") for translation context
  prompt: z.string().min(1, 'Edit prompt is required'),
  contextImageUrl: z.string().optional(), // Primary reference image (backwards compatibility)
  contextImageUrls: z.array(z.string()).max(4).optional(), // Multiple reference images (up to 4)
  variationCount: z.number().min(1).max(4).default(1),
  currentImageUrl: z.string().optional(), // For iterative editing (use a variation as new base)
  isPrimaryReference: z.boolean().optional(), // Whether the first context image is the primary language version
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

// Helper to sleep for rate limiting
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// Translation context for enhanced prompts
interface TranslationContext {
  isTranslated: boolean
  sourceLocale?: string // Primary language (e.g., "en-US")
  targetLocale?: string // Current locale being edited (e.g., "es-ES")
  hasPrimaryReference?: boolean // Whether the primary language image is included as reference
}

// Generate edited screenshot variations using fal.ai nano-banana-pro
async function generateEditedScreenshots(
  sourceImageUrl: string,
  editPrompt: string,
  numImages: number = 1,
  contextImageUrls?: string[], // Support multiple context images
  translationContext?: TranslationContext
): Promise<{ success: boolean; urls?: string[]; error?: string }> {
  try {
    // Build the image URLs array - source image first, then reference images
    const imageUrls: string[] = [sourceImageUrl]

    // Add context/reference images
    if (contextImageUrls && contextImageUrls.length > 0) {
      imageUrls.push(...contextImageUrls)
    }

    // Build the prompt based on number of reference images
    let prompt: string
    const numReferenceImages = imageUrls.length - 1

    // Build translation context section if applicable
    let translationSection = ''
    if (translationContext?.isTranslated) {
      const targetLang = translationContext.targetLocale || 'translated language'
      const sourceLang = translationContext.sourceLocale || 'English'
      translationSection = `
TRANSLATION CONTEXT:
- This screenshot is a TRANSLATED version (${targetLang}) of an original ${sourceLang} screenshot
- The text in this image has been translated from ${sourceLang} to ${targetLang}
- If you are asked to "retranslate", "fix translation", or similar, regenerate the translated text while maintaining the same design
- When editing translated text, ensure proper grammar and natural phrasing for ${targetLang}
- Preserve the original meaning and intent when making text changes
${translationContext.hasPrimaryReference ? `- The REFERENCE IMAGE shows the original ${sourceLang} version - use it to understand the intended design and text placement` : ''}
`
    }

    // Text placement instructions
    const textInstructions = `
CRITICAL TEXT SAFE MARGIN RULES:
- ALL text MUST stay within 10% safe margins from ALL edges (left, right, top, bottom)
- Apply these rules to ALL marketing text: headlines, subtitles, taglines, and any other text outside the device mockup
- Keep ALL important content (phone mockup, text, headlines, graphics) within the CENTER 80% of the image
- Text must NEVER touch or approach the left/right edges - maintain at least 10% margin
- If text needs to be added or moved, keep it MORE centered, NEVER toward edges
- ANTICIPATE text length: Before rendering, estimate if the text will fit within margins
- If you predict text will be too long, PROACTIVELY use multiple lines BEFORE it overflows
- Apply this to BOTH headline AND subtitle/secondary text - check each text element separately
- Use these strategies IN ORDER for EACH text element:
  1. FIRST: Break text into MULTIPLE LINES if it helps fit within margins (do this PROACTIVELY if text is long)
  2. SECOND: Reduce font size slightly to fit within safe area
  3. COMBINE both strategies if needed
- Prioritize keeping ALL text VISIBLE over matching exact font size or line count

DEVICE AND LAYOUT REQUIREMENTS:
- The phone/device mockup must stay CENTERED and FULLY visible at the SAME SIZE
- All text must be well inside the image bounds, never touching or near edges
- If you need to reposition elements, keep them MORE centered, not less`

    if (numReferenceImages === 0) {
      prompt = `You are editing an App Store marketing screenshot.
${translationSection}
EDIT INSTRUCTION: ${editPrompt}

CRITICAL REQUIREMENTS:
1. Maintain the overall design aesthetic and quality
2. Keep the device mockup and app UI intact (unless specifically asked to change)
3. Only change what the instruction specifically asks for
4. Preserve text readability and positioning (unless asked to change)
5. Maintain professional App Store quality
6. Keep the phone/device mockup EXACTLY the same size and position - do NOT resize or move it
${textInstructions}

Output a high-quality image with the requested edits applied.`
    } else if (numReferenceImages === 1) {
      // Describe reference image based on translation context
      const refDescription = translationContext?.isTranslated && translationContext?.hasPrimaryReference
        ? `The SECOND image is the ORIGINAL ${translationContext.sourceLocale || 'English'} VERSION - use it as reference for design, layout, and to understand the original text/meaning.`
        : 'The SECOND image is a REFERENCE for style/context.'

      prompt = `You are editing an App Store marketing screenshot.

The FIRST image is the screenshot to edit.
${refDescription}
${translationSection}
EDIT INSTRUCTION: ${editPrompt}

CRITICAL REQUIREMENTS:
1. Use the reference image for style guidance if relevant to the edit
2. Maintain professional App Store quality
3. Keep the device mockup and app UI intact (unless specifically asked to change)
4. Only change what the instruction specifically asks for
5. Preserve text readability and positioning (unless asked to change)
6. Keep the phone/device mockup EXACTLY the same size and position - do NOT resize or move it
${textInstructions}

Output a high-quality image with the requested edits applied.`
    } else {
      // Multiple reference images - note which one is primary if applicable
      let refList: string
      if (translationContext?.isTranslated && translationContext?.hasPrimaryReference) {
        refList = `  - Image 2: ORIGINAL ${translationContext.sourceLocale || 'English'} VERSION (primary reference for design and original text)\n`
        refList += Array.from({ length: numReferenceImages - 1 }, (_, i) => `  - Image ${i + 3}: Additional reference ${i + 1}`).join('\n')
      } else {
        refList = Array.from({ length: numReferenceImages }, (_, i) => `  - Image ${i + 2}: Reference ${i + 1}`).join('\n')
      }

      prompt = `You are editing an App Store marketing screenshot.

The FIRST image is the screenshot to edit.
REFERENCE IMAGES for style/context:
${refList}
${translationSection}
EDIT INSTRUCTION: ${editPrompt}

CRITICAL REQUIREMENTS:
1. Draw inspiration from ALL reference images - combine their styles, colors, design elements as appropriate
2. If the instruction references specific elements from a reference, incorporate those elements
3. Maintain professional App Store quality
4. Keep the device mockup and app UI intact (unless specifically asked to change)
5. Only change what the instruction specifically asks for
6. Preserve text readability and positioning (unless asked to change)
7. Keep the phone/device mockup EXACTLY the same size and position - do NOT resize or move it
${textInstructions}

Output a high-quality image with the requested edits applied.`
    }

    // Call fal.ai API with retry logic
    const maxRetries = 3
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const response = await fetch(FAL_MODEL_URL, {
          method: 'POST',
          headers: {
            'Authorization': `Key ${FAL_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            prompt,
            image_urls: imageUrls,
            num_images: numImages,
            resolution: '2K',
            aspect_ratio: 'auto',
            output_format: 'png',
          }),
        })

        if (response.ok) {
          const result = await response.json()

          // fal.ai returns images array directly
          if (result.images && result.images.length > 0) {
            const urls = result.images.map((img: { url: string }) => img.url)
            return { success: true, urls }
          }

          return { success: false, error: 'No images returned from API' }
        }

        if (response.status === 429) {
          // Rate limited - wait and retry
          const errorData = await response.json().catch(() => ({}))
          const retryAfter = errorData.retry_after || 10
          console.log(`Rate limited, waiting ${retryAfter}s before retry ${attempt + 1}/${maxRetries}`)
          await sleep((retryAfter + 2) * 1000)
          continue
        }

        const errorText = await response.text()
        return { success: false, error: `API error ${response.status}: ${errorText}` }
      } catch (error) {
        if (attempt === maxRetries - 1) {
          throw error
        }
        // Exponential backoff
        await sleep(Math.pow(2, attempt) * 1000)
      }
    }

    return { success: false, error: 'Max retries exceeded' }
  } catch (error) {
    console.error('Screenshot edit error:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Edit generation failed',
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

  const { projectId, displayType, screenshotId, locale, sourceLocale, prompt, contextImageUrl, contextImageUrls, variationCount, currentImageUrl, isPrimaryReference } = body

  // Combine context URLs - prioritize array, fall back to single URL for backwards compatibility
  const allContextUrls: string[] = []
  if (contextImageUrls && contextImageUrls.length > 0) {
    allContextUrls.push(...contextImageUrls)
  } else if (contextImageUrl) {
    allContextUrls.push(contextImageUrl)
  }

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

  let operationId: string | null = null
  try {
    // Determine the current image URL to edit
    let imageToEdit = currentImageUrl

    if (!imageToEdit) {
      // Fetch the current screenshot
      if (locale) {
        // Editing a translated screenshot
        const localizedKey = `${displayType}_${screenshotId}_${locale}`
        const localizedDoc = await basePath.collection('localizedScreenshots').doc(localizedKey).get()
        if (!localizedDoc.exists) {
          return errorResponse('Localized screenshot not found', 404)
        }
        imageToEdit = localizedDoc.data()!.marketingImageUrl
      } else {
        // Editing a primary screenshot
        const screenshotSetDoc = await basePath.collection('screenshots').doc(displayType).get()
        if (!screenshotSetDoc.exists) {
          return errorResponse('Screenshot set not found', 404)
        }
        const screenshotSet = screenshotSetDoc.data()!
        const screenshot = screenshotSet.screenshots.find((s: any) => s.id === screenshotId)
        if (!screenshot) {
          return errorResponse('Screenshot not found', 404)
        }
        imageToEdit = screenshot.marketingImageUrl
      }
    }

    if (!imageToEdit) {
      return errorResponse('Screenshot image URL not found', 404)
    }

    const creditWeight = getImageCreditWeight('fal', AI_MODELS.falImagePremium, '2K')
    operationId = request.headers.get('idempotency-key') || crypto.randomUUID()
    const reservation = await reserveUsage(authContext, {
      operationId,
      usageType: 'screenshots',
      units: variationCount * creditWeight,
      metadata: { route: '/api/screenshots/edit', projectId, model: AI_MODELS.falImagePremium },
    })
    if (!reservation.allowed) return createReservationErrorResponse(reservation)
    if (reservation.replayed) return errorResponse('This screenshot edit was already processed', 409)

    // Generate variations - fal.ai preserves aspect ratio with aspect_ratio: 'auto'
    const variations: Array<{ id: string; imageUrl: string }> = []
    const errors: string[] = []

    // Build translation context if this is a translated screenshot
    const translationContext: TranslationContext | undefined = locale ? {
      isTranslated: true,
      sourceLocale: sourceLocale || 'en-US', // Default to English if not specified
      targetLocale: locale,
      hasPrimaryReference: isPrimaryReference ?? (allContextUrls.length > 0), // Assume first context is primary if not specified
    } : undefined

    // Generate all variations at once with fal.ai
    const result = await generateEditedScreenshots(
      imageToEdit,
      prompt,
      variationCount,
      allContextUrls.length > 0 ? allContextUrls : undefined,
      translationContext
    )

    if (result.success && result.urls && result.urls.length > 0) {
      // Upload each generated image to R2
      for (let i = 0; i < result.urls.length; i++) {
        try {
          const uploaded = await uploadFromUrl({
            userId: projectContext.type === 'organization' ? undefined : authContext.userId,
            orgId: projectContext.orgId || undefined,
            projectId,
            category: 'temp-edit',
            filename: `edit-${displayType}-${screenshotId}-${Date.now()}-${i}.png`,
            sourceUrl: result.urls[i],
          })

          variations.push({
            id: `variation-${i}-${Date.now()}`,
            imageUrl: uploaded.url,
          })
        } catch (uploadError) {
          console.error(`Failed to upload variation ${i + 1}:`, uploadError)
          errors.push(`Failed to upload variation ${i + 1}`)
        }
      }
    } else {
      errors.push(result.error || 'Generation failed')
    }

    if (variations.length === 0) {
      await refundUsage(authContext, operationId, 'screenshots')
      return errorResponse(`All variations failed: ${errors.join(', ')}`)
    }

    const creditsUsed = variations.length * creditWeight
    await settleUsage(authContext, operationId, 'screenshots', creditsUsed)

    return Response.json({
      success: true,
      variations,
      creditsUsed,
      errors: errors.length > 0 ? errors : undefined,
    })
  } catch (error) {
    if (operationId) await refundUsage(authContext, operationId, 'screenshots')
    console.error('Error editing screenshot:', error)
    return errorResponse(
      error instanceof Error ? error.message : 'Failed to edit screenshot',
      500
    )
  }
}
