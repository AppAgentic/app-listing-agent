import { NextRequest } from 'next/server'
import { authenticateRequest, errorResponse, unauthorizedResponse } from '@/lib/api/auth'
import { getSession } from '@/lib/auth/session'
import { getProjectContext, getAccountContext, AccountContext } from '@/lib/org/context'
import { AppStoreHelper, SalesReportData } from '@/lib/services/appstore'
import { decryptAppStoreCredentials } from '@/lib/crypto/credentials'
import { adminDb } from '@/lib/firebase/admin'

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

// GET /api/stores/analytics/summary?projectId=xxx
export async function GET(request: NextRequest) {
  // Authenticate
  const { context: authContext, error } = await getAuthContext(request)
  if (!authContext) {
    return unauthorizedResponse(error)
  }

  const { userId } = authContext
  const projectId = request.nextUrl.searchParams.get('projectId')

  if (!projectId) {
    return errorResponse('projectId is required')
  }

  // Get project context
  const projectContext = await getProjectContext(userId, projectId)
  if (!projectContext) {
    return errorResponse('Project not found', 404)
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
        .doc(userId)
        .collection('projects')
        .doc(projectId)

  // Get project to check for vendorNumber
  const projectDoc = await basePath.get()
  if (!projectDoc.exists) {
    return errorResponse('Project not found', 404)
  }

  const project = projectDoc.data()!

  // Check if vendorNumber is configured
  if (!project.vendorNumber) {
    return Response.json({
      success: true,
      configured: false,
      message: 'Vendor number not configured',
    })
  }

  // Get account-level credentials
  const accountCredentialsPath = projectContext.type === 'organization' && projectContext.orgId
    ? adminDb.collection('organizations').doc(projectContext.orgId).collection('credentials')
    : adminDb.collection('users').doc(userId).collection('credentials')

  const credentialsDoc = await accountCredentialsPath.doc('appstore').get()

  if (!credentialsDoc.exists) {
    return Response.json({
      success: true,
      configured: false,
      message: 'App Store credentials not configured',
    })
  }

  try {
    const encryptedCreds = credentialsDoc.data()!
    const credentials = await decryptAppStoreCredentials({
      encryptedData: encryptedCreds.encryptedData,
      encryptedDek: encryptedCreds.encryptedDek,
      keyVersion: encryptedCreds.keyVersion,
    })

    const helper = new AppStoreHelper(credentials)

    // Get last 7 days of data (current period)
    const endDate = new Date()
    endDate.setDate(endDate.getDate() - 2) // Data has 1-2 day delay

    const startDate = new Date(endDate)
    startDate.setDate(startDate.getDate() - 7)

    // Get previous 7 days (for comparison)
    const prevEndDate = new Date(startDate)
    prevEndDate.setDate(prevEndDate.getDate() - 1)
    const prevStartDate = new Date(prevEndDate)
    prevStartDate.setDate(prevStartDate.getDate() - 7)

    // Fetch current period
    const currentReports: SalesReportData[] = []
    let currentDate = new Date(startDate)
    while (currentDate <= endDate) {
      const dateStr = currentDate.toISOString().split('T')[0]
      try {
        const dayReport = await helper.getSalesReport(
          project.vendorNumber,
          'DAILY',
          dateStr
        )
        if (dayReport) {
          currentReports.push(...dayReport)
        }
      } catch {
        // Skip dates with no data
      }
      currentDate.setDate(currentDate.getDate() + 1)
    }

    // Fetch previous period for comparison
    const prevReports: SalesReportData[] = []
    currentDate = new Date(prevStartDate)
    while (currentDate <= prevEndDate) {
      const dateStr = currentDate.toISOString().split('T')[0]
      try {
        const dayReport = await helper.getSalesReport(
          project.vendorNumber,
          'DAILY',
          dateStr
        )
        if (dayReport) {
          prevReports.push(...dayReport)
        }
      } catch {
        // Skip dates with no data
      }
      currentDate.setDate(currentDate.getDate() + 1)
    }

    // Aggregate both periods
    const currentData = helper.aggregateSalesData(currentReports)
    const prevData = helper.aggregateSalesData(prevReports)

    // Calculate percentage changes
    const revenueChange = prevData.totalProceeds > 0
      ? ((currentData.totalProceeds - prevData.totalProceeds) / prevData.totalProceeds) * 100
      : currentData.totalProceeds > 0 ? 100 : 0

    const downloadsChange = prevData.totalUnits > 0
      ? ((currentData.totalUnits - prevData.totalUnits) / prevData.totalUnits) * 100
      : currentData.totalUnits > 0 ? 100 : 0

    return Response.json({
      success: true,
      configured: true,
      period: {
        start: startDate.toISOString().split('T')[0],
        end: endDate.toISOString().split('T')[0],
      },
      revenue: {
        total: currentData.totalProceeds,
        change: Math.round(revenueChange * 10) / 10, // 1 decimal place
        currency: currentData.currency,
      },
      downloads: {
        total: currentData.totalUnits,
        change: Math.round(downloadsChange * 10) / 10,
      },
      daily: currentData.daily, // For sparkline
      dataAsOf: endDate.toISOString().split('T')[0],
    })
  } catch (error) {
    console.error('Error fetching analytics summary:', error)
    return Response.json({
      success: true,
      configured: true,
      error: 'Failed to fetch analytics data',
      message: error instanceof Error ? error.message : 'Unknown error',
    })
  }
}
