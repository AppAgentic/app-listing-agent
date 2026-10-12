import { adminDb } from '@/lib/firebase/admin'
import { AccountContext, getProjectContext, hasContextPermission } from '@/lib/org/context'
import { LocalizedMetadata } from '@/lib/firebase/firestore'

export interface ReadMetadataParams {
  projectId: string
  locale?: string // Specific locale to read
  primaryOnly?: boolean // Defaults to true - only return primary locale to avoid overload
}

export interface LocaleMetadata {
  locale: string
  name: string | null
  subtitle: string | null
  description: string | null
  keywords: string | null
  whatsNew: string | null
  promotionalText: string | null
  supportUrl: string | null
  marketingUrl: string | null
  shortDescription: string | null
  fullDescription: string | null
}

export interface ReadMetadataResult {
  success: boolean
  projectName?: string
  primaryLocale?: string
  locales?: LocaleMetadata[]
  error?: string
}

export async function readMetadata(
  params: ReadMetadataParams,
  context: AccountContext
): Promise<ReadMetadataResult> {
  const { projectId, locale, primaryOnly = true } = params

  // Validate project access
  const projectContext = await getProjectContext(context.userId, projectId)
  if (!projectContext) {
    return { success: false, error: 'Project not found' }
  }

  if (!hasContextPermission(projectContext, 'canCreateProjects')) {
    return { success: false, error: 'Permission denied' }
  }

  // Get base path for this project
  const basePath = projectContext.type === 'organization' && projectContext.orgId
    ? adminDb
        .collection('organizations')
        .doc(projectContext.orgId)
        .collection('projects')
        .doc(projectId)
    : adminDb
        .collection('users')
        .doc(context.userId)
        .collection('projects')
        .doc(projectId)

  // Get project info
  const projectDoc = await basePath.get()
  const projectData = projectDoc.data()
  const projectName = projectData?.name || projectData?.appName || 'Unknown'
  const primaryLocale = projectData?.primaryLocale || 'en-US'

  // Fetch metadata
  const metadataCollection = basePath.collection('metadata')

  // Determine which locale(s) to fetch
  const targetLocale = locale || (primaryOnly ? primaryLocale : null)

  if (targetLocale) {
    // Single locale
    const doc = await metadataCollection.doc(targetLocale).get()
    if (!doc.exists) {
      return { success: false, error: `No metadata found for locale: ${targetLocale}` }
    }

    const data = doc.data() as LocalizedMetadata
    return {
      success: true,
      projectName,
      primaryLocale,
      locales: [mapToLocaleMetadata(targetLocale, data)],
    }
  }

  // All locales (primaryOnly=false and no specific locale)
  const snapshot = await metadataCollection.get()
  if (snapshot.empty) {
    return {
      success: true,
      projectName,
      primaryLocale,
      locales: [],
    }
  }

  const locales = snapshot.docs.map(doc => {
    const data = doc.data() as LocalizedMetadata
    return mapToLocaleMetadata(doc.id, data)
  })

  return {
    success: true,
    projectName,
    primaryLocale,
    locales,
  }
}

function mapToLocaleMetadata(locale: string, data: LocalizedMetadata): LocaleMetadata {
  return {
    locale,
    name: data.name || null,
    subtitle: data.subtitle || null,
    description: data.description || null,
    keywords: data.keywords || null,
    whatsNew: data.whatsNew || null,
    promotionalText: data.promotionalText || null,
    supportUrl: data.supportUrl || null,
    marketingUrl: data.marketingUrl || null,
    shortDescription: data.shortDescription || null,
    fullDescription: data.fullDescription || null,
  }
}
