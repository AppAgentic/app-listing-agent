import { GoogleGenerativeAI } from '@google/generative-ai'
import { AI_MODELS } from '@/lib/billing/catalog'
import { appOrigin } from '@/lib/routing/app-url'
import type { DocumentReference } from 'firebase-admin/firestore'

export interface ComplianceMetadata {
  name?: string
  subtitle?: string
  keywords?: string
  description?: string
  whatsNew?: string
  promotionalText?: string
  privacyUrl?: string | null
  // Android/Play Store fields
  shortDescription?: string
  fullDescription?: string
}

export interface AIComplianceIssue {
  id: string
  field: string
  severity: 'error' | 'warning' | 'info'
  message: string
  detail: string
  fixPrompt: string
  guideline?: string
  // Actionable fields for legal document issues
  actionType?: 'create_privacy_policy' | 'publish_privacy_policy' | 'create_terms' | 'publish_terms'
  actionUrl?: string
  actionLabel?: string
}

export interface ComplianceAnalysis {
  issues: AIComplianceIssue[]
  legalStatus: {
    privacyPolicy: {
      exists: boolean
      isPublished: boolean
      publicUrl: string | null
    }
    termsOfService: {
      exists: boolean
      isPublished: boolean
      publicUrl: string | null
    }
  }
  effectivePrivacyUrl: string | null | undefined
  effectiveTermsUrl: string | null
  appContext: {
    hasSubscriptions: boolean
    hasIAPs: boolean
    hasPaidContent: boolean
  }
}

export interface RunComplianceCheckOptions {
  projectId: string
  locale: string
  storeType: 'ios' | 'android'
  metadata: ComplianceMetadata
  basePath: DocumentReference
}

/**
 * Run a compliance check against metadata using Gemini + legal-doc pre-checks.
 * Shared by the web route and the MCP tool.
 */
export async function runComplianceCheck(
  options: RunComplianceCheckOptions
): Promise<ComplianceAnalysis> {
  const { projectId, locale, storeType, metadata, basePath } = options

  if (!process.env.GEMINI_API_KEY) {
    throw new Error('AI service not configured')
  }

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)

  // Get project for publicSlug
  const projectDoc = await basePath.get()
  const projectData = projectDoc.data()
  const publicSlug = projectData?.publicSlug

  // Get legal documents
  const legalSnapshot = await basePath.collection('legal').get()
  const legalDocs: Record<string, { isPublished: boolean; hasContent: boolean }> = {}
  legalSnapshot.forEach((doc) => {
    const data = doc.data()
    legalDocs[doc.id] = {
      isPublished: data.isPublished || false,
      hasContent: !!(data.draftContent || data.publishedContent || data.content),
    }
  })

  const privacyPolicy = legalDocs['privacy_policy']
  const termsOfService = legalDocs['terms_of_service']

  // Build the effective privacy URL
  let effectivePrivacyUrl = metadata.privacyUrl
  if (!effectivePrivacyUrl && privacyPolicy?.isPublished && publicSlug) {
    effectivePrivacyUrl = `${appOrigin()}/legal/${publicSlug}/privacy`
  }

  // Build the effective terms URL
  let effectiveTermsUrl: string | null = null
  if (termsOfService?.isPublished && publicSlug) {
    effectiveTermsUrl = `${appOrigin()}/legal/${publicSlug}/terms`
  }

  // Check if the project has subscriptions or IAPs
  const subscriptionGroupsSnapshot = await basePath.collection('subscriptionGroups').get()
  const iapSnapshot = await basePath.collection('inAppPurchases').get()
  const hasSubscriptions = !subscriptionGroupsSnapshot.empty
  const hasIAPs = !iapSnapshot.empty
  const hasPaidContent = hasSubscriptions || hasIAPs

  // Build pre-check issues for legal documents
  const preCheckIssues: AIComplianceIssue[] = []

  // Privacy Policy checks
  if (!effectivePrivacyUrl) {
    if (!privacyPolicy) {
      preCheckIssues.push({
        id: 'legal-privacy-missing',
        field: 'privacyUrl',
        severity: 'error',
        message: 'Privacy Policy Required',
        detail:
          storeType === 'android'
            ? "Google Play requires apps to have a Privacy Policy. You haven't created a privacy policy yet."
            : "Apple requires all apps to have a Privacy Policy URL. You haven't created a privacy policy yet.",
        fixPrompt: '',
        guideline: '5.1.1',
        actionType: 'create_privacy_policy',
        actionUrl: `/projects/${projectId}/legal`,
        actionLabel: 'Create Privacy Policy',
      })
    } else if (!privacyPolicy.isPublished) {
      preCheckIssues.push({
        id: 'legal-privacy-unpublished',
        field: 'privacyUrl',
        severity: 'error',
        message: 'Privacy Policy Not Published',
        detail:
          storeType === 'android'
            ? "You have a privacy policy draft, but it's not published yet. Publish it to get a public URL for Google Play Console."
            : "You have a privacy policy draft, but it's not published yet. Publish it to get a public URL for App Store Connect.",
        fixPrompt: '',
        guideline: '5.1.1',
        actionType: 'publish_privacy_policy',
        actionUrl: `/projects/${projectId}/legal`,
        actionLabel: 'Publish Privacy Policy',
      })
    }
  }

  // Guideline 3.1.2 - Terms of Use (EULA) required for apps with auto-renewable subscriptions
  if (hasSubscriptions && !effectiveTermsUrl) {
    if (!termsOfService) {
      preCheckIssues.push({
        id: 'legal-terms-missing-subscription',
        field: 'description',
        severity: 'error',
        message: 'Terms of Use (EULA) Required for Subscriptions',
        detail:
          "Your app has auto-renewable subscriptions. Apple requires a functional link to Terms of Use (EULA) in the app description or EULA field. You haven't created Terms of Service yet.",
        fixPrompt: '',
        guideline: '3.1.2',
        actionType: 'create_terms',
        actionUrl: `/projects/${projectId}/legal`,
        actionLabel: 'Create Terms of Service',
      })
    } else if (!termsOfService.isPublished) {
      preCheckIssues.push({
        id: 'legal-terms-unpublished-subscription',
        field: 'description',
        severity: 'error',
        message: 'Terms of Use (EULA) Not Published',
        detail:
          'Your app has auto-renewable subscriptions but your Terms of Service is not published yet. Apple requires a functional link to your EULA.',
        fixPrompt: '',
        guideline: '3.1.2',
        actionType: 'publish_terms',
        actionUrl: `/projects/${projectId}/legal`,
        actionLabel: 'Publish Terms of Service',
      })
    }
  }

  // Run AI compliance analysis
  const prompt = buildCompliancePrompt(
    { ...metadata, privacyUrl: effectivePrivacyUrl },
    locale,
    { hasSubscriptions, hasIAPs },
    storeType
  )

  let issues: AIComplianceIssue[] = []
  const model = genAI.getGenerativeModel({ model: AI_MODELS.textQuality })
  const result = await model.generateContent(prompt)
  const responseText = result.response.text().trim()

  try {
    // Extract JSON from response (handle markdown code blocks)
    const jsonMatch =
      responseText.match(/```json\s*([\s\S]*?)\s*```/) || responseText.match(/\[[\s\S]*\]/)
    const jsonStr = jsonMatch ? jsonMatch[1] || jsonMatch[0] : responseText
    issues = JSON.parse(jsonStr)

    // Add IDs if not present
    issues = issues.map((issue, idx) => ({
      ...issue,
      id: issue.id || `ai-${issue.field}-${idx}`,
    }))
  } catch (parseError) {
    console.error('Failed to parse AI compliance response:', responseText)
    throw new Error('Failed to parse AI analysis')
  }

  const allIssues = [...preCheckIssues, ...issues]

  return {
    issues: allIssues,
    legalStatus: {
      privacyPolicy: {
        exists: !!privacyPolicy,
        isPublished: privacyPolicy?.isPublished || false,
        publicUrl:
          privacyPolicy?.isPublished && publicSlug
            ? `${appOrigin()}/legal/${publicSlug}/privacy`
            : null,
      },
      termsOfService: {
        exists: !!termsOfService,
        isPublished: termsOfService?.isPublished || false,
        publicUrl:
          termsOfService?.isPublished && publicSlug
            ? `${appOrigin()}/legal/${publicSlug}/terms`
            : null,
      },
    },
    effectivePrivacyUrl,
    effectiveTermsUrl,
    appContext: {
      hasSubscriptions,
      hasIAPs,
      hasPaidContent,
    },
  }
}

function buildCompliancePrompt(
  metadata: ComplianceMetadata,
  locale: string,
  context: { hasSubscriptions: boolean; hasIAPs: boolean },
  storeType: 'ios' | 'android' = 'ios'
): string {
  const isAndroid = storeType === 'android'
  const storeName = isAndroid ? 'Google Play Store' : "Apple's App Store"
  const guidelinesName = isAndroid ? 'Google Play Store Policies' : "Apple's App Store Review Guidelines"

  const paidContentContext =
    context.hasSubscriptions || context.hasIAPs
      ? `\nAPP CONTEXT:
- This app has ${context.hasSubscriptions ? 'auto-renewable subscriptions' : ''}${context.hasSubscriptions && context.hasIAPs ? ' and ' : ''}${context.hasIAPs ? 'in-app purchases' : ''}
- IMPORTANT: Check that the description clearly discloses any paid content referenced in the metadata\n`
      : ''

  const metadataSection = isAndroid
    ? `METADATA TO ANALYZE:
- Title (max 30 chars): "${metadata.name || '(empty)'}"
- Short Description (max 80 chars): "${metadata.shortDescription || '(empty)'}"
- Full Description (max 4000 chars): "${metadata.fullDescription || '(empty)'}"`
    : `METADATA TO ANALYZE:
- App Name (max 30 chars): "${metadata.name || '(empty)'}"
- Subtitle (max 30 chars): "${metadata.subtitle || '(empty)'}"
- Keywords (max 100 chars): "${metadata.keywords || '(empty)'}"
- Description (max 4000 chars): "${metadata.description || '(empty)'}"
- What's New (max 4000 chars): "${metadata.whatsNew || '(empty)'}"
- Promotional Text (max 170 chars): "${metadata.promotionalText || '(empty)'}"
- Privacy URL: "${metadata.privacyUrl || '(not provided)'}"`

  const guidelinesSection = isAndroid
    ? `GUIDELINES TO CHECK (${guidelinesName}):

1. **Misleading Claims**:
   - No misleading or unverifiable claims (#1, best, award-winning without proof)
   - No pricing information in title or short description
   - No call-to-actions (download now, click here, try now)
   - No competitor names or trademarked terms
   - No placeholder text (lorem ipsum, TBD, coming soon)
   - Character limits must be respected (title: 30, short description: 80, full description: 4000)

2. **Keyword Spam / Repetition**:
   - No excessive keyword repetition in title or descriptions
   - No ALL CAPS words (except acronyms)
   - No excessive punctuation or emojis
   - Title should not contain generic terms just for SEO

3. **Paid Content Disclosure**:
   - If the description mentions premium features, subscriptions, or paid content, it MUST clearly state that a purchase is required
   - Google Play requires transparency about in-app purchases

4. **Content Quality**:
   - Generic or vague descriptions
   - Poor grammar or spelling
   - Short description should be meaningful, not just repeat the title
   - Full description should clearly explain the app's functionality

5. **Policy Violations**:
   - No references to other platforms (e.g., "also available on iPhone")
   - No user testimonials or ratings claims without evidence
   - No references to Google Play ranking or featured status`
    : `GUIDELINES TO CHECK (${guidelinesName}):

1. **Guideline 2.3 - Accurate Metadata**:
   - No misleading or unverifiable claims (#1, best, award-winning without proof)
   - No pricing information (free, sale, discount, $X)
   - No call-to-actions (download now, click here, try now)
   - No competitor names or trademarked terms
   - No placeholder text (lorem ipsum, TBD, coming soon)
   - No URLs in description (except App Store links)
   - No email addresses in description
   - Character limits must be respected
   - Content must accurately reflect app functionality

2. **Guideline 2.3.2 - Paid Content Disclosure**:
   - If the description, subtitle, or promotional text mentions premium features, subscriptions, pro upgrades, or paid content, it MUST clearly state that a purchase is required
   - References like "premium features", "pro version", "unlock", "subscribe", "subscription" must be accompanied by clear disclosure that additional purchase is required
   - Example violation: "Track sleep patterns with premium insights" without mentioning it requires a subscription purchase
   - Example compliant: "Premium insights available with an optional subscription"
   - This is ESPECIALLY important for apps with auto-renewable subscriptions or in-app purchases

3. **Guideline 2.3.7 - Unverifiable Claims**:
   - Claims like "best", "#1", "top rated", "leading" need documentation
   - Superlatives without evidence will be rejected

4. **Guideline 3.1.2 - Subscriptions** (if app has subscriptions):
   - Description should mention subscription terms (what user gets, that it requires a subscription)
   - If description references subscription features without clearly labeling them as paid, flag it

5. **Guideline 5.1.1 - Privacy**:
   - Privacy Policy URL is REQUIRED for all apps

6. **Quality Issues**:
   - Generic or vague descriptions
   - Poor grammar or spelling
   - Excessive punctuation (!!!) or emojis
   - Keyword stuffing
   - Duplicate keywords`

  return `You are an expert ${storeName} reviewer. Analyze this app metadata for compliance with ${guidelinesName}.

LOCALE: ${locale}
${paidContentContext}
${metadataSection}

${guidelinesSection}

Return a JSON array of issues found. Each issue should have:
- field: which metadata field has the issue
- severity: "error" (will cause rejection), "warning" (may cause rejection), or "info" (suggestion)
- message: short description of the issue
- detail: explanation with the specific problematic text quoted
- fixPrompt: instruction for AI to fix this issue
- guideline: the relevant guideline number (e.g., "2.3", "2.3.2", "2.3.7", "3.1.2", "5.1.1")

IMPORTANT:
- Be thorough but avoid false positives
- Consider context (e.g., "free" in "hands-free" is fine)
- Only flag real issues that could cause ${storeName} rejection
- If no issues found, return an empty array []

Return ONLY valid JSON array, no other text:
`
}
