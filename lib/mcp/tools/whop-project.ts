/**
 * Whop Project MCP Tools
 * Provides MCP tools for per-project Whop integration: products, checkouts,
 * memberships, members, and connection testing.
 */

import { AccountContext, getProjectContext } from '@/lib/org/context'
import {
  getWhopProjectHelper,
  type WhopProduct,
  type WhopCheckoutConfiguration,
  type WhopMembership,
  type WhopMember,
  type WhopMembershipStatus,
  type WhopCompany,
} from '@/lib/services/whop-project'

// ============ Shared Helper ============

async function getHelper(context: AccountContext, projectId: string) {
  const projectContext = await getProjectContext(context.userId, projectId)
  if (!projectContext) {
    return { error: 'Project not found' as const }
  }

  const helper = await getWhopProjectHelper(context.userId, projectId, projectContext.orgId)
  if (!helper) {
    return { error: 'Whop not configured for this project. Add Whop API key and company ID in project settings.' as const }
  }

  return { helper }
}

// ============ Test Connection ============

export interface WhopTestConnectionParams {
  projectId: string
}

export interface WhopTestConnectionResult {
  success: boolean
  company?: WhopCompany
  error?: string
}

export async function whopTestConnection(
  params: WhopTestConnectionParams,
  context: AccountContext
): Promise<WhopTestConnectionResult> {
  const result = await getHelper(context, params.projectId)
  if ('error' in result) return { success: false, error: result.error }

  try {
    const { company } = await result.helper.testConnection()
    return { success: true, company }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to test connection' }
  }
}

// ============ List Products ============

export interface WhopListProductsParams {
  projectId: string
  after?: string
}

export interface WhopListProductsResult {
  success: boolean
  products?: WhopProduct[]
  hasNextPage?: boolean
  error?: string
}

export async function whopListProducts(
  params: WhopListProductsParams,
  context: AccountContext
): Promise<WhopListProductsResult> {
  const result = await getHelper(context, params.projectId)
  if ('error' in result) return { success: false, error: result.error }

  try {
    const response = await result.helper.listProducts({ after: params.after })
    return {
      success: true,
      products: response.data,
      hasNextPage: response.page_info.has_next_page,
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to list products' }
  }
}

// ============ Get Product ============

export interface WhopGetProductParams {
  projectId: string
  productId: string
}

export interface WhopGetProductResult {
  success: boolean
  product?: WhopProduct
  error?: string
}

export async function whopGetProduct(
  params: WhopGetProductParams,
  context: AccountContext
): Promise<WhopGetProductResult> {
  const result = await getHelper(context, params.projectId)
  if ('error' in result) return { success: false, error: result.error }

  try {
    const product = await result.helper.getProduct(params.productId)
    return { success: true, product }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to get product' }
  }
}

// ============ Create Product ============

export interface WhopCreateProductParams {
  projectId: string
  title: string
  headline?: string
  description?: string
  visibility?: string
}

export interface WhopCreateProductResult {
  success: boolean
  product?: WhopProduct
  error?: string
}

export async function whopCreateProduct(
  params: WhopCreateProductParams,
  context: AccountContext
): Promise<WhopCreateProductResult> {
  const { projectId, ...productData } = params
  const result = await getHelper(context, projectId)
  if ('error' in result) return { success: false, error: result.error }

  try {
    const product = await result.helper.createProduct(productData as any)
    return { success: true, product }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to create product' }
  }
}

// ============ Create Checkout ============

export interface WhopCreateCheckoutParams {
  projectId: string
  planId: string
  redirectUrl?: string
  metadata?: Record<string, unknown>
}

export interface WhopCreateCheckoutResult {
  success: boolean
  checkout?: WhopCheckoutConfiguration
  purchaseUrl?: string
  error?: string
}

export async function whopCreateCheckout(
  params: WhopCreateCheckoutParams,
  context: AccountContext
): Promise<WhopCreateCheckoutResult> {
  const { projectId, planId, redirectUrl, metadata } = params
  const result = await getHelper(context, projectId)
  if ('error' in result) return { success: false, error: result.error }

  try {
    const checkout = await result.helper.createCheckout({
      plan_id: planId,
      redirect_url: redirectUrl,
      metadata,
    })
    return { success: true, checkout, purchaseUrl: checkout.purchase_url }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to create checkout' }
  }
}

// ============ Get Checkout ============

export interface WhopGetCheckoutParams {
  projectId: string
  checkoutId: string
}

export interface WhopGetCheckoutResult {
  success: boolean
  checkout?: WhopCheckoutConfiguration
  error?: string
}

export async function whopGetCheckout(
  params: WhopGetCheckoutParams,
  context: AccountContext
): Promise<WhopGetCheckoutResult> {
  const result = await getHelper(context, params.projectId)
  if ('error' in result) return { success: false, error: result.error }

  try {
    const checkout = await result.helper.getCheckout(params.checkoutId)
    return { success: true, checkout }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to get checkout' }
  }
}

// ============ List Memberships ============

export interface WhopListMembershipsParams {
  projectId: string
  after?: string
  productId?: string
  status?: WhopMembershipStatus
}

export interface WhopListMembershipsResult {
  success: boolean
  memberships?: WhopMembership[]
  hasNextPage?: boolean
  error?: string
}

export async function whopListMemberships(
  params: WhopListMembershipsParams,
  context: AccountContext
): Promise<WhopListMembershipsResult> {
  const { projectId, after, productId, status } = params
  const result = await getHelper(context, projectId)
  if ('error' in result) return { success: false, error: result.error }

  try {
    const response = await result.helper.listMemberships({
      after,
      product_id: productId,
      status,
    })
    return {
      success: true,
      memberships: response.data,
      hasNextPage: response.page_info.has_next_page,
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to list memberships' }
  }
}

// ============ Get Membership ============

export interface WhopGetMembershipParams {
  projectId: string
  membershipId: string
}

export interface WhopGetMembershipResult {
  success: boolean
  membership?: WhopMembership
  error?: string
}

export async function whopGetMembership(
  params: WhopGetMembershipParams,
  context: AccountContext
): Promise<WhopGetMembershipResult> {
  const result = await getHelper(context, params.projectId)
  if ('error' in result) return { success: false, error: result.error }

  try {
    const membership = await result.helper.getMembership(params.membershipId)
    return { success: true, membership }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to get membership' }
  }
}
