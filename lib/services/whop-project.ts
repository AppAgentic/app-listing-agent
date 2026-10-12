/**
 * Whop API v1 Project-Level Service
 * Provides per-project Whop integration for managing products, checkouts,
 * memberships, and members. Separate from the platform-level WhopClient
 * used for our own subscription billing.
 */

const WHOP_API_BASE = 'https://api.whop.com/api/v1'

// ============ Types ============

export type WhopMembershipStatus =
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'completed'
  | 'canceled'
  | 'expired'
  | 'unresolved'
  | 'drafted'

export type WhopMemberStatus = 'drafted' | 'joined' | 'left'

export type WhopAccessLevel = 'no_access' | 'admin' | 'customer'

export type WhopPlanType = 'renewal' | 'one_time'

export type WhopVisibility = 'visible' | 'hidden' | 'archived' | 'quick_link'

export interface WhopProduct {
  id: string
  title: string
  headline: string | null
  description?: string | null
  route: string
  visibility: WhopVisibility
  business_type: string
  industry_type: string
  member_count: number
  verified: boolean
  created_at: string
  updated_at: string
  external_identifier: string | null
  company?: {
    id: string
    route: string
    title: string
  }
}

export interface WhopPlan {
  id: string
  plan_type: WhopPlanType
  initial_price: number
  renewal_price: number
  currency: string
  billing_period: number
  expiration_days: number
  trial_period_days: number
  release_method: string
  visibility: WhopVisibility
}

export interface WhopCheckoutConfiguration {
  id: string
  purchase_url: string
  redirect_url: string | null
  affiliate_code: string | null
  company_id: string
  metadata: Record<string, unknown>
  plan: WhopPlan
}

export interface WhopMembership {
  id: string
  status: WhopMembershipStatus
  cancel_at_period_end: boolean
  canceled_at: string | null
  cancellation_reason: string | null
  license_key: string | null
  manage_url: string
  currency: string
  metadata: Record<string, unknown>
  payment_collection_paused: boolean
  created_at: string
  updated_at: string
  renewal_period_start: string | null
  renewal_period_end: string | null
  company: {
    id: string
    title: string
  }
  member: {
    id: string
  }
  plan: {
    id: string
  }
  product: {
    id: string
    title: string
  }
  promo_code: {
    id: string
  } | null
  user: {
    id: string
    name: string
    username: string
  }
}

export interface WhopMember {
  id: string
  access_level: WhopAccessLevel
  status: WhopMemberStatus
  most_recent_action: string | null
  most_recent_action_at: string | null
  usd_total_spent: number
  phone: string | null
  created_at: string
  joined_at: string
  updated_at: string
  user: {
    id: string
    email: string
    name: string
    username: string
  }
  company?: {
    id: string
    route: string
    title: string
  }
}

export interface WhopCompany {
  id: string
  title: string
  description: string
  route: string
  business_type: string
  industry_type: string
  member_count: number
  verified: boolean
  created_at: string
  updated_at: string
}

export interface WhopPageInfo {
  end_cursor: string | null
  has_next_page: boolean
  has_previous_page: boolean
  start_cursor: string | null
}

export interface WhopPaginatedResponse<T> {
  data: T[]
  page_info: WhopPageInfo
}

// ============ Create/Update Data Types ============

export interface CreateProductData {
  title: string
  headline?: string
  description?: string
  visibility?: WhopVisibility
  business_type?: string
  industry_type?: string
  external_identifier?: string
}

export interface UpdateProductData {
  title?: string
  headline?: string
  description?: string
  visibility?: WhopVisibility
}

export interface CreateCheckoutData {
  plan_id: string
  redirect_url?: string
  affiliate_code?: string
  metadata?: Record<string, unknown>
}

// ============ Helper Class ============

export class WhopProjectHelper {
  private apiKey: string
  private companyId: string

  constructor(apiKey: string, companyId: string) {
    if (!apiKey) {
      throw new Error('Whop API key is required')
    }
    if (!companyId) {
      throw new Error('Whop Company ID is required')
    }
    this.apiKey = apiKey
    this.companyId = companyId
  }

  private async makeRequest<T>(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    endpoint: string,
    body?: Record<string, any>
  ): Promise<T> {
    const url = `${WHOP_API_BASE}${endpoint}`

    const headers: Record<string, string> = {
      'Authorization': `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    }

    const options: RequestInit = {
      method,
      headers,
    }

    if (body && method !== 'GET') {
      options.body = JSON.stringify(body)
    }

    console.log(`[WhopProject] ${method} ${url}`, body ? JSON.stringify(body) : '')

    const response = await fetch(url, options)

    if (!response.ok) {
      const errorText = await response.text()
      console.error(`[WhopProject] Error response (${response.status}) for ${method} ${url}:`, errorText)
      let errorMessage = `Whop API error (${response.status})`
      try {
        const errorJson = JSON.parse(errorText)
        errorMessage = errorJson.message || errorJson.error || errorMessage
      } catch {
        if (errorText.includes('<!doctype html>') || errorText.includes('<html')) {
          errorMessage = `Whop returned HTML error (${response.status}) - endpoint may not exist. URL: ${url}`
        } else {
          errorMessage = errorText || errorMessage
        }
      }
      throw new Error(errorMessage)
    }

    if (response.status === 204) {
      return {} as T
    }

    return response.json()
  }

  // ============ Products ============

  async listProducts(params?: { after?: string; first?: number }): Promise<WhopPaginatedResponse<WhopProduct>> {
    const searchParams = new URLSearchParams({ company_id: this.companyId })
    if (params?.after) searchParams.set('after', params.after)
    if (params?.first) searchParams.set('first', String(params.first))

    return this.makeRequest<WhopPaginatedResponse<WhopProduct>>(
      'GET',
      `/products?${searchParams.toString()}`
    )
  }

  async getProduct(productId: string): Promise<WhopProduct> {
    return this.makeRequest<WhopProduct>('GET', `/products/${productId}`)
  }

  async createProduct(data: CreateProductData): Promise<WhopProduct> {
    return this.makeRequest<WhopProduct>('POST', '/products', {
      ...data,
      company_id: this.companyId,
    })
  }

  async updateProduct(productId: string, data: UpdateProductData): Promise<WhopProduct> {
    return this.makeRequest<WhopProduct>('PATCH', `/products/${productId}`, data)
  }

  async deleteProduct(productId: string): Promise<boolean> {
    return this.makeRequest<boolean>('DELETE', `/products/${productId}`)
  }

  // ============ Checkout Configurations ============

  async createCheckout(data: CreateCheckoutData): Promise<WhopCheckoutConfiguration> {
    return this.makeRequest<WhopCheckoutConfiguration>('POST', '/checkout_configurations', {
      plan_id: data.plan_id,
      mode: 'payment',
      redirect_url: data.redirect_url,
      affiliate_code: data.affiliate_code,
      metadata: data.metadata,
    })
  }

  async getCheckout(checkoutId: string): Promise<WhopCheckoutConfiguration> {
    return this.makeRequest<WhopCheckoutConfiguration>(
      'GET',
      `/checkout_configurations/${checkoutId}`
    )
  }

  async listCheckouts(params?: { after?: string; first?: number }): Promise<WhopPaginatedResponse<WhopCheckoutConfiguration>> {
    const searchParams = new URLSearchParams({ company_id: this.companyId })
    if (params?.after) searchParams.set('after', params.after)
    if (params?.first) searchParams.set('first', String(params.first))

    return this.makeRequest<WhopPaginatedResponse<WhopCheckoutConfiguration>>(
      'GET',
      `/checkout_configurations?${searchParams.toString()}`
    )
  }

  // ============ Memberships ============

  async listMemberships(params?: { after?: string; first?: number; product_id?: string; status?: WhopMembershipStatus }): Promise<WhopPaginatedResponse<WhopMembership>> {
    const searchParams = new URLSearchParams({ company_id: this.companyId })
    if (params?.after) searchParams.set('after', params.after)
    if (params?.first) searchParams.set('first', String(params.first))
    if (params?.product_id) searchParams.set('product_ids[]', params.product_id)
    if (params?.status) searchParams.set('statuses[]', params.status)

    return this.makeRequest<WhopPaginatedResponse<WhopMembership>>(
      'GET',
      `/memberships?${searchParams.toString()}`
    )
  }

  async getMembership(membershipId: string): Promise<WhopMembership> {
    return this.makeRequest<WhopMembership>('GET', `/memberships/${membershipId}`)
  }

  async cancelMembership(membershipId: string, immediate: boolean = false): Promise<WhopMembership> {
    return this.makeRequest<WhopMembership>('POST', `/memberships/${membershipId}/cancel`, {
      cancellation_mode: immediate ? 'immediate' : 'at_period_end',
    })
  }

  // ============ Members ============

  async listMembers(params?: { after?: string; first?: number; status?: WhopMemberStatus }): Promise<WhopPaginatedResponse<WhopMember>> {
    const searchParams = new URLSearchParams({ company_id: this.companyId })
    if (params?.after) searchParams.set('after', params.after)
    if (params?.first) searchParams.set('first', String(params.first))
    if (params?.status) searchParams.set('status', params.status)

    return this.makeRequest<WhopPaginatedResponse<WhopMember>>(
      'GET',
      `/members?${searchParams.toString()}`
    )
  }

  async getMember(memberId: string): Promise<WhopMember> {
    return this.makeRequest<WhopMember>('GET', `/members/${memberId}`)
  }

  // ============ Company ============

  async getCompany(): Promise<WhopCompany> {
    return this.makeRequest<WhopCompany>('GET', `/companies/${this.companyId}`)
  }

  // ============ Test Connection ============

  async testConnection(): Promise<{ success: boolean; company: WhopCompany }> {
    const company = await this.getCompany()
    return { success: true, company }
  }

  // ============ Overview / Stats ============

  async getOverview(): Promise<{
    company: WhopCompany
    productCount: number
    activeMemberCount: number
    products: WhopProduct[]
  }> {
    const [company, productsResponse] = await Promise.all([
      this.getCompany(),
      this.listProducts(),
    ])

    return {
      company,
      productCount: productsResponse.data.length,
      activeMemberCount: company.member_count,
      products: productsResponse.data,
    }
  }
}

// ============ Factory Function ============

/**
 * Get WhopProjectHelper for a project.
 * Reads project-level Whop credentials from Firestore.
 */
export async function getWhopProjectHelper(
  userId: string,
  projectId: string,
  orgId?: string
): Promise<WhopProjectHelper | null> {
  const { isInternalIntegrationUser } = await import('@/lib/features/internal-integrations.server')
  if (!await isInternalIntegrationUser(userId, orgId)) return null

  const { adminDb } = await import('@/lib/firebase/admin')

  const basePath = orgId
    ? adminDb.collection('organizations').doc(orgId).collection('projects').doc(projectId)
    : adminDb.collection('users').doc(userId).collection('projects').doc(projectId)

  const projectDoc = await basePath.get()
  if (!projectDoc.exists) {
    return null
  }

  const projectData = projectDoc.data()
  const whopApiKey = projectData?.whopApiKey
  const whopCompanyId = projectData?.whopCompanyId

  if (!whopApiKey || !whopCompanyId) {
    return null
  }

  return new WhopProjectHelper(whopApiKey, whopCompanyId)
}
