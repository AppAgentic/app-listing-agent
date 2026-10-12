import { GoogleGenerativeAI } from '@google/generative-ai'
import { AI_MODELS } from '@/lib/billing/catalog'
import { AppCategory } from '../constants'

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)

export interface AppMetadata {
  title: string
  subtitle?: string
  description?: string
  keywords?: string
}

export interface HeadlineSuggestions {
  headlines: string[]
  confidence: 'high' | 'medium' | 'low'
  screenshotDescription?: string
}

/**
 * Suggest marketing headlines for a screenshot based on its content and app metadata
 */
export async function suggestHeadlines(params: {
  screenshotUrl: string
  appMetadata: AppMetadata
  appCategory?: AppCategory
  numberOfSuggestions?: number
}): Promise<HeadlineSuggestions> {
  const {
    screenshotUrl,
    appMetadata,
    appCategory = 'productivity',
    numberOfSuggestions = 3
  } = params

  const model = genAI.getGenerativeModel({ model: AI_MODELS.textQuality })

  // Fetch screenshot image
  const imageResponse = await fetch(screenshotUrl)
  if (!imageResponse.ok) {
    throw new Error(`Failed to fetch screenshot: ${imageResponse.statusText}`)
  }
  const imageBuffer = Buffer.from(await imageResponse.arrayBuffer())
  const base64Image = imageBuffer.toString('base64')

  const prompt = `You are an App Store optimization (ASO) expert. Analyze this app screenshot and suggest ${numberOfSuggestions} compelling marketing headlines.

APP CONTEXT:
- App Name: ${appMetadata.title}
${appMetadata.subtitle ? `- Subtitle: ${appMetadata.subtitle}` : ''}
${appMetadata.description ? `- Description: ${appMetadata.description.substring(0, 500)}...` : ''}
${appMetadata.keywords ? `- Keywords: ${appMetadata.keywords}` : ''}
- Category: ${appCategory}

REQUIREMENTS:
- Headlines should be SHORT (3-6 words max)
- Focus on BENEFITS, not features
- Use action verbs when possible
- Match the app's category tone
- Highlight what the screenshot shows
- Make them compelling for App Store browsing

EXAMPLES BY CATEGORY:
- Kids: "Watch Baby Sleep Soundly", "Track Sleep Effortlessly"
- Fitness: "Crush Your Workout Goals", "Train Smarter, Not Harder"
- Productivity: "Get More Done Daily", "Organize Your Life"
- Finance: "Grow Your Wealth", "Money Made Simple"
- Health: "Feel Better Every Day", "Your Health, Simplified"
- Social: "Connect With Friends", "Share Your Moments"

First, briefly describe what you see in the screenshot (1-2 sentences).
Then provide exactly ${numberOfSuggestions} headline suggestions.

Format your response as:
SCREENSHOT: [brief description]
HEADLINES:
1. [headline 1]
2. [headline 2]
3. [headline 3]`

  const response = await model.generateContent([
    prompt,
    {
      inlineData: {
        mimeType: 'image/png',
        data: base64Image
      }
    }
  ])

  const text = response.response.text()

  // Parse response
  const screenshotMatch = text.match(/SCREENSHOT:\s*([\s\S]+?)(?=HEADLINES:|$)/i)
  const headlinesMatch = text.match(/HEADLINES:\s*([\s\S]+)/i)

  let headlines: string[] = []
  let screenshotDescription: string | undefined

  if (screenshotMatch) {
    screenshotDescription = screenshotMatch[1].trim()
  }

  if (headlinesMatch) {
    // Extract numbered headlines
    const headlineLines = headlinesMatch[1]
      .split('\n')
      .map(line => line.replace(/^\d+\.\s*/, '').trim())
      .filter(line => line.length > 0 && line.length < 50)

    headlines = headlineLines.slice(0, numberOfSuggestions)
  }

  // Fallback: try to extract any short phrases
  if (headlines.length === 0) {
    const lines = text
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 3 && l.length < 50 && !l.includes(':'))

    headlines = lines.slice(0, numberOfSuggestions)
  }

  // Determine confidence based on results
  let confidence: 'high' | 'medium' | 'low' = 'low'
  if (headlines.length >= numberOfSuggestions) {
    confidence = 'high'
  } else if (headlines.length >= 2) {
    confidence = 'medium'
  }

  return {
    headlines,
    confidence,
    screenshotDescription
  }
}

/**
 * Suggest headlines for multiple screenshots in batch
 */
export async function suggestHeadlinesBatch(params: {
  screenshots: Array<{
    url: string
    name: string
  }>
  appMetadata: AppMetadata
  appCategory?: AppCategory
  numberOfSuggestions?: number
}): Promise<Map<string, HeadlineSuggestions>> {
  const results = new Map<string, HeadlineSuggestions>()

  // Process in parallel with some concurrency limit
  const concurrency = 3
  const { screenshots, appMetadata, appCategory, numberOfSuggestions } = params

  for (let i = 0; i < screenshots.length; i += concurrency) {
    const batch = screenshots.slice(i, i + concurrency)

    const batchResults = await Promise.all(
      batch.map(async (screenshot) => {
        try {
          const suggestions = await suggestHeadlines({
            screenshotUrl: screenshot.url,
            appMetadata,
            appCategory,
            numberOfSuggestions
          })
          return { name: screenshot.name, suggestions }
        } catch (error) {
          return {
            name: screenshot.name,
            suggestions: {
              headlines: [],
              confidence: 'low' as const,
              screenshotDescription: undefined
            }
          }
        }
      })
    )

    for (const { name, suggestions } of batchResults) {
      results.set(name, suggestions)
    }
  }

  return results
}

/**
 * Refine/improve an existing headline
 */
export async function refineHeadline(params: {
  originalHeadline: string
  screenshotUrl?: string
  appMetadata: AppMetadata
  appCategory?: AppCategory
  direction?: 'shorter' | 'more-action' | 'more-benefit' | 'more-emotional'
}): Promise<string[]> {
  const {
    originalHeadline,
    appMetadata,
    appCategory = 'productivity',
    direction = 'more-benefit'
  } = params

  const model = genAI.getGenerativeModel({ model: AI_MODELS.textQuality })

  const directionInstructions = {
    'shorter': 'Make it shorter and punchier (3-4 words max)',
    'more-action': 'Use stronger action verbs and more dynamic language',
    'more-benefit': 'Focus more on the user benefit, not the feature',
    'more-emotional': 'Make it more emotionally compelling and aspirational'
  }

  const prompt = `Improve this App Store marketing headline: "${originalHeadline}"

APP: ${appMetadata.title}
CATEGORY: ${appCategory}
DIRECTION: ${directionInstructions[direction]}

Requirements:
- Keep it under 6 words
- Make it compelling for App Store browsing
- Focus on benefits

Provide exactly 3 improved versions, one per line, no numbering or extra text.`

  const response = await model.generateContent(prompt)
  const text = response.response.text()

  const headlines = text
    .split('\n')
    .map(line => line.replace(/^[\d\.\-\*]+\s*/, '').trim())
    .filter(line => line.length > 0 && line.length < 50)

  return headlines.slice(0, 3)
}
