import { onDocumentCreated } from "firebase-functions/v2/firestore"
import { getFirestore, Timestamp, FieldValue, DocumentReference, CollectionReference } from "firebase-admin/firestore"
import jwt from "jsonwebtoken"
import crypto from "crypto"
import { KeyManagementServiceClient } from "@google-cloud/kms"
import sharp from "sharp"
import { existingSetMatchesInOrder } from "./screenshotSetMatch"
import { assignAscSlots, slotAcceptsSize, sortByPosition } from "./ascScreenshotSlots"
import { AscAssetLibraryClient, AscLibraryError, firestoreAssetIndex, groupForLegacyDisplayType } from "./ascAssetLibrary"

// Get Firestore instance (app already initialized in index.ts)
const db = getFirestore()

// KMS client (lazy loaded)
let kmsClient: KeyManagementServiceClient | null = null
const getKmsClient = () => {
  if (!kmsClient) {
    kmsClient = new KeyManagementServiceClient()
  }
  return kmsClient
}

// KMS key configuration
const GCP_PROJECT_ID = process.env.GCP_PROJECT_ID || process.env.GCLOUD_PROJECT
const GCP_KMS_LOCATION = process.env.GCP_KMS_LOCATION || "global"
const GCP_KMS_KEYRING = process.env.GCP_KMS_KEYRING || "appstorecopilot"
const GCP_KMS_KEY = process.env.GCP_KMS_KEY || "credentials-key"

const getKmsKeyName = () => {
  return `projects/${GCP_PROJECT_ID}/locations/${GCP_KMS_LOCATION}/keyRings/${GCP_KMS_KEYRING}/cryptoKeys/${GCP_KMS_KEY}`
}

// Types
interface PushJob {
  id: string
  userId: string
  orgId?: string
  projectId: string
  appId: string // App Store app ID or Play Store package name
  platform?: "ios" | "android"
  status: "pending" | "processing" | "completed" | "failed" | "cancelled"
  statusMessage?: string // Human-readable status for UI display
  config: {
    displayTypes: string[]
    locales: string[]
  }
  progress: {
    // Screenshot-level progress (for smooth progress bar)
    currentScreenshots: number  // Total screenshots uploaded so far
    totalScreenshots: number    // Total screenshots across all tasks
    // Set-level progress (for context)
    currentSets: number         // Number of display/locale sets completed
    totalSets: number           // Total number of display/locale sets
    // Current task info
    currentDisplayType?: string
    currentLocale?: string
    currentStep?: "fetching" | "uploading" | "committing"
  }
  results: Array<{
    displayType: string
    locale: string
    success: boolean
    screenshotsUploaded?: number
    error?: string
    completedAt: Timestamp
  }>
  versionInfo?: {
    id: string
    versionString: string
    state: string
  }
  createdAt: Timestamp
  startedAt?: Timestamp
  completedAt?: Timestamp
  error?: string
  retryCount: number
  lastProcessedIndex?: number
  continuationOf?: string
  continuedBy?: string
  rootJobId?: string
  chainIndex?: number
  // Failed tasks to retry in continuation jobs
  failedTasksToRetry?: Array<{
    displayType: string
    locale: string
    screenshotIds: string[]
  }>
}

interface Screenshot {
  id: string
  marketingImageUrl: string
  headline?: string
  position: number
}

interface ScreenshotSet {
  displayType: string
  locale: string
  screenshots: Screenshot[]
}

interface UploadTask {
  displayType: string
  locale: string
  screenshots: Screenshot[]
  ascDisplayType: string
  index: number
}


// Which App Store slot each device type uploads to lives in ascScreenshotSlots.ts
// (assignAscSlots), shared with the dashboard routes.

// App Store screenshot dimensions by ASC DISPLAY TYPE (after mapping)
// These MUST match the exact pixel requirements for App Store Connect acceptance
// Reference: https://developer.apple.com/help/app-store-connect/reference/screenshot-specifications
const DISPLAY_TYPE_DIMENSIONS: Record<string, { width: number; height: number }> = {
  // iPhone dimensions (portrait)
  "APP_IPHONE_67": { width: 1290, height: 2796 },  // iPhone 14/15/16 Pro Max (6.7")
  "APP_IPHONE_65": { width: 1284, height: 2778 },  // iPhone 11 Pro Max, XS Max (6.5")
  "APP_IPHONE_61": { width: 1179, height: 2556 },  // iPhone 14/15 Pro (6.1")
  "APP_IPHONE_58": { width: 1170, height: 2532 },  // iPhone 12-14 (Face ID medium)
  "APP_IPHONE_55": { width: 1242, height: 2208 },  // iPhone 8 Plus (5.5")
  // iPad dimensions (portrait)
  "APP_IPAD_PRO_3GEN_129": { width: 2048, height: 2732 }, // iPad Pro 12.9"
  "APP_IPAD_PRO_3GEN_11": { width: 1668, height: 2388 },  // iPad Pro 11"
  // Apple Watch dimensions
  "APP_WATCH_ULTRA_3": { width: 422, height: 514 },      // Apple Watch Ultra 3
  "APP_WATCH_ULTRA": { width: 410, height: 502 },        // Apple Watch Ultra 2 / Ultra
  "APP_WATCH_SERIES_10": { width: 416, height: 496 },    // Apple Watch Series 11 / 10
  "APP_WATCH_SERIES_7": { width: 396, height: 484 },     // Apple Watch Series 9 / 8 / 7
  "APP_WATCH_SERIES_4": { width: 368, height: 448 },     // Apple Watch Series 6 / 5 / 4 / SE
  "APP_WATCH_SERIES_3": { width: 312, height: 390 },     // Apple Watch Series 3
  // Keep old internal names as fallback (mapped to correct dimensions)
  "APP_IPHONE_69": { width: 1290, height: 2796 },  // Maps to APP_IPHONE_67
  "APP_IPHONE_63": { width: 1179, height: 2556 },  // Maps to APP_IPHONE_61
  "APP_IPAD_PRO_13": { width: 2048, height: 2732 },
  "APP_IPAD_PRO_129": { width: 2048, height: 2732 },
  "APP_IPAD_PRO_11": { width: 1668, height: 2388 },
}

/**
 * Ensure image matches exact App Store dimensions and is JPEG format
 * Always outputs JPEG for consistent format - App Store accepts both PNG and JPEG
 */
async function ensureAppStoreDimensions(
  imageBuffer: Buffer,
  displayType: string
): Promise<Buffer> {
  const dimensions = DISPLAY_TYPE_DIMENSIONS[displayType]
  if (!dimensions) {
    // Unknown display type - still convert to JPEG for consistency
    console.log(`    ⚠ Unknown display type ${displayType}, converting to JPEG without resize`)
    return sharp(imageBuffer)
      .jpeg({ quality: 95, mozjpeg: true })
      .toBuffer()
  }

  try {
    // Check current dimensions and format
    const metadata = await sharp(imageBuffer).metadata()
    const currentWidth = metadata.width || 0
    const currentHeight = metadata.height || 0
    // Any size the slot accepts goes up as-is (e.g. our 6.9" 1260x2736); only
    // other sizes are scaled to the slot's default.
    const needsResize = !slotAcceptsSize(displayType, currentWidth, currentHeight) &&
      (currentWidth !== dimensions.width || currentHeight !== dimensions.height)

    if (needsResize) {
      console.log(`    ↳ Resizing from ${currentWidth}x${currentHeight} to ${dimensions.width}x${dimensions.height} (JPEG)`)
    } else if (metadata.format !== 'jpeg') {
      console.log(`    ↳ Converting from ${metadata.format} to JPEG (dimensions OK: ${currentWidth}x${currentHeight})`)
    }

    // Always convert to JPEG for consistent format, resize only if needed
    const sharpInstance = sharp(imageBuffer)

    if (needsResize) {
      sharpInstance.resize(dimensions.width, dimensions.height, {
        fit: "cover",      // Scale + crop from center (no stretching/squeezing)
        position: "center",
        kernel: "lanczos3",
      })
    }

    return sharpInstance
      .jpeg({
        quality: 95,  // High quality to preserve screenshot details
        mozjpeg: true,  // Better compression
      })
      .toBuffer()
  } catch (error) {
    console.error(`    ✗ Failed to process image for ${displayType}:`, error)
    // Return original if processing fails
    return imageBuffer
  }
}


// Optimized rate limit configuration for App Store Connect API
// App Store allows 180 requests/minute - we use a token bucket for precise control
const RATE_LIMIT_CONFIG = {
  // Batch processing config - conservative to handle API instability
  initialBatchSize: 3,     // Start with 3 parallel tasks (reduced from 8)
  minBatchSize: 1,         // Can go down to 1 for maximum stability
  maxBatchSize: 6,         // Can scale up to 6 parallel tasks (reduced from 12)

  // Token bucket config (180 req/min = 3 req/sec)
  tokensPerSecond: 2.5,    // More conservative to avoid hitting limit
  maxTokens: 10,           // Smaller burst allowance

  // Retry config with exponential backoff
  maxRetries: 4,           // Reduced from 5 to fail faster
  baseRetryDelay: 2000,    // Start with 2 seconds (increased from 1)
  maxRetryDelay: 30000,    // Cap at 30 seconds (reduced from 60)

  // Circuit breaker - more aggressive to stop quickly on API issues
  circuitBreakerThreshold: 3,   // Open circuit after 3 consecutive failures (reduced from 5)
  circuitBreakerResetMs: 60000, // Wait 60 seconds before retry (increased from 30)

  // Parallel operations - reduced to be gentler on API
  maxParallelImageFetches: 6,   // Fetch up to 6 images in parallel from R2 (reduced from 10)
  // Keep App Store screenshot uploads sequential. Apple preserves screenshot
  // ordering from the reservation/upload relationship, so parallel uploads can
  // make the store gallery come back as 2,1,3,4,6,5.
  maxParallelS3Uploads: 1,

  // Auto-retry configuration for failed jobs
  autoRetryDelayMs: 5 * 60 * 1000,  // Wait 5 minutes before auto-retry
  maxAutoRetries: 3,                 // Maximum 3 auto-retries for a failed job
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// Smart rate limiter that reads Apple's rate limit headers for dynamic throttling
// Apple returns x-rate-limit-remaining header with remaining quota (typically out of ~3600/hour)
class SmartRateLimiter {
  private tokens: number
  private lastRefill: number
  private tokensPerSecond: number
  private readonly maxTokens: number

  // Dynamic rate tracking from Apple's headers
  private appleRemainingQuota: number | null = null
  private requestsThisMinute: number = 0
  private minuteStart: number = Date.now()

  // Dynamic interval config based on remaining quota
  private static readonly QUOTA_THRESHOLDS = {
    critical: 50,      // < 50 remaining: very slow (1 req/2s)
    low: 200,          // < 200 remaining: slow (1 req/0.5s)
    moderate: 500,     // < 500 remaining: moderate (1 req/0.3s)
    comfortable: 1000, // < 1000 remaining: normal (1 req/0.2s)
    // > 1000: fast (1 req/0.1s)
  }

  constructor(initialTokensPerSecond: number, maxTokens: number) {
    this.tokensPerSecond = initialTokensPerSecond
    this.maxTokens = maxTokens
    this.tokens = maxTokens
    this.lastRefill = Date.now()
  }

  private refill(): void {
    const now = Date.now()
    const elapsed = (now - this.lastRefill) / 1000
    const newTokens = elapsed * this.tokensPerSecond
    this.tokens = Math.min(this.maxTokens, this.tokens + newTokens)
    this.lastRefill = now
  }

  // Update rate limiter from Apple's response headers
  updateFromHeaders(headers: Headers): void {
    // Try various header names Apple might use
    const rateLimitHeaders = [
      "x-rate-limit-remaining",
      "x-ratelimit-remaining",
      "ratelimit-remaining",
    ]

    for (const headerName of rateLimitHeaders) {
      const value = headers.get(headerName)
      if (value !== null) {
        const remaining = parseInt(value, 10)
        if (!isNaN(remaining)) {
          this.appleRemainingQuota = remaining
          this.adjustRateFromQuota(remaining)
          console.log(`    [Rate Limit] Apple quota remaining: ${remaining}, rate: ${this.tokensPerSecond.toFixed(2)} req/s`)
          break
        }
      }
    }

    // Track requests this minute for logging
    const now = Date.now()
    if (now - this.minuteStart > 60000) {
      console.log(`    [Rate Limit] Requests last minute: ${this.requestsThisMinute}`)
      this.requestsThisMinute = 0
      this.minuteStart = now
    }
    this.requestsThisMinute++
  }

  // Dynamically adjust rate based on remaining quota
  private adjustRateFromQuota(remaining: number): void {
    const { QUOTA_THRESHOLDS } = SmartRateLimiter

    if (remaining < QUOTA_THRESHOLDS.critical) {
      // Critical - very slow
      this.tokensPerSecond = 0.5  // 1 request per 2 seconds
      console.log(`    [Rate Limit] CRITICAL: Slowing to ${this.tokensPerSecond} req/s`)
    } else if (remaining < QUOTA_THRESHOLDS.low) {
      // Low - slow down significantly
      this.tokensPerSecond = 2    // 2 requests per second
      console.log(`    [Rate Limit] LOW: Reducing to ${this.tokensPerSecond} req/s`)
    } else if (remaining < QUOTA_THRESHOLDS.moderate) {
      // Moderate - be cautious
      this.tokensPerSecond = 3    // 3 requests per second
    } else if (remaining < QUOTA_THRESHOLDS.comfortable) {
      // Comfortable - normal rate
      this.tokensPerSecond = 4    // 4 requests per second
    } else {
      // Plenty of quota - can go faster
      this.tokensPerSecond = 6    // 6 requests per second
    }
  }

  // Handle 429 with retry-after header
  getRateLimitedDelay(retryAfterHeader: string | null): number {
    if (retryAfterHeader) {
      const retryAfter = parseInt(retryAfterHeader, 10)
      if (!isNaN(retryAfter) && retryAfter > 0) {
        // Apple told us exactly how long to wait
        console.log(`    [Rate Limit] Apple retry-after: ${retryAfter}s`)
        // Also slow down our rate significantly after being rate limited
        this.tokensPerSecond = Math.max(0.5, this.tokensPerSecond * 0.5)
        return retryAfter * 1000
      }
    }
    // Default exponential backoff if no header
    return 0
  }

  async acquire(): Promise<void> {
    this.refill()

    if (this.tokens >= 1) {
      this.tokens -= 1
      return
    }

    // Wait for token to become available
    const waitTime = ((1 - this.tokens) / this.tokensPerSecond) * 1000
    await sleep(Math.ceil(waitTime))
    this.refill()
    this.tokens -= 1
  }

  // Check if we can make a request without waiting
  canAcquireImmediately(): boolean {
    this.refill()
    return this.tokens >= 1
  }

  // Get current status for logging
  getStatus(): { tokensPerSecond: number; appleQuota: number | null; requestsThisMinute: number } {
    return {
      tokensPerSecond: this.tokensPerSecond,
      appleQuota: this.appleRemainingQuota,
      requestsThisMinute: this.requestsThisMinute,
    }
  }
}

// Circuit breaker to stop hammering a failing service
class CircuitBreaker {
  private failures = 0
  private lastFailure = 0
  private _isOpen = false
  private readonly threshold: number
  private readonly resetMs: number

  constructor(threshold: number, resetMs: number) {
    this.threshold = threshold
    this.resetMs = resetMs
  }

  // Check if circuit is currently open (for fail-fast behavior)
  get isOpen(): boolean {
    if (!this._isOpen) return false

    // Check if enough time has passed to auto-reset
    const elapsed = Date.now() - this.lastFailure
    if (elapsed >= this.resetMs) {
      this._isOpen = false
      this.failures = 0
      return false
    }
    return true
  }

  // Get remaining wait time if circuit is open
  get remainingWaitMs(): number {
    if (!this._isOpen) return 0
    const elapsed = Date.now() - this.lastFailure
    return Math.max(0, this.resetMs - elapsed)
  }

  recordSuccess(): void {
    this.failures = 0
    this._isOpen = false
  }

  recordFailure(): void {
    this.failures++
    this.lastFailure = Date.now()
    if (this.failures >= this.threshold) {
      this._isOpen = true
      console.log(`Circuit breaker OPEN after ${this.failures} consecutive failures - waiting ${this.resetMs / 1000}s`)
    }
  }

  // Fail fast: throw immediately if circuit is open
  checkOrThrow(): void {
    if (this.isOpen) {
      const waitTime = this.remainingWaitMs
      throw new Error(`Circuit breaker open - API unavailable. Retry in ${Math.ceil(waitTime / 1000)}s`)
    }
  }

  async checkAndWait(): Promise<boolean> {
    if (!this._isOpen) return true

    const elapsed = Date.now() - this.lastFailure
    if (elapsed >= this.resetMs) {
      console.log("Circuit breaker reset - attempting recovery")
      this._isOpen = false
      this.failures = 0
      return true
    }

    const waitTime = this.resetMs - elapsed
    console.log(`Circuit breaker OPEN - waiting ${Math.ceil(waitTime / 1000)}s before retry`)
    await sleep(waitTime)
    this._isOpen = false
    this.failures = 0
    return true
  }
}

// Local-key backend for self-hosters without Cloud KMS (mirrors
// lib/crypto/credentials.ts). encryptedDek = "local-v1:" + base64(iv[12] || tag[16] || ciphertext).
// KMS ciphertext is plain base64 and never contains ":", so the prefix is unambiguous.
const LOCAL_DEK_PREFIX = "local-v1:"

function unwrapLocalDek(encryptedDek: string): Buffer {
  const raw = (process.env.CREDENTIALS_ENCRYPTION_KEY || "").trim()
  if (!raw) {
    throw new Error(
      "This credential was encrypted with a local key (local-v1) but CREDENTIALS_ENCRYPTION_KEY is not set. " +
        "Set it to the same key that encrypted the credential."
    )
  }
  let key: Buffer | null = null
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    key = Buffer.from(raw, "hex")
  } else if (/^[A-Za-z0-9+/_-]+={0,2}$/.test(raw)) {
    const decoded = Buffer.from(raw.replace(/-/g, "+").replace(/_/g, "/"), "base64")
    if (decoded.length === 32) key = decoded
  }
  if (!key) {
    throw new Error(
      "Invalid CREDENTIALS_ENCRYPTION_KEY. It must be 32 bytes, given as 64 hex characters or base64. " +
        "Generate one with: openssl rand -base64 32"
    )
  }
  const payload = Buffer.from(encryptedDek.slice(LOCAL_DEK_PREFIX.length), "base64")
  if (payload.length < 12 + 16 + 1) {
    throw new Error("Malformed local-v1 encrypted DEK")
  }
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, payload.subarray(0, 12))
  decipher.setAuthTag(payload.subarray(12, 28))
  try {
    return Buffer.concat([decipher.update(payload.subarray(28)), decipher.final()])
  } catch {
    throw new Error("Failed to decrypt DEK with the local key (CREDENTIALS_ENCRYPTION_KEY does not match)")
  }
}

// Decrypt credentials using Cloud KMS (or the local key for local-v1 records)
async function decryptCredential(
  encryptedData: string,
  encryptedDek: string
): Promise<string> {
  let dek: Buffer
  if (encryptedDek.startsWith(LOCAL_DEK_PREFIX)) {
    console.log("Decrypting credentials with the local key (local-v1)...")
    dek = unwrapLocalDek(encryptedDek)
  } else {
    console.log("Decrypting credentials with Cloud KMS...")
    console.log("KMS key path:", getKmsKeyName())

    // Decrypt DEK with Cloud KMS
    const kms = getKmsClient()
    const [decryptResponse] = await kms.decrypt({
      name: getKmsKeyName(),
      ciphertext: Buffer.from(encryptedDek, "base64")
    })

    if (!decryptResponse.plaintext) {
      throw new Error("Failed to decrypt DEK with KMS")
    }

    dek = Buffer.from(decryptResponse.plaintext)
    console.log("KMS decryption succeeded, DEK length:", dek.length)
  }

  // Parse encrypted data
  const dataPayload = JSON.parse(encryptedData)

  // Decrypt data with DEK
  const dataDecipher = crypto.createDecipheriv(
    "aes-256-gcm",
    dek,
    Buffer.from(dataPayload.iv, "base64")
  )
  dataDecipher.setAuthTag(Buffer.from(dataPayload.tag, "base64"))

  let plaintext = dataDecipher.update(Buffer.from(dataPayload.data, "base64"), undefined, "utf8")
  plaintext += dataDecipher.final("utf8")

  return plaintext
}

// Optimized App Store Connect API helper class with caching and parallel operations
class AppStoreUploader {
  private credentials: { keyId: string; issuerId: string; privateKey: string }
  private appId: string
  private tokenCache: string | null = null
  private tokenExpiry = 0

  // Shared rate limiter and circuit breaker
  private rateLimiter: SmartRateLimiter
  private circuitBreaker: CircuitBreaker

  // Caches to avoid redundant API calls
  private versionCache: { id: string; versionString: string; state: string } | null = null
  private localeCache = new Map<string, string>() // locale -> localeId
  private screenshotSetsCache = new Map<string, Map<string, string>>() // localeId -> (displayType -> setId)

  // App Store media backend: legacy screenshot sets (deprecated in API 4.5.1) or
  // the Asset Library. Set per project (`ascMediaBackend`); library failures
  // fall back to legacy for that set and are reported on the job.
  private mediaBackend: "legacy" | "library" = "legacy"
  private library: AscAssetLibraryClient | null = null
  private libraryFallbacks: Array<{ locale: string; displayType: string; error: string; code?: string }> = []

  // Stats for logging
  private stats = {
    apiCalls: 0,
    s3Uploads: 0,
    cacheHits: 0,
    retries: 0,
  }

  constructor(credentials: { keyId: string; issuerId: string; privateKey: string }, appId: string) {
    this.credentials = credentials
    this.appId = appId
    this.rateLimiter = new SmartRateLimiter(RATE_LIMIT_CONFIG.tokensPerSecond, RATE_LIMIT_CONFIG.maxTokens)
    this.circuitBreaker = new CircuitBreaker(
      RATE_LIMIT_CONFIG.circuitBreakerThreshold,
      RATE_LIMIT_CONFIG.circuitBreakerResetMs
    )
  }

  setMediaBackend(backend: "legacy" | "library"): void {
    this.mediaBackend = backend
  }

  /** Fields recorded on the push job: which backend ran and any fallbacks to legacy. */
  mediaReport(): { mediaBackend: "legacy" | "library"; libraryFallbacks: Array<{ locale: string; displayType: string; error: string; code?: string }> } {
    return { mediaBackend: this.mediaBackend, libraryFallbacks: this.libraryFallbacks }
  }

  private getLibrary(): AscAssetLibraryClient {
    if (!this.library) {
      this.library = new AscAssetLibraryClient({
        request: (method, url, body) => this.makeApiRequest(method, url, body),
        appId: this.appId,
        // One doc per distinct file (md5) so a screenshot reused across locales uploads once
        assetIndex: firestoreAssetIndex(db.collection("ascAssetLibraryIndex").doc(this.appId).collection("images")),
        log: (message) => console.log(`    [library] ${message}`),
      })
    }
    return this.library
  }

  /** Uploads to the Asset Library and makes the locale's placements exactly these images, in order. */
  private async uploadScreenshotsToLibrary(
    localeId: string,
    screenshots: Array<{ fileName: string; data: Buffer; checksum: string }>,
    displayType: string,
    onProgress?: (step: "uploading" | "committing", current: number, total: number) => Promise<void>
  ): Promise<{ success: boolean; screenshotsUploaded: number }> {
    const library = this.getLibrary()
    const catalog = await library.getCatalog("APP_SCREENSHOT")
    const group = groupForLegacyDisplayType(catalog, displayType)
    if (!group) {
      throw new AscLibraryError(`No Asset Library group for ${displayType}`, undefined, "NO_GROUP")
    }

    const assetIds: string[] = []
    for (let i = 0; i < screenshots.length; i++) {
      if (onProgress) await onProgress("uploading", i + 1, screenshots.length)
      const uploaded = await library.uploadImage({
        fileName: screenshots[i].fileName,
        data: screenshots[i].data,
        placementType: "APP_SCREENSHOT",
        expectedGroup: group,
      })
      assetIds.push(uploaded.assetId)
    }

    if (onProgress) await onProgress("committing", screenshots.length, screenshots.length)
    const result = await library.syncPlacements(
      { kind: "appStoreVersionLocalization", id: localeId },
      "APP_SCREENSHOT",
      group,
      assetIds
    )
    console.log(`    [library] ${group}: ${result.unchanged ? "already up to date" : `${result.created} placed, ${result.removed} removed`}`)
    return { success: true, screenshotsUploaded: screenshots.length }
  }

  getStats() {
    return {
      ...this.stats,
      rateLimiter: this.rateLimiter.getStatus(),
    }
  }

  // Check if circuit breaker is open (for fail-fast in batch processing)
  isCircuitBreakerOpen(): boolean {
    return this.circuitBreaker.isOpen
  }

  // Fail fast if circuit breaker is open - call before starting a new task
  checkCircuitBreakerOrThrow(): void {
    this.circuitBreaker.checkOrThrow()
  }

  private getToken(): string {
    if (this.tokenCache && Date.now() / 1000 < this.tokenExpiry - 300) {
      return this.tokenCache
    }

    const now = Math.floor(Date.now() / 1000)
    const expiry = now + 20 * 60

    this.tokenCache = jwt.sign(
      { iss: this.credentials.issuerId, exp: expiry, aud: "appstoreconnect-v1" },
      this.credentials.privateKey,
      { algorithm: "ES256", header: { alg: "ES256", kid: this.credentials.keyId, typ: "JWT" } }
    )
    this.tokenExpiry = expiry
    return this.tokenCache
  }

  private async makeApiRequest(
    method: string,
    url: string,
    body?: object,
    skipRateLimit = false
  ): Promise<Response> {
    // Check circuit breaker
    await this.circuitBreaker.checkAndWait()

    // Acquire rate limit token (unless skipped for non-ASC requests)
    if (!skipRateLimit) {
      await this.rateLimiter.acquire()
    }

    const headers = {
      "Authorization": `Bearer ${this.getToken()}`,
      "Content-Type": "application/json",
      "Accept": "application/json"
    }

    for (let attempt = 0; attempt < RATE_LIMIT_CONFIG.maxRetries; attempt++) {
      try {
        this.stats.apiCalls++
        const response = await fetch(url, {
          method,
          headers,
          body: body ? JSON.stringify(body) : undefined
        })

        if (response.status === 429) {
          // Rate limited - use smart rate limiter's delay calculation (reads retry-after header)
          const retryAfterHeader = response.headers.get("retry-after")
          const smartDelay = this.rateLimiter.getRateLimitedDelay(retryAfterHeader)
          const backoffDelay = smartDelay > 0
            ? smartDelay
            : Math.min(
                RATE_LIMIT_CONFIG.baseRetryDelay * Math.pow(2, attempt) + Math.random() * 1000,
                RATE_LIMIT_CONFIG.maxRetryDelay
              )

          console.log(`Rate limited (429). Attempt ${attempt + 1}/${RATE_LIMIT_CONFIG.maxRetries}. Waiting ${Math.ceil(backoffDelay / 1000)}s...`)
          this.stats.retries++
          await sleep(backoffDelay)
          continue
        }

        if (response.status >= 500) {
          // Server error - retry with backoff
          const backoffDelay = Math.min(
            RATE_LIMIT_CONFIG.baseRetryDelay * Math.pow(2, attempt) + Math.random() * 1000,
            RATE_LIMIT_CONFIG.maxRetryDelay
          )
          console.log(`Server error (${response.status}). Attempt ${attempt + 1}/${RATE_LIMIT_CONFIG.maxRetries}. Waiting ${Math.ceil(backoffDelay / 1000)}s...`)
          this.stats.retries++
          this.circuitBreaker.recordFailure()
          await sleep(backoffDelay)
          continue
        }

        // SUCCESS: Read rate limit headers to dynamically adjust our rate
        this.rateLimiter.updateFromHeaders(response.headers)

        this.circuitBreaker.recordSuccess()
        return response
      } catch (error) {
        this.circuitBreaker.recordFailure()
        if (attempt === RATE_LIMIT_CONFIG.maxRetries - 1) throw error

        const backoffDelay = Math.min(
          RATE_LIMIT_CONFIG.baseRetryDelay * Math.pow(2, attempt) + Math.random() * 1000,
          RATE_LIMIT_CONFIG.maxRetryDelay
        )
        console.log(`Network error. Attempt ${attempt + 1}/${RATE_LIMIT_CONFIG.maxRetries}. Waiting ${Math.ceil(backoffDelay / 1000)}s...`)
        this.stats.retries++
        await sleep(backoffDelay)
      }
    }

    throw new Error("Max retries exceeded")
  }

  async getLatestEditableVersion(): Promise<{
    id: string
    versionString: string
    state: string
    isEditable: boolean
  } | null> {
    // Use cache if available
    if (this.versionCache) {
      this.stats.cacheHits++
      return { ...this.versionCache, isEditable: true }
    }

    const url = `https://api.appstoreconnect.apple.com/v1/apps/${this.appId}/appStoreVersions`
    const response = await this.makeApiRequest("GET", url)

    if (!response.ok) {
      throw new Error(`Error getting app versions: ${await response.text()}`)
    }

    const data = await response.json()
    const versions = data.data as Array<{
      id: string
      attributes: { versionString: string; appStoreState: string }
    }>

    const editableStates = [
      "PREPARE_FOR_SUBMISSION",
      "DEVELOPER_REJECTED",
      "REJECTED",
      "METADATA_REJECTED",
      "WAITING_FOR_REVIEW",
      "INVALID_BINARY",
      "DEVELOPER_REMOVED_FROM_SALE"
    ]

    for (const version of versions) {
      if (editableStates.includes(version.attributes.appStoreState)) {
        this.versionCache = {
          id: version.id,
          versionString: version.attributes.versionString,
          state: version.attributes.appStoreState,
        }
        return { ...this.versionCache, isEditable: true }
      }
    }

    if (versions.length > 0) {
      return {
        id: versions[0].id,
        versionString: versions[0].attributes.versionString,
        state: versions[0].attributes.appStoreState,
        isEditable: false
      }
    }

    return null
  }

  // Pre-fetch and cache locale IDs for all target locales
  async prefetchLocaleIds(locales: string[]): Promise<void> {
    if (!this.versionCache) {
      await this.getLatestEditableVersion()
    }
    if (!this.versionCache) return

    const versionId = this.versionCache.id
    const localeListUrl = `https://api.appstoreconnect.apple.com/v1/appStoreVersions/${versionId}/appStoreVersionLocalizations?limit=200`
    const response = await this.makeApiRequest("GET", localeListUrl)

    if (!response.ok) {
      console.log("Warning: Could not prefetch locale IDs")
      return
    }

    const data = await response.json()
    for (const item of data.data) {
      this.localeCache.set(item.attributes.locale, item.id)
    }

    console.log(`  Prefetched ${this.localeCache.size} locale IDs`)
  }

  private async getOrCreateLocaleId(locale: string): Promise<string | null> {
    // Check cache first
    if (this.localeCache.has(locale)) {
      this.stats.cacheHits++
      return this.localeCache.get(locale)!
    }

    if (!this.versionCache) {
      await this.getLatestEditableVersion()
    }
    if (!this.versionCache) return null

    const versionId = this.versionCache.id

    // Try to create the localization
    const createLocaleUrl = "https://api.appstoreconnect.apple.com/v1/appStoreVersionLocalizations"
    const createLocalePayload = {
      data: {
        type: "appStoreVersionLocalizations",
        attributes: { locale },
        relationships: {
          appStoreVersion: {
            data: { type: "appStoreVersions", id: versionId }
          }
        }
      }
    }

    const response = await this.makeApiRequest("POST", createLocaleUrl, createLocalePayload)
    if (response.ok) {
      const data = await response.json()
      this.localeCache.set(locale, data.data.id)
      return data.data.id
    }

    // Maybe it already exists - try to get it
    const localeListUrl = `https://api.appstoreconnect.apple.com/v1/appStoreVersions/${versionId}/appStoreVersionLocalizations`
    const listResponse = await this.makeApiRequest("GET", localeListUrl)
    if (listResponse.ok) {
      const data = await listResponse.json()
      const localeInfo = data.data.find((item: { attributes: { locale: string }; id: string }) =>
        item.attributes.locale === locale
      )
      if (localeInfo) {
        this.localeCache.set(locale, localeInfo.id)
        return localeInfo.id
      }
    }

    return null
  }

  // Helper: Get screenshot state to verify processing completion
  private async getScreenshotState(screenshotId: string): Promise<{
    state: string | null
    checksum: string | null
    error?: string
    errors?: Array<{ code: string; description: string }>
  }> {
    try {
      const url = `https://api.appstoreconnect.apple.com/v1/appScreenshots/${screenshotId}`
      const response = await this.makeApiRequest("GET", url)
      if (!response.ok) {
        return { state: null, checksum: null, error: `HTTP ${response.status}` }
      }
      const data = await response.json()
      const attrs = data.data?.attributes || {}
      const deliveryState = attrs.assetDeliveryState || {}
      return {
        state: deliveryState.state || null,
        checksum: attrs.sourceFileChecksum || null,
        errors: deliveryState.errors || [],
      }
    } catch (error) {
      return { state: null, checksum: null, error: String(error) }
    }
  }

  // Helper: Wait for screenshot processing to complete
  private async waitForProcessing(
    screenshotId: string,
    timeoutMs: number = 60000, // 60 second default timeout
    pollIntervalMs: number = 2000
  ): Promise<{ success: boolean; state: string; error?: string }> {
    const startTime = Date.now()

    while (Date.now() - startTime < timeoutMs) {
      const { state, error, errors } = await this.getScreenshotState(screenshotId)

      if (error) {
        console.log(`      ↳ Error checking state: ${error}`)
        await sleep(pollIntervalMs)
        continue
      }

      if (state === "COMPLETE") {
        return { success: true, state }
      }

      if (state === "FAILED") {
        // Log detailed error info from App Store Connect
        if (errors && errors.length > 0) {
          const errorDetails = errors.map(e => `${e.code}: ${e.description}`).join(", ")
          console.log(`      ↳ ASC Processing errors: ${errorDetails}`)
          return { success: false, state, error: `Processing failed: ${errorDetails}` }
        }
        return { success: false, state, error: "Processing failed (no details)" }
      }

      // Still processing (UPLOAD_COMPLETE, AWAITING_UPLOAD, etc.)
      await sleep(pollIntervalMs)
    }

    return { success: false, state: "TIMEOUT", error: "Processing timeout" }
  }

  // Helper: Delete a screenshot by ID
  private async deleteScreenshot(screenshotId: string): Promise<boolean> {
    try {
      const url = `https://api.appstoreconnect.apple.com/v1/appScreenshots/${screenshotId}`
      const response = await this.makeApiRequest("DELETE", url)
      return response.ok || response.status === 404 // Already deleted is fine
    } catch {
      return false
    }
  }

  async uploadScreenshots(
    locale: string,
    screenshots: Array<{ fileName: string; data: Buffer; checksum: string }>,
    displayType: string,
    onProgress?: (step: "uploading" | "committing", current: number, total: number) => Promise<void>
  ): Promise<{ success: boolean; error?: string; screenshotsUploaded?: number }> {
    try {
      // Get or create locale ID
      const localeId = await this.getOrCreateLocaleId(locale)
      if (!localeId) {
        return { success: false, error: `Could not get or create locale: ${locale}` }
      }

      if (this.mediaBackend === "library") {
        try {
          return await this.uploadScreenshotsToLibrary(localeId, screenshots, displayType, onProgress)
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          const code = error instanceof AscLibraryError ? error.code : undefined
          console.warn(`    ⚠ Asset Library push failed for ${displayType}/${locale} (${code || "error"}): ${message}. Falling back to screenshot sets.`)
          this.libraryFallbacks.push({ locale, displayType, error: message.slice(0, 500), ...(code ? { code } : {}) })
        }
      }

      // Get existing screenshot sets for this locale
      let setsForLocale = this.screenshotSetsCache.get(localeId)
      if (!setsForLocale) {
        setsForLocale = new Map()
        const setListUrl = `https://api.appstoreconnect.apple.com/v1/appStoreVersionLocalizations/${localeId}/appScreenshotSets`
        const setResponse = await this.makeApiRequest("GET", setListUrl)
        if (setResponse.ok) {
          const setData = await setResponse.json()
          for (const item of setData.data) {
            setsForLocale.set(item.attributes.screenshotDisplayType, item.id)
          }
        }
        this.screenshotSetsCache.set(localeId, setsForLocale)
      } else {
        this.stats.cacheHits++
      }

      // Check for existing set - ALWAYS delete and recreate to ensure clean replacement
      let screenshotSetId = setsForLocale.get(displayType)
      const existingChecksums = new Map<string, { id: string; state: string }>()

      if (screenshotSetId) {
        // Get existing screenshots to check if we can skip (all same checksums in same order)
        const existingUrl = `https://api.appstoreconnect.apple.com/v1/appScreenshotSets/${screenshotSetId}/appScreenshots`
        const existingResponse = await this.makeApiRequest("GET", existingUrl)

        let canSkipUpload = false
        if (existingResponse.ok) {
          const existingData = await existingResponse.json()
          const existingItems = existingData.data || []

          // Build map of existing checksums
          for (const item of existingItems) {
            const checksum = item.attributes?.sourceFileChecksum
            const state = item.attributes?.assetDeliveryState?.state
            if (checksum) {
              existingChecksums.set(checksum, { id: item.id, state })
            }
          }
          console.log(`      ↳ Found ${existingChecksums.size} existing screenshots in set`)

          // Skip only if the set already holds the same files, all COMPLETE, in the same order
          if (existingSetMatchesInOrder(existingItems, screenshots.map(s => s.checksum))) {
            console.log(`      ↳ All ${screenshots.length} screenshots already uploaded in the same order - skipping`)
            canSkipUpload = true
          }
        }

        if (canSkipUpload) {
          return {
            success: true,
            screenshotsUploaded: screenshots.length,
          }
        }

        // Delete existing set and recreate for clean replacement
        // This ensures we REPLACE screenshots rather than append
        console.log(`      ↳ Deleting existing set to replace with ${screenshots.length} new screenshots`)
        const deleteUrl = `https://api.appstoreconnect.apple.com/v1/appScreenshotSets/${screenshotSetId}`
        const deleteResponse = await this.makeApiRequest("DELETE", deleteUrl)

        // DELETE returns 204 on success, 404 if already gone (both are fine)
        if (!deleteResponse.ok && deleteResponse.status !== 404) {
          const errorText = await deleteResponse.text().catch(() => "Unknown error")
          console.log(`      ⚠ Failed to delete existing set (${deleteResponse.status}): ${errorText}`)
          // Continue anyway - we'll try to upload, and if the set is full it will fail appropriately
        } else {
          console.log(`      ✓ Deleted existing set successfully`)
        }

        setsForLocale.delete(displayType)
        screenshotSetId = undefined
        existingChecksums.clear()
        await sleep(500) // Increased delay to let ASC process the delete
      }

      // Create new screenshot set if needed
      if (!screenshotSetId) {
        const createSetUrl = "https://api.appstoreconnect.apple.com/v1/appScreenshotSets"
        const createSetPayload = {
          data: {
            type: "appScreenshotSets",
            attributes: { screenshotDisplayType: displayType },
            relationships: {
              appStoreVersionLocalization: {
                data: { type: "appStoreVersionLocalizations", id: localeId }
              }
            }
          }
        }

        const createSetResponse = await this.makeApiRequest("POST", createSetUrl, createSetPayload)
        if (!createSetResponse.ok) {
          throw new Error(`Error creating screenshot set: ${await createSetResponse.text()}`)
        }

        const newSetData = await createSetResponse.json()
        screenshotSetId = newSetData.data.id
        setsForLocale.set(displayType, screenshotSetId!)
      }

      // Upload screenshots
      let successCount = 0
      let skippedCount = 0
      const uploadResults: boolean[] = []

      // Process in small parallel batches
      for (let i = 0; i < screenshots.length; i += RATE_LIMIT_CONFIG.maxParallelS3Uploads) {
        const batch = screenshots.slice(i, i + RATE_LIMIT_CONFIG.maxParallelS3Uploads)

        const batchPromises = batch.map(async (screenshot, batchIdx) => {
          const idx = i + batchIdx

          // Report progress
          if (onProgress) {
            await onProgress("uploading", idx + 1, screenshots.length)
          }

          // IMPROVEMENT 1: Check if screenshot already exists with same checksum
          const existing = existingChecksums.get(screenshot.checksum)
          if (existing && existing.state === "COMPLETE") {
            console.log(`      ↳ Skipping ${screenshot.fileName} (checksum match)`)
            skippedCount++
            return true // Already uploaded
          }

          // Create screenshot reservation (uses ASC API rate limit)
          const createScreenshotUrl = "https://api.appstoreconnect.apple.com/v1/appScreenshots"
          const createScreenshotPayload = {
            data: {
              type: "appScreenshots",
              attributes: {
                fileName: screenshot.fileName,
                fileSize: screenshot.data.length
              },
              relationships: {
                appScreenshotSet: {
                  data: { type: "appScreenshotSets", id: screenshotSetId }
                }
              }
            }
          }

          const createResponse = await this.makeApiRequest("POST", createScreenshotUrl, createScreenshotPayload)
          if (!createResponse.ok) {
            console.error(`Error reserving screenshot ${screenshot.fileName}: ${await createResponse.text()}`)
            return false
          }

          const screenshotData = await createResponse.json()
          const screenshotId = screenshotData.data.id
          const uploadOperations = screenshotData.data.attributes.uploadOperations

          // Upload to Apple's S3 (no rate limit needed - this is S3, not ASC)
          let uploadSuccess = false
          for (const op of uploadOperations) {
            const headers: Record<string, string> = {}
            for (const h of op.requestHeaders) {
              headers[h.name] = h.value
            }

            try {
              this.stats.s3Uploads++
              const uploadResponse = await fetch(op.url, {
                method: op.method,
                headers,
                body: new Uint8Array(screenshot.data)
              })

              if (uploadResponse.ok) {
                uploadSuccess = true
                break
              }
            } catch (e) {
              console.error(`S3 upload error for ${screenshot.fileName}:`, e)
            }
          }

          if (!uploadSuccess) {
            console.error(`S3 upload failed for ${screenshot.fileName}`)
            // IMPROVEMENT 4: Delete failed upload placeholder
            await this.deleteScreenshot(screenshotId)
            return false
          }

          // Commit the reservation (uses ASC API rate limit)
          const commitUrl = `https://api.appstoreconnect.apple.com/v1/appScreenshots/${screenshotId}`
          const commitPayload = {
            data: {
              type: "appScreenshots",
              id: screenshotId,
              attributes: {
                uploaded: true,
                sourceFileChecksum: screenshot.checksum
              }
            }
          }

          const commitResponse = await this.makeApiRequest("PATCH", commitUrl, commitPayload)

          // IMPROVEMENT 3: Handle 504 timeout by checking actual state
          if (!commitResponse.ok) {
            if (commitResponse.status === 504) {
              console.log(`      ↳ 504 timeout on commit, verifying state...`)
              await sleep(2000)
              const { state } = await this.getScreenshotState(screenshotId)
              if (state === "COMPLETE" || state === "UPLOAD_COMPLETE") {
                console.log(`      ↳ Verified: commit actually succeeded (${state})`)
                return true
              }
            }
            console.error(`Commit failed for ${screenshot.fileName}: HTTP ${commitResponse.status}`)
            await this.deleteScreenshot(screenshotId)
            return false
          }

          // IMPROVEMENT 2: Wait for processing to complete
          const processingResult = await this.waitForProcessing(screenshotId, 30000, 2000)
          if (!processingResult.success) {
            console.error(`Processing failed for ${screenshot.fileName}: ${processingResult.error}`)
            // Delete failed screenshot so it can be retried
            await this.deleteScreenshot(screenshotId)
            return false
          }

          return true
        })

        const results = await Promise.all(batchPromises)
        uploadResults.push(...results)
      }

      successCount = uploadResults.filter(r => r).length

      if (skippedCount > 0) {
        console.log(`      ↳ Skipped ${skippedCount} unchanged screenshots (checksum match)`)
      }

      return {
        success: successCount === screenshots.length,
        screenshotsUploaded: successCount,
        error: successCount < screenshots.length
          ? `${successCount}/${screenshots.length} screenshots uploaded`
          : undefined
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error"
      }
    }
  }
}

// ============================================================================
// Play Store Uploader (Google Play Android Publisher API v3)
// Much simpler than App Store: no version management, no review process
// ============================================================================

// Locale mapping: iOS format → Google Play format
const IOS_TO_ANDROID_LOCALE: Record<string, string> = {
  "ar-SA": "ar", "ca": "ca", "cs": "cs-CZ", "da": "da-DK",
  "de-DE": "de-DE", "el": "el-GR", "en-AU": "en-AU", "en-CA": "en-CA",
  "en-GB": "en-GB", "en-US": "en-US", "es-ES": "es-ES", "es-MX": "es-419",
  "fi": "fi-FI", "fr-CA": "fr-CA", "fr-FR": "fr-FR", "he": "iw-IL",
  "hi": "hi-IN", "hr": "hr", "hu": "hu-HU", "id": "id", "it": "it-IT",
  "ja": "ja-JP", "ko": "ko-KR", "ms": "ms-MY", "nl-NL": "nl-NL",
  "no": "no-NO", "pl": "pl-PL", "pt-BR": "pt-BR", "pt-PT": "pt-PT",
  "ro": "ro", "ru": "ru-RU", "sk": "sk", "sv": "sv-SE", "th": "th",
  "tr": "tr-TR", "uk": "uk", "vi": "vi", "zh-Hans": "zh-CN", "zh-Hant": "zh-TW",
  "bn-BD": "bn-BD", "gu-IN": "gu", "kn-IN": "kn-IN", "ml-IN": "ml-IN", "mr-IN": "mr-IN",
  "pa-IN": "pa", "sl-SI": "sl", "ta-IN": "ta-IN", "te-IN": "te-IN", "ur-PK": "ur",
}

// Map display types to Google Play image types
const PLAY_DISPLAY_TYPE_TO_IMAGE_TYPE: Record<string, string> = {
  "PLAY_PHONE": "phoneScreenshots",
  "PLAY_TABLET": "sevenInchScreenshots",
  "PLAY_FEATURE_GRAPHIC": "featureGraphic",
  // iOS types that may come through from synced projects
  "APP_IPHONE_69": "phoneScreenshots",
  "APP_IPHONE_67": "phoneScreenshots",
  "APP_IPHONE_65": "phoneScreenshots",
  "APP_IPHONE_63": "phoneScreenshots",
  "APP_IPHONE_61": "phoneScreenshots",
  "APP_IPHONE_55": "phoneScreenshots",
  "APP_IPAD_PRO_13": "sevenInchScreenshots",
  "APP_IPAD_PRO_129": "sevenInchScreenshots",
  "APP_IPAD_PRO_11": "sevenInchScreenshots",
}

class PlayStoreUploader {
  private packageName: string
  private serviceAccountJson: Record<string, unknown>
  private accessToken: string | null = null
  private tokenExpiry = 0
  private stats = { apiCalls: 0, uploads: 0, retries: 0 }

  private static readonly BASE_URL = "https://androidpublisher.googleapis.com/androidpublisher/v3/applications"
  private static readonly UPLOAD_URL = "https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications"

  constructor(serviceAccountJson: Record<string, unknown>, packageName: string) {
    this.serviceAccountJson = serviceAccountJson
    this.packageName = packageName
  }

  getStats() { return this.stats }

  // Get OAuth2 access token from service account
  private async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() / 1000 < this.tokenExpiry - 60) {
      return this.accessToken
    }

    const now = Math.floor(Date.now() / 1000)
    const expiry = now + 3600

    // Create JWT for token exchange
    const token = jwt.sign(
      {
        iss: this.serviceAccountJson.client_email,
        scope: "https://www.googleapis.com/auth/androidpublisher",
        aud: "https://oauth2.googleapis.com/token",
        iat: now,
        exp: expiry,
      },
      this.serviceAccountJson.private_key as string,
      { algorithm: "RS256" }
    )

    // Exchange JWT for access token
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${token}`,
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Failed to get Google access token: ${error}`)
    }

    const data = await response.json() as { access_token: string; expires_in: number }
    this.accessToken = data.access_token
    this.tokenExpiry = now + data.expires_in
    return this.accessToken
  }

  // Make authenticated API request
  private async apiRequest(
    method: string,
    path: string,
    body?: object | Buffer,
    contentType?: string
  ): Promise<Response> {
    const token = await this.getAccessToken()
    const url = `${PlayStoreUploader.BASE_URL}/${this.packageName}/${path}`

    const headers: Record<string, string> = {
      "Authorization": `Bearer ${token}`,
    }

    let requestBody: BodyInit | undefined
    if (body instanceof Buffer) {
      headers["Content-Type"] = contentType || "image/png"
      requestBody = new Uint8Array(body) as any
    } else if (body) {
      headers["Content-Type"] = "application/json"
      requestBody = JSON.stringify(body)
    }

    for (let attempt = 0; attempt < 3; attempt++) {
      this.stats.apiCalls++
      const response = await fetch(url, { method, headers, body: requestBody })

      if (response.status === 429 || response.status >= 500) {
        const delay = Math.min(2000 * Math.pow(2, attempt), 15000)
        console.log(`  Play Store API ${response.status}, retrying in ${delay}ms...`)
        this.stats.retries++
        await sleep(delay)
        continue
      }

      return response
    }

    throw new Error("Max retries exceeded for Play Store API")
  }

  // Create a new edit
  async createEdit(): Promise<string> {
    const response = await this.apiRequest("POST", "edits", {})
    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Failed to create edit: ${error}`)
    }
    const data = await response.json() as { id: string }
    return data.id
  }

  // Commit an edit
  async commitEdit(editId: string): Promise<void> {
    // Try with changesNotSentForReview first (needed for draft apps with managed publishing)
    let response = await this.apiRequest("POST", `edits/${editId}:commit?changesNotSentForReview=true`)
    if (!response.ok) {
      const errorText = await response.text()
      if (errorText.includes("changesNotSentForReview must not be set")) {
        // Published app - retry without the parameter
        console.log("  changesNotSentForReview not supported, retrying without it...")
        response = await this.apiRequest("POST", `edits/${editId}:commit`)
        if (!response.ok) {
          const retryError = await response.text()
          throw new Error(`Failed to commit edit: ${retryError}`)
        }
      } else {
        throw new Error(`Failed to commit edit: ${errorText}`)
      }
    }
    const commitData = await response.json()
    console.log(`  Commit response:`, JSON.stringify(commitData).slice(0, 500))
  }

  // Delete all images of a specific type for a locale
  async deleteAllImages(editId: string, language: string, imageType: string): Promise<void> {
    try {
      const response = await this.apiRequest("DELETE", `edits/${editId}/listings/${language}/${imageType}`)
      if (response.ok) {
        console.log(`    ✓ Deleted existing ${imageType} for ${language}`)
      } else if (response.status === 404) {
        // No existing images for this locale - that's fine
        console.log(`    - No existing ${imageType} for ${language} (404)`)
      } else {
        const errorText = await response.text()
        console.warn(`    ⚠ Delete ${imageType} for ${language} returned ${response.status}: ${errorText}`)
        // Try individual image deletion as fallback
        await this.deleteImagesFallback(editId, language, imageType)
      }
    } catch (error) {
      console.warn(`    ⚠ Delete ${imageType} for ${language} failed:`, error)
      // Try fallback
      await this.deleteImagesFallback(editId, language, imageType)
    }
  }

  // Fallback: list images then delete individually
  private async deleteImagesFallback(editId: string, language: string, imageType: string): Promise<void> {
    try {
      const listResponse = await this.apiRequest("GET", `edits/${editId}/listings/${language}/${imageType}`)
      if (!listResponse.ok) {
        console.warn(`    ⚠ Could not list images for ${language}/${imageType} fallback`)
        return
      }
      const data = await listResponse.json() as { images?: Array<{ id: string }> }
      if (data.images && data.images.length > 0) {
        console.log(`    Fallback: deleting ${data.images.length} individual images for ${language}`)
        for (const image of data.images) {
          try {
            await this.apiRequest("DELETE", `edits/${editId}/listings/${language}/${imageType}/${image.id}`)
          } catch {
            console.warn(`    ⚠ Failed to delete image ${image.id}`)
          }
        }
      }
    } catch (error) {
      console.warn(`    ⚠ Fallback delete failed for ${language}:`, error)
    }
  }

  // Upload a single image
  async uploadImage(
    editId: string,
    language: string,
    imageType: string,
    imageBuffer: Buffer
  ): Promise<boolean> {
    // IMPORTANT: Image uploads use the /upload/ URL prefix and require uploadType=media
    const uploadUrl = `${PlayStoreUploader.UPLOAD_URL}/${this.packageName}/edits/${editId}/listings/${language}/${imageType}?uploadType=media`
    const token = await this.getAccessToken()

    for (let attempt = 0; attempt < 3; attempt++) {
      this.stats.apiCalls++
      const response = await fetch(uploadUrl, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "image/png",
          "Content-Length": String(imageBuffer.length),
        },
        body: new Uint8Array(imageBuffer) as any,
      })

      if (response.ok) {
        const data = await response.json()
        if (this.stats.uploads === 0) {
          // Log first upload response to diagnose
          console.log(`    First upload response for ${language}/${imageType}:`, JSON.stringify(data).slice(0, 300))
        }
        this.stats.uploads++
        return true
      }

      if (response.status === 429 || response.status >= 500) {
        const delay = Math.min(2000 * Math.pow(2, attempt), 15000)
        this.stats.retries++
        await sleep(delay)
        continue
      }

      const error = await response.text()
      console.error(`  ✗ Upload failed (${response.status}) for ${language}/${imageType}: ${error}`)
      return false
    }

    return false
  }

  // Verify images exist in the edit for a locale/imageType
  async verifyImages(editId: string, language: string, imageType: string): Promise<number> {
    try {
      const response = await this.apiRequest("GET", `edits/${editId}/listings/${language}/${imageType}`)
      if (response.ok) {
        const data = await response.json() as { images?: Array<{ id: string }> }
        return data.images?.length || 0
      }
      return -1 // Error
    } catch {
      return -1
    }
  }

  // Upload all screenshots for a locale/display type combo (single-locale, creates own edit)
  async uploadScreenshots(
    locale: string,
    displayType: string,
    screenshots: Array<{ fileName: string; data: Buffer }>,
    onProgress?: (step: "fetching" | "uploading" | "committing", current: number, total: number) => Promise<void>
  ): Promise<{ success: boolean; screenshotsUploaded: number; error?: string }> {
    const imageType = PLAY_DISPLAY_TYPE_TO_IMAGE_TYPE[displayType] || "phoneScreenshots"
    const playLocale = IOS_TO_ANDROID_LOCALE[locale] || locale

    try {
      const editId = await this.createEdit()
      await this.deleteAllImages(editId, playLocale, imageType)

      let successCount = 0
      for (let i = 0; i < screenshots.length; i++) {
        if (onProgress) await onProgress("uploading", i + 1, screenshots.length)
        const uploaded = await this.uploadImage(editId, playLocale, imageType, screenshots[i].data)
        if (uploaded) successCount++
      }

      if (onProgress) await onProgress("committing", screenshots.length, screenshots.length)
      await this.commitEdit(editId)

      return {
        success: successCount > 0,
        screenshotsUploaded: successCount,
        error: successCount < screenshots.length
          ? `${successCount}/${screenshots.length} screenshots uploaded`
          : undefined,
      }
    } catch (error) {
      return {
        success: false,
        screenshotsUploaded: 0,
        error: error instanceof Error ? error.message : "Unknown error",
      }
    }
  }

  // Batch upload: single edit for all locales, parallel image uploads
  // Much faster than per-locale edits (~5x speedup)
  async uploadBatch(
    tasks: Array<{
      locale: string
      displayType: string
      screenshots: Array<{ data: Buffer }>
    }>,
    onProgress?: (completedImages: number, totalImages: number, currentLocale: string) => Promise<void>
  ): Promise<{
    results: Array<{ locale: string; displayType: string; success: boolean; screenshotsUploaded: number; error?: string }>
    editId: string
  }> {
    const PARALLEL_UPLOADS = 5 // Upload 5 images concurrently
    const results: Array<{ locale: string; displayType: string; success: boolean; screenshotsUploaded: number; error?: string }> = []
    let totalUploaded = 0
    const totalImages = tasks.reduce((sum, t) => sum + t.screenshots.length, 0)

    // Single edit for everything
    const editId = await this.createEdit()

    for (const task of tasks) {
      const imageType = PLAY_DISPLAY_TYPE_TO_IMAGE_TYPE[task.displayType] || "phoneScreenshots"
      const playLocale = IOS_TO_ANDROID_LOCALE[task.locale] || task.locale

      try {
        // Delete existing images for this locale/type
        await this.deleteAllImages(editId, playLocale, imageType)

        // Upload images in parallel batches
        let taskUploaded = 0
        for (let i = 0; i < task.screenshots.length; i += PARALLEL_UPLOADS) {
          const batch = task.screenshots.slice(i, i + PARALLEL_UPLOADS)
          const uploadResults = await Promise.all(
            batch.map(s => this.uploadImage(editId, playLocale, imageType, s.data))
          )
          const batchSuccess = uploadResults.filter(Boolean).length
          taskUploaded += batchSuccess
          totalUploaded += batchSuccess

          if (onProgress) {
            await onProgress(totalUploaded, totalImages, task.locale)
          }
        }

        results.push({
          locale: task.locale,
          displayType: task.displayType,
          success: taskUploaded > 0,
          screenshotsUploaded: taskUploaded,
          error: taskUploaded < task.screenshots.length
            ? `${taskUploaded}/${task.screenshots.length} uploaded`
            : undefined,
        })
      } catch (error) {
        results.push({
          locale: task.locale,
          displayType: task.displayType,
          success: false,
          screenshotsUploaded: 0,
          error: error instanceof Error ? error.message : "Unknown error",
        })
      }
    }

    // Single commit for all locales
    await this.commitEdit(editId)

    return { results, editId }
  }
}

// ============================================================================
// Play Store Job Processor
// Simpler flow: no version management, no rate limiting concerns
// ============================================================================
async function processPlayStoreJob(
  job: PushJob,
  jobRef: DocumentReference,
  userId: string,
  projectBasePath: DocumentReference,
  accountCredentialsPath: CollectionReference
): Promise<void> {
  const functionStartTime = Date.now()

  try {
    // [1/4] Load Play Store credentials
    console.log("[1/4] Loading Play Store credentials...")
    await jobRef.update({ statusMessage: "Loading Play Store credentials..." })

    const credentialsDoc = await accountCredentialsPath.doc("playstore").get()
    if (!credentialsDoc.exists) {
      throw new Error("Play Store credentials not configured")
    }

    const encryptedCreds = credentialsDoc.data()!
    const decryptedJson = await decryptCredential(
      encryptedCreds.encryptedData,
      encryptedCreds.encryptedDek
    )
    const credentials = JSON.parse(decryptedJson)
    // Credentials are stored as { packageName, serviceAccountJson: "<json string>" }
    // Need to parse the nested serviceAccountJson string
    const serviceAccountJson = typeof credentials.serviceAccountJson === "string"
      ? JSON.parse(credentials.serviceAccountJson)
      : credentials.serviceAccountJson || credentials
    console.log("  ✓ Credentials decrypted successfully")
    console.log(`  Service account: ${serviceAccountJson.client_email || "unknown"}`)

    // Create Play Store uploader — use packageName from job.appId (set by push-job/start route)
    const uploader = new PlayStoreUploader(serviceAccountJson, job.appId)

    // [2/4] Load screenshots from Firestore
    console.log("[2/4] Loading screenshots from project...")
    await jobRef.update({ statusMessage: "Loading screenshots..." })

    const screenshotsSnapshot = await projectBasePath.collection("screenshots").get()
    const screenshotSets: { [displayType: string]: ScreenshotSet } = {}

    for (const doc of screenshotsSnapshot.docs) {
      // TODO: Re-enable feature graphic push once upload flow is verified
      if (doc.id === "PLAY_FEATURE_GRAPHIC") continue
      if (job.config.displayTypes.includes(doc.id)) {
        screenshotSets[doc.id] = doc.data() as ScreenshotSet
      }
    }

    if (Object.keys(screenshotSets).length === 0) {
      throw new Error("No screenshots to push")
    }

    console.log(`  ✓ Found ${Object.keys(screenshotSets).length} display types with screenshots`)

    // Get localized screenshots
    const localizedSnapshot = await projectBasePath.collection("localizedScreenshots").get()
    const localizedScreenshots: { [key: string]: { url: string } } = {}

    for (const doc of localizedSnapshot.docs) {
      const data = doc.data()
      localizedScreenshots[doc.id] = { url: data.marketingImageUrl }
    }

    console.log(`  ✓ Found ${localizedSnapshot.size} localized screenshots`)

    // [3/4] Build task list
    console.log("[3/4] Building upload task list...")
    await jobRef.update({ statusMessage: "Preparing uploads..." })

    interface PlayStoreTask {
      displayType: string
      locale: string
      screenshots: Screenshot[]
    }

    const tasks: PlayStoreTask[] = []
    let totalScreenshotsCount = 0

    for (const targetLocale of job.config.locales) {
      for (const [displayType, screenshotSet] of Object.entries(screenshotSets)) {
        // TODO: Re-enable feature graphic push once upload flow is verified
        if (displayType === "PLAY_FEATURE_GRAPHIC") {
          console.log(`  Skipping ${displayType} for ${targetLocale} (temporarily disabled)`)
          continue
        }
        const screenshots = screenshotSet.screenshots.map(s => {
          const localizedKey = `${displayType}_${s.id}_${targetLocale}`
          const localizedVersion = localizedScreenshots[localizedKey]
          return {
            id: s.id,
            marketingImageUrl: localizedVersion?.url || s.marketingImageUrl,
            headline: s.headline,
            position: s.position,
          }
        })

        totalScreenshotsCount += screenshots.length
        tasks.push({ displayType, locale: targetLocale, screenshots })
      }
    }

    console.log(`  ✓ Built ${tasks.length} upload tasks with ${totalScreenshotsCount} total screenshots`)

    await jobRef.update({
      progress: {
        currentScreenshots: 0,
        totalScreenshots: totalScreenshotsCount,
        currentSets: 0,
        totalSets: tasks.length,
      },
      statusMessage: `Ready to upload ${totalScreenshotsCount} screenshots (${tasks.length} sets)`,
    })

    // [4/4] Single-edit parallel upload: one edit, 3 tasks processed concurrently
    // Each task: fetch 8 images → delete old → upload 5 at a time
    // 3 tasks in parallel = ~39 tasks in 13 groups × ~27s = ~6 min (within 9 min timeout)
    console.log("[4/4] Starting single-edit parallel upload to Google Play Store...")
    await jobRef.update({
      statusMessage: `Uploading ${totalScreenshotsCount} screenshots to Google Play...`,
      progress: {
        currentScreenshots: 0,
        totalScreenshots: totalScreenshotsCount,
        currentSets: 0,
        totalSets: tasks.length,
        currentStep: "uploading",
      },
    })

    // Check for cancellation before starting
    const currentJobState = await jobRef.get()
    if (currentJobState.data()?.status === "cancelled") {
      console.log("Job cancelled by user")
      return
    }

    // Create a single edit for all locales
    const editId = await uploader.createEdit()
    console.log(`  ✓ Created edit: ${editId}`)

    const results: PushJob["results"] = []
    let completedSets = 0
    let completedScreenshots = 0
    const CONCURRENT_TASKS = 3 // Process 3 locale tasks in parallel
    const PARALLEL_UPLOADS_PER_TASK = 5 // 5 concurrent uploads within each task

    // Helper: process a single task (fetch + upload) within the shared edit
    async function processTask(task: PlayStoreTask, taskIdx: number): Promise<void> {
      const taskStartTime = Date.now()
      console.log(`\n--- Task ${taskIdx + 1}/${tasks.length}: ${task.displayType} / ${task.locale} ---`)

      try {
        // Fetch images for this task (all in parallel)
        const imageResults = await Promise.all(task.screenshots.map(async (screenshot) => {
          try {
            if (!screenshot.marketingImageUrl) {
              console.error(`  [${task.locale}] ✗ Screenshot ${screenshot.id} has no marketingImageUrl — skipping`)
              return null
            }
            console.log(`  [${task.locale}] Fetching ${screenshot.id}: ${screenshot.marketingImageUrl.slice(0, 120)}...`)
            const controller = new AbortController()
            const timeoutId = setTimeout(() => controller.abort(), 30000)
            const response = await fetch(screenshot.marketingImageUrl, { signal: controller.signal })
            clearTimeout(timeoutId)

            if (!response.ok) {
              console.error(`  [${task.locale}] ✗ Failed to fetch image: HTTP ${response.status} for ${screenshot.marketingImageUrl.slice(0, 120)}`)
              return null
            }

            const imageBuffer = Buffer.from(await response.arrayBuffer())
            // Feature graphic must be 24-bit PNG (no alpha channel) per Google Play requirements
            let pipeline = sharp(imageBuffer)
            if (task.displayType === "PLAY_FEATURE_GRAPHIC") {
              pipeline = pipeline.flatten({ background: { r: 0, g: 0, b: 0 } })
            }
            return await pipeline.png({ quality: 95 }).toBuffer()
          } catch (e) {
            if (e instanceof Error && e.name === "AbortError") {
              console.error(`  [${task.locale}] ✗ Timeout fetching image (>30s): ${screenshot.marketingImageUrl?.slice(0, 120)}`)
            } else {
              console.error(`  [${task.locale}] ✗ Error fetching image (${screenshot.marketingImageUrl?.slice(0, 120)}):`, e)
            }
            return null
          }
        }))

        const imageBuffers = imageResults.filter(
          (buffer): buffer is NonNullable<(typeof imageResults)[number]> => buffer !== null
        )

        if (imageBuffers.length === 0) {
          results.push({
            displayType: task.displayType,
            locale: task.locale,
            success: false,
            error: "No valid screenshots to upload",
            completedAt: Timestamp.now(),
          })
          completedSets++
          completedScreenshots += task.screenshots.length
          return
        }

        // Upload within the shared edit — delete old, then upload in parallel batches
        const imageType = PLAY_DISPLAY_TYPE_TO_IMAGE_TYPE[task.displayType] || "phoneScreenshots"
        const playLocale = IOS_TO_ANDROID_LOCALE[task.locale] || task.locale

        await uploader.deleteAllImages(editId, playLocale, imageType)

        let taskUploaded = 0
        for (let i = 0; i < imageBuffers.length; i += PARALLEL_UPLOADS_PER_TASK) {
          const batch = imageBuffers.slice(i, i + PARALLEL_UPLOADS_PER_TASK)
          const uploadResults = await Promise.all(
            batch.map(buf => uploader.uploadImage(editId, playLocale, imageType, buf))
          )
          taskUploaded += uploadResults.filter(Boolean).length
          completedScreenshots += batch.length
        }

        // Verify images are actually in the edit
        const verifiedCount = await uploader.verifyImages(editId, playLocale, imageType)
        const duration = ((Date.now() - taskStartTime) / 1000).toFixed(1)
        console.log(`  [${task.locale}] ✓ ${taskUploaded}/${imageBuffers.length} uploaded, verified: ${verifiedCount} in edit (${duration}s)`)

        if (verifiedCount === 0 && taskUploaded > 0) {
          console.warn(`  [${task.locale}] ⚠ WARNING: Uploaded ${taskUploaded} but verified 0 — images may not persist!`)
        }

        results.push({
          displayType: task.displayType,
          locale: task.locale,
          success: taskUploaded > 0,
          screenshotsUploaded: taskUploaded,
          ...(taskUploaded < imageBuffers.length && { error: `${taskUploaded}/${imageBuffers.length} uploaded` }),
          completedAt: Timestamp.now(),
        })
      } catch (error) {
        const duration = ((Date.now() - taskStartTime) / 1000).toFixed(1)
        console.error(`  [${task.locale}] ✗ ERROR: ${error instanceof Error ? error.message : "Unknown"} (${duration}s)`)
        results.push({
          displayType: task.displayType,
          locale: task.locale,
          success: false,
          error: error instanceof Error ? error.message : "Upload failed",
          completedAt: Timestamp.now(),
        })
        completedScreenshots += task.screenshots.length
      }

      completedSets++
    }

    // Process tasks in parallel groups of CONCURRENT_TASKS
    for (let i = 0; i < tasks.length; i += CONCURRENT_TASKS) {
      const group = tasks.slice(i, i + CONCURRENT_TASKS)
      const groupLocales = group.map(t => t.locale).join(", ")
      const pct = totalScreenshotsCount > 0
        ? Math.round((completedScreenshots / totalScreenshotsCount) * 100) : 0

      console.log(`\n=== Group ${Math.floor(i / CONCURRENT_TASKS) + 1}/${Math.ceil(tasks.length / CONCURRENT_TASKS)}: ${groupLocales} ===`)

      // Update progress
      await jobRef.update({
        progress: {
          currentScreenshots: completedScreenshots,
          totalScreenshots: totalScreenshotsCount,
          currentSets: completedSets,
          totalSets: tasks.length,
          currentLocale: groupLocales,
          currentStep: "uploading",
        },
        statusMessage: `Uploading: ${groupLocales} (${completedScreenshots}/${totalScreenshotsCount}, ${pct}%)`,
      })

      // Check for cancellation between groups
      if (i > 0 && i % (CONCURRENT_TASKS * 3) === 0) {
        const jobState = await jobRef.get()
        if (jobState.data()?.status === "cancelled") {
          console.log("Job cancelled by user")
          return
        }
      }

      // Run all tasks in this group concurrently
      await Promise.all(group.map((task, idx) => processTask(task, i + idx)))

      // Save results after each group
      const groupPct = totalScreenshotsCount > 0
        ? Math.round((completedScreenshots / totalScreenshotsCount) * 100) : 0
      await jobRef.update({
        results,
        progress: {
          currentScreenshots: completedScreenshots,
          totalScreenshots: totalScreenshotsCount,
          currentSets: completedSets,
          totalSets: tasks.length,
          currentStep: "uploading",
        },
        statusMessage: `Uploading screenshots... ${completedScreenshots}/${totalScreenshotsCount} (${groupPct}%)`,
      })
    }

    // Commit the single edit for all locales
    console.log(`\n  [COMMIT] Committing edit ${editId} with all locales...`)
    await jobRef.update({
      statusMessage: "Committing changes to Google Play...",
      progress: {
        currentScreenshots: completedScreenshots,
        totalScreenshots: totalScreenshotsCount,
        currentSets: completedSets,
        totalSets: tasks.length,
        currentStep: "committing",
      },
    })
    await uploader.commitEdit(editId)
    console.log("  ✓ Edit committed successfully")

    // Update project sync status
    const successCount = results.filter(r => r.success).length
    const failCount = results.filter(r => !r.success).length

    await projectBasePath.update({
      screenshotSyncStatus: failCount === 0 ? "synced" : "local_changes",
      lastScreenshotPushedAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    })

    // Mark completed
    const completionMessage = failCount === 0
      ? `✓ All ${totalScreenshotsCount} screenshots uploaded to Google Play`
      : `Completed with ${successCount} sets successful, ${failCount} failed`

    await jobRef.update({
      status: "completed",
      completedAt: Timestamp.now(),
      statusMessage: completionMessage,
      results,
      progress: {
        currentScreenshots: totalScreenshotsCount,
        totalScreenshots: totalScreenshotsCount,
        currentSets: tasks.length,
        totalSets: tasks.length,
      },
    })

    const stats = uploader.getStats()
    const totalDuration = ((Date.now() - functionStartTime) / 1000).toFixed(1)

    console.log(`\n╔════════════════════════════════════════════════════════════╗`)
    console.log(`║  PLAY STORE JOB COMPLETE: ${job.id}`)
    console.log(`║  Results: ${successCount} success, ${failCount} failed`)
    console.log(`║  Duration: ${totalDuration}s`)
    console.log(`║  API calls: ${stats.apiCalls}, Uploads: ${stats.uploads}, Retries: ${stats.retries}`)
    console.log(`╚════════════════════════════════════════════════════════════╝\n`)

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error"

    console.log(`\n╔════════════════════════════════════════════════════════════╗`)
    console.log(`║  PLAY STORE JOB FAILED: ${job.id}`)
    console.log(`║  Error: ${errorMessage}`)
    console.log(`╚════════════════════════════════════════════════════════════╝\n`)

    if (errorMessage === "Job cancelled") {
      await jobRef.update({ statusMessage: "Job was cancelled by user" })
      return
    }

    await jobRef.update({
      status: "failed",
      error: errorMessage,
      statusMessage: `✗ Failed: ${errorMessage}`,
      completedAt: Timestamp.now(),
    })
  }
}

// Main Cloud Function
export const processPushJob = onDocumentCreated(
  {
    document: "users/{userId}/pushJobs/{jobId}",
    timeoutSeconds: 540, // 9 minutes
    memory: "2GiB",
    maxInstances: 10,
  },
  async (event) => {
    const snapshot = event.data
    if (!snapshot) {
      console.log("No data in event")
      return
    }

    const job = snapshot.data() as PushJob
    const jobRef = snapshot.ref as DocumentReference
    const userId = event.params.userId

    console.log(`Processing push job ${job.id} for user ${userId}`)

    // Check if job was already cancelled
    const currentJob = await jobRef.get()
    if (currentJob.data()?.status === "cancelled") {
      console.log("Job was cancelled before processing started")
      return
    }

    // FAILSAFE: Prevent infinite continuation loops
    const MAX_CHAIN_LENGTH = 20 // Max ~3 hours of processing
    const MAX_TOTAL_RUNTIME_MS = 4 * 60 * 60 * 1000 // 4 hours absolute max

    // Count chain length
    let chainLength = 1
    let rootCreatedAt = job.createdAt
    let parentId: string | undefined = job.continuationOf
    while (parentId && chainLength < MAX_CHAIN_LENGTH + 5) {
      const parentDoc = await db
        .collection("users")
        .doc(userId)
        .collection("pushJobs")
        .doc(parentId)
        .get()
      if (!parentDoc.exists) break
      const parentData = parentDoc.data() as PushJob
      chainLength++
      rootCreatedAt = parentData.createdAt
      parentId = parentData.continuationOf
    }

    if (chainLength > MAX_CHAIN_LENGTH) {
      console.error(`Job ${job.id} exceeded max chain length (${chainLength}/${MAX_CHAIN_LENGTH})`)
      await jobRef.update({
        status: "failed",
        error: `Exceeded maximum continuation limit (${MAX_CHAIN_LENGTH}). Please start a new job.`,
        completedAt: Timestamp.now(),
      })
      return
    }

    const rootStartTime = rootCreatedAt instanceof Timestamp ? rootCreatedAt.toMillis() : new Date(rootCreatedAt as any).getTime()
    const totalRuntime = Date.now() - rootStartTime
    if (totalRuntime > MAX_TOTAL_RUNTIME_MS) {
      console.error(`Job ${job.id} exceeded max total runtime`)
      await jobRef.update({
        status: "failed",
        error: `Exceeded maximum total runtime (4 hours). Please start a new job.`,
        completedAt: Timestamp.now(),
      })
      return
    }

    console.log(`Job ${job.id} chain length: ${chainLength}, total runtime: ${Math.round(totalRuntime / 60000)} min`)

    // Mark as processing
    const basePath = job.orgId
      ? `organizations/${job.orgId}/projects/${job.projectId}`
      : `users/${userId}/projects/${job.projectId}`

    console.log(`\n╔════════════════════════════════════════════════════════════╗`)
    console.log(`║  PUSH JOB STARTING: ${job.id}`)
    console.log(`║  Project: ${job.projectId}`)
    console.log(`║  OrgId: ${job.orgId || "(none - user project)"}`)
    console.log(`║  Path: ${basePath}`)
    console.log(`║  Display Types: ${job.config.displayTypes.join(", ")}`)
    console.log(`║  Locales: ${job.config.locales.join(", ")}`)
    console.log(`╚════════════════════════════════════════════════════════════╝\n`)

    await jobRef.update({
      status: "processing",
      startedAt: Timestamp.now(),
      statusMessage: "Initializing...",
    })

    try {
      // Get project path
      const projectBasePath = job.orgId
        ? db.collection("organizations").doc(job.orgId).collection("projects").doc(job.projectId)
        : db.collection("users").doc(userId).collection("projects").doc(job.projectId)

      // Get credentials path
      const accountCredentialsPath = job.orgId
        ? db.collection("organizations").doc(job.orgId).collection("credentials")
        : db.collection("users").doc(userId).collection("credentials")

      // ========== PLATFORM BRANCH ==========
      // Play Store uses a much simpler upload flow
      if (job.platform === "android") {
        await processPlayStoreJob(job, jobRef, userId, projectBasePath, accountCredentialsPath)
        return
      }

      // ========== iOS / App Store Connect flow ==========
      console.log("[1/5] Loading credentials...")
      await jobRef.update({ statusMessage: "Loading credentials..." })

      const credentialsDoc = await accountCredentialsPath.doc("appstore").get()
      if (!credentialsDoc.exists) {
        throw new Error("App Store credentials not configured")
      }

      const encryptedCreds = credentialsDoc.data()!
      const decryptedJson = await decryptCredential(
        encryptedCreds.encryptedData,
        encryptedCreds.encryptedDek
      )
      const credentials = JSON.parse(decryptedJson)
      console.log("  ✓ Credentials decrypted successfully")

      // Create uploader
      const uploader = new AppStoreUploader(credentials, job.appId)
      const projectData = (await projectBasePath.get()).data()
      if (projectData?.ascMediaBackend === "library") {
        uploader.setMediaBackend("library")
        console.log("  ✓ Media backend: Asset Library (falls back to screenshot sets on error)")
      }

      // Get version info
      console.log("[2/5] Connecting to App Store Connect...")
      await jobRef.update({ statusMessage: "Connecting to App Store Connect..." })

      const versionInfo = await uploader.getLatestEditableVersion()
      if (!versionInfo) {
        throw new Error("No app store versions found")
      }

      if (!versionInfo.isEditable) {
        throw new Error(`Version ${versionInfo.versionString} is in state "${versionInfo.state}" and cannot be edited.`)
      }

      console.log(`  ✓ Connected to version ${versionInfo.versionString} (${versionInfo.state})`)

      // Update job with version info
      await jobRef.update({
        versionInfo: {
          id: versionInfo.id,
          versionString: versionInfo.versionString,
          state: versionInfo.state,
        },
        statusMessage: `Connected to version ${versionInfo.versionString}`,
      })

      // Pre-fetch locale IDs for all target locales (optimization)
      console.log("  Pre-fetching locale IDs...")
      await uploader.prefetchLocaleIds(job.config.locales)

      // Get all screenshot sets
      console.log("[3/5] Loading screenshots from project...")
      await jobRef.update({ statusMessage: "Loading screenshots..." })

      const screenshotsSnapshot = await projectBasePath.collection("screenshots").get()
      const screenshotSets: { [displayType: string]: ScreenshotSet } = {}

      for (const doc of screenshotsSnapshot.docs) {
        if (job.config.displayTypes.includes(doc.id)) {
          screenshotSets[doc.id] = doc.data() as ScreenshotSet
        }
      }

      if (Object.keys(screenshotSets).length === 0) {
        throw new Error("No screenshots to push")
      }

      console.log(`  ✓ Found ${Object.keys(screenshotSets).length} display types with screenshots`)

      // One App Store slot per device type, so two of ours never overwrite each other
      const slotAssignment = assignAscSlots(
        Object.entries(screenshotSets)
          .filter(([, set]) => (set.screenshots?.length || 0) > 0)
          .map(([displayType]) => displayType)
      )
      for (const skip of slotAssignment.skipped) {
        console.log(`  ⚠ Skipping ${skip.displayType}: App Store slot ${skip.ascDisplayType} is already used by ${skip.keptDisplayType}`)
      }
      if (slotAssignment.skipped.length > 0) {
        await jobRef.update({ skippedDisplayTypes: slotAssignment.skipped })
      }

      // Get localized screenshots
      const localizedSnapshot = await projectBasePath.collection("localizedScreenshots").get()
      const localizedScreenshots: { [key: string]: { url: string } } = {}

      for (const doc of localizedSnapshot.docs) {
        const data = doc.data()
        localizedScreenshots[doc.id] = { url: data.marketingImageUrl }
      }

      console.log(`  ✓ Found ${localizedSnapshot.size} localized screenshots`)

      // Debug: show sample of localized screenshot keys
      const localizedKeys = Object.keys(localizedScreenshots)
      if (localizedKeys.length > 0) {
        console.log(`    Sample keys: ${localizedKeys.slice(0, 5).join(", ")}${localizedKeys.length > 5 ? "..." : ""}`)
      }

      // Build task list
      console.log("[4/5] Building upload task list...")
      await jobRef.update({ statusMessage: "Preparing uploads..." })

      const tasks: UploadTask[] = []
      let totalScreenshotsCount = 0
      let localizedCount = 0
      let fallbackCount = 0

      // Build tasks locale-first: complete all device types for one locale before moving to next
      // This ensures each language gets fully uploaded before starting the next
      for (const targetLocale of job.config.locales) {
        for (const [displayType, screenshotSet] of Object.entries(screenshotSets)) {
          const ascDisplayType = slotAssignment.slots[displayType]
          if (!ascDisplayType) continue

          const screenshots = sortByPosition(screenshotSet.screenshots).map(s => {
            const localizedKey = `${displayType}_${s.id}_${targetLocale}`
            const localizedVersion = localizedScreenshots[localizedKey]
            if (localizedVersion?.url) {
              localizedCount++
            } else {
              fallbackCount++
              // Debug: log first few missing localizations
              if (fallbackCount <= 3) {
                console.log(`    ⚠ Missing localized version for key: ${localizedKey}`)
              }
            }
            return {
              id: s.id,
              marketingImageUrl: localizedVersion?.url || s.marketingImageUrl,
              headline: s.headline,
              position: s.position,
            }
          })

          totalScreenshotsCount += screenshots.length

          tasks.push({
            displayType,
            locale: targetLocale,
            screenshots,
            ascDisplayType,
            index: tasks.length,
          })
        }
      }

      // Update totals - now tracking both sets AND total screenshots
      console.log(`  ✓ Built ${tasks.length} upload tasks with ${totalScreenshotsCount} total screenshots`)
      console.log(`    ↳ Localized versions found: ${localizedCount}, using fallback (primary): ${fallbackCount}`)

      await jobRef.update({
        progress: {
          currentScreenshots: 0,
          totalScreenshots: totalScreenshotsCount,
          currentSets: 0,
          totalSets: tasks.length,
        },
        statusMessage: `Ready to upload ${totalScreenshotsCount} screenshots (${tasks.length} sets)`,
      })

      if (tasks.length === 0) {
        await jobRef.update({
          status: "completed",
          statusMessage: "No tasks to process",
          completedAt: Timestamp.now(),
        })
        return
      }

      console.log("[5/5] Starting uploads to App Store Connect...")

      // Resume support
      const startIndex = job.lastProcessedIndex || 0
      const remainingTasks = tasks.slice(startIndex)

      // Check if there are failed tasks from parent job to retry
      if (job.failedTasksToRetry && job.failedTasksToRetry.length > 0) {
        console.log(`\n  ⚠ Found ${job.failedTasksToRetry.length} failed tasks from parent job to retry`)

        // Rebuild the failed tasks from the stored data
        for (const failedTaskInfo of job.failedTasksToRetry) {
          // Find the screenshot set for this display type
          const screenshotSet = screenshotSets[failedTaskInfo.displayType]
          if (!screenshotSet) {
            console.log(`    ✗ Could not find screenshot set for ${failedTaskInfo.displayType}`)
            continue
          }

          // Get screenshots for this task
          const screenshots = sortByPosition(screenshotSet.screenshots)
            .filter(s => failedTaskInfo.screenshotIds.includes(s.id))
            .map(s => {
              const localizedKey = `${failedTaskInfo.displayType}_${s.id}_${failedTaskInfo.locale}`
              const localizedVersion = localizedScreenshots[localizedKey]
              return {
                id: s.id,
                marketingImageUrl: localizedVersion?.url || s.marketingImageUrl,
                headline: s.headline,
                position: s.position,
              }
            })

          const ascDisplayType = slotAssignment.slots[failedTaskInfo.displayType]
          if (screenshots.length > 0 && ascDisplayType) {
            // Add to the FRONT of remaining tasks so they're retried first
            remainingTasks.unshift({
              displayType: failedTaskInfo.displayType,
              locale: failedTaskInfo.locale,
              screenshots,
              ascDisplayType,
              index: -1, // Mark as retry task
            })
            console.log(`    ✓ Queued retry: ${failedTaskInfo.displayType} / ${failedTaskInfo.locale} (${screenshots.length} screenshots)`)
          }
        }
      }

      // Timeout management - more aggressive to ensure continuation jobs are created
      const functionStartTime = Date.now()
      const TIMEOUT_WARNING_MS = 6 * 60 * 1000  // Reduced from 8 to 6 minutes for safety margin
      const TIMEOUT_CRITICAL_MS = 7.5 * 60 * 1000 // Hard stop - must create continuation NOW
      const isApproachingTimeout = () => Date.now() - functionStartTime > TIMEOUT_WARNING_MS
      const isCriticalTimeout = () => Date.now() - functionStartTime > TIMEOUT_CRITICAL_MS

      // Adaptive batch processing
      let currentBatchSize = RATE_LIMIT_CONFIG.initialBatchSize
      const results: PushJob["results"] = []
      let completedSets = startIndex
      let completedScreenshots = 0 // Track total screenshots uploaded
      const progressBuffer: PushJob["results"] = []

      // Track failed tasks for retry
      const failedTasks: UploadTask[] = []
      const MAX_TASK_RETRIES = 3 // Maximum retries per failed task

      // Calculate screenshots already completed from previous runs (for continuation jobs)
      if (startIndex > 0) {
        for (let i = 0; i < startIndex; i++) {
          completedScreenshots += tasks[i].screenshots.length
        }
      }

      const flushProgress = async (currentTask?: {
        displayType: string
        locale: string
        step?: "fetching" | "uploading" | "committing"
        screenshotInSet?: number       // Current screenshot within the set (1-based)
        screenshotsInSet?: number      // Total screenshots in this set
      }) => {
        const currentState = await jobRef.get()
        if (currentState.data()?.status === "cancelled") {
          throw new Error("Job cancelled")
        }

        // Calculate current screenshot progress
        let currentScreenshotProgress = completedScreenshots
        if (currentTask?.screenshotInSet && currentTask.screenshotsInSet) {
          // Add partial progress from current set
          currentScreenshotProgress += currentTask.screenshotInSet
        }

        // Build a human-readable status message
        const pct = totalScreenshotsCount > 0 ? Math.round((currentScreenshotProgress / totalScreenshotsCount) * 100) : 0
        let statusMessage = `Uploading ${currentScreenshotProgress}/${totalScreenshotsCount} screenshots (${pct}%)`

        if (currentTask) {
          const deviceName = currentTask.displayType.replace("APP_", "").replace(/_/g, " ")
          const stepLabel = currentTask.step === "fetching" ? "Downloading" :
                           currentTask.step === "uploading" ? "Uploading" :
                           currentTask.step === "committing" ? "Finalizing" : "Processing"

          if (currentTask.screenshotInSet && currentTask.screenshotsInSet) {
            statusMessage = `${stepLabel} ${deviceName} (${currentTask.locale}) - Screenshot ${currentTask.screenshotInSet}/${currentTask.screenshotsInSet} | ${currentScreenshotProgress}/${totalScreenshotsCount} total (${pct}%)`
          } else {
            statusMessage = `${stepLabel} ${deviceName} (${currentTask.locale}) | ${currentScreenshotProgress}/${totalScreenshotsCount} total (${pct}%)`
          }
        }

        const updateData: Record<string, unknown> = {
          progress: {
            currentScreenshots: currentScreenshotProgress,
            totalScreenshots: totalScreenshotsCount,
            currentSets: completedSets,
            totalSets: tasks.length,
            ...(currentTask && { currentDisplayType: currentTask.displayType }),
            ...(currentTask && { currentLocale: currentTask.locale }),
            ...(currentTask?.step && { currentStep: currentTask.step }),
          },
          lastProcessedIndex: completedSets,
          statusMessage,
        }

        if (progressBuffer.length > 0) {
          updateData.results = FieldValue.arrayUnion(...progressBuffer)
          progressBuffer.length = 0
        }

        await jobRef.update(updateData)
      }

      // Process in batches
      console.log(`Starting batch processing: ${remainingTasks.length} tasks remaining, batch size: ${currentBatchSize}`)

      // Helper to create continuation job - extracted so we can call it from multiple places
      const createContinuationJob = async (reason: string) => {
        console.log(`\n╔════════════════════════════════════════════════════════════╗`)
        console.log(`║  CREATING CONTINUATION JOB: ${reason}`)
        console.log(`╚════════════════════════════════════════════════════════════╝`)

        await flushProgress()

        const continuationJobRef = db
          .collection("users")
          .doc(userId)
          .collection("pushJobs")
          .doc()

        const rootJobId = job.rootJobId || job.id

        // Calculate remaining screenshots
        let remainingScreenshots = 0
        for (let idx = completedSets; idx < tasks.length; idx++) {
          remainingScreenshots += tasks[idx].screenshots.length
        }
        for (const ft of failedTasks) {
          remainingScreenshots += ft.screenshots.length
        }

        // Serialize failed tasks
        const failedTasksToRetry = failedTasks.map(ft => ({
          displayType: ft.displayType,
          locale: ft.locale,
          screenshotIds: ft.screenshots.map(s => s.id),
        }))

        if (failedTasks.length > 0) {
          console.log(`Passing ${failedTasks.length} failed tasks to continuation job for retry`)
        }

        const continuationJob: PushJob = {
          id: continuationJobRef.id,
          userId,
          ...(job.orgId ? { orgId: job.orgId } : {}),
          projectId: job.projectId,
          appId: job.appId,
          platform: job.platform || "ios",
          status: "pending",
          config: job.config,
          progress: {
            currentScreenshots: 0,
            totalScreenshots: remainingScreenshots,
            currentSets: 0,
            totalSets: tasks.length - completedSets + failedTasks.length,
          },
          results: [],
          ...(job.versionInfo ? { versionInfo: job.versionInfo } : {}),
          createdAt: Timestamp.now(),
          retryCount: 0,
          lastProcessedIndex: completedSets,
          continuationOf: job.id,
          rootJobId,
          chainIndex: chainLength + 1,
          ...(failedTasksToRetry.length > 0 ? { failedTasksToRetry } : {}),
        }

        await continuationJobRef.set(continuationJob)

        await jobRef.update({
          ...uploader.mediaReport(),
          status: "completed",
          continuedBy: continuationJobRef.id,
          completedAt: Timestamp.now(),
          statusMessage: `Continued in job ${continuationJobRef.id}`,
        })

        const stats = uploader.getStats()
        console.log(`Job ${job.id} stats: API calls: ${stats.apiCalls}, S3 uploads: ${stats.s3Uploads}, Cache hits: ${stats.cacheHits}, Retries: ${stats.retries}`)
        console.log(`Job ${job.id} handed off to continuation job ${continuationJobRef.id}`)

        return continuationJobRef.id
      }

      for (let i = 0; i < remainingTasks.length; i += currentBatchSize) {
        // CRITICAL: Check timeout BEFORE starting each batch
        if (isCriticalTimeout()) {
          console.log(`\n⚠️ CRITICAL TIMEOUT before batch - must create continuation NOW`)
          await createContinuationJob("Critical timeout before batch")
          return
        }

        const batch = remainingTasks.slice(i, i + currentBatchSize)
        const batchNumber = Math.floor(i / currentBatchSize) + 1
        const totalBatches = Math.ceil(remainingTasks.length / currentBatchSize)

        console.log(`\n========== BATCH ${batchNumber}/${totalBatches} ==========`)
        console.log(`Processing ${batch.length} tasks (items ${completedSets + 1} to ${completedSets + batch.length} of ${tasks.length})`)
        console.log(`Elapsed time: ${Math.round((Date.now() - functionStartTime) / 1000)}s`)
        console.log(`Tasks in this batch:`)
        batch.forEach((t, idx) => console.log(`  ${idx + 1}. ${t.displayType} / ${t.locale} (${t.screenshots.length} screenshots)`))

        // Update progress with batch info before starting
        await flushProgress(batch[0])

        // Check circuit breaker before starting batch - fail fast if API is down
        if (uploader.isCircuitBreakerOpen()) {
          console.log(`Circuit breaker is OPEN - skipping batch ${batchNumber} and waiting for recovery`)
          // Wait for circuit breaker to reset before continuing
          await sleep(RATE_LIMIT_CONFIG.circuitBreakerResetMs)
        }

        const batchResults = await Promise.allSettled(
          batch.map(async (task, taskIndex) => {
            const taskStartTime = Date.now()
            console.log(`\n--- Task ${taskIndex + 1}/${batch.length}: ${task.displayType} / ${task.locale} ---`)
            console.log(`  Starting: ${task.screenshots.length} screenshots to process`)

            // FAIL FAST: Check circuit breaker at task start - if open, fail immediately
            // This prevents multiple tasks in a batch from all retrying when API is down
            try {
              uploader.checkCircuitBreakerOrThrow()
            } catch (cbError) {
              console.log(`  ✗ Task skipped: ${cbError instanceof Error ? cbError.message : 'Circuit breaker open'}`)
              return {
                displayType: task.displayType,
                locale: task.locale,
                success: false,
                error: cbError instanceof Error ? cbError.message : 'Circuit breaker open',
                completedAt: Timestamp.now(),
              }
            }

            // Helper to update progress for this task (only first task in batch updates to avoid conflicts)
            const updateTaskProgress = async (
              step: "fetching" | "uploading" | "committing",
              screenshotInSet: number,
              screenshotsInSet: number
            ) => {
              // Only the first task in the batch updates progress to avoid conflicts
              if (taskIndex === 0) {
                await flushProgress({
                  displayType: task.displayType,
                  locale: task.locale,
                  step,
                  screenshotInSet,
                  screenshotsInSet,
                })
              }
            }

            try {
              // Fetch all screenshots from R2 in PARALLEL and ensure correct dimensions
              const screenshotsToUpload: Array<{ fileName: string; data: Buffer; checksum: string }> = []

              console.log(`  [FETCH] Loading ${task.screenshots.length} images from storage (parallel)...`)
              const fetchStartTime = Date.now()

              // Helper: fetch with timeout to prevent hanging
              const fetchWithTimeout = async (url: string, timeoutMs: number = 30000): Promise<Response> => {
                const controller = new AbortController()
                const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
                try {
                  const response = await fetch(url, { signal: controller.signal })
                  clearTimeout(timeoutId)
                  return response
                } catch (error) {
                  clearTimeout(timeoutId)
                  throw error
                }
              }

              // Log first image URL to help debug localized vs primary
              if (task.screenshots.length > 0) {
                const firstUrl = task.screenshots[0].marketingImageUrl
                const isLocalized = firstUrl.includes('/translated-') || firstUrl.includes(`-${task.locale}-`)
                console.log(`    Source: ${isLocalized ? 'LOCALIZED' : 'PRIMARY'} (${firstUrl.substring(0, 80)}...)`)
              }

              // Parallel fetch with timeout per image (30s max per image)
              const fetchPromises = task.screenshots.map(async (screenshot, imgIdx) => {
                try {
                  // Check critical timeout before each fetch
                  if (isCriticalTimeout()) {
                    console.log(`    ⚠ Critical timeout - skipping remaining fetches`)
                    return null
                  }

                  const response = await fetchWithTimeout(screenshot.marketingImageUrl, 30000)
                  if (!response.ok) {
                    console.error(`    ✗ Failed to fetch image ${imgIdx + 1}: HTTP ${response.status}`)
                    return null
                  }

                  const rawImageBuffer = Buffer.from(await response.arrayBuffer())

                  // Log raw image details for first image only
                  if (imgIdx === 0) {
                    try {
                      const rawMeta = await sharp(rawImageBuffer).metadata()
                      console.log(`    ↳ Raw image: ${rawMeta.width}x${rawMeta.height}, format=${rawMeta.format}, size=${rawImageBuffer.length}`)
                    } catch (metaErr) {
                      console.log(`    ⚠ Could not read raw image metadata: ${metaErr}`)
                    }
                  }

                  // Ensure image has exact App Store dimensions (resize if needed)
                  // Use ascDisplayType (the mapped ASC type) to get correct dimensions
                  const imageBuffer = await ensureAppStoreDimensions(rawImageBuffer, task.ascDisplayType)

                  // Verify final dimensions for first image
                  if (imgIdx === 0) {
                    try {
                      const finalMeta = await sharp(imageBuffer).metadata()
                      const expected = DISPLAY_TYPE_DIMENSIONS[task.ascDisplayType]
                      console.log(`    ↳ Final image: ${finalMeta.width}x${finalMeta.height}, format=${finalMeta.format}, size=${imageBuffer.length}, ascType=${task.ascDisplayType}`)
                      const accepted = slotAcceptsSize(task.ascDisplayType, finalMeta.width || 0, finalMeta.height || 0)
                      if (expected && !accepted && (finalMeta.width !== expected.width || finalMeta.height !== expected.height)) {
                        console.log(`    ⚠ DIMENSION MISMATCH! Expected ${expected.width}x${expected.height} for ${task.ascDisplayType}`)
                      }
                    } catch (metaErr) {
                      console.log(`    ⚠ Could not read final image metadata: ${metaErr}`)
                    }
                  }

                  // Pre-compute MD5 checksum after any resizing
                  const checksum = crypto.createHash("md5").update(imageBuffer).digest("hex")

                  return {
                    fileName: `screenshot-${screenshot.position + 1}.jpg`,
                    data: imageBuffer,
                    checksum,
                    position: screenshot.position,
                    size: imageBuffer.length,
                  }
                } catch (e) {
                  if (e instanceof Error && e.name === 'AbortError') {
                    console.error(`    ✗ Timeout fetching image ${imgIdx + 1} (>30s)`)
                  } else {
                    console.error(`    ✗ Error fetching image ${imgIdx + 1}:`, e)
                  }
                  return null
                }
              })

              // Execute parallel fetches
              const fetchResults = await Promise.all(fetchPromises)

              // Sort by position and filter nulls
              const validResults = fetchResults
                .filter((r): r is NonNullable<typeof r> => r !== null)
                .sort((a, b) => a.position - b.position)

              for (const result of validResults) {
                screenshotsToUpload.push({
                  fileName: result.fileName,
                  data: result.data,
                  checksum: result.checksum,
                })
              }

              const fetchDuration = ((Date.now() - fetchStartTime) / 1000).toFixed(1)
              console.log(`    ✓ Fetched ${screenshotsToUpload.length}/${task.screenshots.length} images in ${fetchDuration}s`)

              if (screenshotsToUpload.length === 0) {
                console.log(`  ✗ No valid screenshots to upload`)
                return {
                  displayType: task.displayType,
                  locale: task.locale,
                  success: false,
                  error: "No valid screenshots to upload",
                  completedAt: Timestamp.now(),
                }
              }

              // Upload to App Store Connect
              console.log(`  [UPLOAD] Uploading ${screenshotsToUpload.length} screenshots to App Store Connect...`)
              console.log(`    Display type: ${task.ascDisplayType}, Locale: ${task.locale}`)

              const uploadResult = await uploader.uploadScreenshots(
                task.locale,
                screenshotsToUpload,
                task.ascDisplayType,
                // Progress callback for individual screenshot uploads
                async (step, current, total) => {
                  await updateTaskProgress(step, current, total)
                }
              )

              const duration = ((Date.now() - taskStartTime) / 1000).toFixed(1)
              if (uploadResult.success) {
                console.log(`  ✓ SUCCESS: ${uploadResult.screenshotsUploaded} screenshots uploaded (${duration}s)`)
              } else {
                console.log(`  ✗ FAILED: ${uploadResult.error} (${duration}s)`)
              }

              return {
                displayType: task.displayType,
                locale: task.locale,
                success: uploadResult.success,
                ...(uploadResult.screenshotsUploaded !== undefined && { screenshotsUploaded: uploadResult.screenshotsUploaded }),
                ...(uploadResult.error !== undefined && { error: uploadResult.error }),
                completedAt: Timestamp.now(),
              }
            } catch (error) {
              const duration = ((Date.now() - taskStartTime) / 1000).toFixed(1)
              console.error(`  ✗ ERROR: ${error instanceof Error ? error.message : "Unknown error"} (${duration}s)`)
              return {
                displayType: task.displayType,
                locale: task.locale,
                success: false,
                error: error instanceof Error ? error.message : "Upload failed",
                completedAt: Timestamp.now(),
              }
            }
          })
        )

        // Process batch results
        console.log(`\n--- Batch ${batchNumber} Results ---`)
        let rateLimited = false
        let batchSuccessCount = 0
        let batchFailCount = 0
        let batchScreenshotsUploaded = 0

        for (let batchResultIdx = 0; batchResultIdx < batchResults.length; batchResultIdx++) {
          const result = batchResults[batchResultIdx]
          const task = batch[batchResultIdx]
          completedSets++
          // Add screenshots from this task to the completed count
          completedScreenshots += task.screenshots.length

          if (result.status === "fulfilled") {
            if (result.value.success) {
              batchSuccessCount++
              batchScreenshotsUploaded += result.value.screenshotsUploaded || 0
              progressBuffer.push(result.value)
              results.push(result.value)
            } else {
              batchFailCount++
              // Track failed task for retry (don't add to results yet)
              failedTasks.push(task)
              console.log(`  → Queued for retry: ${task.displayType} / ${task.locale} (${result.value.error})`)
              if (result.value.error?.includes("429") || result.value.error?.includes("rate limit")) {
                rateLimited = true
              }
            }
          } else {
            batchFailCount++
            const errorMsg = result.reason?.message || "Unknown error"
            if (errorMsg.includes("429") || errorMsg.includes("rate limit")) {
              rateLimited = true
            }
            // Track failed task for retry (don't add to results yet)
            failedTasks.push(task)
            console.log(`  → Queued for retry: ${task.displayType} / ${task.locale} (${errorMsg})`)
          }
        }

        console.log(`Batch ${batchNumber} complete: ${batchSuccessCount} success, ${batchFailCount} failed, ${batchScreenshotsUploaded} screenshots uploaded`)
        console.log(`Overall progress: ${completedSets}/${tasks.length} sets (${Math.round(completedSets / tasks.length * 100)}%), ${completedScreenshots}/${totalScreenshotsCount} screenshots`)

        // Adjust batch size based on results
        if (rateLimited) {
          const oldBatchSize = currentBatchSize
          currentBatchSize = Math.max(RATE_LIMIT_CONFIG.minBatchSize, Math.floor(currentBatchSize / 2))
          console.log(`Rate limit detected. Reducing batch size: ${oldBatchSize} -> ${currentBatchSize}`)
          // Circuit breaker and token bucket handle delays, just a brief pause here
          await sleep(2000)
        } else if (batchFailCount === 0 && batchSuccessCount > 0) {
          // All succeeded - try increasing batch size
          const oldBatchSize = currentBatchSize
          currentBatchSize = Math.min(RATE_LIMIT_CONFIG.maxBatchSize, currentBatchSize + 1)
          if (currentBatchSize > oldBatchSize) {
            console.log(`All succeeded. Increasing batch size: ${oldBatchSize} -> ${currentBatchSize}`)
          }
        }

        // Always flush progress after each batch for better UI feedback
        await flushProgress()

        // Check for approaching timeout - use helper function
        if (isApproachingTimeout() && i + currentBatchSize < remainingTasks.length) {
          await createContinuationJob("Approaching timeout after batch")
          return
        }

        // Minimal delay between batches (token bucket handles rate limiting)
        if (i + currentBatchSize < remainingTasks.length) {
          await sleep(100)
        }
      }

      // ============ RETRY FAILED TASKS ============
      // Retry any tasks that failed during the main processing loop
      let retryRound = 0
      while (failedTasks.length > 0 && retryRound < MAX_TASK_RETRIES) {
        retryRound++
        console.log(`\n╔════════════════════════════════════════════════════════════╗`)
        console.log(`║  RETRY ROUND ${retryRound}/${MAX_TASK_RETRIES}: ${failedTasks.length} failed tasks`)
        console.log(`╚════════════════════════════════════════════════════════════╝`)

        // Check timeout before starting retry round
        if (isApproachingTimeout()) {
          console.log(`Approaching timeout - deferring ${failedTasks.length} failed tasks to continuation job`)
          break
        }

        // Wait before retrying to let API recover
        const retryDelay = Math.min(30000 * retryRound, 90000) // 30s, 60s, 90s
        console.log(`Waiting ${retryDelay / 1000}s before retry round ${retryRound}...`)
        await jobRef.update({
          statusMessage: `Waiting ${retryDelay / 1000}s before retrying ${failedTasks.length} failed tasks (round ${retryRound}/${MAX_TASK_RETRIES})...`,
        })
        await sleep(retryDelay)

        // Process failed tasks one at a time for maximum reliability
        const tasksToRetry = [...failedTasks]
        failedTasks.length = 0 // Clear the array

        for (let retryIdx = 0; retryIdx < tasksToRetry.length; retryIdx++) {
          const task = tasksToRetry[retryIdx]

          // Check timeout before each task
          if (isApproachingTimeout()) {
            console.log(`Approaching timeout - re-queuing ${tasksToRetry.length - retryIdx} remaining tasks`)
            failedTasks.push(...tasksToRetry.slice(retryIdx))
            break
          }

          console.log(`\n--- Retry ${retryIdx + 1}/${tasksToRetry.length}: ${task.displayType} / ${task.locale} ---`)

          await jobRef.update({
            statusMessage: `Retrying ${task.displayType} / ${task.locale} (${retryIdx + 1}/${tasksToRetry.length}, round ${retryRound})`,
          })

          // Check circuit breaker - wait if open
          if (uploader.isCircuitBreakerOpen()) {
            console.log(`Circuit breaker OPEN - waiting for recovery before retry`)
            await sleep(RATE_LIMIT_CONFIG.circuitBreakerResetMs)
          }

          try {
            // Fetch screenshots
            console.log(`  [FETCH] Loading ${task.screenshots.length} images...`)
            const screenshotsToUpload: Array<{ fileName: string; data: Buffer; checksum: string }> = []

            for (const screenshot of task.screenshots) {
              try {
                const response = await fetch(screenshot.marketingImageUrl)
                if (!response.ok) continue

                const rawImageBuffer = Buffer.from(await response.arrayBuffer())
                // Use ascDisplayType (the mapped ASC type) for correct dimensions
                const imageBuffer = await ensureAppStoreDimensions(rawImageBuffer, task.ascDisplayType)
                const checksum = crypto.createHash("md5").update(imageBuffer).digest("hex")

                screenshotsToUpload.push({
                  fileName: `screenshot-${screenshot.position + 1}.jpg`,
                  data: imageBuffer,
                  checksum,
                })
              } catch (e) {
                console.error(`    ✗ Failed to fetch image: ${e}`)
              }
            }

            if (screenshotsToUpload.length === 0) {
              console.log(`  ✗ No valid screenshots - re-queuing for next round`)
              failedTasks.push(task)
              continue
            }

            // Upload to App Store Connect
            console.log(`  [UPLOAD] Uploading ${screenshotsToUpload.length} screenshots...`)
            const uploadResult = await uploader.uploadScreenshots(
              task.locale,
              screenshotsToUpload,
              task.ascDisplayType
            )

            if (uploadResult.success) {
              console.log(`  ✓ RETRY SUCCESS: ${uploadResult.screenshotsUploaded} screenshots uploaded`)
              progressBuffer.push({
                displayType: task.displayType,
                locale: task.locale,
                success: true,
                screenshotsUploaded: uploadResult.screenshotsUploaded,
                completedAt: Timestamp.now(),
              })
              results.push({
                displayType: task.displayType,
                locale: task.locale,
                success: true,
                screenshotsUploaded: uploadResult.screenshotsUploaded,
                completedAt: Timestamp.now(),
              })
            } else {
              console.log(`  ✗ RETRY FAILED: ${uploadResult.error}`)
              failedTasks.push(task)
            }
          } catch (error) {
            console.error(`  ✗ RETRY ERROR: ${error instanceof Error ? error.message : 'Unknown'}`)
            failedTasks.push(task)
          }

          // Flush progress after each retry
          await flushProgress()

          // Small delay between retries
          await sleep(500)
        }
      }

      // Handle any remaining failed tasks
      if (failedTasks.length > 0) {
        // If we're approaching/past timeout, create continuation job to retry failed tasks
        if (isApproachingTimeout() || isCriticalTimeout()) {
          console.log(`\n⚠ ${failedTasks.length} tasks failed - creating continuation job for retry (timeout approaching)`)
          await createContinuationJob(`Timeout with ${failedTasks.length} failed tasks to retry`)
          return
        }

        // Otherwise mark them as permanently failed
        console.log(`\n⚠ ${failedTasks.length} tasks failed after ${MAX_TASK_RETRIES} retry rounds`)
        for (const task of failedTasks) {
          progressBuffer.push({
            displayType: task.displayType,
            locale: task.locale,
            success: false,
            error: `Failed after ${MAX_TASK_RETRIES} retry attempts`,
            completedAt: Timestamp.now(),
          })
          results.push({
            displayType: task.displayType,
            locale: task.locale,
            success: false,
            error: `Failed after ${MAX_TASK_RETRIES} retry attempts`,
            completedAt: Timestamp.now(),
          })
        }
      }

      // Final flush
      await flushProgress()

      // Update project sync status
      const successCount = results.filter(r => r.success).length
      const failCount = results.filter(r => !r.success).length

      await projectBasePath.update({
        screenshotSyncStatus: failCount === 0 ? "synced" : "local_changes",
        lastScreenshotPushedAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      })

      // Mark completed
      const completionMessage = failCount === 0
        ? `✓ All ${totalScreenshotsCount} screenshots uploaded successfully`
        : `Completed with ${successCount} sets successful, ${failCount} failed`

      await jobRef.update({
        ...uploader.mediaReport(),
        status: "completed",
        completedAt: Timestamp.now(),
        statusMessage: completionMessage,
        progress: {
          currentScreenshots: totalScreenshotsCount,
          totalScreenshots: totalScreenshotsCount,
          currentSets: tasks.length,
          totalSets: tasks.length,
        },
      })

      // Log performance stats
      const stats = uploader.getStats()
      const totalDuration = ((Date.now() - functionStartTime) / 1000).toFixed(1)

      console.log(`\n╔════════════════════════════════════════════════════════════╗`)
      console.log(`║  JOB COMPLETE: ${job.id}`)
      console.log(`║  Results: ${successCount} success, ${failCount} failed`)
      console.log(`║  Duration: ${totalDuration}s`)
      console.log(`║  Performance Stats:`)
      console.log(`║    - API calls: ${stats.apiCalls}`)
      console.log(`║    - S3 uploads: ${stats.s3Uploads}`)
      console.log(`║    - Cache hits: ${stats.cacheHits}`)
      console.log(`║    - Retries: ${stats.retries}`)
      console.log(`║  Rate Limiter:`)
      console.log(`║    - Final rate: ${stats.rateLimiter.tokensPerSecond.toFixed(2)} req/s`)
      console.log(`║    - Apple quota remaining: ${stats.rateLimiter.appleQuota ?? 'unknown'}`)
      console.log(`╚════════════════════════════════════════════════════════════╝\n`)
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error"

      console.log(`\n╔════════════════════════════════════════════════════════════╗`)
      console.log(`║  JOB FAILED: ${job.id}`)
      console.log(`║  Error: ${errorMessage}`)
      console.log(`╚════════════════════════════════════════════════════════════╝\n`)

      if (errorMessage === "Job cancelled") {
        await jobRef.update({
          statusMessage: "Job was cancelled by user",
        })
        return
      }

      // Check if we should auto-retry
      const currentRetryCount = job.retryCount || 0
      const isRetryableError = errorMessage.includes("Circuit breaker") ||
                               errorMessage.includes("500") ||
                               errorMessage.includes("rate limit") ||
                               errorMessage.includes("Max retries exceeded")

      if (isRetryableError && currentRetryCount < RATE_LIMIT_CONFIG.maxAutoRetries) {
        // Mark current job as failed but note that retry is scheduled
        await jobRef.update({
          status: "failed",
          error: errorMessage,
          statusMessage: `✗ Failed: ${errorMessage}. Auto-retry scheduled (${currentRetryCount + 1}/${RATE_LIMIT_CONFIG.maxAutoRetries})`,
          completedAt: Timestamp.now(),
        })

        // Wait before creating retry job to give API time to recover
        const delayMinutes = Math.min(5 * (currentRetryCount + 1), 15) // 5, 10, 15 minutes
        console.log(`Scheduling auto-retry in ${delayMinutes} minutes (retry ${currentRetryCount + 1}/${RATE_LIMIT_CONFIG.maxAutoRetries})`)

        await sleep(delayMinutes * 60 * 1000)

        // Check if job was cancelled during the wait
        const currentJobState = await jobRef.get()
        if (currentJobState.data()?.status === "cancelled") {
          console.log("Job was cancelled during retry wait - aborting auto-retry")
          return
        }

        // Create retry job
        const retryJobRef = db
          .collection("users")
          .doc(userId)
          .collection("pushJobs")
          .doc()

        const retryJob: PushJob = {
          id: retryJobRef.id,
          userId,
          ...(job.orgId ? { orgId: job.orgId } : {}),
          projectId: job.projectId,
          appId: job.appId,
          platform: job.platform || "ios",
          status: "pending",
          statusMessage: `Auto-retry ${currentRetryCount + 1}/${RATE_LIMIT_CONFIG.maxAutoRetries} after: ${errorMessage}`,
          config: job.config,
          progress: {
            currentScreenshots: 0,
            totalScreenshots: 0,
            currentSets: 0,
            totalSets: 0,
          },
          results: [],
          ...(job.versionInfo ? { versionInfo: job.versionInfo } : {}),
          createdAt: Timestamp.now(),
          retryCount: currentRetryCount + 1,
          continuationOf: job.id,
          rootJobId: job.rootJobId || job.id,
        }

        await retryJobRef.set(retryJob)

        // Update original job to point to retry
        await jobRef.update({
          continuedBy: retryJobRef.id,
          statusMessage: `✗ Failed: ${errorMessage}. Auto-retry started.`,
        })

        console.log(`Auto-retry job created: ${retryJobRef.id}`)
      } else {
        // No more retries - mark as permanently failed
        const failMessage = currentRetryCount >= RATE_LIMIT_CONFIG.maxAutoRetries
          ? `✗ Failed after ${currentRetryCount} retries: ${errorMessage}`
          : `✗ Failed: ${errorMessage}`

        await jobRef.update({
          status: "failed",
          error: errorMessage,
          statusMessage: failMessage,
          completedAt: Timestamp.now(),
        })

        if (currentRetryCount >= RATE_LIMIT_CONFIG.maxAutoRetries) {
          console.log(`Job exhausted all ${RATE_LIMIT_CONFIG.maxAutoRetries} auto-retries`)
        }
      }
    }
  }
)
