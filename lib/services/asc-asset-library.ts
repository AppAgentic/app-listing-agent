// App Store Connect Asset Library client (API 4.5.1).
//
// Replaces screenshot sets: upload each image once into the app's library, then
// place it on a localization (version, custom product page or experiment
// treatment) and order the placements with an ordering request.
// Plan: docs/plans/screenshots/asset-library-migration.md
//
// This file is mirrored byte-for-byte into functions/src/ascAssetLibrary.ts
// (functions is a separate package). Keep it free of imports other than Node
// built-ins; __tests__/asc-asset-library.test.ts fails if the copies differ.

import crypto from "crypto"

const ASC_API = "https://api.appstoreconnect.apple.com"

/** Makes an authenticated ASC API request (AppStoreHelper / AppStoreUploader `makeApiRequest`). */
export type AscRequest = (method: string, url: string, body?: object) => Promise<Response>

export type PlacementType = "APP_SCREENSHOT" | "IMESSAGE_APP_SCREENSHOT" | "APP_PREVIEW" | (string & {})

export type PlacementTargetKind =
  | "appStoreVersionLocalization"
  | "appCustomProductPageLocalization"
  | "appStoreVersionExperimentTreatmentLocalization"

export interface PlacementTarget {
  kind: PlacementTargetKind
  id: string
}

const TARGET_TYPES: Record<PlacementTargetKind, string> = {
  appStoreVersionLocalization: "appStoreVersionLocalizations",
  appCustomProductPageLocalization: "appCustomProductPageLocalizations",
  appStoreVersionExperimentTreatmentLocalization: "appStoreVersionExperimentTreatmentLocalizations",
}

// Asset states. Live data also returns states missing from Apple's spec enum
// (placements report ACTIVE), so anything not pending or failed counts as ready.
const PENDING_ASSET_STATES = new Set(["AWAITING_UPLOAD", "UPLOAD_COMPLETE"])
const FAILED_ASSET_STATES = new Set(["FAILED", "REJECTED"])
const UNUSABLE_ASSET_STATES = new Set([...PENDING_ASSET_STATES, ...FAILED_ASSET_STATES, "ARCHIVED"])

export class AscLibraryError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: string,
  ) {
    super(message)
    this.name = "AscLibraryError"
  }
}

async function toError(response: Response, action: string): Promise<AscLibraryError> {
  const text = await response.text().catch(() => "")
  let code: string | undefined
  let detail = text
  try {
    const first = JSON.parse(text)?.errors?.[0]
    code = first?.code
    detail = first?.detail || first?.title || text
  } catch {
    // not JSON
  }
  return new AscLibraryError(`${action} failed (${response.status}): ${detail}`, response.status, code)
}

// ---------------------------------------------------------------------------
// Reference data catalog
// ---------------------------------------------------------------------------

export interface ImageSpec {
  specId: string
  shortName: string
  minWidth: number
  maxWidth: number
  minHeight: number
  maxHeight: number
  alphaAllowed: boolean
  mimeTypes: string[]
  maxFileSize?: number
}

export interface PlacementCatalog {
  /** placementGroupId → { platform, displayClassId } */
  groups: Map<string, { platform: string; displayClassId: string }>
  /** placementType → placementGroupId → specIds */
  specMappings: Map<string, Map<string, string[]>>
  imageSpecs: Map<string, ImageSpec>
  /** `${feature}:${placementType}:${group}` → maxCount */
  maxCounts: Map<string, number>
}

interface RefDatumAttributes {
  features?: Array<{
    featureId: string
    placementPolicies?: Array<{ placementType: string; groupLimits?: Array<{ groupIds?: string[]; maxCount?: number }> }>
  }>
  placementProfileGroups?: Array<{ placementProfileGroupId: string; platform: string; displayClassId: string }>
  imageSpecs?: Array<{
    specId: string
    shortName?: string
    dimensions?: { minWidth?: number; maxWidth?: number; minHeight?: number; maxHeight?: number }
    alphaAllowed?: boolean
    mimeTypes?: string[]
    maxFileSize?: number
  }>
  placementTypes?: Array<{ placementTypeId: string; specMappings?: Array<{ placementGroupId: string; specs?: string[] }> }>
}

export function buildCatalog(attributes: RefDatumAttributes): PlacementCatalog {
  const groups = new Map<string, { platform: string; displayClassId: string }>()
  for (const g of attributes.placementProfileGroups ?? []) {
    groups.set(g.placementProfileGroupId, { platform: g.platform, displayClassId: g.displayClassId })
  }

  const specMappings = new Map<string, Map<string, string[]>>()
  for (const pt of attributes.placementTypes ?? []) {
    const byGroup = specMappings.get(pt.placementTypeId) ?? new Map<string, string[]>()
    for (const m of pt.specMappings ?? []) {
      byGroup.set(m.placementGroupId, [...(byGroup.get(m.placementGroupId) ?? []), ...(m.specs ?? [])])
    }
    specMappings.set(pt.placementTypeId, byGroup)
  }

  const imageSpecs = new Map<string, ImageSpec>()
  for (const s of attributes.imageSpecs ?? []) {
    const d = s.dimensions ?? {}
    imageSpecs.set(s.specId, {
      specId: s.specId,
      shortName: s.shortName ?? s.specId,
      minWidth: d.minWidth ?? 0,
      maxWidth: d.maxWidth ?? Number.MAX_SAFE_INTEGER,
      minHeight: d.minHeight ?? 0,
      maxHeight: d.maxHeight ?? Number.MAX_SAFE_INTEGER,
      alphaAllowed: s.alphaAllowed ?? true,
      mimeTypes: s.mimeTypes ?? [],
      maxFileSize: s.maxFileSize,
    })
  }

  const maxCounts = new Map<string, number>()
  for (const f of attributes.features ?? []) {
    for (const p of f.placementPolicies ?? []) {
      for (const limit of p.groupLimits ?? []) {
        if (typeof limit.maxCount !== "number") continue
        for (const groupId of limit.groupIds ?? []) {
          maxCounts.set(`${f.featureId}:${p.placementType}:${groupId}`, limit.maxCount)
        }
      }
    }
  }

  return { groups, specMappings, imageSpecs, maxCounts }
}

/** Image specs of a placement group that accept an image of this size. */
export function matchingSpecs(
  catalog: PlacementCatalog,
  placementType: PlacementType,
  group: string,
  width: number,
  height: number,
): ImageSpec[] {
  const specIds = catalog.specMappings.get(placementType)?.get(group) ?? []
  return specIds
    .map(id => catalog.imageSpecs.get(id))
    .filter((s): s is ImageSpec =>
      !!s && width >= s.minWidth && width <= s.maxWidth && height >= s.minHeight && height <= s.maxHeight)
}

/** Every placement group whose specs accept an image of this size. */
export function groupsForDimensions(
  catalog: PlacementCatalog,
  placementType: PlacementType,
  width: number,
  height: number,
): string[] {
  const groups = [...(catalog.specMappings.get(placementType)?.keys() ?? [])]
  return groups.filter(g => matchingSpecs(catalog, placementType, g, width, height).length > 0)
}

// Legacy screenshot display types → Asset Library display classes. Only used to
// pick between groups that accept the same pixel size (e.g. 2048×2732 fits both
// the 13" and 12.9" iPad groups); the groups themselves come from reference data.
const LEGACY_DISPLAY_CLASS: Record<string, string> = {
  APP_IPHONE_67: "IPHONE_DYNAMIC_ISLAND_LARGE_DISPLAY",
  APP_IPHONE_65: "IPHONE_FACE_ID_LARGE_DISPLAY",
  APP_IPHONE_61: "IPHONE_DYNAMIC_ISLAND_MEDIUM_DISPLAY",
  APP_IPHONE_58: "IPHONE_FACE_ID_MEDIUM_DISPLAY",
  APP_IPHONE_55: "IPHONE_HOME_BUTTON_LARGE_DISPLAY",
  APP_IPHONE_47: "IPHONE_HOME_BUTTON_MEDIUM_DISPLAY",
  APP_IPHONE_40: "IPHONE_HOME_BUTTON_40_DISPLAY",
  APP_IPHONE_35: "IPHONE_HOME_BUTTON_35_DISPLAY",
  APP_IPAD_PRO_3GEN_129: "IPAD_13_DISPLAY",
  APP_IPAD_PRO_129: "IPAD_129_DISPLAY",
  APP_IPAD_PRO_3GEN_11: "IPAD_11_DISPLAY",
  APP_IPAD_105: "IPAD_105_DISPLAY",
  APP_IPAD_97: "IPAD_97_DISPLAY",
  APP_WATCH_ULTRA: "WATCH_ULTRA",
  APP_WATCH_ULTRA_3: "WATCH_ULTRA",
  APP_WATCH_SERIES_10: "WATCH_SERIES_10",
  APP_WATCH_SERIES_7: "WATCH_SERIES_7",
  APP_WATCH_SERIES_4: "WATCH_SERIES_4",
  APP_WATCH_SERIES_3: "WATCH_SERIES_3",
  IPHONE_DUO: "IPHONE_DUO",
}

const LEGACY_PLATFORM_DISPLAY_CLASS: Record<string, string> = {
  APP_DESKTOP: "MAC_APP_STORE",
  APP_APPLE_TV: "TV_APP_STORE",
  APP_APPLE_VISION_PRO: "VISION_PRO_APP_STORE",
}

/** Placement group that corresponds to a legacy screenshot display type, if any. */
export function groupForLegacyDisplayType(catalog: PlacementCatalog, displayType: string): string | null {
  const displayClass = LEGACY_DISPLAY_CLASS[displayType]
  const platform = LEGACY_PLATFORM_DISPLAY_CLASS[displayType]
  for (const [groupId, g] of catalog.groups) {
    if (displayClass && g.displayClassId === displayClass) return groupId
    if (platform && g.platform === platform) return groupId
  }
  return null
}

/**
 * Legacy screenshot display type for a placement group, so library reads keep
 * the shape our screenshot model uses. Null for groups with no legacy type
 * (iPhone Duo).
 */
export function legacyDisplayTypeForGroup(catalog: PlacementCatalog, group: string): string | null {
  const g = catalog.groups.get(group)
  if (!g) return null
  for (const [legacy, displayClass] of Object.entries(LEGACY_DISPLAY_CLASS)) {
    if (legacy.startsWith("APP_") && displayClass === g.displayClassId && g.displayClassId !== "DEFAULT") return legacy
  }
  for (const [legacy, platform] of Object.entries(LEGACY_PLATFORM_DISPLAY_CLASS)) {
    if (platform === g.platform) return legacy
  }
  return null
}

/**
 * Picks the placement group for an image. Uses the legacy display type when its
 * group accepts the image size, otherwise the only group that does. Throws when
 * no group accepts the size, or several do and nothing breaks the tie.
 */
export function resolvePlacementGroup(
  catalog: PlacementCatalog,
  placementType: PlacementType,
  image: { width: number; height: number; legacyDisplayType?: string },
): string {
  const candidates = groupsForDimensions(catalog, placementType, image.width, image.height)
  const preferred = image.legacyDisplayType ? groupForLegacyDisplayType(catalog, image.legacyDisplayType) : null
  if (preferred && candidates.includes(preferred)) return preferred
  if (candidates.length === 1) return candidates[0]
  if (candidates.length === 0) {
    throw new AscLibraryError(
      `No ${placementType} placement group accepts ${image.width}×${image.height}`,
      undefined,
      "NO_MATCHING_GROUP",
    )
  }
  throw new AscLibraryError(
    `${image.width}×${image.height} fits several groups (${candidates.join(", ")}); pass a display type`,
    undefined,
    "AMBIGUOUS_GROUP",
  )
}

// ---------------------------------------------------------------------------
// Image header inspection (PNG / JPEG), no dependencies
// ---------------------------------------------------------------------------

export interface ImageInfo {
  width: number
  height: number
  mimeType: "image/png" | "image/jpeg"
  /** PNG colour type 4/6 or a tRNS chunk. JPEG never has alpha. */
  hasAlpha: boolean
}

export function readImageInfo(data: Buffer): ImageInfo | null {
  if (data.length >= 33 && data.readUInt32BE(0) === 0x89504e47) {
    const colorType = data[25]
    let hasAlpha = colorType === 4 || colorType === 6
    if (!hasAlpha) {
      // tRNS must come before IDAT
      let offset = 8
      while (offset + 8 <= data.length) {
        const length = data.readUInt32BE(offset)
        const type = data.toString("ascii", offset + 4, offset + 8)
        if (type === "tRNS") { hasAlpha = true; break }
        if (type === "IDAT" || type === "IEND") break
        offset += 12 + length
      }
    }
    return { width: data.readUInt32BE(16), height: data.readUInt32BE(20), mimeType: "image/png", hasAlpha }
  }
  if (data.length >= 4 && data[0] === 0xff && data[1] === 0xd8) {
    let offset = 2
    while (offset + 9 < data.length) {
      if (data[offset] !== 0xff) { offset++; continue }
      const marker = data[offset + 1]
      const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
      if (isSof) {
        return { height: data.readUInt16BE(offset + 5), width: data.readUInt16BE(offset + 7), mimeType: "image/jpeg", hasAlpha: false }
      }
      offset += 2 + data.readUInt16BE(offset + 2)
    }
  }
  return null
}

/**
 * Problems Apple would reject an image for in this group (size, alpha, type,
 * file size), checked before uploading. Empty means it should pass.
 */
export function preflightImage(
  catalog: PlacementCatalog,
  placementType: PlacementType,
  group: string,
  data: Buffer,
): string[] {
  const info = readImageInfo(data)
  if (!info) return ["Not a PNG or JPEG image"]
  const specs = matchingSpecs(catalog, placementType, group, info.width, info.height)
  if (specs.length === 0) return [`${info.width}×${info.height} is not an accepted size for ${group}`]
  const usable = specs.filter(s =>
    (s.alphaAllowed || !info.hasAlpha) &&
    (s.mimeTypes.length === 0 || s.mimeTypes.includes(info.mimeType)) &&
    (!s.maxFileSize || data.length <= s.maxFileSize))
  if (usable.length > 0) return []
  const problems: string[] = []
  if (info.hasAlpha && specs.every(s => !s.alphaAllowed)) problems.push(`${group} does not accept images with transparency; flatten the alpha channel`)
  if (specs.every(s => s.mimeTypes.length > 0 && !s.mimeTypes.includes(info.mimeType))) problems.push(`${info.mimeType} is not accepted for ${group}`)
  if (specs.every(s => s.maxFileSize && data.length > s.maxFileSize)) problems.push(`File is larger than ${group} allows`)
  return problems.length > 0 ? problems : [`Image does not satisfy any ${group} spec`]
}

// ---------------------------------------------------------------------------
// Placement diff (pure)
// ---------------------------------------------------------------------------

export interface ExistingPlacement {
  id: string
  assetId: string | null
}

export interface PlacementPlan {
  /** Existing placements to delete (not wanted, or extra copies). */
  remove: string[]
  /** Positions in the desired list that need a new placement. */
  create: Array<{ index: number; assetId: string }>
  /** Existing placement id kept for each desired position, or null where one is created. */
  keep: Array<string | null>
  /** True when the current placements already match the desired assets in order. */
  unchanged: boolean
}

/**
 * Plans the changes that turn `existing` (in placementGroupPosition order) into
 * `desiredAssetIds` (in display order). Existing placements are reused per
 * asset, first come first served, so reorders never re-create placements.
 */
export function planPlacements(existing: ExistingPlacement[], desiredAssetIds: string[]): PlacementPlan {
  const unchanged =
    existing.length === desiredAssetIds.length &&
    existing.every((p, i) => p.assetId === desiredAssetIds[i])

  const available = new Map<string, string[]>()
  for (const p of existing) {
    if (!p.assetId) continue
    available.set(p.assetId, [...(available.get(p.assetId) ?? []), p.id])
  }

  const keep: Array<string | null> = []
  const create: Array<{ index: number; assetId: string }> = []
  desiredAssetIds.forEach((assetId, index) => {
    const reused = available.get(assetId)?.shift()
    if (reused) keep.push(reused)
    else { keep.push(null); create.push({ index, assetId }) }
  })

  const kept = new Set(keep.filter((id): id is string => !!id))
  const remove = existing.map(p => p.id).filter(id => !kept.has(id))
  return { remove, create, keep, unchanged }
}

// ---------------------------------------------------------------------------
// Dedupe index: md5 of the file → library asset id
// ---------------------------------------------------------------------------

export interface AssetIndex {
  get(md5: string): Promise<string | null>
  set(md5: string, assetId: string): Promise<void>
}

export function memoryAssetIndex(): AssetIndex {
  const map = new Map<string, string>()
  return {
    async get(md5) { return map.get(md5) ?? null },
    async set(md5, assetId) { map.set(md5, assetId) },
  }
}

/** Minimal Firestore collection shape (firebase-admin CollectionReference satisfies it). */
export interface AssetIndexCollection {
  doc(id: string): {
    get(): Promise<{ exists: boolean; data(): { assetId?: string } | undefined }>
    set(data: { assetId: string; updatedAt: Date }, options: { merge: boolean }): Promise<unknown>
  }
}

/** Index stored one doc per file (doc id = md5 hex) in a server-only collection. */
export function firestoreAssetIndex(collection: AssetIndexCollection): AssetIndex {
  return {
    async get(md5) {
      const snap = await collection.doc(md5).get()
      return snap.exists ? snap.data()?.assetId ?? null : null
    },
    async set(md5, assetId) {
      await collection.doc(md5).set({ assetId, updatedAt: new Date() }, { merge: true })
    },
  }
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export interface LibraryImage {
  id: string
  state: string
  specId?: string
  fileName?: string
  templateUrl?: string
  width?: number
  height?: number
  stateDetails?: unknown
}

export interface Placement {
  id: string
  placementGroup: string
  placementType: string
  state?: string
  assetId: string | null
  image?: LibraryImage
}

export interface UploadImageInput {
  fileName: string
  data: Buffer
  placementType?: PlacementType
  /** When set, the processed asset's specId must belong to this group. */
  expectedGroup?: string
  referenceName?: string
}

export interface UploadImageResult {
  assetId: string
  specId?: string
  reused: boolean
}

export interface SyncResult {
  unchanged: boolean
  created: number
  removed: number
  reordered: boolean
  placementIds: string[]
}

export interface AssetLibraryClientOptions {
  request: AscRequest
  appId: string
  assetIndex?: AssetIndex
  /** Used for the presigned upload-operation PUTs. Defaults to global fetch. */
  fetchImpl?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  pollIntervalMs?: number
  pollTimeoutMs?: number
  log?: (message: string) => void
}

const REF_DATA_TTL_MS = 24 * 60 * 60 * 1000
const refDataCache = new Map<string, { at: number; catalog: PlacementCatalog }>()

/** Clears the module-level reference data cache (tests). */
export function clearRefDataCache(): void {
  refDataCache.clear()
}

function featureForTarget(kind: PlacementTargetKind): string {
  if (kind === "appCustomProductPageLocalization") return "CUSTOM_PRODUCT_PAGES"
  if (kind === "appStoreVersionExperimentTreatmentLocalization") return "PRODUCT_PAGE_OPTIMIZATIONS"
  return "APP_STORE_VERSIONS"
}

function parseImage(resource: { id: string; attributes?: Record<string, unknown> } | undefined): LibraryImage | undefined {
  if (!resource) return undefined
  const a = (resource.attributes ?? {}) as {
    state?: string
    specId?: string
    fileName?: string
    stateDetails?: unknown
    imageAsset?: { templateUrl?: string; width?: number; height?: number }
  }
  return {
    id: resource.id,
    state: a.state ?? "UNKNOWN",
    specId: a.specId,
    fileName: a.fileName,
    templateUrl: a.imageAsset?.templateUrl,
    width: a.imageAsset?.width,
    height: a.imageAsset?.height,
    stateDetails: a.stateDetails,
  }
}

export class AscAssetLibraryClient {
  private readonly request: AscRequest
  private readonly appId: string
  private readonly assetIndex: AssetIndex
  private readonly fetchImpl: typeof fetch
  private readonly sleep: (ms: number) => Promise<void>
  private readonly pollIntervalMs: number
  private readonly pollTimeoutMs: number
  private readonly log: (message: string) => void
  private libraryId: string | null = null

  constructor(options: AssetLibraryClientOptions) {
    this.request = options.request
    this.appId = options.appId
    this.assetIndex = options.assetIndex ?? memoryAssetIndex()
    this.fetchImpl = options.fetchImpl ?? fetch
    this.sleep = options.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)))
    this.pollIntervalMs = options.pollIntervalMs ?? 2000
    this.pollTimeoutMs = options.pollTimeoutMs ?? 120000
    this.log = options.log ?? (() => {})
  }

  /** The library id is stable for the life of the app (it equals the app id today). */
  async getLibraryId(): Promise<string> {
    if (this.libraryId) return this.libraryId
    const response = await this.request("GET", `${ASC_API}/v1/apps/${this.appId}/assetLibrary`)
    if (!response.ok) throw await toError(response, "Read asset library")
    const json = await response.json()
    this.libraryId = json.data.id as string
    return this.libraryId
  }

  /** Reference data for one placement type, cached for a day per process. */
  async getCatalog(placementType: PlacementType = "APP_SCREENSHOT"): Promise<PlacementCatalog> {
    const cached = refDataCache.get(placementType)
    if (cached && Date.now() - cached.at < REF_DATA_TTL_MS) return cached.catalog
    const url = `${ASC_API}/v1/appAssetLibraryRefData?filter%5BplacementTypes%5D=${encodeURIComponent(placementType)}`
    const response = await this.request("GET", url)
    if (!response.ok) throw await toError(response, "Read asset library reference data")
    const json = await response.json()
    const data = Array.isArray(json.data) ? json.data[0] : json.data
    const catalog = buildCatalog(data?.attributes ?? {})
    refDataCache.set(placementType, { at: Date.now(), catalog })
    return catalog
  }

  async getImage(assetId: string): Promise<LibraryImage | null> {
    const response = await this.request("GET", `${ASC_API}/v1/appAssetLibraryImages/${assetId}`)
    if (response.status === 404) return null
    if (!response.ok) throw await toError(response, "Read library image")
    return parseImage((await response.json()).data) ?? null
  }

  /**
   * Uploads an image once per distinct file: reuses the indexed asset when it
   * still exists, otherwise reserve → upload parts → commit `uploaded: true` →
   * wait for processing → check the matched spec belongs to `expectedGroup`.
   */
  async uploadImage(input: UploadImageInput): Promise<UploadImageResult> {
    const placementType = input.placementType ?? "APP_SCREENSHOT"
    const md5 = crypto.createHash("md5").update(input.data).digest("hex")

    const indexedId = await this.assetIndex.get(md5)
    if (indexedId) {
      const existing = await this.getImage(indexedId)
      if (existing && !UNUSABLE_ASSET_STATES.has(existing.state)) {
        await this.checkSpec(existing, placementType, input.expectedGroup)
        return { assetId: existing.id, specId: existing.specId, reused: true }
      }
    }

    const libraryId = await this.getLibraryId()
    const reserve = await this.request("POST", `${ASC_API}/v1/appAssetLibraryImages`, {
      data: {
        type: "appAssetLibraryImages",
        attributes: {
          category: "APP_SCREENSHOTS_AND_PREVIEWS",
          fileName: input.fileName,
          fileSize: input.data.length,
          ...(input.referenceName ? { referenceName: input.referenceName } : {}),
        },
        relationships: { assetLibrary: { data: { type: "appAssetLibraries", id: libraryId } } },
      },
    })
    if (!reserve.ok) throw await toError(reserve, `Reserve ${input.fileName}`)
    const reserved = (await reserve.json()).data
    const assetId = reserved.id as string

    const operations = (reserved.attributes?.uploadOperations ?? []) as Array<{
      method?: string
      url: string
      offset?: number
      length?: number
      requestHeaders?: Array<{ name: string; value: string }>
    }>
    if (operations.length === 0) throw new AscLibraryError(`No upload operations for ${input.fileName}`)
    for (const op of operations) {
      const offset = op.offset ?? 0
      const chunk = input.data.subarray(offset, offset + (op.length ?? input.data.length - offset))
      const headers: Record<string, string> = {}
      for (const h of op.requestHeaders ?? []) headers[h.name] = h.value
      let lastStatus = 0
      for (let attempt = 0; attempt < 3; attempt++) {
        const put = await this.fetchImpl(op.url, { method: op.method ?? "PUT", headers, body: new Uint8Array(chunk) })
        lastStatus = put.status
        if (put.ok) break
        if (attempt < 2) await this.sleep(1000 * (attempt + 1))
      }
      if (lastStatus < 200 || lastStatus >= 300) {
        throw new AscLibraryError(`Upload part of ${input.fileName} failed (${lastStatus})`, lastStatus)
      }
    }

    const commit = await this.request("PATCH", `${ASC_API}/v1/appAssetLibraryImages/${assetId}`, {
      data: { type: "appAssetLibraryImages", id: assetId, attributes: { uploaded: true } },
    })
    if (!commit.ok) throw await toError(commit, `Commit ${input.fileName}`)

    const processed = await this.waitForProcessing(assetId, input.fileName)
    await this.assetIndex.set(md5, assetId)
    await this.checkSpec(processed, placementType, input.expectedGroup)
    this.log(`Uploaded ${input.fileName} → ${assetId} (${processed.state})`)
    return { assetId, specId: processed.specId, reused: false }
  }

  private async waitForProcessing(assetId: string, fileName: string): Promise<LibraryImage> {
    const deadline = Date.now() + this.pollTimeoutMs
    for (;;) {
      const image = await this.getImage(assetId)
      if (!image) throw new AscLibraryError(`${fileName} disappeared while processing`, 404)
      if (FAILED_ASSET_STATES.has(image.state)) {
        throw new AscLibraryError(
          `${fileName} failed processing: ${JSON.stringify(image.stateDetails ?? image.state)}`,
          undefined,
          "ASSET_FAILED",
        )
      }
      if (!PENDING_ASSET_STATES.has(image.state)) return image
      if (Date.now() >= deadline) {
        throw new AscLibraryError(`${fileName} still processing after ${this.pollTimeoutMs} ms`, undefined, "ASSET_TIMEOUT")
      }
      await this.sleep(this.pollIntervalMs)
    }
  }

  private async checkSpec(image: LibraryImage, placementType: PlacementType, group?: string): Promise<void> {
    if (!group || !image.specId) return
    const catalog = await this.getCatalog(placementType)
    const specs = catalog.specMappings.get(placementType)?.get(group) ?? []
    if (!specs.includes(image.specId)) {
      const name = catalog.imageSpecs.get(image.specId)?.shortName ?? image.specId
      throw new AscLibraryError(`${image.fileName ?? image.id} matched spec ${name}, which ${group} does not accept`, undefined, "SPEC_MISMATCH")
    }
  }

  /** Placements of one group on a localization, in display order. */
  async listPlacements(target: PlacementTarget, placementType: PlacementType, group?: string): Promise<Placement[]> {
    const params = new URLSearchParams({
      "filter[placementType]": placementType,
      sort: "placementGroupPosition",
      include: "image",
      "fields[appAssetLibraryImages]": "fileName,imageAsset,specId,state,stateDetails",
      limit: "200",
    })
    if (group) params.set("filter[placementGroup]", group)
    let url: string | null = `${ASC_API}/v1/${TARGET_TYPES[target.kind]}/${target.id}/placements?${params}`
    const placements: Placement[] = []
    while (url) {
      const response = await this.request("GET", url)
      if (!response.ok) throw await toError(response, "Read placements")
      const json = await response.json()
      const images = new Map<string, LibraryImage>()
      for (const inc of json.included ?? []) {
        const img = inc.type === "appAssetLibraryImages" ? parseImage(inc) : undefined
        if (img) images.set(img.id, img)
      }
      for (const p of json.data ?? []) {
        const assetId = (p.relationships?.image?.data?.id as string | undefined) ?? null
        placements.push({
          id: p.id,
          placementGroup: p.attributes?.placementGroup,
          placementType: p.attributes?.placementType,
          state: p.attributes?.state,
          assetId,
          image: assetId ? images.get(assetId) : undefined,
        })
      }
      url = json.links?.next ?? null
    }
    return placements
  }

  /**
   * Makes a group's placements on a localization exactly `assetIdsInOrder`:
   * deletes unwanted placements first (stays under the group limit), creates
   * missing ones, posts one ordering request, then reads back to verify.
   * Does nothing when already identical. Never deletes library assets.
   */
  async syncPlacements(
    target: PlacementTarget,
    placementType: PlacementType,
    group: string,
    assetIdsInOrder: string[],
  ): Promise<SyncResult> {
    const catalog = await this.getCatalog(placementType)
    const maxCount = catalog.maxCounts.get(`${featureForTarget(target.kind)}:${placementType}:${group}`)
    if (maxCount !== undefined && assetIdsInOrder.length > maxCount) {
      throw new AscLibraryError(`${group} allows at most ${maxCount} items, got ${assetIdsInOrder.length}`, undefined, "TOO_MANY_PLACEMENTS")
    }

    const existing = await this.listPlacements(target, placementType, group)
    const plan = planPlacements(existing, assetIdsInOrder)
    if (plan.unchanged) {
      return { unchanged: true, created: 0, removed: 0, reordered: false, placementIds: existing.map(p => p.id) }
    }

    for (const id of plan.remove) {
      const response = await this.request("DELETE", `${ASC_API}/v1/appAssetLibraryPlacements/${id}`)
      if (!response.ok && response.status !== 404) throw await toError(response, "Delete placement")
    }

    const placementIds = [...plan.keep]
    for (const { index, assetId } of plan.create) {
      const response = await this.request("POST", `${ASC_API}/v1/appAssetLibraryPlacements`, {
        data: {
          type: "appAssetLibraryPlacements",
          attributes: { placementType, placementGroup: group },
          relationships: {
            image: { data: { type: "appAssetLibraryImages", id: assetId } },
            [target.kind]: { data: { type: TARGET_TYPES[target.kind], id: target.id } },
          },
        },
      })
      if (!response.ok) throw await toError(response, "Create placement")
      placementIds[index] = (await response.json()).data.id
    }

    const ordered = placementIds as string[]
    let reordered = false
    if (ordered.length > 1) {
      const response = await this.request("POST", `${ASC_API}/v1/appAssetLibraryPlacementOrderingRequests`, {
        data: {
          type: "appAssetLibraryPlacementOrderingRequests",
          attributes: { placementGroup: group },
          relationships: {
            orderedPlacements: { data: ordered.map(id => ({ type: "appAssetLibraryPlacements", id })) },
            [target.kind]: { data: { type: TARGET_TYPES[target.kind], id: target.id } },
          },
        },
      })
      if (!response.ok) throw await toError(response, "Order placements")
      reordered = true
    }

    const after = await this.listPlacements(target, placementType, group)
    const actual = after.map(p => p.assetId)
    if (actual.length !== assetIdsInOrder.length || actual.some((id, i) => id !== assetIdsInOrder[i])) {
      throw new AscLibraryError(
        `Readback mismatch for ${group}: expected ${assetIdsInOrder.join(",")}, got ${actual.join(",")}`,
        undefined,
        "READBACK_MISMATCH",
      )
    }

    return { unchanged: false, created: plan.create.length, removed: plan.remove.length, reordered, placementIds: ordered }
  }

  /**
   * Deletes a library asset only when nothing places it (Apple rejects the
   * delete with STATE_ERROR.ASSET_HAS_PLACEMENTS otherwise). Returns false when
   * it still has placements. Not for the push path.
   */
  async deleteAssetIfUnplaced(assetId: string): Promise<boolean> {
    const response = await this.request("GET", `${ASC_API}/v1/appAssetLibraryImages/${assetId}/relationships/placements?limit=1`)
    if (response.status === 404) return true
    if (!response.ok) throw await toError(response, "Read asset placements")
    if (((await response.json()).data ?? []).length > 0) return false
    const del = await this.request("DELETE", `${ASC_API}/v1/appAssetLibraryImages/${assetId}`)
    if (!del.ok && del.status !== 404) throw await toError(del, "Delete asset")
    return true
  }
}
