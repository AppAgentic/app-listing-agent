import { GoogleGenerativeAI } from '@google/generative-ai'
import { AI_MODELS } from '@/lib/billing/catalog'
import { APPSTORE_LIMITS, PLAYSTORE_LIMITS } from '../constants'
import crypto from 'crypto'
import { generateGeminiTextWithDirectFallback } from './gemini-direct'

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)

export type TranslationField = 'title' | 'subtitle' | 'description' | 'keywords' | 'whatsNew' | 'promotionalText' | 'shortDescription' | 'fullDescription'
export type Store = 'appstore' | 'playstore'

export interface TranslationResult {
  field: TranslationField
  locale: string
  translatedText: string
  sourceHash: string
  cached: boolean
}

interface CacheEntry {
  translatedText: string
  sourceHash: string
}

// Strip emojis and special Unicode characters that App Store doesn't allow in name/subtitle
// This regex matches most emojis, emoticons, and special symbols
export function stripEmojis(text: string): string {
  return text
    // Remove emoji sequences (including skin tones, ZWJ sequences, etc.)
    .replace(/[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|[\u{1F600}-\u{1F64F}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]|[\u{1F900}-\u{1F9FF}]|[\u{1FA00}-\u{1FA6F}]|[\u{1FA70}-\u{1FAFF}]|[\u{231A}-\u{231B}]|[\u{23E9}-\u{23F3}]|[\u{23F8}-\u{23FA}]|[\u{25AA}-\u{25AB}]|[\u{25B6}]|[\u{25C0}]|[\u{25FB}-\u{25FE}]|[\u{2614}-\u{2615}]|[\u{2648}-\u{2653}]|[\u{267F}]|[\u{2693}]|[\u{26A1}]|[\u{26AA}-\u{26AB}]|[\u{26BD}-\u{26BE}]|[\u{26C4}-\u{26C5}]|[\u{26CE}]|[\u{26D4}]|[\u{26EA}]|[\u{26F2}-\u{26F3}]|[\u{26F5}]|[\u{26FA}]|[\u{26FD}]|[\u{2702}]|[\u{2705}]|[\u{2708}-\u{270D}]|[\u{270F}]|[\u{2712}]|[\u{2714}]|[\u{2716}]|[\u{271D}]|[\u{2721}]|[\u{2728}]|[\u{2733}-\u{2734}]|[\u{2744}]|[\u{2747}]|[\u{274C}]|[\u{274E}]|[\u{2753}-\u{2755}]|[\u{2757}]|[\u{2763}-\u{2764}]|[\u{2795}-\u{2797}]|[\u{27A1}]|[\u{27B0}]|[\u{27BF}]|[\u{2934}-\u{2935}]|[\u{2B05}-\u{2B07}]|[\u{2B1B}-\u{2B1C}]|[\u{2B50}]|[\u{2B55}]|[\u{3030}]|[\u{303D}]|[\u{3297}]|[\u{3299}]|[\u{FE0F}]|[\u{200D}]/gu, '')
    // Clean up any double spaces created by removal
    .replace(/\s+/g, ' ')
    .trim()
}

// Check if text contains emojis or invalid characters for App Store name/subtitle
export function hasInvalidAppStoreCharacters(text: string): boolean {
  const stripped = stripEmojis(text)
  return stripped !== text
}

// Get character limit for a field
function getCharacterLimit(field: TranslationField, store: Store): number {
  if (store === 'appstore') {
    switch (field) {
      case 'title': return APPSTORE_LIMITS.title
      case 'subtitle': return APPSTORE_LIMITS.subtitle
      case 'keywords': return APPSTORE_LIMITS.keywords
      case 'description': return APPSTORE_LIMITS.description
      case 'whatsNew': return APPSTORE_LIMITS.whatsNew
      case 'promotionalText': return APPSTORE_LIMITS.promotionalText
      default: return 4000
    }
  } else {
    switch (field) {
      case 'title': return PLAYSTORE_LIMITS.title
      case 'shortDescription': return PLAYSTORE_LIMITS.shortDescription
      case 'fullDescription': return PLAYSTORE_LIMITS.fullDescription
      default: return 4000
    }
  }
}

// Check if this is an English regional variant adaptation (not a full translation)
function isEnglishRegionalVariant(targetLanguage: string): boolean {
  const englishVariants = ['en-GB', 'en-AU', 'en-CA', 'en-NZ', 'en-IE', 'en-ZA', 'en-IN', 'en-SG', 'en-PH', 'en-MY']
  return englishVariants.some(v => targetLanguage.toLowerCase().includes(v.toLowerCase()))
}

// Get regional English context for prompts
function getEnglishRegionContext(targetLanguage: string): string {
  const regionMap: Record<string, string> = {
    'en-gb': 'British English (UK) - use British spelling (colour, favourite, organise), terminology (trainers not sneakers, flat not apartment), and search terms popular in the UK market',
    'en-au': 'Australian English - use British-style spelling (colour, favourite), Australian terminology and slang where natural, and search terms popular in the Australian market',
    'en-ca': 'Canadian English - use Canadian spelling conventions (often British: colour, favourite, but some American), and search terms popular in the Canadian market',
    'en-nz': 'New Zealand English - use British-style spelling, NZ terminology where relevant, and search terms popular in the New Zealand market',
    'en-ie': 'Irish English - use British spelling and terminology common in Ireland',
    'en-za': 'South African English - use British spelling and terminology common in South Africa',
    'en-in': 'Indian English - use British spelling with terminology familiar to Indian users',
    'en-sg': 'Singapore English - use British spelling with terminology familiar to Singaporean users',
  }
  const key = targetLanguage.toLowerCase()
  return regionMap[key] || 'regional English variant - adapt spelling and terminology appropriately for this market'
}

// App context for translation prompts
interface AppContext {
  name?: string
  subtitle?: string
  category?: string
  description?: string
}

// Build translation prompt based on field type
function buildTranslationPrompt(
  field: TranslationField,
  text: string,
  targetLanguage: string,
  characterLimit: number,
  appContext?: AppContext
): string {
  // Special handling for English regional variants - localize, don't translate
  if (isEnglishRegionalVariant(targetLanguage)) {
    return buildEnglishLocalizationPrompt(field, text, targetLanguage, characterLimit, appContext)
  }

  // Build app context string for prompts
  const appName = appContext?.name || 'the app'
  const appDescription = appContext?.description
    ? `\n\n📱 APP CONTEXT:\nApp name: "${appContext.name || 'Unknown'}"\n${appContext.subtitle ? `Subtitle: "${appContext.subtitle}"\n` : ''}${appContext.category ? `Category: ${appContext.category}\n` : ''}Brief description: ${appContext.description.substring(0, 200)}${appContext.description.length > 200 ? '...' : ''}`
    : appContext?.name
      ? `\n\n📱 APP CONTEXT:\nApp name: "${appContext.name}"${appContext.subtitle ? `\nSubtitle: "${appContext.subtitle}"` : ''}${appContext.category ? `\nCategory: ${appContext.category}` : ''}`
      : ''

  if (field === 'title') {
    return `You are an expert App Store optimization (ASO) specialist and translator. You are translating an app title to maximize App Store search visibility in ${targetLanguage}.

NOTE: The target language "${targetLanguage}" is an ISO language code (e.g., 'uk' = Ukrainian, 'da' = Danish, 'cs' = Czech, 'no' = Norwegian). Do NOT confuse 'uk' with United Kingdom - it means Ukrainian.
${appDescription}

🎯 ASO OPTIMIZATION REQUIREMENTS:
- Translate "${text}" for the ${targetLanguage} market
- Use keywords that users in ${targetLanguage} regions commonly search for when looking for this type of app
- Consider local terminology and popular search terms in that market
- Keep it natural and appealing while being search-optimized
- Character limit: MUST be under ${characterLimit} characters

⚠️ CRITICAL - NO EMOJIS ALLOWED:
- App Store Connect DOES NOT allow emojis in the app title
- Do NOT include any emojis, emoticons, or special Unicode characters
- Use plain text only with standard letters, numbers, and basic punctuation
- If the source text contains emojis, translate the meaning without the emoji

🌍 LOCALIZATION FOCUS:
- Use terms that are popular in ${targetLanguage} speaking regions for this app category
- Consider cultural preferences and local terminology
- Use terminology that locals would actually search for

You must return ONLY the optimized translated title (NO EMOJIS), nothing else.

Text to translate: ${text}`
  }

  if (field === 'subtitle') {
    return `You are an expert App Store optimization (ASO) specialist and translator. You are translating an app subtitle to maximize App Store search visibility in ${targetLanguage}.

NOTE: The target language "${targetLanguage}" is an ISO language code (e.g., 'uk' = Ukrainian, 'da' = Danish, 'cs' = Czech, 'no' = Norwegian). Do NOT confuse 'uk' with United Kingdom - it means Ukrainian.
${appDescription}

🎯 ASO OPTIMIZATION REQUIREMENTS:
- Translate "${text}" for the ${targetLanguage} market
- Include secondary keywords that complement the title for broader search coverage
- Focus on key features that users search for in this app category
- Use terms that differentiate from competitors in ${targetLanguage} markets
- Make it compelling while being search-optimized
- Character limit: MUST be under ${characterLimit} characters

⚠️ CRITICAL - NO EMOJIS ALLOWED:
- App Store Connect DOES NOT allow emojis in the app subtitle
- Do NOT include any emojis, emoticons, or special Unicode characters
- Use plain text only with standard letters, numbers, and basic punctuation
- If the source text contains emojis, translate the meaning without the emoji

🌍 LOCALIZATION FOCUS:
- Use feature descriptions that resonate in ${targetLanguage} speaking regions
- Consider local preferences and terminology
- Include terms that locals would search for when looking for apps like ${appName}

You must return ONLY the optimized translated subtitle (NO EMOJIS), nothing else.

Text to translate: ${text}`
  }

  if (field === 'description' || field === 'whatsNew' || field === 'fullDescription') {
    return `You are an expert language translator specialized in App Store copywriting. You are translating app store content that requires PERFECT formatting preservation.

NOTE: The target language "${targetLanguage}" is an ISO language code (e.g., 'uk' = Ukrainian, 'da' = Danish, 'cs' = Czech, 'no' = Norwegian). Do NOT confuse 'uk' with United Kingdom - it means Ukrainian.
${appDescription}

⚠️ CRITICAL FORMATTING REQUIREMENT - THIS IS ESSENTIAL:
- You MUST preserve EVERY SINGLE line break exactly as it appears in the original
- Do NOT add any extra line breaks anywhere
- Do NOT remove any line breaks anywhere
- Do NOT change the paragraph structure in any way
- Maintain IDENTICAL formatting with the exact same number of blank lines between paragraphs
- Keep bullet points (◆) and formatting symbols exactly as they appear
- Preserve the exact paragraph structure and spacing
- Do NOT reorganize content into different paragraphs
- Keep the same paragraph count and structure as the original
- Output actual line breaks, NOT escaped characters like backslash-n

🎯 TRANSLATION REQUIREMENTS:
- Translate the content naturally while preserving all formatting
- Keep it under ${characterLimit} characters
- Maintain the same tone and style as the original
- Use appropriate terminology for ${targetLanguage} speakers in this app category

The target language is: ${targetLanguage}

You must return ONLY the translated text with IDENTICAL formatting, nothing else.

Text to translate:
${text}`
  }

  // Standard translation for other fields (keywords, shortDescription)
  return `You are an expert language translator specialized in App Store copywriting. Translate the following text to ${targetLanguage} for ${appName}. Make sure the result is under ${characterLimit} characters. Return ONLY the translated text, nothing else.

NOTE: The target language "${targetLanguage}" is an ISO language code (e.g., 'uk' = Ukrainian, 'da' = Danish, 'cs' = Czech, 'no' = Norwegian). Do NOT confuse 'uk' with United Kingdom - it means Ukrainian.
${appDescription}

Text to translate: ${text}`
}

// Build prompt for English regional variant localization (not full translation)
function buildEnglishLocalizationPrompt(
  field: TranslationField,
  text: string,
  targetLanguage: string,
  characterLimit: number,
  appContext?: AppContext
): string {
  const regionContext = getEnglishRegionContext(targetLanguage)
  const appName = appContext?.name || 'the app'
  const appContextStr = appContext?.name
    ? `\n\n📱 APP: "${appContext.name}"${appContext.subtitle ? ` - ${appContext.subtitle}` : ''}`
    : ''

  if (field === 'title' || field === 'subtitle') {
    return `You are an expert App Store optimization (ASO) specialist. You are adapting an app ${field} from American English to ${regionContext}.
${appContextStr}

🎯 REGIONAL ADAPTATION REQUIREMENTS:
- Adapt spelling to match regional conventions (e.g., color→colour, favorite→favourite, organize→organise)
- Consider regional search terms that might improve ASO in this market
- Only change terminology where it genuinely differs and matters for discoverability
- Keep the same meaning, tone, and appeal
- Character limit: MUST be under ${characterLimit} characters

⚠️ CRITICAL - NO EMOJIS ALLOWED:
- App Store Connect DOES NOT allow emojis in the app ${field}
- Do NOT include any emojis, emoticons, or special Unicode characters
- If the source text contains emojis, remove them entirely
- Use plain text only with standard letters, numbers, and basic punctuation

⚠️ IMPORTANT - DON'T FORCE CHANGES:
- If a word/phrase works equally well in both regions, keep the original
- Only adapt what actually needs adapting for this market
- Don't change brand names, technical terms, or words that are universally understood
- The goal is natural localization, not artificial differentiation

You must return ONLY the adapted text (NO EMOJIS), nothing else. If no changes are needed, return the original text exactly (but without emojis).

Text to adapt: ${text}`
  }

  if (field === 'keywords') {
    return `You are an expert App Store optimization (ASO) specialist. You are adapting keywords from American English to ${regionContext} for ${appName}.
${appContextStr}

🎯 KEYWORD ADAPTATION REQUIREMENTS:
- Adapt spelling to regional conventions (e.g., color→colour, favorite→favourite)
- Consider adding regional search term variants that users in this market might use
- Keep keywords comma-separated without spaces after commas
- Character limit: MUST be under ${characterLimit} characters

⚠️ IMPORTANT - BE SELECTIVE:
- Only change keywords where regional spelling actually differs
- Add regional variants only if they're genuinely different search terms
- Don't pad with unnecessary variations
- Focus on terms that will actually improve discoverability in this specific market

You must return ONLY the adapted keywords, nothing else.

Keywords to adapt: ${text}`
  }

  if (field === 'description' || field === 'whatsNew' || field === 'fullDescription') {
    return `You are an expert App Store copywriter. You are adapting app store content from American English to ${regionContext}.
${appContextStr}

⚠️ CRITICAL FORMATTING REQUIREMENT:
- You MUST preserve EVERY SINGLE line break exactly as it appears
- Keep bullet points (◆) and formatting symbols exactly as they appear
- Maintain IDENTICAL paragraph structure

🎯 REGIONAL ADAPTATION:
- Adapt spelling to regional conventions (color→colour, favorite→favourite, organize→organise)
- Adjust terminology only where it genuinely differs and sounds more natural to local users
- Keep the same tone, style, and message
- Character limit: MUST be under ${characterLimit} characters

⚠️ DON'T FORCE CHANGES:
- Only change what actually needs changing for this market
- If a phrase sounds natural in both regions, keep the original
- Don't over-localize - subtle, natural adaptation only
- Technical terms, brand names, and universal words stay the same

You must return ONLY the adapted text with IDENTICAL formatting, nothing else.

Text to adapt:
${text}`
  }

  // Fallback for other fields
  return `Adapt the following text from American English to ${regionContext} for ${appName}. Only change spelling and terminology where it genuinely differs. Keep it under ${characterLimit} characters. Return ONLY the adapted text.
${appContextStr}

Text: ${text}`
}

// Build shortening prompt
function buildShorteningPrompt(
  field: TranslationField,
  text: string,
  targetLanguage: string,
  characterLimit: number
): string {
  if (field === 'title' || field === 'subtitle') {
    return `You are an expert App Store optimization (ASO) specialist. You need to shorten a ${field} while maintaining its search optimization for ${targetLanguage} markets.

🎯 ASO SHORTENING REQUIREMENTS:
- Keep the most important search keywords
- Maintain discoverability for fitness/workout app searches
- Preserve terms that users in ${targetLanguage} regions commonly search for
- Remove less important words but keep core search terms
- Character limit: MUST be under ${characterLimit} characters

You must return ONLY the shortened optimized text, nothing else.

Text to shorten: ${text}`
  }

  // For descriptions
  return `You are an expert writer specialized in health & fitness copywriting for the App Store. You need to shorten app store content while preserving ALL formatting.

⚠️ CRITICAL FORMATTING REQUIREMENT - THIS IS ESSENTIAL:
- You MUST preserve EVERY SINGLE line break exactly as it appears in the original
- Do NOT add any extra line breaks anywhere
- Do NOT remove any line breaks anywhere
- Do NOT change the paragraph structure in any way
- Keep bullet points (◆) and formatting symbols exactly as they appear

🎯 SHORTENING REQUIREMENTS:
- Remove unnecessary words while keeping the core message
- Maintain the same tone and style
- Character limit: MUST be under ${characterLimit} characters
- Language: ${targetLanguage}

You must return ONLY the shortened text with IDENTICAL formatting, nothing else.

Text to shorten: ${text}`
}

export class TranslationHelper {
  private model = genAI.getGenerativeModel({ model: AI_MODELS.textFast })

  private async generateText(prompt: string): Promise<string> {
    const result = await generateGeminiTextWithDirectFallback({
      model: AI_MODELS.textFast,
      prompt,
      generatePrimary: async () => {
        const response = await this.model.generateContent(prompt)
        return response.response.text().trim()
      },
    })
    return result.text.trim()
  }

  /**
   * Generate a hash of the source text for caching
   */
  private hashText(text: string): string {
    return crypto.createHash('sha256').update(text).digest('hex').substring(0, 16)
  }

  /**
   * Shorten text while maintaining ASO optimization
   */
  private async shortenText(
    field: TranslationField,
    text: string,
    targetLanguage: string,
    characterLimit: number
  ): Promise<string> {
    const prompt = buildShorteningPrompt(field, text, targetLanguage, characterLimit)
    let result = await this.generateText(prompt)
    // Convert literal \n strings to actual newlines
    result = result.replace(/\\n/g, '\n')
    return result
  }

  /**
   * Translate a single field
   */
  async translate(
    field: TranslationField,
    text: string,
    targetLanguage: string,
    store: Store,
    cachedTranslation?: CacheEntry,
    appContext?: AppContext
  ): Promise<TranslationResult> {
    const sourceHash = this.hashText(text)
    const characterLimit = getCharacterLimit(field, store)

    // Check cache
    if (cachedTranslation && cachedTranslation.sourceHash === sourceHash) {
      return {
        field,
        locale: targetLanguage,
        translatedText: cachedTranslation.translatedText,
        sourceHash,
        cached: true
      }
    }

    // Translate with retries
    let translatedText = ''
    let attempts = 0
    const maxAttempts = 5

    while (attempts < maxAttempts) {
      try {
        const prompt = buildTranslationPrompt(field, text, targetLanguage, characterLimit, appContext)
        translatedText = await this.generateText(prompt)
        // Convert literal \n strings to actual newlines (LLM sometimes outputs escaped newlines)
        translatedText = translatedText.replace(/\\n/g, '\n')
        break
      } catch (error) {
        console.error(`Translation attempt ${attempts + 1} failed:`, error)
        attempts++
        if (attempts === maxAttempts) throw error
        await new Promise(resolve => setTimeout(resolve, 1000 * attempts))
      }
    }

    // Shorten if needed
    let shorteningAttempts = 0
    const maxShorteningAttempts = 15

    while (translatedText.length > characterLimit && shorteningAttempts < maxShorteningAttempts) {
      console.log(`Shortening ${field} from ${translatedText.length} to under ${characterLimit} chars`)
      translatedText = await this.shortenText(field, translatedText, targetLanguage, characterLimit)
      shorteningAttempts++
    }

    // Final trim if still too long
    if (translatedText.length > characterLimit) {
      translatedText = translatedText.substring(0, characterLimit).trim()
    }

    // Strip emojis from title/subtitle for App Store (they don't allow emojis in these fields)
    if (store === 'appstore' && (field === 'title' || field === 'subtitle')) {
      translatedText = stripEmojis(translatedText)
    }

    return {
      field,
      locale: targetLanguage,
      translatedText,
      sourceHash,
      cached: false
    }
  }

  /**
   * Translate all fields for a locale
   */
  async translateAll(
    metadata: {
      title?: string
      subtitle?: string
      description?: string
      keywords?: string
      whatsNew?: string
      promotionalText?: string
      shortDescription?: string
      fullDescription?: string
    },
    targetLanguage: string,
    store: Store,
    cachedTranslations?: Record<string, CacheEntry>,
    appContext?: AppContext
  ): Promise<TranslationResult[]> {
    const results: TranslationResult[] = []
    const errors: Array<{ field: string; error: string }> = []

    // Build app context from metadata if not provided
    const context: AppContext = appContext || {
      name: metadata.title,
      subtitle: metadata.subtitle,
      description: metadata.description,
    }

    const fields: Array<{ key: TranslationField; value?: string }> = store === 'appstore'
      ? [
          { key: 'title', value: metadata.title },
          { key: 'subtitle', value: metadata.subtitle },
          { key: 'description', value: metadata.description },
          { key: 'keywords', value: metadata.keywords },
          { key: 'whatsNew', value: metadata.whatsNew },
          { key: 'promotionalText', value: metadata.promotionalText }
        ]
      : [
          { key: 'title', value: metadata.title },
          { key: 'shortDescription', value: metadata.shortDescription },
          { key: 'fullDescription', value: metadata.fullDescription }
        ]

    for (const { key, value } of fields) {
      if (!value) continue

      try {
        const cached = cachedTranslations?.[key]
        const result = await this.translate(key, value, targetLanguage, store, cached, context)
        results.push(result)
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error)
        console.error(`[Translator] Failed to translate ${key} to ${targetLanguage}:`, errorMsg)
        errors.push({ field: key, error: errorMsg })
      }
    }

    // Attach errors to results for API to return
    if (errors.length > 0) {
      (results as any).__errors = errors
    }
    return results
  }

  /**
   * Translate to multiple locales in parallel (with concurrency limit)
   */
  async translateToLocales(
    metadata: {
      title?: string
      subtitle?: string
      description?: string
      keywords?: string
      whatsNew?: string
      promotionalText?: string
      shortDescription?: string
      fullDescription?: string
    },
    locales: string[],
    store: Store,
    getCached?: (locale: string) => Promise<Record<string, CacheEntry> | undefined>,
    concurrency: number = 5,
    appContext?: AppContext
  ): Promise<Map<string, TranslationResult[]>> {
    const results = new Map<string, TranslationResult[]>()

    // Build app context from metadata if not provided
    const context: AppContext = appContext || {
      name: metadata.title,
      subtitle: metadata.subtitle,
      description: metadata.description,
    }

    // Process locales in batches
    for (let i = 0; i < locales.length; i += concurrency) {
      const batch = locales.slice(i, i + concurrency)

      const batchResults = await Promise.all(
        batch.map(async (locale) => {
          const cached = getCached ? await getCached(locale) : undefined
          const translations = await this.translateAll(metadata, locale, store, cached, context)
          return { locale, translations }
        })
      )

      for (const { locale, translations } of batchResults) {
        results.set(locale, translations)
      }
    }

    return results
  }
}

// Export AppContext type for external use
export type { AppContext }
