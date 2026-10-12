import { APPSTORE_LIMITS, PLAYSTORE_LIMITS } from '@/lib/constants'

export function metadataFieldLimits(store: 'appstore' | 'playstore'): Readonly<Record<string, number>> {
  return store === 'appstore' ? APPSTORE_LIMITS : PLAYSTORE_LIMITS
}

/** Matches local save validation: Unicode code points, without normalization or trimming. */
export function metadataCharacterCount(value: string): number {
  return Array.from(value).length
}

export interface MetadataFieldLength {
  characterCount: number
  limit: number
  withinLimit: boolean
}

export function measureMetadataFields(store: 'appstore' | 'playstore', fields: Record<string, string>): Record<string, MetadataFieldLength> {
  const limits = metadataFieldLimits(store)
  return Object.fromEntries(Object.entries(fields).flatMap(([field, value]) => {
    if (!Object.prototype.hasOwnProperty.call(limits, field) || typeof value !== 'string') return []
    const characterCount = metadataCharacterCount(value)
    return [[field, { characterCount, limit: limits[field], withinLimit: characterCount <= limits[field] }]]
  }))
}
