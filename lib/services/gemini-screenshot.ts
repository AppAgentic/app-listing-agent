import { GoogleGenerativeAI } from '@google/generative-ai'
import { AppCategory, CATEGORY_TEMPLATES } from '../constants'
import { logger } from '../logger'
import sharp from 'sharp'
import { getSignedDownloadUrl } from './r2'
import { AI_MODELS } from '@/lib/billing/catalog'
import { generateGeminiImageWithDirectFallback } from './gemini-direct'

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)

// R2 public URL to detect our own storage URLs
// Extract domain without protocol and trailing slashes
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
 * The public URL may not work for server-to-server requests
 */
async function resolveImageUrl(url: string): Promise<string> {
  console.log(`[resolveImageUrl] Checking URL: ${url.substring(0, 80)}...`)
  console.log(`[resolveImageUrl] R2_PUBLIC_DOMAIN: "${R2_PUBLIC_DOMAIN}" (from R2_PUBLIC_URL: "${R2_PUBLIC_URL_RAW}")`)

  // Check if this is an R2 URL that needs signing
  if (isR2Url(url)) {
    try {
      // Extract the key from the URL (everything after the domain)
      const urlObj = new URL(url)
      const key = urlObj.pathname.slice(1) // Remove leading slash
      console.log(`[R2] Converting public URL to signed URL for key: ${key}`)
      const signedUrl = await getSignedDownloadUrl(key, 3600) // 1 hour expiry
      console.log(`[R2] Got signed URL: ${signedUrl.substring(0, 100)}...`)
      return signedUrl
    } catch (error) {
      console.error(`[R2] Failed to get signed URL, falling back to public URL:`, error)
      return url
    }
  }

  console.log(`[resolveImageUrl] Not an R2 URL, using as-is`)
  return url
}

// Nano Banana 2 (Gemini 3.1 Flash Image) — pro quality at flash speed
const IMAGE_MODEL = AI_MODELS.imageDefault
const KIE_API_BASE = 'https://api.kie.ai'
const KIE_POLL_INTERVAL_MS = 5000
const KIE_POLL_TIMEOUT_MS = 8 * 60 * 1000

/**
 * Custom style configuration for plan-based screenshot generation
 */
export interface CustomStyleConfig {
  gradientColors: { primary: string; secondary: string }
  fontStyle: string        // e.g. "bold sans-serif in white"
  styleDescription: string // e.g. "Dark, moody fitness aesthetic"
  decorativeElements: string[] // e.g. ["energy waves", "motion curves"]
}

/**
 * Style source for screenshot generation
 * - category: Use predefined app category templates
 * - reference: Copy style from an existing marketing screenshot
 * - custom: Use custom style configuration (for plan-based generation)
 */
export type StyleSource =
  | {
      type: 'category'
      category: AppCategory
      customColors?: { primary: string; secondary: string }
    }
  | {
      type: 'reference'
      referenceImageUrl: string
    }
  | {
      type: 'custom'
      style: CustomStyleConfig
    }

export interface ScreenshotEnhancement {
  focusArea: string // Description of what UI element to emphasize
  visualTechnique: string // How to emphasize it (none, pop-out, floating-element)
  contextualNote: string // Additional context for the AI
  enhancementPrompt: string // The full enhancement instruction to inject
}

export type DeviceFrame = 'iphone' | 'android' | 'generic' | 'none'
export type ScreenshotGenerationProvider = 'gemini' | 'kie'

export interface GenerateScreenshotParams {
  rawImageUrl?: string // Optional for feature graphic (standalone banner generation)
  headline: string
  subtitle?: string
  styleSource: StyleSource
  anchorImageUrl?: string // For category mode: use previous generated as anchor
  enhancement?: ScreenshotEnhancement // Optional enhancement for feature emphasis
  deviceFrame?: DeviceFrame // Device frame style (default: 'iphone')
  targetAspectRatio?: 'portrait' | 'landscape' // Output aspect ratio (default: 'portrait')
  appName?: string // App name for feature graphic branding
  appDescription?: string // App description for context
  provider?: ScreenshotGenerationProvider
  model?: string
}

export interface GenerateSetParams {
  rawImages: Array<{
    url: string
    headline: string
    subtitle?: string
  }>
  styleSource: StyleSource
  anchorIndex?: number // Which screenshot to generate first as anchor (default: 0)
  appContext?: { name?: string; description?: string } // App context for better enhancement analysis
  enableEnhancement?: boolean // Whether to analyze and enhance screenshots (default: true)
  preDefinedEnhancements?: ScreenshotEnhancement[] // Skip AI analysis, use these enhancements directly
  deviceFrame?: DeviceFrame // Device frame style for all screenshots (default: 'iphone')
  provider?: ScreenshotGenerationProvider
  model?: string
}

export interface GeneratedScreenshot {
  url: string
  success: boolean
  error?: string
}

/**
 * Fetch image from URL and return as Buffer (converted to PNG for Gemini compatibility)
 */
async function fetchImageBuffer(url: string): Promise<Buffer> {
  console.log(`[fetchImageBuffer] Starting fetch for: ${url.substring(0, 80)}...`)

  // Resolve R2 URLs to signed URLs for server-side access
  const resolvedUrl = await resolveImageUrl(url)
  const urlChanged = resolvedUrl !== url
  console.log(`[fetchImageBuffer] URL ${urlChanged ? 'was resolved to signed URL' : 'unchanged'}`)

  // Add headers to help with CDN requests (like Apple's mzstatic.com)
  const response = await fetch(resolvedUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Referer': 'https://apps.apple.com/',
    },
    redirect: 'follow',
  })

  console.log(`[fetchImageBuffer] Response status: ${response.status}, content-type: ${response.headers.get('content-type')}, content-length: ${response.headers.get('content-length')}`)

  if (!response.ok) {
    console.error(`[fetchImageBuffer] Failed to fetch image from ${resolvedUrl.substring(0, 100)}...: ${response.status} ${response.statusText}`)
    throw new Error(`Failed to fetch image: ${response.status} ${response.statusText}`)
  }

  const arrayBuffer = await response.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)
  console.log(`[fetchImageBuffer] Fetched ${buffer.length} bytes from ${url.substring(0, 50)}...`)

  // If buffer is empty, throw an error with diagnostic info
  if (buffer.length === 0) {
    const diagnosticInfo = {
      originalUrl: url.substring(0, 100),
      resolvedUrl: resolvedUrl.substring(0, 100),
      wasResolved: urlChanged,
      status: response.status,
      contentType: response.headers.get('content-type'),
      contentLength: response.headers.get('content-length'),
    }
    console.error(`[fetchImageBuffer] Empty buffer received:`, diagnosticInfo)
    throw new Error(`Image fetch returned empty buffer. URL: ${url.substring(0, 50)}... (resolved: ${urlChanged})`)
  }

  // Convert to PNG to ensure Gemini compatibility (WebP and other formats may not be supported)
  try {
    const pngBuffer = await sharp(buffer)
      .png()
      .toBuffer()
    console.log(`Converted image to PNG: ${pngBuffer.length} bytes`)
    return pngBuffer
  } catch (conversionError) {
    console.warn('Image conversion failed, using original buffer:', conversionError)
    return buffer
  }
}

/**
 * Analyze a screenshot and headline to generate specific enhancement instructions
 * This creates targeted visual emphasis for the feature being promoted
 */
export async function analyzeScreenshotForEnhancement(
  imageUrl: string,
  headline: string,
  appContext?: { name?: string; description?: string }
): Promise<ScreenshotEnhancement> {
  const log = logger.child({ operation: 'analyzeScreenshotForEnhancement' })

  try {
    const model = genAI.getGenerativeModel({ model: AI_MODELS.textQuality })

    // Fetch the image
    const imageBuffer = await fetchImageBuffer(imageUrl)
    const base64Image = imageBuffer.toString('base64')

    const prompt = `You are an expert App Store screenshot designer. Analyze this app screenshot and the marketing headline to determine how to visually emphasize the feature being promoted.

HEADLINE: "${headline}"
${appContext?.name ? `APP NAME: ${appContext.name}` : ''}
${appContext?.description ? `APP DESCRIPTION: ${appContext.description.substring(0, 300)}` : ''}

YOUR TASK:
1. Identify which UI element(s) in the screenshot best demonstrate the feature mentioned in the headline
2. Determine the best visual technique to draw attention to that element
3. Provide specific instructions for emphasizing it in the marketing screenshot

ANALYZE:
- What specific UI element relates to the headline? (e.g., a button, chart, list, input field, toggle, etc.)
- Where is it located in the screenshot? (top, center, bottom, left, right)
- What makes this element important for the headline's message?

VISUAL TECHNIQUES TO CONSIDER:

- "none": No special emphasis needed - the screenshot is clear without additional effects
- "pop-out": Make the element appear to float/pop forward from the screen with depth and shadow
- "floating-element": Pull the key UI element partially outside the device frame for a dynamic look

Respond in this exact JSON format:
{
  "focusArea": "Brief description of the UI element to emphasize, or 'none' if skipping emphasis",
  "visualTechnique": "The technique to use (one of: none, pop-out, floating-element)",
  "contextualNote": "Why this element connects to the headline, or why no emphasis is needed (1 sentence)",
  "enhancementPrompt": "A 1-2 sentence instruction for the image generator, or empty string if visualTechnique is 'none'"
}

TECHNIQUE SELECTION GUIDE:
- Charts, cards, or key UI components → "floating-element" to pull them outside the frame
- Buttons, toggles, or interactive elements → "pop-out" to make them feel 3D
- Full-screen content or simple layouts → "none" (let the screenshot speak for itself)

IMPORTANT:
- Use "pop-out" or "floating-element" to add depth and visual interest
- Use "none" when the screenshot already communicates clearly without effects
- Keep it clean and professional - don't over-design`

    const response = await model.generateContent([
      {
        inlineData: {
          mimeType: 'image/png',
          data: base64Image,
        },
      },
      prompt,
    ])

    const text = response.response.text()

    // Extract JSON from response
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      throw new Error('No JSON found in response')
    }

    const parsed = JSON.parse(jsonMatch[0]) as ScreenshotEnhancement

    log.info('Screenshot enhancement analysis complete', {
      focusArea: parsed.focusArea,
      technique: parsed.visualTechnique,
    })

    return parsed
  } catch (error) {
    log.error('Enhancement analysis failed, using default', error instanceof Error ? error : new Error(String(error)))

    // Return 'none' default when analysis fails - don't force emphasis
    return {
      focusArea: 'none',
      visualTechnique: 'none',
      contextualNote: 'Enhancement analysis failed, proceeding without emphasis',
      enhancementPrompt: '',
    }
  }
}

/**
 * Batch analyze multiple screenshots with their headlines
 */
export async function analyzeScreenshotsForEnhancement(
  screenshots: Array<{ imageUrl: string; headline: string }>,
  appContext?: { name?: string; description?: string }
): Promise<ScreenshotEnhancement[]> {
  const results: ScreenshotEnhancement[] = []

  // Process sequentially to avoid rate limits
  for (const screenshot of screenshots) {
    const enhancement = await analyzeScreenshotForEnhancement(
      screenshot.imageUrl,
      screenshot.headline,
      appContext
    )
    results.push(enhancement)

    // Small delay between requests
    await new Promise(resolve => setTimeout(resolve, 300))
  }

  return results
}

/**
 * Build technique-specific instructions for the image generator
 */
function buildTechniqueInstructions(enhancement: ScreenshotEnhancement): string {
  const technique = enhancement.visualTechnique
  const focus = enhancement.focusArea

  switch (technique) {
    case 'none':
      return ''

    case 'pop-out':
      return `Make ${focus} appear to pop forward/float slightly above the screen surface. Add a subtle shadow to create depth. The element should feel 3D and tactile.`

    case 'floating-element':
      return `Pull ${focus} partially outside the device frame, making it float beside the phone. This creates a dynamic, modern App Store look. Add a subtle shadow for depth.`

    default:
      return enhancement.enhancementPrompt || ''
  }
}

/**
 * Get device frame description and instruction for the prompt
 */
function getDeviceFrameInstructions(deviceFrame: DeviceFrame = 'iphone'): {
  deviceDescription: string
  deviceInstruction: string
} {
  switch (deviceFrame) {
    case 'android':
      return {
        deviceDescription: 'Modern Android phone device mockup (Pixel-style, rounded corners, thin bezels)',
        deviceInstruction: '- DEVICE: Android phone mockup (Pixel-style), centered, showing the app clearly',
      }
    case 'generic':
      return {
        deviceDescription: 'Clean, rounded-rectangle device shape with no brand-specific bezel — a generic smartphone silhouette that works for both iOS and Android',
        deviceInstruction: '- DEVICE: Generic smartphone mockup (clean rounded rectangle, no brand-specific bezel), centered, showing the app clearly. Do NOT include any iPhone notch, Dynamic Island, Android navigation bar, or other platform-specific elements.',
      }
    case 'none':
      return {
        deviceDescription: 'No device frame — the app UI is shown directly on the background without any phone mockup',
        deviceInstruction: '- NO DEVICE FRAME: Show the app UI directly without any phone/tablet mockup. Place the app UI as a floating rounded-rectangle card on the background, with subtle shadow for depth.',
      }
    case 'iphone':
    default:
      return {
        deviceDescription: 'Modern iPhone device mockup',
        deviceInstruction: '- DEVICE: Modern iPhone device mockup, centered, showing the app clearly',
      }
  }
}

function buildPrompt(params: GenerateScreenshotParams): string {
  const { headline, subtitle, styleSource, anchorImageUrl, enhancement, deviceFrame = 'iphone', targetAspectRatio = 'portrait', appName, appDescription } = params
  const subtitleInstruction = subtitle
    ? `\nSUBTITLE: "${subtitle}" — display this as smaller supporting marketing text beneath the headline. Keep it readable and do not let it overlap the device.`
    : ''

  const outputInstruction = targetAspectRatio === 'landscape'
    ? 'Output as a high-quality PNG image in landscape banner format (1024×500, aspect ratio ~2:1). This is a Google Play Feature Graphic — a wide landscape banner. Wide horizontal composition.'
    : 'Output as a high-quality PNG image with phone aspect ratio (9:19.5).'

  // Feature graphic (landscape banner) without a raw screenshot — generate branded banner from scratch
  if (targetAspectRatio === 'landscape' && !params.rawImageUrl) {
    let colors: { primary: string; secondary: string }
    let styleDesc: string

    if (styleSource.type === 'custom') {
      colors = styleSource.style.gradientColors
      styleDesc = styleSource.style.styleDescription
    } else if (styleSource.type === 'category') {
      const template = CATEGORY_TEMPLATES[styleSource.category]
      colors = styleSource.customColors || template.gradientColors
      styleDesc = template.styleDescription
    } else {
      // Reference mode with no raw image — use default colors
      colors = { primary: '#4F46E5', secondary: '#7C3AED' }
      styleDesc = 'Modern, professional app marketing style'
    }

    return `Create a Google Play Feature Graphic — a promotional landscape banner (1024×500 pixels).

${appName ? `APP: "${appName}"${appDescription ? ` — ${appDescription}` : ''}` : ''}

HEADLINE: "${headline}" — display this prominently as the main text element.${subtitleInstruction}

VISUAL DESIGN:
- BACKGROUND: Rich gradient from ${colors.primary} to ${colors.secondary}, flowing naturally
- STYLE: ${styleDesc}
- Include abstract decorative elements, shapes, or subtle patterns that convey the app's purpose
- ${appName ? `Include the app name "${appName}" as secondary branding text` : 'Clean, branded look'}
- Use vivid, eye-catching colors that stand out against a white background

COMPOSITION RULES:
- This is a WIDE LANDSCAPE banner (2:1 aspect ratio), NOT a phone screenshot
- NO device frames, NO phone mockups — this is a standalone promotional graphic
- Keep critical content away from edges (15% safe zone on all sides)
- Avoid placing important elements in the dead center (play button overlay zone)
- Headline should be large, bold, and instantly readable
- If a subtitle is provided, it should be smaller than the headline, concise, and visually secondary
- Create visual hierarchy: Headline → Brand/Imagery → Background
- Professional Google Play Store marketing quality

${styleSource.type === 'reference' ? 'Use the provided REFERENCE IMAGE to match the visual style, colors, and aesthetic.' : ''}

${outputInstruction}`
  }

  // Build enhancement section if provided and technique is not 'none'
  const shouldApplyEnhancement = enhancement &&
    enhancement.visualTechnique !== 'none' &&
    enhancement.enhancementPrompt &&
    enhancement.enhancementPrompt.trim() !== ''

  let enhancementSection = ''
  if (shouldApplyEnhancement) {
    const techniqueInstructions = buildTechniqueInstructions(enhancement!)
    enhancementSection = `
FEATURE EMPHASIS:
${enhancement!.enhancementPrompt}
Focus Area: ${enhancement!.focusArea}

TECHNIQUE INSTRUCTIONS (${enhancement!.visualTechnique}):
${techniqueInstructions}

Make sure the connection between the headline and the emphasized UI element is visually clear and the overall design remains professional and Apple-quality.
`
  }

  const { deviceInstruction } = getDeviceFrameInstructions(deviceFrame)

  if (styleSource.type === 'reference') {
    // Reference mode: copy the exact style from uploaded reference
    return `Transform the FIRST IMAGE (app screenshot) into an App Store marketing screenshot.

Use the SECOND IMAGE as a HARD TEMPLATE, not loose inspiration. The output must look like it belongs in the exact same shipped screenshot set.

EXACT STYLE LOCK:
- Match the SECOND IMAGE's background colors, gradient direction, lighting, texture, shadows, and mood
- Match the SECOND IMAGE's decorative elements, density, placement pattern, and visual restraint
- Match the SECOND IMAGE's headline typography, capitalization style, weight, glow/shadow treatment, line breaks, and top spacing
${deviceInstruction}
- Match the SECOND IMAGE's device size, placement, angle, crop, frame style, and depth treatment
- Do not introduce a new art direction, new palette, new decorative motifs, new cards, badges, labels, captions, or explanatory copy
${enhancementSection}
HEADLINE: "${headline}" - Place this prominently, styled to match the reference.${subtitleInstruction}
${subtitle ? '' : '\nNO SUBTITLE: Do not add any supporting text beneath the headline.'}

CRITICAL REQUIREMENTS:
- The app UI from FIRST IMAGE must be clearly visible${deviceFrame === 'none' ? '' : ' in the matched device mockup'}
- Match the reference style as precisely as possible; prefer conservative template fidelity over novelty
- Preserve the real in-phone UI from the FIRST IMAGE; do not invent app features, fake metrics, medical claims, or third-party IP
- Professional App Store marketing quality
- The headline and emphasized feature should work together to tell a clear story

${outputInstruction}`
  }

  if (anchorImageUrl) {
    // Category mode with anchor - maintain consistency
    return `Transform the FIRST IMAGE (app screenshot) into an App Store marketing screenshot.

Use the SECOND IMAGE as the style reference - match its exact:
- Gradient background colors and direction
- Decorative elements style, color, and placement pattern
- Font style, size, and positioning
- Device frame style and angle (MUST match the reference exactly)
- Overall visual hierarchy and spacing
${enhancementSection}
HEADLINE: "${headline}" - Place this in the same position/style as the reference.${subtitleInstruction}

CRITICAL REQUIREMENTS:
- Keep exact same background style, colors, and aesthetic as reference
- This screenshot should look like it belongs in the same set
- Maintain consistent visual language across all screenshots
- The emphasized feature should be clearly visible

${outputInstruction}`
  }

  // Custom or Category mode, first screenshot (anchor generation)
  let colors: { primary: string; secondary: string }
  let fontStyle: string
  let styleDescription: string
  let decorativeElements: string[]

  if (styleSource.type === 'custom') {
    colors = styleSource.style.gradientColors
    fontStyle = styleSource.style.fontStyle
    styleDescription = styleSource.style.styleDescription
    decorativeElements = styleSource.style.decorativeElements
  } else {
    const template = CATEGORY_TEMPLATES[styleSource.category]
    colors = styleSource.customColors || template.gradientColors
    fontStyle = template.fontStyle
    styleDescription = template.styleDescription
    decorativeElements = template.decorativeElements
  }

  return `Create a stunning App Store marketing screenshot from this app UI.

VISUAL DESIGN:
- BACKGROUND: Beautiful gradient from ${colors.primary} to ${colors.secondary}, flowing naturally
- DECORATIONS: ${decorativeElements.join(', ')} - scattered tastefully around the edges, not obscuring the app
${deviceInstruction}
- HEADLINE: "${headline}" - displayed prominently at top in ${fontStyle}${subtitleInstruction}
- STYLE: ${styleDescription}
${enhancementSection}
COMPOSITION GUIDELINES:
- The ${deviceFrame === 'none' ? 'app UI card' : 'device'} should be the focal point, taking up 60-70% of the vertical space
- Headline should be easily readable against the background
- Decorative elements should enhance, not distract
- Leave breathing room around elements
- Create visual hierarchy: Headline → ${deviceFrame === 'none' ? 'App UI' : 'Device/App'} → Decorations

QUALITY REQUIREMENTS:
- Professional App Store marketing quality
- Clean, polished, and visually appealing
- Colors should be vibrant but not oversaturated
- The app content should be sharp and clearly visible

${outputInstruction}`
}

/**
 * Extract image buffer from Gemini response
 */
function extractImageFromResponse(response: {
  response: { candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { data: string; mimeType: string } }> } }> }
}): Buffer | null {
  try {
    const candidates = response.response.candidates
    if (!candidates || candidates.length === 0) return null

    const parts = candidates[0].content?.parts
    if (!parts) return null

    for (const part of parts) {
      if (part.inlineData?.data) {
        return Buffer.from(part.inlineData.data, 'base64')
      }
    }

    return null
  } catch {
    return null
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function assertKieImageUrl(url: string, label: string): void {
  if (!/^https?:\/\//i.test(url)) {
    throw new Error(`Kie screenshot generation requires ${label} to be a public http(s) URL. Upload the image with upload_screenshot_asset first.`)
  }
}

async function generateMarketingScreenshotKie(
  params: GenerateScreenshotParams,
  prompt: string
): Promise<GeneratedScreenshot> {
  const apiKey = process.env.KIE_API_KEY
  const model = params.model || 'nano-banana-2'

  if (!apiKey) {
    return {
      url: '',
      success: false,
      error: 'KIE_API_KEY is not configured for Kie/Nano Banana screenshot generation',
    }
  }

  const imageInput: string[] = []

  if (params.rawImageUrl) {
    assertKieImageUrl(params.rawImageUrl, 'rawImageUrl')
    imageInput.push(params.rawImageUrl)
  }

  if (params.styleSource.type === 'reference') {
    assertKieImageUrl(params.styleSource.referenceImageUrl, 'styleSource.referenceImageUrl')
    imageInput.push(params.styleSource.referenceImageUrl)
  } else if (params.anchorImageUrl) {
    assertKieImageUrl(params.anchorImageUrl, 'anchorImageUrl')
    imageInput.push(params.anchorImageUrl)
  }

  try {
    const createResponse = await fetch(`${KIE_API_BASE}/api/v1/jobs/createTask`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        input: {
          prompt,
          image_input: imageInput,
          aspect_ratio: 'auto',
          resolution: '2K',
          output_format: 'png',
        },
      }),
    })

    if (!createResponse.ok) {
      const errorText = await createResponse.text()
      return {
        url: '',
        success: false,
        error: `Kie.ai create task failed: ${createResponse.status} - ${errorText}`,
      }
    }

    const createResult = await createResponse.json() as {
      code?: number
      msg?: string
      data?: { taskId?: string }
    }

    if (createResult.code !== 200 || !createResult.data?.taskId) {
      return {
        url: '',
        success: false,
        error: `Kie.ai create task error: ${createResult.msg || 'Missing taskId'}`,
      }
    }

    const taskId = createResult.data.taskId
    const pollStart = Date.now()

    while (Date.now() - pollStart < KIE_POLL_TIMEOUT_MS) {
      await sleep(KIE_POLL_INTERVAL_MS)

      const statusResponse = await fetch(`${KIE_API_BASE}/api/v1/jobs/recordInfo?taskId=${taskId}`, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      })

      if (!statusResponse.ok) {
        continue
      }

      const statusResult = await statusResponse.json() as {
        data?: {
          state?: 'waiting' | 'success' | 'fail'
          resultJson?: string | null
          failCode?: string | null
          failMsg?: string | null
        }
      }

      if (statusResult.data?.state === 'success') {
        const resultJson = JSON.parse(statusResult.data.resultJson || '{}') as {
          resultUrls?: string[]
        }
        const url = resultJson.resultUrls?.[0]

        if (!url) {
          return {
            url: '',
            success: false,
            error: 'Kie.ai returned success but no result image URL',
          }
        }

        return {
          url,
          success: true,
        }
      }

      if (statusResult.data?.state === 'fail') {
        return {
          url: '',
          success: false,
          error: `Kie.ai task failed: ${statusResult.data.failMsg || statusResult.data.failCode || 'Unknown error'}`,
        }
      }
    }

    return {
      url: '',
      success: false,
      error: `Kie.ai task timed out after ${Math.round(KIE_POLL_TIMEOUT_MS / 1000)} seconds`,
    }
  } catch (error) {
    return {
      url: '',
      success: false,
      error: error instanceof Error ? error.message : 'Kie.ai screenshot generation failed',
    }
  }
}

/**
 * Generate a single marketing screenshot using Gemini 3 Pro Image
 */
export async function generateMarketingScreenshot(
  params: GenerateScreenshotParams
): Promise<GeneratedScreenshot> {
  const log = logger.child({ operation: 'generateMarketingScreenshot' })

  try {
    const prompt = buildPrompt(params)
    const provider = params.provider || 'gemini'

    if (provider === 'kie') {
      log.info('Generating screenshot with Kie/Nano Banana', {
        model: params.model || 'nano-banana-2',
        styleType: params.styleSource.type,
        hasAnchor: !!params.anchorImageUrl,
      })
      return generateMarketingScreenshotKie(params, prompt)
    }

    // Build content parts with images
    const contentParts: Array<string | { inlineData: { mimeType: string; data: string } }> = []

    // Add the raw app screenshot (optional for feature graphic banner generation)
    if (params.rawImageUrl) {
      const rawImageBuffer = await fetchImageBuffer(params.rawImageUrl)
      contentParts.push({
        inlineData: {
          mimeType: 'image/png',
          data: rawImageBuffer.toString('base64'),
        },
      })
    }

    // Add reference or anchor image if provided
    if (params.styleSource.type === 'reference') {
      const referenceBuffer = await fetchImageBuffer(params.styleSource.referenceImageUrl)
      contentParts.push({
        inlineData: {
          mimeType: 'image/png',
          data: referenceBuffer.toString('base64'),
        },
      })
    } else if (params.anchorImageUrl) {
      const anchorBuffer = await fetchImageBuffer(params.anchorImageUrl)
      contentParts.push({
        inlineData: {
          mimeType: 'image/png',
          data: anchorBuffer.toString('base64'),
        },
      })
    }

    // Add prompt
    contentParts.push(prompt)

    log.info('Generating screenshot with Gemini 3 Pro Image', {
      styleType: params.styleSource.type,
      hasAnchor: !!params.anchorImageUrl,
      rawImageSize: contentParts[0] && typeof contentParts[0] !== 'string' ? contentParts[0].inlineData.data.length : 0,
      referenceImageSize: contentParts[1] && typeof contentParts[1] !== 'string' ? contentParts[1].inlineData.data.length : 0,
    })

    const model = genAI.getGenerativeModel({ model: IMAGE_MODEL })

    const contents = [
      {
        role: 'user' as const,
        parts: contentParts.map((p) => (typeof p === 'string' ? { text: p } : p)),
      },
    ]
    const generationConfig = { responseModalities: ['TEXT', 'IMAGE'] }
    const generated = await generateGeminiImageWithDirectFallback({
      model: IMAGE_MODEL,
      contents,
      generationConfig,
      generatePrimary: async () => {
        const response = await model.generateContent({
          contents,
          generationConfig: generationConfig as Record<string, unknown>,
        })
        return extractImageFromResponse(response)
      },
    })

    // Extract image from the SDK or direct API response.
    const generatedImage = generated.image
    if (!generatedImage) {
      return {
        url: '',
        success: false,
        error: 'No image generated from AI model',
      }
    }

    // Convert buffer to data URL for compatibility with existing code
    // The screenshot-generator.ts will handle uploading to R2
    const dataUrl = `data:image/png;base64,${generatedImage.toString('base64')}`

    log.info('Screenshot generated successfully', { source: generated.source })

    return {
      url: dataUrl,
      success: true,
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    log.error('Screenshot generation failed', error instanceof Error ? error : new Error(errorMessage))

    return {
      url: '',
      success: false,
      error: errorMessage,
    }
  }
}

/**
 * Generate a consistent set of marketing screenshots
 * First analyzes screenshots for feature enhancement, then generates with anchor pattern
 */
export async function generateScreenshotSet(params: GenerateSetParams): Promise<GeneratedScreenshot[]> {
  const { rawImages, styleSource, anchorIndex = 0, appContext, enableEnhancement = true, preDefinedEnhancements, deviceFrame, provider, model } = params
  const results: GeneratedScreenshot[] = new Array(rawImages.length)
  const log = logger.child({ operation: 'generateScreenshotSet', count: rawImages.length })

  log.info('Starting screenshot set generation', { enableEnhancement, hasPreDefinedEnhancements: !!preDefinedEnhancements })

  // Step 1: Use pre-defined enhancements or analyze screenshots
  let enhancements: ScreenshotEnhancement[] = []
  if (preDefinedEnhancements && preDefinedEnhancements.length > 0) {
    enhancements = preDefinedEnhancements
    log.info('Using pre-defined enhancements (skipping AI analysis)', {
      count: enhancements.length,
      techniques: enhancements.map(e => e.visualTechnique),
    })
  } else if (enableEnhancement) {
    log.info('Analyzing screenshots for feature enhancement')
    try {
      enhancements = await analyzeScreenshotsForEnhancement(
        rawImages.map(img => ({ imageUrl: img.url, headline: img.headline })),
        appContext
      )
      const appliedCount = enhancements.filter(e => e.visualTechnique !== 'none').length
      log.info('Enhancement analysis complete', {
        enhancementsGenerated: enhancements.length,
        enhancementsApplied: appliedCount,
        enhancementsSkipped: enhancements.length - appliedCount,
        techniques: enhancements.map(e => e.visualTechnique),
      })
    } catch (error) {
      log.warn('Enhancement analysis failed, proceeding without enhancements', {
        error: error instanceof Error ? error.message : String(error),
      })
      // Continue without enhancements
    }
  }

  // Step 2: Generate screenshots
  if (styleSource.type === 'reference') {
    // Reference mode: all screenshots use the same reference
    // Can process in parallel since no anchor dependency
    const promises = rawImages.map(async (image, index) => {
      const result = await generateMarketingScreenshot({
        rawImageUrl: image.url,
        headline: image.headline,
        subtitle: image.subtitle,
        styleSource,
        enhancement: enhancements[index],
        deviceFrame,
        provider,
        model,
      })
      return { index, result }
    })

    const completed = await Promise.all(promises)
    for (const { index, result } of completed) {
      results[index] = result
    }
  } else {
    // Category mode: generate anchor first, then use it for remaining
    // Generate anchor screenshot first
    const anchorImage = rawImages[anchorIndex]
    const anchorResult = await generateMarketingScreenshot({
      rawImageUrl: anchorImage.url,
      headline: anchorImage.headline,
      subtitle: anchorImage.subtitle,
      styleSource,
      enhancement: enhancements[anchorIndex],
      deviceFrame,
      provider,
      model,
    })

    results[anchorIndex] = anchorResult

    if (!anchorResult.success) {
      // If anchor fails, mark all as failed
      for (let i = 0; i < rawImages.length; i++) {
        if (i !== anchorIndex) {
          results[i] = {
            url: '',
            success: false,
            error: 'Anchor screenshot generation failed',
          }
        }
      }
      return results
    }

    // Generate remaining screenshots using anchor as reference
    // Process in batches of 2 to avoid rate limits
    const remaining = rawImages
      .map((image, index) => ({ image, index }))
      .filter(({ index }) => index !== anchorIndex)

    const batchSize = 2
    for (let i = 0; i < remaining.length; i += batchSize) {
      const batch = remaining.slice(i, i + batchSize)

      const batchResults = await Promise.all(
        batch.map(async ({ image, index }) => {
          const result = await generateMarketingScreenshot({
            rawImageUrl: image.url,
            headline: image.headline,
            subtitle: image.subtitle,
            styleSource,
            anchorImageUrl: anchorResult.url,
            enhancement: enhancements[index],
            deviceFrame,
            provider,
            model,
          })
          return { index, result }
        })
      )

      for (const { index, result } of batchResults) {
        results[index] = result
      }
    }
  }

  const successCount = results.filter((r) => r.success).length
  log.info('Screenshot set generation complete', { successCount, total: rawImages.length })

  return results
}

/**
 * Check Gemini API status
 */
export async function checkReplicateStatus(): Promise<{
  available: boolean
  error?: string
}> {
  try {
    // Simple API check by listing models
    const model = genAI.getGenerativeModel({ model: IMAGE_MODEL })
    // Just verify the model can be instantiated
    if (model) {
      return { available: true }
    }
    return { available: false, error: 'Model not available' }
  } catch (error) {
    return {
      available: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}
