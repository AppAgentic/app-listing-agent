import { NextRequest } from 'next/server'
import crypto from 'crypto'
import { z } from 'zod'
import { errorResponse, unauthorizedResponse } from '@/lib/api/auth'
import { getAccountContext, AccountContext } from '@/lib/org/context'
import { getSession } from '@/lib/auth/session'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { AI_MODELS } from '@/lib/billing/catalog'
import { createReservationErrorResponse, refundUsage, reserveUsage, settleUsage } from '@/lib/api/usage'

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)

const answersSchema = z.object({
  appName: z.string(),
  companyName: z.string(),
  contactEmail: z.string(),
  websiteUrl: z.string().optional(),
  collectsPersonalData: z.boolean(),
  dataTypes: z.array(z.string()),
  usesAnalytics: z.boolean(),
  analyticsProviders: z.array(z.string()),
  usesAds: z.boolean(),
  adProviders: z.array(z.string()),
  usesThirdPartyAuth: z.boolean(),
  authProviders: z.array(z.string()),
  storesDataLocally: z.boolean(),
  storesDataInCloud: z.boolean(),
  cloudProvider: z.string().optional(),
  dataRetentionPeriod: z.string(),
  allowsDataAccess: z.boolean(),
  allowsDataDeletion: z.boolean(),
  allowsDataExport: z.boolean(),
  targetedAtChildren: z.boolean(),
  collectsChildrenData: z.boolean(),
  requiresAccount: z.boolean(),
  hasInAppPurchases: z.boolean(),
  hasSubscriptions: z.boolean(),
  hasUserGeneratedContent: z.boolean(),
  ageRestriction: z.string(),
  governingLaw: z.string().optional(),
})

const requestSchema = z.object({
  type: z.enum(['privacy_policy', 'terms_of_service']),
  answers: answersSchema,
})

async function getAuthContext(request: NextRequest): Promise<{ context: AccountContext | null; error?: string }> {
  const authHeader = request.headers.get('Authorization')
  if (authHeader) {
    const { authenticateRequest } = await import('@/lib/api/auth')
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

export async function POST(request: NextRequest) {
  const { context: authContext, error: authError } = await getAuthContext(request)
  if (!authContext) {
    return unauthorizedResponse(authError)
  }

  let body
  try {
    body = requestSchema.parse(await request.json())
  } catch {
    return errorResponse('Invalid request body')
  }

  const { type, answers } = body

  if (!process.env.GEMINI_API_KEY) {
    return errorResponse('AI service not configured', 503)
  }

  const prompt = type === 'privacy_policy'
    ? buildPrivacyPolicyPrompt(answers)
    : buildTermsOfServicePrompt(answers)

  const operationId = request.headers.get('idempotency-key') || crypto.randomUUID()
  const reservation = await reserveUsage(authContext, {
    operationId,
    usageType: 'translations',
    units: 1,
    metadata: { route: '/api/legal/generate', model: AI_MODELS.textFast },
  })
  if (!reservation.allowed) return createReservationErrorResponse(reservation)
  if (reservation.replayed) return errorResponse('This legal generation was already processed', 409)

  try {
    const model = genAI.getGenerativeModel({ model: AI_MODELS.textFast })
    const result = await model.generateContent(prompt)
    const content = result.response.text().trim()

    // Remove any markdown code block wrappers if present
    const cleanContent = content
      .replace(/^```(?:markdown)?\s*\n?/i, '')
      .replace(/\n?```\s*$/i, '')
      .trim()
    await settleUsage(authContext, operationId, 'translations', 1)

    return Response.json({
      success: true,
      content: cleanContent,
    })
  } catch (error) {
    await refundUsage(authContext, operationId, 'translations')
    console.error('Policy generation failed:', error)
    return errorResponse(
      error instanceof Error ? error.message : 'Policy generation failed',
      500
    )
  }
}

function buildPrivacyPolicyPrompt(answers: z.infer<typeof answersSchema>): string {
  const dataTypesLabels: Record<string, string> = {
    name: 'Name',
    email: 'Email address',
    phone: 'Phone number',
    location: 'Location data',
    device: 'Device information',
    usage: 'Usage data / Analytics',
    photos: 'Photos / Media',
    contacts: 'Contacts',
    health: 'Health data',
    financial: 'Financial information',
  }

  const analyticsLabels: Record<string, string> = {
    firebase: 'Firebase Analytics',
    mixpanel: 'Mixpanel',
    amplitude: 'Amplitude',
    segment: 'Segment',
    other: 'Other analytics services',
  }

  const adLabels: Record<string, string> = {
    admob: 'Google AdMob',
    facebook: 'Facebook Ads',
    unity: 'Unity Ads',
    applovin: 'AppLovin',
    other: 'Other advertising networks',
  }

  const authLabels: Record<string, string> = {
    apple: 'Sign in with Apple',
    google: 'Google Sign-In',
    facebook: 'Facebook Login',
    twitter: 'Twitter/X Login',
    other: 'Other authentication providers',
  }

  const retentionLabels: Record<string, string> = {
    session: 'only during the session',
    '30days': 'for 30 days',
    '1year': 'for 1 year',
    indefinite: 'until you request deletion',
    custom: 'for a specified period',
  }

  return `Generate a professional, legally-sound Privacy Policy in Markdown format for a mobile app.

APP INFORMATION:
- App Name: ${answers.appName}
- Company/Developer: ${answers.companyName}
- Contact Email: ${answers.contactEmail}
- Website: ${answers.websiteUrl || 'Not provided'}

DATA COLLECTION:
- Collects Personal Data: ${answers.collectsPersonalData ? 'Yes' : 'No'}
- Data Types Collected: ${answers.dataTypes.map(t => dataTypesLabels[t] || t).join(', ') || 'None'}

THIRD-PARTY SERVICES:
- Uses Analytics: ${answers.usesAnalytics ? `Yes (${answers.analyticsProviders.map(p => analyticsLabels[p] || p).join(', ')})` : 'No'}
- Uses Advertising: ${answers.usesAds ? `Yes (${answers.adProviders.map(p => adLabels[p] || p).join(', ')})` : 'No'}
- Third-Party Sign-In: ${answers.usesThirdPartyAuth ? `Yes (${answers.authProviders.map(p => authLabels[p] || p).join(', ')})` : 'No'}

DATA STORAGE:
- Stored Locally: ${answers.storesDataLocally ? 'Yes' : 'No'}
- Stored in Cloud: ${answers.storesDataInCloud ? `Yes${answers.cloudProvider ? ` (${answers.cloudProvider})` : ''}` : 'No'}
- Retention Period: Data is retained ${retentionLabels[answers.dataRetentionPeriod] || answers.dataRetentionPeriod}

USER RIGHTS:
- Right to Access Data: ${answers.allowsDataAccess ? 'Yes' : 'No'}
- Right to Delete Data: ${answers.allowsDataDeletion ? 'Yes' : 'No'}
- Right to Export Data: ${answers.allowsDataExport ? 'Yes' : 'No'}

CHILDREN'S PRIVACY:
- App Targeted at Children: ${answers.targetedAtChildren ? 'Yes' : 'No'}
- Collects Data from Children: ${answers.collectsChildrenData ? 'Yes' : 'No'}

REQUIREMENTS:
1. Use proper Markdown formatting with headers (##), bullet points, and bold text
2. Include all standard sections: Information Collection, Use of Information, Data Sharing, Data Security, User Rights, Children's Privacy, Changes to Policy, Contact
3. Be specific about what data is collected and how it's used
4. Mention each third-party service by name if applicable
5. Include GDPR and CCPA compliance language
6. Include the current date as the effective date
7. Be clear, professional, and legally compliant
8. Do NOT include any markdown code block wrappers

Generate the complete Privacy Policy in Markdown format:`
}

function buildTermsOfServicePrompt(answers: z.infer<typeof answersSchema>): string {
  const ageLabels: Record<string, string> = {
    none: 'no age restriction',
    '4+': '4 years or older',
    '9+': '9 years or older',
    '12+': '12 years or older',
    '17+': '17 years or older',
    '18+': '18 years or older (adults only)',
  }

  return `Generate professional, legally-sound Terms of Service in Markdown format for a mobile app.

APP INFORMATION:
- App Name: ${answers.appName}
- Company/Developer: ${answers.companyName}
- Contact Email: ${answers.contactEmail}
- Website: ${answers.websiteUrl || 'Not provided'}

APP FEATURES:
- User Accounts: ${answers.requiresAccount ? 'Yes - users can create accounts' : 'No - no user accounts'}
- In-App Purchases: ${answers.hasInAppPurchases ? 'Yes' : 'No'}
- Subscriptions: ${answers.hasSubscriptions ? 'Yes' : 'No'}
- User-Generated Content: ${answers.hasUserGeneratedContent ? 'Yes - users can create and share content' : 'No'}

RESTRICTIONS:
- Age Requirement: ${ageLabels[answers.ageRestriction] || 'No restriction'}
- Governing Law: ${answers.governingLaw || 'United States'}

REQUIREMENTS:
1. Use proper Markdown formatting with headers (##), bullet points, and bold text
2. Include all standard sections:
   - Acceptance of Terms
   - Description of Service
   - User Accounts (if applicable)
   - User Conduct / Acceptable Use
   - Intellectual Property
   - In-App Purchases and Payments (if applicable)
   - Subscriptions (if applicable)
   - User Content (if applicable)
   - Disclaimers and Limitations of Liability
   - Termination
   - Changes to Terms
   - Governing Law
   - Contact Information
3. Be clear about what users can and cannot do
4. Include appropriate disclaimers for app store purchases (Apple/Google handle billing)
5. Be professional and legally compliant
6. Include the current date as the effective date
7. Do NOT include any markdown code block wrappers

Generate the complete Terms of Service in Markdown format:`
}
