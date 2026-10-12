import { adminDb } from '@/lib/firebase/admin'
import { randomUUID } from 'crypto'
import { AccountContext, getProjectContext, hasContextPermission } from '@/lib/org/context'
import { runComplianceCheck, AIComplianceIssue, ComplianceAnalysis } from '@/lib/services/compliance'
import { LocalizedMetadata } from '@/lib/firebase/firestore'
import { AI_MODELS } from '@/lib/billing/catalog'
import { refundUsage, reserveUsage, settleUsage } from '@/lib/api/usage'

export interface CheckComplianceParams {
  projectId: string
  locale?: string
  storeType?: 'ios' | 'android'
}

export interface CheckComplianceResult {
  success: boolean
  locale?: string
  storeType?: 'ios' | 'android'
  issues?: AIComplianceIssue[]
  legalStatus?: ComplianceAnalysis['legalStatus']
  effectivePrivacyUrl?: string | null
  effectiveTermsUrl?: string | null
  appContext?: ComplianceAnalysis['appContext']
  summary?: {
    totalIssues: number
    errors: number
    warnings: number
    infos: number
  }
  error?: string
}

/**
 * MCP tool: check App Store / Play Store metadata against review guidelines.
 * Reads metadata from Firestore for the given locale (defaults to primary),
 * runs the same Gemini + legal-doc pre-check pipeline as the dashboard's
 * ComplianceChecker, and returns the issues array.
 */
export async function checkMetadataCompliance(
  params: CheckComplianceParams,
  context: AccountContext
): Promise<CheckComplianceResult> {
  const { projectId, storeType = 'ios' } = params

  // Validate project access
  const projectContext = await getProjectContext(context.userId, projectId)
  if (!projectContext) {
    return { success: false, error: 'Project not found' }
  }

  if (!hasContextPermission(projectContext, 'canCreateProjects')) {
    return { success: false, error: 'Permission denied' }
  }

  // Base path for this project
  const basePath =
    projectContext.type === 'organization' && projectContext.orgId
      ? adminDb
          .collection('organizations')
          .doc(projectContext.orgId)
          .collection('projects')
          .doc(projectId)
      : adminDb.collection('users').doc(context.userId).collection('projects').doc(projectId)

  // Resolve locale — default to primary if not provided
  const projectDoc = await basePath.get()
  const projectData = projectDoc.data()
  if (!projectData) {
    return { success: false, error: 'Project not found' }
  }
  const primaryLocale = projectData.primaryLocale || 'en-US'
  const locale = params.locale || primaryLocale

  // Fetch metadata for this locale
  const metadataDoc = await basePath.collection('metadata').doc(locale).get()
  if (!metadataDoc.exists) {
    return {
      success: false,
      error: `No metadata found for locale ${locale}. Create or translate metadata first.`,
    }
  }
  const md = metadataDoc.data() as LocalizedMetadata

  // Privacy URL comes from the project-level setting (not per-locale)
  const privacyUrl: string | null = projectData.privacyUrl || null

  const operationId = (params as CheckComplianceParams & { __usageOperationId?: string }).__usageOperationId || randomUUID()
  const reservation = await reserveUsage(context, {
    operationId,
    usageType: 'translations',
    units: 1,
    metadata: { tool: 'check_metadata_compliance', projectId, model: AI_MODELS.textQuality },
  })
  if (!reservation.allowed) {
    return {
      success: false,
      error: `Translation credit limit reached. Remaining: ${reservation.remaining}, required: 1`,
    }
  }
  if (reservation.replayed) {
    return { success: false, error: 'This compliance check has already been processed' }
  }

  try {
    const analysis = await runComplianceCheck({
      projectId,
      locale,
      storeType,
      metadata: {
        name: md.name || undefined,
        subtitle: md.subtitle || undefined,
        keywords: md.keywords || undefined,
        description: md.description || undefined,
        whatsNew: md.whatsNew || undefined,
        promotionalText: md.promotionalText || undefined,
        privacyUrl,
        shortDescription: md.shortDescription || undefined,
        fullDescription: md.fullDescription || undefined,
      },
      basePath,
    })

    const errors = analysis.issues.filter((i) => i.severity === 'error').length
    const warnings = analysis.issues.filter((i) => i.severity === 'warning').length
    const infos = analysis.issues.filter((i) => i.severity === 'info').length
    await settleUsage(context, operationId, 'translations', 1)

    return {
      success: true,
      locale,
      storeType,
      issues: analysis.issues,
      legalStatus: analysis.legalStatus,
      effectivePrivacyUrl: analysis.effectivePrivacyUrl ?? null,
      effectiveTermsUrl: analysis.effectiveTermsUrl,
      appContext: analysis.appContext,
      summary: {
        totalIssues: analysis.issues.length,
        errors,
        warnings,
        infos,
      },
    }
  } catch (error) {
    await refundUsage(context, operationId, 'translations')
    console.error('checkMetadataCompliance failed:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Compliance check failed',
    }
  }
}
