/**
 * RevenueCat API v2 Service
 * Provides integration with RevenueCat for managing products, offerings, entitlements, and packages
 */

const REVENUECAT_API_BASE = 'https://api.revenuecat.com/v2'

export type RevenueCatProductType = 'subscription' | 'non_consumable' | 'consumable'

export interface RevenueCatProduct {
  id: string
  object: 'product'
  store_identifier: string
  app_id: string
  type: RevenueCatProductType
  display_name?: string
  created_at: string
}

export interface RevenueCatOffering {
  id: string
  object: 'offering'
  lookup_key: string
  display_name: string
  is_current: boolean
  packages: RevenueCatPackage[]
  created_at: string
}

export interface RevenueCatPackage {
  id: string
  object: 'package'
  lookup_key: string
  display_name: string
  position: number
  product_id: string
  created_at: string
}

export interface RevenueCatEntitlement {
  id: string
  object: 'entitlement'
  lookup_key: string
  display_name: string
  products: string[] // product IDs
  created_at: string
}

export interface CreateProductParams {
  store_identifier: string // App Store product ID (e.g., com.app.premium)
  app_id: string // RevenueCat App ID
  type: RevenueCatProductType
  display_name?: string
}

export interface CreateOfferingParams {
  lookup_key: string // Unique identifier (e.g., "default", "premium_offering")
  display_name: string
  metadata?: Record<string, string>
}

export interface CreatePackageParams {
  offering_id: string
  lookup_key: string // Package identifier (e.g., "$rc_monthly", "custom_package")
  display_name: string
  position?: number
  product_id: string // RevenueCat product ID
}

export interface CreateEntitlementParams {
  lookup_key: string // Entitlement identifier (e.g., "premium", "pro_access")
  display_name: string
  product_ids?: string[] // RevenueCat product IDs to associate
}

export interface UpdateOfferingParams {
  display_name?: string
  is_current?: boolean
  metadata?: Record<string, string>
}

export type RevenueCatAppType = 'app_store' | 'play_store' | 'stripe' | 'amazon' | 'rc_billing' | 'roku' | 'paddle'

export interface RevenueCatApp {
  id: string
  object: 'app'
  name: string
  type: RevenueCatAppType
  bundle_id?: string // For app_store
  package_name?: string // For play_store, amazon
  created_at: string
}

export interface RevenueCatPublicApiKey {
  id: string
  object: 'public_api_key'
  key: string // The actual public SDK key (e.g., "appl_...")
  app_id: string
  created_at: string
}

export interface CreateAppParams {
  name: string
  type: RevenueCatAppType
  // For App Store - nested under app_store object
  app_store?: {
    bundle_id: string
    shared_secret?: string
    subscription_private_key?: string
    subscription_key_id?: string
    subscription_key_issuer?: string
  }
  // For Play Store - nested under play_store object
  play_store?: {
    package_name: string
    service_account_json?: string
  }
  // For Amazon - nested under amazon object
  amazon?: {
    package_name: string
    shared_secret?: string
  }
}

export class RevenueCatHelper {
  private secretKey: string
  private projectId: string

  constructor(secretKey: string, projectId: string) {
    if (!secretKey) {
      throw new Error('RevenueCat secret key is required')
    }
    if (!projectId) {
      throw new Error('RevenueCat project ID is required')
    }
    this.secretKey = secretKey
    this.projectId = projectId
  }

  private async makeRequest<T>(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    endpoint: string,
    body?: Record<string, any>
  ): Promise<T> {
    const url = `${REVENUECAT_API_BASE}${endpoint}`

    const headers: Record<string, string> = {
      'Authorization': `Bearer ${this.secretKey}`,
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

    console.log(`[RevenueCat] ${method} ${url}`, body ? JSON.stringify(body) : '')

    const response = await fetch(url, options)

    if (!response.ok) {
      const errorText = await response.text()
      console.error(`[RevenueCat] Error response (${response.status}) for ${method} ${url}:`, errorText)
      let errorMessage = `RevenueCat API error (${response.status})`
      try {
        const errorJson = JSON.parse(errorText)
        errorMessage = errorJson.message || errorJson.error || errorMessage
      } catch {
        // If it's an HTML error page, include the URL for debugging
        if (errorText.includes('<!doctype html>') || errorText.includes('<html')) {
          errorMessage = `RevenueCat returned HTML error (${response.status}) - endpoint may not exist or method not allowed. URL: ${url}`
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

  // ============ Apps ============

  /**
   * List all apps in the project
   */
  async listApps(): Promise<RevenueCatApp[]> {
    const result = await this.makeRequest<{ items: RevenueCatApp[] }>(
      'GET',
      `/projects/${this.projectId}/apps`
    )
    return result.items || []
  }

  /**
   * Get a specific app by ID
   */
  async getApp(appId: string): Promise<RevenueCatApp> {
    return this.makeRequest<RevenueCatApp>(
      'GET',
      `/projects/${this.projectId}/apps/${appId}`
    )
  }

  /**
   * Create a new app in the project
   */
  async createApp(params: CreateAppParams): Promise<RevenueCatApp> {
    return this.makeRequest<RevenueCatApp>(
      'POST',
      `/projects/${this.projectId}/apps`,
      params
    )
  }

  /**
   * Delete an app
   */
  async deleteApp(appId: string): Promise<void> {
    await this.makeRequest<void>(
      'DELETE',
      `/projects/${this.projectId}/apps/${appId}`
    )
  }

  /**
   * Find app by bundle ID (iOS) or package name (Android)
   */
  async findAppByIdentifier(identifier: string): Promise<RevenueCatApp | null> {
    const apps = await this.listApps()
    return apps.find(app =>
      app.bundle_id === identifier || app.package_name === identifier
    ) || null
  }

  /**
   * Get public API keys for a specific app (used for SDK configuration)
   */
  async getAppPublicApiKeys(appId: string): Promise<RevenueCatPublicApiKey[]> {
    const result = await this.makeRequest<{ items: RevenueCatPublicApiKey[] }>(
      'GET',
      `/projects/${this.projectId}/apps/${appId}/public_api_keys`
    )
    return result.items || []
  }

  // ============ Products ============

  /**
   * List all products in the project
   */
  async listProducts(appId?: string): Promise<RevenueCatProduct[]> {
    let endpoint = `/projects/${this.projectId}/products`
    if (appId) {
      endpoint += `?app_id=${appId}`
    }
    const result = await this.makeRequest<{ items: RevenueCatProduct[] }>(
      'GET',
      endpoint
    )
    return result.items || []
  }

  /**
   * Get a specific product by ID
   */
  async getProduct(productId: string): Promise<RevenueCatProduct> {
    return this.makeRequest<RevenueCatProduct>(
      'GET',
      `/projects/${this.projectId}/products/${productId}`
    )
  }

  /**
   * Create a new product
   */
  async createProduct(params: CreateProductParams): Promise<RevenueCatProduct> {
    return this.makeRequest<RevenueCatProduct>(
      'POST',
      `/projects/${this.projectId}/products`,
      params
    )
  }

  /**
   * Delete a product
   */
  async deleteProduct(productId: string): Promise<void> {
    await this.makeRequest<void>(
      'DELETE',
      `/projects/${this.projectId}/products/${productId}`
    )
  }

  // ============ Offerings ============

  /**
   * List all offerings in the project
   */
  async listOfferings(): Promise<RevenueCatOffering[]> {
    const result = await this.makeRequest<{ items: RevenueCatOffering[] }>(
      'GET',
      `/projects/${this.projectId}/offerings`
    )
    return result.items || []
  }

  /**
   * Get a specific offering by ID
   */
  async getOffering(offeringId: string): Promise<RevenueCatOffering> {
    return this.makeRequest<RevenueCatOffering>(
      'GET',
      `/projects/${this.projectId}/offerings/${offeringId}`
    )
  }

  /**
   * Create a new offering
   */
  async createOffering(params: CreateOfferingParams): Promise<RevenueCatOffering> {
    return this.makeRequest<RevenueCatOffering>(
      'POST',
      `/projects/${this.projectId}/offerings`,
      params
    )
  }

  /**
   * Update an offering
   */
  async updateOffering(offeringId: string, params: UpdateOfferingParams): Promise<RevenueCatOffering> {
    return this.makeRequest<RevenueCatOffering>(
      'PATCH',
      `/projects/${this.projectId}/offerings/${offeringId}`,
      params
    )
  }

  /**
   * Delete an offering
   */
  async deleteOffering(offeringId: string): Promise<void> {
    await this.makeRequest<void>(
      'DELETE',
      `/projects/${this.projectId}/offerings/${offeringId}`
    )
  }

  // ============ Packages ============

  /**
   * List packages in an offering
   */
  async listPackages(offeringId: string): Promise<RevenueCatPackage[]> {
    const result = await this.makeRequest<{ items: RevenueCatPackage[] }>(
      'GET',
      `/projects/${this.projectId}/offerings/${offeringId}/packages`
    )
    return result.items || []
  }

  /**
   * Create a new package in an offering
   * Note: RevenueCat API v2 requires creating the package first, then attaching products
   */
  async createPackage(params: CreatePackageParams): Promise<RevenueCatPackage> {
    const { offering_id, product_id, ...rest } = params

    // Create the package without product_id (API v2 doesn't accept it directly)
    const pkg = await this.makeRequest<RevenueCatPackage>(
      'POST',
      `/projects/${this.projectId}/offerings/${offering_id}/packages`,
      rest
    )

    // If product_id was provided, attach it to the package
    if (product_id) {
      await this.attachProductToPackage(offering_id, pkg.id, product_id)
      // Return package with product_id set
      return { ...pkg, product_id }
    }

    return pkg
  }

  /**
   * Attach a product to a package
   * Endpoint: POST /projects/{project_id}/packages/{package_id}/actions/attach_products
   * Body requires products array with eligibility_criteria
   */
  async attachProductToPackage(offeringId: string, packageId: string, productId: string): Promise<void> {
    await this.makeRequest<void>(
      'POST',
      `/projects/${this.projectId}/packages/${packageId}/actions/attach_products`,
      {
        products: [
          {
            product_id: productId,
            eligibility_criteria: 'all'
          }
        ]
      }
    )
  }

  /**
   * Detach a product from a package
   * Per RevenueCat MCP docs: endpoint is /packages/{id}/products (no offering_id)
   */
  async detachProductFromPackage(offeringId: string, packageId: string, productId: string): Promise<void> {
    await this.makeRequest<void>(
      'DELETE',
      `/projects/${this.projectId}/packages/${packageId}/products/${productId}`
    )
  }

  /**
   * Get products attached to a package
   * Per RevenueCat MCP docs: endpoint is /packages/{id}/products (no offering_id)
   */
  async getPackageProducts(offeringId: string, packageId: string): Promise<{ product_id: string; base_plan_id?: string }[]> {
    const result = await this.makeRequest<{ items: { product_id: string; base_plan_id?: string }[] }>(
      'GET',
      `/projects/${this.projectId}/packages/${packageId}/products`
    )
    return result.items || []
  }

  /**
   * Update a package
   */
  async updatePackage(
    offeringId: string,
    packageId: string,
    params: Partial<Omit<CreatePackageParams, 'offering_id'>>
  ): Promise<RevenueCatPackage> {
    return this.makeRequest<RevenueCatPackage>(
      'PATCH',
      `/projects/${this.projectId}/offerings/${offeringId}/packages/${packageId}`,
      params
    )
  }

  /**
   * Delete a package
   */
  async deletePackage(offeringId: string, packageId: string): Promise<void> {
    await this.makeRequest<void>(
      'DELETE',
      `/projects/${this.projectId}/offerings/${offeringId}/packages/${packageId}`
    )
  }

  // ============ Entitlements ============

  /**
   * List all entitlements in the project
   */
  async listEntitlements(): Promise<RevenueCatEntitlement[]> {
    const result = await this.makeRequest<{ items: RevenueCatEntitlement[] }>(
      'GET',
      `/projects/${this.projectId}/entitlements`
    )
    return result.items || []
  }

  /**
   * Get a specific entitlement by ID
   */
  async getEntitlement(entitlementId: string): Promise<RevenueCatEntitlement> {
    return this.makeRequest<RevenueCatEntitlement>(
      'GET',
      `/projects/${this.projectId}/entitlements/${entitlementId}`
    )
  }

  /**
   * Create a new entitlement
   */
  async createEntitlement(params: CreateEntitlementParams): Promise<RevenueCatEntitlement> {
    return this.makeRequest<RevenueCatEntitlement>(
      'POST',
      `/projects/${this.projectId}/entitlements`,
      params
    )
  }

  /**
   * Update an entitlement
   */
  async updateEntitlement(
    entitlementId: string,
    params: Partial<CreateEntitlementParams>
  ): Promise<RevenueCatEntitlement> {
    return this.makeRequest<RevenueCatEntitlement>(
      'PATCH',
      `/projects/${this.projectId}/entitlements/${entitlementId}`,
      params
    )
  }

  /**
   * Delete an entitlement
   */
  async deleteEntitlement(entitlementId: string): Promise<void> {
    await this.makeRequest<void>(
      'DELETE',
      `/projects/${this.projectId}/entitlements/${entitlementId}`
    )
  }

  // Note: Attach/detach products to entitlements is not supported by RevenueCat's public REST API v2.
  // This functionality is only available via the RevenueCat Dashboard or their internal API.
}

/**
 * Get RevenueCat helper for a project
 */
export async function getRevenueCatHelper(
  userId: string,
  projectId: string,
  orgId?: string
): Promise<RevenueCatHelper | null> {
  const { isInternalIntegrationUser } = await import('@/lib/features/internal-integrations.server')
  if (!await isInternalIntegrationUser(userId, orgId)) {
    return null
  }

  // Import here to avoid circular dependency
  const { adminDb } = await import('@/lib/firebase/admin')

  const basePath = orgId
    ? adminDb.collection('organizations').doc(orgId).collection('projects').doc(projectId)
    : adminDb.collection('users').doc(userId).collection('projects').doc(projectId)

  const projectDoc = await basePath.get()
  if (!projectDoc.exists) {
    return null
  }

  const projectData = projectDoc.data()
  let revenueCatSecretKey = projectData?.revenueCatSecretKey
  let revenueCatProjectId = projectData?.revenueCatProjectId

  // If credentials not found, check linked project (iOS ↔ Android share RevenueCat)
  if ((!revenueCatSecretKey || !revenueCatProjectId) && projectData?.linkedProjectId) {
    const linkedBasePath = orgId
      ? adminDb.collection('organizations').doc(orgId).collection('projects').doc(projectData.linkedProjectId)
      : adminDb.collection('users').doc(userId).collection('projects').doc(projectData.linkedProjectId)

    const linkedDoc = await linkedBasePath.get()
    if (linkedDoc.exists) {
      const linkedData = linkedDoc.data()
      revenueCatSecretKey = revenueCatSecretKey || linkedData?.revenueCatSecretKey
      revenueCatProjectId = revenueCatProjectId || linkedData?.revenueCatProjectId
    }
  }

  if (!revenueCatSecretKey || !revenueCatProjectId) {
    return null
  }

  return new RevenueCatHelper(revenueCatSecretKey, revenueCatProjectId)
}

/**
 * Map App Store product type to RevenueCat product type
 */
export function mapProductType(appStoreType: string): RevenueCatProductType {
  switch (appStoreType) {
    case 'CONSUMABLE':
      return 'consumable'
    case 'NON_CONSUMABLE':
      return 'non_consumable'
    case 'AUTO_RENEWABLE_SUBSCRIPTION':
    case 'NON_RENEWING_SUBSCRIPTION':
      return 'subscription'
    default:
      return 'subscription'
  }
}
