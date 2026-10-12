import { onDocumentCreated } from "firebase-functions/v2/firestore"
import { getFirestore, Timestamp, FieldValue, DocumentReference } from "firebase-admin/firestore"
import { defineSecret } from "firebase-functions/params"
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import { fal } from "@fal-ai/client"
import sharp from "sharp"
import { createHash } from "crypto"

// Get Firestore instance (app already initialized in index.ts)
const db = getFirestore()

// Screenshot translations consume weighted image credits. The App Hosting API
// reserves the full job before this worker starts; the worker settles successful
// outputs once across continuation retries and refunds the unused reservation.

// Define secrets
const falApiKey = defineSecret("FAL_KEY")
const kieApiKey = defineSecret("KIE_API_KEY")
const openaiApiKey = defineSecret("OPENAI_API_KEY")
const r2AccountId = defineSecret("R2_ACCOUNT_ID")
const r2AccessKeyId = defineSecret("R2_ACCESS_KEY_ID")
const r2SecretAccessKey = defineSecret("R2_SECRET_ACCESS_KEY")
const r2BucketName = defineSecret("R2_BUCKET_NAME")
const r2PublicUrl = defineSecret("R2_PUBLIC_URL")

// ============================================================================
// R2 SIGNED URL RESOLUTION
// ============================================================================
// R2 public URLs (screens.appstorecopilot.com) don't work for server-side fetches.
// We need to generate signed URLs for the translation API to access the images.

/**
 * Check if a URL is from our R2 storage
 */
function isR2Url(url: string, r2PublicUrlValue: string): boolean {
  if (!r2PublicUrlValue) return false
  try {
    const r2Domain = r2PublicUrlValue
      .replace(/^https?:\/\//, "")
      .replace(/\/+$/, "")
      .toLowerCase()
    const urlObj = new URL(url)
    return urlObj.hostname.toLowerCase() === r2Domain ||
           urlObj.hostname.toLowerCase().includes(r2Domain.split(".")[0])
  } catch {
    return false
  }
}

/**
 * Convert R2 public URL to signed URL for server-side access
 * This is required because R2 public URLs don't work for server-to-server requests
 */
async function resolveImageUrl(
  url: string,
  accountId: string,
  accessKeyId: string,
  secretAccessKey: string,
  bucket: string,
  publicUrl: string
): Promise<string> {
  if (!isR2Url(url, publicUrl)) {
    return url
  }

  try {
    const urlObj = new URL(url)
    const key = urlObj.pathname.slice(1) // Remove leading slash

    const r2Client = new S3Client({
      region: "auto",
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    })

    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const signedUrl = await getSignedUrl(r2Client as any, command as any, { expiresIn: 3600 })
    console.log(`[R2] Resolved signed URL for: ${key.substring(0, 50)}...`)
    return signedUrl
  } catch (error) {
    console.error(`[R2] Failed to get signed URL for ${url}:`, error)
    return url // Fall back to original URL
  }
}

// App Store screenshot dimensions by display type
// Must match exact pixel dimensions for App Store Connect acceptance
const DISPLAY_TYPE_DIMENSIONS: Record<string, { width: number; height: number }> = {
  "APP_IPHONE_69": { width: 1260, height: 2736 },
  "APP_IPHONE_65": { width: 1284, height: 2778 },
  "APP_IPHONE_63": { width: 1206, height: 2622 },
  "APP_IPHONE_61": { width: 1170, height: 2532 },
  "APP_IPHONE_55": { width: 1242, height: 2208 },
  "APP_IPAD_PRO_13": { width: 2064, height: 2752 },
  "APP_IPAD_PRO_129": { width: 2048, height: 2732 },
  "APP_IPAD_PRO_11": { width: 1668, height: 2388 },
  "APP_WATCH_ULTRA_3": { width: 422, height: 514 },
  "APP_WATCH_ULTRA": { width: 410, height: 502 },
  "APP_WATCH_SERIES_10": { width: 416, height: 496 },
  "APP_WATCH_SERIES_7": { width: 396, height: 484 },
  "APP_WATCH_SERIES_4": { width: 368, height: 448 },
  "APP_WATCH_SERIES_3": { width: 312, height: 390 },
}

/**
 * Resize image buffer to exact App Store dimensions for a display type
 * Uses lanczos3 kernel for high-quality downsampling
 */
async function resizeToAppStoreDimensions(
  imageBuffer: Buffer,
  displayType: string
): Promise<Buffer> {
  const dimensions = DISPLAY_TYPE_DIMENSIONS[displayType]
  if (!dimensions) {
    console.warn(`Unknown display type ${displayType}, skipping resize`)
    return imageBuffer
  }

  try {
    const resized = await sharp(imageBuffer)
      .resize(dimensions.width, dimensions.height, {
        fit: "cover",      // Scale + crop from center (no stretching/squeezing)
        position: "center",
        kernel: "lanczos3",
      })
      // Use JPEG with quality 85 for ~10x smaller files vs PNG
      // App Store Connect accepts both PNG and JPEG for screenshots
      .jpeg({ quality: 85, mozjpeg: true })
      .toBuffer()

    console.log(`Resized image for ${displayType}: ${dimensions.width}x${dimensions.height} (JPEG q85)`)
    return resized
  } catch (error) {
    console.error(`Failed to resize image for ${displayType}:`, error)
    // Return original if resize fails
    return imageBuffer
  }
}

// Types
type TranslationProvider = "kie" | "fal" | "openai"
type TranslationMode = "literal" | "marketing_short" | "transcreate" | "ui_full"

interface TextLengthPolicy {
  headlineMaxChars?: number
  subtitleMaxChars?: number
  allowLineBreaks?: boolean
  shrinkFontLimitPercent?: number
}

type PerScreenshotTranslationInstruction = string | {
  headline?: string
  subtitle?: string
  instructions?: string
  headlineMaxChars?: number
  subtitleMaxChars?: number
}

interface TranslationInstructionsUsed {
  translationMode: TranslationMode
  translateInAppText: boolean
  translationInstructions?: string
  textLengthPolicy?: TextLengthPolicy
  preserveInPhoneUI?: boolean
  translateMarketingOnly?: boolean
  perScreenshotInstructions?: PerScreenshotTranslationInstruction
  provider: TranslationProvider
  model: string
}

interface TranslationJob {
  id: string
  userId: string
  orgId?: string
  projectId: string
  status: "pending" | "processing" | "completed" | "failed" | "cancelled"
  config: {
    targetLocales: string[]
    displayTypes: string[]
    screenshotIds?: string[]
    screenshotIdsByLocale?: Record<string, string[]>  // Per-locale filtering
    customPage?: {
      type: "customProductPage"
      pageId: string
      sourceLocale: string
    }
    translateInAppText: boolean
    translationInstructions?: string
    translationMode?: TranslationMode
    textLengthPolicy?: TextLengthPolicy
    provider?: TranslationProvider
    model?: string
    preserveInPhoneUI?: boolean
    translateMarketingOnly?: boolean
    perScreenshotInstructions?: Record<string, PerScreenshotTranslationInstruction>
    instructionsHash?: string
    usageReservation?: {
      operationId: string
      usageType: "screenshots"
      reservedUnits: number
      unitWeight: number
    }
  }
  progress: {
    current: number
    total: number
    currentLocale?: string
    currentDisplayType?: string
    byLocale?: Record<string, { success: number; failed: number; total: number }>
  }
  results: Array<{
    locale: string
    displayType: string
    screenshotId: string
    success: boolean
    imageUrl?: string
    error?: string
    provider?: TranslationProvider
    model?: string
    instructionsHash?: string
    completedAt: Timestamp
  }>
  createdAt: Timestamp
  startedAt?: Timestamp
  completedAt?: Timestamp
  error?: string
  retryCount: number
  lastProcessedIndex?: number
  // Continuation chain tracking
  continuationOf?: string    // Parent job ID this continues from
  continuedBy?: string       // Child job ID that continues this
  rootJobId?: string         // Original job in the chain
  chainIndex?: number        // Position in chain (1 = root, 2 = first continuation, etc.)
  usageSegmentRecorded?: boolean
  usageCompletedUnits?: number
}

function usageEventId(operationId: string): string {
  return createHash("sha256").update(`screenshots:${operationId}`).digest("hex")
}

function billingAccountRoot(job: TranslationJob): DocumentReference {
  return job.orgId
    ? db.collection("organizations").doc(job.orgId)
    : db.collection("users").doc(job.userId)
}

async function recordUsageSegment(
  job: TranslationJob,
  jobRef: DocumentReference,
  successCount: number
): Promise<number> {
  const reservation = job.config.usageReservation
  if (!reservation) return 0
  const segmentUnits = Math.max(0, successCount) * reservation.unitWeight
  const rootJobId = job.rootJobId || job.id
  const rootJobRef = db.collection("users").doc(job.userId).collection("translationJobs").doc(rootJobId)

  return db.runTransaction(async transaction => {
    if (rootJobRef.path === jobRef.path) {
      const snapshot = await transaction.get(jobRef)
      const data = snapshot.data() || {}
      const currentTotal = Number(data.usageCompletedUnits || 0)
      if (data.usageSegmentRecorded) return currentTotal
      const nextTotal = currentTotal + segmentUnits
      transaction.update(jobRef, {
        usageSegmentRecorded: true,
        usageCompletedUnits: nextTotal,
      })
      return nextTotal
    }

    const [segmentSnapshot, rootSnapshot] = await Promise.all([
      transaction.get(jobRef),
      transaction.get(rootJobRef),
    ])
    const segmentData = segmentSnapshot.data() || {}
    const currentTotal = Number(rootSnapshot.data()?.usageCompletedUnits || 0)
    if (segmentData.usageSegmentRecorded) return currentTotal
    const nextTotal = currentTotal + segmentUnits
    transaction.update(jobRef, { usageSegmentRecorded: true })
    transaction.set(rootJobRef, { usageCompletedUnits: nextTotal }, { merge: true })
    return nextTotal
  })
}

async function finalizeUsageReservation(
  job: TranslationJob,
  jobRef: DocumentReference,
  successCount: number
): Promise<void> {
  const reservation = job.config.usageReservation
  if (!reservation) return
  const completedUnits = await recordUsageSegment(job, jobRef, successCount)
  const accountRef = billingAccountRoot(job)
  const eventRef = accountRef.collection("usageEvents").doc(usageEventId(reservation.operationId))

  await db.runTransaction(async transaction => {
    const eventSnapshot = await transaction.get(eventRef)
    if (!eventSnapshot.exists) {
      throw new Error(`Usage reservation ${reservation.operationId} was not found`)
    }
    const event = eventSnapshot.data() || {}
    if (event.status !== "reserved") return

    const reservedUnits = Number(event.reservedUnits || reservation.reservedUnits)
    const actualUnits = Math.min(reservedUnits, Math.max(0, completedUnits))
    const summaryRef = accountRef.collection("usage").doc(String(event.periodKey))
    const now = Timestamp.now()

    transaction.update(eventRef, {
      status: actualUnits === 0 ? "refunded" : "settled",
      settledUnits: actualUnits,
      updatedAt: now,
      ...(actualUnits === 0 ? { refundedAt: now } : { settledAt: now }),
    })
    transaction.set(summaryRef, {
      screenshotsReserved: FieldValue.increment(-reservedUnits),
      ...(actualUnits > 0 ? { screenshotsUsed: FieldValue.increment(actualUnits) } : {}),
      updatedAt: now,
    }, { merge: true })
  })
}

interface Screenshot {
  id: string
  marketingImageUrl: string
  headline?: string
  position: number  // Order in the set (0-9)
  updatedAt?: Timestamp  // When the primary screenshot was last updated
  imageKey?: string
  fileName?: string
  fileSize?: number
}

interface ScreenshotSet {
  displayType: string
  locale: string
  screenshots: Screenshot[]
}

interface TranslationTask {
  displayType: string
  sourceLocale: string
  targetLocale: string
  screenshot: Screenshot
  index: number
}

function buildTranslatedFileName(task: TranslationTask): string {
  const original = task.screenshot.fileName || `${task.screenshot.id}.jpg`
  const base = original.replace(/\.[^.]+$/, "")
  return `${base}-${task.targetLocale}.jpg`
}

// Language name mapping
const LOCALE_NAMES: Record<string, string> = {
  "en-US": "English (US)",
  "en-GB": "English (UK)",
  "de-DE": "German",
  "fr-FR": "French",
  "es-ES": "Spanish (Spain)",
  "es-MX": "Spanish (Mexico)",
  "it": "Italian",
  "pt-BR": "Portuguese (Brazil)",
  "pt-PT": "Portuguese (Portugal)",
  "ja": "Japanese",
  "ko": "Korean",
  "zh-Hans": "Chinese (Simplified)",
  "zh-Hant": "Chinese (Traditional)",
  "nl-NL": "Dutch",
  "ru": "Russian",
  "tr": "Turkish",
  "ar-SA": "Arabic",
  "ar": "Arabic",
  "th": "Thai",
  "vi": "Vietnamese",
  "id": "Indonesian",
  "ms": "Malay",
  "hi": "Hindi",
  "sv": "Swedish",
  "da": "Danish",
  "no": "Norwegian",
  "fi": "Finnish",
  "pl": "Polish",
  "cs": "Czech",
  "el": "Greek",
  "he": "Hebrew",
  "uk": "Ukrainian",
  "ro": "Romanian",
  "hu": "Hungarian",
  "sk": "Slovak",
  "ca": "Catalan",
  "bn-BD": "Bengali",
  "gu-IN": "Gujarati",
  "kn-IN": "Kannada",
  "ml-IN": "Malayalam",
  "mr-IN": "Marathi",
  "or-IN": "Odia",
  "pa-IN": "Punjabi",
  "sl-SI": "Slovenian",
  "ta-IN": "Tamil",
  "te-IN": "Telugu",
  "ur-PK": "Urdu",
  "hr": "Croatian",
}

function getLocaleName(locale: string): string {
  return LOCALE_NAMES[locale] || locale
}

// ============================================================================
// TRANSLATION PROVIDER TOGGLE
// ============================================================================
// Jobs default to Kie.ai for cheaper bulk translations, but can override this
// through job.config.provider for higher-quality or fallback providers.
const DEFAULT_TRANSLATION_PROVIDER: TranslationProvider = "kie"

// Rate limit configuration - differs by provider
const RATE_LIMIT_CONFIG_FAL = {
  initialBatchSize: 2,    // Start with 2 concurrent (fal.ai limit)
  minBatchSize: 1,
  maxBatchSize: 2,        // Max 2 concurrent per fal.ai limits
  baseDelay: 1000,        // 1 second base delay
  maxDelay: 30000,
  jitterFactor: 0.2,
  maxRetries: 5,
}

const RATE_LIMIT_CONFIG_KIE = {
  initialBatchSize: 18,   // Kie.ai allows 20 requests per 10 seconds - stay under
  minBatchSize: 10,       // Reduce on rate limit
  maxBatchSize: 18,       // Stay under 20/10s limit
  baseDelay: 500,         // Small delay between batches
  maxDelay: 10000,
  jitterFactor: 0.1,
  maxRetries: 5,
  pollInterval: 2000,     // Poll every 2 seconds for task status
  pollTimeout: 180000,    // 3 minute timeout for task completion
  taskSubmitDelay: 100,   // 100ms delay between task submissions to avoid burst
}

const RATE_LIMIT_CONFIG_OPENAI = {
  initialBatchSize: 3,
  minBatchSize: 1,
  maxBatchSize: 4,
  baseDelay: 1500,
  maxDelay: 30000,
  jitterFactor: 0.2,
  maxRetries: 5,
  taskSubmitDelay: 250,
}

const OPENAI_IMAGE_EDIT_TIMEOUT_MS = 180000

type RateLimitConfig = typeof RATE_LIMIT_CONFIG_FAL & {
  pollInterval?: number
  pollTimeout?: number
  taskSubmitDelay?: number
}

async function fetchTextWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<{ response: Response; text: string }> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
    })
    const text = await response.text()
    return { response, text }
  } catch (error: any) {
    if (error?.name === "AbortError") {
      throw new Error(`Request timed out after ${Math.round(timeoutMs / 1000)}s`)
    }
    throw error
  } finally {
    clearTimeout(timeoutId)
  }
}

function getTranslationProvider(provider?: string): TranslationProvider {
  return provider === "fal" || provider === "openai" || provider === "kie"
    ? provider
    : DEFAULT_TRANSLATION_PROVIDER
}

function getTranslationModel(provider: TranslationProvider, model?: string): string {
  if (model) return model
  if (provider === "openai") return "gpt-image-2.5-flare"
  if (provider === "fal") return "fal-ai/nano-banana-pro/edit"
  return "nano-banana-2"
}

function getRateLimitConfig(provider: TranslationProvider): RateLimitConfig {
  if (provider === "openai") return RATE_LIMIT_CONFIG_OPENAI
  if (provider === "fal") return RATE_LIMIT_CONFIG_FAL
  return RATE_LIMIT_CONFIG_KIE
}

function calculateBackoffDelay(attempt: number, rateLimitConfig: RateLimitConfig): number {
  const exponentialDelay = Math.min(
    rateLimitConfig.baseDelay * Math.pow(2, attempt),
    rateLimitConfig.maxDelay
  )
  const jitter = exponentialDelay * rateLimitConfig.jitterFactor * (Math.random() * 2 - 1)
  return Math.max(0, exponentialDelay + jitter)
}

// Improved rate limit detection - uses specific patterns to reduce false positives
function isRateLimitError(message: string, statusCode?: number): boolean {
  if (statusCode === 429) return true
  const rateLimitPatterns = [
    /rate.?limit/i,
    /too many requests/i,
    /frequency.+too high/i,
    /throttl/i,
    /quota exceeded/i,
    /\b429\b/,
  ]
  return rateLimitPatterns.some(p => p.test(message))
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// Image fetch with retry for reliability
async function fetchImageWithRetry(
  imageUrl: string,
  maxAttempts: number = 3,
  delayMs: number = 1000
): Promise<{ success: true; buffer: Buffer } | { success: false; error: string }> {
  let lastError = ""
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetch(imageUrl)
      if (!response.ok) {
        lastError = `HTTP ${response.status}`
        if (attempt < maxAttempts) {
          console.log(`Image fetch attempt ${attempt}/${maxAttempts} failed (${lastError}), retrying in ${delayMs}ms...`)
          await sleep(delayMs)
          continue
        }
      } else {
        const buffer = Buffer.from(await response.arrayBuffer())
        return { success: true, buffer }
      }
    } catch (error: any) {
      lastError = error?.message || String(error)
      if (attempt < maxAttempts) {
        console.log(`Image fetch attempt ${attempt}/${maxAttempts} failed (${lastError}), retrying in ${delayMs}ms...`)
        await sleep(delayMs)
        continue
      }
    }
  }
  return { success: false, error: `Failed to fetch image after ${maxAttempts} attempts: ${lastError}` }
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value)
  }

  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`
  }

  const record = value as Record<string, unknown>
  const keys = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()

  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`
}

function hashInstructions(instructionsUsed: TranslationInstructionsUsed): string {
  return createHash("sha256")
    .update(stableStringify(instructionsUsed))
    .digest("hex")
    .slice(0, 16)
}

function getPerScreenshotInstruction(
  instructions: Record<string, PerScreenshotTranslationInstruction> | undefined,
  screenshot: Screenshot
): PerScreenshotTranslationInstruction | undefined {
  if (!instructions) return undefined

  const oneBasedPosition = screenshot.position + 1
  const candidateKeys = [
    screenshot.id,
    String(oneBasedPosition),
    String(oneBasedPosition).padStart(2, "0"),
    String(screenshot.position),
    String(screenshot.position).padStart(2, "0"),
  ]

  return candidateKeys
    .map((key) => instructions[key])
    .find((instruction) => instruction !== undefined)
}

function formatTextLengthPolicy(
  policy: TextLengthPolicy | undefined,
  perScreenshotInstruction: PerScreenshotTranslationInstruction | undefined
): string {
  const perShotPolicy = typeof perScreenshotInstruction === "object" ? perScreenshotInstruction : undefined
  const headlineMaxChars = perShotPolicy?.headlineMaxChars ?? policy?.headlineMaxChars
  const subtitleMaxChars = perShotPolicy?.subtitleMaxChars ?? policy?.subtitleMaxChars

  const rules: string[] = []
  if (headlineMaxChars) rules.push(`- Keep headline text at or under ${headlineMaxChars} characters when possible.`)
  if (subtitleMaxChars) rules.push(`- Keep subtitle/supporting text at or under ${subtitleMaxChars} characters when possible.`)
  if (policy?.allowLineBreaks !== undefined) {
    rules.push(`- Line breaks are ${policy.allowLineBreaks ? "allowed" : "not allowed"} when fitting translated text.`)
  }
  if (policy?.shrinkFontLimitPercent !== undefined) {
    rules.push(`- Do not shrink fonts by more than ${policy.shrinkFontLimitPercent}% before choosing shorter wording or line breaks.`)
  }

  if (rules.length === 0) return ""
  return `\nTEXT LENGTH POLICY:\n${rules.join("\n")}`
}

function formatPerScreenshotInstruction(instruction: PerScreenshotTranslationInstruction | undefined): string {
  if (!instruction) return ""
  if (typeof instruction === "string") {
    return `\nPER-SCREENSHOT INSTRUCTIONS:\n- ${instruction}`
  }

  const rules: string[] = []
  if (instruction.headline) rules.push(`- Use this headline wording if it fits naturally: "${instruction.headline}"`)
  if (instruction.subtitle) rules.push(`- Use this subtitle/supporting wording if it fits naturally: "${instruction.subtitle}"`)
  if (instruction.instructions) rules.push(`- ${instruction.instructions}`)
  if (instruction.headlineMaxChars) rules.push(`- This screenshot headline max is ${instruction.headlineMaxChars} characters.`)
  if (instruction.subtitleMaxChars) rules.push(`- This screenshot subtitle max is ${instruction.subtitleMaxChars} characters.`)

  if (rules.length === 0) return ""
  return `\nPER-SCREENSHOT INSTRUCTIONS:\n${rules.join("\n")}`
}

function getModeInstruction(mode: TranslationMode): string {
  switch (mode) {
    case "marketing_short":
      return "Transcreate the marketing copy into concise, punchy App Store language. Prefer short natural wording over literal phrasing."
    case "transcreate":
      return "Adapt the message for the target market while preserving the intent, hierarchy, and benefit of the original copy."
    case "ui_full":
      return "Translate marketing text and in-app UI text naturally for the target locale while preserving all layout and UI structure."
    case "literal":
    default:
      return "Translate faithfully while keeping the same meaning, tone, visual hierarchy, and marketing intent."
  }
}

function buildTranslationPrompt(params: {
  sourceLocale: string
  targetLocale: string
  screenshot: Screenshot
  translateInAppText: boolean
  config: TranslationJob["config"]
  provider: TranslationProvider
  model: string
}): { prompt: string; instructionsUsed: TranslationInstructionsUsed; instructionsHash: string } {
  const targetLanguage = getLocaleName(params.targetLocale)
  const sourceLanguage = getLocaleName(params.sourceLocale)
  const mode = params.config.translationMode || (params.translateInAppText ? "ui_full" : "literal")
  const shouldTranslateInAppText = mode === "ui_full"
    ? true
    : params.config.preserveInPhoneUI || params.config.translateMarketingOnly
      ? false
      : params.translateInAppText
  const perScreenshotInstruction = getPerScreenshotInstruction(
    params.config.perScreenshotInstructions,
    params.screenshot
  )

  const inAppTextInstruction = shouldTranslateInAppText
    ? "Translate ALL text in the image, including marketing headlines and text inside the app UI/device screen."
    : "ONLY translate the marketing headline/subtitle text outside the device mockup. Keep all text inside the device screen exactly as-is."

  const customInstructions = params.config.translationInstructions
    ? `\nCUSTOM INSTRUCTIONS:\n${params.config.translationInstructions}`
    : ""
  const knownHeadline = params.screenshot.headline
    ? `\nKNOWN SOURCE HEADLINE:\n"${params.screenshot.headline}"`
    : ""
  const textLengthPolicy = formatTextLengthPolicy(params.config.textLengthPolicy, perScreenshotInstruction)
  const perScreenshotInstructionText = formatPerScreenshotInstruction(perScreenshotInstruction)

  const instructionsUsed: TranslationInstructionsUsed = {
    translationMode: mode,
    translateInAppText: shouldTranslateInAppText,
    ...(params.config.translationInstructions ? { translationInstructions: params.config.translationInstructions } : {}),
    ...(params.config.textLengthPolicy ? { textLengthPolicy: params.config.textLengthPolicy } : {}),
    ...(params.config.preserveInPhoneUI !== undefined ? { preserveInPhoneUI: params.config.preserveInPhoneUI } : {}),
    ...(params.config.translateMarketingOnly !== undefined ? { translateMarketingOnly: params.config.translateMarketingOnly } : {}),
    ...(perScreenshotInstruction !== undefined ? { perScreenshotInstructions: perScreenshotInstruction } : {}),
    provider: params.provider,
    model: params.model,
  }
  const instructionsHash = hashInstructions(instructionsUsed)

  const prompt = `Translate this App Store screenshot from ${sourceLanguage} to ${targetLanguage}.

${getModeInstruction(mode)}

${inAppTextInstruction}${knownHeadline}${textLengthPolicy}${perScreenshotInstructionText}${customInstructions}

CRITICAL TEXT PLACEMENT RULES:
- Text must NEVER touch or get cut off at the image edges - maintain at least 50 pixels of padding from all edges
- If the translated text is longer than the original, you MUST:
  1. FIRST try reducing font size proportionally to fit on the same number of lines
  2. If still too long, split it into multiple lines while maintaining visual hierarchy, unless line breaks are disallowed
  3. If still too long, choose shorter natural wording rather than literal wording
  4. NEVER let text overflow, truncate, or get cut off under any circumstances
- Keep text horizontally centered in the same position as the original
- Ensure ALL characters of the translated text are fully visible within the image boundaries
- Maintain the same text alignment (left, center, right) as the original

TEXT SPACING AND READABILITY:
- Maintain adequate vertical spacing between headline and subtitle text (at least 20 pixels)
- Ensure headline and subtitle never overlap or touch each other
- If text elements would collide after translation, reduce font sizes proportionally for both
- Preserve clear visual separation between marketing text and device mockup
- Text should have comfortable breathing room - err on the side of more padding rather than less
- Prioritize readability: if text becomes too small to read clearly (below ~24pt equivalent), split to more lines or choose shorter wording

VISUAL CONSISTENCY REQUIREMENTS:
- Preserve the EXACT visual layout - nothing should move, resize, or change position
- Match the original font family, weight, size (unless resizing for fit), and color EXACTLY
- Keep device mockups, backgrounds, shadows, gradients, and all non-text elements COMPLETELY UNCHANGED
- CRITICAL: Preserve the EXACT size, position, and aspect ratio of any phone/device mockup - do NOT resize, shrink, crop, or reposition the device frame
- The device mockup must remain PIXEL-PERFECT identical in scale and placement to the original image
- Do NOT add, remove, or modify any visual elements - only change the text content
- Maintain the exact same image dimensions and aspect ratio as the input
- Preserve all shadows, reflections, and lighting effects on device mockups
- Keep the exact same background color, gradient, or image
- Maintain professional App Store marketing quality

OUTPUT REQUIREMENTS:
- The output image must have the EXACT same dimensions as the input image
- Only the text content should change - everything else must be identical
- The translated text "${targetLanguage}" may be longer - prioritize keeping text fully visible over matching exact font size`

  return { prompt, instructionsUsed, instructionsHash }
}

// ============================================================================
// KIE.AI TRANSLATION IMPLEMENTATION
// ============================================================================
// Uses Kie.ai's Nano Banana 2 API with higher concurrency (100+ vs fal.ai's 2)

interface KieTaskResponse {
  code: number
  msg: string
  data: {
    taskId: string
  }
}

interface KieRecordResponse {
  code: number
  msg: string
  data: {
    taskId: string
    model: string
    state: "waiting" | "success" | "fail"
    param: string
    resultJson: string | null
    failCode: string | null
    failMsg: string | null
    costTime: number | null
    completeTime: number | null
    createTime: number
  }
}

async function translateScreenshotKie(
  sourceImageUrl: string,
  prompt: string,
  apiKey: string,
  model: string,
  rateLimitConfig: RateLimitConfig
): Promise<{ success: boolean; imageBuffer?: Buffer; error?: string }> {
  const KIE_API_BASE = "https://api.kie.ai"

  // Retry logic for rate limits
  for (let attempt = 0; attempt < rateLimitConfig.maxRetries; attempt++) {
    try {
      // Step 1: Create task
      const createResponse = await fetch(`${KIE_API_BASE}/api/v1/jobs/createTask`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          input: {
            prompt,
            image_input: [sourceImageUrl],
            aspect_ratio: "auto",
            resolution: "2K",
            output_format: "jpg",
          },
        }),
      })

      if (!createResponse.ok) {
        const errorText = await createResponse.text()
        if (createResponse.status === 429) {
          console.log(`Kie.ai rate limited, waiting before retry ${attempt + 1}/${rateLimitConfig.maxRetries}`)
          await sleep(calculateBackoffDelay(attempt, rateLimitConfig) + 3000)
          continue
        }
        return { success: false, error: `Kie.ai create task failed: ${createResponse.status} - ${errorText}` }
      }

      const createResult = await createResponse.json() as KieTaskResponse
      if (createResult.code !== 200 || !createResult.data?.taskId) {
        // Check if it's a rate limit error in the response body
        const errorMsg = createResult.msg || ""
        if (isRateLimitError(errorMsg)) {
          console.log(`Kie.ai rate limited (body), waiting before retry ${attempt + 1}/${rateLimitConfig.maxRetries}`)
          await sleep(calculateBackoffDelay(attempt, rateLimitConfig) + 5000) // Extra 5s for rate limits
          continue
        }
        return { success: false, error: `Kie.ai create task error: ${createResult.msg}` }
      }

      const taskId = createResult.data.taskId
      console.log(`Kie.ai task created: ${taskId}`)

      // Step 2: Poll for task completion
      const pollStart = Date.now()
      const pollInterval = rateLimitConfig.pollInterval || RATE_LIMIT_CONFIG_KIE.pollInterval
      const pollTimeout = rateLimitConfig.pollTimeout || RATE_LIMIT_CONFIG_KIE.pollTimeout

      while (Date.now() - pollStart < pollTimeout) {
        await sleep(pollInterval)

        const statusResponse = await fetch(
          `${KIE_API_BASE}/api/v1/jobs/recordInfo?taskId=${taskId}`,
          {
            headers: {
              "Authorization": `Bearer ${apiKey}`,
            },
          }
        )

        if (!statusResponse.ok) {
          console.log(`Kie.ai status check failed: ${statusResponse.status}`)
          continue
        }

        const statusResult = await statusResponse.json() as KieRecordResponse

        if (statusResult.data.state === "success") {
          // Parse result and fetch image
          const resultJson = JSON.parse(statusResult.data.resultJson || "{}")
          const resultUrls = resultJson.resultUrls as string[] | undefined

          if (resultUrls && resultUrls.length > 0) {
            const imageUrl = resultUrls[0]
            const fetchResult = await fetchImageWithRetry(imageUrl)
            if (!fetchResult.success) {
              return { success: false, error: `Failed to fetch Kie.ai generated image: ${fetchResult.error}` }
            }
            console.log(`Kie.ai task ${taskId} completed in ${Date.now() - pollStart}ms`)
            return { success: true, imageBuffer: fetchResult.buffer }
          }

          return { success: false, error: "Kie.ai returned success but no image URLs" }
        }

        if (statusResult.data.state === "fail") {
          return { success: false, error: `Kie.ai task failed: ${statusResult.data.failMsg || statusResult.data.failCode || "Unknown error"}` }
        }

        // Still waiting, continue polling
      }

      return { success: false, error: `Kie.ai task timed out after ${pollTimeout}ms` }
    } catch (error: any) {
      const errorMessage = error?.message || String(error)

      if (isRateLimitError(errorMessage)) {
        console.log(`Kie.ai rate limited, waiting before retry ${attempt + 1}/${rateLimitConfig.maxRetries}`)
        await sleep(calculateBackoffDelay(attempt, rateLimitConfig) + 3000)
        continue
      }

      if (attempt === rateLimitConfig.maxRetries - 1) {
        return { success: false, error: errorMessage }
      }
      await sleep(calculateBackoffDelay(attempt, rateLimitConfig))
    }
  }

  return { success: false, error: "Max retries exceeded" }
}

// ============================================================================
// FAL.AI TRANSLATION IMPLEMENTATION
// ============================================================================
// Uses fal.ai's Nano Banana Pro API (2 concurrent limit)

async function translateScreenshotFal(
  sourceImageUrl: string,
  prompt: string,
  apiKey: string,
  model: string,
  rateLimitConfig: RateLimitConfig
): Promise<{ success: boolean; imageBuffer?: Buffer; error?: string }> {
  // Configure fal.ai client
  fal.config({ credentials: apiKey })

  // Retry logic for rate limits
  for (let attempt = 0; attempt < rateLimitConfig.maxRetries; attempt++) {
    try {
      const result = await fal.subscribe(model, {
        input: {
          image_urls: [sourceImageUrl],  // Array of image URLs
          prompt,
          num_images: 1,
          resolution: "2K",        // High quality output
          output_format: "jpeg",
        },
      }) as { data?: { images?: Array<{ url: string }> }; images?: Array<{ url: string }> }

      // Handle both response formats: direct images array or nested in data
      const images = result.data?.images || result.images

      if (images && images.length > 0) {
        const imageUrl = images[0].url
        // Fetch the generated image with retry
        const fetchResult = await fetchImageWithRetry(imageUrl)
        if (!fetchResult.success) {
          return { success: false, error: `Failed to fetch generated image: ${fetchResult.error}` }
        }
        return { success: true, imageBuffer: fetchResult.buffer }
      }

      return { success: false, error: "No image returned from fal.ai API" }
    } catch (error: any) {
      const errorMessage = error?.message || String(error)

      // Check for rate limit errors
      if (isRateLimitError(errorMessage)) {
        console.log(`Rate limited, waiting before retry ${attempt + 1}/${rateLimitConfig.maxRetries}`)
        await sleep(calculateBackoffDelay(attempt, rateLimitConfig) + 3000) // Extra 3s for rate limits
        continue
      }

      if (attempt === rateLimitConfig.maxRetries - 1) {
        return { success: false, error: errorMessage }
      }
      await sleep(calculateBackoffDelay(attempt, rateLimitConfig))
    }
  }

  return { success: false, error: "Max retries exceeded" }
}

// ============================================================================
// OPENAI TRANSLATION IMPLEMENTATION
// ============================================================================
// Uses OpenAI's Image API with GPT Image models. Official docs recommend the
// Image API for single-prompt edits; the house default is gpt-image-2.5-flare (gpt-image-2 is legacy).

interface OpenAIImageEditResponse {
  data?: Array<{
    b64_json?: string
    url?: string
  }>
  error?: {
    message?: string
  }
}

async function translateScreenshotOpenAI(
  sourceImageUrl: string,
  prompt: string,
  apiKey: string,
  model: string,
  rateLimitConfig: RateLimitConfig
): Promise<{ success: boolean; imageBuffer?: Buffer; error?: string }> {
  if (!apiKey) {
    return { success: false, error: "OPENAI_API_KEY is not configured for translation jobs" }
  }

  for (let attempt = 0; attempt < rateLimitConfig.maxRetries; attempt++) {
    try {
      const { response, text: responseText } = await fetchTextWithTimeout("https://api.openai.com/v1/images/edits", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          prompt,
          images: [{ image_url: sourceImageUrl }],
          size: "auto",
          quality: "high",
          output_format: "jpeg",
          output_compression: 85,
        }),
      }, OPENAI_IMAGE_EDIT_TIMEOUT_MS)

      if (!response.ok) {
        if (response.status === 429) {
          console.log(`OpenAI rate limited, waiting before retry ${attempt + 1}/${rateLimitConfig.maxRetries}`)
          await sleep(calculateBackoffDelay(attempt, rateLimitConfig) + 3000)
          continue
        }
        return { success: false, error: `OpenAI image edit failed: ${response.status} - ${responseText}` }
      }

      const result = JSON.parse(responseText) as OpenAIImageEditResponse
      const image = result.data?.[0]

      if (image?.b64_json) {
        return { success: true, imageBuffer: Buffer.from(image.b64_json, "base64") }
      }

      if (image?.url) {
        const fetchResult = await fetchImageWithRetry(image.url)
        if (!fetchResult.success) {
          return { success: false, error: `Failed to fetch OpenAI generated image: ${fetchResult.error}` }
        }
        return { success: true, imageBuffer: fetchResult.buffer }
      }

      return { success: false, error: result.error?.message || "OpenAI returned no image data" }
    } catch (error: any) {
      const errorMessage = error?.message || String(error)

      if (isRateLimitError(errorMessage)) {
        console.log(`OpenAI rate limited, waiting before retry ${attempt + 1}/${rateLimitConfig.maxRetries}`)
        await sleep(calculateBackoffDelay(attempt, rateLimitConfig) + 3000)
        continue
      }

      if (attempt === rateLimitConfig.maxRetries - 1) {
        return { success: false, error: errorMessage }
      }
      await sleep(calculateBackoffDelay(attempt, rateLimitConfig))
    }
  }

  return { success: false, error: "Max retries exceeded" }
}

// ============================================================================
// TRANSLATION DISPATCHER
// ============================================================================
// Routes to the appropriate provider based on per-job config

async function translateScreenshot(
  sourceImageUrl: string,
  sourceLocale: string,
  targetLocale: string,
  screenshot: Screenshot,
  translateInAppText: boolean,
  config: TranslationJob["config"],
  provider: TranslationProvider,
  model: string,
  rateLimitConfig: RateLimitConfig,
  falKey: string,
  kieKey: string,
  openaiKey: string
): Promise<{
  success: boolean
  imageBuffer?: Buffer
  error?: string
  provider: TranslationProvider
  model: string
  instructionsHash: string
  instructionsUsed: TranslationInstructionsUsed
}> {
  const promptInfo = buildTranslationPrompt({
    sourceLocale,
    targetLocale,
    screenshot,
    translateInAppText,
    config,
    provider,
    model,
  })

  let result: { success: boolean; imageBuffer?: Buffer; error?: string }
  if (provider === "kie") {
    result = await translateScreenshotKie(sourceImageUrl, promptInfo.prompt, kieKey, model, rateLimitConfig)
  } else if (provider === "openai") {
    result = await translateScreenshotOpenAI(sourceImageUrl, promptInfo.prompt, openaiKey, model, rateLimitConfig)
  } else {
    result = await translateScreenshotFal(sourceImageUrl, promptInfo.prompt, falKey, model, rateLimitConfig)
  }

  return {
    ...result,
    provider,
    model,
    instructionsHash: promptInfo.instructionsHash,
    instructionsUsed: promptInfo.instructionsUsed,
  }
}

// Upload to R2
async function uploadToR2(
  data: Buffer,
  key: string,
  contentType: string,
  accountId: string,
  accessKeyId: string,
  secretAccessKey: string,
  bucket: string,
  publicUrl: string
): Promise<string> {
  const r2Client = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  })

  await r2Client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: data,
      ContentType: contentType,
    })
  )

  return `${publicUrl}/${key}`
}

function generateHash(data: string): string {
  let hash = 0
  for (let i = 0; i < data.length; i++) {
    const char = data.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash
  }
  return Math.abs(hash).toString(36)
}

// Main Cloud Function
export const processTranslationJob = onDocumentCreated(
  {
    document: "users/{userId}/translationJobs/{jobId}",
    timeoutSeconds: 540, // 9 minutes - max for document triggers. Large jobs use resume feature.
    memory: "1GiB",
    maxInstances: 10,
    secrets: [falApiKey, kieApiKey, openaiApiKey, r2AccountId, r2AccessKeyId, r2SecretAccessKey, r2BucketName, r2PublicUrl],
  },
  async (event) => {
    const snapshot = event.data
    if (!snapshot) {
      console.log("No data in event")
      return
    }

    const job = snapshot.data() as TranslationJob
    const jobRef = snapshot.ref as DocumentReference
    const userId = event.params.userId

    console.log(`Processing translation job ${job.id} for user ${userId} (v2)`)

    // Check if job was already cancelled
    const currentJob = await jobRef.get()
    if (currentJob.data()?.status === "cancelled") {
      console.log("Job was cancelled before processing started")
      await finalizeUsageReservation(job, jobRef, 0)
      return
    }

    // FAILSAFE: Prevent infinite continuation loops
    const MAX_CHAIN_LENGTH = 15 // Max ~2 hours of processing (15 * 8 min)
    const MAX_TOTAL_RUNTIME_MS = 3 * 60 * 60 * 1000 // 3 hours absolute max

    // Count chain length by walking back to root
    let chainLength = 1
    let rootCreatedAt = job.createdAt
    let parentId: string | undefined = job.continuationOf
    while (parentId && chainLength < MAX_CHAIN_LENGTH + 5) {
      const parentDoc = await db
        .collection("users")
        .doc(userId)
        .collection("translationJobs")
        .doc(parentId)
        .get()
      if (!parentDoc.exists) break
      const parentData = parentDoc.data() as TranslationJob
      chainLength++
      rootCreatedAt = parentData.createdAt
      parentId = parentData.continuationOf
    }

    // Check chain length limit
    if (chainLength > MAX_CHAIN_LENGTH) {
      console.error(`Job ${job.id} exceeded max chain length (${chainLength}/${MAX_CHAIN_LENGTH})`)
      await jobRef.update({
        status: "failed",
        error: `Exceeded maximum continuation limit (${MAX_CHAIN_LENGTH}). Please start a new job for remaining translations.`,
        completedAt: Timestamp.now(),
      })
      await finalizeUsageReservation(job, jobRef, 0)
      return
    }

    // Check total runtime limit
    const rootStartTime = rootCreatedAt instanceof Timestamp ? rootCreatedAt.toMillis() : new Date(rootCreatedAt).getTime()
    const totalRuntime = Date.now() - rootStartTime
    if (totalRuntime > MAX_TOTAL_RUNTIME_MS) {
      console.error(`Job ${job.id} exceeded max total runtime (${Math.round(totalRuntime / 60000)} min)`)
      await jobRef.update({
        status: "failed",
        error: `Exceeded maximum total runtime (3 hours). Please start a new job for remaining translations.`,
        completedAt: Timestamp.now(),
      })
      await finalizeUsageReservation(job, jobRef, 0)
      return
    }

    console.log(`Job ${job.id} chain length: ${chainLength}, total runtime: ${Math.round(totalRuntime / 60000)} min`)

    // Mark as processing
    await jobRef.update({
      status: "processing",
      startedAt: Timestamp.now(),
    })

    const results: TranslationJob["results"] = []
    try {
      // Get project path
      const projectBasePath = job.orgId
        ? db.collection("organizations").doc(job.orgId).collection("projects").doc(job.projectId)
        : db.collection("users").doc(userId).collection("projects").doc(job.projectId)

      // Build task list - ordered by locale first, then device type
      // This ensures all screenshots for one language complete before moving to the next
      const tasks: TranslationTask[] = []
      const customPage = job.config.customPage

      const screenshotSets: Array<{
        displayType: string
        sourceLocale: string
        screenshots: Screenshot[]
      }> = []

      const hasPerLocaleFilter = !!job.config.screenshotIdsByLocale
      console.log(`[TranslationWorker] Job config:`, {
        screenshotIds: job.config.screenshotIds || 'ALL',
        screenshotIdsByLocale: hasPerLocaleFilter ? Object.keys(job.config.screenshotIdsByLocale!).length + ' locales' : 'N/A',
        translationMode: job.config.translationMode || "literal",
        provider: job.config.provider || DEFAULT_TRANSLATION_PROVIDER,
        instructionsHash: job.config.instructionsHash || "N/A",
        customPage: customPage ? `${customPage.type}/${customPage.pageId}/${customPage.sourceLocale}` : "N/A",
      })

      if (customPage?.type === "customProductPage") {
        const sourceLocDoc = await projectBasePath
          .collection("customProductPages")
          .doc(customPage.pageId)
          .collection("localizations")
          .doc(customPage.sourceLocale)
          .get()

        if (!sourceLocDoc.exists) {
          throw new Error(`Custom Product Page source localization ${customPage.sourceLocale} not found`)
        }

        const sourceData = sourceLocDoc.data() || {}
        const sourceScreenshots = (sourceData.screenshots || []) as Array<{
          id: string
          position?: number
          displayType: string
          imageUrl: string
          imageKey?: string
          fileName?: string
          fileSize?: number
          uploadedAt?: Timestamp
        }>
        const configuredDisplayTypes = new Set(job.config.displayTypes)
        const grouped = new Map<string, Screenshot[]>()

        for (const screenshot of sourceScreenshots) {
          if (!screenshot.displayType || !screenshot.imageUrl) continue
          if (configuredDisplayTypes.size > 0 && !configuredDisplayTypes.has(screenshot.displayType)) continue

          const existing = grouped.get(screenshot.displayType) || []
          existing.push({
            id: screenshot.id,
            marketingImageUrl: screenshot.imageUrl,
            imageKey: screenshot.imageKey,
            fileName: screenshot.fileName,
            fileSize: screenshot.fileSize,
            headline: screenshot.fileName,
            position: screenshot.position ?? existing.length,
            updatedAt: screenshot.uploadedAt || Timestamp.now(),
          })
          grouped.set(screenshot.displayType, existing)
        }

        for (const [displayType, screenshots] of grouped.entries()) {
          screenshotSets.push({
            displayType,
            sourceLocale: customPage.sourceLocale,
            screenshots,
          })
        }
      } else {
        // Fetch all screenshot sets in parallel for faster startup
        const setDocs = await Promise.all(
          job.config.displayTypes.map(dt => projectBasePath.collection("screenshots").doc(dt).get())
        )

        for (let i = 0; i < setDocs.length; i++) {
          const setDoc = setDocs[i]
          if (!setDoc.exists) continue

          const displayType = job.config.displayTypes[i]
          const screenshotSet = setDoc.data() as ScreenshotSet

          screenshotSets.push({
            displayType,
            sourceLocale: screenshotSet.locale,
            screenshots: screenshotSet.screenshots, // Store all screenshots, filter per-locale when building tasks
          })
        }
      }

      // Build tasks: locale → displayType → screenshot
      // Supports per-locale filtering when screenshotIdsByLocale is provided
      for (const targetLocale of job.config.targetLocales) {
        // Get screenshot IDs to process for this locale
        const localeScreenshotIds = job.config.screenshotIdsByLocale?.[targetLocale]

        for (const { displayType, sourceLocale, screenshots } of screenshotSets) {
          if (targetLocale === sourceLocale) continue

          // Filter screenshots based on: per-locale filter > global filter > all
          let screenshotsForLocale = screenshots
          if (localeScreenshotIds) {
            screenshotsForLocale = screenshots.filter(s => localeScreenshotIds.includes(s.id))
          } else if (job.config.screenshotIds) {
            screenshotsForLocale = screenshots.filter(s => job.config.screenshotIds!.includes(s.id))
          }

          for (const screenshot of screenshotsForLocale) {
            tasks.push({
              displayType,
              sourceLocale,
              targetLocale,
              screenshot,
              index: tasks.length,
            })
          }
        }

        if (hasPerLocaleFilter) {
          const localeTaskCount = tasks.filter(t => t.targetLocale === targetLocale).length
          console.log(`[TranslationWorker] ${targetLocale}: ${localeTaskCount} tasks (filtered from ${localeScreenshotIds?.length || 0} screenshot IDs)`)
        }
      }

      // Calculate per-locale task totals for progress tracking
      const localeTaskCounts: Record<string, number> = {}
      for (const task of tasks) {
        localeTaskCounts[task.targetLocale] = (localeTaskCounts[task.targetLocale] || 0) + 1
      }

      // Initialize byLocale progress tracking
      const byLocale: Record<string, { success: number; failed: number; total: number }> = {}
      for (const [locale, total] of Object.entries(localeTaskCounts)) {
        byLocale[locale] = { success: 0, failed: 0, total }
      }

      // Update total with per-locale tracking
      await jobRef.update({
        "progress.total": tasks.length,
        "progress.byLocale": byLocale,
      })

      if (tasks.length === 0) {
        await jobRef.update({
          status: "completed",
          completedAt: Timestamp.now(),
        })
        await finalizeUsageReservation(job, jobRef, 0)
        return
      }

      // Resume support
      const startIndex = job.lastProcessedIndex || 0
      const remainingTasks = tasks.slice(startIndex)

      // Timeout management - function has 9 minutes max, checkpoint at 8 minutes
      const functionStartTime = Date.now()
      const TIMEOUT_WARNING_MS = 8 * 60 * 1000 // 8 minutes - save state before 9 min limit
      const isApproachingTimeout = () => Date.now() - functionStartTime > TIMEOUT_WARNING_MS

      const translationProvider = getTranslationProvider(job.config.provider)
      const translationModel = getTranslationModel(translationProvider, job.config.model)
      const rateLimitConfig = getRateLimitConfig(translationProvider)
      console.log(`[TranslationWorker] Provider config:`, {
        provider: translationProvider,
        model: translationModel,
        translationMode: job.config.translationMode || "literal",
        instructionsHash: job.config.instructionsHash || "N/A",
      })

      // Adaptive batch processing
      let currentBatchSize = rateLimitConfig.initialBatchSize
      let processedCount = startIndex
      const progressBuffer: TranslationJob["results"] = []
      let lastProgressUpdate = Date.now()
      let isCancelled = false // Flag to prevent writes after cancellation
      const saveTranslatedScreenshot = async (
        task: TranslationTask,
        uploadedUrl: string,
        key: string,
        imageBuffer: Buffer,
        translationResult: NonNullable<Awaited<ReturnType<typeof translateScreenshot>>>
      ) => {
        if (customPage?.type !== "customProductPage") {
          const localizedCollection = projectBasePath.collection("localizedScreenshots")
          const docId = `${task.displayType}_${task.screenshot.id}_${task.targetLocale}`

          await localizedCollection.doc(docId).set({
            locale: task.targetLocale,
            screenshotId: task.screenshot.id,
            displayType: task.displayType,
            marketingImageUrl: uploadedUrl,
            marketingImageKey: key,
            headline: task.screenshot.headline,
            position: task.screenshot.position,
            sourceHash: generateHash(task.screenshot.marketingImageUrl + (task.screenshot.headline || "")),
            primaryUpdatedAt: task.screenshot.updatedAt || Timestamp.now(),
            lastModifiedAt: Timestamp.now(),
            lastModifiedBy: userId,
            translationProvider: translationResult.provider,
            translationModel: translationResult.model,
            translationMode: translationResult.instructionsUsed.translationMode,
            instructionsHash: translationResult.instructionsHash,
            instructionsUsed: translationResult.instructionsUsed,
          })
          return
        }

        const pageRef = projectBasePath.collection("customProductPages").doc(customPage.pageId)
        const locRef = pageRef.collection("localizations").doc(task.targetLocale)
        const translatedScreenshotId = `cpp_ss_translated_${task.screenshot.id}_${task.targetLocale}`.replace(/[^A-Za-z0-9_-]/g, "_")
        const now = Timestamp.now()

        await db.runTransaction(async transaction => {
          const locDoc = await transaction.get(locRef)
          const locData = locDoc.exists ? locDoc.data() || {} : {}
          const existingScreenshots = (locData.screenshots || []) as Array<Record<string, unknown>>
          const nextScreenshot = {
            id: translatedScreenshotId,
            position: task.screenshot.position,
            displayType: task.displayType,
            imageUrl: uploadedUrl,
            imageKey: key,
            fileName: buildTranslatedFileName(task),
            fileSize: imageBuffer.length,
            sourceScreenshotId: task.screenshot.id,
            sourceLocale: task.sourceLocale,
            sourceHash: generateHash(task.screenshot.marketingImageUrl + (task.screenshot.headline || "")),
            primaryUpdatedAt: task.screenshot.updatedAt || now,
            uploadedAt: now,
            translationProvider: translationResult.provider,
            translationModel: translationResult.model,
            translationMode: translationResult.instructionsUsed.translationMode,
            instructionsHash: translationResult.instructionsHash,
            instructionsUsed: translationResult.instructionsUsed,
          }

          const updatedScreenshots = existingScreenshots
            .filter(screenshot => {
              const sameId = screenshot.id === translatedScreenshotId
              const sameSource = screenshot.sourceScreenshotId === task.screenshot.id &&
                screenshot.displayType === task.displayType
              return !sameId && !sameSource
            })
            .concat(nextScreenshot)
            .sort((a, b) => Number(a.position || 0) - Number(b.position || 0))

          transaction.set(locRef, {
            locale: task.targetLocale,
            promotionalText: locData.promotionalText || null,
            appStoreLocalizationId: locData.appStoreLocalizationId || null,
            screenshots: updatedScreenshots,
          }, { merge: true })
          transaction.update(pageRef, {
            syncStatus: "local_changes",
            updatedAt: now,
          })
        })
      }

      const flushProgress = async () => {
        if (progressBuffer.length === 0) return

        // Check if cancelled
        const currentState = await jobRef.get()
        if (currentState.data()?.status === "cancelled") {
          isCancelled = true
          throw new Error("Job cancelled")
        }

        // Calculate per-locale increments from buffer
        const localeIncrements: Record<string, { success: number; failed: number }> = {}
        for (const result of progressBuffer) {
          if (!localeIncrements[result.locale]) {
            localeIncrements[result.locale] = { success: 0, failed: 0 }
          }
          if (result.success) {
            localeIncrements[result.locale].success++
          } else {
            localeIncrements[result.locale].failed++
          }
        }

        // Build update object with per-locale field increments
        const updateData: Record<string, any> = {
          "progress.current": processedCount,
          lastProcessedIndex: processedCount,
        }

        if (progressBuffer.length > 0) {
          updateData.results = FieldValue.arrayUnion(...progressBuffer)
        }

        // Add per-locale increments using dot notation
        for (const [locale, inc] of Object.entries(localeIncrements)) {
          if (inc.success > 0) {
            updateData[`progress.byLocale.${locale}.success`] = FieldValue.increment(inc.success)
          }
          if (inc.failed > 0) {
            updateData[`progress.byLocale.${locale}.failed`] = FieldValue.increment(inc.failed)
          }
        }

        await jobRef.update(updateData)
        progressBuffer.length = 0
        lastProgressUpdate = Date.now()
      }

      // Process in batches - with incremental progress updates
      for (let i = 0; i < remainingTasks.length; i += currentBatchSize) {
        const batch = remainingTasks.slice(i, i + currentBatchSize)

        // Track completed tasks for this batch with incremental progress
        let batchRateLimited = false
        const batchPromises = batch.map(async (task, taskIndex) => {
          try {
            // Quick cancel check every 5 tasks to avoid excessive Firestore reads
            if (taskIndex % 5 === 0) {
              const quickCancelCheck = await jobRef.get()
              if (quickCancelCheck.data()?.status === "cancelled") {
                isCancelled = true
                throw new Error("Job cancelled")
              }
            }

            // Check cancellation flag before proceeding
            if (isCancelled) {
              throw new Error("Job cancelled")
            }

            // Stagger task submissions for providers that need burst control.
            if (rateLimitConfig.taskSubmitDelay && taskIndex > 0) {
              await sleep(rateLimitConfig.taskSubmitDelay * taskIndex)
            }

            // Translate the screenshot using configured provider (kie.ai or fal.ai)
            // Resolve R2 public URL to signed URL for server-side access
            const resolvedSourceUrl = await resolveImageUrl(
              task.screenshot.marketingImageUrl,
              r2AccountId.value(),
              r2AccessKeyId.value(),
              r2SecretAccessKey.value(),
              r2BucketName.value(),
              r2PublicUrl.value()
            )
            console.log(`[${translationProvider}] Translating ${task.displayType}/${task.screenshot.id} to ${task.targetLocale} with ${translationModel}, source URL: ${task.screenshot.marketingImageUrl?.substring(0, 100)}...`)

            // Inline retry logic - retry immediately up to 3 times on failure
            const INLINE_RETRY_COUNT = 3
            let result: Awaited<ReturnType<typeof translateScreenshot>> | null = null
            let lastError = ""

            for (let attempt = 0; attempt < INLINE_RETRY_COUNT; attempt++) {
              if (attempt > 0) {
                console.log(`[${translationProvider}] Retry attempt ${attempt + 1}/${INLINE_RETRY_COUNT} for ${task.screenshot.id} to ${task.targetLocale}`)
                await sleep(2000 + attempt * 1000) // Wait 2s, 3s, 4s between retries
              }

              result = await translateScreenshot(
                resolvedSourceUrl,
                task.sourceLocale,
                task.targetLocale,
                task.screenshot,
                job.config.translateInAppText,
                job.config,
                translationProvider,
                translationModel,
                rateLimitConfig,
                falApiKey.value(),
                kieApiKey.value(),
                openaiApiKey.value()
              )

              if (result.success && result.imageBuffer) {
                if (attempt > 0) {
                  console.log(`[${translationProvider}] Retry succeeded on attempt ${attempt + 1} for ${task.screenshot.id}`)
                }
                break // Success, exit retry loop
              }

              lastError = result.error || "No image returned"
              console.warn(`[${translationProvider}] Attempt ${attempt + 1}/${INLINE_RETRY_COUNT} failed for ${task.screenshot.id}: ${lastError}`)
            }

            let taskResult: TranslationJob["results"][0]

            if (!result?.success || !result.imageBuffer) {
              console.error(`Translation failed after ${INLINE_RETRY_COUNT} attempts for ${task.displayType}/${task.screenshot.id}/${task.targetLocale}: ${lastError}`)
              taskResult = {
                locale: task.targetLocale,
                displayType: task.displayType,
                screenshotId: task.screenshot.id,
                success: false,
                error: lastError,
                provider: result?.provider || translationProvider,
                model: result?.model || translationModel,
                ...(result?.instructionsHash ? { instructionsHash: result.instructionsHash } : {}),
                completedAt: Timestamp.now(),
              }
            } else {
              // Resize to exact App Store dimensions for the display type
              const imageBuffer = await resizeToAppStoreDimensions(result.imageBuffer, task.displayType)

              const key = job.orgId
                ? `org/${job.orgId}/${job.projectId}/generated/translated-${task.displayType}-${task.screenshot.id}-${task.targetLocale}-${Date.now()}.jpg`
                : `user/${userId}/${job.projectId}/generated/translated-${task.displayType}-${task.screenshot.id}-${task.targetLocale}-${Date.now()}.jpg`

              const uploadedUrl = await uploadToR2(
                imageBuffer,
                key,
                "image/jpeg",
                r2AccountId.value(),
                r2AccessKeyId.value(),
                r2SecretAccessKey.value(),
                r2BucketName.value(),
                r2PublicUrl.value()
              )

              // Check cancel flag before writing to prevent orphaned data
              if (isCancelled) {
                throw new Error("Job cancelled")
              }

              await saveTranslatedScreenshot(task, uploadedUrl, key, imageBuffer, result)

              taskResult = {
                locale: task.targetLocale,
                displayType: task.displayType,
                screenshotId: task.screenshot.id,
                success: true,
                imageUrl: uploadedUrl,
                provider: result.provider,
                model: result.model,
                instructionsHash: result.instructionsHash,
                completedAt: Timestamp.now(),
              }
            }

            // INCREMENTAL PROGRESS: Update immediately when each task completes
            processedCount++
            progressBuffer.push(taskResult)
            results.push(taskResult)

            // Flush progress periodically to reduce Firestore writes (every 10 tasks or 10 seconds)
            if (progressBuffer.length >= 10 || Date.now() - lastProgressUpdate > 10000) {
              await flushProgress()
            }

            return taskResult
          } catch (error: any) {
            const errorMsg = error?.message || "Unknown error"
            if (errorMsg.includes("429") || errorMsg.includes("rate limit")) {
              batchRateLimited = true
            }

            const failResult: TranslationJob["results"][0] = {
              locale: task.targetLocale,
              displayType: task.displayType,
              screenshotId: task.screenshot.id,
              success: false,
              error: errorMsg,
              provider: translationProvider,
              model: translationModel,
              completedAt: Timestamp.now(),
            }

            processedCount++
            progressBuffer.push(failResult)
            results.push(failResult)

            return failResult
          }
        })

        // Wait for all tasks in batch to complete
        await Promise.allSettled(batchPromises)

        // Adjust batch size based on rate limiting
        if (batchRateLimited) {
          currentBatchSize = Math.max(rateLimitConfig.minBatchSize, Math.floor(currentBatchSize / 2))
        } else {
          currentBatchSize = Math.min(rateLimitConfig.maxBatchSize, currentBatchSize + 1)
        }

        // Final flush for any remaining items in buffer
        if (progressBuffer.length > 0) {
          await flushProgress()
        }

        // Add delay between batches to respect provider rate limits.
        if (translationProvider === "kie" && i + currentBatchSize < remainingTasks.length) {
          console.log(`Waiting 2s between batches to respect ${translationProvider} rate limits...`)
          await sleep(2000)
        }

        // Check for approaching timeout - create continuation job automatically
        if (isApproachingTimeout() && i + currentBatchSize < remainingTasks.length) {
          console.log(`Job ${job.id} approaching timeout after ${processedCount} tasks. Creating continuation job.`)
          await flushProgress()

          // Create continuation job to automatically continue processing
          const continuationJobRef = db
            .collection("users")
            .doc(userId)
            .collection("translationJobs")
            .doc()

          const rootJobId = job.rootJobId || job.id

          // Calculate remaining tasks per locale for continuation job
          const remainingByLocale: Record<string, { success: number; failed: number; total: number }> = {}
          for (const task of tasks.slice(processedCount)) {
            if (!remainingByLocale[task.targetLocale]) {
              remainingByLocale[task.targetLocale] = { success: 0, failed: 0, total: 0 }
            }
            remainingByLocale[task.targetLocale].total++
          }

          const continuationJob: TranslationJob = {
            id: continuationJobRef.id,
            userId,
            ...(job.orgId ? { orgId: job.orgId } : {}),
            projectId: job.projectId,
            status: "pending",
            config: job.config,
            progress: {
              current: 0,
              total: tasks.length - processedCount, // Remaining tasks
              byLocale: remainingByLocale,
            },
            results: [],
            createdAt: Timestamp.now(),
            retryCount: 0,
            lastProcessedIndex: processedCount, // Start from where we left off
            continuationOf: job.id,
            rootJobId,
            chainIndex: chainLength + 1, // Track position in chain
          }

          await continuationJobRef.set(continuationJob)

          // Record successful weighted image credits before handing off. The
          // reservation remains open until the final continuation settles it.
          const segmentSuccessCount = results.filter(r => r.success).length
          await recordUsageSegment(job, jobRef, segmentSuccessCount)

          // Mark current job as completed (handed off to continuation)
          await jobRef.update({
            status: "completed",
            continuedBy: continuationJobRef.id,
            completedAt: Timestamp.now(),
          })

          console.log(`Job ${job.id} handed off to continuation job ${continuationJobRef.id} (${segmentSuccessCount} successful images recorded)`)
          return
        }

        // Small delay between batches for fal.ai
        if (i + currentBatchSize < remainingTasks.length) {
          await sleep(500) // 500ms between batches
        }
      }

      // Final flush
      await flushProgress()

      // ============================================================================
      // RETRY FAILED TRANSLATIONS
      // ============================================================================
      // Retry failed translations up to 3 more times before giving up
      // This helps with transient failures (network issues, rate limits, AI hiccups)
      const MAX_RETRY_ROUNDS = 3
      let retryRound = 0

      while (retryRound < MAX_RETRY_ROUNDS) {
        // Check for timeout before retry round
        if (isApproachingTimeout()) {
          console.log(`Skipping retry round ${retryRound + 1} - approaching timeout`)
          break
        }

        // Find failed results that we can retry
        const failedResults = results.filter(r => !r.success)
        if (failedResults.length === 0) {
          console.log("No failed translations to retry")
          break
        }

        console.log(`Retry round ${retryRound + 1}: Retrying ${failedResults.length} failed translations...`)

        // Wait before retry to let rate limits reset
        await sleep(5000)

        // Build retry tasks from failed results
        const retryTasks: TranslationTask[] = []
        for (const failed of failedResults) {
          // Find the original task
          const originalTask = tasks.find(t =>
            t.screenshot.id === failed.screenshotId &&
            t.targetLocale === failed.locale &&
            t.displayType === failed.displayType
          )
          if (originalTask) {
            retryTasks.push(originalTask)
          }
        }

        if (retryTasks.length === 0) break

        // Process retries with smaller batch size
        const retryBatchSize = Math.min(10, currentBatchSize)
        for (let i = 0; i < retryTasks.length; i += retryBatchSize) {
          const batch = retryTasks.slice(i, i + retryBatchSize)

          const retryPromises = batch.map(async (task, taskIndex) => {
            // Stagger submissions for providers that need burst control.
            if (rateLimitConfig.taskSubmitDelay && taskIndex > 0) {
              await sleep(rateLimitConfig.taskSubmitDelay * taskIndex)
            }

            // Resolve R2 public URL to signed URL for server-side access
            const resolvedRetryUrl = await resolveImageUrl(
              task.screenshot.marketingImageUrl,
              r2AccountId.value(),
              r2AccessKeyId.value(),
              r2SecretAccessKey.value(),
              r2BucketName.value(),
              r2PublicUrl.value()
            )
            console.log(`[RETRY] Translating ${task.displayType}/${task.screenshot.id} to ${task.targetLocale}...`)
            const result = await translateScreenshot(
              resolvedRetryUrl,
              task.sourceLocale,
              task.targetLocale,
              task.screenshot,
              job.config.translateInAppText,
              job.config,
              translationProvider,
              translationModel,
              rateLimitConfig,
              falApiKey.value(),
              kieApiKey.value(),
              openaiApiKey.value()
            )

            if (!result.success || !result.imageBuffer) {
              console.error(`[RETRY] Still failed: ${task.displayType}/${task.screenshot.id}/${task.targetLocale}: ${result.error}`)
              return null // Still failed
            }

            // Success on retry - process and save
            const imageBuffer = await resizeToAppStoreDimensions(result.imageBuffer, task.displayType)
            const key = job.orgId
              ? `org/${job.orgId}/${job.projectId}/generated/translated-${task.displayType}-${task.screenshot.id}-${task.targetLocale}-${Date.now()}.jpg`
              : `user/${userId}/${job.projectId}/generated/translated-${task.displayType}-${task.screenshot.id}-${task.targetLocale}-${Date.now()}.jpg`

            const uploadedUrl = await uploadToR2(
              imageBuffer,
              key,
              "image/jpeg",
              r2AccountId.value(),
              r2AccessKeyId.value(),
              r2SecretAccessKey.value(),
              r2BucketName.value(),
              r2PublicUrl.value()
            )

            // Check cancel flag before writing to prevent orphaned data
            if (isCancelled) {
              throw new Error("Job cancelled")
            }

            await saveTranslatedScreenshot(task, uploadedUrl, key, imageBuffer, result)

            // Update the result in our results array
            const resultIndex = results.findIndex(r =>
              r.screenshotId === task.screenshot.id &&
              r.locale === task.targetLocale &&
              r.displayType === task.displayType
            )
            if (resultIndex >= 0) {
              results[resultIndex] = {
                locale: task.targetLocale,
                displayType: task.displayType,
                screenshotId: task.screenshot.id,
                success: true,
                imageUrl: uploadedUrl,
                provider: result.provider,
                model: result.model,
                instructionsHash: result.instructionsHash,
                completedAt: Timestamp.now(),
              }
            }

            console.log(`[RETRY] Success: ${task.displayType}/${task.screenshot.id}/${task.targetLocale}`)
            return { task, uploadedUrl }
          })

          await Promise.allSettled(retryPromises)

          // Small delay between retry batches
          if (i + retryBatchSize < retryTasks.length) {
            await sleep(2000)
          }
        }

        retryRound++
      }

      // Update job with final results
      await jobRef.update({
        results: results,
      })

      // Update project sync status
      if (customPage?.type !== "customProductPage") {
        await projectBasePath.update({
          screenshotSyncStatus: "local_changes",
          updatedAt: Timestamp.now(),
        })
      } else {
        await projectBasePath.update({
          updatedAt: Timestamp.now(),
        })
      }

      // Mark completed
      const successCount = results.filter(r => r.success).length
      const failCount = results.filter(r => !r.success).length

      await finalizeUsageReservation(job, jobRef, successCount)

      await jobRef.update({
        status: "completed",
        completedAt: Timestamp.now(),
        progress: {
          current: tasks.length,
          total: tasks.length,
        },
      })

      console.log(`Job ${job.id} completed: ${successCount} success, ${failCount} failed`)
    } catch (error) {
      console.error(`Job ${job.id} failed:`, error)

      const successCount = results.filter(result => result.success).length
      await finalizeUsageReservation(job, jobRef, successCount)

      if ((error as Error).message === "Job cancelled") {
        return // Already marked as cancelled
      }

      await jobRef.update({
        status: "failed",
        error: error instanceof Error ? error.message : "Unknown error",
        completedAt: Timestamp.now(),
      })
    }
  }
)
