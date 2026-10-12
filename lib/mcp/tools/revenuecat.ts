/**
 * RevenueCat MCP Tools
 * Provides MCP tools for managing RevenueCat products, offerings, entitlements, and packages
 */

import { adminDb } from '@/lib/firebase/admin'
import { AccountContext, getProjectContext, hasContextPermission } from '@/lib/org/context'
import {
  getRevenueCatHelper,
  mapProductType,
  type RevenueCatProduct,
  type RevenueCatOffering,
  type RevenueCatPackage,
  type RevenueCatEntitlement,
  type RevenueCatApp,
  type RevenueCatAppType,
  type RevenueCatProductType,
} from '@/lib/services/revenuecat'
import type { InAppPurchase, Subscription, SubscriptionGroup } from '@/lib/firebase/firestore'

// ============ List Apps ============

export interface ListRevenueCatAppsParams {
  projectId: string
}

export interface ListRevenueCatAppsResult {
  success: boolean
  apps?: RevenueCatApp[]
  error?: string
}

export async function listRevenueCatApps(
  params: ListRevenueCatAppsParams,
  context: AccountContext
): Promise<ListRevenueCatAppsResult> {
  const { projectId } = params

  const projectContext = await getProjectContext(context.userId, projectId)
  if (!projectContext) {
    return { success: false, error: 'Project not found' }
  }

  try {
    const helper = await getRevenueCatHelper(context.userId, projectId, projectContext.orgId)
    if (!helper) {
      return { success: false, error: 'RevenueCat not configured for this project. Add RevenueCat credentials in project settings.' }
    }

    const apps = await helper.listApps()
    return { success: true, apps }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to list RevenueCat apps' }
  }
}

// ============ Get API Keys ============

export interface GetRevenueCatApiKeysParams {
  projectId: string
}

export interface RevenueCatAppApiKey {
  appId: string
  appName: string
  appType: string
  bundleId?: string
  packageName?: string
  publicApiKeys: { id: string; key: string }[]
}

export interface GetRevenueCatApiKeysResult {
  success: boolean
  apps?: RevenueCatAppApiKey[]
  error?: string
}

export async function getRevenueCatApiKeys(
  params: GetRevenueCatApiKeysParams,
  context: AccountContext
): Promise<GetRevenueCatApiKeysResult> {
  const { projectId } = params

  const projectContext = await getProjectContext(context.userId, projectId)
  if (!projectContext) {
    return { success: false, error: 'Project not found' }
  }

  try {
    const helper = await getRevenueCatHelper(context.userId, projectId, projectContext.orgId)
    if (!helper) {
      return { success: false, error: 'RevenueCat not configured for this project. Add RevenueCat credentials in project settings.' }
    }

    const apps = await helper.listApps()
    const results: RevenueCatAppApiKey[] = []

    for (const app of apps) {
      const publicKeys = await helper.getAppPublicApiKeys(app.id)
      results.push({
        appId: app.id,
        appName: app.name,
        appType: app.type,
        bundleId: app.bundle_id,
        packageName: app.package_name,
        publicApiKeys: publicKeys.map(k => ({ id: k.id, key: k.key })),
      })
    }

    return { success: true, apps: results }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to get RevenueCat API keys' }
  }
}

// ============ Create App ============

export interface CreateRevenueCatAppParams {
  projectId: string
  name: string
  type: RevenueCatAppType
  // For iOS App Store
  bundleId?: string
  sharedSecret?: string
  // For Play Store / Amazon
  packageName?: string
}

export interface CreateRevenueCatAppResult {
  success: boolean
  app?: RevenueCatApp
  publicApiKeys?: { id: string; key: string }[]
  error?: string
}

/**
 * Create a new app in RevenueCat
 * Use type 'app_store' for iOS apps (requires bundleId)
 * Use type 'play_store' for Android apps (requires packageName)
 */
export async function createRevenueCatApp(
  params: CreateRevenueCatAppParams,
  context: AccountContext
): Promise<CreateRevenueCatAppResult> {
  const { projectId, name, type, bundleId, sharedSecret, packageName } = params

  const projectContext = await getProjectContext(context.userId, projectId)
  if (!projectContext) {
    return { success: false, error: 'Project not found' }
  }

  if (!hasContextPermission(projectContext, 'canCreateProjects')) {
    return { success: false, error: 'Permission denied' }
  }

  // Validate required fields based on type
  if (type === 'app_store' && !bundleId) {
    return { success: false, error: 'bundleId is required for App Store apps' }
  }
  if ((type === 'play_store' || type === 'amazon') && !packageName) {
    return { success: false, error: 'packageName is required for Play Store/Amazon apps' }
  }

  try {
    const helper = await getRevenueCatHelper(context.userId, projectId, projectContext.orgId)
    if (!helper) {
      return { success: false, error: 'RevenueCat not configured for this project. Add RevenueCat credentials in project settings.' }
    }

    // Build params using nested structure expected by RevenueCat API v2
    const createParams: Parameters<typeof helper.createApp>[0] = {
      name,
      type,
    }

    if (type === 'app_store' && bundleId) {
      createParams.app_store = {
        bundle_id: bundleId,
        shared_secret: sharedSecret,
      }
    } else if (type === 'play_store' && packageName) {
      createParams.play_store = {
        package_name: packageName,
      }
    } else if (type === 'amazon' && packageName) {
      createParams.amazon = {
        package_name: packageName,
        shared_secret: sharedSecret,
      }
    }

    const app = await helper.createApp(createParams)

    // Fetch the public API keys for the newly created app
    let publicApiKeys: { id: string; key: string }[] = []
    try {
      const keys = await helper.getAppPublicApiKeys(app.id)
      publicApiKeys = keys.map(k => ({ id: k.id, key: k.key }))
    } catch {
      // Non-fatal — app was created, keys may take a moment to generate
    }

    return { success: true, app, publicApiKeys }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to create RevenueCat app' }
  }
}

// ============ Delete App ============

export interface DeleteRevenueCatAppParams {
  projectId: string
  appId: string
}

export interface DeleteRevenueCatAppResult {
  success: boolean
  error?: string
}

export async function deleteRevenueCatApp(
  params: DeleteRevenueCatAppParams,
  context: AccountContext
): Promise<DeleteRevenueCatAppResult> {
  const { projectId, appId } = params

  const projectContext = await getProjectContext(context.userId, projectId)
  if (!projectContext) {
    return { success: false, error: 'Project not found' }
  }

  if (!hasContextPermission(projectContext, 'canDeleteProjects')) {
    return { success: false, error: 'Permission denied' }
  }

  try {
    const helper = await getRevenueCatHelper(context.userId, projectId, projectContext.orgId)
    if (!helper) {
      return { success: false, error: 'RevenueCat not configured for this project.' }
    }

    await helper.deleteApp(appId)
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to delete RevenueCat app' }
  }
}

// ============ Products ============

export interface ListRevenueCatProductsParams {
  projectId: string
  appId?: string
}

export interface ListRevenueCatProductsResult {
  success: boolean
  products?: RevenueCatProduct[]
  error?: string
}

export async function listRevenueCatProducts(
  params: ListRevenueCatProductsParams,
  context: AccountContext
): Promise<ListRevenueCatProductsResult> {
  const { projectId, appId } = params

  const projectContext = await getProjectContext(context.userId, projectId)
  if (!projectContext) {
    return { success: false, error: 'Project not found' }
  }

  try {
    const helper = await getRevenueCatHelper(context.userId, projectId, projectContext.orgId)
    if (!helper) {
      return { success: false, error: 'RevenueCat not configured for this project. Add RevenueCat credentials in project settings.' }
    }

    const products = await helper.listProducts(appId)
    return { success: true, products }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to list RevenueCat products' }
  }
}

export interface CreateRevenueCatProductParams {
  projectId: string
  storeIdentifier: string // App Store product ID (e.g., com.app.premium)
  appId: string // RevenueCat App ID
  type: RevenueCatProductType
  displayName?: string
}

export interface CreateRevenueCatProductResult {
  success: boolean
  product?: RevenueCatProduct
  error?: string
}

export async function createRevenueCatProduct(
  params: CreateRevenueCatProductParams,
  context: AccountContext
): Promise<CreateRevenueCatProductResult> {
  const { projectId, storeIdentifier, appId, type, displayName } = params

  const projectContext = await getProjectContext(context.userId, projectId)
  if (!projectContext) {
    return { success: false, error: 'Project not found' }
  }

  if (!hasContextPermission(projectContext, 'canCreateProjects')) {
    return { success: false, error: 'Permission denied' }
  }

  try {
    const helper = await getRevenueCatHelper(context.userId, projectId, projectContext.orgId)
    if (!helper) {
      return { success: false, error: 'RevenueCat not configured for this project. Add RevenueCat credentials in project settings.' }
    }

    const product = await helper.createProduct({
      store_identifier: storeIdentifier,
      app_id: appId,
      type,
      display_name: displayName,
    })
    return { success: true, product }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to create RevenueCat product' }
  }
}

export interface DeleteRevenueCatProductParams {
  projectId: string
  productId: string
}

export interface DeleteRevenueCatProductResult {
  success: boolean
  error?: string
}

export async function deleteRevenueCatProduct(
  params: DeleteRevenueCatProductParams,
  context: AccountContext
): Promise<DeleteRevenueCatProductResult> {
  const { projectId, productId } = params

  const projectContext = await getProjectContext(context.userId, projectId)
  if (!projectContext) {
    return { success: false, error: 'Project not found' }
  }

  if (!hasContextPermission(projectContext, 'canCreateProjects')) {
    return { success: false, error: 'Permission denied' }
  }

  try {
    const helper = await getRevenueCatHelper(context.userId, projectId, projectContext.orgId)
    if (!helper) {
      return { success: false, error: 'RevenueCat not configured for this project.' }
    }

    await helper.deleteProduct(productId)
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to delete RevenueCat product' }
  }
}

// ============ Offerings ============

export interface ListRevenueCatOfferingsParams {
  projectId: string
}

export interface ListRevenueCatOfferingsResult {
  success: boolean
  offerings?: RevenueCatOffering[]
  error?: string
}

export async function listRevenueCatOfferings(
  params: ListRevenueCatOfferingsParams,
  context: AccountContext
): Promise<ListRevenueCatOfferingsResult> {
  const { projectId } = params

  const projectContext = await getProjectContext(context.userId, projectId)
  if (!projectContext) {
    return { success: false, error: 'Project not found' }
  }

  try {
    const helper = await getRevenueCatHelper(context.userId, projectId, projectContext.orgId)
    if (!helper) {
      return { success: false, error: 'RevenueCat not configured for this project.' }
    }

    const offerings = await helper.listOfferings()
    return { success: true, offerings }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to list RevenueCat offerings' }
  }
}

export interface CreateRevenueCatOfferingParams {
  projectId: string
  lookupKey: string
  displayName: string
  metadata?: Record<string, string>
}

export interface CreateRevenueCatOfferingResult {
  success: boolean
  offering?: RevenueCatOffering
  error?: string
}

export async function createRevenueCatOffering(
  params: CreateRevenueCatOfferingParams,
  context: AccountContext
): Promise<CreateRevenueCatOfferingResult> {
  const { projectId, lookupKey, displayName, metadata } = params

  const projectContext = await getProjectContext(context.userId, projectId)
  if (!projectContext) {
    return { success: false, error: 'Project not found' }
  }

  if (!hasContextPermission(projectContext, 'canCreateProjects')) {
    return { success: false, error: 'Permission denied' }
  }

  try {
    const helper = await getRevenueCatHelper(context.userId, projectId, projectContext.orgId)
    if (!helper) {
      return { success: false, error: 'RevenueCat not configured for this project.' }
    }

    const offering = await helper.createOffering({
      lookup_key: lookupKey,
      display_name: displayName,
      metadata,
    })
    return { success: true, offering }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to create RevenueCat offering' }
  }
}

export interface DeleteRevenueCatOfferingParams {
  projectId: string
  offeringId: string
}

export interface DeleteRevenueCatOfferingResult {
  success: boolean
  error?: string
}

export async function deleteRevenueCatOffering(
  params: DeleteRevenueCatOfferingParams,
  context: AccountContext
): Promise<DeleteRevenueCatOfferingResult> {
  const { projectId, offeringId } = params

  const projectContext = await getProjectContext(context.userId, projectId)
  if (!projectContext) {
    return { success: false, error: 'Project not found' }
  }

  if (!hasContextPermission(projectContext, 'canCreateProjects')) {
    return { success: false, error: 'Permission denied' }
  }

  try {
    const helper = await getRevenueCatHelper(context.userId, projectId, projectContext.orgId)
    if (!helper) {
      return { success: false, error: 'RevenueCat not configured for this project.' }
    }

    await helper.deleteOffering(offeringId)
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to delete RevenueCat offering' }
  }
}

// ============ Get Offering ============

export interface GetRevenueCatOfferingParams {
  projectId: string
  offeringId: string
}

export interface GetRevenueCatOfferingResult {
  success: boolean
  offering?: RevenueCatOffering
  error?: string
}

export async function getRevenueCatOffering(
  params: GetRevenueCatOfferingParams,
  context: AccountContext
): Promise<GetRevenueCatOfferingResult> {
  const { projectId, offeringId } = params

  const projectContext = await getProjectContext(context.userId, projectId)
  if (!projectContext) {
    return { success: false, error: 'Project not found' }
  }

  try {
    const helper = await getRevenueCatHelper(context.userId, projectId, projectContext.orgId)
    if (!helper) {
      return { success: false, error: 'RevenueCat not configured for this project.' }
    }

    const offering = await helper.getOffering(offeringId)
    return { success: true, offering }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to get RevenueCat offering' }
  }
}

// ============ Update Offering ============

export interface UpdateRevenueCatOfferingParams {
  projectId: string
  offeringId: string
  displayName?: string
  isCurrent?: boolean
  metadata?: Record<string, string>
}

export interface UpdateRevenueCatOfferingResult {
  success: boolean
  offering?: RevenueCatOffering
  error?: string
}

export async function updateRevenueCatOffering(
  params: UpdateRevenueCatOfferingParams,
  context: AccountContext
): Promise<UpdateRevenueCatOfferingResult> {
  const { projectId, offeringId, displayName, isCurrent, metadata } = params

  const projectContext = await getProjectContext(context.userId, projectId)
  if (!projectContext) {
    return { success: false, error: 'Project not found' }
  }

  if (!hasContextPermission(projectContext, 'canCreateProjects')) {
    return { success: false, error: 'Permission denied' }
  }

  try {
    const helper = await getRevenueCatHelper(context.userId, projectId, projectContext.orgId)
    if (!helper) {
      return { success: false, error: 'RevenueCat not configured for this project.' }
    }

    const updateParams: Record<string, any> = {}
    if (displayName !== undefined) updateParams.display_name = displayName
    if (isCurrent !== undefined) updateParams.is_current = isCurrent
    if (metadata !== undefined) updateParams.metadata = metadata

    const offering = await helper.updateOffering(offeringId, updateParams)
    return { success: true, offering }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to update RevenueCat offering' }
  }
}

// ============ Entitlements ============

export interface ListRevenueCatEntitlementsParams {
  projectId: string
}

export interface ListRevenueCatEntitlementsResult {
  success: boolean
  entitlements?: RevenueCatEntitlement[]
  error?: string
}

export async function listRevenueCatEntitlements(
  params: ListRevenueCatEntitlementsParams,
  context: AccountContext
): Promise<ListRevenueCatEntitlementsResult> {
  const { projectId } = params

  const projectContext = await getProjectContext(context.userId, projectId)
  if (!projectContext) {
    return { success: false, error: 'Project not found' }
  }

  try {
    const helper = await getRevenueCatHelper(context.userId, projectId, projectContext.orgId)
    if (!helper) {
      return { success: false, error: 'RevenueCat not configured for this project.' }
    }

    const entitlements = await helper.listEntitlements()
    return { success: true, entitlements }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to list RevenueCat entitlements' }
  }
}

export interface CreateRevenueCatEntitlementParams {
  projectId: string
  lookupKey: string
  displayName: string
  productIds?: string[]
}

export interface CreateRevenueCatEntitlementResult {
  success: boolean
  entitlement?: RevenueCatEntitlement
  error?: string
}

export async function createRevenueCatEntitlement(
  params: CreateRevenueCatEntitlementParams,
  context: AccountContext
): Promise<CreateRevenueCatEntitlementResult> {
  const { projectId, lookupKey, displayName, productIds } = params

  const projectContext = await getProjectContext(context.userId, projectId)
  if (!projectContext) {
    return { success: false, error: 'Project not found' }
  }

  if (!hasContextPermission(projectContext, 'canCreateProjects')) {
    return { success: false, error: 'Permission denied' }
  }

  try {
    const helper = await getRevenueCatHelper(context.userId, projectId, projectContext.orgId)
    if (!helper) {
      return { success: false, error: 'RevenueCat not configured for this project.' }
    }

    // Create entitlement (API v2 doesn't support attaching products via public API)
    const entitlement = await helper.createEntitlement({
      lookup_key: lookupKey,
      display_name: displayName,
    })

    // Note: productIds parameter is ignored - RevenueCat's public REST API v2 does not support
    // attaching products to entitlements. This must be done via the RevenueCat Dashboard.
    if (productIds && productIds.length > 0) {
      console.warn('[RevenueCat] productIds provided but cannot attach - API v2 does not support this. Use RevenueCat Dashboard instead.')
    }

    return { success: true, entitlement }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to create RevenueCat entitlement' }
  }
}

export interface DeleteRevenueCatEntitlementParams {
  projectId: string
  entitlementId: string
}

export interface DeleteRevenueCatEntitlementResult {
  success: boolean
  error?: string
}

export async function deleteRevenueCatEntitlement(
  params: DeleteRevenueCatEntitlementParams,
  context: AccountContext
): Promise<DeleteRevenueCatEntitlementResult> {
  const { projectId, entitlementId } = params

  const projectContext = await getProjectContext(context.userId, projectId)
  if (!projectContext) {
    return { success: false, error: 'Project not found' }
  }

  if (!hasContextPermission(projectContext, 'canCreateProjects')) {
    return { success: false, error: 'Permission denied' }
  }

  try {
    const helper = await getRevenueCatHelper(context.userId, projectId, projectContext.orgId)
    if (!helper) {
      return { success: false, error: 'RevenueCat not configured for this project.' }
    }

    await helper.deleteEntitlement(entitlementId)
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to delete RevenueCat entitlement' }
  }
}

// ============ Packages ============

export interface CreateRevenueCatPackageParams {
  projectId: string
  offeringId: string
  lookupKey: string
  displayName: string
  productId: string
  position?: number
}

export interface CreateRevenueCatPackageResult {
  success: boolean
  package?: RevenueCatPackage
  error?: string
}

export async function createRevenueCatPackage(
  params: CreateRevenueCatPackageParams,
  context: AccountContext
): Promise<CreateRevenueCatPackageResult> {
  const { projectId, offeringId, lookupKey, displayName, productId, position } = params

  const projectContext = await getProjectContext(context.userId, projectId)
  if (!projectContext) {
    return { success: false, error: 'Project not found' }
  }

  if (!hasContextPermission(projectContext, 'canCreateProjects')) {
    return { success: false, error: 'Permission denied' }
  }

  try {
    const helper = await getRevenueCatHelper(context.userId, projectId, projectContext.orgId)
    if (!helper) {
      return { success: false, error: 'RevenueCat not configured for this project.' }
    }

    const pkg = await helper.createPackage({
      offering_id: offeringId,
      lookup_key: lookupKey,
      display_name: displayName,
      product_id: productId,
      position,
    })
    return { success: true, package: pkg }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to create RevenueCat package' }
  }
}

// ============ Update Package ============

export interface UpdateRevenueCatPackageParams {
  projectId: string
  offeringId: string
  packageId: string
  displayName?: string
  position?: number
}

export interface UpdateRevenueCatPackageResult {
  success: boolean
  package?: RevenueCatPackage
  error?: string
}

export async function updateRevenueCatPackage(
  params: UpdateRevenueCatPackageParams,
  context: AccountContext
): Promise<UpdateRevenueCatPackageResult> {
  const { projectId, offeringId, packageId, displayName, position } = params

  const projectContext = await getProjectContext(context.userId, projectId)
  if (!projectContext) {
    return { success: false, error: 'Project not found' }
  }

  if (!hasContextPermission(projectContext, 'canCreateProjects')) {
    return { success: false, error: 'Permission denied' }
  }

  try {
    const helper = await getRevenueCatHelper(context.userId, projectId, projectContext.orgId)
    if (!helper) {
      return { success: false, error: 'RevenueCat not configured for this project.' }
    }

    const updateParams: Record<string, any> = {}
    if (displayName !== undefined) updateParams.display_name = displayName
    if (position !== undefined) updateParams.position = position

    const pkg = await helper.updatePackage(offeringId, packageId, updateParams)
    return { success: true, package: pkg }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to update RevenueCat package' }
  }
}

// ============ Delete Package ============

export interface DeleteRevenueCatPackageParams {
  projectId: string
  offeringId: string
  packageId: string
}

export interface DeleteRevenueCatPackageResult {
  success: boolean
  error?: string
}

export async function deleteRevenueCatPackage(
  params: DeleteRevenueCatPackageParams,
  context: AccountContext
): Promise<DeleteRevenueCatPackageResult> {
  const { projectId, offeringId, packageId } = params

  const projectContext = await getProjectContext(context.userId, projectId)
  if (!projectContext) {
    return { success: false, error: 'Project not found' }
  }

  if (!hasContextPermission(projectContext, 'canCreateProjects')) {
    return { success: false, error: 'Permission denied' }
  }

  try {
    const helper = await getRevenueCatHelper(context.userId, projectId, projectContext.orgId)
    if (!helper) {
      return { success: false, error: 'RevenueCat not configured for this project.' }
    }

    await helper.deletePackage(offeringId, packageId)
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to delete RevenueCat package' }
  }
}

// ============ List Packages ============

export interface ListRevenueCatPackagesParams {
  projectId: string
  offeringId: string
}

export interface ListRevenueCatPackagesResult {
  success: boolean
  packages?: RevenueCatPackage[]
  error?: string
}

export async function listRevenueCatPackages(
  params: ListRevenueCatPackagesParams,
  context: AccountContext
): Promise<ListRevenueCatPackagesResult> {
  const { projectId, offeringId } = params

  const projectContext = await getProjectContext(context.userId, projectId)
  if (!projectContext) {
    return { success: false, error: 'Project not found' }
  }

  try {
    const helper = await getRevenueCatHelper(context.userId, projectId, projectContext.orgId)
    if (!helper) {
      return { success: false, error: 'RevenueCat not configured for this project.' }
    }

    const packages = await helper.listPackages(offeringId)
    return { success: true, packages }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to list RevenueCat packages' }
  }
}

// ============ Attach Product to Package ============

export interface AttachProductToPackageParams {
  projectId: string
  offeringId: string
  packageId: string
  productId: string
}

export interface AttachProductToPackageResult {
  success: boolean
  error?: string
}

export async function attachProductToPackage(
  params: AttachProductToPackageParams,
  context: AccountContext
): Promise<AttachProductToPackageResult> {
  const { projectId, offeringId, packageId, productId } = params

  const projectContext = await getProjectContext(context.userId, projectId)
  if (!projectContext) {
    return { success: false, error: 'Project not found' }
  }

  if (!hasContextPermission(projectContext, 'canCreateProjects')) {
    return { success: false, error: 'Permission denied' }
  }

  try {
    const helper = await getRevenueCatHelper(context.userId, projectId, projectContext.orgId)
    if (!helper) {
      return { success: false, error: 'RevenueCat not configured for this project.' }
    }

    await helper.attachProductToPackage(offeringId, packageId, productId)
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to attach product to package' }
  }
}

// ============ Detach Product from Package ============

export interface DetachProductFromPackageParams {
  projectId: string
  offeringId: string
  packageId: string
  productId: string
}

export interface DetachProductFromPackageResult {
  success: boolean
  error?: string
}

export async function detachProductFromPackage(
  params: DetachProductFromPackageParams,
  context: AccountContext
): Promise<DetachProductFromPackageResult> {
  const { projectId, offeringId, packageId, productId } = params

  const projectContext = await getProjectContext(context.userId, projectId)
  if (!projectContext) {
    return { success: false, error: 'Project not found' }
  }

  if (!hasContextPermission(projectContext, 'canCreateProjects')) {
    return { success: false, error: 'Permission denied' }
  }

  try {
    const helper = await getRevenueCatHelper(context.userId, projectId, projectContext.orgId)
    if (!helper) {
      return { success: false, error: 'RevenueCat not configured for this project.' }
    }

    await helper.detachProductFromPackage(offeringId, packageId, productId)
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to detach product from package' }
  }
}

// ============ Update Entitlement ============

export interface UpdateRevenueCatEntitlementParams {
  projectId: string
  entitlementId: string
  displayName?: string
}

export interface UpdateRevenueCatEntitlementResult {
  success: boolean
  entitlement?: RevenueCatEntitlement
  error?: string
}

export async function updateRevenueCatEntitlement(
  params: UpdateRevenueCatEntitlementParams,
  context: AccountContext
): Promise<UpdateRevenueCatEntitlementResult> {
  const { projectId, entitlementId, displayName } = params

  const projectContext = await getProjectContext(context.userId, projectId)
  if (!projectContext) {
    return { success: false, error: 'Project not found' }
  }

  if (!hasContextPermission(projectContext, 'canCreateProjects')) {
    return { success: false, error: 'Permission denied' }
  }

  try {
    const helper = await getRevenueCatHelper(context.userId, projectId, projectContext.orgId)
    if (!helper) {
      return { success: false, error: 'RevenueCat not configured for this project.' }
    }

    const updateParams: Record<string, any> = {}
    if (displayName !== undefined) updateParams.display_name = displayName

    const entitlement = await helper.updateEntitlement(entitlementId, updateParams)
    return { success: true, entitlement }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to update RevenueCat entitlement' }
  }
}

// Note: Attach/detach products to entitlements is NOT supported by RevenueCat's public REST API v2.
// This functionality is only available via the RevenueCat Dashboard or their internal API.

// ============ Cross-Platform Sync Tools ============

export interface SyncProductsToRevenueCatParams {
  projectId: string
  revenueCatAppId: string // Which RevenueCat app to sync to
  productIds?: string[] // Specific products to sync, or all if not specified
  createEntitlements?: boolean // Auto-create entitlements for each product
  entitlementPrefix?: string // Prefix for entitlement lookup keys (default: "")
}

export interface SyncProductsToRevenueCatResult {
  success: boolean
  summary?: {
    productsCreated: string[]
    productsSkipped: string[] // Already exist in RevenueCat
    entitlementsCreated: string[]
    errors: Array<{ productId: string; error: string }>
  }
  error?: string
}

export async function syncProductsToRevenueCat(
  params: SyncProductsToRevenueCatParams,
  context: AccountContext
): Promise<SyncProductsToRevenueCatResult> {
  const { projectId, revenueCatAppId, productIds, createEntitlements = false, entitlementPrefix = '' } = params

  const projectContext = await getProjectContext(context.userId, projectId)
  if (!projectContext) {
    return { success: false, error: 'Project not found' }
  }

  if (!hasContextPermission(projectContext, 'canCreateProjects')) {
    return { success: false, error: 'Permission denied' }
  }

  try {
    const helper = await getRevenueCatHelper(context.userId, projectId, projectContext.orgId)
    if (!helper) {
      return { success: false, error: 'RevenueCat not configured for this project. Add RevenueCat credentials in project settings.' }
    }

    const basePath = projectContext.type === 'organization' && projectContext.orgId
      ? adminDb.collection('organizations').doc(projectContext.orgId).collection('projects').doc(projectId)
      : adminDb.collection('users').doc(context.userId).collection('projects').doc(projectId)

    // Get existing RevenueCat products to avoid duplicates
    const existingRCProducts = await helper.listProducts(revenueCatAppId)
    const existingProductIds = new Set(existingRCProducts.map(p => p.store_identifier))

    const productsCreated: string[] = []
    const productsSkipped: string[] = []
    const entitlementsCreated: string[] = []
    const errors: Array<{ productId: string; error: string }> = []

    // Get IAPs
    const iapsSnapshot = await basePath.collection('inAppPurchases').get()
    for (const doc of iapsSnapshot.docs) {
      const iap = doc.data() as InAppPurchase

      // Skip if specific productIds provided and this isn't in the list
      if (productIds && !productIds.includes(iap.productId)) continue

      // Skip subscriptions (handled separately)
      if (iap.productType === 'AUTO_RENEWABLE_SUBSCRIPTION') continue

      if (existingProductIds.has(iap.productId)) {
        productsSkipped.push(iap.productId)
        continue
      }

      try {
        const rcProduct = await helper.createProduct({
          store_identifier: iap.productId,
          app_id: revenueCatAppId,
          type: mapProductType(iap.productType),
          display_name: iap.name,
        })
        productsCreated.push(iap.productId)

        // Create entitlement if requested
        if (createEntitlements && rcProduct) {
          const entitlementKey = `${entitlementPrefix}${iap.productId.replace(/\./g, '_')}`
          await helper.createEntitlement({
            lookup_key: entitlementKey,
            display_name: iap.name,
            product_ids: [rcProduct.id],
          })
          entitlementsCreated.push(entitlementKey)
        }
      } catch (error) {
        errors.push({
          productId: iap.productId,
          error: error instanceof Error ? error.message : 'Unknown error',
        })
      }
    }

    // Get Subscriptions
    const groupsSnapshot = await basePath.collection('subscriptionGroups').get()
    for (const groupDoc of groupsSnapshot.docs) {
      const subsSnapshot = await groupDoc.ref.collection('subscriptions').get()

      for (const subDoc of subsSnapshot.docs) {
        const sub = subDoc.data() as Subscription

        // Skip if specific productIds provided and this isn't in the list
        if (productIds && !productIds.includes(sub.productId)) continue

        if (existingProductIds.has(sub.productId)) {
          productsSkipped.push(sub.productId)
          continue
        }

        try {
          const rcProduct = await helper.createProduct({
            store_identifier: sub.productId,
            app_id: revenueCatAppId,
            type: 'subscription',
            display_name: sub.name,
          })
          productsCreated.push(sub.productId)

          // Create entitlement if requested
          if (createEntitlements && rcProduct) {
            const entitlementKey = `${entitlementPrefix}${sub.productId.replace(/\./g, '_')}`
            await helper.createEntitlement({
              lookup_key: entitlementKey,
              display_name: sub.name,
              product_ids: [rcProduct.id],
            })
            entitlementsCreated.push(entitlementKey)
          }
        } catch (error) {
          errors.push({
            productId: sub.productId,
            error: error instanceof Error ? error.message : 'Unknown error',
          })
        }
      }
    }

    return {
      success: errors.length === 0,
      summary: {
        productsCreated,
        productsSkipped,
        entitlementsCreated,
        errors,
      },
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to sync products to RevenueCat' }
  }
}

export interface CreateOfferingWithProductsParams {
  projectId: string
  // Support both schema names (offeringKey/offeringName) and legacy names (lookupKey/displayName)
  offeringKey?: string
  offeringName?: string
  lookupKey?: string // Legacy, use offeringKey
  displayName?: string // Legacy, use offeringName
  entitlementKey?: string
  entitlementName?: string
  products: Array<{
    productId: string // App Store product ID or RevenueCat product ID
    // Support both schema names (packageKey/packageName) and legacy names
    packageKey?: string // Package identifier (e.g., "$rc_monthly")
    packageName?: string
    packageLookupKey?: string // Legacy, use packageKey
    packageDisplayName?: string // Legacy, use packageName
    position?: number
  }>
  setAsCurrent?: boolean
}

export interface CreateOfferingWithProductsResult {
  success: boolean
  offering?: RevenueCatOffering
  packages?: RevenueCatPackage[]
  entitlement?: RevenueCatEntitlement
  error?: string
}

export async function createOfferingWithProducts(
  params: CreateOfferingWithProductsParams,
  context: AccountContext
): Promise<CreateOfferingWithProductsResult> {
  const { projectId, products, setAsCurrent = false, entitlementKey, entitlementName } = params
  // Support both naming conventions
  const offeringLookupKey = params.offeringKey || params.lookupKey
  const offeringDisplayName = params.offeringName || params.displayName

  if (!offeringLookupKey || !offeringDisplayName) {
    return { success: false, error: 'offeringKey and offeringName are required' }
  }

  const projectContext = await getProjectContext(context.userId, projectId)
  if (!projectContext) {
    return { success: false, error: 'Project not found' }
  }

  if (!hasContextPermission(projectContext, 'canCreateProjects')) {
    return { success: false, error: 'Permission denied' }
  }

  try {
    const helper = await getRevenueCatHelper(context.userId, projectId, projectContext.orgId)
    if (!helper) {
      return { success: false, error: 'RevenueCat not configured for this project.' }
    }

    // Create entitlement if specified
    let entitlement: RevenueCatEntitlement | undefined
    if (entitlementKey && entitlementName) {
      entitlement = await helper.createEntitlement({
        lookup_key: entitlementKey,
        display_name: entitlementName,
      })
    }

    // Create offering
    const offering = await helper.createOffering({
      lookup_key: offeringLookupKey,
      display_name: offeringDisplayName,
    })

    // Get RevenueCat products to find product IDs
    const rcProducts = await helper.listProducts()
    const productMap = new Map(rcProducts.map(p => [p.store_identifier, p.id]))
    // Also map by RevenueCat product ID directly
    const rcIdMap = new Map(rcProducts.map(p => [p.id, p.id]))

    // Create packages
    const createdPackages: RevenueCatPackage[] = []
    const productIdsForEntitlement: string[] = []

    for (let i = 0; i < products.length; i++) {
      const product = products[i]
      // Support both naming conventions
      const packageLookupKey = product.packageKey || product.packageLookupKey
      const packageDisplayName = product.packageName || product.packageDisplayName

      if (!packageLookupKey || !packageDisplayName) {
        return {
          success: false,
          error: `Product at index ${i} missing packageKey or packageName`,
        }
      }

      // Try to find product by store identifier first, then by RC product ID
      let rcProductId = productMap.get(product.productId) || rcIdMap.get(product.productId)

      if (!rcProductId) {
        return {
          success: false,
          error: `Product "${product.productId}" not found in RevenueCat. Sync your products first using sync_products_to_revenuecat.`,
        }
      }

      const pkg = await helper.createPackage({
        offering_id: offering.id,
        lookup_key: packageLookupKey,
        display_name: packageDisplayName,
        product_id: rcProductId,
        position: product.position ?? i,
      })
      createdPackages.push(pkg)
      productIdsForEntitlement.push(rcProductId)
    }

    // Note: Cannot attach products to entitlement via public API v2
    // Products must be attached to entitlements via RevenueCat Dashboard
    if (entitlement && productIdsForEntitlement.length > 0) {
      console.warn('[RevenueCat] Entitlement created but products cannot be auto-attached - API v2 does not support this. Use RevenueCat Dashboard to attach products to entitlement:', entitlement.id)
    }

    // Set as current offering if requested
    if (setAsCurrent) {
      await helper.updateOffering(offering.id, { is_current: true })
    }

    return {
      success: true,
      offering,
      packages: createdPackages,
      entitlement,
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to create offering with products' }
  }
}
