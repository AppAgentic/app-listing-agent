/**
 * Please note: The following is a revised version of the code selection, updated to align with the given OpenAPI (3.1) definitions.
 * Main changes:
 *  - Interfaces renamed to match the OpenAPI schema (IosApp, IosDev, AppsEstimates, DevAppsEstimates).
 *  - Function return types updated accordingly.
 *  - The rest of the functionality remains the same, but now it more closely follows the OpenAPI naming conventions.
 */

// Start of Selection
/**
 * AppstoreSpy API implementation for iOS app data, aligned with OpenAPI definitions.
 * 
 * Make sure you have an environment variable named APPSPY_API_KEY set with your API key
 * from https://appstorespy.com/account
 * 
 * OpenAPI paths reference:
 *  - GET /ios/apps/{id}
 *  - GET /ios/apps
 *  - POST /ios/apps/query
 *  - GET /ios/developers/{id}
 *  - GET /ios/developers/{id}/estimates
 *  - GET /ios/estimates
 *  - GET /ios/info/countries
 *  - GET /ios/info/languages
 */

import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest, unauthorizedResponse } from '@/lib/api/auth'
import { rateLimit, RATE_LIMITS } from '@/lib/api/rate-limit'

const APPSPY_BASE_URL = 'https://api.appstorespy.com/v1'
const APPSTORE_PATH = `${APPSPY_BASE_URL}/ios/apps`
const DEVELOPER_PATH = `${APPSPY_BASE_URL}/ios/developers`
const ESTIMATES_PATH = `${APPSPY_BASE_URL}/ios/estimates`

// Interfaces named according to the OpenAPI schema
interface IosApp {
  id: string
  bundle: string
  name: string
  description_full?: string
  published: boolean
  listing_visible?: boolean
  category: string
  category_type?: 'APP' | 'GAME'
  revenue_month?: number
  downloads_month?: number
  update_date?: string
  release_date?: string
  developer_name?: string
  description_short?: string
  whatsnew?: string
  icon?: string
  video?: string
  screenshots?: string[]
  removal_date?: string
  version?: string
  size?: number
  rating_count: number
  rating_value: number
  rating_avg: number
  review_count: number
  iap?: boolean
  url_appstorespy: string
  advertised?: boolean
  chart_info?: {
    position: number
    collection: string
    category: string
    platform: string
  }
}

interface IosDev {
  id: string
  name: string
  category?: string
  type?: string
  total_apps?: number
  published_apps?: number
  last_updated?: string
  first_released?: string
  rating_count?: number
  downloads?: number
  revenue?: number
  top_apps?: string[]
  hq_country?: string
  email?: string[]
  url?: string
}

interface AppsEstimates {
  id: string
  month: string
  downloads?: number
  revenue?: number
}

interface DevAppsEstimates {
  month: string
  downloads?: number
  revenue?: number
}

interface ErrorResponse {
  error: string
  status?: number
  details?: any
}

// Common headers (include API-KEY)
const getHeaders = () => ({
  'API-KEY': process.env.APPSPY_API_KEY || '',
  Accept: 'application/json'
})

/**
 * Fetch single iOS app details
 */
async function fetchAppDetails(
  appId: string,
  country = 'US',
  language = 'en_US'
): Promise<IosApp> {
  const url = new URL(`${APPSTORE_PATH}/${appId}`)
  url.searchParams.append('country', country)
  url.searchParams.append('language', language)
  url.searchParams.append('fields', [
    'id', 'bundle', 'name', 'description_full', 'published', 'listing_visible',
    'category', 'category_type', 'revenue_month', 'downloads_month', 'update_date',
    'release_date', 'developer_name', 'description_short', 'whatsnew', 'icon',
    'video', 'screenshots', 'removal_date', 'version', 'size', 'rating_count',
    'rating_value', 'review_count', 'rating_avg', 'iap', 'url_appstorespy',
    'advertised', 'chart_info'
  ].join(','))

  const res = await fetch(url.toString(), { headers: getHeaders() })
  if (!res.ok) {
    throw new Error(`AppstoreSpy API error: ${res.status} ${res.statusText}`)
  }
  return res.json()
}

/**
 * Search iOS apps (GET /ios/apps)
 */
async function searchApps(
  term: string,
  country = 'US',
  language = 'en_US',
  limit = 10,
  page = 1,
  sort?: string
): Promise<{ data: IosApp[]; errors?: any[] }> {
  const url = new URL(APPSTORE_PATH)
  url.searchParams.append('term', term)
  url.searchParams.append('country', country)
  url.searchParams.append('language', language)
  url.searchParams.append('limit', limit.toString())
  url.searchParams.append('page', page.toString())
  if (sort) url.searchParams.append('sort', sort)

  url.searchParams.append('fields', [
    'id', 'bundle', 'name', 'category', 'published', 'rating_count',
    'rating_value', 'rating_avg', 'review_count', 'downloads_month',
    'revenue_month', 'url_appstorespy', 'icon', 'developer_name',
    'description_short', 'description_full', 'downloads_exact', 'release_date'
  ].join(','))

  const res = await fetch(url.toString(), { headers: getHeaders() })
  if (!res.ok) {
    throw new Error(`AppstoreSpy API error: ${res.status} ${res.statusText}`)
  }
  return res.json()
}

/**
 * Advanced query (POST /ios/apps/query)
 */
async function advancedSearch(
  filter: any,
  country = 'US',
  language = 'en_US',
  limit = 10,
  page = 1,
  sort?: string
): Promise<{ data: IosApp[]; errors?: any[] }> {
  const url = new URL(`${APPSTORE_PATH}/query`)

  const body = {
    filter,
    country,
    language,
    limit,
    page,
    sort,
    fields: [
      'id', 'bundle', 'name', 'description_full', 'published', 'listing_visible',
      'category', 'category_type', 'revenue_month', 'downloads_month', 'update_date',
      'release_date', 'developer_name', 'description_short', 'whatsnew', 'icon',
      'video', 'screenshots', 'removal_date', 'version', 'size', 'rating_count',
      'rating_value', 'review_count', 'rating_avg', 'iap', 'url_appstorespy',
      'advertised', 'chart_info', 'downloads_exact'
    ]
  }

  const res = await fetch(url.toString(), {
    method: 'POST',
    headers: { ...getHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })

  if (!res.ok) {
    throw new Error(`AppstoreSpy API error: ${res.status} ${res.statusText}`)
  }
  return res.json()
}

/**
 * Fetch developer details (GET /ios/developers/{id})
 */
async function fetchDeveloper(developerId: string): Promise<IosDev> {
  const url = new URL(`${DEVELOPER_PATH}/${developerId}`)
  url.searchParams.append('fields', [
    'id', 'name', 'total_apps', 'published_apps', 'last_updated',
    'rating_count', 'downloads', 'revenue', 'hq_country', 'email',
    'url', 'top_apps', 'first_released'
  ].join(','))

  const res = await fetch(url.toString(), { headers: getHeaders() })
  if (!res.ok) {
    throw new Error(`AppstoreSpy API error: ${res.status} ${res.statusText}`)
  }
  return res.json()
}

/**
 * Fetch app estimates (GET /ios/estimates)
 */
async function fetchAppEstimates(
  appId: string,
  startDate?: string,
  endDate?: string
): Promise<AppsEstimates[]> {
  const url = new URL(ESTIMATES_PATH)
  url.searchParams.append('id', appId)
  if (startDate) url.searchParams.append('start', startDate)
  if (endDate) url.searchParams.append('end', endDate)

  const res = await fetch(url.toString(), { headers: getHeaders() })
  if (!res.ok) {
    throw new Error(`AppstoreSpy API error: ${res.status} ${res.statusText}`)
  }
  return res.json()
}

/**
 * Fetch developer estimates (GET /ios/developers/{id}/estimates)
 */
async function fetchDeveloperEstimates(
  devId: string,
  startDate?: string,
  endDate?: string
): Promise<DevAppsEstimates[]> {
  const url = new URL(`${DEVELOPER_PATH}/${devId}/estimates`)
  if (startDate) url.searchParams.append('start', startDate)
  if (endDate) url.searchParams.append('end', endDate)

  const res = await fetch(url.toString(), { headers: getHeaders() })
  if (!res.ok) {
    throw new Error(`AppstoreSpy API error: ${res.status} ${res.statusText}`)
  }
  return res.json()
}

/**
 * Fetch available countries (GET /ios/info/countries)
 */
async function fetchCountries(): Promise<string[]> {
  const url = new URL(`${APPSPY_BASE_URL}/ios/info/countries`)
  const res = await fetch(url.toString(), { headers: getHeaders() })
  if (!res.ok) {
    throw new Error(`AppstoreSpy API error: ${res.status} ${res.statusText}`)
  }
  const data = await res.json()
  return data.countries
}

/**
 * Fetch available languages (GET /ios/info/languages)
 */
async function fetchLanguages(): Promise<string[]> {
  const url = new URL(`${APPSPY_BASE_URL}/ios/info/languages`)
  const res = await fetch(url.toString(), { headers: getHeaders() })
  if (!res.ok) {
    throw new Error(`AppstoreSpy API error: ${res.status} ${res.statusText}`)
  }
  const data = await res.json()
  return data.languages
}

// Next.js route handlers
export async function GET(request: NextRequest) {
  // Rate limit
  const rateLimitResult = await rateLimit(request, RATE_LIMITS.default)
  if (!rateLimitResult.success) {
    return NextResponse.json({ error: 'Rate limit exceeded. Please try again later.' }, { status: 429 })
  }

  // Authenticate - require valid user session
  const auth = await authenticateRequest(request)
  if (!auth.authenticated || !auth.context) {
    return unauthorizedResponse(auth.error)
  }

  const { searchParams } = new URL(request.url)
  const action = searchParams.get('action')
  const appId = searchParams.get('appId')
  const searchTerm = searchParams.get('term')
  const developerId = searchParams.get('developerId')
  const country = searchParams.get('country') || 'US'
  const language = searchParams.get('language') || 'en_US'
  const limit = parseInt(searchParams.get('limit') || '10', 10)
  const page = parseInt(searchParams.get('page') || '1', 10)
  const sort = searchParams.get('sort') || undefined
  const startDate = searchParams.get('start_date')
  const endDate = searchParams.get('end_date')

  try {
    switch (action) {
      case 'details': {
        if (!appId) throw new Error('App ID is required')
        const data = await fetchAppDetails(appId, country, language)
        return NextResponse.json(data)
      }
      case 'search': {
        if (!searchTerm) throw new Error('Search term (term) is required')
        
        // Use advanced search if date filters are present
        if (startDate || endDate) {
          const filter: any = {
            name: searchTerm,
            published: true,
            category_type: "APP"
          }
          
          if (startDate || endDate) {
            filter.release_date = {}
            if (startDate) filter.release_date.gte = startDate
            if (endDate) filter.release_date.lte = endDate
          }
          
          const data = await advancedSearch(filter, country, language, limit, page, sort)
          return NextResponse.json(data)
        }
        
        // Use regular search if no date filters
        const data = await searchApps(searchTerm, country, language, limit, page, sort)
        return NextResponse.json(data)
      }
      case 'developer': {
        if (!developerId) throw new Error('Developer ID is required')
        const data = await fetchDeveloper(developerId)
        return NextResponse.json(data)
      }
      case 'estimates': {
        if (!appId) throw new Error('App ID is required')
        const start = searchParams.get('start') || undefined
        const end = searchParams.get('end') || undefined
        const data = await fetchAppEstimates(appId, start, end)
        return NextResponse.json(data)
      }
      case 'dev-estimates': {
        const devId = searchParams.get('devId')
        if (!devId) throw new Error('Developer ID is required')
        const start = searchParams.get('start') || undefined
        const end = searchParams.get('end') || undefined
        const data = await fetchDeveloperEstimates(devId, start, end)
        return NextResponse.json(data)
      }
      case 'countries': {
        const data = await fetchCountries()
        return NextResponse.json({ countries: data })
      }
      case 'languages': {
        const data = await fetchLanguages()
        return NextResponse.json({ languages: data })
      }
      default:
        return NextResponse.json(
          { error: 'Invalid or missing action param' },
          { status: 400 }
        )
    }
  } catch (err: any) {
    const errorResponse: ErrorResponse = {
      error: err.message || 'Internal server error',
      status: err.status || 500
    }
    return NextResponse.json(errorResponse, { status: errorResponse.status })
  }
}

export async function POST(request: NextRequest) {
  // Rate limit
  const rateLimitResult = await rateLimit(request, RATE_LIMITS.default)
  if (!rateLimitResult.success) {
    return NextResponse.json({ error: 'Rate limit exceeded. Please try again later.' }, { status: 429 })
  }

  // Authenticate - require valid user session
  const auth = await authenticateRequest(request)
  if (!auth.authenticated || !auth.context) {
    return unauthorizedResponse(auth.error)
  }

  const { searchParams } = new URL(request.url)
  const action = searchParams.get('action')

  try {
    if (action === 'advanced-search') {
      const body = await request.json()
      const country = searchParams.get('country') || 'US'
      const language = searchParams.get('language') || 'en_US'
      const limit = parseInt(searchParams.get('limit') || '10', 10)
      const page = parseInt(searchParams.get('page') || '1', 10)
      const sort = searchParams.get('sort') || undefined

      const data = await advancedSearch(body, country, language, limit, page, sort)
      return NextResponse.json(data)
    }

    return NextResponse.json(
      { error: 'Invalid or missing action param' },
      { status: 400 }
    )
  } catch (err: any) {
    const errorResponse: ErrorResponse = {
      error: err.message || 'Internal server error',
      status: err.status || 500
    }
    return NextResponse.json(errorResponse, { status: errorResponse.status })
  }
}