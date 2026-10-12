import { NextRequest } from 'next/server'
import { z } from 'zod'
import { authenticateRequest, errorResponse, unauthorizedResponse } from '@/lib/api/auth'
import { getProjectContext, hasContextPermission, getAccountContext, AccountContext } from '@/lib/org/context'
import { getSession } from '@/lib/auth/session'
import { isAppStoreLocale, isPlayStoreLocale } from '@/lib/constants'
import { calculateBillingInfo, getUpgradeSuggestions } from '@/lib/api/billing-utils'

const previewSchema = z.object({
  projectId: z.string(),
  store: z.enum(['appstore', 'playstore']),
  locales: z.array(z.string()).min(1),
  metadata: z.object({
    title: z.string().optional(),
    subtitle: z.string().optional(),
    description: z.string().optional(),
    keywords: z.string().optional(),
    whatsNew: z.string().optional(),
    promotionalText: z.string().optional(),
    shortDescription: z.string().optional(),
    fullDescription: z.string().optional()
  })
})

// Helper to get auth context from either API key or session
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

export async function POST(request: NextRequest) {
  // Authenticate
  const { context: authContext, error: authError } = await getAuthContext(request)
  if (!authContext) {
    return unauthorizedResponse(authError)
  }

  // Parse request
  let body
  try {
    body = previewSchema.parse(await request.json())
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(`Validation error: ${error.errors.map(e => e.message).join(', ')}`)
    }
    return errorResponse('Invalid request body')
  }

  const { projectId, store, locales, metadata } = body

  // Get project context
  const projectContext = await getProjectContext(authContext.userId, projectId)
  if (!projectContext) {
    return errorResponse('Project not found', 404)
  }

  // Check permission
  if (!hasContextPermission(projectContext, 'canCreateProjects')) {
    return errorResponse('Permission denied', 403)
  }

  // Validate locales
  const isValidLocale = store === 'appstore' ? isAppStoreLocale : isPlayStoreLocale
  const invalidLocales = locales.filter(l => !isValidLocale(l))
  if (invalidLocales.length > 0) {
    return errorResponse(`Invalid locales for ${store}: ${invalidLocales.join(', ')}`)
  }

  // Filter out English locales (source language)
  const targetLocales = locales.filter(l => !l.startsWith('en'))

  // Count fields to translate
  const fieldsToTranslate = Object.keys(metadata).filter(k => metadata[k as keyof typeof metadata])
  const totalTasks = targetLocales.length * fieldsToTranslate.length

  if (totalTasks === 0) {
    return errorResponse('No translations to perform (check locales and fields)')
  }

  // Calculate billing info using shared utility
  const billing = await calculateBillingInfo(authContext, 'translations', totalTasks)

  // Calculate upgrade suggestions
  const upgradeSuggestions = getUpgradeSuggestions(
    billing.plan,
    'translations',
    billing.currentUsage,
    totalTasks
  )

  return Response.json({
    totalTasks,
    breakdown: {
      locales: targetLocales.length,
      fields: fieldsToTranslate.length,
      fieldsToTranslate,
    },
    billing,
    upgradeSuggestions,
  })
}
