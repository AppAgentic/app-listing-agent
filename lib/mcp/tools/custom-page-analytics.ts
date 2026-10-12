import { AccountContext } from '@/lib/org/context'
import { getProjectContext } from '@/lib/org/context'
import { adminDb } from '@/lib/firebase/admin'

function getBasePath(projectContext: any, userId: string, projectId: string) {
  return projectContext.type === 'organization' && projectContext.orgId
    ? adminDb.collection('organizations').doc(projectContext.orgId).collection('projects').doc(projectId)
    : adminDb.collection('users').doc(userId).collection('projects').doc(projectId)
}

// ---------------------------------------------------------------------------
// get_custom_page_analytics
// ---------------------------------------------------------------------------

export interface GetCustomPageAnalyticsParams {
  projectId: string
  pageId: string
  period?: string  // e.g., '2026-02', '2026-W08'
}

export interface GetCustomPageAnalyticsResult {
  success: boolean
  analytics?: any
  error?: string
}

export async function getCustomPageAnalytics(
  params: GetCustomPageAnalyticsParams,
  context: AccountContext
): Promise<GetCustomPageAnalyticsResult> {
  const { projectId, pageId, period } = params

  const projectContext = await getProjectContext(context.userId, projectId)
  if (!projectContext) return { success: false, error: 'Project not found' }

  try {
    const basePath = getBasePath(projectContext, context.userId, projectId)

    // Check if the page is a CPP or CSL
    const cppDoc = await basePath.collection('customProductPages').doc(pageId).get()
    const cslDoc = cppDoc.exists ? null : await basePath.collection('customStoreListings').doc(pageId).get()

    const pageType = cppDoc?.exists ? 'cpp' : cslDoc?.exists ? 'csl' : null
    if (!pageType) return { success: false, error: 'Custom page/listing not found' }

    const collection = pageType === 'cpp' ? 'customProductPages' : 'customStoreListings'

    if (period) {
      const doc = await basePath.collection(collection).doc(pageId)
        .collection('analytics').doc(period).get()

      if (!doc.exists) {
        return { success: true, analytics: { period, impressions: 0, installs: 0, conversionRate: 0, note: 'No analytics data for this period' } }
      }

      return { success: true, analytics: { period: doc.id, ...doc.data() } }
    } else {
      // Return most recent analytics
      const snapshot = await basePath.collection(collection).doc(pageId)
        .collection('analytics')
        .orderBy('pulledAt', 'desc')
        .limit(5)
        .get()

      const analytics = snapshot.docs.map(doc => ({ period: doc.id, ...doc.data() }))
      return { success: true, analytics: analytics.length > 0 ? analytics : { note: 'No analytics data available yet. Analytics are populated when pulled from the store.' } }
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to get analytics' }
  }
}

// ---------------------------------------------------------------------------
// compare_custom_pages
// ---------------------------------------------------------------------------

export interface CompareCustomPagesParams {
  projectId: string
  pageIds: string[]
  period?: string
}

export interface CompareCustomPagesResult {
  success: boolean
  comparison?: any[]
  error?: string
}

export async function compareCustomPages(
  params: CompareCustomPagesParams,
  context: AccountContext
): Promise<CompareCustomPagesResult> {
  const { projectId, pageIds, period } = params

  if (!pageIds?.length || pageIds.length < 2) {
    return { success: false, error: 'At least 2 pageIds are required for comparison' }
  }

  const projectContext = await getProjectContext(context.userId, projectId)
  if (!projectContext) return { success: false, error: 'Project not found' }

  try {
    const basePath = getBasePath(projectContext, context.userId, projectId)
    const results: any[] = []

    for (const pageId of pageIds) {
      // Determine collection
      const cppDoc = await basePath.collection('customProductPages').doc(pageId).get()
      const cslDoc = cppDoc.exists ? null : await basePath.collection('customStoreListings').doc(pageId).get()

      const pageType = cppDoc?.exists ? 'cpp' : cslDoc?.exists ? 'csl' : null
      if (!pageType) {
        results.push({ pageId, name: 'Unknown', error: 'Not found' })
        continue
      }

      const pageData = (cppDoc?.exists ? cppDoc : cslDoc)!.data()!
      const collection = pageType === 'cpp' ? 'customProductPages' : 'customStoreListings'

      let analyticsData: any = null
      if (period) {
        const doc = await basePath.collection(collection).doc(pageId)
          .collection('analytics').doc(period).get()
        if (doc.exists) analyticsData = doc.data()
      } else {
        const snapshot = await basePath.collection(collection).doc(pageId)
          .collection('analytics')
          .orderBy('pulledAt', 'desc')
          .limit(1)
          .get()
        if (!snapshot.empty) analyticsData = snapshot.docs[0].data()
      }

      results.push({
        pageId,
        name: pageData.name,
        type: pageType,
        impressions: analyticsData?.impressions || 0,
        installs: analyticsData?.installs || 0,
        conversionRate: analyticsData?.conversionRate || 0,
        redownloads: analyticsData?.redownloads || 0,
      })
    }

    return { success: true, comparison: results }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to compare pages' }
  }
}
