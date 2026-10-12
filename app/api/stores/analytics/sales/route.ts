import { NextRequest } from 'next/server'
import { z } from 'zod'
import { authenticateRequest, errorResponse, unauthorizedResponse } from '@/lib/api/auth'
import { getSession } from '@/lib/auth/session'
import { getProjectContext, getAccountContext, AccountContext } from '@/lib/org/context'
import { AppStoreHelper, SalesReportData, AggregatedSalesData } from '@/lib/services/appstore'
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

const requestSchema = z.object({
  projectId: z.string(),
  period: z.enum(['7d', '30d', '90d']).default('30d'),
})

// Country code to name mapping
const COUNTRY_NAMES: Record<string, string> = {
  US: 'United States',
  GB: 'United Kingdom',
  CA: 'Canada',
  AU: 'Australia',
  DE: 'Germany',
  FR: 'France',
  JP: 'Japan',
  CN: 'China',
  KR: 'South Korea',
  IN: 'India',
  BR: 'Brazil',
  MX: 'Mexico',
  ES: 'Spain',
  IT: 'Italy',
  NL: 'Netherlands',
  SE: 'Sweden',
  NO: 'Norway',
  DK: 'Denmark',
  FI: 'Finland',
  CH: 'Switzerland',
  AT: 'Austria',
  BE: 'Belgium',
  IE: 'Ireland',
  NZ: 'New Zealand',
  SG: 'Singapore',
  HK: 'Hong Kong',
  TW: 'Taiwan',
  PH: 'Philippines',
  TH: 'Thailand',
  MY: 'Malaysia',
  ID: 'Indonesia',
  VN: 'Vietnam',
  RU: 'Russia',
  PL: 'Poland',
  CZ: 'Czech Republic',
  TR: 'Turkey',
  SA: 'Saudi Arabia',
  AE: 'United Arab Emirates',
  ZA: 'South Africa',
  EG: 'Egypt',
  IL: 'Israel',
  AR: 'Argentina',
  CL: 'Chile',
  CO: 'Colombia',
  PE: 'Peru',
}

export async function POST(request: NextRequest) {
  // Authenticate
  const { context: authContext, error } = await getAuthContext(request)
  if (!authContext) {
    return unauthorizedResponse(error)
  }

  const { userId } = authContext

  // Parse request
  let body
  try {
    body = requestSchema.parse(await request.json())
  } catch (error) {
    return errorResponse('Invalid request body')
  }

  const { projectId, period } = body

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
  if (!project.vendorNumber) {
    return errorResponse('Vendor number not configured. Add it in project settings to view analytics.', 400)
  }

  // Get account-level credentials
  const accountCredentialsPath = projectContext.type === 'organization' && projectContext.orgId
    ? adminDb.collection('organizations').doc(projectContext.orgId).collection('credentials')
    : adminDb.collection('users').doc(userId).collection('credentials')

  const credentialsDoc = await accountCredentialsPath.doc('appstore').get()

  if (!credentialsDoc.exists) {
    return errorResponse('App Store credentials not configured', 400)
  }

  const encryptedCreds = credentialsDoc.data()!
  const credentials = await decryptAppStoreCredentials({
    encryptedData: encryptedCreds.encryptedData,
    encryptedDek: encryptedCreds.encryptedDek,
    keyVersion: encryptedCreds.keyVersion,
  })

  const helper = new AppStoreHelper(credentials)

  // Calculate date range
  const endDate = new Date()
  endDate.setDate(endDate.getDate() - 2) // Data has 1-2 day delay

  const startDate = new Date(endDate)
  switch (period) {
    case '7d':
      startDate.setDate(startDate.getDate() - 7)
      break
    case '30d':
      startDate.setDate(startDate.getDate() - 30)
      break
    case '90d':
      startDate.setDate(startDate.getDate() - 90)
      break
  }

  // Fetch daily reports for the period
  const allReports: SalesReportData[] = []
  const currentDate = new Date(startDate)

  while (currentDate <= endDate) {
    const dateStr = currentDate.toISOString().split('T')[0]
    try {
      const dayReport = await helper.getSalesReport(
        project.vendorNumber,
        'DAILY',
        dateStr
      )
      if (dayReport) {
        allReports.push(...dayReport)
      }
    } catch (err) {
      // Skip dates with no data
      console.log(`No data for ${dateStr}:`, err)
    }
    currentDate.setDate(currentDate.getDate() + 1)
  }

  // Aggregate the data
  const aggregated = helper.aggregateSalesData(allReports)

  // Add country names
  const byCountryWithNames = aggregated.byCountry.map(c => ({
    ...c,
    name: COUNTRY_NAMES[c.code] || c.code,
  }))

  return Response.json({
    success: true,
    period: {
      start: startDate.toISOString().split('T')[0],
      end: endDate.toISOString().split('T')[0],
    },
    totals: {
      units: aggregated.totalUnits,
      proceeds: aggregated.totalProceeds,
      currency: aggregated.currency,
    },
    daily: aggregated.daily,
    byCountry: byCountryWithNames.slice(0, 20), // Top 20 countries
    byProduct: aggregated.byProduct.slice(0, 10), // Top 10 products
  })
}
