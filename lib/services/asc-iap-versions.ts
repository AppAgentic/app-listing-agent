// Versioned IAP / subscription / subscription group localizations (App Store
// Connect API 4.4.1).
//
// Apple now keeps this metadata in versions. Once a version is APPROVED its
// localizations are locked (PATCH returns 409 "Cannot edit ... ACTIVE"). To
// change text you create a draft version, which copies the current
// localizations under new ids, then edit those through the /v2 endpoints. Only
// one draft ("inflight") version can exist at a time. The draft goes to App
// Review with the next submission. Verified live on 2026-10-07; see
// docs/plans/asc-api/api-upgrade-2026-10.md.

const ASC_API = 'https://api.appstoreconnect.apple.com'

export type AscRequest = (method: string, url: string, body?: object) => Promise<Response>

export type VersionedKind = 'inAppPurchase' | 'subscription' | 'subscriptionGroup'

const KINDS: Record<VersionedKind, {
  versionsUrl: (parentId: string) => string
  versionType: string
  parentRelationship: string
  parentType: string
  localizationType: string
  localizationsUrl: string
  versionLocalizationsUrl: (versionId: string) => string
}> = {
  inAppPurchase: {
    versionsUrl: id => `${ASC_API}/v2/inAppPurchases/${id}/versions?limit=50`,
    versionType: 'inAppPurchaseVersions',
    parentRelationship: 'inAppPurchase',
    parentType: 'inAppPurchases',
    localizationType: 'inAppPurchaseLocalizations',
    localizationsUrl: `${ASC_API}/v2/inAppPurchaseLocalizations`,
    versionLocalizationsUrl: id => `${ASC_API}/v1/inAppPurchaseVersions/${id}/localizations?limit=200`,
  },
  subscription: {
    versionsUrl: id => `${ASC_API}/v1/subscriptions/${id}/versions?limit=50`,
    versionType: 'subscriptionVersions',
    parentRelationship: 'subscription',
    parentType: 'subscriptions',
    localizationType: 'subscriptionLocalizations',
    localizationsUrl: `${ASC_API}/v2/subscriptionLocalizations`,
    versionLocalizationsUrl: id => `${ASC_API}/v1/subscriptionVersions/${id}/localizations?limit=200`,
  },
  subscriptionGroup: {
    versionsUrl: id => `${ASC_API}/v1/subscriptionGroups/${id}/versions?limit=50`,
    versionType: 'subscriptionGroupVersions',
    parentRelationship: 'subscriptionGroup',
    parentType: 'subscriptionGroups',
    localizationType: 'subscriptionGroupLocalizations',
    localizationsUrl: `${ASC_API}/v2/subscriptionGroupLocalizations`,
    versionLocalizationsUrl: id => `${ASC_API}/v1/subscriptionGroupVersions/${id}/localizations?limit=200`,
  },
}

// Versions in these states can't take edits and a new draft can't be opened
// until review finishes.
const IN_REVIEW_STATES = new Set(['WAITING_FOR_REVIEW', 'IN_REVIEW'])

export class VersionedMetadataError extends Error {
  constructor(message: string, readonly code: 'VERSIONING_UNAVAILABLE' | 'IN_REVIEW' | 'REQUEST_FAILED') {
    super(message)
    this.name = 'VersionedMetadataError'
  }
}

export interface MetadataVersion {
  id: string
  version: number
  state: string
}

export interface VersionedLocalization {
  id: string
  locale: string
  attributes: Record<string, string | null>
}

export interface UpsertResult {
  localization: VersionedLocalization
  version: MetadataVersion
  /** A draft version was opened because the latest one was approved. */
  createdDraft: boolean
  /** The approved text already matched, so nothing was written. */
  unchanged: boolean
}

async function readJson(response: Response, action: string): Promise<any> {
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new VersionedMetadataError(`${action} failed (${response.status}): ${text.slice(0, 500)}`, 'REQUEST_FAILED')
  }
  return response.json()
}

export async function listVersions(request: AscRequest, kind: VersionedKind, parentId: string): Promise<MetadataVersion[]> {
  const response = await request('GET', KINDS[kind].versionsUrl(parentId))
  if (response.status === 404) return []
  const data = await readJson(response, `List ${kind} versions`)
  return (data.data || [])
    .map((v: { id: string; attributes?: { version?: number; state?: string } }) => ({
      id: v.id,
      version: v.attributes?.version ?? 0,
      state: v.attributes?.state ?? 'UNKNOWN',
    }))
    .sort((a: MetadataVersion, b: MetadataVersion) => b.version - a.version)
}

export async function listVersionLocalizations(
  request: AscRequest,
  kind: VersionedKind,
  versionId: string,
): Promise<VersionedLocalization[]> {
  const data = await readJson(await request('GET', KINDS[kind].versionLocalizationsUrl(versionId)), `List ${kind} version localizations`)
  return (data.data || []).map((l: { id: string; attributes?: Record<string, string | null> }) => {
    const { locale, ...attributes } = l.attributes ?? {}
    return { id: l.id, locale: locale ?? '', attributes }
  })
}

function matches(current: Record<string, string | null>, wanted: Record<string, string | null>): boolean {
  return Object.entries(wanted).every(([key, value]) => (current[key] ?? null) === (value ?? null))
}

/**
 * Sets one locale's text on the item's editable version, opening a draft when
 * the latest version is approved and the text actually changes.
 */
export async function upsertVersionedLocalization(
  request: AscRequest,
  kind: VersionedKind,
  parentId: string,
  locale: string,
  attributes: Record<string, string | null>,
): Promise<UpsertResult> {
  const spec = KINDS[kind]
  const versions = await listVersions(request, kind, parentId)
  let version = versions[0]
  if (!version) {
    throw new VersionedMetadataError(`No metadata versions for ${kind} ${parentId}`, 'VERSIONING_UNAVAILABLE')
  }
  if (IN_REVIEW_STATES.has(version.state)) {
    throw new VersionedMetadataError(
      `${kind} ${parentId} version ${version.version} is ${version.state}; edits are possible once review finishes`,
      'IN_REVIEW',
    )
  }

  let localizations = await listVersionLocalizations(request, kind, version.id)
  let existing = localizations.find(l => l.locale === locale)
  let createdDraft = false

  if (version.state === 'APPROVED') {
    if (existing && matches(existing.attributes, attributes)) {
      return { localization: existing, version, createdDraft: false, unchanged: true }
    }
    const created = await readJson(await request('POST', `${ASC_API}/v1/${spec.versionType}`, {
      data: {
        type: spec.versionType,
        relationships: { [spec.parentRelationship]: { data: { type: spec.parentType, id: parentId } } },
      },
    }), `Create ${kind} draft version`)
    version = {
      id: created.data.id,
      version: created.data.attributes?.version ?? version.version + 1,
      state: created.data.attributes?.state ?? 'PREPARE_FOR_SUBMISSION',
    }
    createdDraft = true
    localizations = await listVersionLocalizations(request, kind, version.id)
    existing = localizations.find(l => l.locale === locale)
  }

  if (existing) {
    if (matches(existing.attributes, attributes)) {
      return { localization: existing, version, createdDraft, unchanged: !createdDraft }
    }
    const updated = await readJson(await request('PATCH', `${spec.localizationsUrl}/${existing.id}`, {
      data: { type: spec.localizationType, id: existing.id, attributes },
    }), `Update ${kind} localization`)
    const { locale: updatedLocale, ...updatedAttributes } = updated.data.attributes ?? {}
    return {
      localization: { id: updated.data.id, locale: updatedLocale ?? locale, attributes: updatedAttributes },
      version,
      createdDraft,
      unchanged: false,
    }
  }

  const created = await readJson(await request('POST', spec.localizationsUrl, {
    data: {
      type: spec.localizationType,
      attributes: { locale, ...attributes },
      relationships: { version: { data: { type: spec.versionType, id: version.id } } },
    },
  }), `Create ${kind} localization`)
  const { locale: createdLocale, ...createdAttributes } = created.data.attributes ?? {}
  return {
    localization: { id: created.data.id, locale: createdLocale ?? locale, attributes: createdAttributes },
    version,
    createdDraft,
    unchanged: false,
  }
}

/**
 * The v1 lists return both the approved and the draft localization for a
 * locale while a draft is open. Keep one per locale, preferring the draft
 * (the newest text).
 */
export function preferDraftPerLocale<T extends { locale: string; state?: string | null }>(items: T[]): T[] {
  const byLocale = new Map<string, T>()
  for (const item of items) {
    const current = byLocale.get(item.locale)
    if (!current || (current.state === 'APPROVED' && item.state !== 'APPROVED')) byLocale.set(item.locale, item)
  }
  return [...byLocale.values()]
}
