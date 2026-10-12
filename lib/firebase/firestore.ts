import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  Timestamp,
  DocumentReference,
  CollectionReference,
  QueryConstraint,
  Firestore
} from 'firebase/firestore'
import { db } from './client'
import {
  PLAN_LIMITS as BILLING_PLAN_LIMITS,
  type PlanLimits,
  type UserPlan,
} from '../billing/catalog'

/**
 * `past_due` keeps access while Stripe retries the renewal (grace while Stripe retries); `incomplete` (first
 * payment never completed, or Stripe marked the subscription unpaid) has no access but can be recovered.
 */
export type BillingStatus = 'free' | 'trialing' | 'active' | 'past_due' | 'incomplete' | 'cancelled'

/** Server-issued allowance only; never a subscription or permission grant. */
export interface ReviewGrant {
  source: 'review'
  id: string
  accountId: string
  startsAt: Timestamp
  expiresAt: Timestamp
  revokedAt?: Timestamp | null
  limits: { icons: number; screenshots: number; translations: number }
}

export interface BillingEntitlement {
  status: BillingStatus
  /** Only `stripe` (bound to the configured account and mode) grants paid access. */
  source: 'none' | 'stripe' | 'internal'
  plan: UserPlan
  subscriptionId?: string | null
  customerId?: string | null
  priceId?: string | null
  /** Stripe mode and account the record came from. Records from another mode/account never grant. */
  livemode?: boolean | null
  providerAccountId?: string | null
  billingInterval?: 'monthly' | 'annual'
  cancelAtPeriodEnd?: boolean
  catalogVersion?: string | null
  currentPeriodStart?: Timestamp | null
  currentPeriodEnd?: Timestamp | null
  trialEnd?: Timestamp | null
  providerEventAt?: Timestamp | null
  updatedAt: Timestamp
  reviewGrant?: ReviewGrant
}

/** Server-owned Stripe customer binding for an account, one per Stripe mode. */
export interface StripeCustomerBinding {
  id: string
  livemode: boolean
  accountId: string
}

/** Trial consumption per Stripe mode, so sandbox testing never uses up a live trial. */
export interface BillingTrialUsage {
  live?: { usedAt: Timestamp; subscriptionId: string } | null
  test?: { usedAt: Timestamp; subscriptionId: string } | null
}

// Helper to get db safely (throws if not initialized)
function getDb(): Firestore {
  if (!db) {
    throw new Error('Firestore not initialized. This operation requires a valid Firebase configuration.')
  }
  return db
}

// Type definitions for Firestore documents
export interface User {
  email: string
  plan: UserPlan
  planLimits: PlanLimits
  billing?: BillingEntitlement
  stripeCustomers?: { live?: StripeCustomerBinding | null; test?: StripeCustomerBinding | null }
  billingTrial?: BillingTrialUsage
  subscriptionStatus?: BillingStatus
  organizationId: string | null
  apiKey: string
  oauthRevokedBefore?: Timestamp | null
  createdAt: Timestamp
  updatedAt: Timestamp
}

// App Store version states - determines if metadata is editable
export type AppStoreVersionState =
  | 'PREPARE_FOR_SUBMISSION'      // Editable
  | 'METADATA_REJECTED'           // Editable
  | 'READY_FOR_SALE'              // Locked
  | 'WAITING_FOR_REVIEW'          // Locked
  | 'IN_REVIEW'                   // Locked
  | 'PENDING_DEVELOPER_RELEASE'   // Locked
  | 'DEVELOPER_REJECTED'          // Editable
  | 'REJECTED'                    // Locked

// Sync status for metadata
export type MetadataSyncStatus = 'synced' | 'local_changes' | 'conflict' | 'never_synced'

// Store type - determines if project is iOS, Android, or Web
export type StoreType = 'ios' | 'android' | 'web'

// Link sync mode - how linked projects sync data
export type LinkSyncMode = 'auto' | 'manual'

// Metadata fields that can be shared between linked projects
export type SharedMetadataField = 'name' | 'subtitle' | 'description' | 'keywords' | 'whatsNew' | 'promotionalText'

// Configuration for how linked projects share data
export interface LinkConfiguration {
  syncMode: LinkSyncMode
  shareMetadata: boolean
  shareScreenshots: boolean
  shareIcons: boolean
  sharedMetadataFields: SharedMetadataField[]
  lastSyncedAt: Timestamp | null
}

export interface Project {
  name: string

  // Store type - immutable after creation (iOS or Android, not both)
  storeType: StoreType

  // Only one populated based on storeType
  appStoreAppId: string | null      // Only for 'ios'
  playStorePackage: string | null   // Only for 'android'

  // Web store fields (only for 'web' storeType)
  whopApiKey: string | null
  whopCompanyId: string | null
  whopWebhookSecret: string | null

  // Project linking (optional one-to-one link to project of opposite store type)
  linkedProjectId: string | null
  linkConfiguration: LinkConfiguration | null
  linkOwner: boolean  // True if this project initiated the link

  // Legacy metadata (for backwards compatibility)
  metadata: {
    title: string
    subtitle: string
    description: string
    keywords: string
    whatsNew: string
  }

  // App Store version state tracking
  appStoreVersionState: AppStoreVersionState | null
  appStoreVersionId: string | null
  appStoreVersionNumber: string | null

  // App Store Connect vendor number (for Sales & Trends reports)
  vendorNumber?: string | null

  // Firebase integration (Crashlytics + Analytics + other Firebase services)
  firebaseAppId?: string | null                    // App ID for Crashlytics: 1:PROJECT_NUMBER:platform:HASH
  firebaseAnalyticsPropertyId?: string | null      // GA4 property ID for Analytics (numeric, e.g. "123456789")
  firebaseProjectId?: string | null                // Firebase project ID (e.g. "my-app-12345") for Firestore, Auth, Functions, Remote Config

  // Sync metadata
  lastPulledAt: Timestamp | null
  lastPushedAt: Timestamp | null
  syncStatus: MetadataSyncStatus

  // Locale configuration
  primaryLocale: string        // e.g., 'en-US'
  enabledLocales: string[]     // All locales to manage

  createdBy?: string
  createdAt: Timestamp
  updatedAt: Timestamp

  // Public slug for legal document URLs (auto-generated 8-char)
  publicSlug?: string
}

// Localized metadata for a single locale
export interface LocalizedMetadata {
  locale: string

  // App-level fields (App Store: appInfoLocalizations)
  name: string              // 30 chars
  subtitle: string          // 30 chars
  privacyUrl: string | null

  // Version-specific fields (App Store: appStoreVersionLocalizations)
  description: string       // 4000 chars
  keywords: string          // 100 chars
  whatsNew: string          // 4000 chars
  marketingUrl: string | null
  supportUrl: string | null
  promotionalText: string | null  // 170 chars

  // Play Store specific mappings
  shortDescription: string | null  // 80 chars (Play Store)
  fullDescription: string | null   // 4000 chars (Play Store)

  // Tracking
  lastModifiedAt: Timestamp
  lastModifiedBy: string
  sourceHash: string  // For conflict detection (hash of store data)

  // Sync tracking - hash of each primary locale field when this translation was created
  // Used to detect which specific fields have changed in primary and need re-translation
  primaryFieldHashes?: Record<string, string>  // { fieldName: hashOfPrimaryValueAtTranslationTime }
}

// Source of a metadata change
export type MetadataSource = 'pull' | 'manual_edit' | 'ai_translation' | 'rollback' | 'publish'

// Version history entry - snapshot of all locales at a point in time
export interface MetadataHistoryEntry {
  id: string
  locales: { [locale: string]: LocalizedMetadata }

  version: number           // Auto-incrementing
  label: string | null      // Optional label (e.g., "v2.1.0 Release")

  source: MetadataSource
  sourceDetails?: string    // Additional context (e.g., "Rolled back from version 5")

  changesSummary: {
    localesModified: string[]
    fieldsModified: string[]
    description: string     // Human-readable summary
  }

  createdAt: Timestamp
  createdBy: string
}

// Draft for unsaved changes (auto-save)
export interface MetadataDraft {
  locale: string
  data: Partial<LocalizedMetadata>
  savedAt: Timestamp
}

export interface Credentials {
  store: 'appstore' | 'playstore'
  encryptedData: string
  encryptedDek: string
  keyVersion: string
  addedBy: string
  createdAt: Timestamp
  updatedAt: Timestamp
}

export interface Translation {
  locale: string
  field: string
  sourceHash: string
  translatedText: string
  createdAt: Timestamp
}

export interface Usage {
  translationsUsed: number
  screenshotsUsed: number
  iconsUsed: number
  uploadsUsed: number
  appsUsed: number
  // Overage tracking
  translationsOverage?: number
  screenshotsOverage?: number
  iconsOverage?: number
  estimatedOverageCost?: number
  // Timestamps
  updatedAt: Timestamp
}

export interface Organization {
  name: string
  ownerId: string
  plan: UserPlan
  planLimits: PlanLimits
  billing?: BillingEntitlement
  stripeCustomers?: { live?: StripeCustomerBinding | null; test?: StripeCustomerBinding | null }
  billingTrial?: BillingTrialUsage
  apiKey: string
  createdAt: Timestamp
  updatedAt: Timestamp
  settings: {
    ssoEnabled: boolean
    allowedDomains: string[]
    auditLogRetentionDays: number
    requireMfa: boolean
  }
}

export interface OrgMember {
  role: 'owner' | 'admin' | 'member' | 'viewer'
  email: string
  displayName: string
  invitedBy: string
  joinedAt: Timestamp
  permissions: {
    canCreateProjects: boolean
    canDeleteProjects: boolean
    canManageCredentials: boolean
    canInviteMembers: boolean
    canViewAuditLog: boolean
  }
}

export interface OrgInvite {
  email: string
  role: 'admin' | 'member' | 'viewer'
  invitedBy: string
  invitedByName: string
  expiresAt: Timestamp
  status: 'pending' | 'accepted' | 'expired' | 'revoked'
}

export interface AuditLogEntry {
  action: string
  userId: string
  userEmail: string
  resourceType: 'project' | 'member' | 'credentials' | 'settings'
  resourceId: string
  metadata: Record<string, unknown>
  ipAddress: string
  timestamp: Timestamp
}

// Legal document types
export type LegalDocumentType = 'privacy_policy' | 'terms_of_service'

export interface LegalDocument {
  type: LegalDocumentType
  content: string  // Markdown content
  lastModifiedAt: Timestamp
  lastModifiedBy: string
  isPublished: boolean
}

// Generated icon stored in project
export interface GeneratedIcon {
  id: string
  style: string | null
  prompt: string | null
  originalUrl: string
  ios: string
  android: string
  createdAt: Timestamp
  createdBy: string
}

// API Key for CI/CD integration
export interface ApiKey {
  id: string
  name: string                    // User-friendly name (e.g., "GitHub Actions")
  keyHash: string                 // SHA-256 hash of the key (we don't store plaintext)
  keyPrefix: string               // First 8 chars for identification (e.g., "asc_abc1...")
  scopes: ApiKeyScope[]           // What the key can do
  lastUsedAt: Timestamp | null
  lastUsedIp: string | null
  expiresAt: Timestamp | null     // Optional expiration
  createdAt: Timestamp
  createdBy: string
  revokedAt: Timestamp | null
}

export type ApiKeyScope =
  | 'translate'      // Can use translation API
  | 'screenshots'    // Can generate screenshots
  | 'publish'        // Can publish to stores
  | 'read'           // Can read project data
  | 'write'          // Can modify project data
  | 'all'            // Full access

// Collection references
export const usersCollection = () => collection(getDb(), 'users')
export const userDoc = (userId: string) => doc(getDb(), 'users', userId)
export const userProjectsCollection = (userId: string) =>
  collection(getDb(), 'users', userId, 'projects')
export const userProjectDoc = (userId: string, projectId: string) =>
  doc(getDb(), 'users', userId, 'projects', projectId)
export const userUsageDoc = (userId: string, month: string) =>
  doc(getDb(), 'users', userId, 'usage', month)

export const orgsCollection = () => collection(getDb(), 'organizations')
export const orgDoc = (orgId: string) => doc(getDb(), 'organizations', orgId)
export const orgMembersCollection = (orgId: string) =>
  collection(getDb(), 'organizations', orgId, 'members')
export const orgMemberDoc = (orgId: string, userId: string) =>
  doc(getDb(), 'organizations', orgId, 'members', userId)
export const orgProjectsCollection = (orgId: string) =>
  collection(getDb(), 'organizations', orgId, 'projects')
export const orgProjectDoc = (orgId: string, projectId: string) =>
  doc(getDb(), 'organizations', orgId, 'projects', projectId)
export const orgInvitesCollection = (orgId: string) =>
  collection(getDb(), 'organizations', orgId, 'invites')
export const orgAuditLogCollection = (orgId: string) =>
  collection(getDb(), 'organizations', orgId, 'auditLog')
export const orgUsageDoc = (orgId: string, month: string) =>
  doc(getDb(), 'organizations', orgId, 'usage', month)

// API Keys subcollections
export const userApiKeysCollection = (userId: string) =>
  collection(getDb(), 'users', userId, 'apiKeys')
export const userApiKeyDoc = (userId: string, keyId: string) =>
  doc(getDb(), 'users', userId, 'apiKeys', keyId)
export const orgApiKeysCollection = (orgId: string) =>
  collection(getDb(), 'organizations', orgId, 'apiKeys')
export const orgApiKeyDoc = (orgId: string, keyId: string) =>
  doc(getDb(), 'organizations', orgId, 'apiKeys', keyId)

// Metadata subcollections (for user projects)
export const userProjectMetadataCollection = (userId: string, projectId: string) =>
  collection(getDb(), 'users', userId, 'projects', projectId, 'metadata')
export const userProjectMetadataDoc = (userId: string, projectId: string, locale: string) =>
  doc(getDb(), 'users', userId, 'projects', projectId, 'metadata', locale)
export const userProjectHistoryCollection = (userId: string, projectId: string) =>
  collection(getDb(), 'users', userId, 'projects', projectId, 'metadataHistory')
export const userProjectHistoryDoc = (userId: string, projectId: string, historyId: string) =>
  doc(getDb(), 'users', userId, 'projects', projectId, 'metadataHistory', historyId)
export const userProjectDraftsCollection = (userId: string, projectId: string) =>
  collection(getDb(), 'users', userId, 'projects', projectId, 'drafts')
export const userProjectDraftDoc = (userId: string, projectId: string, locale: string) =>
  doc(getDb(), 'users', userId, 'projects', projectId, 'drafts', locale)

// Metadata subcollections (for org projects)
export const orgProjectMetadataCollection = (orgId: string, projectId: string) =>
  collection(getDb(), 'organizations', orgId, 'projects', projectId, 'metadata')
export const orgProjectMetadataDoc = (orgId: string, projectId: string, locale: string) =>
  doc(getDb(), 'organizations', orgId, 'projects', projectId, 'metadata', locale)
export const orgProjectHistoryCollection = (orgId: string, projectId: string) =>
  collection(getDb(), 'organizations', orgId, 'projects', projectId, 'metadataHistory')
export const orgProjectHistoryDoc = (orgId: string, projectId: string, historyId: string) =>
  doc(getDb(), 'organizations', orgId, 'projects', projectId, 'metadataHistory', historyId)
export const orgProjectDraftsCollection = (orgId: string, projectId: string) =>
  collection(getDb(), 'organizations', orgId, 'projects', projectId, 'drafts')
export const orgProjectDraftDoc = (orgId: string, projectId: string, locale: string) =>
  doc(getDb(), 'organizations', orgId, 'projects', projectId, 'drafts', locale)

// Screenshot subcollections (for user projects)
export const userProjectScreenshotsCollection = (userId: string, projectId: string) =>
  collection(getDb(), 'users', userId, 'projects', projectId, 'screenshots')
export const userProjectScreenshotDoc = (userId: string, projectId: string, displayType: string) =>
  doc(getDb(), 'users', userId, 'projects', projectId, 'screenshots', displayType)
export const userProjectScreenshotHistoryCollection = (userId: string, projectId: string) =>
  collection(getDb(), 'users', userId, 'projects', projectId, 'screenshotHistory')
export const userProjectLocalizedScreenshotsCollection = (userId: string, projectId: string) =>
  collection(getDb(), 'users', userId, 'projects', projectId, 'localizedScreenshots')

// Screenshot subcollections (for org projects)
export const orgProjectScreenshotsCollection = (orgId: string, projectId: string) =>
  collection(getDb(), 'organizations', orgId, 'projects', projectId, 'screenshots')
export const orgProjectScreenshotDoc = (orgId: string, projectId: string, displayType: string) =>
  doc(getDb(), 'organizations', orgId, 'projects', projectId, 'screenshots', displayType)
export const orgProjectScreenshotHistoryCollection = (orgId: string, projectId: string) =>
  collection(getDb(), 'organizations', orgId, 'projects', projectId, 'screenshotHistory')
export const orgProjectLocalizedScreenshotsCollection = (orgId: string, projectId: string) =>
  collection(getDb(), 'organizations', orgId, 'projects', projectId, 'localizedScreenshots')

// Icon subcollections (for user projects)
export const userProjectIconsCollection = (userId: string, projectId: string) =>
  collection(getDb(), 'users', userId, 'projects', projectId, 'icons')
export const userProjectIconDoc = (userId: string, projectId: string, iconId: string) =>
  doc(getDb(), 'users', userId, 'projects', projectId, 'icons', iconId)

// Icon subcollections (for org projects)
export const orgProjectIconsCollection = (orgId: string, projectId: string) =>
  collection(getDb(), 'organizations', orgId, 'projects', projectId, 'icons')
export const orgProjectIconDoc = (orgId: string, projectId: string, iconId: string) =>
  doc(getDb(), 'organizations', orgId, 'projects', projectId, 'icons', iconId)

// Legal document subcollections (for user projects)
export const userProjectLegalCollection = (userId: string, projectId: string) =>
  collection(getDb(), 'users', userId, 'projects', projectId, 'legal')
export const userProjectLegalDoc = (userId: string, projectId: string, docType: string) =>
  doc(getDb(), 'users', userId, 'projects', projectId, 'legal', docType)

// Legal document subcollections (for org projects)
export const orgProjectLegalCollection = (orgId: string, projectId: string) =>
  collection(getDb(), 'organizations', orgId, 'projects', projectId, 'legal')
export const orgProjectLegalDoc = (orgId: string, projectId: string, docType: string) =>
  doc(getDb(), 'organizations', orgId, 'projects', projectId, 'legal', docType)

// In-App Purchase subcollections (for user projects)
export const userProjectIAPCollection = (userId: string, projectId: string) =>
  collection(getDb(), 'users', userId, 'projects', projectId, 'inAppPurchases')
export const userProjectIAPDoc = (userId: string, projectId: string, iapId: string) =>
  doc(getDb(), 'users', userId, 'projects', projectId, 'inAppPurchases', iapId)
export const userProjectIAPLocalizationsCollection = (userId: string, projectId: string, iapId: string) =>
  collection(getDb(), 'users', userId, 'projects', projectId, 'inAppPurchases', iapId, 'localizations')
export const userProjectIAPLocalizationDoc = (userId: string, projectId: string, iapId: string, locale: string) =>
  doc(getDb(), 'users', userId, 'projects', projectId, 'inAppPurchases', iapId, 'localizations', locale)

// Subscription Groups subcollections (for user projects)
export const userProjectSubscriptionGroupsCollection = (userId: string, projectId: string) =>
  collection(getDb(), 'users', userId, 'projects', projectId, 'subscriptionGroups')
export const userProjectSubscriptionGroupDoc = (userId: string, projectId: string, groupId: string) =>
  doc(getDb(), 'users', userId, 'projects', projectId, 'subscriptionGroups', groupId)
export const userProjectSubscriptionsCollection = (userId: string, projectId: string, groupId: string) =>
  collection(getDb(), 'users', userId, 'projects', projectId, 'subscriptionGroups', groupId, 'subscriptions')
export const userProjectSubscriptionDoc = (userId: string, projectId: string, groupId: string, subId: string) =>
  doc(getDb(), 'users', userId, 'projects', projectId, 'subscriptionGroups', groupId, 'subscriptions', subId)

// IAP Translation Cache (for user projects)
export const userProjectIAPTranslationsCollection = (userId: string, projectId: string) =>
  collection(getDb(), 'users', userId, 'projects', projectId, 'iapTranslations')
export const userProjectIAPTranslationDoc = (userId: string, projectId: string, cacheKey: string) =>
  doc(getDb(), 'users', userId, 'projects', projectId, 'iapTranslations', cacheKey)

// In-App Purchase subcollections (for org projects)
export const orgProjectIAPCollection = (orgId: string, projectId: string) =>
  collection(getDb(), 'organizations', orgId, 'projects', projectId, 'inAppPurchases')
export const orgProjectIAPDoc = (orgId: string, projectId: string, iapId: string) =>
  doc(getDb(), 'organizations', orgId, 'projects', projectId, 'inAppPurchases', iapId)
export const orgProjectIAPLocalizationsCollection = (orgId: string, projectId: string, iapId: string) =>
  collection(getDb(), 'organizations', orgId, 'projects', projectId, 'inAppPurchases', iapId, 'localizations')
export const orgProjectIAPLocalizationDoc = (orgId: string, projectId: string, iapId: string, locale: string) =>
  doc(getDb(), 'organizations', orgId, 'projects', projectId, 'inAppPurchases', iapId, 'localizations', locale)

// Subscription Groups subcollections (for org projects)
export const orgProjectSubscriptionGroupsCollection = (orgId: string, projectId: string) =>
  collection(getDb(), 'organizations', orgId, 'projects', projectId, 'subscriptionGroups')
export const orgProjectSubscriptionGroupDoc = (orgId: string, projectId: string, groupId: string) =>
  doc(getDb(), 'organizations', orgId, 'projects', projectId, 'subscriptionGroups', groupId)
export const orgProjectSubscriptionsCollection = (orgId: string, projectId: string, groupId: string) =>
  collection(getDb(), 'organizations', orgId, 'projects', projectId, 'subscriptionGroups', groupId, 'subscriptions')
export const orgProjectSubscriptionDoc = (orgId: string, projectId: string, groupId: string, subId: string) =>
  doc(getDb(), 'organizations', orgId, 'projects', projectId, 'subscriptionGroups', groupId, 'subscriptions', subId)

// IAP Translation Cache (for org projects)
export const orgProjectIAPTranslationsCollection = (orgId: string, projectId: string) =>
  collection(getDb(), 'organizations', orgId, 'projects', projectId, 'iapTranslations')
export const orgProjectIAPTranslationDoc = (orgId: string, projectId: string, cacheKey: string) =>
  doc(getDb(), 'organizations', orgId, 'projects', projectId, 'iapTranslations', cacheKey)

// Helper functions
export function getCurrentMonth(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

// Check if an App Store version state allows editing
export function isAppStoreVersionEditable(state: AppStoreVersionState | null): boolean {
  if (!state) return false
  const editableStates: AppStoreVersionState[] = [
    'PREPARE_FOR_SUBMISSION',
    'METADATA_REJECTED',
    'DEVELOPER_REJECTED',
  ]
  return editableStates.includes(state)
}

// Generate a hash for conflict detection
export function generateSourceHash(data: Record<string, unknown>): string {
  const str = JSON.stringify(data, Object.keys(data).sort())
  // Simple hash function (for conflict detection, not security)
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash // Convert to 32bit integer
  }
  return Math.abs(hash).toString(36)
}

// ============================================
// SCREENSHOT TYPES
// ============================================

// App Store screenshot display types (device sizes)
// Updated per Apple's 2024/2025 requirements - see https://developer.apple.com/help/app-store-connect/reference/screenshot-specifications/
export type ScreenshotDisplayType =
  | 'APP_IPHONE_69'      // 6.9" iPhone (iPhone 16 Pro Max, 15 Pro Max) - REQUIRED
  | 'APP_IPHONE_65'      // 6.5" iPhone (iPhone 11 Pro Max, XS Max) - Required only if 6.9" not provided
  | 'APP_IPHONE_63'      // 6.3" iPhone (iPhone 16 Pro, 15 Pro) - Optional
  | 'APP_IPHONE_61'      // 6.1" iPhone (iPhone 14, 13, 12) - Optional
  | 'APP_IPHONE_55'      // 5.5" iPhone (iPhone 8 Plus) - Optional
  | 'APP_IPAD_PRO_13'    // 13" iPad Pro (M4/M5, iPad Air M3/M2) - REQUIRED
  | 'APP_IPAD_PRO_129'   // 12.9" iPad Pro (legacy) - Optional
  | 'APP_IPAD_PRO_11'    // 11" iPad Pro - Optional
  | 'APP_WATCH_ULTRA_3'  // Apple Watch Ultra 3 - Optional
  | 'APP_WATCH_ULTRA'    // Apple Watch Ultra 2 / Ultra - Optional
  | 'APP_WATCH_SERIES_10' // Apple Watch Series 11 / 10 - REQUIRED for watchOS apps
  | 'APP_WATCH_SERIES_7' // Apple Watch Series 9 / 8 / 7 - Fallback
  | 'APP_WATCH_SERIES_4' // Apple Watch Series 6 / 5 / 4 / SE - Fallback
  | 'APP_WATCH_SERIES_3' // Apple Watch Series 3 - Legacy
  | 'PLAY_PHONE'         // Android phone screenshots (Google Play)
  | 'PLAY_TABLET'        // Android tablet screenshots (Google Play)
  | 'PLAY_FEATURE_GRAPHIC' // Android feature graphic banner (1024×500, Google Play)

// Screenshot sync status
export type ScreenshotSyncStatus = 'synced' | 'local_changes' | 'conflict' | 'never_synced'

// Source of a screenshot change
export type ScreenshotSource = 'pull' | 'upload' | 'ai_generation' | 'ai_edit' | 'ai_translation' | 'rollback'

// Individual screenshot within a set
export interface Screenshot {
  id: string
  position: number  // Order in the set (0-9, max 10 screenshots)

  // Source image (original raw screenshot from user)
  rawImageUrl: string | null
  rawImageKey: string | null  // R2 key for the raw image

  // Generated/processed marketing screenshot
  marketingImageUrl: string
  marketingImageKey: string  // R2 key

  // Headline/text shown on the marketing screenshot
  headline: string

  // AI generation details
  generatedWith: 'gemini' | 'manual' | null
  styleSource: 'category' | 'reference' | null

  // Tracking
  createdAt: Timestamp
  updatedAt: Timestamp
}

// Localized screenshot - same visual but different text
export interface LocalizedScreenshot {
  locale: string
  screenshotId: string  // Reference to parent Screenshot.id
  displayType?: string  // Device type (e.g. APP_IPHONE_65)

  // Localized marketing image (with translated text)
  marketingImageUrl: string
  marketingImageKey: string

  // Translated headline
  headline: string

  // Source hash for translation cache
  sourceHash: string

  // Sync tracking - timestamp of primary screenshot when this translation was created
  primaryUpdatedAt?: Timestamp  // When the primary screenshot was last updated at translation time

  // Tracking
  lastModifiedAt: Timestamp
  lastModifiedBy: string
}

// Screenshot set for a specific device type
export interface ScreenshotSet {
  id: string
  displayType: ScreenshotDisplayType
  locale: string  // Primary locale for this set

  // Screenshots in this set (ordered)
  screenshots: Screenshot[]

  // Style configuration for AI generation
  styleConfig: {
    type: 'category' | 'reference'
    category?: string  // App category for style
    referenceImageUrl?: string  // User-uploaded style reference
    customColors?: { primary: string; secondary: string }
    deviceFrame?: 'iphone' | 'android' | 'generic' | 'none'  // Device frame style for generation
  } | null

  // Sync status
  syncStatus: ScreenshotSyncStatus
  lastPulledAt: Timestamp | null
  lastPushedAt: Timestamp | null

  // Tracking
  createdAt: Timestamp
  updatedAt: Timestamp
  createdBy: string
}

// History entry for screenshot versioning
export interface ScreenshotHistoryEntry {
  id: string
  version: number
  label: string | null

  // Snapshot of all screenshot sets at this version
  screenshotSets: { [displayType: string]: ScreenshotSet }

  // What changed
  source: ScreenshotSource
  sourceDetails?: string

  changesSummary: {
    displayTypesModified: string[]
    localesModified: string[]
    screenshotsAdded: number
    screenshotsRemoved: number
    description: string
  }

  createdAt: Timestamp
  createdBy: string
}

// Display type configuration (dimensions and names)
// Per Apple 2024/2025: Only 6.9" iPhone and 13" iPad are required. Others auto-scale.
// Screenshot requirement types:
// - 'required': Always required for this platform
// - 'fallback': Required only if the primary size isn't provided
// - 'optional': Never required, auto-scaled from larger sizes
export type ScreenshotRequirement = 'required' | 'fallback' | 'optional'

export const SCREENSHOT_DISPLAY_TYPES: Record<ScreenshotDisplayType, {
  name: string
  width: number
  height: number
  requirement: ScreenshotRequirement
  fallbackFor?: ScreenshotDisplayType // Which size this is a fallback for
  devices: string // Example devices for this size
}> = {
  'APP_IPHONE_69': { name: '6.9" iPhone', width: 1260, height: 2736, requirement: 'required', devices: 'iPhone 16 Pro Max, 15 Pro Max, 14 Pro Max' },
  'APP_IPHONE_65': { name: '6.5" iPhone', width: 1284, height: 2778, requirement: 'fallback', fallbackFor: 'APP_IPHONE_69', devices: 'iPhone 11 Pro Max, XS Max, XR' },
  'APP_IPHONE_63': { name: '6.3" iPhone', width: 1206, height: 2622, requirement: 'optional', devices: 'iPhone 16 Pro, 15 Pro, 14 Pro' },
  'APP_IPHONE_61': { name: '6.1" iPhone', width: 1170, height: 2532, requirement: 'optional', devices: 'iPhone 14, 13, 12, 11' },
  'APP_IPHONE_55': { name: '5.5" iPhone', width: 1242, height: 2208, requirement: 'optional', devices: 'iPhone 8 Plus, 7 Plus, 6s Plus' },
  'APP_IPAD_PRO_13': { name: '13" iPad', width: 2064, height: 2752, requirement: 'required', devices: 'iPad Pro M4/M5, iPad Air M3/M2' },
  'APP_IPAD_PRO_129': { name: '12.9" iPad Pro', width: 2048, height: 2732, requirement: 'fallback', fallbackFor: 'APP_IPAD_PRO_13', devices: 'iPad Pro 2nd gen (legacy)' },
  'APP_IPAD_PRO_11': { name: '11" iPad Pro', width: 1668, height: 2388, requirement: 'optional', devices: 'iPad Pro 11", iPad Air, iPad mini' },
  'APP_WATCH_ULTRA_3': { name: 'Apple Watch Ultra 3', width: 422, height: 514, requirement: 'optional', devices: 'Apple Watch Ultra 3' },
  'APP_WATCH_ULTRA': { name: 'Apple Watch Ultra', width: 410, height: 502, requirement: 'optional', devices: 'Apple Watch Ultra 2, Ultra' },
  'APP_WATCH_SERIES_10': { name: 'Apple Watch Series 10/11', width: 416, height: 496, requirement: 'required', devices: 'Apple Watch Series 11, Series 10' },
  'APP_WATCH_SERIES_7': { name: 'Apple Watch Series 7-9', width: 396, height: 484, requirement: 'fallback', fallbackFor: 'APP_WATCH_SERIES_10', devices: 'Apple Watch Series 9, Series 8, Series 7' },
  'APP_WATCH_SERIES_4': { name: 'Apple Watch Series 4-6 / SE', width: 368, height: 448, requirement: 'fallback', fallbackFor: 'APP_WATCH_SERIES_10', devices: 'Apple Watch Series 6, Series 5, Series 4, SE 3, SE' },
  'APP_WATCH_SERIES_3': { name: 'Apple Watch Series 3', width: 312, height: 390, requirement: 'optional', devices: 'Apple Watch Series 3' },
  'PLAY_PHONE': { name: 'Android Phone', width: 1080, height: 1920, requirement: 'required', devices: 'Pixel, Samsung Galaxy' },
  'PLAY_TABLET': { name: 'Android Tablet', width: 1920, height: 1200, requirement: 'optional', devices: 'Galaxy Tab, Pixel Tablet' },
  'PLAY_FEATURE_GRAPHIC': { name: 'Feature Graphic', width: 1024, height: 500, requirement: 'required', devices: 'Google Play Store banner (shown above screenshots)' },
}

// Create empty LocalizedMetadata for a locale
export function createEmptyLocalizedMetadata(locale: string, userId: string): LocalizedMetadata {
  return {
    locale,
    name: '',
    subtitle: '',
    privacyUrl: null,
    description: '',
    keywords: '',
    whatsNew: '',
    marketingUrl: null,
    supportUrl: null,
    promotionalText: null,
    shortDescription: null,
    fullDescription: null,
    lastModifiedAt: Timestamp.now(),
    lastModifiedBy: userId,
    sourceHash: '',
  }
}

export function generateApiKey(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let key = 'asc_' // App Listing Agent prefix
  for (let i = 0; i < 32; i++) {
    key += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return key
}

// Generate a public slug for legal document URLs (8 chars, URL-safe)
export function generatePublicSlug(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let slug = ''
  for (let i = 0; i < 8; i++) {
    slug += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return slug
}

// Re-export the shared catalog for legacy client imports.
export const PLAN_LIMITS = BILLING_PLAN_LIMITS

// Role permissions configuration
export const ROLE_PERMISSIONS = {
  owner: {
    canCreateProjects: true,
    canDeleteProjects: true,
    canManageCredentials: true,
    canInviteMembers: true,
    canViewAuditLog: true,
  },
  admin: {
    canCreateProjects: true,
    canDeleteProjects: true,
    canManageCredentials: true,
    canInviteMembers: true,
    canViewAuditLog: true,
  },
  member: {
    canCreateProjects: true,
    canDeleteProjects: false,
    canManageCredentials: false,
    canInviteMembers: false,
    canViewAuditLog: false,
  },
  viewer: {
    canCreateProjects: false,
    canDeleteProjects: false,
    canManageCredentials: false,
    canInviteMembers: false,
    canViewAuditLog: false,
  },
} as const

// ============================================
// IN-APP PURCHASE TYPES
// ============================================

// IAP product types (App Store Connect API v2)
export type IAPProductType =
  | 'CONSUMABLE'                    // One-time use (coins, gems)
  | 'NON_CONSUMABLE'                // Permanent unlock (features)
  | 'AUTO_RENEWABLE_SUBSCRIPTION'   // Recurring subscription
  | 'NON_RENEWING_SUBSCRIPTION'     // One-time subscription

// IAP state in App Store Connect (all 12 states from Apple's API)
export type IAPState =
  | 'MISSING_METADATA'            // Needs localized info or screenshot
  | 'WAITING_FOR_UPLOAD'          // Content hosting enabled but no content uploaded
  | 'PROCESSING_CONTENT'          // Uploaded content being processed
  | 'READY_TO_SUBMIT'             // Complete, can submit with app
  | 'WAITING_FOR_REVIEW'          // Submitted for review
  | 'IN_REVIEW'                   // Being reviewed by Apple
  | 'PENDING_BINARY_APPROVAL'     // IAP approved, waiting for app binary approval
  | 'DEVELOPER_ACTION_NEEDED'     // Changes rejected, needs editing
  | 'APPROVED'                    // Approved and live on App Store
  | 'REJECTED'                    // Rejected by Apple
  | 'DEVELOPER_REMOVED_FROM_SALE' // Removed by developer (purchasers retain access)
  | 'REMOVED_FROM_SALE'           // Removed by Apple

// Sync status for IAP data
export type IAPSyncStatus = 'synced' | 'local_changes' | 'pending_creation'

// Generic timestamp type that works with both admin and client SDKs
// This allows server-side code (using firebase-admin) to create objects
// that match these interfaces without type conflicts
type FirestoreTimestamp = Timestamp | { toDate: () => Date; seconds: number; nanoseconds: number }

// In-App Purchase product
export interface InAppPurchase {
  id: string                          // Firestore document ID
  appStoreId: string | null           // App Store Connect ID (null if not yet pushed)
  productId: string                   // Unique product identifier (e.g., com.app.coins100)
  productType: IAPProductType
  name: string                        // Internal reference name
  state: IAPState | null              // Current state in App Store
  syncStatus: IAPSyncStatus
  familyShareable: boolean            // Available to family members
  reviewNote: string | null           // Notes for App Review
  createdAt: FirestoreTimestamp
  updatedAt: FirestoreTimestamp
}

// Localized IAP content
export interface IAPLocalization {
  locale: string
  displayName: string                 // Customer-visible name (30 chars max)
  description: string                 // Brief description (45 chars max)
}

// Subscription group (for organizing auto-renewable subscriptions)
export interface SubscriptionGroup {
  id: string                          // Firestore document ID
  appStoreId: string | null           // App Store Connect ID
  referenceName: string               // Internal name
  syncStatus: IAPSyncStatus
  createdAt: FirestoreTimestamp
  updatedAt: FirestoreTimestamp
}

// Subscription periods supported by App Store
export type SubscriptionPeriod =
  | 'ONE_WEEK'
  | 'ONE_MONTH'
  | 'TWO_MONTHS'
  | 'THREE_MONTHS'
  | 'SIX_MONTHS'
  | 'ONE_YEAR'

// Auto-renewable subscription
export interface Subscription {
  id: string                          // Firestore document ID
  appStoreId: string | null           // App Store Connect ID
  productId: string                   // Unique product identifier
  name: string                        // Internal reference name
  groupId: string                     // Parent subscription group ID
  groupLevel: number                  // Service level (1-10, lower = higher tier)
  subscriptionPeriod: SubscriptionPeriod
  familyShareable: boolean
  state: IAPState | null
  syncStatus: IAPSyncStatus
  createdAt: FirestoreTimestamp
  updatedAt: FirestoreTimestamp
}

// Pricing tier for regional pricing strategies
export interface PricingTier {
  name: string                        // e.g., "Premium", "Standard", "Emerging"
  multiplier: number                  // Price multiplier (1.0, 0.7, 0.4)
  territories: string[]               // Territory codes (ISO 3166-1 alpha-3)
}

// Pricing strategy for regional pricing (Big Mac Index style)
export interface PricingStrategy {
  id: string
  name: string                        // e.g., "PPP Standard", "Aggressive Growth"
  description: string
  tiers: PricingTier[]
  isBuiltIn: boolean                  // True for preset strategies
  createdAt: FirestoreTimestamp
  updatedAt: FirestoreTimestamp
}

// Price strategy types
export type PriceStrategyType = 'equalized' | 'custom' | 'indexed'

// IAP price configuration
export interface IAPPriceConfig {
  baseTerritory: string               // e.g., 'USA'
  basePricePointId: string            // App Store price point ID
  strategy: PriceStrategyType
  pricingStrategyId?: string          // If using indexed pricing
  customPrices?: Record<string, string> // Territory -> pricePointId overrides
  lastSyncedAt: FirestoreTimestamp | null
}

// IAP translation cache (for AI translations)
export interface IAPTranslationCache {
  locale: string
  field: 'displayName' | 'description'
  sourceHash: string                  // Hash of source text for change detection
  translatedText: string
  createdAt: FirestoreTimestamp
}

// ============================================
// PROMOTIONAL OFFERS TYPES
// ============================================

// Offer mode types
export type OfferMode = 'PAY_AS_YOU_GO' | 'PAY_UP_FRONT' | 'FREE_TRIAL'

// Offer duration types
export type OfferDuration =
  | 'THREE_DAYS'
  | 'ONE_WEEK'
  | 'TWO_WEEKS'
  | 'ONE_MONTH'
  | 'TWO_MONTHS'
  | 'THREE_MONTHS'
  | 'SIX_MONTHS'
  | 'ONE_YEAR'

// Customer eligibility for promotional offers
export type CustomerEligibility = 'NEW' | 'EXISTING' | 'EXPIRED'

// Introductory offer (one per subscription for new subscribers)
export interface SubscriptionIntroductoryOffer {
  id: string
  appStoreId: string | null
  subscriptionId: string              // Parent subscription
  offerMode: OfferMode
  duration: OfferDuration
  numberOfPeriods: number             // 1-12 for PAY_AS_YOU_GO
  startDate: string | null            // ISO date string
  endDate: string | null              // ISO date string
  syncStatus: IAPSyncStatus
  createdAt: Timestamp
  updatedAt: Timestamp
}

// Promotional offer (multiple per subscription, with targeting)
export interface SubscriptionPromotionalOffer {
  id: string
  appStoreId: string | null
  subscriptionId: string              // Parent subscription
  name: string                        // Internal reference name
  offerCode: string                   // Customer-facing code identifier
  offerMode: OfferMode
  duration: OfferDuration
  numberOfPeriods: number
  startDate: string | null
  endDate: string | null
  customerEligibility: CustomerEligibility
  syncStatus: IAPSyncStatus
  createdAt: Timestamp
  updatedAt: Timestamp
}

// Offer code for promotional offers
export interface OfferCode {
  id: string
  appStoreId: string | null
  promotionalOfferId: string          // Parent promotional offer
  name: string                        // Campaign name
  numberOfCodes: 'UNLIMITED' | number // Total codes available
  totalNumberOfCodes: number          // Codes generated
  active: boolean
  customCode: string | null           // Custom code (one-time use offers)
  syncStatus: IAPSyncStatus
  createdAt: Timestamp
  updatedAt: Timestamp
}

// ============================================
// PLAY STORE IN-APP PURCHASE TYPES
// ============================================

// Play Store product states (much simpler than Apple's 12 states)
export type PlayStoreProductState = 'DRAFT' | 'ACTIVE' | 'INACTIVE'

// Play Store one-time product (consumable/non-consumable managed product)
// Firestore path: projects/{projectId}/playStoreProducts/{id}
export interface PlayStoreProduct {
  id: string                              // Firestore document ID
  sku: string                             // Unique product ID in Play Store
  productType: 'ONE_TIME'
  status: PlayStoreProductState | null    // null if not yet pushed
  syncStatus: IAPSyncStatus              // Reuse same pattern as iOS
  defaultLanguage: string                 // e.g., "en-US"
  defaultPriceUsd: number | null          // Base USD price (e.g., 9.99)
  createdAt: FirestoreTimestamp
  updatedAt: FirestoreTimestamp
}

// Localization for Play Store product
// Firestore path: .../playStoreProducts/{id}/localizations/{locale}
export interface PlayStoreProductLocalization {
  locale: string
  title: string                           // Max 55 chars
  description: string                     // Max 80 chars
}

// Play Store subscription with base plans inline
// Firestore path: projects/{projectId}/playStoreSubscriptions/{id}
export interface PlayStoreSubscription {
  id: string                              // Firestore document ID
  productId: string                       // Unique product ID
  syncStatus: IAPSyncStatus
  defaultLanguage: string
  basePlans: PlayStoreBasePlan[]          // Inline (subscriptions always have base plans)
  createdAt: FirestoreTimestamp
  updatedAt: FirestoreTimestamp
}

// Base plan within a subscription
export interface PlayStoreBasePlan {
  basePlanId: string                      // Unique within subscription (e.g., "monthly", "annual")
  state: PlayStoreProductState | null
  type: 'AUTO_RENEWING' | 'PREPAID'
  billingPeriodDuration?: string          // ISO 8601: P1W, P1M, P3M, P6M, P1Y
  gracePeriodDuration?: string            // ISO 8601: P0D, P3D, P7D, P14D, P30D
  defaultPriceUsd: number | null          // Base USD price
}

// Play Store subscription offer
// Firestore path: .../playStoreSubscriptions/{id}/offers/{offerId}
export interface PlayStoreOffer {
  id: string                              // Firestore document ID
  offerId: string                         // Unique within base plan
  basePlanId: string                      // Parent base plan
  state: PlayStoreProductState | null
  syncStatus: IAPSyncStatus
  phases: PlayStoreOfferPhase[]
  targeting?: {
    acquisitionRule?: { scope: string }   // NEW_CUSTOMER | EXISTING_CUSTOMER
  }
  createdAt: FirestoreTimestamp
  updatedAt: FirestoreTimestamp
}

// Offer phase (free trial, discounted period, etc.)
export interface PlayStoreOfferPhase {
  recurrenceCount: number                 // 0 = infinite
  duration: string                        // ISO 8601 period
  priceType: 'FREE' | 'DISCOUNTED'
  discountPercent?: number                // For relative discounts
}

// Play Store pricing config
// Firestore path: .../config/pricing (products) or .../config/basePlan_{basePlanId}_pricing (base plans)
export interface PlayStorePricingConfig {
  basePriceUsd: number                    // e.g., 9.99
  strategy: 'auto_convert' | 'manual'     // auto_convert uses convertRegionPrices
  manualPrices?: Record<string, { currencyCode: string; units: string; nanos: number }>
  updatedAt: FirestoreTimestamp
}

// ============================================
// CUSTOM PRODUCT PAGES (iOS) TYPES
// ============================================

// Custom Product Page states in App Store Connect
export type CPPState =
  | 'PREPARE_FOR_SUBMISSION'
  | 'WAITING_FOR_REVIEW'
  | 'IN_REVIEW'
  | 'APPROVED'
  | 'REJECTED'
  | 'READY_FOR_DISTRIBUTION'

// Custom Product Page (iOS)
// Firestore path: projects/{projectId}/customProductPages/{id}
export interface CustomProductPage {
  id: string                              // Firestore document ID
  appStoreId: string | null               // App Store Connect ID (null if not yet pushed)
  name: string                            // Reference name (max 64 chars)
  url: string | null                      // Read-only unique URL from App Store
  state: CPPState | null
  syncStatus: IAPSyncStatus
  createdAt: FirestoreTimestamp
  updatedAt: FirestoreTimestamp
}

// Custom Product Page Version
// Firestore path: .../customProductPages/{id}/versions/{vid}
export interface CustomProductPageVersion {
  id: string
  appStoreId: string | null
  state: CPPState | null
  deepLink: string | null                 // iOS 18+ deep link
  createdAt: FirestoreTimestamp
  updatedAt: FirestoreTimestamp
}

// Screenshot reference within a CPP localization
export interface CPPScreenshotReference {
  id: string
  position: number
  displayType: string                     // e.g., 'APP_IPHONE_69', 'APP_IPAD_PRO_13'
  imageUrl: string
  imageKey: string                        // R2 key
  fileName: string
  fileSize: number
  appStoreScreenshotId?: string | null
  appStoreScreenshotSetId?: string | null
  sourceFileChecksum?: string | null
  uploadedAt?: FirestoreTimestamp | null
  sourceScreenshotId?: string | null
  sourceLocale?: string | null
  sourceHash?: string | null
  primaryUpdatedAt?: FirestoreTimestamp | null
  translationProvider?: string | null
  translationModel?: string | null
  translationMode?: string | null
  instructionsHash?: string | null
}

// Localization for a Custom Product Page
// Firestore path: .../customProductPages/{id}/localizations/{locale}
export interface CPPLocalization {
  locale: string
  promotionalText: string | null          // Max 170 chars
  screenshots: CPPScreenshotReference[]
  appStoreLocalizationId: string | null   // ASC localization ID
}

// ============================================
// CUSTOM STORE LISTINGS (Android) TYPES
// ============================================

// Custom Store Listing targeting type
export type CSLTargetingType = 'COUNTRY' | 'PRE_REGISTRATION' | 'INSTALL_STATE'

// Custom Store Listing (Android)
// Firestore path: projects/{projectId}/customStoreListings/{id}
export interface CustomStoreListing {
  id: string                              // Firestore document ID
  playStoreId: string | null              // Play Store listing ID (null if not yet pushed)
  name: string                            // Internal name
  targetingType: CSLTargetingType
  targetingCountries: string[]            // Country codes (for COUNTRY targeting)
  syncStatus: IAPSyncStatus
  createdAt: FirestoreTimestamp
  updatedAt: FirestoreTimestamp
}

// Screenshot reference within a CSL localization
export interface CSLScreenshotReference {
  id: string
  position: number
  imageType: 'phone' | '7inch' | '10inch' // Phone/tablet screenshots
  imageUrl: string
  imageKey: string                        // R2 key
  fileName: string
  fileSize: number
}

// Localization for a Custom Store Listing
// Firestore path: .../customStoreListings/{id}/localizations/{locale}
export interface CSLLocalization {
  locale: string
  title: string                           // Max 30 chars
  shortDescription: string                // Max 80 chars
  fullDescription: string                 // Max 4000 chars
  iconUrl: string | null
  iconKey: string | null                  // R2 key
  featureGraphicUrl: string | null
  featureGraphicKey: string | null        // R2 key
  videoUrl: string | null
  screenshots: CSLScreenshotReference[]
}

// ============================================
// STORE EXPERIMENTS (A/B TESTING) TYPES
// ============================================

// Experiment state
export type StoreExperimentState = 'DRAFT' | 'RUNNING' | 'STOPPED' | 'COMPLETED'

// Experiment variant with metrics
export interface ExperimentVariant {
  name: string
  trafficPercentage: number
  impressions?: number
  installs?: number
  conversionRate?: number
}

// Store Experiment (iOS PPO / Android Store Listing Experiments)
// Firestore path: projects/{projectId}/customPageExperiments/{id}
export interface StoreExperiment {
  id: string
  storeId: string | null                  // ASC or Play Store experiment ID
  storeType: 'ios' | 'android'
  pageId: string                          // Custom page/listing ID
  name: string
  state: StoreExperimentState
  variants: ExperimentVariant[]
  results?: {
    winner?: string                       // Winning variant name
    statistical_significance?: number     // Confidence level
  }
  startedAt: FirestoreTimestamp | null
  stoppedAt: FirestoreTimestamp | null
  createdAt: FirestoreTimestamp
  updatedAt: FirestoreTimestamp
}

// ============================================
// CUSTOM PAGE ANALYTICS TYPES
// ============================================

// Country-level metrics
export interface AnalyticsCountryBreakdown {
  country: string
  impressions: number
  installs: number
}

// Analytics for a custom page/listing
// Firestore path: .../customProductPages/{id}/analytics/{period} or .../customStoreListings/{id}/analytics/{period}
export interface CustomPageAnalytics {
  period: string                          // e.g., '2026-02', '2026-W08'
  impressions: number
  installs: number
  conversionRate: number
  redownloads: number
  topCountries: AnalyticsCountryBreakdown[]
  pulledAt: FirestoreTimestamp
}
