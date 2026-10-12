import { AccountContext } from '@/lib/org/context'
import { getProjectContext } from '@/lib/org/context'
import { canMutateProject, PROJECT_MUTATION_FORBIDDEN } from '@/lib/org/project-authorization'
import { adminDb } from '@/lib/firebase/admin'
import { Timestamp } from 'firebase-admin/firestore'
import crypto from 'crypto'
import { refundUsage, reserveUsage, settleUsage } from '@/lib/api/usage'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { AI_MODELS } from '@/lib/billing/catalog'

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)

function getBasePath(projectContext: any, userId: string, projectId: string) {
  return projectContext.type === 'organization' && projectContext.orgId
    ? adminDb.collection('organizations').doc(projectContext.orgId).collection('projects').doc(projectId)
    : adminDb.collection('users').doc(userId).collection('projects').doc(projectId)
}

// ---------------------------------------------------------------------------
// generate_custom_page_content
// ---------------------------------------------------------------------------

export interface GenerateCustomPageContentParams {
  __usageOperationId?: string
  projectId: string
  pageId: string
  locale: string
  targetAudience?: string
  keywords?: string[]
  tone?: 'professional' | 'casual' | 'urgent' | 'playful' | 'informative'
}

export interface GenerateCustomPageContentResult {
  success: boolean
  content?: any
  error?: string
}

export async function generateCustomPageContent(
  params: GenerateCustomPageContentParams,
  context: AccountContext
): Promise<GenerateCustomPageContentResult> {
  const { projectId, pageId, locale, targetAudience, keywords, tone } = params

  const projectContext = await getProjectContext(context.userId, projectId)
  if (!projectContext) return { success: false, error: 'Project not found' }
  if (!canMutateProject(projectContext)) return { success: false, error: PROJECT_MUTATION_FORBIDDEN }

  let operationId: string | null = null
  try {
    const basePath = getBasePath(projectContext, context.userId, projectId)

    // Determine if CPP or CSL
    const cppDoc = await basePath.collection('customProductPages').doc(pageId).get()
    const cslDoc = cppDoc.exists ? null : await basePath.collection('customStoreListings').doc(pageId).get()

    const pageType = cppDoc?.exists ? 'cpp' : cslDoc?.exists ? 'csl' : null
    if (!pageType) return { success: false, error: 'Custom page/listing not found' }

    const pageData = (cppDoc?.exists ? cppDoc : cslDoc)!.data()!
    operationId = params.__usageOperationId || crypto.randomUUID()
    const reservation = await reserveUsage(context, {
      operationId,
      usageType: 'translations',
      units: 1,
      metadata: { tool: 'generate_custom_page_content', projectId, model: AI_MODELS.textFast },
    })
    if (!reservation.allowed) return { success: false, error: `Usage limit reached: ${reservation.reason}` }
    if (reservation.replayed) return { success: false, error: 'This content operation was already processed' }

    // Get project metadata for context
    const projectDoc = await basePath.get()
    const projectData = projectDoc.data()
    const appName = projectData?.name || 'App'

    // Build the generation prompt
    const audienceContext = targetAudience ? `Target audience: ${targetAudience}. ` : ''
    const keywordContext = keywords?.length ? `Emphasize these keywords: ${keywords.join(', ')}. ` : ''
    const toneContext = tone ? `Use a ${tone} tone. ` : ''

    const model = genAI.getGenerativeModel({ model: AI_MODELS.textFast })

    if (pageType === 'cpp') {
      // iOS: Generate promotional text (170 chars)
      const prompt = `Generate promotional text for an iOS App Store Custom Product Page.
App name: ${appName}
Page name: ${pageData.name}
Locale: ${locale}
${audienceContext}${keywordContext}${toneContext}
Maximum 170 characters. The text should be compelling and drive downloads.
Return ONLY the promotional text, nothing else.`

      const result = await model.generateContent(prompt)
      const text = result.response.text().trim()
      const truncated = text.substring(0, 170)

      await settleUsage(context, operationId, 'translations', 1)

      return {
        success: true,
        content: {
          promotionalText: truncated,
          locale,
          characterCount: truncated.length,
          maxCharacters: 170,
        },
      }
    } else {
      // Android: Generate title, short description, full description
      const prompt = `Generate store listing content for a Google Play Custom Store Listing.
App name: ${appName}
Listing name: ${pageData.name}
Locale: ${locale}
${audienceContext}${keywordContext}${toneContext}

Generate the following (return as JSON):
1. "title" - App title (max 30 characters)
2. "shortDescription" - Short description (max 80 characters)
3. "fullDescription" - Full description (max 4000 characters)

The content should be compelling, keyword-rich, and drive downloads.
Return ONLY a valid JSON object with these three keys.`

      const result = await model.generateContent(prompt)
      const responseText = result.response.text().trim()

      let parsed: any
      try {
        const jsonMatch = responseText.match(/\{[\s\S]*\}/)
        parsed = JSON.parse(jsonMatch ? jsonMatch[0] : responseText)
      } catch {
        await refundUsage(context, operationId, 'translations')
        return { success: false, error: 'Failed to parse generated content. Please try again.' }
      }

      await settleUsage(context, operationId, 'translations', 1)

      return {
        success: true,
        content: {
          title: (parsed.title || '').substring(0, 30),
          shortDescription: (parsed.shortDescription || '').substring(0, 80),
          fullDescription: (parsed.fullDescription || '').substring(0, 4000),
          locale,
        },
      }
    }
  } catch (error) {
    if (operationId) await refundUsage(context, operationId, 'translations')
    return { success: false, error: error instanceof Error ? error.message : 'Failed to generate content' }
  }
}

// ---------------------------------------------------------------------------
// translate_custom_page_content
// ---------------------------------------------------------------------------

export interface TranslateCustomPageContentParams {
  __usageOperationId?: string
  projectId: string
  pageId: string
  sourceLocale: string
  targetLocales: string[]
  apply?: boolean  // If true, save translations directly to Firestore
}

export interface TranslateCustomPageContentResult {
  success: boolean
  translations?: Record<string, any>
  applied?: boolean
  error?: string
}

export async function translateCustomPageContent(
  params: TranslateCustomPageContentParams,
  context: AccountContext
): Promise<TranslateCustomPageContentResult> {
  const { projectId, pageId, sourceLocale, targetLocales, apply } = params

  if (!targetLocales?.length) {
    return { success: false, error: 'At least one target locale is required' }
  }

  const projectContext = await getProjectContext(context.userId, projectId)
  if (!projectContext) return { success: false, error: 'Project not found' }
  if (!canMutateProject(projectContext)) return { success: false, error: PROJECT_MUTATION_FORBIDDEN }

  let operationId: string | null = null
  try {
    const basePath = getBasePath(projectContext, context.userId, projectId)

    // Determine if CPP or CSL
    const cppDoc = await basePath.collection('customProductPages').doc(pageId).get()
    const cslDoc = cppDoc.exists ? null : await basePath.collection('customStoreListings').doc(pageId).get()

    const pageType = cppDoc?.exists ? 'cpp' : cslDoc?.exists ? 'csl' : null
    if (!pageType) return { success: false, error: 'Custom page/listing not found' }

    const collection = pageType === 'cpp' ? 'customProductPages' : 'customStoreListings'

    // Get source localization
    const sourceDoc = await basePath.collection(collection).doc(pageId)
      .collection('localizations').doc(sourceLocale).get()

    if (!sourceDoc.exists) {
      return { success: false, error: `Source localization '${sourceLocale}' not found` }
    }

    const sourceData = sourceDoc.data()!
    const translations: Record<string, any> = {}
    operationId = params.__usageOperationId || crypto.randomUUID()
    const reservation = await reserveUsage(context, {
      operationId,
      usageType: 'translations',
      units: targetLocales.length,
      metadata: { tool: 'translate_custom_page_content', projectId, model: AI_MODELS.textFast },
    })
    if (!reservation.allowed) return { success: false, error: `Usage limit reached: ${reservation.reason}` }
    if (reservation.replayed) return { success: false, error: 'This content translation was already processed' }

    // Build translation prompt
    let contentToTranslate: string
    if (pageType === 'cpp') {
      contentToTranslate = `Promotional text: "${sourceData.promotionalText || ''}"`
    } else {
      contentToTranslate = `Title: "${sourceData.title || ''}"
Short description: "${sourceData.shortDescription || ''}"
Full description: "${sourceData.fullDescription || ''}"`
    }

    const prompt = `Translate the following app store content from ${sourceLocale} to these locales: ${targetLocales.join(', ')}.

${contentToTranslate}

Important rules:
- Maintain the same tone and marketing appeal
- Respect character limits: ${pageType === 'cpp' ? 'promotional text max 170 chars' : 'title max 30 chars, short description max 80 chars, full description max 4000 chars'}
- Adapt for cultural relevance, don't just translate literally
- Return a JSON object where each key is a locale code and the value is ${pageType === 'cpp' ? '{ "promotionalText": "..." }' : '{ "title": "...", "shortDescription": "...", "fullDescription": "..." }'}

Return ONLY a valid JSON object.`

    const model = genAI.getGenerativeModel({ model: AI_MODELS.textFast })
    const result = await model.generateContent(prompt)
    const responseText = result.response.text().trim()

    let parsed: Record<string, any>
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/)
      parsed = JSON.parse(jsonMatch ? jsonMatch[0] : responseText)
    } catch {
      await refundUsage(context, operationId, 'translations')
      return { success: false, error: 'Failed to parse translations. Please try again.' }
    }

    // Process each translation
    for (const locale of targetLocales) {
      const translation = parsed[locale]
      if (!translation) continue

      if (pageType === 'cpp') {
        translations[locale] = {
          promotionalText: (translation.promotionalText || '').substring(0, 170),
        }
      } else {
        translations[locale] = {
          title: (translation.title || '').substring(0, 30),
          shortDescription: (translation.shortDescription || '').substring(0, 80),
          fullDescription: (translation.fullDescription || '').substring(0, 4000),
        }
      }
    }

    // Apply translations if requested
    if (apply) {
      const batch = adminDb.batch()
      for (const [locale, data] of Object.entries(translations)) {
        const locRef = basePath.collection(collection).doc(pageId)
          .collection('localizations').doc(locale)
        batch.set(locRef, { locale, ...data }, { merge: true })
      }

      // Mark as local_changes
      const pageRef = basePath.collection(collection).doc(pageId)
      batch.update(pageRef, { syncStatus: 'local_changes', updatedAt: Timestamp.now() })

      await batch.commit()
    }

    await settleUsage(context, operationId, 'translations', Object.keys(translations).length)

    return { success: true, translations, applied: !!apply }
  } catch (error) {
    if (operationId) await refundUsage(context, operationId, 'translations')
    return { success: false, error: error instanceof Error ? error.message : 'Failed to translate content' }
  }
}
