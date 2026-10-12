/**
 * IAP Translation Service
 * AI-powered translation for In-App Purchase display names and descriptions
 * Uses same patterns as metadata translator for consistency
 */

import { GoogleGenerativeAI } from '@google/generative-ai'
import { AI_MODELS } from '@/lib/billing/catalog'
import { LOCALE_NAMES, IAP_LIMITS } from '../constants'
import crypto from 'crypto'

// Initialize Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '')

export interface IAPTranslationResult {
  locale: string
  displayName: string
  description: string
  fromCache: boolean
  sourceHash: string
}

export interface IAPTranslationCache {
  locale: string
  field: 'displayName' | 'description'
  sourceHash: string
  translatedText: string
  createdAt?: Date | unknown // Can be Firestore Timestamp when read from DB
}

export function getIAPLocalesRequiringTranslation(params: {
  sourceLocale: string
  targetLocales: string[]
  displayName: string
  description: string
  existingCache?: Map<string, IAPTranslationCache>
  forceTranslate?: boolean
}): string[] {
  const sourceHash = generateSourceHash(`${params.displayName}|${params.description}`)
  return Array.from(new Set(params.targetLocales)).filter(locale => {
    if (locale === params.sourceLocale) return false
    if (params.forceTranslate || !params.existingCache) return true
    const cachedName = params.existingCache.get(`${locale}_displayName`)
    const cachedDesc = params.existingCache.get(`${locale}_description`)
    return cachedName?.sourceHash !== sourceHash || cachedDesc?.sourceHash !== sourceHash
  })
}

export interface GroupTranslationCache {
  sourceHash: string
  translatedText: string
}

export interface GroupTranslationResult {
  locale: string
  name: string
  fromCache: boolean
  sourceHash: string
}

export function getGroupLocalesRequiringTranslation(params: {
  sourceLocale: string
  targetLocales: string[]
  name: string
  existingCache?: Map<string, GroupTranslationCache>
  forceTranslate?: boolean
}): string[] {
  const sourceHash = generateSourceHash(params.name)
  return Array.from(new Set(params.targetLocales)).filter(locale => {
    if (locale === params.sourceLocale) return false
    if (params.forceTranslate || !params.existingCache) return true
    return params.existingCache.get(`${locale}_name`)?.sourceHash !== sourceHash
  })
}

export async function translateGroupNames(params: {
  sourceLocale: string
  targetLocales: string[]
  name: string
  existingCache?: Map<string, GroupTranslationCache>
  forceTranslate?: boolean
}): Promise<GroupTranslationResult[]> {
  const { sourceLocale, targetLocales, name, existingCache, forceTranslate = false } = params
  const sourceHash = generateSourceHash(name)
  const results: GroupTranslationResult[] = []

  for (const locale of Array.from(new Set(targetLocales))) {
    if (locale === sourceLocale || forceTranslate || !existingCache) continue
    const cached = existingCache.get(`${locale}_name`)
    if (cached?.sourceHash === sourceHash) {
      results.push({
        locale,
        name: cached.translatedText,
        fromCache: true,
        sourceHash,
      })
    }
  }

  const localesToTranslate = getGroupLocalesRequiringTranslation(params)
  const model = genAI.getGenerativeModel({ model: AI_MODELS.textFast })
  const batchSize = 5

  for (let i = 0; i < localesToTranslate.length; i += batchSize) {
    const batch = localesToTranslate.slice(i, i + batchSize)
    const localeList = batch.map(locale => `- ${locale}: ${LOCALE_NAMES[locale] || locale}`).join('\n')
    const prompt = `Translate this App Store subscription group display name to these languages. This is the name users see in App Store subscription management, so localize it naturally. Maximum 30 characters. Use native scripts where appropriate.

Source: "${name}" (${LOCALE_NAMES[sourceLocale] || sourceLocale})

Languages:
${localeList}

Return JSON only: {"translations":[{"locale":"code","name":"translated name"}]}`
    const result = await model.generateContent(prompt)
    const response = result.response.text()
    const jsonMatch = response.match(/\{[\s\S]*\}/)
    if (!jsonMatch) throw new Error('Invalid response format from group translation API')
    const parsed = JSON.parse(jsonMatch[0]) as { translations?: Array<{ locale: string; name: string }> }
    const translations = parsed.translations || []
    for (const translation of translations) {
      if (!batch.includes(translation.locale) || typeof translation.name !== 'string') continue
      results.push({
        locale: translation.locale,
        name: translation.name.substring(0, 30),
        fromCache: false,
        sourceHash,
      })
    }
  }

  return results
}

/**
 * Generate hash for source text (for cache invalidation)
 */
export function generateSourceHash(text: string): string {
  return crypto.createHash('md5').update(text).digest('hex').substring(0, 12)
}

/**
 * Translate IAP fields to multiple locales
 */
export async function translateIAPFields(params: {
  sourceLocale: string
  targetLocales: string[]
  displayName: string
  description: string
  productContext?: string // Optional context about the product (e.g., "100 gold coins for a game")
  existingCache?: Map<string, IAPTranslationCache>
  forceTranslate?: boolean
}): Promise<IAPTranslationResult[]> {
  const {
    sourceLocale,
    targetLocales,
    displayName,
    description,
    productContext,
    existingCache,
    forceTranslate = false,
  } = params

  const results: IAPTranslationResult[] = []
  const sourceHash = generateSourceHash(`${displayName}|${description}`)

  // Filter out source locale and check cache
  const localesToTranslate = getIAPLocalesRequiringTranslation({
    sourceLocale,
    targetLocales,
    displayName,
    description,
    existingCache,
    forceTranslate,
  })

  for (const locale of targetLocales) {
    if (locale === sourceLocale) continue

    // Check cache
    if (!forceTranslate && existingCache) {
      const cachedName = existingCache.get(`${locale}_displayName`)
      const cachedDesc = existingCache.get(`${locale}_description`)

      if (cachedName?.sourceHash === sourceHash && cachedDesc?.sourceHash === sourceHash) {
        results.push({
          locale,
          displayName: cachedName.translatedText,
          description: cachedDesc.translatedText,
          fromCache: true,
          sourceHash,
        })
        continue
      }
    }

  }

  if (localesToTranslate.length === 0) {
    return results
  }

  // Batch translate (5 locales at a time for efficiency)
  const batchSize = 5
  for (let i = 0; i < localesToTranslate.length; i += batchSize) {
    const batch = localesToTranslate.slice(i, i + batchSize)
    const batchResults = await translateBatch({
      sourceLocale,
      targetLocales: batch,
      displayName,
      description,
      productContext,
    })

    results.push(...batchResults.map(r => ({
      ...r,
      fromCache: false,
      sourceHash,
    })))
  }

  return results
}

/**
 * Translate a batch of locales
 */
async function translateBatch(params: {
  sourceLocale: string
  targetLocales: string[]
  displayName: string
  description: string
  productContext?: string
}): Promise<Omit<IAPTranslationResult, 'fromCache' | 'sourceHash'>[]> {
  const { sourceLocale, targetLocales, displayName, description, productContext } = params

  const model = genAI.getGenerativeModel({ model: AI_MODELS.textFast })

  const localeList = targetLocales
    .map(l => `- ${l}: ${LOCALE_NAMES[l] || l}`)
    .join('\n')

  const prompt = `Translate this App Store in-app purchase to these languages. Display Name max ${IAP_LIMITS.displayName} chars, Description max ${IAP_LIMITS.description} chars. Use native scripts for Arabic, Japanese, Chinese, Korean, etc.

Source (${LOCALE_NAMES[sourceLocale] || sourceLocale}):
Display Name: "${displayName}"
Description: "${description}"

Languages:
${localeList}

Return JSON: {"translations":[{"locale":"code","displayName":"translation","description":"translation"}]}`

  try {
    const result = await model.generateContent(prompt)
    const response = result.response.text()

    // Extract JSON from response
    const jsonMatch = response.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      console.error('[IAPTranslator] No JSON found in response:', response)
      throw new Error('Invalid response format from translation API')
    }

    const parsed = JSON.parse(jsonMatch[0])
    const translations = parsed.translations as Array<{
      locale: string
      displayName: string
      description: string
    }>

    // Validate and enforce character limits
    return translations.map(t => ({
      locale: t.locale,
      displayName: t.displayName.substring(0, IAP_LIMITS.displayName),
      description: t.description.substring(0, IAP_LIMITS.description),
    }))
  } catch (error) {
    console.error('[IAPTranslator] Translation failed:', error)
    throw error
  }
}

/**
 * Translate a single locale (convenience function)
 */
export async function translateIAPToLocale(params: {
  sourceLocale: string
  targetLocale: string
  displayName: string
  description: string
  productContext?: string
}): Promise<IAPTranslationResult> {
  const results = await translateIAPFields({
    sourceLocale: params.sourceLocale,
    targetLocales: [params.targetLocale],
    displayName: params.displayName,
    description: params.description,
    productContext: params.productContext,
  })

  if (results.length === 0) {
    // Return source as-is if target is same as source
    return {
      locale: params.targetLocale,
      displayName: params.displayName,
      description: params.description,
      fromCache: false,
      sourceHash: generateSourceHash(`${params.displayName}|${params.description}`),
    }
  }

  return results[0]
}

/**
 * Check if source content has changed (for cache invalidation)
 */
export function hasSourceChanged(
  currentDisplayName: string,
  currentDescription: string,
  cachedSourceHash: string
): boolean {
  const currentHash = generateSourceHash(`${currentDisplayName}|${currentDescription}`)
  return currentHash !== cachedSourceHash
}
