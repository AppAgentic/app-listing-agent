import { readBoundedJson, RequestBodyLimitError } from '@/lib/api/bounded-body'
import { NextRequest } from 'next/server'
import crypto from 'crypto'
import { z } from 'zod'
import { authenticateRequest, errorResponse, unauthorizedResponse } from '@/lib/api/auth'
import { getProjectContext, hasContextPermission, getAccountContext, AccountContext } from '@/lib/org/context'
import { getSession } from '@/lib/auth/session'
import { adminDb } from '@/lib/firebase/admin'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { AI_MODELS } from '@/lib/billing/catalog'
import { getSignedDownloadUrl } from '@/lib/services/r2'
import { createReservationErrorResponse, refundUsage, reserveUsage, settleUsage } from '@/lib/api/usage'

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)

// R2 public URL to detect our own storage URLs
const R2_PUBLIC_URL_RAW = process.env.R2_PUBLIC_URL || ''
const R2_PUBLIC_DOMAIN = R2_PUBLIC_URL_RAW
  .replace(/^https?:\/\//, '')
  .replace(/\/+$/, '')
  .toLowerCase()

/**
 * Check if a URL is from our R2 storage
 */
function isR2Url(url: string): boolean {
  if (!R2_PUBLIC_DOMAIN) return false
  try {
    const urlObj = new URL(url)
    return urlObj.hostname.toLowerCase() === R2_PUBLIC_DOMAIN ||
           urlObj.hostname.toLowerCase().includes(R2_PUBLIC_DOMAIN.split('.')[0])
  } catch {
    return false
  }
}

/**
 * Convert R2 public URL to signed URL for server-side access
 */
async function resolveImageUrl(url: string): Promise<string> {
  if (isR2Url(url)) {
    try {
      const urlObj = new URL(url)
      const key = urlObj.pathname.slice(1)
      return getSignedDownloadUrl(key, 3600)
    } catch (error) {
      console.error(`[suggest-headlines] Failed to get signed URL:`, error)
      return url
    }
  }
  return url
}

const requestSchema = z.object({
  projectId: z.string(),
  screenshots: z.array(z.object({
    id: z.string(),
    imageUrl: z.string(),
    name: z.string(),
  })),
  appMetadata: z.object({
    name: z.string(),
    description: z.string(),
    category: z.string().optional(),
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

// Get app metadata from project if not provided
async function getAppMetadataFromProject(
  projectContext: Awaited<ReturnType<typeof getProjectContext>>,
  projectId: string,
  authUserId: string
): Promise<{ name: string; description: string; category?: string } | null> {
  if (!projectContext) return null

  const basePath = projectContext.type === 'organization' && projectContext.orgId
    ? adminDb
        .collection('organizations')
        .doc(projectContext.orgId)
        .collection('projects')
        .doc(projectId)
    : adminDb
        .collection('users')
        .doc(authUserId)
        .collection('projects')
        .doc(projectId)

  // Get project data
  const projectDoc = await basePath.get()
  if (!projectDoc.exists) return null

  const projectData = projectDoc.data()!
  const primaryLocale = projectData.primaryLocale || 'en-US'

  // Get primary locale metadata
  const metadataDoc = await basePath.collection('metadata').doc(primaryLocale).get()

  if (!metadataDoc.exists) {
    // Fallback to legacy metadata
    return {
      name: projectData.name || projectData.metadata?.title || 'App',
      description: projectData.metadata?.description || '',
    }
  }

  const metadata = metadataDoc.data()!
  return {
    name: metadata.name || projectData.name || 'App',
    description: metadata.description || '',
  }
}

/**
 * Holistic headline generation - analyzes ALL screenshots together
 * to create a cohesive narrative across the entire screenshot set
 */
async function generateCohesiveHeadlines(
  screenshots: Array<{ id: string; imageUrl: string; name: string }>,
  appMetadata: { name: string; description: string; category?: string }
): Promise<Record<string, { headlines: string[]; confidence: 'high' | 'medium' | 'low' }>> {
  const model = genAI.getGenerativeModel({ model: AI_MODELS.textQuality })

  // Fetch all images that aren't blob URLs
  const imageData: Array<{ id: string; base64: string | null }> = []

  for (const screenshot of screenshots) {
    if (screenshot.imageUrl.startsWith('blob:')) {
      imageData.push({ id: screenshot.id, base64: null })
    } else {
      try {
        // Resolve R2 URLs to signed URLs for server-side access
        const resolvedUrl = await resolveImageUrl(screenshot.imageUrl)
        console.log(`[suggest-headlines] Fetching image: ${screenshot.imageUrl.substring(0, 50)}... (resolved: ${resolvedUrl !== screenshot.imageUrl})`)

        const response = await fetch(resolvedUrl)
        if (response.ok) {
          const buffer = Buffer.from(await response.arrayBuffer())
          console.log(`[suggest-headlines] Fetched ${buffer.length} bytes`)
          if (buffer.length > 0) {
            imageData.push({ id: screenshot.id, base64: buffer.toString('base64') })
          } else {
            console.warn(`[suggest-headlines] Empty buffer for image: ${screenshot.imageUrl}`)
            imageData.push({ id: screenshot.id, base64: null })
          }
        } else {
          console.warn(`[suggest-headlines] Failed to fetch image: ${response.status}`)
          imageData.push({ id: screenshot.id, base64: null })
        }
      } catch (error) {
        console.error(`[suggest-headlines] Error fetching image:`, error)
        imageData.push({ id: screenshot.id, base64: null })
      }
    }
  }

  const hasImages = imageData.some(d => d.base64 !== null)

  // Build the holistic prompt
  const prompt = `You are an expert App Store Optimization (ASO) strategist and copywriter. Your job is to create a COHESIVE NARRATIVE across all ${screenshots.length} App Store screenshots.

APP CONTEXT:
- App Name: ${appMetadata.name}
- Description: ${appMetadata.description.substring(0, 1000)}
${appMetadata.category ? `- Category: ${appMetadata.category}` : ''}

YOU HAVE ${screenshots.length} SCREENSHOTS TO ANALYZE.
${hasImages ? 'I have provided the actual screenshot images ABOVE, labeled "SCREENSHOT 1", "SCREENSHOT 2", etc. You MUST analyze each image carefully and describe what you SEE in each one.' : 'No images available - generate based on app description.'}

${hasImages ? '⚠️ IMPORTANT: Look at each image above. What UI elements do you actually see? What screen is it? Describe it accurately.' : ''}

YOUR TASK - THREE STEPS:

STEP 1: ANALYZE EACH SCREENSHOT CAREFULLY
For each screenshot, identify with PRECISION:
- What TYPE of screen is it? (onboarding, dashboard, detail view, settings, list, form, etc.)
- What SPECIFIC UI elements are visible? (charts, lists, buttons, toggles, cards, etc.)
- What EXACT feature or functionality does it demonstrate?
- What would a USER be DOING on this screen?
- What BENEFIT does this specific feature provide?

Be VERY specific. Don't say "shows app features" - say "shows a weekly progress chart with workout statistics".

STEP 2: PLAN THE NARRATIVE ARC
Design a compelling story that flows across all screenshots:
- Screenshot 1 should HOOK the user with the main value proposition
- Middle screenshots should showcase KEY FEATURES with unique angles
- Final screenshot should have a CALL-TO-ACTION or clincher benefit

NARRATIVE PATTERNS TO CONSIDER:
- "Problem → Solution → Results" (show pain point, feature, outcome)
- "Feature Tour" (each screen highlights a different capability)
- "User Journey" (onboard → use → master → achieve)
- "Benefits Cascade" (each headline builds on the previous)

STEP 3: GENERATE HEADLINES
Create headlines that:
- ACCURATELY DESCRIBE the specific feature/screen shown (THIS IS THE PRIORITY)
- Tell a cohesive story when viewed in sequence
- Are 2-5 words each (STRICT LIMIT)
- Use DIFFERENT words and themes (no repetition!)
- Focus on the USER BENEFIT of that specific feature

⚠️ CRITICAL RULE: FEATURE ACCURACY COMES FIRST
Each headline MUST directly relate to what is VISIBLE in that specific screenshot:
- If it shows a calendar → headline about scheduling/planning
- If it shows analytics/charts → headline about tracking/insights
- If it shows a list/feed → headline about organizing/discovering
- If it shows settings → headline about customization/control
- If it shows a form/input → headline about creating/adding
- If it shows notifications → headline about staying informed
- If it shows social features → headline about connecting/sharing

DO NOT sacrifice feature accuracy for narrative flow. The headline must make sense when a user looks at that specific screenshot.

HEADLINE QUALITY RULES:
❌ BAD: Generic phrases that ignore what's shown
   - "Simplify Your Life" (vague, doesn't describe feature)
   - "Everything You Need" (meaningless)
   - "Powerful Features" (doesn't say WHAT feature)
   - "Get Started Today" (generic CTA, no feature)

✅ GOOD: Specific to the ACTUAL screen content
   - Calendar screen: "Plan Your Week" NOT "Simplify Your Life"
   - Stats dashboard: "See Your Progress" NOT "Track Everything"
   - Workout log: "Log Every Rep" NOT "Get Fit Fast"
   - Settings screen: "Make It Yours" NOT "Powerful Features"
   - Chat/social: "Connect Instantly" NOT "Stay Connected"

RESPONSE FORMAT (JSON):
{
  "narrativeTheme": "Brief description of the story arc (1 sentence)",
  "screenshots": [
    {
      "position": 1,
      "screenType": "specific screen type (e.g., 'analytics dashboard', 'task list', 'settings panel')",
      "visibleElements": "what UI elements you see (e.g., 'bar chart, weekly stats, progress ring')",
      "keyFeature": "the specific feature being demonstrated",
      "userAction": "what the user would do here (e.g., 'view their weekly progress')",
      "headlines": ["Primary Headline", "Alternative 1", "Alternative 2"]
    }
  ]
}

NOTE: The headlines MUST directly relate to the "keyFeature" and "userAction" you identified. If you said the screen shows "weekly stats", the headline should mention tracking/progress/stats.

CRITICAL:
- PRIORITY #1: Each headline MUST accurately describe what that specific screen shows
- PRIORITY #2: Headlines should flow together as a narrative when possible
- Each screenshot MUST have DIFFERENT headlines - no thematic overlap
- The first headline should hook users AND describe the main screen
- If a screen shows stats, the headline MUST mention tracking/progress/insights
- If a screen shows a list, the headline MUST mention organizing/managing/viewing
- NEVER use a generic headline that doesn't match the screen content`

  try {
    // Build content with images FIRST, each clearly labeled with position
    // This helps the AI understand which image corresponds to which screenshot number
    const content: Array<string | { inlineData: { mimeType: string; data: string } }> = []

    if (hasImages) {
      content.push('SCREENSHOTS TO ANALYZE (in order):')

      for (let i = 0; i < imageData.length; i++) {
        const img = imageData[i]
        content.push(`\n--- SCREENSHOT ${i + 1} of ${imageData.length} ---`)

        if (img.base64) {
          content.push({
            inlineData: {
              mimeType: 'image/png',
              data: img.base64,
            },
          })
        } else {
          content.push('[Image not available - generate based on app context]')
        }
      }

      content.push('\n--- END OF SCREENSHOTS ---\n')
    }

    // Add the main prompt AFTER the images
    content.push(prompt)

    const response = await model.generateContent(content)
    const text = response.response.text()

    // Parse JSON response
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      throw new Error('No JSON found in response')
    }

    const parsed = JSON.parse(jsonMatch[0]) as {
      narrativeTheme: string
      screenshots: Array<{
        position: number
        screenType: string
        keyFeature: string
        headlines: string[]
      }>
    }

    console.log('Headline generation result:', {
      narrativeTheme: parsed.narrativeTheme,
      screenshotCount: parsed.screenshots?.length,
      screenshots: parsed.screenshots?.map(s => ({
        position: s.position,
        screenType: s.screenType,
        keyFeature: s.keyFeature,
        firstHeadline: s.headlines?.[0],
      })),
    })

    // Map results back to screenshot IDs
    const results: Record<string, { headlines: string[]; confidence: 'high' | 'medium' | 'low' }> = {}

    for (let i = 0; i < screenshots.length; i++) {
      const screenshot = screenshots[i]
      const analysis = parsed.screenshots.find(s => s.position === i + 1) || parsed.screenshots[i]

      if (analysis && analysis.headlines && analysis.headlines.length > 0) {
        // Clean up headlines
        const cleanedHeadlines = analysis.headlines
          .map(h => h.replace(/^[\d\.\-\*\•]+\s*/, '').replace(/["']/g, '').trim())
          .filter(h => h.length > 0 && h.length < 50)
          .slice(0, 3)

        results[screenshot.id] = {
          headlines: cleanedHeadlines,
          confidence: hasImages ? 'high' : 'medium',
        }
      } else {
        results[screenshot.id] = {
          headlines: [`Feature ${i + 1}`, 'Explore More', 'Get Started'],
          confidence: 'low',
        }
      }
    }

    return results
  } catch (error) {
    console.error('Error in cohesive headline generation:', error)

    // Fallback to basic generation
    const results: Record<string, { headlines: string[]; confidence: 'high' | 'medium' | 'low' }> = {}

    for (let i = 0; i < screenshots.length; i++) {
      const screenshot = screenshots[i]
      results[screenshot.id] = {
        headlines: i === 0
          ? [`Introducing ${appMetadata.name}`, 'Your New Essential', 'Start Today']
          : [`Discover Feature ${i + 1}`, 'More to Explore', 'Keep Going'],
        confidence: 'low',
      }
    }

    return results
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

  const { projectId, screenshots, appMetadata: providedMetadata } = body

  // Get project context
  const projectContext = await getProjectContext(authContext.userId, projectId)
  if (!projectContext) {
    return errorResponse('Project not found', 404)
  }

  // Check permission
  if (!hasContextPermission(projectContext, 'canCreateProjects')) {
    return errorResponse('Permission denied', 403)
  }

  const operationId = request.headers.get('idempotency-key') || crypto.randomUUID()
  const reservation = await reserveUsage(authContext, {
    operationId,
    usageType: 'translations',
    units: 1,
    metadata: { route: '/api/screenshots/suggest-headlines', projectId, model: AI_MODELS.textQuality },
  })
  if (!reservation.allowed) return createReservationErrorResponse(reservation)
  if (reservation.replayed) return errorResponse('This headline operation was already processed', 409)

  try {
    // Get app metadata
    let appMetadata: { name: string; description: string; category?: string } | undefined = providedMetadata
    if (!appMetadata) {
      appMetadata = await getAppMetadataFromProject(projectContext, projectId, authContext.userId) ?? undefined
    }
    if (!appMetadata) {
      appMetadata = { name: 'App', description: '' }
    }

    // Generate cohesive headlines for ALL screenshots at once
    // This ensures a narrative flow across the entire screenshot set
    const suggestions = await generateCohesiveHeadlines(screenshots, appMetadata)
    await settleUsage(authContext, operationId, 'translations', 1)

    return Response.json({
      success: true,
      suggestions,
    })
  } catch (error) {
    await refundUsage(authContext, operationId, 'translations')
    console.error('Error suggesting headlines:', error)
    return errorResponse(
      error instanceof Error ? error.message : 'Failed to suggest headlines',
      500
    )
  }
}
